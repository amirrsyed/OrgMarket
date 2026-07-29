import Link from "next/link";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { currentMember } from "@/lib/session";
import { listMarkets, type MarketRow } from "@/services/trading";
import { formatDate, formatPct } from "@/lib/format";

export const dynamic = "force-dynamic";

function MarketCard({ market }: { market: MarketRow }) {
  const top = market.outcomes
    .map((o, i) => ({ label: o.label, p: market.prices[i] ?? 0, idx: i }))
    .sort((a, b) => b.p - a.p)[0]!;
  const isBinary = market.outcomes.length === 2;
  const yesProb = market.prices[0] ?? 0;
  const resolved = market.status === "resolved";
  const winner = resolved && market.resolvedOutcomeIdx !== null
    ? market.outcomes[market.resolvedOutcomeIdx]?.label
    : null;
  return (
    <Link
      href={`/m/${market.id}`}
      className="block rounded-xl border border-slate-200 bg-white p-4 transition hover:border-slate-400"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-medium leading-snug">{market.question}</p>
          <p className="mt-1 text-xs text-slate-500">
            {resolved
              ? `Resolved: ${winner}`
              : market.status === "closed"
                ? "Closed — awaiting resolution"
                : `Closes ${formatDate(market.closeAt)}`}
          </p>
        </div>
        <div className="shrink-0 text-right">
          {resolved ? (
            <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-medium text-slate-600">
              {winner}
            </span>
          ) : isBinary ? (
            <>
              <p className="text-2xl font-semibold tabular-nums">{formatPct(yesProb)}</p>
              <p className="text-xs text-slate-500">chance of {market.outcomes[0]?.label}</p>
            </>
          ) : (
            <>
              <p className="text-2xl font-semibold tabular-nums">{formatPct(top.p)}</p>
              <p className="text-xs text-slate-500">{top.label} leads</p>
            </>
          )}
        </div>
      </div>
    </Link>
  );
}

export default async function MarketsPage() {
  const member = await currentMember();
  if (!member) redirect("/login");
  const db = await getDb();
  const all = await listMarkets(db, member.orgId);
  const open = all.filter((m) => m.status === "open");
  const done = all.filter((m) => m.status !== "open");
  return (
    <div className="space-y-8">
      <section>
        <h1 className="mb-3 text-xl font-semibold">Open markets</h1>
        <div className="space-y-3">
          {open.map((m) => (
            <MarketCard key={m.id} market={m} />
          ))}
          {open.length === 0 && <p className="text-sm text-slate-500">No open markets.</p>}
        </div>
      </section>
      {done.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-semibold text-slate-700">Closed & resolved</h2>
          <div className="space-y-3">
            {done.map((m) => (
              <MarketCard key={m.id} market={m} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
