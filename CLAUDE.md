# CLAUDE.md — OrgMarket

## Read first
1. `docs/CONTEXT.md` — decision log (D1–D20) and the reasoning behind each decision.
   Append new decisions; never rewrite history there.
2. `SPEC.md` — canonical product/engineering spec.

## Commands
- `npm run dev -w @orgmarket/web` — local app (embedded PGlite, seeded demo, demo login)
- `npm test` — all workspace tests (Vitest, includes fast-check property tests)
- `npm run typecheck` — strict TS across workspaces
- `npm run build -w @orgmarket/web` — production build (CI runs this)
- `docker compose up --build` — self-hosted stack (app + Postgres + scheduler)

## Invariants (violating these silently mints or burns money)
- **INV-MICRO**: every ledger amount is an integer micro-credit (1 ₥ = 1e6 micro).
  No floats in or out of the ledger, ever. Prices/probabilities are floats for
  display only.
- **INV-ROUND**: trade-cost rounding always favors the house — ceil on buys (min
  +1 micro), never-positive on sales.
- **INV-CONSERVE**: journal entries balance to zero; total of all balances is 0.
  Only `org:treasury` may go negative.
- **INV-ESCROW**: market escrow never negative; exactly 0 after resolution.
- **INV-NOSHORT**: users sell only shares they hold; outstanding shares stay ≥ 0.
- **INV-CHAIN**: every journal entry goes through `postJournal`, which hash-chains it
  per org under the `ledger_heads` row lock. Never insert into `journal_entries` or
  `postings` any other way; `verifyLedgerChain` must pass after every test.
- **INV-SETTLE**: money moves at resolution only through `settleLocked`; admin
  proposals wait out the challenge window unless explicitly overridden.
- Engine (`packages/engine`) stays pure: no I/O, no DB, no Date.now, deterministic.

## Working rules
- Use plan mode before changes to the engine or DB schema. Pre-1.0, schema changes
  are folded into `apps/web/src/db/ddl.ts` + `schema.ts` (dev DBs are reset).
- The property tests in `packages/engine/test` are the contract. Never loosen a
  tolerance or delete a property to make a change pass — that's a decision for the
  founder, recorded in `docs/CONTEXT.md`.
- Trades serialize per market (`SELECT … FOR UPDATE` on the market row) and carry
  idempotency keys; scheduled grants carry journal idempotency keys.
- Auth: `currentMember()` in `src/lib/session.ts` is the only identity source
  (Auth.js SSO session, else dev cookie when `isDevLoginEnabled()`).
- TypeScript strict; ESM everywhere; no default exports outside Next.js conventions.
