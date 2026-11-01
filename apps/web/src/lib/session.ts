import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { memberships, orgs, users } from "@/db/schema";
import { auth, isSsoConfigured } from "@/auth";

export interface SessionMember {
  membershipId: string;
  orgId: string;
  orgName: string;
  userId: string;
  displayName: string;
  pseudonym: string;
  role: "admin" | "member";
}

export const SESSION_COOKIE = "om_member";

/**
 * The demo picker login. On when DEV_LOGIN=1, or by default in development
 * when no SSO provider is configured. Never on by accident in production.
 */
export function isDevLoginEnabled(): boolean {
  if (process.env.DEV_LOGIN === "1") return true;
  if (process.env.DEV_LOGIN === "0") return false;
  return !isSsoConfigured() && process.env.NODE_ENV !== "production";
}

/** Resolves the signed-in membership from the SSO session or the dev cookie. */
export async function currentMember(): Promise<SessionMember | null> {
  let membershipId: string | undefined;
  if (isSsoConfigured()) {
    const session = (await auth()) as { membershipId?: string } | null;
    membershipId = session?.membershipId;
  }
  if (!membershipId && isDevLoginEnabled()) {
    const store = await cookies();
    membershipId = store.get(SESSION_COOKIE)?.value;
  }
  if (!membershipId) return null;
  const db = await getDb();
  const [row] = await db
    .select({
      membershipId: memberships.id,
      orgId: memberships.orgId,
      orgName: orgs.name,
      userId: users.id,
      displayName: users.displayName,
      pseudonym: memberships.pseudonym,
      role: memberships.role,
    })
    .from(memberships)
    .innerJoin(users, eq(memberships.userId, users.id))
    .innerJoin(orgs, eq(memberships.orgId, orgs.id))
    .where(eq(memberships.id, membershipId));
  return row ?? null;
}
