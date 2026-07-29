/**
 * INV-MICRO: every ledger amount is an integer number of micro-credits.
 * 1 org-dollar (₥, "credit") = 1,000,000 micro-credits.
 * Probabilities/prices are floats for display only and never enter the ledger.
 */
export const MICRO_PER_CREDIT = 1_000_000;

export function assertMicroInt(amount: number, label = "amount"): void {
  if (!Number.isSafeInteger(amount)) {
    throw new Error(`${label} must be a safe integer of micro-credits, got ${amount}`);
  }
}

export function creditsToMicro(credits: number): number {
  const micro = Math.round(credits * MICRO_PER_CREDIT);
  assertMicroInt(micro, `credits value ${credits} in micro`);
  return micro;
}

export function microToCredits(micro: number): number {
  assertMicroInt(micro);
  return micro / MICRO_PER_CREDIT;
}

/** "1234567" micro → "1.23" (₥, two decimals, for UI). */
export function formatCredits(micro: number): string {
  assertMicroInt(micro);
  return (micro / MICRO_PER_CREDIT).toFixed(2);
}
