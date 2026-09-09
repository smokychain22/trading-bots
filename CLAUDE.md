# CLAUDE.md — trading-bots

This repository hosts the user's multi-bot options-trading platform. **THETA is the
first bot** and the only one in scope for v1. Five further bots (PULSE, NEXUS, VEGA,
EVENT, ATLAS — 0DTE, event, vol-RV and swing strategies) are named in the canonical
documents but are explicitly out of scope until THETA graduates. Do not scaffold code
for them.

Read this file before touching anything in `bots/theta/`.

## Canonical documents (build authority — do not paraphrase from memory)

All are in `docs/specs/`:

- `THETA_v1_1_FINAL_TRD_Alpaca_Optionomics_2026-09-09.docx` — **Technical Requirements
  Document. This is the frozen build authority.** Strategy lifecycle, architecture,
  formulas (Appendix A), provider contracts, risk rules, validation standard, and the
  release-signature gates all live here. Section 58 ("TRD Freeze and Handoff Contract")
  states explicitly: the PRD may define workflows/UX but may **not** redefine metrics,
  lifecycle, provider ownership, risk semantics, or formulas. Any of those requires a
  versioned TRD revision — never a silent change made while coding.
- `THETA_v1_1_FINAL_PRD_Alpaca_Optionomics_2026-09-09.docx` — Product requirements:
  operator workflows, UI surfaces (Command Center, Opportunity Center, Research/Backtest
  Lab, AEGIS Risk Center, Model Health, etc.), KPI contract.
- `THETA_v1_1_FINAL_Backend_Database_Schema_Alpaca_Optionomics_2026-09-09.docx` —
  Physical schema specification (partitioning, RLS, views, immutability enforcement).
- `THETA_v1_1_PostgreSQL_Bootstrap_Schema_2026-09-09.sql` — A **bootstrap starting
  point only**, using idempotent `IF NOT EXISTS` DDL. It is not yet a forward-only
  migration system and does not yet implement all views/partitioning/RLS the schema doc
  promises. Convert it into ordered migrations in Phase 0 — do not apply it as-is.

Also read `docs/OWNERSHIP.md`, `docs/QUANT_IMPLEMENTATION_MAP.md`,
`docs/ENGINEERING_IMPLEMENTATION_MAP.md`, `docs/IMPLEMENTATION_AUDIT.md`, and
`docs/PHASED_PLAN.md` before proposing or reviewing any implementation work.
`docs/IMPLEMENTATION_AUDIT.md` in particular records open decisions (e.g. the
`broker_order`/`order_intent` cardinality question) that must be resolved — not
silently picked either way — before the execution engine is built.

An earlier read-through of these same documents (by a Codex session, before this repo
existed) is preserved for cross-reference at
`~/Documents/Codex/2026-09-09/read-all-my-files-in-depth/outputs/THETA_v1_1_Implementation_Audit_and_Plan_2026-09-09.md`
on the user's machine — it is **not** part of this repo and is not authoritative, but
its findings (see "Findings requiring resolution before coding") are worth checking
against before Phase 0 work begins.

Version history note: `v1.0` documents in `~/Downloads` are superseded by `v1.1` and
are not copied into this repo. The TRD's own "canonical blueprint basis" line cites an
"Independent AI Options Bots Blueprint v5.5" as latest; only v5.4 and earlier blueprint
PDFs were found in `~/Downloads` at the time this repo was created — v5.5 was not
located. Flag this to the user if a future task needs it; do not invent its content.

## What THETA is

An assignment-aware premium-selling Wheel bot. Canonical lifecycle (TRD §4):

```
WAIT -> CSP_PROPOSED -> CSP_OPEN
  -> BTC_CLOSE / EXPIRE_OTM / ROLL_DECISION -> NEW_CSP
  -> ASSIGNED -> STOCK_HELD
       -> RECOVERY_WAIT -> SELL_STOCK
       -> CC_PROPOSED -> CC_OPEN
            -> BTC_CLOSE / EXPIRE_OTM / ROLL_DECISION -> CALLED_AWAY
  -> CASH / REDEPLOY
```

Runtime providers are **Alpaca (broker/execution truth) and Optionomics (research
intelligence) only.** No other vendor may be added without a documented missing
capability plus a controlled OOS ablation proving it's needed, per TRD Canonical
constraint (§0). Optionomics never places an order — it is a features/context source.

The performance objective is **THETA_CycleUtility** (full-cycle, after-cost, per unit
of capital-time), not leg-level win rate. The 70–80% figure is a **Managed Episode WR
research target for named, validated high-confidence cohorts** (TRD §40, §50) — never a
guarantee, never a tuning target, and never the headline number reported without Leg
WR, Whole-Chain WR, open mark-to-market P&L, AvgWin/AvgLoss, PF, and drawdown alongside
it (OUT-002).

## Non-negotiable rules (see TRD §54 for the full "Prohibited Shortcuts" table)

- Delta is not probability of profit. Never treat 25-delta as "75% win rate."
- Quantity zero is a valid, expected sizing outcome. Never `max(1, qty)`.
- A roll is close-old + open-new. The old leg's realized P&L is immutable and cannot be
  absorbed into the new trade's numbers.
- Assignment is a modeled lifecycle transition, not automatic failure.
- Missing/stale optional data becomes `UNKNOWN` — never silently coerced to zero.
- No martingale or loss-doubling sizing, ever.
- Never claim 70–80% WR from calibrated model confidence — realized WR and predicted
  probability are different quantities (STAT-001).
- Never let a backtest win rate stand in for production proof — OOS, paper mechanics,
  and small-live fills are all required before graduation (TRD §30).
- Never manipulate models, thresholds, or the OOS split to force the 70–80% number into
  view. If the honest answer is a lower WR with a better payoff/drawdown profile, report
  that instead (TRD §2.2).

## Ownership split

See `docs/OWNERSHIP.md` for the full module-by-module table. Summary: **Claude (quant
research + adversarial validation lead)** owns everything under `bots/theta/quant/`,
the research schema, feature engineering, model design, calibration, backtesting
methodology (purged walk-forward, untouched OOS, benchmarks/nulls, ablations), leakage
detection, drift monitoring, and adversarial review of Codex's engineering output.
**Codex (engineering)** owns everything under `bots/theta/app/` (API, provider
adapters, execution, lifecycle state machine, accounting, AEGIS risk enforcement,
ops/monitoring) plus migrations and infra.

When reviewing Codex-authored code in `bots/theta/app/`, check it against the TRD
requirement IDs it claims to satisfy (e.g. `ROLL-001`, `PNL-003`) — don't just check
that it runs.

## Working agreements

- This is a **paper-first, safety-critical** codebase. No task in this repo should
  place, size, or reprice a live broker order without an explicit human-approved
  graduation gate (TRD §57, gates G1–G7).
- Do not silently redesign THETA's frozen architecture (lifecycle, provider ownership,
  outcome definitions, cost treatment, risk semantics). Any of these needs a versioned
  TRD revision — raise it to the user, don't just implement a different design.
- Do not build ahead of the current phase in `docs/PHASED_PLAN.md`. Each phase has an
  explicit exit gate; do not start Phase N+1 work before Phase N's gate is met.
- Never commit `.env`, API keys, broker credentials, account statements, or model
  weights. See `.gitignore`. If you ever see what looks like a live credential in a
  file about to be committed, stop and flag it — do not commit it "to be safe."
- Prefer editing the phased plan / ownership doc over ad hoc scope creep. If new work
  doesn't fit a listed phase, that's a signal to update the plan deliberately, not to
  just start building.
