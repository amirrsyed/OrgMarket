# OrgMarket

**Internal prediction markets for organizations: a forecasting layer for planning.**

Management allocates play-money credits to employees. Employees trade on the
questions leadership actually cares about, such as "Will the console build ship
on the roadmap date?", "Will the playtest clear 70 NPS?", or "Which platform
leads wishlists?". The resulting prices are the organization's honest,
continuously updated probability for each question, built from the local
knowledge of the people closest to the work.

The engineers know the date will slip before the status report turns red.
OrgMarket gives them a pseudonymous, low-friction way to say so, and gives
leadership the number.

Apache-2.0 · TypeScript · Next.js · Postgres · self-hostable with Docker

---

## What's in the box

| | |
|---|---|
| **Market maker** | Hanson's LMSR: always-on prices even with a handful of traders, and an operator worst-case loss bounded at `b·ln(n)`. Property-tested with fast-check (prices sum to 1, round trips never profit, money is conserved to the micro-credit). |
| **Ledger** | Double-entry, integer micro-credits, rounding always in the house's favor, and a per-org **hash chain** so rewriting history is detectable. |
| **Forecast-first UX** | A probability slider ("the crowd says 38%; where do you put it?"). The engine translates it into a trade, with no order book or trading jargon. |
| **Pseudonymity** | Trades show pseudonyms like *Skeptical Skink*, so nobody has to bet against their VP's date under their own name. |
| **The "why" feed** | An optional 280-character anonymous rationale with each trade. Prices say *what* the crowd believes; rationales say *why*. |
| **Credible resolution** | Admins *propose* an outcome with evidence. A 48-hour challenge window lets any member dispute it, and money moves only after the window closes. |
| **Slack** | Market announcements, one-tap forecasting buttons in the channel (capped at ₥25 per tap), `/om` commands, and a weekly digest. |
| **AI layer (optional)** | Claude drafts well-formed markets from a pasted roadmap, checks resolution evidence against the criteria, and writes the weekly leadership memo. Admin-in-the-loop always, with compliance guardrails enforced in code. |
| **SSO** | Google, Microsoft Entra ID, Okta, GitHub, and any OIDC provider (and SAML through an OIDC bridge). Users are auto-provisioned by email domain. |
| **Rewards (optional)** | Season settlement splits a *fixed* reward pool by positive profit, with a per-person cap, and exports a CSV for your own payroll. OrgMarket never moves money. |

## Quickstart

**Local development (no setup):**

```sh
npm install
npm run dev -w @orgmarket/web     # http://localhost:3000
```

With no configuration you get an embedded Postgres (PGlite), a seeded demo org,
and a demo sign-in picker.

**Self-hosted (app + Postgres + scheduler):**

```sh
docker compose up --build         # http://localhost:3000
```

See [docs/SELF_HOSTING.md](docs/SELF_HOSTING.md) for SSO, your own org, and
production settings, and [apps/web/.env.example](apps/web/.env.example) for every
configuration option.

**Checks:**

```sh
npm run typecheck
npm test                          # engine property tests + service integration tests
```

## Design principles

These are the decisions that most shape the product. Each one is recorded with
its reasoning in [docs/CONTEXT.md](docs/CONTEXT.md):

- **Play money, not real money.** Credits are allocated by management. Real-money
  internal markets fall under gambling and derivatives law. The optional settlement
  turns season performance into a payout file *your* org pays, with legal review
  acknowledged first.
- **An automated market maker, not an order book.** Corporate markets are thin, and
  order books stall without counterparties.
- **Calibration over wealth.** Leaderboards rank by Brier score. Balances can reset
  each season; reputation for accuracy carries over.
- **Humans decide, software assists.** The AI drafts and checks; it never
  publishes, trades, or resolves.
- **Guarantees live in code.** Ledger invariants are property tests, guardrails are
  compiled filters, and history is hash-chained.
- **Boring infrastructure.** One Node service and Postgres. No Redis, queue, or
  second datastore until usage demands one.

## Repository map

```
packages/engine     Pure LMSR market maker + double-entry ledger (no I/O), property-tested
apps/web            Next.js app: UI, API routes, Slack, AI, auth, Drizzle/Postgres
docs/CONTEXT.md     Decision log (D1–D20): why everything is the way it is
SPEC.md             Product and engineering spec
docs/               Self-hosting and Slack setup guides
```

## Status

Pre-1.0 and ready for pilots. On the roadmap: an admin UI for org settings,
seasons with balance resets and per-season pseudonym rotation, a Microsoft Teams
bot, a Helm chart, and conditional "decision markets".

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md). Security
issues: [SECURITY.md](SECURITY.md).

## License

[Apache-2.0](LICENSE)
