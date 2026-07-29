import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { currentMember } from "@/lib/session";
import { getLeaderboard } from "@/services/trading";
import { formatMoney } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function LeaderboardPage() {
  const member = await currentMember();
  if (!member) redirect("/login");
  const db = await getDb();
  const rows = await getLeaderboard(db, member.orgId);
  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold">Leaderboard</h1>
      <p className="mb-4 text-sm text-slate-500">
        Ranked by calibration (trade-weighted Brier score on resolved markets — lower is better).
        Balances reset each season; calibration is forever.
      </p>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
              <th className="px-4 py-2 font-medium">#</th>
              <th className="px-4 py-2 font-medium">Forecaster</th>
              <th className="px-4 py-2 text-right font-medium">Calibration (Brier)</th>
              <th className="px-4 py-2 text-right font-medium">Scored trades</th>
              <th className="px-4 py-2 text-right font-medium">Net worth</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr
                key={r.membershipId}
                className={`border-b border-slate-100 last:border-0 ${
                  r.membershipId === member.membershipId ? "bg-emerald-50/50" : ""
                }`}
              >
                <td className="px-4 py-2 tabular-nums text-slate-500">{i + 1}</td>
                <td className="px-4 py-2 font-medium">
                  {r.pseudonym}
                  {r.membershipId === member.membershipId && (
                    <span className="ml-2 text-xs font-normal text-emerald-700">(you)</span>
                  )}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {r.brier === null ? <span className="text-slate-400">—</span> : r.brier.toFixed(3)}
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-slate-500">
                  {r.resolvedTradeCount}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">{formatMoney(r.netWorthMicro)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
