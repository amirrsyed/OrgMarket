import { createHash } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { journalEntries, ledgerHeads, postings } from "@/db/schema";

/**
 * Tamper-evident ledger (D20): journal entries form a per-org hash chain.
 * Rewriting, deleting, or reordering any historical entry changes every hash
 * after it, so a published chain head lets anyone detect a rewrite.
 */

export function genesisHash(orgId: string): string {
  return createHash("sha256").update(`orgmarket-genesis:${orgId}`).digest("hex");
}

export interface ChainEntryInput {
  seq: number;
  prevHash: string;
  orgId: string;
  entryId: string;
  kind: string;
  createdAtIso: string;
  postings: readonly { accountId: string; amountMicro: number }[];
}

/** Deterministic serialization: postings sorted, fixed field order. */
export function canonicalEntry(e: ChainEntryInput): string {
  const sortedPostings = [...e.postings]
    .map((p) => [p.accountId, p.amountMicro] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1]));
  return JSON.stringify([e.seq, e.prevHash, e.orgId, e.entryId, e.kind, e.createdAtIso, sortedPostings]);
}

export function entryHash(e: ChainEntryInput): string {
  return createHash("sha256").update(canonicalEntry(e)).digest("hex");
}

export interface ChainVerification {
  ok: boolean;
  entries: number;
  headHash: string;
  /** First seq whose stored hash or link doesn't recompute, if any. */
  brokenAtSeq: number | null;
}

/** Recompute the whole chain for an org from stored entries and postings. */
export async function verifyLedgerChain(db: Db, orgId: string): Promise<ChainVerification> {
  const entries = await db
    .select()
    .from(journalEntries)
    .where(eq(journalEntries.orgId, orgId))
    .orderBy(asc(journalEntries.seq));
  let prev = genesisHash(orgId);
  let expectedSeq = 1;
  for (const entry of entries) {
    const entryPostings = await db
      .select({ accountId: postings.accountId, amountMicro: postings.amountMicro })
      .from(postings)
      .where(eq(postings.entryId, entry.id));
    const recomputed = entryHash({
      seq: entry.seq,
      prevHash: entry.prevHash,
      orgId,
      entryId: entry.id,
      kind: entry.kind,
      createdAtIso: entry.createdAt.toISOString(),
      postings: entryPostings,
    });
    if (entry.seq !== expectedSeq || entry.prevHash !== prev || entry.hash !== recomputed) {
      return { ok: false, entries: entries.length, headHash: prev, brokenAtSeq: entry.seq };
    }
    prev = entry.hash;
    expectedSeq += 1;
  }
  const [head] = await db.select().from(ledgerHeads).where(and(eq(ledgerHeads.orgId, orgId)));
  if (head && (head.headHash !== prev || head.seq !== entries.length)) {
    return { ok: false, entries: entries.length, headHash: prev, brokenAtSeq: head.seq };
  }
  return { ok: true, entries: entries.length, headHash: prev, brokenAtSeq: null };
}
