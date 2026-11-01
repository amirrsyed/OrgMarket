import type { Db } from "@/db";
import {
  listMarkets,
  priceHistory,
  recentRationales,
  type MarketRow,
  type PricePoint,
} from "@/services/trading";
import { clampProb, formatPct } from "@/lib/format";
import { referencePrice } from "@/services/slack/blocks";
import { AI_MODEL, getAnthropic } from "./client";

/**
 * The weekly leadership memo. All figures are assembled deterministically in
 * code; Claude only writes prose around them and is instructed to use no other
 * numbers (D19).
 */

export interface MemoMarketDatum {
  question: string;
  leadLabel: string;
  leadPct: string;
  deltaPts7d: number | null;
  closesInDays: number;
}

export interface MemoData {
  open: MemoMarketDatum[];
  resolved: { question: string; winner: string }[];
}

export function assembleMemoData(
  markets: MarketRow[],
  histories: Map<string, PricePoint[]>,
  now: Date,
): MemoData {
  const open: MemoMarketDatum[] = [];
  for (const market of markets) {
    if (market.status !== "open") continue;
    const leadIdx =
      market.outcomes.length === 2
        ? 0
        : market.prices.reduce((best, p, i) => (p > (market.prices[best] ?? 0) ? i : best), 0);
    const current = clampProb(market.prices[leadIdx] ?? 0);
    const history = histories.get(market.id) ?? [];
    const ref = referencePrice(history, leadIdx, now);
    open.push({
      question: market.question,
      leadLabel: market.outcomes[leadIdx]?.label ?? "?",
      leadPct: formatPct(current),
      deltaPts7d: ref === null ? null : Math.round((current - clampProb(ref)) * 100),
      closesInDays: Math.max(
        0,
        Math.ceil((market.closeAt.getTime() - now.getTime()) / (24 * 3600 * 1000)),
      ),
    });
  }
  // Biggest belief moves first — that is what leadership needs to see.
  open.sort((a, b) => Math.abs(b.deltaPts7d ?? 0) - Math.abs(a.deltaPts7d ?? 0));
  const resolved = markets
    .filter((m) => m.status === "resolved" && m.resolvedOutcomeIdx !== null)
    .slice(0, 5)
    .map((m) => ({
      question: m.question,
      winner: m.outcomes[m.resolvedOutcomeIdx!]?.label ?? "?",
    }));
  return { open, resolved };
}

export async function generateLeadershipMemo(db: Db, orgId: string): Promise<string> {
  const markets = await listMarkets(db, orgId);
  const histories = new Map<string, PricePoint[]>();
  for (const market of markets) {
    histories.set(market.id, await priceHistory(db, market.id));
  }
  const now = new Date();
  const data = assembleMemoData(markets, histories, now);
  const why = await recentRationales(db, orgId, new Date(now.getTime() - 7 * 24 * 3600 * 1000), 20);
  const payload = {
    ...data,
    // Pseudonymous trader reasoning from the past week (D20) — quoted, never attributed.
    traderReasoning: why.map((w) => ({ question: w.question, backed: w.outcomeLabel, why: w.rationale })),
  };
  const client = getAnthropic();
  const response = await client.messages.create({
    model: AI_MODEL,
    max_tokens: 16000,
    system:
      "You write the weekly one-page forecasting memo for a company's leadership team, based on their internal prediction markets. Use ONLY the probabilities, deltas, and dates provided — never invent or recompute a number. Plain professional prose in Markdown: a two-sentence headline of what the crowd believes, then '## Biggest moves this week' (skip markets with no meaningful change), '## Closing soon', '## What traders are saying' (summarize the traderReasoning themes, quoting at most two short phrases, never naming anyone), and '## Recently resolved' if any. Where the crowd's probability suggests the official plan is in doubt, say so plainly — surfacing uncomfortable beliefs is the memo's job. Under 350 words.",
    messages: [{ role: "user", content: JSON.stringify(payload, null, 2) }],
  });
  const text = response.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") throw new Error("Claude returned no memo text");
  return text.text;
}
