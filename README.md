# OrgMarket

OrgMarket enables organizations to run internal prediction markets using management-allocated dollars to promote perfect information between distant operations and better aid decision making. OrgMarket forces the magical characteristics of markets (critical thinking, wisdom in numbers, and local information) to improve a company's assessments.

## Status

Phase 4 of 5: property-tested market engine, working web app (forecast-slider
trading, portfolio, calibration leaderboard, admin flows, seeded demo org), the
Slack surface (announcements, ₥25-capped one-tap forecasting, `/om`, digests —
[`docs/SLACK_SETUP.md`](docs/SLACK_SETUP.md)), and the AI layer: Claude drafts
markets from pasted planning docs (`/admin/draft`, code-enforced guardrails,
admin-in-the-loop), checks resolution evidence on the resolve form, and writes the
weekly leadership memo (`/admin/memo`). Set `ANTHROPIC_API_KEY` to enable AI; see
[`apps/web/.env.example`](apps/web/.env.example). Next: pilot hardening (phase 5 —
real auth/SSO, audit log, SOC 2 groundwork).

## Repo map

- [`docs/CONTEXT.md`](docs/CONTEXT.md) — founding decisions and the reasoning behind them (the decision log; read this first)
- [`SPEC.md`](SPEC.md) — canonical product/engineering spec
- [`CLAUDE.md`](CLAUDE.md) — working rules and invariants for AI-assisted development
- [`packages/engine`](packages/engine) — Hanson LMSR market maker + double-entry ledger + market/position orchestration. Pure TypeScript, zero I/O, tested with Vitest + fast-check property tests.
- [`apps/web`](apps/web) — Next.js app: Drizzle/Postgres persistence (embedded PGlite for zero-setup local dev, `DATABASE_URL` for real Postgres), transactional trading service with per-market locking + idempotency, forecast-slider UX, demo org ("Meridian Games") seeded on first run.

## Quickstart

```sh
npm install
npm run typecheck
npm test
npm run dev -w @orgmarket/web   # http://localhost:3000 — pick a demo user to sign in
```

## License

Apache-2.0
