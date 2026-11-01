import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { currentMember } from "@/lib/session";
import { getDb } from "@/db";
import { getBalanceMicro } from "@/services/trading";
import { formatMoney } from "@/lib/format";
import { logout } from "@/app/actions";

export const metadata: Metadata = {
  title: "OrgMarket",
  description: "A forecasting layer for planning.",
};

async function TopNav() {
  const member = await currentMember();
  if (!member) return null;
  const db = await getDb();
  const balance = await getBalanceMicro(db, member.orgId, member.membershipId);
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-5xl items-center gap-6 px-4 py-3">
        <Link href="/" className="text-lg font-semibold tracking-tight">
          OrgMarket
        </Link>
        <nav className="flex gap-4 text-sm text-slate-600">
          <Link href="/" className="hover:text-slate-900">Markets</Link>
          <Link href="/portfolio" className="hover:text-slate-900">Portfolio</Link>
          <Link href="/leaderboard" className="hover:text-slate-900">Leaderboard</Link>
          {member.role === "admin" && (
            <>
              <Link href="/admin/new" className="hover:text-slate-900">New market</Link>
              <Link href="/admin/draft" className="hover:text-slate-900">Draft with AI</Link>
              <Link href="/admin/memo" className="hover:text-slate-900">Memo</Link>
              <Link href="/admin/settlement" className="hover:text-slate-900">Settlement</Link>
            </>
          )}
        </nav>
        <div className="ml-auto flex items-center gap-3 text-sm">
          <span className="rounded-full bg-emerald-50 px-3 py-1 font-medium text-emerald-700">
            {formatMoney(balance)}
          </span>
          <span className="text-slate-500" title={`Signed in as ${member.displayName}`}>
            {member.pseudonym}
          </span>
          <form action={logout}>
            <button className="text-slate-400 hover:text-slate-700" type="submit">
              Sign out
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <TopNav />
        <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
