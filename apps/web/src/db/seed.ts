import type { Db } from "@/db";
import { memberships, orgs, users } from "@/db/schema";
import {
  createMarketTx,
  executeTradeTx,
  grantToMembership,
  previewTrade,
  resolveMarketTx,
} from "@/services/trading";
import { MICRO_PER_CREDIT } from "@orgmarket/engine";

/**
 * Demo org for local dev and sales demos: Meridian Games, a fictional
 * ~400-person studio — the beachhead customer profile (D12). Deterministic
 * ids so the dev login page is stable. Runs only when the database is empty.
 */

const ORG = "org-meridian";
const M = MICRO_PER_CREDIT;

const MEMBERS = [
  { user: "user-avery", mem: "mem-avery", name: "Avery Chen", email: "avery@meridiangames.dev", role: "admin" as const, pseudonym: "Calibrated Capybara" },
  { user: "user-jordan", mem: "mem-jordan", name: "Jordan Reyes", email: "jordan@meridiangames.dev", role: "member" as const, pseudonym: "Bayesian Badger" },
  { user: "user-sam", mem: "mem-sam", name: "Sam Whitfield", email: "sam@meridiangames.dev", role: "member" as const, pseudonym: "Prudent Puffin" },
  { user: "user-priya", mem: "mem-priya", name: "Priya Nair", email: "priya@meridiangames.dev", role: "member" as const, pseudonym: "Skeptical Skink" },
  { user: "user-marcus", mem: "mem-marcus", name: "Marcus Bell", email: "marcus@meridiangames.dev", role: "member" as const, pseudonym: "Marginal Marmot" },
  { user: "user-elena", mem: "mem-elena", name: "Elena Duarte", email: "elena@meridiangames.dev", role: "member" as const, pseudonym: "Honest Heron" },
];

async function tradeToTarget(
  db: Db,
  marketId: string,
  membershipId: string,
  outcomeIdx: number,
  targetProb: number,
  key: string,
  at: Date,
): Promise<void> {
  const preview = await previewTrade(db, { orgId: ORG, marketId, membershipId, outcomeIdx, targetProb });
  if (preview.deltaMicroShares === 0) return;
  await executeTradeTx(db, {
    orgId: ORG,
    marketId,
    membershipId,
    outcomeIdx,
    deltaMicroShares: preview.deltaMicroShares,
    idempotencyKey: key,
    at,
  });
}

export async function seedIfEmpty(db: Db): Promise<void> {
  const existing = await db.select().from(orgs).limit(1);
  if (existing.length > 0) return;

  const d = (s: string) => new Date(s);
  await db.insert(orgs).values({
    id: ORG,
    name: "Meridian Games",
    settings: { anonymity: "pseudonymous" },
    createdAt: d("2026-07-01T09:00:00Z"),
  });
  for (const m of MEMBERS) {
    await db.insert(users).values({ id: m.user, email: m.email, displayName: m.name });
    await db.insert(memberships).values({ id: m.mem, orgId: ORG, userId: m.user, role: m.role, pseudonym: m.pseudonym });
    await grantToMembership(db, { orgId: ORG, membershipId: m.mem, amountMicro: 1000 * M, at: d("2026-07-01T09:05:00Z") });
  }

  // ── Resolved market: the July 10 board-review demo (resolved NO) ──────────
  const demo = await createMarketTx(db, {
    orgId: ORG,
    question: "Will the vertical-slice demo be ready for the July 10 board review?",
    description: "Ready = playable on the boardroom console build, no dev cheats, all three biomes.",
    resolutionCriteria: "Resolves YES if the build shown at the July 10 board review meets the readiness bar above.",
    resolutionSource: "Board-review build sign-off (studio production Slack, #starfall-release).",
    liquidityB: 100,
    closeAt: d("2026-07-09T17:00:00Z"),
    createdBy: "mem-avery",
    outcomeLabels: ["Yes", "No"],
    at: d("2026-07-01T10:00:00Z"),
  });
  await tradeToTarget(db, demo, "mem-elena", 1, 0.58, "seed-demo-1", d("2026-07-02T14:00:00Z"));
  await tradeToTarget(db, demo, "mem-jordan", 0, 0.52, "seed-demo-2", d("2026-07-03T11:00:00Z"));
  await tradeToTarget(db, demo, "mem-priya", 1, 0.63, "seed-demo-3", d("2026-07-05T16:00:00Z"));
  await tradeToTarget(db, demo, "mem-avery", 1, 0.68, "seed-demo-4", d("2026-07-07T10:00:00Z"));
  await tradeToTarget(db, demo, "mem-marcus", 0, 0.38, "seed-demo-5", d("2026-07-08T15:00:00Z"));
  await resolveMarketTx(db, {
    orgId: ORG,
    marketId: demo,
    winningOutcomeIdx: 1,
    resolvedBy: "mem-avery",
    evidence: "Board review ran on the June milestone build; frost biome was cut from the demo. Resolves No.",
    at: d("2026-07-10T18:00:00Z"),
  });

  // ── Open: the flagship ship-date market (the wedge question) ──────────────
  const ship = await createMarketTx(db, {
    orgId: ORG,
    question: "Will Starfall: Reckoning ship its console build by October 31, 2026?",
    description: "The date currently on the public roadmap. Certification submission does not count — shipped means live in stores.",
    resolutionCriteria: "Resolves YES if the console build is purchasable on at least two of three target storefronts by 23:59 PT on Oct 31, 2026.",
    resolutionSource: "Storefront listings, checked by the resolution admin.",
    liquidityB: 100,
    closeAt: d("2026-10-24T17:00:00Z"),
    createdBy: "mem-avery",
    outcomeLabels: ["Yes", "No"],
    at: d("2026-07-12T09:00:00Z"),
  });
  await tradeToTarget(db, ship, "mem-jordan", 0, 0.56, "seed-ship-1", d("2026-07-14T10:00:00Z"));
  await tradeToTarget(db, ship, "mem-priya", 1, 0.52, "seed-ship-2", d("2026-07-16T13:00:00Z"));
  await tradeToTarget(db, ship, "mem-elena", 1, 0.57, "seed-ship-3", d("2026-07-20T15:00:00Z"));
  await tradeToTarget(db, ship, "mem-sam", 1, 0.60, "seed-ship-4", d("2026-07-24T11:00:00Z"));
  await tradeToTarget(db, ship, "mem-avery", 1, 0.62, "seed-ship-5", d("2026-07-28T16:00:00Z"));

  // ── Open: playtest NPS ────────────────────────────────────────────────────
  const nps = await createMarketTx(db, {
    orgId: ORG,
    question: "Will the Q3 external playtest score at least 70 NPS?",
    description: "The 2,000-player closed playtest scheduled for early September.",
    resolutionCriteria: "Resolves YES if the official post-playtest survey NPS is ≥ 70.",
    resolutionSource: "Player-research team's survey report.",
    liquidityB: 100,
    closeAt: d("2026-09-01T17:00:00Z"),
    createdBy: "mem-avery",
    outcomeLabels: ["Yes", "No"],
    at: d("2026-07-15T09:00:00Z"),
  });
  await tradeToTarget(db, nps, "mem-sam", 0, 0.55, "seed-nps-1", d("2026-07-18T10:00:00Z"));
  await tradeToTarget(db, nps, "mem-jordan", 0, 0.61, "seed-nps-2", d("2026-07-22T14:00:00Z"));
  await tradeToTarget(db, nps, "mem-priya", 1, 0.44, "seed-nps-3", d("2026-07-26T12:00:00Z"));

  // ── Open: categorical platform market ─────────────────────────────────────
  const platform = await createMarketTx(db, {
    orgId: ORG,
    question: "Which platform leads Starfall wishlists on September 1?",
    description: "Total wishlist count per platform as reported in the weekly marketing dashboard.",
    resolutionCriteria: "Resolves to the platform with the highest wishlist count in the Sep 1 dashboard snapshot.",
    resolutionSource: "Marketing analytics dashboard (weekly export).",
    liquidityB: 100,
    closeAt: d("2026-08-30T17:00:00Z"),
    createdBy: "mem-avery",
    outcomeLabels: ["Steam", "PlayStation", "Xbox"],
    at: d("2026-07-18T09:00:00Z"),
  });
  await tradeToTarget(db, platform, "mem-marcus", 0, 0.48, "seed-plat-1", d("2026-07-19T10:00:00Z"));
  await tradeToTarget(db, platform, "mem-elena", 0, 0.55, "seed-plat-2", d("2026-07-23T15:00:00Z"));
  await tradeToTarget(db, platform, "mem-jordan", 1, 0.30, "seed-plat-3", d("2026-07-27T11:00:00Z"));

  // ── Open: crash-rate quality gate (shallow liquidity) ─────────────────────
  const crash = await createMarketTx(db, {
    orgId: ORG,
    question: "Will patch 1.2 cut the crash rate below 0.5% by August 15?",
    description: "Session crash rate across all platforms, 7-day trailing average.",
    resolutionCriteria: "Resolves YES if the telemetry dashboard's 7-day trailing crash rate is < 0.5% on Aug 15.",
    resolutionSource: "Live-ops telemetry dashboard.",
    liquidityB: 50,
    closeAt: d("2026-08-13T17:00:00Z"),
    createdBy: "mem-avery",
    outcomeLabels: ["Yes", "No"],
    at: d("2026-07-20T09:00:00Z"),
  });
  await tradeToTarget(db, crash, "mem-priya", 1, 0.55, "seed-crash-1", d("2026-07-21T10:00:00Z"));
  await tradeToTarget(db, crash, "mem-sam", 0, 0.49, "seed-crash-2", d("2026-07-25T13:00:00Z"));
}
