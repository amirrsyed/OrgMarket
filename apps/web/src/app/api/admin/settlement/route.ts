import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { currentMember } from "@/lib/session";
import { computeSettlement, settlementCsv } from "@/services/settlement";

/** CSV export of a season settlement (D20). Admin-only; requires acknowledgement. */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const member = await currentMember();
  if (!member || member.role !== "admin") {
    return NextResponse.json({ error: "admin only" }, { status: 403 });
  }
  const q = req.nextUrl.searchParams;
  if (q.get("ack") !== "1") {
    return NextResponse.json({ error: "acknowledge the legal review first" }, { status: 400 });
  }
  const poolDollars = Number(q.get("pool"));
  const capPct = Number(q.get("cap") ?? "25");
  if (!(poolDollars >= 0) || !(capPct > 0 && capPct <= 100)) {
    return NextResponse.json({ error: "bad pool or cap" }, { status: 400 });
  }
  const db = await getDb();
  const { rows } = await computeSettlement(db, member.orgId, {
    poolCents: Math.round(poolDollars * 100),
    capShare: capPct / 100,
  });
  return new NextResponse(settlementCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="orgmarket-settlement-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
