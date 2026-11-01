import type { Db } from "@/db";
import { memberships, orgs, users } from "@/db/schema";
import {
  createMarketTx,
  disputeResolutionTx,
  executeTradeTx,
  grantToMembership,
  previewTrade,
  proposeResolutionTx,
  resolveMarketTx,
} from "@/services/trading";
import { MICRO_PER_CREDIT } from "@orgmarket/engine";

/**
 * Demo org for local dev and sales demos: Meridian Games, a fictional
 * ~400-person studio — the beachhead customer profile (D12). Dates are
 * relative to "now" so the demo never goes stale. Runs only on an empty db.
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

export async function seedIfEmpty(db: Db, now: Date = new Date()): Promise<void> {
  const existing = await db.select().from(orgs).limit(1);
  if (existing.length > 0) return;

  const day = 24 * 3600 * 1000;
  const d = (offsetDays: number) => new Date(now.getTime() + offsetDays * day);

  async function tradeTo(
    marketId: string,
    membershipId: string,
    outcomeIdx: number,
    targetProb: number,
    key: string,
    at: Date,
    rationale?: string,
  ): Promise<void> {
    const preview = await previewTrade(db, { orgId: ORG, marketId, membershipId, outcomeIdx, targetProb });
    if (preview.deltaMicroShares === 0) return;
    await executeTradeTx(db, {
      orgId: ORG,
      marketId,
      membershipId,
      outcomeIdx: preview.outcomeIdx,
      deltaMicroShares: preview.deltaMicroShares,
      idempotencyKey: key,
      at,
      ...(rationale ? { rationale } : {}),
    });
  }

  await db.insert(orgs).values({
    id: ORG,
    name: "Meridian Games",
    settings: { anonymity: "pseudonymous", allowedDomains: ["meridiangames.dev"], challengeWindowHours: 48 },
    createdAt: d(-60),
  });
  for (const m of MEMBERS) {
    await db.insert(users).values({ id: m.user, email: m.email, displayName: m.name });
    await db.insert(memberships).values({ id: m.mem, orgId: ORG, userId: m.user, role: m.role, pseudonym: m.pseudonym });
    await grantToMembership(db, {
      orgId: ORG,
      membershipId: m.mem,
      amountMicro: 1000 * M,
      at: d(-60),
      idempotencyKey: `join:${m.mem}`,
    });
  }

  // ── Resolved: the board-review demo (resolved No) ─────────────────────────
  const demo = await createMarketTx(db, {
    orgId: ORG,
    question: "Will the vertical-slice demo be ready for the board review?",
    description: "Ready = playable on the boardroom console build, no dev cheats, all three biomes.",
    resolutionCriteria: "Resolves YES if the build shown at the board review meets the readiness bar above.",
    resolutionSource: "Board-review build sign-off (#starfall-release).",
    liquidityB: 100,
    closeAt: d(-31),
    createdBy: "mem-avery",
    outcomeLabels: ["Yes", "No"],
    at: d(-50),
  });
  await tradeTo(demo, "mem-elena", 1, 0.58, "seed-demo-1", d(-48), "Frost biome lighting still crashes on devkits.");
  await tradeTo(demo, "mem-jordan", 0, 0.52, "seed-demo-2", d(-45));
  await tradeTo(demo, "mem-priya", 1, 0.63, "seed-demo-3", d(-40), "QA hasn't had a full playthrough without a soft-lock yet.");
  await tradeTo(demo, "mem-avery", 1, 0.68, "seed-demo-4", d(-36));
  await tradeTo(demo, "mem-marcus", 0, 0.38, "seed-demo-5", d(-33));
  await resolveMarketTx(db, {
    orgId: ORG,
    marketId: demo,
    winningOutcomeIdx: 1,
    resolvedBy: "mem-avery",
    evidence: "Board review ran on the prior milestone build; frost biome was cut from the demo.",
    at: d(-30),
  });

  // ── Resolving: mid-challenge-window, with one dispute ─────────────────────
  const crash = await createMarketTx(db, {
    orgId: ORG,
    question: "Will patch 1.2 cut the crash rate below 0.5%?",
    description: "Session crash rate across all platforms, 7-day trailing average, measured on the cutoff date.",
    resolutionCriteria: "Resolves YES if the telemetry dashboard's 7-day trailing crash rate is < 0.5% on the cutoff date.",
    resolutionSource: "Live-ops telemetry dashboard.",
    liquidityB: 50,
    closeAt: d(-2),
    createdBy: "mem-avery",
    outcomeLabels: ["Yes", "No"],
    at: d(-25),
  });
  await tradeTo(crash, "mem-priya", 1, 0.55, "seed-crash-1", d(-22), "The 1.2 fixes target PC; console crashes are a different root cause.");
  await tradeTo(crash, "mem-sam", 0, 0.52, "seed-crash-2", d(-15), "Nightly crash dashboards dropped hard after the allocator fix.");
  await tradeTo(crash, "mem-jordan", 0, 0.61, "seed-crash-3", d(-6));
  await proposeResolutionTx(db, {
    orgId: ORG,
    marketId: crash,
    winningOutcomeIdx: 0,
    proposedBy: "mem-avery",
    evidence: "Dashboard showed 0.47% trailing crash rate on the cutoff date.",
    challengeWindowHours: 48,
    at: new Date(now.getTime() - 6 * 3600 * 1000),
  });
  await disputeResolutionTx(db, {
    orgId: ORG,
    marketId: crash,
    membershipId: "mem-priya",
    reason: "The dashboard excludes PS5 sessions since the telemetry migration; including them it's ~0.6%.",
    at: new Date(now.getTime() - 2 * 3600 * 1000),
  });

  // ── Open: the flagship ship-date market (the wedge question) ──────────────
  const ship = await createMarketTx(db, {
    orgId: ORG,
    question: "Will Starfall: Reckoning ship its console build on the roadmap date?",
    description: "The date on the public roadmap (~10 weeks out). Certification submission does not count — shipped means live in stores.",
    resolutionCriteria: "Resolves YES if the console build is purchasable on at least two of three target storefronts by the roadmap date.",
    resolutionSource: "Storefront listings, checked by the resolution admin.",
    liquidityB: 100,
    closeAt: d(63),
    createdBy: "mem-avery",
    outcomeLabels: ["Yes", "No"],
    at: d(-20),
  });
  await tradeTo(ship, "mem-jordan", 0, 0.56, "seed-ship-1", d(-18), "Content-complete is green on the milestone tracker.");
  // Outcome 1 is "No": each target is the probability of a slip, rising.
  await tradeTo(ship, "mem-priya", 1, 0.52, "seed-ship-2", d(-14), "Cert pre-check flagged two TRC failures that need engine changes.");
  await tradeTo(ship, "mem-elena", 1, 0.57, "seed-ship-3", d(-9), "Localization vendor is 3 weeks behind on the last two languages.");
  await tradeTo(ship, "mem-sam", 1, 0.6, "seed-ship-4", d(-5));
  await tradeTo(ship, "mem-avery", 1, 0.64, "seed-ship-5", d(-2), "Perf on base-model consoles is still under 30fps in the city hub.");

  // ── Open: playtest NPS ────────────────────────────────────────────────────
  const nps = await createMarketTx(db, {
    orgId: ORG,
    question: "Will the external playtest score at least 70 NPS?",
    description: "The 2,000-player closed playtest scheduled for next month.",
    resolutionCriteria: "Resolves YES if the official post-playtest survey NPS is ≥ 70.",
    resolutionSource: "Player-research team's survey report.",
    liquidityB: 100,
    closeAt: d(30),
    createdBy: "mem-avery",
    outcomeLabels: ["Yes", "No"],
    at: d(-12),
  });
  await tradeTo(nps, "mem-sam", 0, 0.55, "seed-nps-1", d(-10), "Internal playtests rated the new combat loop very highly.");
  await tradeTo(nps, "mem-jordan", 0, 0.61, "seed-nps-2", d(-7));
  await tradeTo(nps, "mem-priya", 1, 0.44, "seed-nps-3", d(-3), "Onboarding still loses people in the first 20 minutes.");

  // ── Open: categorical platform market ─────────────────────────────────────
  const platform = await createMarketTx(db, {
    orgId: ORG,
    question: "Which platform will lead Starfall wishlists at month-end?",
    description: "Total wishlist count per platform as reported in the weekly marketing dashboard.",
    resolutionCriteria: "Resolves to the platform with the highest wishlist count in the month-end dashboard snapshot.",
    resolutionSource: "Marketing analytics dashboard (weekly export).",
    liquidityB: 100,
    closeAt: d(27),
    createdBy: "mem-avery",
    outcomeLabels: ["Steam", "PlayStation", "Xbox"],
    at: d(-8),
  });
  await tradeTo(platform, "mem-marcus", 0, 0.48, "seed-plat-1", d(-7));
  await tradeTo(platform, "mem-elena", 0, 0.55, "seed-plat-2", d(-4), "The Steam Next Fest demo drove most of last month's adds.");
  await tradeTo(platform, "mem-jordan", 1, 0.3, "seed-plat-3", d(-1));
}
