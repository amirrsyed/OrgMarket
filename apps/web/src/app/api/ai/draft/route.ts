import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { currentMember } from "@/lib/session";
import { isAiConfigured } from "@/services/ai/client";
import { draftMarketsFromDocument } from "@/services/ai/drafts";

const bodySchema = z.object({ document: z.string().min(40, "paste a real planning document") });

export async function POST(req: NextRequest): Promise<NextResponse> {
  const member = await currentMember();
  if (!member || member.role !== "admin") {
    return NextResponse.json({ error: "admin only" }, { status: 403 });
  }
  if (!isAiConfigured()) {
    return NextResponse.json({ error: "AI is not configured (set ANTHROPIC_API_KEY)" }, { status: 501 });
  }
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "bad request" }, { status: 400 });
  }
  try {
    const drafts = await draftMarketsFromDocument(parsed.data.document);
    return NextResponse.json({ drafts });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "drafting failed" },
      { status: 502 },
    );
  }
}
