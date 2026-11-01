import { beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { MICRO_PER_CREDIT } from "@orgmarket/engine";
import { createTestDb, type Db } from "@/db";
import { accounts, journalEntries, markets, memberships, orgs, postings, trades, users } from "@/db/schema";
import {
  createMarketTx,
  disputeResolutionTx,
  executeTradeTx,
  finalizeResolutionTx,
  getBalanceMicro,
  grantToMembership,
  listDisputes,
  listMarkets,
  proposeResolutionTx,
  recentTrades,
} from "@/services/trading";
import { verifyLedgerChain } from "@/services/ledger-chain";
import { isoWeekKey, provisionMemberFromSso, runTick } from "@/services/org";
import { allocatePool, computeSettlement, settlementCsv } from "@/services/settlement";
import { seedIfEmpty } from "@/db/seed";

const M = MICRO_PER_CREDIT;
const ORG = "org-test";
const T0 = new Date("2026-11-01T12:00:00Z");
const hours = (h: number) => new Date(T0.getTime() + h * 3600 * 1000);

let db: Db;

async function addMember(id: string, role: "admin" | "member" = "member") {
  await db.insert(users).values({ id: `u-${id}`, email: `${id}@test.dev`, displayName: id });
  await db.insert(memberships).values({ id: `m-${id}`, orgId: ORG, userId: `u-${id}`, role, pseudonym: `p-${id}` });
  await grantToMembership(db, { orgId: ORG, membershipId: `m-${id}`, amountMicro: 1000 * M, at: hours(-100) });
}

async function makeMarket(closeAt = hours(24 * 30)) {
  return createMarketTx(db, {
    orgId: ORG,
    question: "Will the milestone land on time?",
    resolutionCriteria: "Resolves YES if it lands.",
    resolutionSource: "Tracker.",
    liquidityB: 100,
    closeAt,
    createdBy: "m-ada",
    outcomeLabels: ["Yes", "No"],
    at: hours(-100),
  });
}

beforeEach(async () => {
  db = await createTestDb();
  await db.insert(orgs).values({ id: ORG, name: "Test Org", settings: { anonymity: "pseudonymous", allowedDomains: ["test.dev"] } });
  await addMember("ada", "admin");
  await addMember("ben");
});

describe("tamper-evident ledger (D20)", () => {
  it("chains every entry and verifies; any edit to history breaks the chain", async () => {
    const marketId = await makeMarket();
    await executeTradeTx(db, { orgId: ORG, marketId, membershipId: "m-ben", outcomeIdx: 0, deltaMicroShares: 20 * M, idempotencyKey: "t1", at: hours(-50) });
    const ok = await verifyLedgerChain(db, ORG);
    expect(ok.ok).toBe(true);
    expect(ok.entries).toBe(3); // two grants + one trade
    const seqs = (await db.select({ seq: journalEntries.seq }).from(journalEntries)).map((r) => r.seq).sort();
    expect(seqs).toEqual([1, 2, 3]);

    // Quietly inflate one historical posting, as a rogue operator might.
    const [p] = await db.select().from(postings).limit(1);
    await db.update(postings).set({ amountMicro: p!.amountMicro + 1 }).where(eq(postings.id, p!.id));
    const broken = await verifyLedgerChain(db, ORG);
    expect(broken.ok).toBe(false);
    expect(broken.brokenAtSeq).not.toBeNull();
  });

  it("detects a deleted entry via the sequence and head", async () => {
    await grantToMembership(db, { orgId: ORG, membershipId: "m-ben", amountMicro: 5 * M, at: hours(-10) });
    const [last] = await db.select().from(journalEntries).where(eq(journalEntries.seq, 3));
    await db.delete(postings).where(eq(postings.entryId, last!.id));
    await db.delete(journalEntries).where(eq(journalEntries.id, last!.id));
    expect((await verifyLedgerChain(db, ORG)).ok).toBe(false);
  });
});

describe("resolution challenge window (D20)", () => {
  it("propose stops trading and holds payout until the window closes", async () => {
    const marketId = await makeMarket();
    await executeTradeTx(db, { orgId: ORG, marketId, membershipId: "m-ben", outcomeIdx: 0, deltaMicroShares: 30 * M, idempotencyKey: "t1", at: hours(-5) });
    const balanceBefore = await getBalanceMicro(db, ORG, "m-ben");

    const proposal = await proposeResolutionTx(db, { orgId: ORG, marketId, winningOutcomeIdx: 0, proposedBy: "m-ada", evidence: "It landed.", challengeWindowHours: 48, at: T0 });
    expect(proposal.finalized).toBe(false);
    await expect(
      executeTradeTx(db, { orgId: ORG, marketId, membershipId: "m-ben", outcomeIdx: 0, deltaMicroShares: M, idempotencyKey: "t2", at: hours(1) }),
    ).rejects.toThrow(/resolving/);
    await expect(finalizeResolutionTx(db, { orgId: ORG, marketId, finalizedBy: "m-ada", at: hours(10) })).rejects.toThrow(/still open/);
    expect(await getBalanceMicro(db, ORG, "m-ben")).toBe(balanceBefore);

    await finalizeResolutionTx(db, { orgId: ORG, marketId, finalizedBy: "m-ada", at: hours(49) });
    expect(await getBalanceMicro(db, ORG, "m-ben")).toBe(balanceBefore + 30 * M);
    expect((await verifyLedgerChain(db, ORG)).ok).toBe(true);
  });

  it("an open dispute blocks finalization until an admin overrides or revises", async () => {
    const marketId = await makeMarket();
    await proposeResolutionTx(db, { orgId: ORG, marketId, winningOutcomeIdx: 0, proposedBy: "m-ada", evidence: "It landed.", challengeWindowHours: 48, at: T0 });
    await disputeResolutionTx(db, { orgId: ORG, marketId, membershipId: "m-ben", reason: "The tracker shows it slipped a week.", at: hours(2) });
    await expect(
      disputeResolutionTx(db, { orgId: ORG, marketId, membershipId: "m-ben", reason: "Filing the same thing twice.", at: hours(3) }),
    ).rejects.toThrow(/already/);
    await expect(
      disputeResolutionTx(db, { orgId: ORG, marketId, membershipId: "m-ada", reason: "Too late to the party here.", at: hours(49) }),
    ).rejects.toThrow(/closed/);
    await expect(finalizeResolutionTx(db, { orgId: ORG, marketId, finalizedBy: "m-ada", at: hours(49) })).rejects.toThrow(/dispute/);

    // The scheduled tick must not settle a disputed market.
    const tick = await runTick(db, hours(50));
    expect(tick.finalized).toHaveLength(0);

    // Admin revises to No: the dispute is upheld and the window restarts.
    await proposeResolutionTx(db, { orgId: ORG, marketId, winningOutcomeIdx: 1, proposedBy: "m-ada", evidence: "Slipped per tracker.", challengeWindowHours: 48, at: hours(51) });
    expect((await listDisputes(db, marketId))[0]!.status).toBe("upheld");
    const tick2 = await runTick(db, hours(100));
    expect(tick2.finalized.map((f) => f.marketId)).toEqual([marketId]);
    const [row] = await db.select().from(markets).where(eq(markets.id, marketId));
    expect(row!.status).toBe("resolved");
    expect(row!.resolvedOutcomeIdx).toBe(1);
  });

  it("override settles despite disputes and dismisses them; window 0 settles at once", async () => {
    const a = await makeMarket();
    await proposeResolutionTx(db, { orgId: ORG, marketId: a, winningOutcomeIdx: 0, proposedBy: "m-ada", evidence: "It landed.", challengeWindowHours: 48, at: T0 });
    await disputeResolutionTx(db, { orgId: ORG, marketId: a, membershipId: "m-ben", reason: "I disagree with the reading of the source.", at: hours(1) });
    await finalizeResolutionTx(db, { orgId: ORG, marketId: a, finalizedBy: "m-ada", overrideDisputes: true, at: hours(2) });
    expect((await listDisputes(db, a))[0]!.status).toBe("dismissed");

    const b = await makeMarket();
    const result = await proposeResolutionTx(db, { orgId: ORG, marketId: b, winningOutcomeIdx: 1, proposedBy: "m-ada", evidence: "Did not land.", challengeWindowHours: 0, at: T0 });
    expect(result.finalized).toBe(true);
  });
});

describe("why feed (D20)", () => {
  it("stores a trimmed rationale, shows it in activity, and rejects over-long text", async () => {
    const marketId = await makeMarket();
    await executeTradeTx(db, { orgId: ORG, marketId, membershipId: "m-ben", outcomeIdx: 1, deltaMicroShares: 5 * M, idempotencyKey: "r1", at: hours(-3), rationale: "  Vendor API is 3 weeks behind.  " });
    const [activity] = await recentTrades(db, marketId);
    expect(activity!.rationale).toBe("Vendor API is 3 weeks behind.");
    await expect(
      executeTradeTx(db, { orgId: ORG, marketId, membershipId: "m-ben", outcomeIdx: 1, deltaMicroShares: M, idempotencyKey: "r2", at: hours(-2), rationale: "x".repeat(281) }),
    ).rejects.toThrow(/280/);
    expect((await db.select().from(trades)).length).toBe(1);
  });
});

describe("scheduled tick (D20)", () => {
  it("closes expired markets and pays exactly one stipend per member per ISO week", async () => {
    await makeMarket(hours(-1));
    const first = await runTick(db, T0);
    expect(first.closed).toBe(1);
    expect(first.stipendsPaid).toBe(2);
    const again = await runTick(db, hours(1));
    expect(again.closed).toBe(0);
    expect(again.stipendsPaid).toBe(0);
    const nextWeek = await runTick(db, hours(24 * 7));
    expect(nextWeek.stipendsPaid).toBe(2);
    expect((await verifyLedgerChain(db, ORG)).ok).toBe(true);
    expect(isoWeekKey(new Date("2026-01-01T00:00:00Z"))).toBe("2026-W01");
    expect(isoWeekKey(new Date("2024-12-30T00:00:00Z"))).toBe("2025-W01");
  });
});

describe("SSO provisioning (D20)", () => {
  it("auto-provisions allowed domains with a join grant, reuses existing members, rejects others", async () => {
    const created = await provisionMemberFromSso(db, { email: "New.Person@Test.dev", name: "New Person" });
    expect(created?.created).toBe(true);
    expect(await getBalanceMicro(db, ORG, created!.membershipId)).toBe(1000 * M);
    const again = await provisionMemberFromSso(db, { email: "new.person@test.dev" });
    expect(again).toEqual({ membershipId: created!.membershipId, created: false });
    expect(await provisionMemberFromSso(db, { email: "outsider@elsewhere.com" })).toBeNull();
    const [m] = await db.select().from(memberships).where(eq(memberships.id, created!.membershipId));
    expect(m!.pseudonym).toMatch(/^[A-Z]\w+ [A-Z]\w+/);
  });
});

describe("season settlement (D20)", () => {
  it("splits a fixed pool pro rata on positive profit", () => {
    const out = allocatePool(
      [
        { key: "a", profitMicro: 300 },
        { key: "b", profitMicro: 100 },
        { key: "c", profitMicro: -50 },
      ],
      10_000,
      1,
    );
    expect(out.get("a")).toBe(7_500);
    expect(out.get("b")).toBe(2_500);
    expect(out.has("c")).toBe(false);
  });

  it("caps any one person without re-spreading the excess to weaker forecasters", () => {
    const out = allocatePool(
      [
        { key: "whale", profitMicro: 9_000 },
        { key: "b", profitMicro: 600 },
        { key: "c", profitMicro: 400 },
      ],
      10_000,
      0.5,
    );
    expect(out.get("whale")).toBe(5_000);
    expect(out.get("b")).toBe(600);
    expect(out.get("c")).toBe(400);
  });

  it("keeps payouts ordered by profit in small capped groups (no flattening)", () => {
    const out = allocatePool(
      [
        { key: "a", profitMicro: 19_23 },
        { key: "b", profitMicro: 17_28 },
        { key: "c", profitMicro: 8_75 },
        { key: "d", profitMicro: 7_82 },
      ],
      500_000,
      0.25,
    );
    const [a, b, c, d] = ["a", "b", "c", "d"].map((k) => out.get(k)!);
    expect(a).toBe(125_000);
    expect(b).toBe(125_000);
    expect(c!).toBeGreaterThan(d!);
    expect(c!).toBeLessThan(125_000);
  });

  it("never exceeds the pool and distributes rounding cents exactly", () => {
    const out = allocatePool([{ key: "solo", profitMicro: 42 }], 10_000, 0.25);
    expect(out.get("solo")).toBe(2_500);
    const odd = allocatePool([{ key: "a", profitMicro: 1 }, { key: "b", profitMicro: 1 }, { key: "c", profitMicro: 1 }], 100, 1);
    expect([...odd.values()].reduce((s, v) => s + v, 0)).toBe(100);
  });

  it("computes from the database and exports email + payout only", async () => {
    const marketId = await makeMarket();
    await executeTradeTx(db, { orgId: ORG, marketId, membershipId: "m-ben", outcomeIdx: 0, deltaMicroShares: 50 * M, idempotencyKey: "s1", at: hours(-5) });
    await proposeResolutionTx(db, { orgId: ORG, marketId, winningOutcomeIdx: 0, proposedBy: "m-ada", evidence: "Landed.", challengeWindowHours: 0, at: T0 });
    const { rows, allocatedCents } = await computeSettlement(db, ORG, { poolCents: 50_000, capShare: 1 });
    const ben = rows.find((r) => r.membershipId === "m-ben")!;
    expect(ben.profitMicro).toBeGreaterThan(0);
    expect(ben.payoutCents).toBe(50_000);
    expect(allocatedCents).toBe(50_000);
    const csv = settlementCsv(rows);
    expect(csv).toBe('email,payout\n"ben@test.dev",500.00\n');
    expect(csv).not.toContain("p-ben");
  });
});

describe("demo seed", () => {
  it("builds the demo org with a resolving market and a verifiable ledger", async () => {
    const fresh = await createTestDb();
    await seedIfEmpty(fresh, T0);
    const all = await fresh.select().from(markets);
    const statuses = all.map((m) => m.status).sort();
    expect(statuses).toEqual(["open", "open", "open", "resolved", "resolving"]);
    // The wedge story: insiders' money says the roadmap date slips.
    const ship = (await listMarkets(fresh, "org-meridian")).find((m) => m.question.includes("Starfall: Reckoning"))!;
    expect(ship.prices[0]!).toBeLessThan(0.4);
    expect(ship.prices[0]!).toBeGreaterThan(0.3);
    expect((await verifyLedgerChain(fresh, "org-meridian")).ok).toBe(true);
    const total = await fresh.select({ s: sql<string>`sum(${accounts.balanceMicro})` }).from(accounts);
    expect(Number(total[0]!.s)).toBe(0);
  });
});
