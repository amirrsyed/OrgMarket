import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db";
import { currentMember } from "@/lib/session";
import { getMarket } from "@/services/trading";
import { isAiConfigured } from "@/services/ai/client";
import { checkResolutionEvidence } from "@/services/ai/resolution";

const bodySchema = z.object({ evidence: z.string().min(10, "paste the evidence first") });

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const member = await currentMember();
  if (!member || member.role !== "admin") {
    return NextResponse.json({ error: "admin only" }, { status: 403 });
  }
  if (!isAiConfigured()) {
    return NextResponse.json({ error: "AI is not configured (set ANTHROPIC_API_KEY)" }, { status: 501 });
  }
  const { id } = await ctx.params;
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "bad request" }, { status: 400 });
  }
  const db = await getDb();
  const market = await getMarket(db, member.orgId, id);
  if (!market) return NextResponse.json({ error: "market not found" }, { status: 404 });
  try {
    const labels = market.outcomes.map((o) => o.label);
    const check = await checkResolutionEvidence({
      question: market.question,
      resolutionCriteria: market.resolutionCriteria,
      resolutionSource: market.resolutionSource,
      outcomes: labels,
      evidence: parsed.data.evidence,
    });
    const recommendedOutcomeIdx = check.recommendedOutcome
      ? labels.findIndex((l) => l.toLowerCase() === check.recommendedOutcome!.toLowerCase())
      : -1;
    return NextResponse.json({
      ...check,
      recommendedOutcomeIdx: recommendedOutcomeIdx >= 0 ? recommendedOutcomeIdx : null,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "check failed" },
      { status: 502 },
    );
  }
}
