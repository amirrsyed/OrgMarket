# CLAUDE.md — OrgMarket

## Read first
1. `docs/CONTEXT.md` — founding decisions and why they were made. Append new decisions
   to its Decision Log; never rewrite history there.
2. `SPEC.md` — canonical product/engineering spec.

## Commands
- `npm test` — all workspace tests (Vitest, includes fast-check property tests)
- `npm run typecheck` — strict TS across workspaces
- Engine only: `npm test -w packages/engine`

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
- Engine (`packages/engine`) stays pure: no I/O, no DB, no Date.now, deterministic.

## Working rules
- Use plan mode before changes to the engine or (future) DB schema.
- The property tests in `packages/engine/test` are the contract. Never loosen a
  tolerance or delete a property to make a change pass — that's a decision for the
  founder, recorded in `docs/CONTEXT.md`.
- Trades in the future web app must serialize per market (`SELECT … FOR UPDATE` on the
  market row) and carry idempotency keys. See SPEC §5.
- TypeScript strict; ESM everywhere; no default exports.
