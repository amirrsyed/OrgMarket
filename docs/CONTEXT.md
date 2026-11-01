# OrgMarket — Founding Context & Decision Record

> **Purpose of this file.** This is the durable record of the founding conversation
> (2026-07-29) between the founder (Amir Syed) and Claude, and of every major decision
> made since. Any future session — human or AI — should read this file and `SPEC.md`
> before touching the codebase. When a new decision is made, **append it to the
> Decision Log** below rather than editing history.

## Mission

OrgMarket enables organizations to run internal prediction markets using
management-allocated dollars to promote perfect information between distant operations
and better aid decision making. OrgMarket forces the magical characteristics of markets
(critical thinking, wisdom in numbers, and local information) to improve a company's
assessments.

Intellectual lineage: Hayek's *The Use of Knowledge in Society* (prices aggregate
dispersed local knowledge), Hanson's market scoring rules and decision markets,
Surowiecki's wisdom-of-crowds conditions (diversity, independence, decentralization,
aggregation) treated as a product checklist.

## The Secret (why this works now)

Corporate prediction markets are academically validated (Google, HP, Ford internal
markets beat official forecasts) yet commercially dead. They died of **operational
cost** (hand-writing questions, chasing resolutions, sustaining engagement) and
**hierarchical fear** (nobody bets against the VP's ship date under their real name) —
not of bad math. LLMs delete the first problem (AI-generated questions, resolution
assistance, decision memos); pseudonymous, Slack-native design blunts the second.
The 10x improvement is a prediction-market program that runs itself.

---

## Decision Log

### D1 — Market mechanism: LMSR automated market maker (not an order book)
Corporate markets are thin (dozens of traders). Continuous double auctions fail without
counterparties. Hanson's Logarithmic Market Scoring Rule quotes a price at all times,
executes any size instantly, and bounds the operator's worst-case loss at `b·ln(n)`.
Every successful internal market converged on this. Liquidity-sensitive LMSR is a
possible later refinement.

### D2 — Forecasting-first UX, not trading-first
Primary interaction is a probability slider ("crowd says 62% — where do you put it?"),
with the LMSR translating intent into trades behind the scenes. No visible order books,
shares, or trading jargon in the default UI. Trading metaphors filter out exactly the
domain experts whose information we want.

### D3 — Pseudonymity by default, configurable per org
Trade history pseudonymous to peers; optionally visible to designated admins;
leaderboards rank calibration. This defuses the hierarchy problem. It is a first-class
org setting with HR/legal texture, not a cosmetic feature.

### D4 — Play-money only ("org-dollars", symbol ₥), prizes optional
Real-money internal markets hit CFTC event-contract regulation and state gambling law.
Management-allocated play money with recognition/prize incentives is the settled safe
harbor (Google, Microsoft, all prior vendors). Guardrail templates must exclude markets
that create disclosure hazards for public companies (e.g. "will we beat earnings").

### D5 — Platform shape: multi-tenant SaaS web app + Slack/Teams bot as first-class surface
The historical killer is engagement. Employees will not open a fifth dashboard. The bot
announces markets, takes one-tap forecasts in-channel, posts resolutions; the web app
serves power users and program admins. Pure cloud SaaS; resist self-hosting until a
contract funds it.

### D6 — Stack
TypeScript everywhere. Next.js (App Router) single full-stack app. Postgres
(Neon/Supabase) + Drizzle ORM. Auth.js/Clerk now, WorkOS for SAML+SCIM when an
enterprise pilot asks. Slack via Bolt for JS. Tailwind + shadcn/ui, Recharts. Vercel +
Neon hosting with per-PR preview deployments. Vitest + fast-check (property tests on
the engine) + Playwright. Sentry + PostHog. Claude API for the AI layer.
No websockets initially — polling/SSE is fine at human trading tempo.

### D7 — Money is integers; rounding always favors the house
Ledger amounts are integer **micro-credits** (1 ₥ = 1,000,000 micro). LMSR math runs in
floats internally (log-sum-exp for stability) but every trade cost is rounded **against
the trader** (ceil on buys, toward zero on sale proceeds) so the ledger can never leak
value. The ledger is double-entry: every mutation is a balanced journal entry;
total of all balances is invariant (treasury is the equity account and may go negative,
representing issued org-dollars).

### D8 — Engine is a pure library, built test-first
`packages/engine` has zero I/O and zero DB knowledge. Property-based invariants
(fast-check) were written alongside the engine: prices sum to 1, buys cost > 0,
round-trips never profit the trader, house loss bounded by `b·ln(n)`, ledger
conservation. A subtle LMSR bug silently mints or burns money — the tests are the
contract. Never weaken a tolerance to make a test pass without a recorded decision.

### D9 — No shorting in v1; sell only what you hold
Simpler mental model, bounded downside for users, and it keeps outstanding shares
non-negative (which also guarantees the escrow account can never go negative).

### D10 — Build order
1. Engine as pure library (this exists first, perfect before UI).
2. Web app: org/user/market CRUD, forecast slider, portfolio, price history, admin
   resolution flow, leaderboard, seeded demo org.
3. Slack app: announcements, in-channel forecasting, digests.
4. AI layer: Claude-drafted questions from pasted roadmaps/OKRs (admin approves before
   publish), resolution-evidence summaries, weekly "market vs. official plan" memo.
5. Pilot hardening: SSO, audit log, data export, SOC 2 groundwork.

### D11 — Positioning: never sell "prediction markets"
The phrase carries gambling baggage and 20 years of failed pilots. Sell a
**forecasting layer / truth layer for planning**. The market mechanism is the engine,
not the brand.

### D12 — Zero to One beachhead: ship-date & launch-outcome forecasting at mid-size software and game studios (150–2,000 people)
Why: acute recurring pain (slippage engineers can see but can't say), fast resolution
(weeks–months, product proves itself in 1–2 quarters), Slack-native betting-tolerant
culture, identifiable buyer (VP Eng / COO / head of production), and a market small
enough to dominate. Wedge question: *"Would you like to know which of your ship dates
your own engineers don't believe?"*

Playbook: ten design partners via founder-led sales, free 3-month hand-held pilots
(founder seeds the first ~20 questions), convert at $10–25k/yr. Publish anonymized
calibration studies ("market called the slip 6 weeks before the status report went
red, Brier 0.14 vs 0.31"). Win the ritual: the weekly leadership meeting opens with
the market brief — that's the switching cost; per-employee calibration history is the
data moat.

Expansion rings: (2) adjacent questions for same buyers — sales confidence,
hiring/attrition, OKR attainment; (3) adjacent verticals with native betting culture —
quant/prop firms, VC funds, consultancies, PE ops; (4) endgame — conditional
**decision markets** ("Q3 revenue if we price at $99 vs $79"), Hanson's futarchy
productized as decision support.

Known risks: engagement decay after pilot novelty (mitigate: Slack-first design,
stipend/faucet mechanics); incumbent response from Cultivate Labs (mitigate: AI-native
cost structure, modern UX).

### D13 — Quarterly seasons for balances; all-time calibration for status (2026-07-29)
Balances reset each quarter (org-configurable length) with fresh grants; calibration
scores accumulate forever. Incentive reasoning: perpetual balances concentrate wealth —
early winners' trades dominate prices while newcomers face a rich-get-richer wall and
disengage, which kills the aggregation the product exists for. Seasons re-level
price-moving power every quarter (matching corporate planning cadence), so every
employee always has a reason to trade. The durable status game is **accuracy**
(all-time calibration), not wealth — wealth is within-season skin-in-the-game,
calibration is cross-season reputation. Bonus: season-end recap reports are a natural
renewal artifact for the sales motion. v0.1 runs one implicit season; the seasons table
lands in v0.2.

### D14 — Recognition-first incentives; no cash prizes tied to winnings (2026-07-29)
Leaderboard status, badges/titles, and org-chosen recognition (e.g., lunch with the
CEO, donation in the winner's name). No in-product cash or cash-equivalent prizes tied
to market performance. Incentive reasoning: cash winnings (a) reopen the gambling-law
perimeter play-money exists to avoid, (b) invite manipulation and collusion (trading to
inflate a colleague's payout is profitable the moment payouts are fungible), and
(c) crowd out the status motive that actually sustains long-run engagement. Peer status
for *repeated accuracy* is manipulation-resistant — you cannot collude your way to a
good all-time Brier score. Orgs may attach their own rewards outside the product; we
recommend recognition over cash in onboarding materials.

### D15 — Pseudonymity: blind by default, legible break-glass unmasking (2026-07-29)
Admins cannot see who is behind a pseudonym in normal operation. Unmasking is a
break-glass action: it requires a documented reason, is written to a tamper-evident
audit log, and **notifies the affected user**; the org's unmasking policy is shown to
every member at onboarding. Incentive reasoning: the chilling effect on honest trading
operates on employees' *beliefs* about surveillance, not on actual access — so the
guarantee must be legible and credible, not merely true. Pure no-exceptions blindness
fails the other direction: it makes abuse (harassment in comments, coordinated
manipulation) unpoliceable, which gives HR/legal a reason to veto the purchase.
Observable-ex-post unmasking keeps covert retaliation non-credible (a manager cannot
secretly learn who bet against them) while preserving an abuse remedy.

### D16 — SSO deferred until a signed pilot requires it (2026-07-29)
v0.1 auth is email magic link + Google OAuth behind an adapter interface; WorkOS
SAML/SCIM is integrated when the first committed pilot demands it — a days-scale task
if the abstraction is honest. Incentive reasoning: building SAML before revenue is
speculative capex against the scarcest resource (founder build time), and the beachhead
(150–2,000-person Slack-native studios) overwhelmingly runs Google/Microsoft OAuth.
The exception that matters: never let SSO be the reason a signed pilot stalls — hence
the adapter now, the vendor later.

### D17 — Price contract is (0, 1], not (0, 1); UIs clamp displayed probabilities (2026-07-29)
Found via a fast-check counterexample (b=5, one outcome ahead by ~166 shares): when the
exponent gap exceeds ~36, the true price is closer to 1 than any float64 below 1, so a
strict p<1 contract is mathematically unsatisfiable. `prices()` uses softmax
normalization (guarantees p ≤ 1, never overshoots) and the contract is p ∈ (0, 1],
hitting the endpoints only beyond float precision. Product rule: UIs clamp displayed
probabilities (e.g. to 0.1%–99.9%) so an **open** market never shows 100% — which is
the right epistemic message anyway: unresolved questions are never certain. Ledger math
is unaffected (costs come from the cost function, not from prices).

### D18 — Slack architecture: route handlers in the web app, bucket-button taps with a spend cap (2026-07-30)
No Bolt framework and no separate service: Slack webhooks are Next.js route handlers
in `apps/web` with manual HMAC signature verification and a thin fetch-based Web API
client — serverless-friendly on Vercel, zero new runtime dependencies, and the trade
path reuses the exact same transactional service the web UI uses.

One-tap forecasting (binary markets): the announcement message carries five
probability-bucket buttons (≈15% / ≈35% / toss-up / ≈65% / ≈85%). A tap trades
*toward* that target, capped at ₥25 per tap. Incentive reasoning: uncapped
trade-to-target would let one careless tap drain a balance (and makes fat-thumb
manipulation cheap); a capped tap makes each press a small, honest, repeatable
signal — conviction is expressed by tapping again over time, which is exactly the
repeated-forecast behavior the market wants. Precise forecasts stay one click away
via the "Open" link to the web slider; categorical markets announce prices and link
to the web (bucket buttons don't map to n outcomes).

Identity: Slack user → membership resolved by workspace-verified email
(`users.info`) against `users.email`, then cached on `memberships.slack_user_id`.
No passwords, no separate accounts, and it inherits SSO later (D16). Per-org
`slack_connections` table (team id, bot token, channel); env-var fallback for local
dev. Bot tokens are stored plaintext in v0.1 — encrypt-at-rest is a pilot-hardening
task, noted in SPEC.

### D19 — AI layer: admin-in-the-loop always; guardrails in code, not just prompts (2026-08-05)
The AI layer (the 10x wedge from the business plan) drafts markets from pasted
planning docs, checks resolution evidence against the stated criteria, and writes the
weekly "what the market believes" memo. Three design rules, all incentive-driven:

1. **AI never publishes, trades, or resolves autonomously.** Every AI output passes
   through an admin click. The product's entire value is *credibility of the signal* —
   one hallucinated market or wrong auto-resolution costs more trust than automation
   saves. Admin approval also keeps the resolution audit trail human-owned, which the
   break-glass pseudonym policy (D15) depends on.
2. **Guardrails are enforced in code after generation, not only requested in the
   prompt.** SPEC §7's blocked categories (earnings/MNPI, individual performance,
   M&A, layoffs) are compiled checks over the drafted questions; a prompt is advice,
   a filter is a guarantee. Prompt-level instruction still exists to keep quality high,
   but the filter is what we can promise a general counsel.
3. **Graceful degradation.** Without an API key the AI surfaces disappear behind a
   "not configured" notice; nothing else breaks. AI is leverage, not a dependency —
   pilots must survive an Anthropic outage.

Implementation: official TypeScript SDK, `claude-opus-5` (env-overridable via
`AI_MODEL`), structured outputs via `client.messages.parse()` + Zod schemas so
malformed drafts are impossible to publish. The memo assembles its numbers
deterministically in code (prices, deltas, closing dates) and uses Claude only to
write prose around them — the model never computes the figures it reports.

### D20 — Open-source stack review: what we adopted, rejected, and why (2026-11-01)
The founder brought an external stack proposal for the open-source release. Each item
was judged on incentives for (a) an enterprise IT team deciding whether to self-host
and (b) employees deciding whether to trade honestly.

**Adopted**
- **SSO via Auth.js v5 (OIDC):** Google, Microsoft Entra ID, Okta, GitHub, and a
  generic OIDC provider, each enabled by env vars. SAML is handled by putting an
  OIDC bridge (BoxyHQ SAML Jackson) in front, so we never write SAML ourselves.
  JWT sessions with no Auth.js adapter: Auth.js's `accounts` table name collides
  with our ledger, and we only need identity, not token storage. Users are
  auto-provisioned when their email domain is on the org's allow-list. The dev login
  stays, but only behind `DEV_LOGIN=1`.
- **Resolution challenge window (default 48h):** admins *propose* a resolution, any
  member can dispute with a reason, and money only moves after the window closes with
  no open disputes (or when an admin explicitly overrides one). This is the cheapest
  credible answer to "who resolves the resolver", and it raises trust in the signal
  more than it costs in latency.
- **Anonymous "why" feed:** an optional rationale (280 characters max) on each trade,
  shown under the trader's pseudonym. Prices say *what* the crowd believes and
  rationales say *why*. For leadership the "why" is often the more valuable part,
  so it also feeds the AI memo.
- **Tamper-evident ledger (hash chain):** each journal entry stores
  `sha256(prev_hash ‖ canonical entry)`, chained per org, and the chain head can be
  published so anyone can verify that history was not rewritten. This is honest
  about what it is: tamper-*evident*, not "cryptographically signed". A signing key
  that sits on the same server as the database adds nothing against an operator.
  Appends serialize per org on a `ledger_heads` row lock, which is fine at corporate
  volume.
- **Points-to-reward settlement, opt-in and guarded (amends D14):** the founder's
  thesis is management-allocated money, so the open-source tool supports it without
  ever touching money itself. At the end of a season the admin sets a **fixed reward
  pool**. It is split pro rata on each member's *positive* season profit, with a
  per-person cap (default 25% of the pool), and the output is a CSV export that the
  org pays out through its own payroll or rewards system. Amounts above the cap
  are **not** re-spread to other members; they stay with the org. The first
  implementation did re-spread them ("water-filling"), and live testing showed the
  failure: with four profitable traders and a 25% cap, everyone received an identical
  payout, so reward stopped tracking accuracy. Incentive reasoning:
  (1) a fixed pool bounds management's cost no matter what traders do;
  (2) profit under LMSR is a proper-scoring reward, so the payout pays for accuracy;
  (3) collusion is lossy, because value can only move between users through the AMM,
  and the engine's property tests prove round trips never profit (the spread taxes
  every wash trade); (4) the cap limits moral hazard for people who can influence
  outcomes. Off by default, and the admin must acknowledge that a legal review
  happened. Recognition-first (D14) remains the recommended default.
- **Self-hosting:** a Dockerfile plus `docker compose` (app + Postgres 16). Enterprise
  IT deploys open-source internal tools when those tools run inside its own VPC.
- **Scheduled tick instead of a job queue:** one secret-gated `POST /api/cron/tick`
  closes expired markets, finalizes resolutions whose challenge window has passed,
  and pays idempotent weekly stipends. Any scheduler can call it (Vercel cron,
  k8s CronJob, GitHub Actions).

**Rejected (for now), with reasons**
- **TigerBeetle:** it is excellent at millions of transfers per second, but a company
  of 2,000 people produces a few thousand trades a day. It would also add a second
  datastore that self-hosters must run and back up. Postgres with balanced journal
  entries, row locks, and the hash chain already gives every guarantee we need.
- **Redis/WebSockets for realtime:** prices move at human speed. A 15-second
  auto-refresh delivers the same experience with one fewer stateful service to
  self-host. Revisit if usage shows otherwise.
- **Separate Fastify/NestJS/Go backend:** splitting it out buys no concurrency we
  lack (trades already serialize per market in Postgres) and doubles the deploy
  surface. It stays in Next.js route handlers.
- **TimescaleDB:** the price history is one indexed `trades` table, orders of magnitude
  below the size where a time-series extension pays off, and requiring an extension
  would hurt managed-Postgres self-hosters.
- **Helm chart, Microsoft Teams bot, per-season pseudonym rotation:** each is good,
  but none is needed before the first pilot. They are queued, not rejected outright.

---

## Developer syllabus (topics the builder must understand)

**Math / econ / finance:** Bayesian probability; proper scoring rules (Brier, log) and
calibration; LMSR in full (cost fn `C(q)=b·ln(Σe^{q_i/b})`, price = gradient, trade
cost = ΔC, bounded loss, tuning `b`); LS-LMSR; why not CDAs/parimutuel; market types
(binary, categorical, scalar, conditional); play-money macroeconomics (faucets, sinks,
inflation vs leaderboards); incentive pathologies (favorite-longshot bias, herding,
manipulation, self-defeating prophecies); question & resolution design; double-entry
accounting; numerical stability (log-sum-exp, rounding policy, integer money,
idempotency).

**Software:** TS/React/Next/Node; relational modeling + transaction isolation
(concurrent trades on one market must serialize — the one place junior mistakes
destroy the product); multi-tenancy + RBAC + row-level security; SSO (SAML/OIDC) and
SCIM via WorkOS; Slack app architecture; property-based and E2E testing; LLM
integration with structured output + evals; observability & product analytics;
compliance horizon (SOC 2, GDPR/employee data, CFTC/gambling-law perimeter of
play-money, MNPI hazards for public companies).

## Working agreement (founder × Claude)

- Founder owns: spec, mechanism choices, question-design taste, customer conversations,
  final review. Decisions get written here.
- Claude owns: implementation from spec, test authorship, refactoring, first-pass
  review. Plan mode for anything touching the engine or DB schema.
- Specs are the interface: quality of what Claude builds tracks quality of what the
  founder wrote. `SPEC.md` is canonical for product behavior; this file is canonical
  for *why*.
