import {
  bigint,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Persistence model per SPEC §5. All money/share columns are integer
 * micro-credits / micro-shares (INV-MICRO); bigint columns use JS number mode —
 * amounts stay far below Number.MAX_SAFE_INTEGER at play-money scale.
 */

export interface OrgSettings {
  anonymity: "pseudonymous" | "open";
  /** Email domains auto-provisioned on SSO sign-in (D20). */
  allowedDomains?: string[];
  /** Hours members may dispute a proposed resolution; 0 = settle immediately. */
  challengeWindowHours?: number;
  joinGrantCredits?: number;
  weeklyStipendCredits?: number;
}

export const DEFAULT_ORG_SETTINGS: Required<OrgSettings> = {
  anonymity: "pseudonymous",
  allowedDomains: [],
  challengeWindowHours: 48,
  joinGrantCredits: 1000,
  weeklyStipendCredits: 250,
};

export const orgs = pgTable("orgs", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  settings: jsonb("settings")
    .$type<OrgSettings>()
    .notNull()
    .default({ anonymity: "pseudonymous" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  displayName: text("display_name").notNull(),
});

export const memberships = pgTable(
  "memberships",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull().references(() => orgs.id),
    userId: text("user_id").notNull().references(() => users.id),
    role: text("role", { enum: ["admin", "member"] }).notNull().default("member"),
    pseudonym: text("pseudonym").notNull(),
    /** Cached Slack identity, resolved by workspace-verified email (D18). */
    slackUserId: text("slack_user_id"),
  },
  (t) => [
    uniqueIndex("memberships_org_user").on(t.orgId, t.userId),
    uniqueIndex("memberships_org_pseudonym").on(t.orgId, t.pseudonym),
  ],
);

export const resolutionDisputes = pgTable(
  "resolution_disputes",
  {
    id: text("id").primaryKey(),
    marketId: text("market_id").notNull().references(() => markets.id),
    membershipId: text("membership_id").notNull().references(() => memberships.id),
    reason: text("reason").notNull(),
    status: text("status", { enum: ["open", "dismissed", "upheld"] }).notNull().default("open"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("disputes_market").on(t.marketId)],
);

export const slackConnections = pgTable("slack_connections", {
  orgId: text("org_id").primaryKey().references(() => orgs.id),
  teamId: text("team_id").notNull().unique(),
  /** Plaintext in v0.1; encrypt at rest before external pilots (SPEC §6). */
  botToken: text("bot_token").notNull(),
  channelId: text("channel_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const accounts = pgTable(
  "accounts",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull().references(() => orgs.id),
    kind: text("kind", { enum: ["treasury", "user", "escrow"] }).notNull(),
    /** membershipId for user accounts, marketId for escrow, orgId for treasury. */
    refId: text("ref_id").notNull(),
    balanceMicro: bigint("balance_micro", { mode: "number" }).notNull().default(0),
  },
  (t) => [uniqueIndex("accounts_org_kind_ref").on(t.orgId, t.kind, t.refId)],
);

export const journalEntries = pgTable(
  "journal_entries",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull().references(() => orgs.id),
    kind: text("kind", { enum: ["grant", "trade", "resolution"] }).notNull(),
    meta: jsonb("meta").$type<Record<string, unknown>>(),
    /** Per-org hash chain (D20): seq is gapless, hash = sha256(prevHash ‖ canonical entry). */
    seq: bigint("seq", { mode: "number" }).notNull(),
    prevHash: text("prev_hash").notNull(),
    hash: text("hash").notNull(),
    /** Makes scheduled grants (stipends) idempotent. */
    idempotencyKey: text("idempotency_key").unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("journal_org_seq").on(t.orgId, t.seq)],
);

export const ledgerHeads = pgTable("ledger_heads", {
  orgId: text("org_id").primaryKey().references(() => orgs.id),
  seq: bigint("seq", { mode: "number" }).notNull(),
  headHash: text("head_hash").notNull(),
});

export const postings = pgTable(
  "postings",
  {
    id: text("id").primaryKey(),
    entryId: text("entry_id").notNull().references(() => journalEntries.id),
    accountId: text("account_id").notNull().references(() => accounts.id),
    amountMicro: bigint("amount_micro", { mode: "number" }).notNull(),
  },
  (t) => [index("postings_entry").on(t.entryId), index("postings_account").on(t.accountId)],
);

export const markets = pgTable("markets", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().references(() => orgs.id),
  question: text("question").notNull(),
  description: text("description").notNull().default(""),
  resolutionCriteria: text("resolution_criteria").notNull(),
  resolutionSource: text("resolution_source").notNull(),
  liquidityB: doublePrecision("liquidity_b").notNull(),
  status: text("status", { enum: ["open", "closed", "resolving", "resolved"] })
    .notNull()
    .default("open"),
  closeAt: timestamp("close_at", { withTimezone: true }).notNull(),
  createdBy: text("created_by").notNull().references(() => memberships.id),
  /** Proposed resolution awaiting its challenge window (D20). */
  proposedOutcomeIdx: integer("proposed_outcome_idx"),
  proposedBy: text("proposed_by").references(() => memberships.id),
  proposedEvidence: text("proposed_evidence"),
  challengeEndsAt: timestamp("challenge_ends_at", { withTimezone: true }),
  resolvedOutcomeIdx: integer("resolved_outcome_idx"),
  resolvedBy: text("resolved_by").references(() => memberships.id),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolutionEvidence: text("resolution_evidence"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const marketOutcomes = pgTable(
  "market_outcomes",
  {
    id: text("id").primaryKey(),
    marketId: text("market_id").notNull().references(() => markets.id),
    idx: integer("idx").notNull(),
    label: text("label").notNull(),
    qMicroShares: bigint("q_micro_shares", { mode: "number" }).notNull().default(0),
  },
  (t) => [uniqueIndex("outcomes_market_idx").on(t.marketId, t.idx)],
);

export const trades = pgTable(
  "trades",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull().references(() => orgs.id),
    marketId: text("market_id").notNull().references(() => markets.id),
    membershipId: text("membership_id").notNull().references(() => memberships.id),
    outcomeIdx: integer("outcome_idx").notNull(),
    deltaMicroShares: bigint("delta_micro_shares", { mode: "number" }).notNull(),
    costMicro: bigint("cost_micro", { mode: "number" }).notNull(),
    /** Full post-trade price vector, for charts and calibration scoring. */
    postPrices: jsonb("post_prices").$type<number[]>().notNull(),
    /** Optional anonymous "why", shown under the trader's pseudonym (D20). */
    rationale: text("rationale"),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("trades_idempotency").on(t.idempotencyKey),
    index("trades_market").on(t.marketId),
    index("trades_membership").on(t.membershipId),
  ],
);

export const positions = pgTable(
  "positions",
  {
    marketId: text("market_id").notNull().references(() => markets.id),
    membershipId: text("membership_id").notNull().references(() => memberships.id),
    outcomeIdx: integer("outcome_idx").notNull(),
    microShares: bigint("micro_shares", { mode: "number" }).notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.marketId, t.membershipId, t.outcomeIdx] })],
);
