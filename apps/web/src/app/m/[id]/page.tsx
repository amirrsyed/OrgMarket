import { notFound, redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { positions } from "@/db/schema";
import { currentMember } from "@/lib/session";
import { getMarket, listDisputes, priceHistory, recentTrades } from "@/services/trading";
import { formatDate, formatMoney, formatPct, formatShares } from "@/lib/format";
import { PriceChart } from "@/components/PriceChart";
import { TradePanel } from "@/components/TradePanel";
import { ResolveForm } from "@/components/ResolveForm";
import { AutoRefresh } from "@/components/AutoRefresh";
import { isAiConfigured } from "@/services/ai/client";
import { disputeResolutionAction, finalizeResolutionAction } from "@/app/actions";

export const dynamic = "force-dynamic";

function formatDateTime(d: Date): string {
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export default async function MarketPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const member = await currentMember();
  if (!member) redirect("/login");
  const { id } = await params;
  const { error } = await searchParams;
  const db = await getDb();
  const market = await getMarket(db, member.orgId, id);
  if (!market) notFound();

  const history = await priceHistory(db, id);
  const activity = await recentTrades(db, id, 15);
  const disputes = market.status === "resolving" || market.status === "resolved" ? await listDisputes(db, id) : [];
  const posRows = await db
    .select()
    .from(positions)
    .where(and(eq(positions.marketId, id), eq(positions.membershipId, member.membershipId)));
  const holdings = market.outcomes.map(
    (o) => posRows.find((p) => p.outcomeIdx === o.idx)?.microShares ?? 0,
  );
  const now = Date.now();
  const tradable = market.status === "open" && market.closeAt.getTime() > now;
  const winnerLabel =
    market.resolvedOutcomeIdx !== null ? market.outcomes[market.resolvedOutcomeIdx]?.label : null;
  const proposedLabel =
    market.proposedOutcomeIdx !== null ? market.outcomes[market.proposedOutcomeIdx]?.label : null;
  const windowOpen = market.challengeEndsAt !== null && market.challengeEndsAt.getTime() > now;
  const openDisputes = disputes.filter((d) => d.status === "open");

  return (
    <div className="space-y-6">
      <AutoRefresh />
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}
      <div>
        <h1 className="text-2xl font-semibold leading-tight">{market.question}</h1>
        <p className="mt-1 text-sm text-slate-500">
          {market.status === "resolved"
            ? `Resolved ${winnerLabel} · `
            : market.status === "resolving"
              ? "Resolution pending · "
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
          {disputes.length > 0 && (
            <div className="mt-3 border-t border-emerald-200 pt-2 text-sm">
              <p className="text-xs font-medium uppercase tracking-wide text-emerald-800">Dispute record</p>
              <ul className="mt-1 space-y-1">
                {disputes.map((d) => (
                  <li key={d.id} className="text-emerald-900">
                    <span className="font-medium">{d.pseudonym}</span>{" "}
                    <span className="text-xs uppercase tracking-wide text-emerald-700">
                      {d.status === "dismissed" ? "overridden by admin" : d.status}
                    </span>
                    : {d.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {market.status === "resolving" && market.challengeEndsAt && (
        <div className="space-y-3 rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm">
          <div>
            <p className="font-medium text-sky-900">
              Proposed resolution: {proposedLabel}
            </p>
            {market.proposedEvidence && <p className="mt-1 text-sky-800">{market.proposedEvidence}</p>}
            <p className="mt-1 text-xs text-sky-700">
              {windowOpen
                ? `Challenge window open until ${formatDateTime(market.challengeEndsAt)}. Payouts happen after it closes with no open disputes.`
                : openDisputes.length > 0
                  ? "Challenge window closed. Open disputes must be reviewed by an admin before payout."
                  : "Challenge window closed. Settles on the next scheduled run, or an admin can finalize now."}
            </p>
          </div>
          {disputes.length > 0 && (
            <ul className="space-y-1">
              {disputes.map((d) => (
                <li key={d.id} className="rounded-lg bg-white p-2 text-slate-700">
                  <span className="font-medium">{d.pseudonym}</span>{" "}
                  <span className="text-xs uppercase tracking-wide text-slate-400">{d.status}</span>
                  <p>{d.reason}</p>
                </li>
              ))}
            </ul>
          )}
          {windowOpen && (
            <form action={disputeResolutionAction} className="flex flex-col gap-2">
              <input type="hidden" name="marketId" value={market.id} />
              <textarea
                name="reason"
                required
                minLength={10}
                rows={2}
                placeholder="Think this resolution is wrong? Say why (shown under your pseudonym)."
                className="w-full rounded-lg border border-sky-200 bg-white p-2"
              />
              <button type="submit" className="self-start rounded-lg border border-sky-300 px-3 py-1.5 font-medium text-sky-900">
                File dispute
              </button>
            </form>
          )}
          {member.role === "admin" && (
            <form action={finalizeResolutionAction} className="flex flex-wrap items-center gap-3 border-t border-sky-200 pt-3">
              <input type="hidden" name="marketId" value={market.id} />
              {(windowOpen || openDisputes.length > 0) && (
                <label className="flex items-center gap-2 text-xs text-sky-900">
                  <input type="checkbox" name="override" required />
                  Override the {windowOpen ? "open window" : ""}{windowOpen && openDisputes.length > 0 ? " and " : ""}
                  {openDisputes.length > 0 ? `${openDisputes.length} open dispute(s)` : ""} (dismisses them; logged)
                </label>
              )}
              <button type="submit" className="rounded-lg bg-sky-800 px-3 py-1.5 font-medium text-white">
                Finalize and pay out
              </button>
            </form>
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
            <p className="mb-2 text-sm font-medium text-slate-600">Activity and reasoning</p>
            {activity.length === 0 && <p className="text-sm text-slate-500">No trades yet.</p>}
            <ul className="divide-y divide-slate-100 text-sm">
              {activity.map((a, i) => (
                <li key={i} className="py-2">
                  <div className="flex items-center justify-between">
                    <span>
                      <span className="font-medium">{a.pseudonym}</span>{" "}
                      <span className="text-slate-500">
                        {a.deltaMicroShares > 0 ? "bought" : "sold"}{" "}
                        {formatShares(Math.abs(a.deltaMicroShares))}{" "}
                        {market.outcomes[a.outcomeIdx]?.label}
                      </span>
                    </span>
                    <span className="shrink-0 text-slate-500">
                      → {formatPct(a.postProb)}
                      <span className="ml-2 text-xs text-slate-400">{formatDate(a.createdAt)}</span>
                    </span>
                  </div>
                  {a.rationale && (
                    <p className="mt-1 border-l-2 border-slate-200 pl-2 text-slate-600">“{a.rationale}”</p>
                  )}
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm">
            <p className="mb-1 font-medium text-slate-600">Resolution criteria</p>
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
