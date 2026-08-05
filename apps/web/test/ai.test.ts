import { beforeEach, describe, expect, it } from "vitest";
import { MICRO_PER_CREDIT } from "@orgmarket/engine";
import { createTestDb, type Db } from "@/db";
import { memberships, orgs, users } from "@/db/schema";
import {
  createMarketTx,
  executeTradeTx,
  grantToMembership,
  listMarkets,
  priceHistory,
  resolveMarketTx,
  type PricePoint,
} from "@/services/trading";
import { checkGuardrails } from "@/services/ai/guardrails";
import { assembleMemoData } from "@/services/ai/memo";

const M = MICRO_PER_CREDIT;
const NOW = new Date("2026-08-05T12:00:00Z");
const FUTURE_ISO = "2026-10-01T17:00:00Z";

function draft(overrides: Partial<Parameters<typeof checkGuardrails>[0]> = {}) {
  return {
    question: "Will the console build ship by October 31, 2026?",
    description: "The date on the public roadmap.",
    resolutionCriteria: "Resolves YES if the build is live on two storefronts by Oct 31.",
    resolutionSource: "Storefront listings.",
    closeAtIso: FUTURE_ISO,
    outcomes: ["Yes", "No"],
    ...overrides,
  };
}

describe("guardrails (SPEC §7, enforced in code — D19)", () => {
  it("passes a clean ship-date draft", () => {
    expect(checkGuardrails(draft(), NOW)).toEqual([]);
  });

  it("blocks earnings/MNPI, employment, and M&A questions", () => {
    expect(
      checkGuardrails(draft({ question: "Will we beat earnings expectations in Q3?" }), NOW).join(" "),
    ).toMatch(/MNPI/);
    expect(
      checkGuardrails(draft({ question: "Will there be layoffs before December?" }), NOW).join(" "),
    ).toMatch(/employment/);
    expect(
      checkGuardrails(draft({ description: "Rumors of a merger with a competitor." }), NOW).join(" "),
    ).toMatch(/M&A/);
  });

  it("rejects structural problems: past close, bad outcome counts, duplicates", () => {
    expect(checkGuardrails(draft({ closeAtIso: "2026-01-01T00:00:00Z" }), NOW).join(" ")).toMatch(
      /future/,
    );
    expect(checkGuardrails(draft({ closeAtIso: "not-a-date" }), NOW).join(" ")).toMatch(/valid date/);
    expect(checkGuardrails(draft({ outcomes: ["Yes"] }), NOW).join(" ")).toMatch(/2–10/);
    expect(
      checkGuardrails(draft({ outcomes: Array.from({ length: 11 }, (_, i) => `O${i}`) }), NOW).join(" "),
    ).toMatch(/2–10/);
    expect(checkGuardrails(draft({ outcomes: ["Yes", "yes"] }), NOW).join(" ")).toMatch(/distinct/);
  });
});

describe("memo data assembly (deterministic figures — D19)", () => {
  const ORG = "org-test";
  let db: Db;

  beforeEach(async () => {
    db = await createTestDb();
    await db.insert(orgs).values({ id: ORG, name: "Test Org" });
    await db.insert(users).values({ id: "u-a", email: "ada@test.dev", displayName: "Ada" });
    await db.insert(memberships).values({
      id: "m-a",
      orgId: ORG,
      userId: "u-a",
      role: "admin",
      pseudonym: "Testy Tapir",
    });
    await grantToMembership(db, { orgId: ORG, membershipId: "m-a", amountMicro: 5000 * M });
  });

  it("computes lead price, 7-day delta, closing days, and resolved list", async () => {
    const openId = await createMarketTx(db, {
      orgId: ORG,
      question: "Will the milestone land?",
      resolutionCriteria: "Resolves YES if it lands.",
      resolutionSource: "Tracker.",
      liquidityB: 100,
      closeAt: new Date(NOW.getTime() + 10 * 24 * 3600 * 1000),
      createdBy: "m-a",
      outcomeLabels: ["Yes", "No"],
      at: new Date(NOW.getTime() - 20 * 24 * 3600 * 1000),
    });
    // An old trade sets the 7-day reference at ~65% Yes, a fresh one moves it down.
    await executeTradeTx(db, {
      orgId: ORG, marketId: openId, membershipId: "m-a", outcomeIdx: 0,
      deltaMicroShares: 62 * M, idempotencyKey: "old",
      at: new Date(NOW.getTime() - 9 * 24 * 3600 * 1000),
    });
    await executeTradeTx(db, {
      orgId: ORG, marketId: openId, membershipId: "m-a", outcomeIdx: 1,
      deltaMicroShares: 90 * M, idempotencyKey: "new",
      at: new Date(NOW.getTime() - 1 * 24 * 3600 * 1000),
    });

    const resolvedId = await createMarketTx(db, {
      orgId: ORG,
      question: "Did the demo happen?",
      resolutionCriteria: "Resolves YES if it happened.",
      resolutionSource: "Calendar.",
      liquidityB: 100,
      closeAt: new Date(NOW.getTime() - 5 * 24 * 3600 * 1000),
      createdBy: "m-a",
      outcomeLabels: ["Yes", "No"],
      at: new Date(NOW.getTime() - 15 * 24 * 3600 * 1000),
    });
    await resolveMarketTx(db, {
      orgId: ORG, marketId: resolvedId, winningOutcomeIdx: 1,
      resolvedBy: "m-a", evidence: "It did not.", at: new Date(NOW.getTime() - 4 * 24 * 3600 * 1000),
    });

    const markets = await listMarkets(db, ORG);
    const histories = new Map<string, PricePoint[]>();
    for (const m of markets) histories.set(m.id, await priceHistory(db, m.id));
    const data = assembleMemoData(markets, histories, NOW);

    expect(data.open).toHaveLength(1);
    const memoRow = data.open[0]!;
    expect(memoRow.leadLabel).toBe("Yes");
    expect(memoRow.closesInDays).toBe(10);
    expect(memoRow.deltaPts7d).not.toBeNull();
    expect(memoRow.deltaPts7d!).toBeLessThan(0); // belief fell this week
    expect(data.resolved).toEqual([{ question: "Did the demo happen?", winner: "No" }]);
  });
});
