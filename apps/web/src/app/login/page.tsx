import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { memberships, orgs, users } from "@/db/schema";
import { loginAs } from "@/app/actions";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const db = await getDb();
  const rows = await db
    .select({
      membershipId: memberships.id,
      displayName: users.displayName,
      role: memberships.role,
      orgName: orgs.name,
    })
    .from(memberships)
    .innerJoin(users, eq(memberships.userId, users.id))
    .innerJoin(orgs, eq(memberships.orgId, orgs.id));
  return (
    <div className="mx-auto max-w-md">
      <h1 className="mb-1 text-2xl font-semibold">OrgMarket</h1>
      <p className="mb-6 text-sm text-slate-500">
        Dev sign-in for the demo org. Production auth is magic-link + SSO (decision D16).
      </p>
      <div className="space-y-2">
        {rows.map((r) => (
          <form key={r.membershipId} action={loginAs}>
            <input type="hidden" name="membershipId" value={r.membershipId} />
            <button
              type="submit"
              className="flex w-full items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3 text-left hover:border-slate-400"
            >
              <span>
                <span className="font-medium">{r.displayName}</span>
                <span className="ml-2 text-sm text-slate-500">{r.orgName}</span>
              </span>
              {r.role === "admin" && (
                <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">admin</span>
              )}
            </button>
          </form>
        ))}
      </div>
    </div>
  );
}
