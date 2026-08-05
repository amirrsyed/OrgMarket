import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db";
import { currentMember } from "@/lib/session";
import { isAiConfigured } from "@/services/ai/client";
import { generateLeadershipMemo } from "@/services/ai/memo";
import { WebSlackClient, getSlackConfig } from "@/services/slack/client";

const bodySchema = z.object({
  /** When set with `post: true`, posts this already-generated memo to Slack. */
  memo: z.string().optional(),
  post: z.boolean().default(false),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  const member = await currentMember();
  if (!member || member.role !== "admin") {
    return NextResponse.json({ error: "admin only" }, { status: 403 });
  }
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  const db = await getDb();

  if (parsed.data.post && parsed.data.memo) {
    const config = await getSlackConfig(db, member.orgId);
    if (!config) {
      return NextResponse.json({ error: "Slack is not connected for this org" }, { status: 501 });
    }
    await new WebSlackClient(config.botToken).postMessage(config.channelId, parsed.data.memo);
    return NextResponse.json({ posted: true });
  }

  if (!isAiConfigured()) {
    return NextResponse.json({ error: "AI is not configured (set ANTHROPIC_API_KEY)" }, { status: 501 });
  }
  try {
    const memo = await generateLeadershipMemo(db, member.orgId);
    return NextResponse.json({ memo });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "memo generation failed" },
      { status: 502 },
    );
  }
}
