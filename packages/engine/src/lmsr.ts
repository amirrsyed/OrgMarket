import { MICRO_PER_CREDIT, assertMicroInt } from "./money";

/**
 * Hanson's Logarithmic Market Scoring Rule.
 *
 * Quantities are integer micro-shares (1 micro-share pays 1 micro-credit if its
 * outcome wins). All cost math runs in floats internally (log-sum-exp for
 * stability); conversion to ledger amounts happens only in tradeCostMicro, where
 * rounding always favors the house (INV-ROUND).
 */
export interface LmsrState {
  /** Liquidity parameter in credits. Worst-case operator loss is b·ln(n). */
  readonly b: number;
  /** Outstanding micro-shares per outcome. Never negative (INV-NOSHORT). */
  readonly q: readonly number[];
}

export function createMarket(numOutcomes: number, liquidityCredits: number): LmsrState {
  if (!Number.isInteger(numOutcomes) || numOutcomes < 2) {
    throw new Error(`numOutcomes must be an integer >= 2, got ${numOutcomes}`);
  }
  if (!Number.isFinite(liquidityCredits) || liquidityCredits <= 0) {
    throw new Error(`liquidityCredits must be a positive finite number, got ${liquidityCredits}`);
  }
  return { b: liquidityCredits, q: Object.freeze(new Array<number>(numOutcomes).fill(0)) };
}

export function logSumExp(xs: readonly number[]): number {
  let max = -Infinity;
  for (const x of xs) if (x > max) max = x;
  if (!Number.isFinite(max)) return max;
  let sum = 0;
  for (const x of xs) sum += Math.exp(x - max);
  return max + Math.log(sum);
}

function checkOutcome(state: LmsrState, outcome: number): void {
  if (!Number.isInteger(outcome) || outcome < 0 || outcome >= state.q.length) {
    throw new Error(`outcome index ${outcome} out of range [0, ${state.q.length})`);
  }
}

/** Exponent terms q_i/b with q converted from micro-shares to shares. */
function exponents(state: LmsrState): number[] {
  return state.q.map((qi) => qi / MICRO_PER_CREDIT / state.b);
}

/** C(q) = b · ln(Σ e^{q_i/b}), in credits (float). */
export function cost(state: LmsrState): number {
  return state.b * logSumExp(exponents(state));
}

/**
 * Instantaneous probabilities. Floats in (0, 1] summing to ~1. Display only.
 * A price equals exactly 1 (or 0) only when the true value is beyond float64
 * precision (exponent gap > ~36); UIs must clamp displayed probabilities so an
 * open market never shows 100% (D17). Softmax normalization guarantees p <= 1.
 */
export function prices(state: LmsrState): number[] {
  const xs = exponents(state);
  let max = -Infinity;
  for (const x of xs) if (x > max) max = x;
  const es = xs.map((x) => Math.exp(x - max));
  let sum = 0;
  for (const e of es) sum += e;
  return es.map((e) => e / sum);
}

/**
 * Cost in micro-credits of trading deltaMicroShares of an outcome.
 * Positive = trader pays; negative = trader receives (a sale).
 * INV-ROUND: ceil overall, min +1 micro on any real buy, capped at 0 on any sale,
 * so float noise can never pay a buyer or charge a seller.
 */
export function tradeCostMicro(state: LmsrState, outcome: number, deltaMicroShares: number): number {
  checkOutcome(state, outcome);
  assertMicroInt(deltaMicroShares, "deltaMicroShares");
  if (deltaMicroShares === 0) return 0;
  const qi = state.q[outcome]!;
  if (qi + deltaMicroShares < 0) {
    throw new Error(
      `trade would take outstanding shares of outcome ${outcome} below zero (${qi} + ${deltaMicroShares})`,
    );
  }
  const after: LmsrState = {
    b: state.b,
    q: state.q.map((v, i) => (i === outcome ? v + deltaMicroShares : v)),
  };
  const raw = Math.ceil((cost(after) - cost(state)) * MICRO_PER_CREDIT);
  return deltaMicroShares > 0 ? Math.max(1, raw) : Math.min(0, raw);
}

export function applyTrade(
  state: LmsrState,
  outcome: number,
  deltaMicroShares: number,
): { state: LmsrState; costMicro: number } {
  const costMicro = tradeCostMicro(state, outcome, deltaMicroShares);
  const next: LmsrState = {
    b: state.b,
    q: state.q.map((v, i) => (i === outcome ? v + deltaMicroShares : v)),
  };
  return { state: next, costMicro };
}

/**
 * Micro-shares to trade so the outcome's price lands on targetProbability —
 * the primitive behind the forecast slider. Truncated toward zero, and clamped
 * so outstanding shares stay >= 0 (a caller selling further needs shorting,
 * which v1 forbids).
 */
export function sharesToMovePrice(state: LmsrState, outcome: number, targetProbability: number): number {
  checkOutcome(state, outcome);
  if (!(targetProbability > 0 && targetProbability < 1)) {
    throw new Error(`targetProbability must be in (0,1), got ${targetProbability}`);
  }
  const xs = exponents(state);
  const lseOthers = logSumExp(xs.filter((_, i) => i !== outcome));
  const targetX = Math.log(targetProbability / (1 - targetProbability)) + lseOthers;
  const qi = state.q[outcome]!;
  const deltaShares = state.b * targetX - qi / MICRO_PER_CREDIT;
  const deltaMicro = Math.trunc(deltaShares * MICRO_PER_CREDIT);
  return Math.max(deltaMicro, -qi);
}

/**
 * Largest number of micro-shares of an outcome purchasable for budgetMicro.
 * Closed form via the inverse cost function, floored, then walked back a few
 * micro-shares if float error overshot: the result is always affordable.
 */
export function sharesForBudgetMicro(state: LmsrState, outcome: number, budgetMicro: number): number {
  checkOutcome(state, outcome);
  assertMicroInt(budgetMicro, "budgetMicro");
  if (budgetMicro < 0) throw new Error(`budgetMicro must be >= 0, got ${budgetMicro}`);
  if (budgetMicro === 0) return 0;
  const xs = exponents(state);
  const lseAll = logSumExp(xs);
  const lseOthers = logSumExp(xs.filter((_, i) => i !== outcome));
  // Solve C(q + δ·e_i) = C(q) + m  ⇒  e^{x_new} = e^{lseAll + m/b} − e^{lseOthers}
  const x = lseAll + budgetMicro / MICRO_PER_CREDIT / state.b;
  const xNew = x + Math.log1p(-Math.exp(lseOthers - x));
  const qi = state.q[outcome]!;
  let deltaMicro = Math.floor((state.b * xNew - qi / MICRO_PER_CREDIT) * MICRO_PER_CREDIT);
  if (deltaMicro <= 0) return 0;
  let guard = 0;
  while (deltaMicro > 0 && tradeCostMicro(state, outcome, deltaMicro) > budgetMicro) {
    deltaMicro -= 1;
    if (++guard > 10_000) {
      throw new Error("sharesForBudgetMicro failed to converge — numerical assumptions violated");
    }
  }
  return Math.max(0, deltaMicro);
}

/** Operator's worst-case subsidy for a market: b·ln(n), in micro-credits (ceil). */
export function worstCaseLossMicro(numOutcomes: number, liquidityCredits: number): number {
  if (!Number.isInteger(numOutcomes) || numOutcomes < 2) {
    throw new Error(`numOutcomes must be an integer >= 2, got ${numOutcomes}`);
  }
  return Math.ceil(liquidityCredits * Math.log(numOutcomes) * MICRO_PER_CREDIT);
}
