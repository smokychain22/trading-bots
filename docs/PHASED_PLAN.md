# THETA Phased Build Plan

Derived from TRD §38 (Build Plan and Milestones) and §57 (Release Signature Matrix /
Gates G1–G7), cross-checked against the prior Codex read-through's independent phase
breakdown. Each phase names its Claude-owned and Codex-owned work and its exit gate.
**Do not start phase N+1 before phase N's exit gate is met** — this is a working
agreement in `CLAUDE.md`, not a suggestion.

This document describes *what* each phase delivers, not a calendar. No dates are
attached; a phase is done when its gate is met.

## Phase 0 — Repository and safety foundation

- **Status: scaffold done (`9b312ec`); the engineering audit adds detail but no code
  yet.** See `docs/IMPLEMENTATION_AUDIT.md` for the full findings and
  `docs/ENGINEERING_IMPLEMENTATION_MAP.md` §8 for the concrete migration-conversion
  plan referenced below.
- Codex (next slice of Phase 0), in order:
  1. Resolve the `broker_order`/`order_intent` cardinality question
     (`docs/IMPLEMENTATION_AUDIT.md` §3.1) before writing any execution-engine code
     that depends on it — this shapes Phase 5, not Phase 0, but the decision should be
     recorded now while it's fresh.
  2. TypeScript workspace + Python quant service scaffolding, Docker Compose
     (Postgres/Redis), CI, typed config with secret *references* (never values),
     structured logging, health/readiness endpoints.
  3. Convert `docs/specs/THETA_v1_1_PostgreSQL_Bootstrap_Schema_2026-09-09.sql` into
     ordered, forward-only migrations `001`–`016` following the schema doc's own
     migration order (Backend Schema §34) — do not re-derive a different ordering.
     Add partitioning strategy into the *first* migration that creates each
     high-volume table (audit §3.2), not a later retrofit. Add DB role/permission
     separation and UPDATE/DELETE denial on immutable tables in migration `015`
     (AUDIT-001/IAM-001 — currently unimplemented in the bootstrap). Add the 7 missing
     `analytics.v_*` read views (audit §3.2) into `015` alongside the 6 already
     bootstrapped.
- Claude: review the migration conversion for fidelity to the Backend Schema doc
  (partitioning, permissions, immutability enforcement, and the views the schema doc
  promises that the bootstrap doesn't yet create).
- **Exit gate:** empty-database migration, lint, type-check, and unit tests pass in
  CI; secret-scanning passes; schema invariant queries (Backend Schema §35) pass as
  executable tests; nothing places, sizes, or previews a broker order.

## Phase 1 — Broker truth and lifecycle ingestion (Codex-led)

- Alpaca adapter: account/config, clock/calendar, stock quotes/bars, option
  contracts/snapshots, option stream, orders, trade_updates, activities,
  corporate-action REST/SSE. Persist evidence with `as_of`/retrieval time and feed
  identity (ALP-006). See `docs/ENGINEERING_IMPLEMENTATION_MAP.md` §1 for the
  module-by-module breakdown.
- Confirm actual Alpaca account entitlement (options level, OPRA vs. Basic/indicative)
  before trusting any BBO-driven logic — TRD §8.2 treats the Basic feed as explicitly
  non-execution-grade; this is a live-account check, not an assumption from the docs.
- Reconciliation-before-autonomy: activities + positions reconcile assignment/expiry/
  exercise before any new risk is allowed (LIFE-001, CA-001..005).
- **Exit gate:** paper integration tests pass, including timeout, duplicate,
  partial-fill, assignment, expiry, exercise, and corporate-action fixtures.

## Phase 2 — Optionomics contracts and point-in-time intelligence (Codex-led, Claude reviews feature contracts)

- Deployment-resolved operation aliases (never guessed paths), capability checks, rate
  limiting, cache/freshness behavior, canonical feature-family mappings (OPT-001..004).
- Missing data persists as `UNKNOWN` with a reason, never a fabricated zero.
- Claude: confirm every ingested feature family has a `feature_definition` before it's
  usable downstream (FEAT-001) — this is the seam between Phase 2 and quant work.
- **Exit gate:** documented-contract fixture mapping and degraded-mode tests pass. No
  Optionomics response can place an order.

## Phase 3 — Immutable decision truth (Codex builds; Claude specifies the snapshot contract)

- `FusionSnapshot`, feature/regime snapshots, candidate sets including WAIT,
  reasons/rejections, version activation, decision records, audit/replay manifest,
  correlation/sizing evidence.
- **Exit gate:** a frozen decision replays deterministically without re-fetching
  mutable live data (DATA-003).

## Phase 4 — Deterministic THETA mechanics (Codex-led, Claude verifies formulas)

- Wheel state machine and transition guards, economic ledger, stock lots,
  coverage/collateral reservations, CSP/CC/roll/assignment/expiry/call-away
  reconciliation, canonical P&L/outcome calculations.
- Claude: verify every formula against Appendix A, including sign conventions; verify
  roll old-loss preservation, open-inventory inclusion in reported WR, and cost-once
  treatment (`EV_net` must not subtract the same cost twice).
- **Exit gate:** mathematical fixtures prove short-option signs, old-roll-loss
  preservation, open assigned-stock inclusion, cost-once treatment, and valid zero
  sizing.

## Phase 5 — AEGIS and execution (Codex-led)

- Hard-veto vs soft-evidence enforcement, position sizing, stress/inventory/
  correlation controls, kill/hold-only behavior, durable order intent, deterministic
  client order IDs, preflight, adaptive limit policy, reconciliation-before-retry,
  partial handling, TCA.
- **Exit gate:** paper-safe autonomous order mechanics; no duplicate/orphan states
  under chaos tests.

## Phase 6 — Research and shadow validation (Claude-led)

- This is the phase `docs/QUANT_IMPLEMENTATION_MAP.md` exists to drive: deterministic
  baseline policy, candidate economics, conservative fill model, shadow trades,
  experiment ledger, benchmark/null runs (B0–B6, A1–A6), point-in-time datasets, purged
  walk-forward, untouched OOS, calibration, model governance.
- **Exit gate:** policy changes are evidence-backed via the benchmark/ablation matrix.
  Never tune to force a target win rate — if the honest number is lower with a better
  payoff/DD profile, that's what graduates.

## Phase 7 — Paper runtime (Codex-led, Claude monitors calibration/drift live)

- Scheduler enabled only in `PAPER` mode. Market-session readiness, management
  re-evaluations, reconciliations, alerting, reports, operator controls, operational
  SLOs (§35, §55).
- **Exit gate:** stable paper evidence across lifecycle and TCA scenarios.

## Phase 8 — Live-small and production consideration (joint; gated operational program, not a coding milestone)

- Requires all documented data/quant/strategy/risk/execution/accounting/security
  sign-offs (§57 Release Signature Matrix), verified OPRA/SIP entitlement, small-live
  behavior confirmation, and preserved evidence trail.
- Copy trading and any additional bot remain out of scope for v1 regardless of how this
  phase goes.
- **Exit gate:** gates G1 (mechanics) through G7 (production) all pass. No single
  metric, including win rate, waives another failed gate (SIGN-001).

## Cross-cutting rules for every phase

- No phase may add a runtime vendor beyond Alpaca + Optionomics without a documented
  missing capability and a controlled OOS ablation (TRD canonical constraint).
- No phase may redefine outcome metrics, lifecycle, provider ownership, risk semantics,
  or economic formulas without a versioned TRD revision (§58) — raise it to the user
  instead of quietly implementing something else.
- Every production decision must remain reconstructable from immutable point-in-time
  inputs, including `WAIT`/`SKIP` (OBS-001, §39).
