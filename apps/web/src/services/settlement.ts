import { and, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { accounts, journalEntries, memberships, postings, users } from "@/db/schema";
import { getLeaderboard } from "@/services/trading";

/**
 * Opt-in season settlement (D20, amends D14). The software never moves money:
 * it computes how a fixed reward pool would be split and exports a CSV the org
 * pays through its own payroll or rewards system.
 *
 * Rules: pay pro rata on *positive* season profit (net worth − credits
 * granted); no member receives more than `capShare` of the pool. Amounts
 * above the cap are NOT re-spread — that would pay weaker forecasters more
 * for others' accuracy and flatten payouts in small groups — they stay with
 * the org. Integer cents, floored, with rounding leftovers going to the
 * largest fractional remainders among uncapped members.
 */
export function allocatePool(
  profits: readonly { key: string; profitMicro: number }[],
  poolCents: number,
  capShare: number,
): Map<string, number> {
  if (!Number.isSafeInteger(poolCents) || poolCents < 0) throw new Error("pool must be a non-negative integer of cents");
  if (!(capShare > 0 && capShare <= 1)) throw new Error("cap share must be in (0, 1]");
  const capCents = Math.floor(poolCents * capShare);
  const eligible = profits.filter((p) => p.profitMicro > 0);
  const totalProfit = eligible.reduce((s, p) => s + p.profitMicro, 0);
  const out = new Map<string, number>();
  if (totalProfit === 0) return out;

  const exact = eligible.map((p) => ({ key: p.key, value: Math.min((poolCents * p.profitMicro) / totalProfit, capCents) }));
  let leftover = Math.floor(exact.reduce((s, e) => s + e.value, 0) + 1e-6);
  for (const e of exact) {
    const cents = Math.floor(e.value + 1e-9);
    out.set(e.key, cents);
    leftover -= cents;
  }
  const byRemainder = exact
    .filter((e) => e.value < capCents)
    .sort((a, b) => (b.value - Math.floor(b.value)) - (a.value - Math.floor(a.value)));
  for (const e of byRemainder) {
    if (leftover <= 0) break;
    out.set(e.key, (out.get(e.key) ?? 0) + 1);
    leftover -= 1;
  }
  return out;
}

export interface SettlementRow {
  membershipId: string;
  pseudonym: string;
  email: string;
  grantedMicro: number;
  netWorthMicro: number;
  profitMicro: number;
  payoutCents: number;
}

export async function computeSettlement(
  db: Db,
  orgId: string,
  params: { poolCents: number; capShare: number },
): Promise<{ rows: SettlementRow[]; allocatedCents: number; unallocatedCents: number }> {
  const board = await getLeaderboard(db, orgId);
  const rows: SettlementRow[] = [];
  for (const entry of board) {
    const [member] = await db
      .select({ email: users.email })
      .from(memberships)
      .innerJoin(users, eq(memberships.userId, users.id))
      .where(eq(memberships.id, entry.membershipId));
    const grants = await db
      .select({ amountMicro: postings.amountMicro })
      .from(postings)
      .innerJoin(journalEntries, eq(postings.entryId, journalEntries.id))
      .innerJoin(accounts, eq(postings.accountId, accounts.id))
      .where(
        and(
          eq(journalEntries.kind, "grant"),
          eq(accounts.orgId, orgId),
          eq(accounts.kind, "user"),
          eq(accounts.refId, entry.membershipId),
        ),
      );
    const grantedMicro = grants.reduce((s, g) => s + g.amountMicro, 0);
    rows.push({
      membershipId: entry.membershipId,
      pseudonym: entry.pseudonym,
      email: member?.email ?? "",
      grantedMicro,
      netWorthMicro: entry.netWorthMicro,
      profitMicro: entry.netWorthMicro - grantedMicro,
      payoutCents: 0,
    });
  }
  const allocation = allocatePool(
    rows.map((r) => ({ key: r.membershipId, profitMicro: r.profitMicro })),
    params.poolCents,
    params.capShare,
  );
  for (const row of rows) row.payoutCents = allocation.get(row.membershipId) ?? 0;
  rows.sort((a, b) => b.payoutCents - a.payoutCents || b.profitMicro - a.profitMicro);
  const allocatedCents = rows.reduce((s, r) => s + r.payoutCents, 0);
  return { rows, allocatedCents, unallocatedCents: params.poolCents - allocatedCents };
}

/** CSV for payroll: email + payout only — no trading history (see D20). */
export function settlementCsv(rows: readonly SettlementRow[]): string {
  const lines = ["email,payout"];
  for (const r of rows) {
    if (r.payoutCents <= 0) continue;
    lines.push(`${JSON.stringify(r.email)},${(r.payoutCents / 100).toFixed(2)}`);
  }
  return lines.join("\n") + "\n";
}
