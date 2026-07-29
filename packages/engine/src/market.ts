import { type LmsrState, applyTrade, createMarket } from "./lmsr.js";
import { type AccountId, type Balances, type Posting, balanceOf, postEntry } from "./ledger.js";
import { assertMicroInt } from "./money.js";

/**
 * Pure orchestration of one market: LMSR state + user positions + ledger moves.
 * The treasury is the org's equity account: its negative balance equals
 * org-dollars in circulation, and it is the only account allowed below zero.
 */
export const TREASURY: AccountId = "org:treasury";
const ALLOW_TREASURY_NEGATIVE: ReadonlySet<AccountId> = new Set([TREASURY]);

export function userAccount(userId: string): AccountId {
  return `user:${userId}`;
}

export function escrowAccount(marketId: string): AccountId {
  return `market:${marketId}:escrow`;
}

export interface MarketSession {
  readonly id: string;
  readonly state: LmsrState;
  /** userId → micro-shares held per outcome. */
  readonly positions: ReadonlyMap<string, readonly number[]>;
  readonly resolvedOutcome: number | null;
}

export function openMarket(id: string, numOutcomes: number, liquidityCredits: number): MarketSession {
  return {
    id,
    state: createMarket(numOutcomes, liquidityCredits),
    positions: new Map(),
    resolvedOutcome: null,
  };
}

/** Issue org-dollars to a user (join grant, weekly stipend). */
export function grant(balances: Balances, userId: string, amountMicro: number): Balances {
  assertMicroInt(amountMicro, "grant amount");
  if (amountMicro <= 0) throw new Error(`grant amount must be positive, got ${amountMicro}`);
  return postEntry(
    balances,
    [
      { account: TREASURY, amountMicro: -amountMicro },
      { account: userAccount(userId), amountMicro },
    ],
    ALLOW_TREASURY_NEGATIVE,
  );
}

export function positionOf(session: MarketSession, userId: string): readonly number[] {
  return session.positions.get(userId) ?? new Array<number>(session.state.q.length).fill(0);
}

export interface TradeResult {
  readonly session: MarketSession;
  readonly balances: Balances;
  /** Micro-credits the trader paid (negative = received, on a sale). */
  readonly costMicro: number;
}

/**
 * Buy (positive delta) or sell (negative delta) micro-shares of an outcome.
 * INV-NOSHORT: sells are capped at the trader's holding, which keeps
 * outstanding shares — and therefore the escrow balance — non-negative.
 */
export function executeTrade(
  session: MarketSession,
  balances: Balances,
  userId: string,
  outcome: number,
  deltaMicroShares: number,
): TradeResult {
  if (session.resolvedOutcome !== null) {
    throw new Error(`market ${session.id} is already resolved`);
  }
  const held = positionOf(session, userId)[outcome] ?? 0;
  if (deltaMicroShares < 0 && held + deltaMicroShares < 0) {
    throw new Error(
      `cannot sell ${-deltaMicroShares} micro-shares while holding ${held} (no shorting in v1)`,
    );
  }
  const { state, costMicro } = applyTrade(session.state, outcome, deltaMicroShares);
  const nextBalances =
    costMicro === 0
      ? balances
      : postEntry(
          balances,
          [
            { account: userAccount(userId), amountMicro: -costMicro },
            { account: escrowAccount(session.id), amountMicro: costMicro },
          ],
          ALLOW_TREASURY_NEGATIVE,
        );
  const nextPosition = [...positionOf(session, userId)];
  nextPosition[outcome] = held + deltaMicroShares;
  const nextPositions = new Map(session.positions);
  nextPositions.set(userId, nextPosition);
  return {
    session: { ...session, state, positions: nextPositions },
    balances: nextBalances,
    costMicro,
  };
}

export interface ResolutionResult {
  readonly session: MarketSession;
  readonly balances: Balances;
  /** userId → micro-credits paid out. */
  readonly payouts: ReadonlyMap<string, number>;
}

/**
 * Resolve to a winning outcome: every winning micro-share pays 1 micro-credit.
 * INV-ESCROW: the escrow sweeps to exactly 0 — surplus goes to the treasury,
 * shortfall (bounded by b·ln(n)) is paid by the treasury.
 */
export function resolveMarket(
  session: MarketSession,
  balances: Balances,
  winningOutcome: number,
): ResolutionResult {
  if (session.resolvedOutcome !== null) {
    throw new Error(`market ${session.id} is already resolved`);
  }
  if (!Number.isInteger(winningOutcome) || winningOutcome < 0 || winningOutcome >= session.state.q.length) {
    throw new Error(`winning outcome ${winningOutcome} out of range [0, ${session.state.q.length})`);
  }
  const payouts = new Map<string, number>();
  let totalPayout = 0;
  for (const [userId, position] of session.positions) {
    const payout = position[winningOutcome] ?? 0;
    if (payout > 0) {
      payouts.set(userId, payout);
      totalPayout += payout;
    }
  }
  const escrow = escrowAccount(session.id);
  const escrowBalance = balanceOf(balances, escrow);
  let nextBalances = balances;
  if (totalPayout > 0 || escrowBalance !== 0) {
    const postings: Posting[] = [];
    for (const [userId, payout] of payouts) {
      postings.push({ account: userAccount(userId), amountMicro: payout });
    }
    if (escrowBalance !== 0) postings.push({ account: escrow, amountMicro: -escrowBalance });
    const treasuryDelta = escrowBalance - totalPayout;
    if (treasuryDelta !== 0) postings.push({ account: TREASURY, amountMicro: treasuryDelta });
    nextBalances = postEntry(balances, postings, ALLOW_TREASURY_NEGATIVE);
  }
  return {
    session: { ...session, resolvedOutcome: winningOutcome },
    balances: nextBalances,
    payouts,
  };
}
