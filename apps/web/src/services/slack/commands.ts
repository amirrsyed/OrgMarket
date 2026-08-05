import type { Db } from "@/db";
import { listMarkets, priceHistory } from "@/services/trading";
import { formatDate, formatPct } from "@/lib/format";
import type { SlackClient } from "./client";
import { appUrl, digestBlocks } from "./blocks";
import { resolveMembership } from "./interactions";

/** `/om` slash command: `list` (default, ephemeral) and `digest` (posts to channel). */
export async function handleCommand(
  db: Db,
  client: SlackClient,
  orgId: string,
  channelId: string,
  params: { text: string; slackUserId: string },
): Promise<{ response_type: "ephemeral" | "in_channel"; text: string }> {
  const sub = params.text.trim().split(/\s+/)[0]?.toLowerCase() || "list";
  if (sub === "digest") {
    const member = await resolveMembership(db, client, orgId, params.slackUserId);
    if (!member) {
      return { response_type: "ephemeral", text: "No OrgMarket account matches your Slack email." };
    }
    const markets = await listMarkets(db, orgId);
    const entries = [];
    for (const market of markets) {
      entries.push({ market, history: await priceHistory(db, market.id) });
    }
    await client.postMessage(channelId, "OrgMarket digest", digestBlocks(entries, new Date()));
    return { response_type: "ephemeral", text: "Digest posted." };
  }
  // Default: list open markets.
  const markets = await listMarkets(db, orgId);
  const open = markets.filter((m) => m.status === "open");
  if (open.length === 0) {
    return { response_type: "ephemeral", text: `No open markets. Create one: ${appUrl()}/admin/new` };
  }
  const lines = open.map((m) => {
    const lead =
      m.outcomes.length === 2
        ? `${formatPct(m.prices[0] ?? 0)} ${m.outcomes[0]!.label}`
        : m.outcomes.map((o) => `${o.label} ${formatPct(m.prices[o.idx] ?? 0)}`).join(", ");
    return `• *${lead}* — <${appUrl()}/m/${m.id}|${m.question}> (closes ${formatDate(m.closeAt)})`;
  });
  return { response_type: "ephemeral", text: lines.join("\n") };
}
