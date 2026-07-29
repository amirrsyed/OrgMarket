import Link from "next/link";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { currentMember } from "@/lib/session";
import { getPortfolio } from "@/services/trading";
import { formatDate, formatMoney, formatPct, formatShares } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function PortfolioPage() {
  const member = await currentMember();
  if (!member) redirect("/login");
  const db = await getDb();
  const { balanceMicro, positions, history, markets } = await getPortfolio(
    db,
    member.orgId,
    member.membershipId,
  );
  const positionValue = positions.reduce((s, p) => s + p.valueMicro, 0);

  return (
    <div className="space-y-6">
      <div className="flex gap-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs text-slate-500">Balance</p>
          <p className="text-2xl font-semibold tabular-nums">{formatMoney(balanceMicro)}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs text-slate-500">Open positions (at market)</p>
          <p className="text-2xl font-semibold tabular-nums">{formatMoney(positionValue)}</p>
        </div>
      </div>

      <section>
        <h2 className="mb-2 text-lg font-semibold">Positions</h2>
        {positions.length === 0 && <p className="text-sm text-slate-500">No open positions.</p>}
        <div className="space-y-2">
          {positions.map((p, i) => (
            <Link
              key={i}
              href={`/m/${p.marketId}`}
              className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm hover:border-slate-400"
            >
              <span>
                <span className="font-medium">{p.outcomeLabel}</span>
                <span className="ml-2 text-slate-500">{p.question}</span>
              </span>
              <span className="shrink-0 tabular-nums text-slate-600">
                {formatShares(p.microShares)} sh · {formatPct(p.currentProb)} ·{" "}
                <span className="font-medium text-slate-900">{formatMoney(p.valueMicro)}</span>
              </span>
            </Link>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-lg font-semibold">Trade history</h2>
        {history.length === 0 && <p className="text-sm text-slate-500">No trades yet.</p>}
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white px-4 text-sm">
          {history.map((t, i) => {
            const m = markets.get(t.marketId);
            return (
              <li key={i} className="flex items-center justify-between py-2">
                <span className="text-slate-600">
                  {t.deltaMicroShares > 0 ? "Bought" : "Sold"}{" "}
                  <span className="font-medium text-slate-900">
                    {formatShares(Math.abs(t.deltaMicroShares))}{" "}
                    {m?.outcomes[t.outcomeIdx]?.label ?? `#${t.outcomeIdx}`}
                  </span>{" "}
                  — {m?.question ?? t.marketId}
                </span>
                <span className="shrink-0 tabular-nums text-slate-500">
                  {formatMoney(-t.costMicro)}
                  <span className="ml-2 text-xs text-slate-400">{formatDate(t.createdAt)}</span>
                </span>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
