import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { runTick } from "@/services/org";
import { announceResolution } from "@/services/slack/notify";

/**
 * Scheduled maintenance (D20): close expired markets, finalize undisputed
 * resolutions, pay weekly stipends. Idempotent — call it every few minutes
 * from any scheduler with the CRON_SECRET bearer token.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const db = await getDb();
  const result = await runTick(db);
  for (const f of result.finalized) {
    await announceResolution(db, f.orgId, f.marketId, f.settlement.totalPayoutMicro, f.settlement.winnerCount);
  }
  return NextResponse.json({
    closed: result.closed,
    finalized: result.finalized.map((f) => f.marketId),
    stipendsPaid: result.stipendsPaid,
  });
}

export const GET = POST;
