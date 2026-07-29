import { assertMicroInt } from "./money.js";

/**
 * Double-entry ledger over immutable balance maps.
 * INV-CONSERVE: every entry's postings sum to exactly 0, so the total of all
 * balances is invariant (0 for a ledger that started empty).
 */
export type AccountId = string;
export type Balances = ReadonlyMap<AccountId, number>;

export interface Posting {
  readonly account: AccountId;
  readonly amountMicro: number;
}

export function emptyBalances(): Balances {
  return new Map();
}

export function balanceOf(balances: Balances, account: AccountId): number {
  return balances.get(account) ?? 0;
}

export function totalMicro(balances: Balances): number {
  let total = 0;
  for (const v of balances.values()) total += v;
  return total;
}

/**
 * Apply one balanced journal entry. Throws (leaving balances untouched) if the
 * entry doesn't sum to zero, any amount is non-integer, or any account outside
 * allowNegative would end below zero.
 */
export function postEntry(
  balances: Balances,
  postings: readonly Posting[],
  allowNegative: ReadonlySet<AccountId> = new Set(),
): Balances {
  if (postings.length < 2) {
    throw new Error(`a journal entry needs at least two postings, got ${postings.length}`);
  }
  let sum = 0;
  for (const p of postings) {
    assertMicroInt(p.amountMicro, `posting to ${p.account}`);
    sum += p.amountMicro;
  }
  if (sum !== 0) {
    throw new Error(`journal entry does not balance: postings sum to ${sum} micro, not 0`);
  }
  const next = new Map(balances);
  for (const p of postings) {
    next.set(p.account, (next.get(p.account) ?? 0) + p.amountMicro);
  }
  for (const p of postings) {
    const bal = next.get(p.account)!;
    if (bal < 0 && !allowNegative.has(p.account)) {
      throw new Error(`insufficient funds: ${p.account} would end at ${bal} micro`);
    }
  }
  return next;
}
