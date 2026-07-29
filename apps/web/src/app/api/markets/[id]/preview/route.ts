import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { currentMember } from "@/lib/session";
import { previewTrade } from "@/services/trading";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const member = await currentMember();
  if (!member) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  const { id } = await ctx.params;
  const outcomeIdx = Number(req.nextUrl.searchParams.get("outcome"));
  const targetProb = Number(req.nextUrl.searchParams.get("target"));
  if (!Number.isInteger(outcomeIdx) || !(targetProb > 0 && targetProb < 1)) {
    return NextResponse.json({ error: "bad outcome/target" }, { status: 400 });
  }
  try {
    const db = await getDb();
    const preview = await previewTrade(db, {
      orgId: member.orgId,
      marketId: id,
      membershipId: member.membershipId,
      outcomeIdx,
      targetProb,
    });
    return NextResponse.json(preview);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "preview failed" }, { status: 400 });
  }
}
