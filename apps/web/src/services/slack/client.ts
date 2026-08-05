import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import { slackConnections } from "@/db/schema";

/**
 * Thin Slack surface the app depends on — implemented over fetch in
 * production, and by a recording fake in tests. No Slack SDK (D18).
 */
export interface SlackClient {
  postMessage(channel: string, text: string, blocks?: unknown[]): Promise<void>;
  /** POST to an interaction's response_url (ephemeral replies, message updates). */
  respond(responseUrl: string, payload: Record<string, unknown>): Promise<void>;
  /** Workspace-verified email for a Slack user, or null. */
  userEmail(slackUserId: string): Promise<string | null>;
}

export interface SlackConfig {
  orgId: string;
  teamId: string | null;
  botToken: string;
  channelId: string;
}

/**
 * Per-org connection from the DB, falling back to env vars for local dev
 * (SLACK_BOT_TOKEN, SLACK_CHANNEL_ID, optional SLACK_ORG_ID/SLACK_TEAM_ID).
 */
export async function getSlackConfig(db: Db, orgId: string): Promise<SlackConfig | null> {
  const [row] = await db.select().from(slackConnections).where(eq(slackConnections.orgId, orgId));
  if (row) return { orgId: row.orgId, teamId: row.teamId, botToken: row.botToken, channelId: row.channelId };
  if (process.env.SLACK_BOT_TOKEN && process.env.SLACK_CHANNEL_ID) {
    const envOrg = process.env.SLACK_ORG_ID ?? "org-meridian";
    if (envOrg === orgId) {
      return {
        orgId,
        teamId: process.env.SLACK_TEAM_ID ?? null,
        botToken: process.env.SLACK_BOT_TOKEN,
        channelId: process.env.SLACK_CHANNEL_ID,
      };
    }
  }
  return null;
}

/** The org a Slack workspace maps to (inverse of getSlackConfig). */
export async function orgForTeam(db: Db, teamId: string): Promise<SlackConfig | null> {
  const [row] = await db.select().from(slackConnections).where(eq(slackConnections.teamId, teamId));
  if (row) return { orgId: row.orgId, teamId: row.teamId, botToken: row.botToken, channelId: row.channelId };
  if (process.env.SLACK_BOT_TOKEN && process.env.SLACK_CHANNEL_ID) {
    if (!process.env.SLACK_TEAM_ID || process.env.SLACK_TEAM_ID === teamId) {
      return {
        orgId: process.env.SLACK_ORG_ID ?? "org-meridian",
        teamId,
        botToken: process.env.SLACK_BOT_TOKEN,
        channelId: process.env.SLACK_CHANNEL_ID,
      };
    }
  }
  return null;
}

export class WebSlackClient implements SlackClient {
  constructor(private readonly botToken: string) {}

  private async api(method: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const res = await fetch(`https://slack.com/api/${method}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Authorization: `Bearer ${this.botToken}`,
      },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as Record<string, unknown>;
    if (!json.ok) {
      throw new Error(`Slack ${method} failed: ${String(json.error ?? "unknown")}`);
    }
    return json;
  }

  async postMessage(channel: string, text: string, blocks?: unknown[]): Promise<void> {
    await this.api("chat.postMessage", { channel, text, ...(blocks ? { blocks } : {}) });
  }

  async respond(responseUrl: string, payload: Record<string, unknown>): Promise<void> {
    const res = await fetch(responseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`Slack response_url POST failed: ${res.status}`);
  }

  async userEmail(slackUserId: string): Promise<string | null> {
    try {
      const res = await fetch(
        `https://slack.com/api/users.info?user=${encodeURIComponent(slackUserId)}`,
        { headers: { Authorization: `Bearer ${this.botToken}` } },
      );
      const json = (await res.json()) as {
        ok: boolean;
        user?: { profile?: { email?: string } };
      };
      return json.ok ? (json.user?.profile?.email ?? null) : null;
    } catch {
      return null;
    }
  }
}
