import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { verifySlackSignature } from "@/services/slack/verify";
import { WebSlackClient, orgForTeam } from "@/services/slack/client";
import { handleCommand } from "@/services/slack/commands";

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

  const form = new URLSearchParams(rawBody);
  const teamId = form.get("team_id");
  const slackUserId = form.get("user_id");
  if (!teamId || !slackUserId) return new NextResponse(null, { status: 200 });
  const db = await getDb();
  const config = await orgForTeam(db, teamId);
  if (!config) {
    return NextResponse.json({
      response_type: "ephemeral",
      text: "This workspace isn't connected to an OrgMarket org.",
    });
  }
  const client = new WebSlackClient(config.botToken);
  const result = await handleCommand(db, client, config.orgId, config.channelId, {
    text: form.get("text") ?? "",
    slackUserId,
  });
  return NextResponse.json(result);
}
