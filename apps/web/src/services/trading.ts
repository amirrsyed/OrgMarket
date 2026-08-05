import { and, asc, desc, eq, sql } from "drizzle-orm";
import {
  type LmsrState,
  applyTrade,
  prices,
  sharesForBudgetMicro,
  sharesToMovePrice,
  tradeCostMicro,
} from "@orgmarket/engine";
import type { Db } from "@/db";
import {
  accounts,
  journalEntries,
  marketOutcomes,
  markets,
  memberships,
  positions,
  postings,
  trades,
} from "@/db/schema";

/**
 * Transactional service layer: every mutation runs in one DB transaction that
 * takes the market row lock first (SELECT … FOR UPDATE), serializing trades
 * per market (SPEC §5). The pure engine computes; this module persists.
 */

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

function id(): string {
  return crypto.randomUUID();
}

async function getOrCreateAccount(
  tx: Tx,
  orgId: string,
  kind: "treasury" | "user" | "escrow",
  refId: string,
): Promise<{ id: string; balanceMicro: number }> {
  await tx
    .insert(accounts)
    .values({ id: id(), orgId, kind, refId })
    .onConflictDoNothing({ target: [accounts.orgId, accounts.kind, accounts.refId] });
  const [row] = await tx
    .select({ id: accounts.id, balanceMicro: accounts.balanceMicro })
    .from(accounts)
    .where(and(eq(accounts.orgId, orgId), eq(accounts.kind, kind), eq(accounts.refId, refId)));
  if (!row) throw new Error(`account ${kind}:${refId} not found after upsert`);
  return row;
}

/**
 * Post one balanced journal entry and apply it to denormalized balances.
 * Throws (rolling back the enclosing transaction) if postings don't sum to
 * zero or a non-treasury account would go negative.
 */
async function postJournal(
  tx: Tx,
  orgId: string,
  kind: "grant" | "trade" | "resolution",
  entryPostings: readonly { accountId: string; amountMicro: number; isTreasury?: boolean }[],
  meta?: Record<string, unknown>,
  at?: Date,
): Promise<void> {
  if (entryPostings.length < 2) throw new Error("journal entry needs at least two postings");
  let sum = 0;
  for (const p of entryPostings) {
    if (!Number.isSafeInteger(p.amountMicro)) {
      throw new Error(`posting amount must be a safe integer, got ${p.amountMicro}`);
    }
    sum += p.amountMicro;
  }
  if (sum !== 0) throw new Error(`journal entry does not balance: sum ${sum}`);
  const entryId = id();
  await tx
    .insert(journalEntries)
    .values({ id: entryId, orgId, kind, meta: meta ?? null, ...(at ? { createdAt: at } : {}) });
  for (const p of entryPostings) {
    await tx.insert(postings).values({ id: id(), entryId, accountId: p.accountId, amountMicro: p.amountMicro });
    const [updated] = await tx
      .update(accounts)
      .set({ balanceMicro: sql`${accounts.balanceMicro} + ${p.amountMicro}` })
      .where(eq(accounts.id, p.accountId))
      .returning({ balanceMicro: accounts.balanceMicro });
    if (!updated) throw new Error(`account ${p.accountId} missing`);
    if (updated.balanceMicro < 0 && !p.isTreasury) {
      throw new Error(`insufficient funds: account would end at ${updated.balanceMicro} micro`);
    }
  }
}

/** Issue org-dollars to a member (join grant / stipend). */
export async function grantToMembership(
  db: Db,
  params: { orgId: string; membershipId: string; amountMicro: number; at?: Date },
): Promise<void> {
  const { orgId, membershipId, amountMicro, at } = params;
  if (!Number.isSafeInteger(amountMicro) || amountMicro <= 0) {
    throw new Error(`grant amount must be a positive integer, got ${amountMicro}`);
  }
  await db.transaction(async (tx) => {
    const treasury = await getOrCreateAccount(tx, orgId, "treasury", orgId);
    const user = await getOrCreateAccount(tx, orgId, "user", membershipId);
    await postJournal(
      tx,
      orgId,
      "grant",
      [
        { accountId: treasury.id, amountMicro: -amountMicro, isTreasury: true },
        { accountId: user.id, amountMicro },
      ],
      { membershipId },
      at,
    );
  });
}

export interface MarketRow {
  id: string;
  orgId: string;
  question: string;
  description: string;
  resolutionCriteria: string;
  resolutionSource: string;
  liquidityB: number;
  status: "open" | "closed" | "resolved";
  closeAt: Date;
  resolvedOutcomeIdx: number | null;
  resolutionEvidence: string | null;
  outcomes: { idx: number; label: string; qMicroShares: number }[];
  prices: number[];
}

async function loadMarketLocked(tx: Tx, marketId: string) {
  const [market] = await tx.select().from(markets).where(eq(markets.id, marketId)).for("update");
  if (!market) throw new Error(`market ${marketId} not found`);
  const outcomes = await tx
    .select()
    .from(marketOutcomes)
    .where(eq(marketOutcomes.marketId, marketId))
    .orderBy(asc(marketOutcomes.idx));
  const state: LmsrState = { b: market.liquidityB, q: outcomes.map((o) => o.qMicroShares) };
  return { market, outcomes, state };
}

export async function createMarketTx(
  db: Db,
  params: {
    orgId: string;
    question: string;
    description?: string;
    resolutionCriteria: string;
    resolutionSource: string;
    liquidityB: number;
    closeAt: Date;
    createdBy: string;
    outcomeLabels: string[];
    at?: Date;
  },
): Promise<string> {
  const labels = params.outcomeLabels.map((l) => l.trim()).filter(Boolean);
  if (labels.length < 2 || labels.length > 10) {
    throw new Error(`markets need 2–10 outcomes, got ${labels.length}`);
  }
  if (!(params.liquidityB > 0)) throw new Error("liquidity must be positive");
  const marketId = id();
  await db.transaction(async (tx) => {
    await tx.insert(markets).values({
      id: marketId,
      orgId: params.orgId,
      question: params.question,
      description: params.description ?? "",
      resolutionCriteria: params.resolutionCriteria,
      resolutionSource: params.resolutionSource,
      liquidityB: params.liquidityB,
      closeAt: params.closeAt,
      createdBy: params.createdBy,
      ...(params.at ? { createdAt: params.at } : {}),
    });
    for (const [idx, label] of labels.entries()) {
      await tx.insert(marketOutcomes).values({ id: id(), marketId, idx, label });
    }
  });
  return marketId;
}

export interface TradeOutcome {
  tradeId: string;
  costMicro: number;
  postPrices: number[];
  replayed: boolean;
}

export async function executeTradeTx(
  db: Db,
  params: {
    orgId: string;
    marketId: string;
    membershipId: string;
    outcomeIdx: number;
    deltaMicroShares: number;
    idempotencyKey: string;
    at?: Date;
  },
): Promise<TradeOutcome> {
  const { orgId, marketId, membershipId, outcomeIdx, deltaMicroShares, idempotencyKey } = params;
  const at = params.at ?? new Date();
  if (!Number.isSafeInteger(deltaMicroShares) || deltaMicroShares === 0) {
    throw new Error(`deltaMicroShares must be a nonzero safe integer, got ${deltaMicroShares}`);
  }
  return db.transaction(async (tx) => {
    const { market, outcomes, state } = await loadMarketLocked(tx, marketId);
    // Idempotency check under the market lock: a retry of an in-flight trade
    // serializes behind the original and sees its row.
    const [existing] = await tx.select().from(trades).where(eq(trades.idempotencyKey, idempotencyKey));
    if (existing) {
      return {
        tradeId: existing.id,
        costMicro: existing.costMicro,
        postPrices: existing.postPrices,
        replayed: true,
      };
    }
    if (market.orgId !== orgId) throw new Error("market belongs to a different org");
    if (market.status !== "open") throw new Error(`market is ${market.status}`);
    if (market.closeAt.getTime() <= at.getTime()) throw new Error("market is past its close date");
    if (outcomeIdx < 0 || outcomeIdx >= outcomes.length) throw new Error("bad outcome index");

    if (deltaMicroShares < 0) {
      const [pos] = await tx
        .select()
        .from(positions)
        .where(
          and(
            eq(positions.marketId, marketId),
            eq(positions.membershipId, membershipId),
            eq(positions.outcomeIdx, outcomeIdx),
          ),
        );
      const held = pos?.microShares ?? 0;
      if (held + deltaMicroShares < 0) {
        throw new Error(`cannot sell ${-deltaMicroShares} micro-shares while holding ${held} (no shorting)`);
      }
    }

    const costMicro = tradeCostMicro(state, outcomeIdx, deltaMicroShares);
    const next = applyTrade(state, outcomeIdx, deltaMicroShares).state;
    const postPrices = prices(next);

    const userAcct = await getOrCreateAccount(tx, orgId, "user", membershipId);
    const escrowAcct = await getOrCreateAccount(tx, orgId, "escrow", marketId);
    if (costMicro !== 0) {
      await postJournal(
        tx,
        orgId,
        "trade",
        [
          { accountId: userAcct.id, amountMicro: -costMicro },
          { accountId: escrowAcct.id, amountMicro: costMicro },
        ],
        { marketId, membershipId, outcomeIdx, idempotencyKey },
        at,
      );
    }

    const outcome = outcomes[outcomeIdx]!;
    await tx
      .update(marketOutcomes)
      .set({ qMicroShares: outcome.qMicroShares + deltaMicroShares })
      .where(eq(marketOutcomes.id, outcome.id));
    await tx
      .insert(positions)
      .values({ marketId, membershipId, outcomeIdx, microShares: deltaMicroShares })
      .onConflictDoUpdate({
        target: [positions.marketId, positions.membershipId, positions.outcomeIdx],
        set: { microShares: sql`${positions.microShares} + ${deltaMicroShares}` },
      });

    const tradeId = id();
    await tx.insert(trades).values({
      id: tradeId,
      orgId,
      marketId,
      membershipId,
      outcomeIdx,
      deltaMicroShares,
      costMicro,
      postPrices,
      idempotencyKey,
      createdAt: at,
    });
    return { tradeId, costMicro, postPrices, replayed: false };
  });
}

export interface TradePreview {
  outcomeIdx: number;
  targetProb: number;
  deltaMicroShares: number;
  costMicro: number;
  newProb: number;
  /** Set when the trade was clamped by balance (buys) or holdings (sells). */
  cappedBy: "budget" | "holdings" | null;
}

/**
 * The forecast-slider primitive: "I think it's X%" → the trade that moves the
 * market there, clamped to what the member can afford (buys) or holds (sells).
 * `maxSpendMicro` further caps a buy (Slack taps use ₥25 per D18).
 */
export async function previewTrade(
  db: Db,
  params: {
    orgId: string;
    marketId: string;
    membershipId: string;
    outcomeIdx: number;
    targetProb: number;
    maxSpendMicro?: number;
  },
): Promise<TradePreview> {
  const { orgId, marketId, membershipId, outcomeIdx, targetProb, maxSpendMicro } = params;
  const [market] = await db.select().from(markets).where(eq(markets.id, marketId));
  if (!market || market.orgId !== orgId) throw new Error("market not found");
  const outcomes = await db
    .select()
    .from(marketOutcomes)
    .where(eq(marketOutcomes.marketId, marketId))
    .orderBy(asc(marketOutcomes.idx));
  const state: LmsrState = { b: market.liquidityB, q: outcomes.map((o) => o.qMicroShares) };

  async function heldShares(idx: number): Promise<number> {
    const [pos] = await db
      .select()
      .from(positions)
      .where(
        and(
          eq(positions.marketId, marketId),
          eq(positions.membershipId, membershipId),
          eq(positions.outcomeIdx, idx),
        ),
      );
    return pos?.microShares ?? 0;
  }

  const currentProb = prices(state)[outcomeIdx]!;
  let tradeIdx = outcomeIdx;
  let delta: number;
  let cappedBy: TradePreview["cappedBy"] = null;
  if (targetProb < currentProb) {
    // Down-move: sell what you hold; in a binary market with nothing to sell,
    // buy the complement instead — "Yes is too high" and "No is too low" are
    // the same belief. (Decide by price comparison, not delta sign: the engine
    // clamps sells at zero outstanding shares, hiding the intent.)
    const held = await heldShares(outcomeIdx);
    if (held === 0 && state.q.length === 2) {
      tradeIdx = 1 - outcomeIdx;
      delta = sharesToMovePrice(state, tradeIdx, 1 - targetProb);
    } else {
      delta = sharesToMovePrice(state, outcomeIdx, targetProb);
      if (-delta > held) {
        delta = -held;
        cappedBy = "holdings";
      }
    }
  } else {
    delta = sharesToMovePrice(state, outcomeIdx, targetProb);
  }
  if (delta > 0) {
    const [acct] = await db
      .select({ balanceMicro: accounts.balanceMicro })
      .from(accounts)
      .where(and(eq(accounts.orgId, orgId), eq(accounts.kind, "user"), eq(accounts.refId, membershipId)));
    const balance = acct?.balanceMicro ?? 0;
    const budget = maxSpendMicro !== undefined ? Math.min(balance, maxSpendMicro) : balance;
    if (tradeCostMicro(state, tradeIdx, delta) > budget) {
      delta = sharesForBudgetMicro(state, tradeIdx, budget);
      cappedBy = "budget";
    }
  }
  const costMicro = delta === 0 ? 0 : tradeCostMicro(state, tradeIdx, delta);
  // newProb reports the *displayed* outcome, whichever side the trade is on.
  const newProb =
    delta === 0 ? prices(state)[outcomeIdx]! : prices(applyTrade(state, tradeIdx, delta).state)[outcomeIdx]!;
  return { outcomeIdx: tradeIdx, targetProb, deltaMicroShares: delta, costMicro, newProb, cappedBy };
}

export async function resolveMarketTx(
  db: Db,
  params: { orgId: string; marketId: string; winningOutcomeIdx: number; resolvedBy: string; evidence: string; at?: Date },
): Promise<{ totalPayoutMicro: number; winnerCount: number }> {
  const { orgId, marketId, winningOutcomeIdx, resolvedBy, evidence } = params;
  const at = params.at ?? new Date();
  return db.transaction(async (tx) => {
    const { market, outcomes } = await loadMarketLocked(tx, marketId);
    if (market.orgId !== orgId) throw new Error("market belongs to a different org");
    if (market.status === "resolved") throw new Error("market is already resolved");
    if (winningOutcomeIdx < 0 || winningOutcomeIdx >= outcomes.length) throw new Error("bad outcome index");

    const winners = await tx
      .select()
      .from(positions)
      .where(and(eq(positions.marketId, marketId), eq(positions.outcomeIdx, winningOutcomeIdx)));
    const treasury = await getOrCreateAccount(tx, orgId, "treasury", orgId);
    const escrowAcct = await getOrCreateAccount(tx, orgId, "escrow", marketId);

    let totalPayout = 0;
    let winnerCount = 0;
    const entryPostings: { accountId: string; amountMicro: number; isTreasury?: boolean }[] = [];
    for (const w of winners) {
      if (w.microShares <= 0) continue;
      const acct = await getOrCreateAccount(tx, orgId, "user", w.membershipId);
      entryPostings.push({ accountId: acct.id, amountMicro: w.microShares });
      totalPayout += w.microShares;
      winnerCount += 1;
    }
    // INV-ESCROW: sweep escrow to exactly 0; treasury absorbs surplus/shortfall.
    if (escrowAcct.balanceMicro !== 0) {
      entryPostings.push({ accountId: escrowAcct.id, amountMicro: -escrowAcct.balanceMicro });
    }
    const treasuryDelta = escrowAcct.balanceMicro - totalPayout;
    if (treasuryDelta !== 0) {
      entryPostings.push({ accountId: treasury.id, amountMicro: treasuryDelta, isTreasury: true });
    }
    if (entryPostings.length >= 2) {
      await postJournal(tx, orgId, "resolution", entryPostings, { marketId, winningOutcomeIdx }, at);
    }
    await tx
      .update(markets)
      .set({
        status: "resolved",
        resolvedOutcomeIdx: winningOutcomeIdx,
        resolvedBy,
        resolvedAt: at,
        resolutionEvidence: evidence,
      })
      .where(eq(markets.id, marketId));
    return { totalPayoutMicro: totalPayout, winnerCount };
  });
}

export async function listMarkets(db: Db, orgId: string): Promise<MarketRow[]> {
  const rows = await db
    .select()
    .from(markets)
    .where(eq(markets.orgId, orgId))
    .orderBy(desc(markets.createdAt));
  const result: MarketRow[] = [];
  for (const m of rows) {
    const outcomes = await db
      .select()
      .from(marketOutcomes)
      .where(eq(marketOutcomes.marketId, m.id))
      .orderBy(asc(marketOutcomes.idx));
    const state: LmsrState = { b: m.liquidityB, q: outcomes.map((o) => o.qMicroShares) };
    result.push({
      id: m.id,
      orgId: m.orgId,
      question: m.question,
      description: m.description,
      resolutionCriteria: m.resolutionCriteria,
      resolutionSource: m.resolutionSource,
      liquidityB: m.liquidityB,
      status: m.status,
      closeAt: m.closeAt,
      resolvedOutcomeIdx: m.resolvedOutcomeIdx,
      resolutionEvidence: m.resolutionEvidence,
      outcomes: outcomes.map((o) => ({ idx: o.idx, label: o.label, qMicroShares: o.qMicroShares })),
      prices: prices(state),
    });
  }
  return result;
}

export async function getMarket(db: Db, orgId: string, marketId: string): Promise<MarketRow | null> {
  const all = await listMarkets(db, orgId);
  return all.find((m) => m.id === marketId) ?? null;
}

export async function getBalanceMicro(db: Db, orgId: string, membershipId: string): Promise<number> {
  const [acct] = await db
    .select({ balanceMicro: accounts.balanceMicro })
    .from(accounts)
    .where(and(eq(accounts.orgId, orgId), eq(accounts.kind, "user"), eq(accounts.refId, membershipId)));
  return acct?.balanceMicro ?? 0;
}

export interface RecentTrade {
  pseudonym: string;
  outcomeIdx: number;
  deltaMicroShares: number;
  costMicro: number;
  postProb: number;
  createdAt: Date;
}

export async function recentTrades(db: Db, marketId: string, limit = 20): Promise<RecentTrade[]> {
  const rows = await db
    .select({
      pseudonym: memberships.pseudonym,
      outcomeIdx: trades.outcomeIdx,
      deltaMicroShares: trades.deltaMicroShares,
      costMicro: trades.costMicro,
      postPrices: trades.postPrices,
      createdAt: trades.createdAt,
    })
    .from(trades)
    .innerJoin(memberships, eq(trades.membershipId, memberships.id))
    .where(eq(trades.marketId, marketId))
    .orderBy(desc(trades.createdAt))
    .limit(limit);
  return rows.map((r) => ({
    pseudonym: r.pseudonym,
    outcomeIdx: r.outcomeIdx,
    deltaMicroShares: r.deltaMicroShares,
    costMicro: r.costMicro,
    postProb: r.postPrices[r.outcomeIdx] ?? 0,
    createdAt: r.createdAt,
  }));
}

export interface PricePoint {
  t: string;
  prices: number[];
}

export async function priceHistory(db: Db, marketId: string): Promise<PricePoint[]> {
  const [market] = await db.select().from(markets).where(eq(markets.id, marketId));
  if (!market) return [];
  const outcomeCount = (
    await db.select().from(marketOutcomes).where(eq(marketOutcomes.marketId, marketId))
  ).length;
  const rows = await db
    .select({ postPrices: trades.postPrices, createdAt: trades.createdAt })
    .from(trades)
    .where(eq(trades.marketId, marketId))
    .orderBy(asc(trades.createdAt));
  const uniform = new Array<number>(outcomeCount).fill(1 / outcomeCount);
  return [
    { t: market.createdAt.toISOString(), prices: uniform },
    ...rows.map((r) => ({ t: r.createdAt.toISOString(), prices: r.postPrices })),
  ];
}

export interface PortfolioPosition {
  marketId: string;
  question: string;
  status: string;
  outcomeIdx: number;
  outcomeLabel: string;
  microShares: number;
  currentProb: number;
  valueMicro: number;
}

export async function getPortfolio(db: Db, orgId: string, membershipId: string) {
  const balanceMicro = await getBalanceMicro(db, orgId, membershipId);
  const posRows = await db
    .select()
    .from(positions)
    .where(eq(positions.membershipId, membershipId));
  const marketRows = await listMarkets(db, orgId);
  const byId = new Map(marketRows.map((m) => [m.id, m]));
  const open: PortfolioPosition[] = [];
  for (const p of posRows) {
    if (p.microShares === 0) continue;
    const m = byId.get(p.marketId);
    if (!m || m.status === "resolved") continue;
    const prob = m.prices[p.outcomeIdx] ?? 0;
    open.push({
      marketId: p.marketId,
      question: m.question,
      status: m.status,
      outcomeIdx: p.outcomeIdx,
      outcomeLabel: m.outcomes[p.outcomeIdx]?.label ?? String(p.outcomeIdx),
      microShares: p.microShares,
      currentProb: prob,
      valueMicro: Math.floor(p.microShares * prob),
    });
  }
  const history = await db
    .select({
      marketId: trades.marketId,
      outcomeIdx: trades.outcomeIdx,
      deltaMicroShares: trades.deltaMicroShares,
      costMicro: trades.costMicro,
      createdAt: trades.createdAt,
    })
    .from(trades)
    .where(eq(trades.membershipId, membershipId))
    .orderBy(desc(trades.createdAt))
    .limit(50);
  return { balanceMicro, positions: open, history, markets: byId };
}

export interface LeaderboardRow {
  membershipId: string;
  pseudonym: string;
  netWorthMicro: number;
  /** Trade-size-weighted Brier score over resolved markets (lower = better). */
  brier: number | null;
  resolvedTradeCount: number;
}

export async function getLeaderboard(db: Db, orgId: string): Promise<LeaderboardRow[]> {
  const members = await db.select().from(memberships).where(eq(memberships.orgId, orgId));
  const marketRows = await listMarkets(db, orgId);
  const byId = new Map(marketRows.map((m) => [m.id, m]));
  const rows: LeaderboardRow[] = [];
  for (const member of members) {
    const balance = await getBalanceMicro(db, orgId, member.id);
    const posRows = await db.select().from(positions).where(eq(positions.membershipId, member.id));
    let positionValue = 0;
    for (const p of posRows) {
      const m = byId.get(p.marketId);
      if (!m || m.status === "resolved" || p.microShares === 0) continue;
      positionValue += Math.floor(p.microShares * (m.prices[p.outcomeIdx] ?? 0));
    }
    // Calibration: for each BUY on a since-resolved market, the trader's
    // implied belief is the post-trade price of the outcome they bought.
    // Brier = weighted mean of (belief − won)²; weight = trade size (D13/D14:
    // this is the all-time reputation metric, and it is collusion-resistant).
    const memberTrades = await db
      .select()
      .from(trades)
      .where(eq(trades.membershipId, member.id));
    let weightSum = 0;
    let scoreSum = 0;
    let resolvedTradeCount = 0;
    for (const tr of memberTrades) {
      if (tr.deltaMicroShares <= 0) continue;
      const m = byId.get(tr.marketId);
      if (!m || m.status !== "resolved" || m.resolvedOutcomeIdx === null) continue;
      const belief = tr.postPrices[tr.outcomeIdx] ?? 0;
      const won = m.resolvedOutcomeIdx === tr.outcomeIdx ? 1 : 0;
      const w = tr.deltaMicroShares;
      weightSum += w;
      scoreSum += w * (belief - won) ** 2;
      resolvedTradeCount += 1;
    }
    rows.push({
      membershipId: member.id,
      pseudonym: member.pseudonym,
      netWorthMicro: balance + positionValue,
      brier: weightSum > 0 ? scoreSum / weightSum : null,
      resolvedTradeCount,
    });
  }
  rows.sort((a, b) => {
    if (a.brier === null && b.brier === null) return b.netWorthMicro - a.netWorthMicro;
    if (a.brier === null) return 1;
    if (b.brier === null) return -1;
    return a.brier - b.brier;
  });
  return rows;
}
