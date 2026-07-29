import { beforeEach, describe, expect, it } from "vitest";
import { MICRO_PER_CREDIT, worstCaseLossMicro } from "@orgmarket/engine";
import { createTestDb, type Db } from "@/db";
import { accounts, memberships, orgs, users } from "@/db/schema";
import {
  createMarketTx,
  executeTradeTx,
  getBalanceMicro,
  getLeaderboard,
  getMarket,
  grantToMembership,
  previewTrade,
  resolveMarketTx,
} from "@/services/trading";

const M = MICRO_PER_CREDIT;
const ORG = "org-test";
const FUTURE = new Date(Date.now() + 30 * 24 * 3600 * 1000);

let db: Db;

async function totalBalanceMicro(): Promise<number> {
  const rows = await db.select().from(accounts);
  return rows.reduce((s, a) => s + a.balanceMicro, 0);
}

async function escrowBalance(marketId: string): Promise<number> {
  const rows = await db.select().from(accounts);
  return rows.find((a) => a.kind === "escrow" && a.refId === marketId)?.balanceMicro ?? 0;
}

beforeEach(async () => {
  db = await createTestDb();
  await db.insert(orgs).values({ id: ORG, name: "Test Org" });
  for (const [user, mem, name] of [
    ["u-a", "m-a", "Ada"],
    ["u-b", "m-b", "Ben"],
  ] as const) {
    await db.insert(users).values({ id: user, email: `${user}@test.dev`, displayName: name });
    await db.insert(memberships).values({
      id: mem,
      orgId: ORG,
      userId: user,
      role: "member",
      pseudonym: `pseud-${name}`,
    });
    await grantToMembership(db, { orgId: ORG, membershipId: mem, amountMicro: 1000 * M });
  }
});

async function makeMarket(overrides: Partial<Parameters<typeof createMarketTx>[1]> = {}) {
  return createMarketTx(db, {
    orgId: ORG,
    question: "Will the thing happen by the date?",
    resolutionCriteria: "Resolves YES if the thing happens.",
    resolutionSource: "The dashboard.",
    liquidityB: 100,
    closeAt: FUTURE,
    createdBy: "m-a",
    outcomeLabels: ["Yes", "No"],
    ...overrides,
  });
}

describe("trading service", () => {
  it("executes a trade: balance moves, escrow holds it, money is conserved", async () => {
    const marketId = await makeMarket();
    const r = await executeTradeTx(db, {
      orgId: ORG,
      marketId,
      membershipId: "m-a",
      outcomeIdx: 0,
      deltaMicroShares: 50 * M,
      idempotencyKey: "t1",
    });
    expect(r.replayed).toBe(false);
    expect(r.costMicro).toBeGreaterThan(0);
    expect(await getBalanceMicro(db, ORG, "m-a")).toBe(1000 * M - r.costMicro);
    expect(await escrowBalance(marketId)).toBe(r.costMicro);
    expect(await totalBalanceMicro()).toBe(0);
    const market = await getMarket(db, ORG, marketId);
    expect(market!.outcomes[0]!.qMicroShares).toBe(50 * M);
    expect(market!.prices[0]!).toBeGreaterThan(0.5);
  });

  it("replays an idempotency key without double-spending", async () => {
    const marketId = await makeMarket();
    const first = await executeTradeTx(db, {
      orgId: ORG,
      marketId,
      membershipId: "m-a",
      outcomeIdx: 0,
      deltaMicroShares: 10 * M,
      idempotencyKey: "same-key",
    });
    const second = await executeTradeTx(db, {
      orgId: ORG,
      marketId,
      membershipId: "m-a",
      outcomeIdx: 0,
      deltaMicroShares: 10 * M,
      idempotencyKey: "same-key",
    });
    expect(second.replayed).toBe(true);
    expect(second.tradeId).toBe(first.tradeId);
    expect(await getBalanceMicro(db, ORG, "m-a")).toBe(1000 * M - first.costMicro);
    const market = await getMarket(db, ORG, marketId);
    expect(market!.outcomes[0]!.qMicroShares).toBe(10 * M);
  });

  it("rejects shorting, unaffordable buys, and trades past close", async () => {
    const marketId = await makeMarket();
    await expect(
      executeTradeTx(db, {
        orgId: ORG,
        marketId,
        membershipId: "m-a",
        outcomeIdx: 0,
        deltaMicroShares: -1 * M,
        idempotencyKey: "short",
      }),
    ).rejects.toThrow(/no shorting/);
    await expect(
      executeTradeTx(db, {
        orgId: ORG,
        marketId,
        membershipId: "m-a",
        outcomeIdx: 0,
        deltaMicroShares: 100_000 * M,
        idempotencyKey: "too-big",
      }),
    ).rejects.toThrow(/insufficient funds/);
    const pastMarket = await makeMarket({ closeAt: new Date(Date.now() - 1000) });
    await expect(
      executeTradeTx(db, {
        orgId: ORG,
        marketId: pastMarket,
        membershipId: "m-a",
        outcomeIdx: 0,
        deltaMicroShares: 1 * M,
        idempotencyKey: "late",
      }),
    ).rejects.toThrow(/close/);
    // A failed trade leaves no residue: conservation still holds.
    expect(await totalBalanceMicro()).toBe(0);
    expect(await getBalanceMicro(db, ORG, "m-a")).toBe(1000 * M);
  });

  it("resolution pays winners, sweeps escrow to zero, keeps treasury loss within b·ln(n)", async () => {
    const marketId = await makeMarket();
    const buyA = await executeTradeTx(db, {
      orgId: ORG,
      marketId,
      membershipId: "m-a",
      outcomeIdx: 0,
      deltaMicroShares: 40 * M,
      idempotencyKey: "a-yes",
    });
    const buyB = await executeTradeTx(db, {
      orgId: ORG,
      marketId,
      membershipId: "m-b",
      outcomeIdx: 1,
      deltaMicroShares: 25 * M,
      idempotencyKey: "b-no",
    });
    await resolveMarketTx(db, {
      orgId: ORG,
      marketId,
      winningOutcomeIdx: 0,
      resolvedBy: "m-a",
      evidence: "It happened.",
    });
    expect(await escrowBalance(marketId)).toBe(0);
    expect(await totalBalanceMicro()).toBe(0);
    expect(await getBalanceMicro(db, ORG, "m-a")).toBe(1000 * M - buyA.costMicro + 40 * M);
    expect(await getBalanceMicro(db, ORG, "m-b")).toBe(1000 * M - buyB.costMicro);
    const treasuryRow = (await db.select().from(accounts)).find((a) => a.kind === "treasury")!;
    // Treasury issued 2000 credits of grants; its extra loss from this market
    // is bounded by the LMSR worst case.
    expect(treasuryRow.balanceMicro).toBeGreaterThanOrEqual(
      -2000 * M - worstCaseLossMicro(2, 100),
    );
    await expect(
      resolveMarketTx(db, {
        orgId: ORG,
        marketId,
        winningOutcomeIdx: 1,
        resolvedBy: "m-a",
        evidence: "again",
      }),
    ).rejects.toThrow(/already resolved/);
    await expect(
      executeTradeTx(db, {
        orgId: ORG,
        marketId,
        membershipId: "m-a",
        outcomeIdx: 0,
        deltaMicroShares: 1 * M,
        idempotencyKey: "after-resolve",
      }),
    ).rejects.toThrow(/resolved/);
  });

  it("preview lands the market on the target and respects the budget clamp", async () => {
    const marketId = await makeMarket();
    const preview = await previewTrade(db, {
      orgId: ORG,
      marketId,
      membershipId: "m-a",
      outcomeIdx: 0,
      targetProb: 0.65,
    });
    expect(preview.deltaMicroShares).toBeGreaterThan(0);
    expect(preview.newProb).toBeCloseTo(0.65, 3);
    await executeTradeTx(db, {
      orgId: ORG,
      marketId,
      membershipId: "m-a",
      outcomeIdx: preview.outcomeIdx,
      deltaMicroShares: preview.deltaMicroShares,
      idempotencyKey: "to-65",
    });
    const market = await getMarket(db, ORG, marketId);
    expect(market!.prices[0]!).toBeCloseTo(0.65, 3);
    // On a deep market, 50% → 99.9% costs b·ln(0.5/0.001) ≈ ₥1,554 — more
    // than the ₥1,000 balance, so the preview must clamp to budget.
    const deepMarket = await makeMarket({ liquidityB: 250 });
    const capped = await previewTrade(db, {
      orgId: ORG,
      marketId: deepMarket,
      membershipId: "m-b",
      outcomeIdx: 0,
      targetProb: 0.999,
    });
    expect(capped.cappedBy).toBe("budget");
    expect(capped.costMicro).toBeLessThanOrEqual(1000 * M);
    expect(1000 * M - capped.costMicro).toBeLessThanOrEqual(10); // budget fully spent
  });

  it("binary down-moves with no holdings buy the complement outcome", async () => {
    const marketId = await makeMarket();
    const preview = await previewTrade(db, {
      orgId: ORG,
      marketId,
      membershipId: "m-a",
      outcomeIdx: 0,
      targetProb: 0.3,
    });
    expect(preview.outcomeIdx).toBe(1);
    expect(preview.deltaMicroShares).toBeGreaterThan(0);
    expect(preview.newProb).toBeCloseTo(0.3, 3);
  });

  it("scores calibration on the leaderboard after resolution", async () => {
    const marketId = await makeMarket();
    // Ada buys YES to 70%, Ben buys NO to 60% (YES→40%); market resolves NO.
    const a = await previewTrade(db, { orgId: ORG, marketId, membershipId: "m-a", outcomeIdx: 0, targetProb: 0.7 });
    await executeTradeTx(db, { orgId: ORG, marketId, membershipId: "m-a", outcomeIdx: a.outcomeIdx, deltaMicroShares: a.deltaMicroShares, idempotencyKey: "cal-a" });
    const b = await previewTrade(db, { orgId: ORG, marketId, membershipId: "m-b", outcomeIdx: 1, targetProb: 0.6 });
    await executeTradeTx(db, { orgId: ORG, marketId, membershipId: "m-b", outcomeIdx: b.outcomeIdx, deltaMicroShares: b.deltaMicroShares, idempotencyKey: "cal-b" });
    await resolveMarketTx(db, { orgId: ORG, marketId, winningOutcomeIdx: 1, resolvedBy: "m-a", evidence: "Did not happen." });
    const rows = await getLeaderboard(db, ORG);
    const ada = rows.find((r) => r.membershipId === "m-a")!;
    const ben = rows.find((r) => r.membershipId === "m-b")!;
    expect(ada.brier).not.toBeNull();
    expect(ben.brier).not.toBeNull();
    expect(ben.brier!).toBeLessThan(ada.brier!); // Ben was right
    expect(rows[0]!.membershipId).toBe("m-b"); // sorted by calibration
  });
});
