import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { MICRO_PER_CREDIT } from "@orgmarket/engine";
import { createTestDb, type Db } from "@/db";
import { memberships, orgs, users } from "@/db/schema";
import { createMarketTx, getBalanceMicro, getMarket, grantToMembership } from "@/services/trading";
import { verifySlackSignature } from "@/services/slack/verify";
import type { SlackClient } from "@/services/slack/client";
import {
  TAP_MAX_SPEND_MICRO,
  digestBlocks,
  marketAnnouncementBlocks,
  referencePrice,
} from "@/services/slack/blocks";
import { handleTap, resolveMembership } from "@/services/slack/interactions";
import { handleCommand } from "@/services/slack/commands";

const M = MICRO_PER_CREDIT;
const ORG = "org-test";
const FUTURE = new Date(Date.now() + 30 * 24 * 3600 * 1000);

class FakeSlackClient implements SlackClient {
  posts: { channel: string; text: string; blocks?: unknown[] }[] = [];
  responses: { url: string; payload: Record<string, unknown> }[] = [];
  constructor(private readonly emails: Record<string, string> = {}) {}
  async postMessage(channel: string, text: string, blocks?: unknown[]): Promise<void> {
    this.posts.push({ channel, text, ...(blocks ? { blocks } : {}) });
  }
  async respond(url: string, payload: Record<string, unknown>): Promise<void> {
    this.responses.push({ url, payload });
  }
  async userEmail(slackUserId: string): Promise<string | null> {
    return this.emails[slackUserId] ?? null;
  }
}

let db: Db;

beforeEach(async () => {
  db = await createTestDb();
  await db.insert(orgs).values({ id: ORG, name: "Test Org" });
  await db.insert(users).values({ id: "u-a", email: "ada@test.dev", displayName: "Ada" });
  await db.insert(memberships).values({
    id: "m-a",
    orgId: ORG,
    userId: "u-a",
    role: "member",
    pseudonym: "Testy Tapir",
  });
  await grantToMembership(db, { orgId: ORG, membershipId: "m-a", amountMicro: 1000 * M });
});

async function makeMarket(liquidityB = 100, labels = ["Yes", "No"]): Promise<string> {
  return createMarketTx(db, {
    orgId: ORG,
    question: "Will the milestone land on time?",
    resolutionCriteria: "Resolves YES if it lands.",
    resolutionSource: "The tracker.",
    liquidityB,
    closeAt: FUTURE,
    createdBy: "m-a",
    outcomeLabels: labels,
  });
}

function tapPayload(marketId: string, target: number, actionTs = "1.001") {
  return {
    type: "block_actions",
    team: { id: "T123" },
    user: { id: "U-ADA" },
    response_url: "https://hooks.slack.test/r1",
    actions: [
      {
        action_id: `tap:${Math.round(target * 100)}`,
        value: JSON.stringify({ marketId, target }),
        action_ts: actionTs,
      },
    ],
  };
}

describe("slack signature verification", () => {
  const secret = "test-signing-secret";
  const body = "payload=%7B%22type%22%3A%22block_actions%22%7D";
  function sign(ts: string, s = secret): string {
    return `v0=${createHmac("sha256", s).update(`v0:${ts}:${body}`).digest("hex")}`;
  }
  const now = 1_800_000_000;

  it("accepts a valid signature and rejects tampering, wrong secrets, and stale timestamps", () => {
    const ts = String(now);
    expect(
      verifySlackSignature({ signingSecret: secret, timestamp: ts, signature: sign(ts), rawBody: body, nowSeconds: now }),
    ).toBe(true);
    expect(
      verifySlackSignature({ signingSecret: secret, timestamp: ts, signature: sign(ts, "wrong"), rawBody: body, nowSeconds: now }),
    ).toBe(false);
    expect(
      verifySlackSignature({ signingSecret: secret, timestamp: ts, signature: sign(ts), rawBody: body + "x", nowSeconds: now }),
    ).toBe(false);
    const stale = String(now - 3600);
    expect(
      verifySlackSignature({ signingSecret: secret, timestamp: stale, signature: sign(stale), rawBody: body, nowSeconds: now }),
    ).toBe(false);
    expect(
      verifySlackSignature({ signingSecret: secret, timestamp: null, signature: sign(ts), rawBody: body, nowSeconds: now }),
    ).toBe(false);
  });
});

describe("block builders", () => {
  it("binary announcements carry five tap buttons plus an open link; categorical only link", async () => {
    const binaryId = await makeMarket();
    const binary = (await getMarket(db, ORG, binaryId))!;
    const blocks = marketAnnouncementBlocks(binary) as { type: string; elements?: { action_id: string }[] }[];
    const actions = blocks.find((b) => b.type === "actions")!;
    const ids = actions.elements!.map((e) => e.action_id);
    expect(ids).toEqual(["tap:15", "tap:35", "tap:50", "tap:65", "tap:85", "open-web"]);

    const catId = await makeMarket(100, ["Steam", "PlayStation", "Xbox"]);
    const cat = (await getMarket(db, ORG, catId))!;
    const catBlocks = marketAnnouncementBlocks(cat) as { type: string; elements?: { action_id: string }[] }[];
    const catActions = catBlocks.find((b) => b.type === "actions")!;
    expect(catActions.elements!.map((e) => e.action_id)).toEqual(["open-web"]);
  });

  it("digest computes week-over-week reference prices", () => {
    const now = new Date("2026-07-30T12:00:00Z");
    const history = [
      { t: "2026-07-15T00:00:00Z", prices: [0.5, 0.5] },
      { t: "2026-07-20T00:00:00Z", prices: [0.55, 0.45] },
      { t: "2026-07-29T00:00:00Z", prices: [0.4, 0.6] },
    ];
    expect(referencePrice(history, 0, now)).toBeCloseTo(0.55, 9); // last point ≥7d old
    const blocks = JSON.stringify(digestBlocks([], now));
    expect(blocks).toContain("No open markets");
  });
});

describe("identity mapping", () => {
  it("maps a Slack user by workspace email and caches the id; unknown emails get nothing", async () => {
    const client = new FakeSlackClient({ "U-ADA": "ada@test.dev", "U-GHOST": "ghost@test.dev" });
    const found = await resolveMembership(db, client, ORG, "U-ADA");
    expect(found?.membershipId).toBe("m-a");
    const [row] = await db.select().from(memberships);
    expect(row!.slackUserId).toBe("U-ADA");
    // Second resolve hits the cache (no email needed).
    const cachedClient = new FakeSlackClient({});
    expect((await resolveMembership(db, cachedClient, ORG, "U-ADA"))?.membershipId).toBe("m-a");
    expect(await resolveMembership(db, client, ORG, "U-GHOST")).toBeNull();
  });
});

describe("one-tap forecasting", () => {
  it("a tap trades toward the bucket, capped at ₥25, and rebuilds the announcement", async () => {
    const marketId = await makeMarket();
    const client = new FakeSlackClient({ "U-ADA": "ada@test.dev" });
    const result = await handleTap(db, client, ORG, tapPayload(marketId, 0.85));
    expect(result.updatedBlocks).not.toBeNull();
    expect(result.ephemeralText).toContain("bought");
    expect(result.ephemeralText).toContain("Capped at ₥25");
    const spent = 1000 * M - (await getBalanceMicro(db, ORG, "m-a"));
    expect(spent).toBeGreaterThan(0);
    expect(spent).toBeLessThanOrEqual(TAP_MAX_SPEND_MICRO);
    const market = (await getMarket(db, ORG, marketId))!;
    expect(market.prices[0]!).toBeGreaterThan(0.5);
    expect(market.prices[0]!).toBeLessThan(0.85); // cap stopped short of the target
  });

  it("a duplicate tap (same action_ts) replays idempotently without double-spending", async () => {
    const marketId = await makeMarket();
    const client = new FakeSlackClient({ "U-ADA": "ada@test.dev" });
    await handleTap(db, client, ORG, tapPayload(marketId, 0.65, "9.999"));
    const balanceAfterFirst = await getBalanceMicro(db, ORG, "m-a");
    await handleTap(db, client, ORG, tapPayload(marketId, 0.65, "9.999"));
    expect(await getBalanceMicro(db, ORG, "m-a")).toBe(balanceAfterFirst);
  });

  it("a down-bucket tap buys No, and unknown Slack users are turned away", async () => {
    const marketId = await makeMarket();
    const client = new FakeSlackClient({ "U-ADA": "ada@test.dev" });
    const result = await handleTap(db, client, ORG, tapPayload(marketId, 0.15));
    expect(result.ephemeralText).toContain("No");
    const market = (await getMarket(db, ORG, marketId))!;
    expect(market.prices[0]!).toBeLessThan(0.5);

    const stranger = new FakeSlackClient({});
    const denied = await handleTap(db, stranger, ORG, {
      ...tapPayload(marketId, 0.5),
      user: { id: "U-NOBODY" },
    });
    expect(denied.ephemeralText).toContain("No OrgMarket account");
    expect(denied.updatedBlocks).toBeNull();
  });
});

describe("slash commands", () => {
  it("`/om list` returns open markets and `/om digest` posts to the channel", async () => {
    await makeMarket();
    const client = new FakeSlackClient({ "U-ADA": "ada@test.dev" });
    const list = await handleCommand(db, client, ORG, "C-CHAN", { text: "", slackUserId: "U-ADA" });
    expect(list.response_type).toBe("ephemeral");
    expect(list.text).toContain("Will the milestone land on time?");

    const digest = await handleCommand(db, client, ORG, "C-CHAN", { text: "digest", slackUserId: "U-ADA" });
    expect(digest.text).toBe("Digest posted.");
    expect(client.posts).toHaveLength(1);
    expect(client.posts[0]!.channel).toBe("C-CHAN");
  });
});
