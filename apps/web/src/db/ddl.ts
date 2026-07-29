/**
 * Idempotent DDL mirroring schema.ts, applied at boot (CREATE TABLE IF NOT
 * EXISTS). Hand-written for now — the service tests exercise every table
 * through Drizzle, so schema drift fails the suite. Replace with drizzle-kit
 * migrations before the first externally-hosted deployment.
 */
export const DDL: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS orgs (
    id text PRIMARY KEY,
    name text NOT NULL,
    settings jsonb NOT NULL DEFAULT '{"anonymity":"pseudonymous"}',
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS users (
    id text PRIMARY KEY,
    email text NOT NULL UNIQUE,
    display_name text NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS memberships (
    id text PRIMARY KEY,
    org_id text NOT NULL REFERENCES orgs(id),
    user_id text NOT NULL REFERENCES users(id),
    role text NOT NULL DEFAULT 'member',
    pseudonym text NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS memberships_org_user ON memberships (org_id, user_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS memberships_org_pseudonym ON memberships (org_id, pseudonym)`,
  `CREATE TABLE IF NOT EXISTS accounts (
    id text PRIMARY KEY,
    org_id text NOT NULL REFERENCES orgs(id),
    kind text NOT NULL,
    ref_id text NOT NULL,
    balance_micro bigint NOT NULL DEFAULT 0
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS accounts_org_kind_ref ON accounts (org_id, kind, ref_id)`,
  `CREATE TABLE IF NOT EXISTS journal_entries (
    id text PRIMARY KEY,
    org_id text NOT NULL REFERENCES orgs(id),
    kind text NOT NULL,
    meta jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS postings (
    id text PRIMARY KEY,
    entry_id text NOT NULL REFERENCES journal_entries(id),
    account_id text NOT NULL REFERENCES accounts(id),
    amount_micro bigint NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS postings_entry ON postings (entry_id)`,
  `CREATE INDEX IF NOT EXISTS postings_account ON postings (account_id)`,
  `CREATE TABLE IF NOT EXISTS markets (
    id text PRIMARY KEY,
    org_id text NOT NULL REFERENCES orgs(id),
    question text NOT NULL,
    description text NOT NULL DEFAULT '',
    resolution_criteria text NOT NULL,
    resolution_source text NOT NULL,
    liquidity_b double precision NOT NULL,
    status text NOT NULL DEFAULT 'open',
    close_at timestamptz NOT NULL,
    created_by text NOT NULL REFERENCES memberships(id),
    resolved_outcome_idx integer,
    resolved_by text REFERENCES memberships(id),
    resolved_at timestamptz,
    resolution_evidence text,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS market_outcomes (
    id text PRIMARY KEY,
    market_id text NOT NULL REFERENCES markets(id),
    idx integer NOT NULL,
    label text NOT NULL,
    q_micro_shares bigint NOT NULL DEFAULT 0
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS outcomes_market_idx ON market_outcomes (market_id, idx)`,
  `CREATE TABLE IF NOT EXISTS trades (
    id text PRIMARY KEY,
    org_id text NOT NULL REFERENCES orgs(id),
    market_id text NOT NULL REFERENCES markets(id),
    membership_id text NOT NULL REFERENCES memberships(id),
    outcome_idx integer NOT NULL,
    delta_micro_shares bigint NOT NULL,
    cost_micro bigint NOT NULL,
    post_prices jsonb NOT NULL,
    idempotency_key text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS trades_idempotency ON trades (idempotency_key)`,
  `CREATE INDEX IF NOT EXISTS trades_market ON trades (market_id)`,
  `CREATE INDEX IF NOT EXISTS trades_membership ON trades (membership_id)`,
  `CREATE TABLE IF NOT EXISTS positions (
    market_id text NOT NULL REFERENCES markets(id),
    membership_id text NOT NULL REFERENCES memberships(id),
    outcome_idx integer NOT NULL,
    micro_shares bigint NOT NULL DEFAULT 0,
    PRIMARY KEY (market_id, membership_id, outcome_idx)
  )`,
];
