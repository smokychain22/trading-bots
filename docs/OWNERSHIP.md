# THETA Module Ownership: Claude vs Codex

Scope: `bots/theta/`. Two engineering identities work this repo — **Claude** (quant
research + adversarial validation lead) and **Codex** (application/infra engineering).
This table is the reviewable contract between them. When in doubt about who should
touch a file, this table wins over habit.

Rationale for the split: the TRD's own layer table (§2) separates **broker/execution
truth** (Alpaca), **options intelligence** (Optionomics), **alpha/policy** (THETA
engine), **risk** (AEGIS), and **audit/replay** — and separately, its repo layout (§6.1)
splits a TypeScript control plane (`src/`) from a Python quant service (`quant/`). The
ownership split below follows that same seam: Claude owns the probabilistic/statistical
core and its evidence standard; Codex owns everything that talks to a broker, holds
state, or serves an API.

## Claude-owned (`bots/theta/quant/`, research schema, quant docs)

| Module | TRD anchor | Responsibility |
|---|---|---|
| `quant/features/` | §13, Appendix H | Feature engineering: contract, premium economics, volatility, underlying, flow/context, event, portfolio, lifecycle, recovery families. Every feature must record source, `as_of`, retrieval time, and version (FEAT-001). |
| `quant/expert_priors/` | §14, §48, §53 | Expert Strategy DNA as offline priors only — reliability-weighted (shrinkage math, EXPMATH-001/002), never a runtime vendor dependency, never allowed to override a hard AEGIS veto or negative independent EV (EXP-002). |
| `quant/models/` | §17, §42, §43, §44 | Entry outcome, assignment, management, regime, cycle-value, ownership/recovery, covered-call ranker, roll evaluator, fill-probability models. Baseline-first (logistic/tree before anything else, MODEL-001). |
| `quant/calibration/` | §29, §47 | Platt/isotonic calibration, Brier/log-loss/reliability tracking by regime/DTE/delta/ticker bucket (MODEL-003, ENS-003). |
| `quant/backtest/` | §30, §49 | Purged/embargoed walk-forward, untouched OOS (never used for threshold selection — ML-002), quote-aware causal fills (VAL-001), the full B0–B6/A1–A6 benchmark and ablation matrix (§49). |
| `quant/experiments/` | §29, ML-003 | Experiment registry — every tried variant, including failures, preserved for DSR/PBO selection-bias analysis. |
| `quant/research/` | §46, §47, §50 | Point-in-time label construction (LABEL-001/002), model ensemble/decision-fusion governance, drift detection, and the statistical-claim standard for any 70–80% WR statement (§50 — cohort definition, sample size, Wilson/bootstrap interval, DSR/PBO). |
| `research.*` Postgres schema | Backend Schema doc | Claude specifies the shape (model_version, experiment, benchmark_run, ablation_result, expert_source/profile/observation, model_prediction, model_calibration_snapshot, model_drift_event, expert_prior_snapshot); Codex implements the migration. |
| `docs/QUANT_IMPLEMENTATION_MAP.md`, `docs/PHASED_PLAN.md` (quant sections) | — | Kept current by Claude as the quant build progresses. |
| Adversarial review of Codex output | all `[MUST]` IDs | Claude reviews `bots/theta/app/` changes for leakage, hindsight bias, formula correctness against Appendix A, calibration/statistical-claim compliance, and drift blind spots — not just "does it run." |

## Codex-owned (`bots/theta/app/`, migrations, infra)

| Module | TRD anchor | Responsibility |
|---|---|---|
| `app/src/api/` | ARCH-004 | Thin HTTP controllers only — no strategy/risk/execution logic in the controller layer. |
| `app/src/providers/alpaca/` | §8, Appendix B | Account, contracts, quotes/streams, orders, trade_updates, activities, corporate actions. Alpaca is authoritative for all of it. |
| `app/src/providers/optionomics/` | §9, Appendix C | Operation-alias registry bound to the live API Reference, never a guessed path; provenance/freshness/429 handling; every response UNKNOWN-on-failure, never zero (OPT-002/003). |
| `app/src/market/` | §10, §11 | FusionSnapshot construction, session/contract/market-state truth services. |
| `app/src/theta/` | §15, §16, §18–24 | Strategy orchestration: branch router, candidate generation, entry/management/roll/assignment/CC state logic. Calls Claude's `quant/` models for probabilities; does not reimplement them. |
| `app/src/risk/` | §26 | AEGIS: hard-veto vs soft-evidence enforcement, sizing bounds, stress/kill-switch. |
| `app/src/execution/` | §27, §44 | Order state machine, idempotency, adaptive limit ladder, TCA capture. |
| `app/src/lifecycle/` | §21, §23, §41 | Position state machine, assignment/expiry/exercise reconciliation, corporate-action handling. |
| `app/src/accounting/` | §25 | Whole-chain P&L, capital-days, economic vs broker/tax basis. |
| `app/src/monitoring/`, `app/src/ops/` | §32, §55 | Dashboards/alerts, scheduler/cadence, operator controls. |
| `app/src/security/`, `app/src/config/` | §33 | Secrets handling, RBAC, live-trade feature flag, config/version activation. |
| `migrations/` | Backend Schema doc | Forward-only migrations implementing the physical schema (converted from the bootstrap SQL — see `docs/specs/THETA_v1_1_PostgreSQL_Bootstrap_Schema_2026-09-09.sql`), including the views, partitioning, and RLS the schema doc promises but the bootstrap doesn't yet create. |
| Docker/CI/infra | §6, §37 | Docker Compose, GitHub Actions, environment separation (paper vs live credentials). |

## Shared / joint

| Area | How it's split |
|---|---|
| `tests/quant/` | Authored and owned by Claude (leakage, calibration, walk-forward reproducibility fixtures); run in the same CI Codex configures. |
| `tests/unit/` formula fixtures (Appendix A) | Claude specifies the formula and expected fixture values (CSP break-even, roll P&L, `EV_net`, etc.); Codex implements them in TypeScript where they live in `app/`; Claude verifies via review, not by rewriting Codex's code. |
| `risk_limit_version`, `strategy_version`, model/feature/config version records | Claude proposes values from research evidence; Codex implements the versioning/activation mechanism; neither hard-codes a threshold without a version record (§51). |

## Escalation rule

If a task seems to require touching the other owner's module, that's a signal to stop
and coordinate rather than reach across the line — especially anything that would
change provider ownership, outcome definitions, lifecycle states, or risk semantics,
which requires a versioned TRD change per the TRD's own handoff contract (§58).
