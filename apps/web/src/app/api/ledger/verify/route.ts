import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { currentMember } from "@/lib/session";
import { verifyLedgerChain } from "@/services/ledger-chain";

/**
 * Any member can recompute their org's ledger hash chain (D20). Publishing
 * the returned head hash (e.g. in the weekly digest) lets anyone later prove
 * history was not rewritten.
 */
export async function GET(): Promise<NextResponse> {
  const member = await currentMember();
  if (!member) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  const db = await getDb();
  return NextResponse.json(await verifyLedgerChain(db, member.orgId));
}
