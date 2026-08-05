import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db";
import { currentMember } from "@/lib/session";
import { createMarketTx } from "@/services/trading";
import { announceMarket } from "@/services/slack/notify";
import { checkGuardrails } from "@/services/ai/guardrails";

const bodySchema = z.object({
  question: z.string().min(10),
  description: z.string().default(""),
  resolutionCriteria: z.string().min(10),
  resolutionSource: z.string().min(3),
  closeAtIso: z.string(),
  outcomes: z.array(z.string()).min(2).max(10),
  liquidityB: z.number().refine((b) => [50, 100, 250].includes(b)),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  const member = await currentMember();
  if (!member || member.role !== "admin") {
    return NextResponse.json({ error: "admin only" }, { status: 403 });
  }
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "bad request" }, { status: 400 });
  }
  // Defense in depth: the guardrail filter runs again at publish time, so a
  // tampered client can't push a blocked draft through (D19).
  const violations = checkGuardrails(parsed.data, new Date());
  if (violations.length > 0) {
    return NextResponse.json({ error: violations.join("; ") }, { status: 422 });
  }
  const db = await getDb();
  const marketId = await createMarketTx(db, {
    orgId: member.orgId,
    question: parsed.data.question,
    description: parsed.data.description,
    resolutionCriteria: parsed.data.resolutionCriteria,
    resolutionSource: parsed.data.resolutionSource,
    liquidityB: parsed.data.liquidityB,
    closeAt: new Date(parsed.data.closeAtIso),
    createdBy: member.membershipId,
    outcomeLabels: parsed.data.outcomes,
  });
  await announceMarket(db, member.orgId, marketId);
  return NextResponse.json({ marketId });
}
