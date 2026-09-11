# THETA Strategy Validation Matrix (R6F)

Ties `THETA_STRATEGY_ENGINE_AND_IMPLEMENTATION_SPEC_v1.0` section 39's 9-stage
validation/promotion stack to what `promotion_checker.py` and its supporting
research modules actually enforce as code today, versus what remains
procedural-only (a human/process discipline, not a machine check).

| Stage | Spec purpose | Code-enforced today? | Enforcing module |
|---|---|---|---|
| 0. Mechanics | Payoff/accounting/lifecycle/order truth | Partially -- unit fixtures exist for `episode_economics.py`'s roll/denominator invariants; full lifecycle/order-state-machine fixtures are Codex/TS-owned | `episode_economics.py`, TS lifecycle tests |
| 1. Historical research | Feature/strategy hypothesis, PIT replay + realistic costs | Structurally ready (`point_in_time_join.py`, `chain_resolution.py`, `execution_simulator.py`), not yet run against real data | `point_in_time_join.py`, `chain_resolution.py`, `execution_simulator.py` |
| 2. Purged walk-forward | Model/threshold selection with purging/embargo | YES -- code-enforced | `walk_forward.py` (`build_walk_forward_plan`, `assert_no_chain_id_leakage`, `assert_labels_available_before_next_phase`) |
| 3. Untouched OOS | Positive EV_net, calibration, tail/DD, benchmark/null survival | YES -- code-enforced as a promotion GATE (not yet run against real data) | `promotion_checker.py` (`final_oos_ci_excludes_zero`, `calibration_acceptable`, `oos_ev_net`), `calibration_metrics.py`, `tail_risk_metrics.py` |
| 4. Shadow | Opportunity/strictness proof, no execution, gate/action regret tracked | Contract-level YES (dataclasses exist, `status="BLOCKED_ON_DATA"`); no real capture yet | `strategy_routing_shadow.py`, `strictness_diagnostics.py`, `opportunity_capture.py` |
| 5. Alpaca Paper | Operational execution/lifecycle mechanics | Codex-owned; outside this branch's scope | Codex's worker/reconciliation stack |
| 6. Sustained autonomous Paper | Policy stability over independent episodes | Partially -- `regime_report.py` supports per-cell N/metric reporting; no real episodes exist yet | `regime_report.py` |
| 7. Live-small eligibility | Future explicit gate only | Not applicable -- explicitly out of scope for this branch (Codex/owner-only future gate) | N/A |
| 8. Scale | Increase only inside tested envelope | Not applicable yet | N/A |

## Promotion blocker classes -- spec vs. `promotion_checker.py`

| Spec blocker | `PromotionResult` value | Status |
|---|---|---|
| STRUCTURAL_FAILURE | `STRUCTURAL_FAILURE` | Implemented (8 checks: PIT joins, leakage, resolved-chains-only, direction-aware execution, final-OOS-touched-once, dataset hashes, model version, roll accounting, return denominator, fill-probability fabrication, feature provenance) |
| DATA_INSUFFICIENT | `DATA_INSUFFICIENT` | Implemented (`independent_chain_n` vs. caller-supplied minimum) |
| STATISTICAL_FAILURE | `STATISTICAL_FAILURE` | Implemented (DSR, PBO, final-OOS CI, calibration, ablation result, regime stability) |
| ECONOMIC_FAILURE | `ECONOMIC_FAILURE` | Implemented (`oos_ev_net` must be known and positive) |
| RISK_FAILURE | `RISK_FAILURE` | Implemented (ES/drawdown regression, catastrophic subgroup collapse) |
| EXECUTION_FAILURE | `EXECUTION_FAILURE` (added R6F) | Implemented (`edge_survives_realistic_execution` must be `True`, never assumed) |

`PROMOTION_ELIGIBLE_RESEARCH` remains the ceiling this module can ever report
-- it is a research recommendation, never a Production activation. Every
threshold the checker enforces (`min_independent_chain_n`, `min_acceptable_
dsr`, `max_acceptable_pbo`, `max_acceptable_es/drawdown_regression_pct`)
remains caller-supplied and required, never invented by this module, per the
standing "no arbitrary financial threshold" instruction restated in the
directive's item 20.
