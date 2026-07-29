import { redirect } from "next/navigation";
import { currentMember } from "@/lib/session";
import { createMarketAction } from "@/app/actions";

export const dynamic = "force-dynamic";

const field =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-slate-500 focus:outline-none";

export default async function NewMarketPage() {
  const member = await currentMember();
  if (!member) redirect("/login");
  if (member.role !== "admin") redirect("/");
  return (
    <div className="mx-auto max-w-xl">
      <h1 className="mb-1 text-xl font-semibold">New market</h1>
      <p className="mb-4 text-sm text-slate-500">
        A good question has an unambiguous resolution rule, a named source, and a close date
        before the resolution date (SPEC §7).
      </p>
      <form action={createMarketAction} className="space-y-4">
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">Question</span>
          <input name="question" required className={field} placeholder="Will X ship by …?" />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">Description (optional)</span>
          <textarea name="description" rows={2} className={field} />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">Resolution criteria</span>
          <textarea
            name="resolutionCriteria"
            required
            rows={2}
            className={field}
            placeholder="Resolves YES if …"
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">Resolution source</span>
          <input
            name="resolutionSource"
            required
            className={field}
            placeholder="Dashboard, report, or system of record"
          />
        </label>
        <div className="grid grid-cols-2 gap-4">
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-700">Closes</span>
            <input name="closeAt" type="datetime-local" required className={field} />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-700">Liquidity</span>
            <select name="liquidityB" defaultValue="100" className={field}>
              <option value="50">Shallow (b=50, max subsidy ≈ ₥35)</option>
              <option value="100">Standard (b=100, ≈ ₥69)</option>
              <option value="250">Deep (b=250, ≈ ₥173)</option>
            </select>
          </label>
        </div>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">Outcomes (one per line)</span>
          <textarea name="outcomes" rows={3} defaultValue={"Yes\nNo"} className={field} />
        </label>
        <button
          type="submit"
          className="rounded-lg bg-slate-900 px-4 py-2 font-medium text-white"
        >
          Create market
        </button>
      </form>
    </div>
  );
}
