import type { MarketRow, PricePoint } from "@/services/trading";
import { clampProb, formatDate, formatMoney, formatPct } from "@/lib/format";

/**
 * Pure Block Kit builders — no I/O, fully unit-testable. Binary markets get
 * five probability-bucket tap buttons (D18); categorical markets announce
 * prices and link to the web slider.
 */

export const TAP_BUCKETS = [
  { label: "≈15%", target: 0.15 },
  { label: "≈35%", target: 0.35 },
  { label: "Toss-up", target: 0.5 },
  { label: "≈65%", target: 0.65 },
  { label: "≈85%", target: 0.85 },
] as const;

export const TAP_MAX_SPEND_MICRO = 25_000_000; // ₥25 per tap (D18)

export function appUrl(): string {
  return process.env.APP_URL ?? "http://localhost:3000";
}

function marketLine(market: MarketRow): string {
  if (market.outcomes.length === 2) {
    return `Crowd: *${formatPct(market.prices[0] ?? 0)}* chance of ${market.outcomes[0]!.label}`;
  }
  return market.outcomes
    .map((o) => `${o.label} *${formatPct(market.prices[o.idx] ?? 0)}*`)
    .join(" · ");
}

export function marketAnnouncementBlocks(market: MarketRow): unknown[] {
  const url = `${appUrl()}/m/${market.id}`;
  const blocks: unknown[] = [
    {
      type: "section",
      text: { type: "mrkdwn", text: `:chart_with_upwards_trend: *${market.question}*` },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `${marketLine(market)} · Closes ${formatDate(market.closeAt)}`,
        },
      ],
    },
  ];
  if (market.outcomes.length === 2 && market.status === "open") {
    blocks.push({
      type: "actions",
      block_id: `forecast:${market.id}`,
      elements: [
        ...TAP_BUCKETS.map((b) => ({
          type: "button",
          action_id: `tap:${Math.round(b.target * 100)}`,
          text: { type: "plain_text", text: b.label },
          value: JSON.stringify({ marketId: market.id, target: b.target }),
        })),
        {
          type: "button",
          action_id: "open-web",
          text: { type: "plain_text", text: "Open" },
          url,
        },
      ],
    });
  } else {
    blocks.push({
      type: "actions",
      block_id: `forecast:${market.id}`,
      elements: [
        { type: "button", action_id: "open-web", text: { type: "plain_text", text: "Forecast on the web" }, url },
      ],
    });
  }
  return blocks;
}

export function resolutionBlocks(
  market: MarketRow,
  totalPayoutMicro: number,
  winnerCount: number,
): unknown[] {
  const winner = market.resolvedOutcomeIdx !== null
    ? market.outcomes[market.resolvedOutcomeIdx]?.label
    : "?";
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `:white_check_mark: *Resolved ${winner}* — ${market.question}`,
      },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: [
            market.resolutionEvidence ? `Evidence: ${market.resolutionEvidence}` : null,
            `Paid ${formatMoney(totalPayoutMicro)} to ${winnerCount} forecaster${winnerCount === 1 ? "" : "s"}.`,
            `<${appUrl()}/leaderboard|Leaderboard>`,
          ]
            .filter(Boolean)
            .join(" · "),
        },
      ],
    },
  ];
}

/** Price 7 days ago (or the earliest known), for digest deltas. */
export function referencePrice(history: PricePoint[], outcomeIdx: number, now: Date): number | null {
  if (history.length === 0) return null;
  const cutoff = now.getTime() - 7 * 24 * 3600 * 1000;
  let ref = history[0]!;
  for (const p of history) {
    if (new Date(p.t).getTime() <= cutoff) ref = p;
    else break;
  }
  return ref.prices[outcomeIdx] ?? null;
}

export function digestBlocks(
  entries: { market: MarketRow; history: PricePoint[] }[],
  now: Date,
): unknown[] {
  const blocks: unknown[] = [
    { type: "header", text: { type: "plain_text", text: "OrgMarket digest" } },
  ];
  const open = entries.filter((e) => e.market.status === "open");
  for (const { market, history } of open) {
    const idx = 0;
    const current = clampProb(market.prices[idx] ?? 0);
    const ref = referencePrice(history, idx, now);
    let deltaText = "";
    if (ref !== null) {
      const deltaPts = Math.round((current - clampProb(ref)) * 100);
      if (deltaPts !== 0) deltaText = ` (${deltaPts > 0 ? "▲" : "▼"}${Math.abs(deltaPts)} this week)`;
    }
    const lead =
      market.outcomes.length === 2
        ? `*${formatPct(current)}*${deltaText} ${market.outcomes[0]!.label}`
        : marketLine(market);
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `${lead} — <${appUrl()}/m/${market.id}|${market.question}>`,
      },
    });
  }
  if (open.length === 0) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: "No open markets. Time to ask a question." },
    });
  }
  const resolved = entries.filter((e) => e.market.status === "resolved").slice(0, 5);
  if (resolved.length > 0) {
    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text:
            "Recently resolved: " +
            resolved
              .map((e) => {
                const w = e.market.resolvedOutcomeIdx;
                return `${e.market.question} → *${w !== null ? e.market.outcomes[w]?.label : "?"}*`;
              })
              .join(" · "),
        },
      ],
    });
  }
  return blocks;
}
