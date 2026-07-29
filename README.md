# OrgMarket

OrgMarket enables organizations to run internal prediction markets using management-allocated dollars to promote perfect information between distant operations and better aid decision making. OrgMarket forces the magical characteristics of markets (critical thinking, wisdom in numbers, and local information) to improve a company's assessments.

## Status

Phase 1 of 5: the market engine exists as a pure, property-tested library. No app yet.

## Repo map

- [`docs/CONTEXT.md`](docs/CONTEXT.md) — founding decisions and the reasoning behind them (the decision log; read this first)
- [`SPEC.md`](SPEC.md) — canonical product/engineering spec
- [`CLAUDE.md`](CLAUDE.md) — working rules and invariants for AI-assisted development
- [`packages/engine`](packages/engine) — Hanson LMSR market maker + double-entry ledger + market/position orchestration. Pure TypeScript, zero I/O, tested with Vitest + fast-check property tests.

## Quickstart

```sh
npm install
npm run typecheck
npm test
```

## License

Apache-2.0
