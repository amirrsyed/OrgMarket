import { notFound, redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { positions } from "@/db/schema";
import { currentMember } from "@/lib/session";
import { getMarket, priceHistory, recentTrades } from "@/services/trading";
import { formatDate, formatMoney, formatPct, formatShares } from "@/lib/format";
import { PriceChart } from "@/components/PriceChart";
import { TradePanel } from "@/components/TradePanel";
import { ResolveForm } from "@/components/ResolveForm";
import { isAiConfigured } from "@/services/ai/client";

export const dynamic = "force-dynamic";

export default async function MarketPage({ params }: { params: Promise<{ id: string }> }) {
  const member = await currentMember();
  if (!member) redirect("/login");
  const { id } = await params;
  const db = await getDb();
  const market = await getMarket(db, member.orgId, id);
  if (!market) notFound();

  const history = await priceHistory(db, id);
  const activity = await recentTrades(db, id, 15);
  const posRows = await db
    .select()
    .from(positions)
    .where(and(eq(positions.marketId, id), eq(positions.membershipId, member.membershipId)));
  const holdings = market.outcomes.map(
    (o) => posRows.find((p) => p.outcomeIdx === o.idx)?.microShares ?? 0,
  );
  const tradable = market.status === "open" && market.closeAt.getTime() > Date.now();
  const winnerLabel =
    market.resolvedOutcomeIdx !== null ? market.outcomes[market.resolvedOutcomeIdx]?.label : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold leading-tight">{market.question}</h1>
        <p className="mt-1 text-sm text-slate-500">
          {market.status === "resolved"
            ? `Resolved ${winnerLabel} `
            : `Closes ${formatDate(market.closeAt)} · `}
          Liquidity b={market.liquidityB}
        </p>
        {market.description && <p className="mt-2 max-w-2xl text-sm text-slate-600">{market.description}</p>}
      </div>

      {market.status === "resolved" && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <p className="font-medium text-emerald-800">Resolved: {winnerLabel}</p>
          {market.resolutionEvidence && (
            <p className="mt-1 text-sm text-emerald-700">{market.resolutionEvidence}</p>
          )}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-4">
          <PriceChart
            series={history.map((h) => ({ t: h.t, prices: h.prices }))}
            labels={market.outcomes.map((o) => o.label)}
          />
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="mb-2 text-sm font-medium text-slate-600">Recent activity</p>
            {activity.length === 0 && <p className="text-sm text-slate-500">No trades yet.</p>}
            <ul className="divide-y divide-slate-100 text-sm">
              {activity.map((a, i) => (
                <li key={i} className="flex items-center justify-between py-2">
                  <span>
                    <span className="font-medium">{a.pseudonym}</span>{" "}
                    <span className="text-slate-500">
                      {a.deltaMicroShares > 0 ? "bought" : "sold"}{" "}
                      {formatShares(Math.abs(a.deltaMicroShares))}{" "}
                      {market.outcomes[a.outcomeIdx]?.label}
                    </span>
                  </span>
                  <span className="text-slate-500">
                    → {formatPct(a.postProb)}
                    <span className="ml-2 text-xs text-slate-400">{formatDate(a.createdAt)}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm">
            <p className="mb-1 font-medium text-slate-600">Resolution</p>
            <p className="text-slate-600">{market.resolutionCriteria}</p>
            <p className="mt-1 text-xs text-slate-500">Source: {market.resolutionSource}</p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="mb-2 text-sm font-medium text-slate-600">The crowd says</p>
            <ul className="space-y-2">
              {market.outcomes.map((o) => (
                <li key={o.idx} className="flex items-center justify-between text-sm">
                  <span
                    className={
                      market.resolvedOutcomeIdx === o.idx ? "font-semibold text-emerald-700" : ""
                    }
                  >
                    {o.label}
                  </span>
                  <span className="font-semibold tabular-nums">
                    {formatPct(market.prices[o.idx] ?? 0)}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <TradePanel
            marketId={market.id}
            outcomes={market.outcomes.map((o) => ({
              idx: o.idx,
              label: o.label,
              prob: market.prices[o.idx] ?? 0,
            }))}
            holdings={holdings}
            tradable={tradable}
          />

          {holdings.some((h) => h > 0) && (
            <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm">
              <p className="mb-1 font-medium text-slate-600">Your position</p>
              <ul className="space-y-1">
                {market.outcomes.map((o) =>
                  (holdings[o.idx] ?? 0) > 0 ? (
                    <li key={o.idx} className="flex justify-between">
                      <span>{o.label}</span>
                      <span className="tabular-nums">
                        {formatShares(holdings[o.idx]!)} shares ·{" "}
                        {formatMoney(Math.floor(holdings[o.idx]! * (market.prices[o.idx] ?? 0)))}
                      </span>
                    </li>
                  ) : null,
                )}
              </ul>
            </div>
          )}

          {member.role === "admin" && market.status !== "resolved" && (
            <ResolveForm
              marketId={market.id}
              outcomes={market.outcomes.map((o) => ({ idx: o.idx, label: o.label }))}
              aiConfigured={isAiConfigured()}
            />
          )}
        </div>
      </div>
    </div>
  );
}
