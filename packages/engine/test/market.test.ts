import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { MICRO_PER_CREDIT, microToCredits } from "../src/money";
import { prices, sharesForBudgetMicro, worstCaseLossMicro } from "../src/lmsr";
import { balanceOf, emptyBalances, totalMicro, type Balances } from "../src/ledger";
import {
  TREASURY,
  type MarketSession,
  escrowAccount,
  executeTrade,
  grant,
  openMarket,
  positionOf,
  resolveMarket,
  userAccount,
} from "../src/market";

const CREDITS = MICRO_PER_CREDIT;

/** Outstanding shares must always equal the sum of user positions. */
function checkPositionsMatchOutstanding(session: MarketSession): void {
  for (let i = 0; i < session.state.q.length; i++) {
    let held = 0;
    for (const position of session.positions.values()) held += position[i] ?? 0;
    expect(held).toBe(session.state.q[i]!);
  }
}

describe("market: known values", () => {
  it("a fresh binary market prices at 50/50 and worst-case loss is b·ln(2)", () => {
    const session = openMarket("m1", 2, 100);
    expect(prices(session.state)[0]!).toBeCloseTo(0.5, 12);
    expect(prices(session.state)[1]!).toBeCloseTo(0.5, 12);
    expect(worstCaseLossMicro(2, 100)).toBe(Math.ceil(100 * Math.log(2) * CREDITS));
  });

  it("buying 100 YES shares at b=100 matches the closed form and moves the price to e/(e+1)", () => {
    let balances = grant(emptyBalances(), "alice", 200 * CREDITS);
    const session = openMarket("m2", 2, 100);
    const r = executeTrade(session, balances, "alice", 0, 100 * CREDITS);
    const expectedCredits = 100 * Math.log((Math.E + 1) / 2); // C(100,0) − C(0,0)
    expect(microToCredits(r.costMicro)).toBeCloseTo(expectedCredits, 4);
    expect(r.costMicro).toBeGreaterThanOrEqual(Math.ceil(expectedCredits * CREDITS) - 1);
    expect(prices(r.session.state)[0]!).toBeCloseTo(Math.E / (Math.E + 1), 9);
    balances = r.balances;
    expect(balanceOf(balances, userAccount("alice")) + r.costMicro).toBe(200 * CREDITS);
  });

  it("resolution pays 1 credit per winning share, sweeps escrow to zero, conserves money", () => {
    let balances = emptyBalances();
    balances = grant(balances, "alice", 1000 * CREDITS);
    balances = grant(balances, "bob", 1000 * CREDITS);
    let session = openMarket("m3", 2, 100);
    let r = executeTrade(session, balances, "alice", 0, 10 * CREDITS); // 10 YES
    ({ session, balances } = r);
    r = executeTrade(session, balances, "bob", 1, 5 * CREDITS); // 5 NO
    ({ session, balances } = r);
    checkPositionsMatchOutstanding(session);

    const res = resolveMarket(session, balances, 0);
    expect(res.payouts.get("alice")).toBe(10 * CREDITS);
    expect(res.payouts.has("bob")).toBe(false);
    expect(balanceOf(res.balances, escrowAccount("m3"))).toBe(0);
    expect(totalMicro(res.balances)).toBe(0);
    expect(res.session.resolvedOutcome).toBe(0);
  });

  it("enforces no shorting, no overselling, no trading after resolution, and positive grants", () => {
    let balances = grant(emptyBalances(), "alice", 100 * CREDITS);
    let session = openMarket("m4", 2, 100);
    expect(() => executeTrade(session, balances, "alice", 0, -1)).toThrow(/no shorting/);
    const r = executeTrade(session, balances, "alice", 0, 5 * CREDITS);
    ({ session, balances } = r);
    expect(() => executeTrade(session, balances, "alice", 0, -(6 * CREDITS))).toThrow(/no shorting/);
    const res = resolveMarket(session, balances, 1);
    expect(() => executeTrade(res.session, res.balances, "alice", 0, 1)).toThrow(/already resolved/);
    expect(() => resolveMarket(res.session, res.balances, 0)).toThrow(/already resolved/);
    expect(() => grant(emptyBalances(), "x", 0)).toThrow(/positive/);
  });

  it("rejects a buy the user cannot afford", () => {
    const balances = grant(emptyBalances(), "alice", 1 * CREDITS);
    const session = openMarket("m5", 2, 100);
    expect(() => executeTrade(session, balances, "alice", 0, 500 * CREDITS)).toThrow(
      /insufficient funds/,
    );
  });
});

describe("market: full-session properties", () => {
  const USERS = ["u0", "u1", "u2"] as const;
  const GRANT_MICRO = 2000 * CREDITS;

  const arbSession = fc.record({
    n: fc.integer({ min: 2, max: 6 }),
    b: fc.double({ min: 10, max: 1000, noNaN: true }),
    actions: fc.array(
      fc.record({
        user: fc.nat({ max: USERS.length - 1 }),
        pick: fc.nat({ max: 1000 }),
        kind: fc.constantFrom("buy", "sell"),
        amt: fc.integer({ min: 1, max: 500_000_000 }),
      }),
      { maxLength: 30 },
    ),
    winnerPick: fc.nat({ max: 1000 }),
  });

  it("INV-CONSERVE, INV-ESCROW, INV-NOSHORT and the loss bound hold over arbitrary sessions", () => {
    fc.assert(
      fc.property(arbSession, ({ n, b, actions, winnerPick }) => {
        let session = openMarket("m", n, b);
        let balances: Balances = emptyBalances();
        for (const u of USERS) balances = grant(balances, u, GRANT_MICRO);

        for (const a of actions) {
          const uid = USERS[a.user]!;
          const i = a.pick % n;
          if (a.kind === "buy") {
            const budget = Math.min(a.amt, balanceOf(balances, userAccount(uid)));
            if (budget <= 0) continue;
            const delta = sharesForBudgetMicro(session.state, i, budget);
            if (delta <= 0) continue;
            ({ session, balances } = executeTrade(session, balances, uid, i, delta));
          } else {
            const held = positionOf(session, uid)[i]!;
            if (held <= 0) continue;
            ({ session, balances } = executeTrade(session, balances, uid, i, -Math.min(a.amt, held)));
          }
          expect(totalMicro(balances)).toBe(0);
          expect(balanceOf(balances, escrowAccount("m"))).toBeGreaterThanOrEqual(0);
          for (const u of USERS) {
            expect(balanceOf(balances, userAccount(u))).toBeGreaterThanOrEqual(0);
          }
          checkPositionsMatchOutstanding(session);
        }

        const res = resolveMarket(session, balances, winnerPick % n);
        expect(totalMicro(res.balances)).toBe(0);
        expect(balanceOf(res.balances, escrowAccount("m"))).toBe(0);
        const treasury = balanceOf(res.balances, TREASURY);
        const totalGranted = USERS.length * GRANT_MICRO;
        expect(treasury).toBeGreaterThanOrEqual(-totalGranted - worstCaseLossMicro(n, b) - 10);
        for (const u of USERS) {
          expect(balanceOf(res.balances, userAccount(u))).toBeGreaterThanOrEqual(0);
        }
      }),
      { numRuns: 60 },
    );
  });
});
