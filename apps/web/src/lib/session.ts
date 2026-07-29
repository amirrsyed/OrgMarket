import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { memberships, orgs, users } from "@/db/schema";

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
 * DEV AUTH ONLY (D16): the cookie holds a membership id chosen on the demo
 * login page. Replaced by Auth.js (magic link + Google OAuth) behind this same
 * interface before any external pilot.
 */
export async function currentMember(): Promise<SessionMember | null> {
  const store = await cookies();
  const membershipId = store.get(SESSION_COOKIE)?.value;
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
