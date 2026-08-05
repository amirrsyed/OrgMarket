import type { Db } from "@/db";
import { getMarket, listMarkets, priceHistory } from "@/services/trading";
import { WebSlackClient, getSlackConfig, type SlackClient } from "./client";
import { digestBlocks, marketAnnouncementBlocks, resolutionBlocks } from "./blocks";

/**
 * Best-effort outbound notifications: a Slack outage must never fail a web
 * action, so every entry point swallows errors after logging.
 */

function makeClient(botToken: string): SlackClient {
  return new WebSlackClient(botToken);
}

export async function announceMarket(db: Db, orgId: string, marketId: string): Promise<void> {
  try {
    const config = await getSlackConfig(db, orgId);
    if (!config) return;
    const market = await getMarket(db, orgId, marketId);
    if (!market) return;
    await makeClient(config.botToken).postMessage(
      config.channelId,
      `New market: ${market.question}`,
      marketAnnouncementBlocks(market),
    );
  } catch (err) {
    console.warn("slack announceMarket failed:", err);
  }
}

export async function announceResolution(
  db: Db,
  orgId: string,
  marketId: string,
  totalPayoutMicro: number,
  winnerCount: number,
): Promise<void> {
  try {
    const config = await getSlackConfig(db, orgId);
    if (!config) return;
    const market = await getMarket(db, orgId, marketId);
    if (!market) return;
    await makeClient(config.botToken).postMessage(
      config.channelId,
      `Resolved: ${market.question}`,
      resolutionBlocks(market, totalPayoutMicro, winnerCount),
    );
  } catch (err) {
    console.warn("slack announceResolution failed:", err);
  }
}

export async function postDigest(db: Db, orgId: string): Promise<boolean> {
  try {
    const config = await getSlackConfig(db, orgId);
    if (!config) return false;
    const markets = await listMarkets(db, orgId);
    const entries = [];
    for (const market of markets) {
      entries.push({ market, history: await priceHistory(db, market.id) });
    }
    await makeClient(config.botToken).postMessage(
      config.channelId,
      "OrgMarket digest",
      digestBlocks(entries, new Date()),
    );
    return true;
  } catch (err) {
    console.warn("slack postDigest failed:", err);
    return false;
  }
}
