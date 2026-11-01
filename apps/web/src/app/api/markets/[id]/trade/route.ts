import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db";
import { currentMember } from "@/lib/session";
import { executeTradeTx } from "@/services/trading";

const bodySchema = z.object({
  outcomeIdx: z.number().int().min(0),
  deltaMicroShares: z.number().int(),
  idempotencyKey: z.string().min(8),
  rationale: z.string().max(280).optional(),
});

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const member = await currentMember();
  if (!member) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  const { id } = await ctx.params;
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "bad request" }, { status: 400 });
  }
  try {
    const db = await getDb();
    const result = await executeTradeTx(db, {
      orgId: member.orgId,
      marketId: id,
      membershipId: member.membershipId,
      outcomeIdx: parsed.data.outcomeIdx,
      deltaMicroShares: parsed.data.deltaMicroShares,
      idempotencyKey: parsed.data.idempotencyKey,
      ...(parsed.data.rationale ? { rationale: parsed.data.rationale } : {}),
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "trade failed" }, { status: 400 });
  }
}
