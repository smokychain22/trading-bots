# trading-bots

THETA is a paper-first, assignment-aware premium-selling Wheel control plane. It uses Alpaca for broker and executable-market truth and Optionomics for contextual options intelligence.

Private repository for the user's multi-bot options-trading platform. **THETA is bot
one and the only bot in scope for v1.**

Start here:

- [`docs/TEAM_CHARTER.md`](docs/TEAM_CHARTER.md) — the shared rulebook both Codex and
  Claude Code operate under: canonical specs, providers, non-negotiable financial
  rules, teamwork/disagreement protocol, ablation reporting format, public-repo
  security rules, and the agent handoff format.
- [`CLAUDE.md`](CLAUDE.md) / [`AGENTS.md`](AGENTS.md) — role-specific entry points for
  Claude Code and Codex respectively, both pointing back at the shared charter above.
- [`docs/OWNERSHIP.md`](docs/OWNERSHIP.md) — Claude (quant) vs Codex (engineering)
  module ownership.
- [`docs/QUANT_IMPLEMENTATION_MAP.md`](docs/QUANT_IMPLEMENTATION_MAP.md) — TRD
  requirement → quant module → verification map.
- [`docs/ENGINEERING_IMPLEMENTATION_MAP.md`](docs/ENGINEERING_IMPLEMENTATION_MAP.md) —
  TRD/Backend-Schema requirement → Node/TS module → migration → test map.
- [`docs/IMPLEMENTATION_AUDIT.md`](docs/IMPLEMENTATION_AUDIT.md) — repo/spec audit:
  document version hierarchy, open schema inconsistencies requiring a decision before
  coding, and missing implementation prerequisites.
- [`docs/DATA_READINESS_ASSESSMENT.md`](docs/DATA_READINESS_ASSESSMENT.md) — what's
  actually usable for research given the account's current PAPER-only Alpaca
  connection, and the checklist for reviewing Codex's provider-capability results.
- [`docs/STRATEGY_DNA.md`](docs/STRATEGY_DNA.md) — the THETA Strategy DNA / Hypothesis
  Foundation: expert evidence, strategy archetypes, testable conditional hypotheses,
  benchmarks and experiment registry. The actual machine-usable data/code lives under
  `bots/theta/quant/expert_priors/` and `bots/theta/quant/research/`; this doc is the
  index into it.
- [`docs/PHASED_PLAN.md`](docs/PHASED_PLAN.md) — phased build plan and exit gates.
- [`docs/specs/`](docs/specs/) — the canonical v1.1 FINAL TRD, PRD, backend schema, and
  PostgreSQL bootstrap. The TRD is the frozen build authority.
- [`docs/research/RESEARCH_REGISTER.md`](docs/research/RESEARCH_REGISTER.md) — offline
  expert-trader corpus and blueprint lineage (research priors, not runtime dependencies).

## Status

The TypeScript safety foundation, read-only provider readiness checks, and offline
Python quant research foundation are present. Broker orders remain disabled. Alpaca
is paper-only and no provider key belongs in this repository. See
`docs/PHASED_PLAN.md` for the next exit gate.

## Layout

```
docs/                      Canonical specs and cross-cutting project docs
bots/theta/
  app/src/                 TypeScript control plane (Codex-owned)
  quant/                   Python quant service (Claude-owned)
  migrations/              Forward-only SQL migrations
  tests/                   unit / contract / integration / simulation / quant / security / chaos
```

## Local checks

```powershell
npm ci
npm run lint
npm run check
npm test
npm run build
```

The host-independent resident runtime is documented in
[`docs/THETA_WORKER_RUNTIME.md`](docs/THETA_WORKER_RUNTIME.md). It is packaged for a
future generic Docker host, but no always-on worker is deployed during the current
Paper-readiness phase.

`npm run validate:env` reports only configuration status and missing variable names.
`npm run provider:readiness` performs read-only checks and never submits an order.
