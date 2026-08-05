# OrgMarket

OrgMarket enables organizations to run internal prediction markets using management-allocated dollars to promote perfect information between distant operations and better aid decision making. OrgMarket forces the magical characteristics of markets (critical thinking, wisdom in numbers, and local information) to improve a company's assessments.

## Status

Phase 3 of 5: property-tested market engine, working web app (forecast-slider
trading, portfolio, calibration leaderboard, admin flows, seeded demo org), and the
Slack surface — announcements, one-tap in-channel forecasting (₥25-capped bucket
taps), `/om` commands, digests. See [`docs/SLACK_SETUP.md`](docs/SLACK_SETUP.md) to
connect a workspace. Next: AI layer (phase 4).

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
