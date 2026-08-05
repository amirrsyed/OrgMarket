import { and, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { memberships, users } from "@/db/schema";
import { executeTradeTx, getMarket, previewTrade } from "@/services/trading";
import { formatMoney, formatPct, formatShares } from "@/lib/format";
import type { SlackClient } from "./client";
import { TAP_MAX_SPEND_MICRO, marketAnnouncementBlocks } from "./blocks";

/**
 * Slack user → membership, by cached mapping first, else workspace-verified
 * email against users.email (then cache). Returns null when no account
 * matches — Slack identity never creates accounts on its own (D18).
 */
export async function resolveMembership(
  db: Db,
  client: SlackClient,
  orgId: string,
  slackUserId: string,
): Promise<{ membershipId: string; pseudonym: string } | null> {
  const [cached] = await db
    .select({ membershipId: memberships.id, pseudonym: memberships.pseudonym })
    .from(memberships)
    .where(and(eq(memberships.orgId, orgId), eq(memberships.slackUserId, slackUserId)));
  if (cached) return cached;
  const email = await client.userEmail(slackUserId);
  if (!email) return null;
  const [match] = await db
    .select({ membershipId: memberships.id, pseudonym: memberships.pseudonym })
    .from(memberships)
    .innerJoin(users, eq(memberships.userId, users.id))
    .where(and(eq(memberships.orgId, orgId), eq(users.email, email)));
  if (!match) return null;
  await db
    .update(memberships)
    .set({ slackUserId })
    .where(eq(memberships.id, match.membershipId));
  return match;
}

export interface BlockActionPayload {
  type: string;
  team?: { id: string };
  user?: { id: string };
  response_url?: string;
  actions?: { action_id: string; value?: string; action_ts?: string }[];
}

export interface TapResult {
  /** Ephemeral message for the tapper. */
  ephemeralText: string;
  /** Fresh announcement blocks to replace the original message, if traded. */
  updatedBlocks: unknown[] | null;
}

/** Handle one bucket-button tap: trade toward the target, capped at ₥25. */
export async function handleTap(
  db: Db,
  client: SlackClient,
  orgId: string,
  payload: BlockActionPayload,
): Promise<TapResult> {
  const action = payload.actions?.find((a) => a.action_id.startsWith("tap:"));
  if (!action?.value) return { ephemeralText: "Nothing to do.", updatedBlocks: null };
  const slackUserId = payload.user?.id;
  if (!slackUserId) return { ephemeralText: "Missing Slack user.", updatedBlocks: null };
  const member = await resolveMembership(db, client, orgId, slackUserId);
  if (!member) {
    return {
      ephemeralText:
        "No OrgMarket account matches your Slack email — ask your admin for an invite.",
      updatedBlocks: null,
    };
  }
  const { marketId, target } = JSON.parse(action.value) as { marketId: string; target: number };
  let preview;
  try {
    preview = await previewTrade(db, {
      orgId,
      marketId,
      membershipId: member.membershipId,
      outcomeIdx: 0,
      targetProb: target,
      maxSpendMicro: TAP_MAX_SPEND_MICRO,
    });
  } catch (err) {
    return {
      ephemeralText: err instanceof Error ? err.message : "Could not preview that forecast.",
      updatedBlocks: null,
    };
  }
  if (preview.deltaMicroShares === 0) {
    return {
      ephemeralText: `The market is already at your forecast (${formatPct(preview.newProb)}). Tap a different bucket or open the web slider for precision.`,
      updatedBlocks: null,
    };
  }
  try {
    const result = await executeTradeTx(db, {
      orgId,
      marketId,
      membershipId: member.membershipId,
      outcomeIdx: preview.outcomeIdx,
      deltaMicroShares: preview.deltaMicroShares,
      idempotencyKey: `slack:${slackUserId}:${action.action_ts ?? crypto.randomUUID()}`,
    });
    const market = await getMarket(db, orgId, marketId);
    const bought = preview.deltaMicroShares > 0;
    const outcomeLabel = market?.outcomes[preview.outcomeIdx]?.label ?? "";
    const yesNow = market ? formatPct(market.prices[0] ?? 0) : "?";
    return {
      ephemeralText:
        `You ${bought ? "bought" : "sold"} ${formatShares(Math.abs(preview.deltaMicroShares))} ` +
        `${outcomeLabel} for ${formatMoney(Math.abs(result.costMicro))} — ` +
        `${market?.outcomes[0]?.label ?? "Yes"} is now ${yesNow}.` +
        (preview.cappedBy === "budget" ? " (Capped at ₥25 per tap — tap again to push further.)" : ""),
      updatedBlocks: market ? marketAnnouncementBlocks(market) : null,
    };
  } catch (err) {
    return {
      ephemeralText: err instanceof Error ? err.message : "Trade failed.",
      updatedBlocks: null,
    };
  }
}
