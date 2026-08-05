import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { verifySlackSignature } from "@/services/slack/verify";
import { WebSlackClient, orgForTeam } from "@/services/slack/client";
import { handleTap, type BlockActionPayload } from "@/services/slack/interactions";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const rawBody = await req.text();
  const secret = process.env.SLACK_SIGNING_SECRET;
  if (!secret) return NextResponse.json({ error: "slack not configured" }, { status: 501 });
  const ok = verifySlackSignature({
    signingSecret: secret,
    timestamp: req.headers.get("x-slack-request-timestamp"),
    signature: req.headers.get("x-slack-signature"),
    rawBody,
  });
  if (!ok) return NextResponse.json({ error: "bad signature" }, { status: 401 });

  const payload = JSON.parse(
    new URLSearchParams(rawBody).get("payload") ?? "{}",
  ) as BlockActionPayload;
  if (payload.type !== "block_actions" || !payload.team?.id || !payload.response_url) {
    return new NextResponse(null, { status: 200 });
  }
  // Link buttons carry no work; only tap:* actions do.
  if (!payload.actions?.some((a) => a.action_id.startsWith("tap:"))) {
    return new NextResponse(null, { status: 200 });
  }
  const db = await getDb();
  const config = await orgForTeam(db, payload.team.id);
  if (!config) return new NextResponse(null, { status: 200 });
  const client = new WebSlackClient(config.botToken);
  const result = await handleTap(db, client, config.orgId, payload);
  if (result.updatedBlocks) {
    await client
      .respond(payload.response_url, {
        replace_original: true,
        blocks: result.updatedBlocks,
        text: "Market updated",
      })
      .catch(() => undefined);
  }
  await client
    .respond(payload.response_url, {
      response_type: "ephemeral",
      replace_original: false,
      text: result.ephemeralText,
    })
    .catch(() => undefined);
  return new NextResponse(null, { status: 200 });
}
