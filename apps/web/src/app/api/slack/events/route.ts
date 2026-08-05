import { NextRequest, NextResponse } from "next/server";
import { verifySlackSignature } from "@/services/slack/verify";

/**
 * Events API endpoint. v0.1 only answers Slack's url_verification challenge
 * (required to install the app); event subscriptions come with later phases.
 */
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
  const body = JSON.parse(rawBody) as { type?: string; challenge?: string };
  if (body.type === "url_verification" && body.challenge) {
    return NextResponse.json({ challenge: body.challenge });
  }
  return new NextResponse(null, { status: 200 });
}
