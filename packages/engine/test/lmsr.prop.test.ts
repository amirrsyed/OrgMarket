import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  type LmsrState,
  applyTrade,
  cost,
  createMarket,
  prices,
  sharesForBudgetMicro,
  sharesToMovePrice,
  tradeCostMicro,
  worstCaseLossMicro,
} from "../src/lmsr";

const arbParams = fc.record({
  n: fc.integer({ min: 2, max: 8 }),
  b: fc.double({ min: 5, max: 5000, noNaN: true }),
});

/** Random reachable state: a market plus a fold of random buys and valid sells. */
const arbSeededMarket = fc
  .record({
    params: arbParams,
    trades: fc.array(
      fc.record({
        pick: fc.nat({ max: 1000 }),
        amt: fc.integer({ min: 1, max: 80_000_000 }),
        isSell: fc.boolean(),
      }),
      { maxLength: 25 },
    ),
  })
  .map(({ params, trades }) => {
    let state = createMarket(params.n, params.b);
    let collectedMicro = 0;
    for (const t of trades) {
      const i = t.pick % params.n;
      const qi = state.q[i]!;
      const delta = t.isSell ? -Math.min(t.amt, qi) : t.amt;
      if (delta === 0) continue;
      const r = applyTrade(state, i, delta);
      state = r.state;
      collectedMicro += r.costMicro;
    }
    return { state, collectedMicro };
  });

describe("LMSR properties", () => {
  it("prices are in (0,1] and sum to 1 (D17: exactly 1 only beyond float64 precision)", () => {
    fc.assert(
      fc.property(arbSeededMarket, ({ state }) => {
        const p = prices(state);
        let sum = 0;
        for (const pi of p) {
          expect(pi).toBeGreaterThan(0);
          expect(pi).toBeLessThanOrEqual(1);
          expect(Number.isFinite(pi)).toBe(true);
          sum += pi;
        }
        expect(Math.abs(sum - 1)).toBeLessThan(1e-9);
      }),
    );
  });

  it("prices stay strictly inside (0,1) while the exponent gap is representable", () => {
    // Gap of 20: true losing price ≈ 2e-9, comfortably within float64.
    let state = createMarket(2, 100);
    state = applyTrade(state, 0, 2_000_000_000).state; // 2000 shares at b=100
    const p = prices(state);
    expect(p[0]!).toBeLessThan(1);
    expect(p[0]!).toBeGreaterThan(0.999999);
    expect(p[1]!).toBeGreaterThan(0);
  });

  it("every real buy costs at least 1 micro; every sale pays out (cost <= 0)", () => {
    fc.assert(
      fc.property(
        arbSeededMarket,
        fc.nat({ max: 1000 }),
        fc.integer({ min: 1, max: 50_000_000 }),
        ({ state }, pick, amt) => {
          const i = pick % state.q.length;
          expect(tradeCostMicro(state, i, amt)).toBeGreaterThanOrEqual(1);
          const qi = state.q[i]!;
          if (qi > 0) {
            expect(tradeCostMicro(state, i, -Math.min(amt, qi))).toBeLessThanOrEqual(0);
          }
        },
      ),
    );
  });

  it("buy-then-sell round trips never profit the trader", () => {
    fc.assert(
      fc.property(
        arbSeededMarket,
        fc.nat({ max: 1000 }),
        fc.integer({ min: 1, max: 50_000_000 }),
        ({ state }, pick, amt) => {
          const i = pick % state.q.length;
          const buy = applyTrade(state, i, amt);
          const sellCost = tradeCostMicro(buy.state, i, -amt);
          expect(buy.costMicro + sellCost).toBeGreaterThanOrEqual(0);
        },
      ),
    );
  });

  it("splitting a buy in two costs the same to within rounding (path independence)", () => {
    fc.assert(
      fc.property(
        arbSeededMarket,
        fc.nat({ max: 1000 }),
        fc.integer({ min: 1, max: 50_000_000 }),
        fc.integer({ min: 1, max: 50_000_000 }),
        ({ state }, pick, a, b) => {
          const i = pick % state.q.length;
          const first = applyTrade(state, i, a);
          const second = tradeCostMicro(first.state, i, b);
          const combined = tradeCostMicro(state, i, a + b);
          expect(Math.abs(first.costMicro + second - combined)).toBeLessThanOrEqual(3);
        },
      ),
    );
  });

  it("house loss after resolution is bounded by b·ln(n) for every outcome", () => {
    fc.assert(
      fc.property(arbSeededMarket, ({ state, collectedMicro }) => {
        const bound = worstCaseLossMicro(state.q.length, state.b);
        for (let w = 0; w < state.q.length; w++) {
          const pnl = collectedMicro - state.q[w]!;
          expect(pnl).toBeGreaterThanOrEqual(-(bound + 10));
        }
      }),
    );
  });

  it("sharesToMovePrice lands the price on the target", () => {
    fc.assert(
      fc.property(
        arbSeededMarket,
        fc.nat({ max: 1000 }),
        fc.double({ min: 0.02, max: 0.98, noNaN: true }),
        ({ state }, pick, target) => {
          const i = pick % state.q.length;
          const delta = sharesToMovePrice(state, i, target);
          fc.pre(delta !== -state.q[i]!); // clamped sells can't reach the target
          const after = applyTrade(state, i, delta).state;
          expect(Math.abs(prices(after)[i]! - target)).toBeLessThan(1e-5);
        },
      ),
    );
  });

  it("sharesForBudgetMicro is affordable and spends the budget to within 10 micro", () => {
    fc.assert(
      fc.property(
        arbSeededMarket,
        fc.nat({ max: 1000 }),
        fc.integer({ min: 1, max: 500_000_000 }),
        ({ state }, pick, budget) => {
          const i = pick % state.q.length;
          const delta = sharesForBudgetMicro(state, i, budget);
          expect(delta).toBeGreaterThanOrEqual(0);
          if (delta > 0) {
            const costMicro = tradeCostMicro(state, i, delta);
            expect(costMicro).toBeLessThanOrEqual(budget);
            expect(budget - costMicro).toBeLessThanOrEqual(10);
          }
        },
      ),
    );
  });
});

describe("LMSR numerical stability", () => {
  it("keeps prices strictly positive in a heavily one-sided market", () => {
    let state: LmsrState = createMarket(2, 10);
    state = applyTrade(state, 0, 1_000_000_000).state; // 1000 shares on outcome 0, b=10
    const p = prices(state);
    expect(p[0]!).toBeGreaterThan(0.999);
    expect(p[1]!).toBeGreaterThan(0); // e^-100 ≈ 3.7e-44, representable
    expect(Math.abs(p[0]! + p[1]! - 1)).toBeLessThan(1e-9);
    expect(Number.isFinite(cost(state))).toBe(true);
    expect(tradeCostMicro(state, 1, 1_000_000)).toBeGreaterThanOrEqual(1);
  });

  it("stays finite and never gives shares away even when a price underflows to 0", () => {
    // e^-100000 is below the smallest subnormal double: the losing price
    // legitimately displays as 0, but the machine must not break or leak money.
    let state: LmsrState = createMarket(2, 10);
    state = applyTrade(state, 0, 1_000_000_000_000).state; // 1M shares on outcome 0, b=10
    const p = prices(state);
    expect(p[0]!).toBeGreaterThan(0.999);
    expect(p[1]!).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(p[1]!)).toBe(true);
    expect(Math.abs(p[0]! + p[1]! - 1)).toBeLessThan(1e-9);
    expect(Number.isFinite(cost(state))).toBe(true);
    expect(tradeCostMicro(state, 1, 1_000_000)).toBeGreaterThanOrEqual(1);
  });
});
