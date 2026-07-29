# OrgMarket SPEC v1

Canonical product/engineering spec. `docs/CONTEXT.md` records *why* these decisions
were made; this file records *what* to build. Update both when a decision changes.

## 1. Glossary

- **Org-dollar (₥, "credit")** — the play-money unit management allocates. Never real money.
- **Micro-credit (micro)** — 1/1,000,000 of a credit. **All ledger amounts are integer
  micro-credits.** 1 winning share pays exactly 1 credit = 1,000,000 micro.
- **Share** — a claim paying 1 ₥ if its outcome wins, 0 otherwise. Stored as integer
  **micro-shares**; 1 micro-share pays 1 micro-credit.
- **Market** — a question with 2–10 mutually exclusive outcomes, a resolution rule,
  a resolution source, and a close date.
- **Liquidity `b`** — LMSR depth parameter in credits. Operator's worst-case subsidy
  for a market is `b·ln(n)` credits.

## 2. Mechanism (LMSR)

- Cost function `C(q) = b · ln(Σᵢ e^{qᵢ/b})` (credits; qᵢ in shares). Computed with
  log-sum-exp for stability.
- Instantaneous price of outcome i: `pᵢ = e^{qᵢ/b} / Σⱼ e^{qⱼ/b}`. Prices are floats,
  **display-only** — never stored in the ledger.
- Trade cost = `C(q_after) − C(q_before)`, converted to micro-credits and rounded
  **against the trader**: `ceil` overall, with a floor of +1 micro on any real buy and
  a cap of 0 on any sale (float noise must never pay a seller to buy or charge them to
  sell). The house never loses to rounding.
- **No shorting.** Users sell only shares they hold. Consequence: outstanding shares
  `qᵢ ≥ 0` always, therefore market escrow can never go negative.
- Liquidity presets (binary markets): shallow `b=50` (max subsidy ≈ 35 ₥), standard
  `b=100` (≈ 69 ₥), deep `b=250` (≈ 173 ₥). Admins pick a preset, not a number.
- Forecast-slider primitive: `sharesToMovePrice(state, outcome, targetProb)` — the UI
  asks for a target probability; the engine computes the trade.
- Budget primitive: `sharesForBudgetMicro(state, outcome, budgetMicro)` — max shares
  purchasable for a budget; result always affordable.

## 3. Money & ledger

- Double-entry. Every mutation is a journal entry: ≥2 postings, integer micro amounts,
  postings sum to exactly 0.
- Accounts: `org:treasury` (equity; the only account allowed to go negative — its
  negative balance equals org-dollars in circulation), `user:<id>`, and
  `market:<id>:escrow`.
- Invariant **INV-CONSERVE**: sum of all balances is 0 at all times.
- Invariant **INV-ESCROW**: market escrow ≥ 0 at all times, and exactly 0 after
  resolution (surplus sweeps to treasury; shortfall — bounded by `b·ln(n)` — is paid
  by treasury).
- Grants (org-configurable, defaults): 1,000 ₥ on join; 250 ₥ weekly stipend. Stipends
  are the faucet that keeps busted forecasters playing; leaderboards rank
  **calibration**, not wealth, so the faucet doesn't corrupt the signal.

## 4. Engine package (`packages/engine`)

Pure TypeScript library. Zero I/O, zero DB knowledge, deterministic. Exports:

- `money`: `MICRO_PER_CREDIT`, `creditsToMicro`, `microToCredits`, `formatCredits`.
- `lmsr`: `createMarket(n, b)`, `cost`, `prices`, `tradeCostMicro`, `applyTrade`,
  `sharesToMovePrice`, `sharesForBudgetMicro`, `worstCaseLossMicro`.
- `ledger`: `postEntry(balances, postings, allowNegative)`, `balanceOf`, `totalMicro`.
- `market`: `openMarket`, `grant`, `executeTrade`, `resolveMarket`, `positionOf` —
  ties LMSR + ledger + positions together as pure state transitions.

Tested with Vitest + fast-check. Core properties (the contract — do not weaken):
prices ∈ (0,1) and sum to 1; buys cost ≥ 1 micro, sells never cost; buy-then-sell
round trips never profit the trader; house P&L after resolution ≥ `−b·ln(n)`;
journal entries must balance; INV-CONSERVE and INV-ESCROW hold under arbitrary
valid trade sequences; positions always equal outstanding shares.

## 5. Persistence model (target Postgres schema, built in phase 2)

`orgs`, `users`, `memberships(org, user, role)`, `accounts`, `journal_entries`,
`postings(entry, account, amount_micro)`, `markets(org, question, description,
resolution_criteria, resolution_source, close_at, liquidity_b, status)`,
`market_outcomes(market, label, q_micro_shares)`, `trades(market, user, outcome,
delta_micro_shares, cost_micro, idempotency_key, created_at)`,
`positions(market, user, outcome, micro_shares)` (materialized from trades),
`resolutions(market, outcome, resolved_by, evidence, resolved_at)`.

Concurrency rule: a trade transaction takes `SELECT … FOR UPDATE` on the market row
(serializing trades per market — correct and sufficient at corporate volume), posts
the journal entry, updates q and positions atomically. Every trade request carries an
idempotency key; retries return the original result.

## 6. Pilot feature cut (v0.1 = phases 2–3)

Web: org onboarding, member invites, market create (from templates) / browse / trade
via probability slider, portfolio, price-history chart, admin resolution flow with
evidence note, calibration leaderboard, org settings (anonymity mode, grant sizes,
liquidity preset). Seeded demo org for sales demos.
Slack: market announcements to a channel, one-tap in-channel forecasting, weekly
digest, resolution results.
Auth: email magic link + Google OAuth. Pseudonym auto-assigned per org.

## 7. Question guardrails (ship with templates)

Every market requires: unambiguous resolution criteria, named resolution source, close
date before resolution date. Template library for the beachhead (ship dates, launch
outcomes, milestone/OKR attainment, bug-count/quality gates). Blocked by default:
markets on earnings/guidance (MNPI hazard for public companies), individual-person
performance, M&A, layoffs. Void/N-A resolution (v0.2): traders refunded their net
spend on the market; rounding residue sweeps to treasury.

## 8. AI layer (phase 4)

- Question drafting: paste a roadmap/OKR doc → Claude drafts well-formed markets
  (criteria, source, dates) → admin approves before publish. Structured output +
  eval set of good/bad questions.
- Resolution assistance: Claude gathers/summarizes evidence, admin confirms.
- Weekly leadership memo: "what the market believes vs. the official plan," largest
  belief-plan gaps first.

## 9. Non-goals for v1

Real money. Order books. Shorting. Combinatorial/conditional markets (endgame, not
now). Scalar markets (v1.x). Native mobile apps. Self-hosting. Teams bot (after
Slack proves the loop). LS-LMSR (revisit if liquidity presets feel wrong in pilots).

## 10. Open questions

- Balance resets (quarterly season vs. perpetual)? Leaning seasons + all-time
  calibration score.
- Prize mechanics that stay clearly outside gambling definitions in pilot orgs'
  jurisdictions (recognition-first; legal review before cash-equivalent prizes).
- Pseudonym visibility default for admins: fully blind vs. break-glass audit access.
- When SSO becomes mandatory in the sales motion (likely first 500+ seat pilot).
