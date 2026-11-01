import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { memberships, orgs, users } from "@/db/schema";
import { loginAs, ssoSignIn } from "@/app/actions";
import { ssoProviderList } from "@/auth";
import { isDevLoginEnabled } from "@/lib/session";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  NotProvisioned:
    "Your email domain isn't enabled for any OrgMarket workspace. Ask an admin to add it to the org's allowed domains.",
  NoEmail: "Your identity provider didn't share an email address.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const providers = ssoProviderList();
  const devLogin = isDevLoginEnabled();
  const db = await getDb();
  const devRows = devLogin
    ? await db
        .select({
          membershipId: memberships.id,
          displayName: users.displayName,
          role: memberships.role,
          orgName: orgs.name,
        })
        .from(memberships)
        .innerJoin(users, eq(memberships.userId, users.id))
        .innerJoin(orgs, eq(memberships.orgId, orgs.id))
    : [];

  return (
    <div className="mx-auto max-w-md space-y-6">
      <div>
        <h1 className="mb-1 text-2xl font-semibold">OrgMarket</h1>
        <p className="text-sm text-slate-500">A forecasting layer for planning. Sign in to see what your colleagues believe.</p>
      </div>
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {ERRORS[error] ?? "Sign-in failed. Try again or contact your admin."}
        </div>
      )}
      {providers.length > 0 && (
        <div className="space-y-2">
          {providers.map((p) => (
            <form key={p.id} action={ssoSignIn}>
              <input type="hidden" name="providerId" value={p.id} />
              <button
                type="submit"
                className="w-full rounded-lg bg-slate-900 px-4 py-3 font-medium text-white hover:bg-slate-800"
              >
                Continue with {p.name}
              </button>
            </form>
          ))}
        </div>
      )}
      {providers.length === 0 && !devLogin && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          No sign-in method is configured. Set an SSO provider (see <code>.env.example</code>) or
          <code> DEV_LOGIN=1</code> for a demo.
        </p>
      )}
      {devLogin && devRows.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">
            Demo sign-in (DEV_LOGIN, never enable in production)
          </p>
          <div className="space-y-2">
            {devRows.map((r) => (
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
      )}
    </div>
  );
}
