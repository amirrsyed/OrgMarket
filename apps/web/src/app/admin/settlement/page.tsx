import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { currentMember } from "@/lib/session";
import { computeSettlement } from "@/services/settlement";
import { formatMoney } from "@/lib/format";

export const dynamic = "force-dynamic";

const field =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-slate-500 focus:outline-none";

export default async function SettlementPage({
  searchParams,
}: {
  searchParams: Promise<{ pool?: string; cap?: string; ack?: string }>;
}) {
  const member = await currentMember();
  if (!member) redirect("/login");
  if (member.role !== "admin") redirect("/");
  const q = await searchParams;
  const pool = Number(q.pool ?? "");
  const cap = Number(q.cap ?? "25");
  const acknowledged = q.ack === "1";
  const ready = acknowledged && pool > 0 && cap > 0 && cap <= 100;
  const db = await getDb();
  const result = ready
    ? await computeSettlement(db, member.orgId, { poolCents: Math.round(pool * 100), capShare: cap / 100 })
    : null;
  const usd = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="mb-1 text-xl font-semibold">Season settlement (optional)</h1>
        <p className="text-sm text-slate-500">
          Split a fixed reward pool in proportion to each member&apos;s positive season profit, with a
          per-person cap. OrgMarket never moves money: export the CSV and pay it through your own
          payroll or rewards system. Recognition-only remains the recommended default (D14/D20).
        </p>
      </div>
      <form className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 text-sm">
        <div className="grid grid-cols-2 gap-4">
          <label className="block">
            <span className="mb-1 block font-medium text-slate-700">Reward pool (USD)</span>
            <input name="pool" type="number" min="1" step="0.01" defaultValue={q.pool ?? ""} required className={field} />
          </label>
          <label className="block">
            <span className="mb-1 block font-medium text-slate-700">Per-person cap (% of pool)</span>
            <input name="cap" type="number" min="1" max="100" defaultValue={q.cap ?? "25"} required className={field} />
          </label>
        </div>
        <label className="flex items-start gap-2 text-slate-600">
          <input type="checkbox" name="ack" value="1" defaultChecked={acknowledged} required className="mt-1" />
          <span>
            Our legal/HR team has reviewed paying rewards tied to forecasting performance in every
            jurisdiction where participants work. The export lists emails and amounts, which an
            admin could partly link back to pseudonyms.
          </span>
        </label>
        <button type="submit" className="rounded-lg bg-slate-900 px-4 py-2 font-medium text-white">
          Preview allocation
        </button>
      </form>

      {result && (
        <div className="space-y-3">
          <div className="flex items-center justify-between text-sm text-slate-600">
            <span>
              Allocated {usd(result.allocatedCents)}
              {result.unallocatedCents > 0 && ` · ${usd(result.unallocatedCents)} stays with the org (per-person caps are not re-spread)`}
            </span>
            <a
              href={`/api/admin/settlement?pool=${pool}&cap=${cap}&ack=1`}
              className="rounded-lg border border-slate-300 px-3 py-1.5 font-medium text-slate-700 hover:border-slate-500"
            >
              Download CSV
            </a>
          </div>
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                  <th className="px-4 py-2 font-medium">Forecaster</th>
                  <th className="px-4 py-2 text-right font-medium">Granted</th>
                  <th className="px-4 py-2 text-right font-medium">Net worth</th>
                  <th className="px-4 py-2 text-right font-medium">Season profit</th>
                  <th className="px-4 py-2 text-right font-medium">Payout</th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((r) => (
                  <tr key={r.membershipId} className="border-b border-slate-100 last:border-0">
                    <td className="px-4 py-2 font-medium">{r.pseudonym}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatMoney(r.grantedMicro)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatMoney(r.netWorthMicro)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatMoney(r.profitMicro)}</td>
                    <td className="px-4 py-2 text-right font-medium tabular-nums">{usd(r.payoutCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
