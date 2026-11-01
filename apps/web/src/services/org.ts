import { and, eq, lte } from "drizzle-orm";
import { MICRO_PER_CREDIT } from "@orgmarket/engine";
import type { Db } from "@/db";
import {
  DEFAULT_ORG_SETTINGS,
  type OrgSettings,
  markets,
  memberships,
  orgs,
  resolutionDisputes,
  users,
} from "@/db/schema";
import { finalizeResolutionTx, grantToMembership, type SettlementResult } from "@/services/trading";

export async function getOrgSettings(db: Db, orgId: string): Promise<Required<OrgSettings>> {
  const [org] = await db.select({ settings: orgs.settings }).from(orgs).where(eq(orgs.id, orgId));
  return { ...DEFAULT_ORG_SETTINGS, ...(org?.settings ?? {}) };
}

const ADJECTIVES = [
  "Bayesian", "Calibrated", "Contrarian", "Curious", "Honest", "Lucid", "Marginal", "Patient",
  "Prudent", "Quiet", "Rational", "Skeptical", "Steady", "Thoughtful", "Wry", "Candid",
];
const ANIMALS = [
  "Badger", "Capybara", "Falcon", "Heron", "Ibis", "Lynx", "Marmot", "Narwhal", "Otter",
  "Puffin", "Quokka", "Raven", "Skink", "Tapir", "Vole", "Wombat",
];

/** Random adjective-animal pseudonym, unique within the org (D3). */
export async function generatePseudonym(db: Db, orgId: string): Promise<string> {
  for (let attempt = 0; attempt < 40; attempt++) {
    const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]!;
    const animal = ANIMALS[Math.floor(Math.random() * ANIMALS.length)]!;
    const candidate = attempt < 20 ? `${adj} ${animal}` : `${adj} ${animal} ${100 + Math.floor(Math.random() * 900)}`;
    const [taken] = await db
      .select({ id: memberships.id })
      .from(memberships)
      .where(and(eq(memberships.orgId, orgId), eq(memberships.pseudonym, candidate)));
    if (!taken) return candidate;
  }
  return `Forecaster ${crypto.randomUUID().slice(0, 8)}`;
}

export async function membershipForEmail(db: Db, email: string): Promise<{ membershipId: string } | null> {
  const [row] = await db
    .select({ membershipId: memberships.id })
    .from(memberships)
    .innerJoin(users, eq(memberships.userId, users.id))
    .where(eq(users.email, email.toLowerCase()));
  return row ?? null;
}

/**
 * SSO sign-in (D20): return the existing membership for this email, or
 * auto-provision one in the org whose allow-list contains the email's domain
 * (with a join grant). Returns null when no org admits the domain.
 */
export async function provisionMemberFromSso(
  db: Db,
  params: { email: string; name?: string | null },
): Promise<{ membershipId: string; created: boolean } | null> {
  const email = params.email.trim().toLowerCase();
  const existing = await membershipForEmail(db, email);
  if (existing) return { ...existing, created: false };
  const domain = email.split("@")[1];
  if (!domain) return null;
  const allOrgs = await db.select().from(orgs);
  const org = allOrgs.find((o) => (o.settings.allowedDomains ?? []).map((d) => d.toLowerCase()).includes(domain));
  if (!org) return null;

  let [user] = await db.select().from(users).where(eq(users.email, email));
  if (!user) {
    user = { id: crypto.randomUUID(), email, displayName: params.name?.trim() || email.split("@")[0]! };
    await db.insert(users).values(user);
  }
  const membershipId = crypto.randomUUID();
  await db.insert(memberships).values({
    id: membershipId,
    orgId: org.id,
    userId: user.id,
    role: "member",
    pseudonym: await generatePseudonym(db, org.id),
  });
  const settings = { ...DEFAULT_ORG_SETTINGS, ...org.settings };
  await grantToMembership(db, {
    orgId: org.id,
    membershipId,
    amountMicro: Math.round(settings.joinGrantCredits * MICRO_PER_CREDIT),
    idempotencyKey: `join:${membershipId}`,
  });
  return { membershipId, created: true };
}

/** ISO-8601 week key, e.g. "2026-W44" — the stipend idempotency bucket. */
export function isoWeekKey(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export interface TickResult {
  closed: number;
  finalized: { orgId: string; marketId: string; settlement: SettlementResult }[];
  stipendsPaid: number;
}

/**
 * Scheduled maintenance (D20), safe to call as often as you like:
 * close expired markets, finalize undisputed resolutions whose window has
 * passed, and pay weekly stipends (idempotent per member per ISO week).
 */
export async function runTick(db: Db, now: Date = new Date()): Promise<TickResult> {
  const closedRows = await db
    .update(markets)
    .set({ status: "closed" })
    .where(and(eq(markets.status, "open"), lte(markets.closeAt, now)))
    .returning({ id: markets.id });

  const finalized: TickResult["finalized"] = [];
  const due = await db
    .select()
    .from(markets)
    .where(and(eq(markets.status, "resolving"), lte(markets.challengeEndsAt, now)));
  for (const market of due) {
    const [open] = await db
      .select({ id: resolutionDisputes.id })
      .from(resolutionDisputes)
      .where(and(eq(resolutionDisputes.marketId, market.id), eq(resolutionDisputes.status, "open")));
    if (open || !market.proposedBy) continue; // disputed: waits for an admin
    const settlement = await finalizeResolutionTx(db, {
      orgId: market.orgId,
      marketId: market.id,
      finalizedBy: market.proposedBy,
      at: now,
    });
    finalized.push({ orgId: market.orgId, marketId: market.id, settlement });
  }

  let stipendsPaid = 0;
  const week = isoWeekKey(now);
  for (const org of await db.select().from(orgs)) {
    const settings = { ...DEFAULT_ORG_SETTINGS, ...org.settings };
    if (!(settings.weeklyStipendCredits > 0)) continue;
    const members = await db.select({ id: memberships.id }).from(memberships).where(eq(memberships.orgId, org.id));
    for (const m of members) {
      const paid = await grantToMembership(db, {
        orgId: org.id,
        membershipId: m.id,
        amountMicro: Math.round(settings.weeklyStipendCredits * MICRO_PER_CREDIT),
        idempotencyKey: `stipend:${m.id}:${week}`,
        at: now,
      });
      if (paid) stipendsPaid += 1;
    }
  }
  return { closed: closedRows.length, finalized, stipendsPaid };
}
