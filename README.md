# trading-bots

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
- [`docs/PHASED_PLAN.md`](docs/PHASED_PLAN.md) — phased build plan and exit gates.
- [`docs/specs/`](docs/specs/) — the canonical v1.1 FINAL TRD, PRD, backend schema, and
  PostgreSQL bootstrap. The TRD is the frozen build authority.
- [`docs/research/RESEARCH_REGISTER.md`](docs/research/RESEARCH_REGISTER.md) — offline
  expert-trader corpus and blueprint lineage (research priors, not runtime dependencies).

## Status

Phase 0 (repository and safety foundation) only. No application code, no database
connection, no broker connection, no trading logic exists yet. See
`docs/PHASED_PLAN.md` for what comes next and its exit gate.

## Layout

```
docs/                      Canonical specs and cross-cutting project docs
bots/theta/
  app/src/                 TypeScript control plane (Codex-owned)
  quant/                   Python quant service (Claude-owned)
  migrations/              Forward-only SQL migrations
  tests/                   unit / contract / integration / simulation / quant / security / chaos
```
