# Contributing to OrgMarket

Thanks for helping. A few things make reviews fast.

## Setup

```sh
npm install
npm run dev -w @orgmarket/web   # embedded DB + demo org, no config needed
npm run typecheck
npm test
```

## Ground rules

1. **Read [docs/CONTEXT.md](docs/CONTEXT.md) before changing behavior.** It is
   the decision log. If your change reverses or extends a decision, add a new
   entry (`D21`, …) explaining the reasoning in the same PR. Never edit old entries.
2. **Ledger invariants are not negotiable** (see [CLAUDE.md](CLAUDE.md)): integer
   micro-credits only, rounding in the house's favor, balanced journal entries,
   escrow sweeps to zero, no shorting. The property tests in
   `packages/engine/test` are the contract. Don't loosen a tolerance or delete a
   property to make a change pass.
3. **Money-moving code needs tests.** Anything that posts journal entries gets an
   integration test against the in-memory database (`createTestDb()`), and must
   leave `verifyLedgerChain` passing.
4. **No new infrastructure without a decision entry.** Adding Redis, a queue, or
   another datastore makes every self-hoster run it, so argue for it in CONTEXT.md.
5. **Pseudonymity is a feature with legal weight.** Any change that shows or
   exports identity next to trading activity needs explicit discussion in the PR.

## Pull requests

- Keep PRs focused. Describe the user-visible change and how you verified it.
- `npm run typecheck && npm test` must pass, and CI also runs a production build.
- Match the surrounding style: strict TypeScript, ESM, no default exports outside
  Next.js conventions, and comments only for constraints the code can't show.
