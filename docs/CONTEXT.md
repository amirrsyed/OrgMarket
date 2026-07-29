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
