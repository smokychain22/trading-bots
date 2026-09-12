# THETA R6G Empirical Strategy Proof Program

The complete research program to run the moment a real point-in-time
options-chain/lifecycle dataset exists. This document is the plan; nothing
in it is a claimed result. Every experiment below produces
`EV_MODEL_NOT_EMPIRICALLY_READY` until it actually runs against real data.

**Codex integration note (read first):** Codex integrated a canonical
Production strategy package this same day (`d43191b`) and reviewed Claude's
prior R6F work in `docs/strategy/THETA_STRATEGY_IMPLEMENTATION_GAP_AUDIT.md`.
Key outcomes that shape this document: `strategy-package.ts` is now the
single canonical strategy-version/config schema (Claude's `strategy_
config.py`/`strategy_registry.json` are **not** re-extended going forward --
superseded, kept only as historical research artifacts); `feature_
taxonomy.py` is superseded by Codex's own TS hard/soft evidence contract;
`management_policy.py` remains flagged REJECT for its duplicate action
vocabulary (its `ExitPolicyFamily`/`LossPolicy`/`GlobalWaitReason` taxonomies
and the UNKNOWN-to-zero fix are still useful research artifacts, just not a
Production input); `action_value_distribution.py`'s UNKNOWN-first
distributional shape was ported into `strategy-evaluation-contract.ts` and
should be treated as validated design; `promotion_checker.py`'s ablation-
result/regime-stability requirements were accepted as promotion-policy
*concepts*, not merged as a Production module. This document builds on top
of that reconciliation rather than re-opening it.

## 1. Dataset contract

`bots/theta/quant/research/dataset_contracts.py` (this phase) defines the 9
record types the directive requested (`CandidateSet`, `Candidate`,
`SelectedCandidate`, `ShadowCandidate`, `ManagementSnapshot`,
`ManagementActionSet`, `EconomicEpisode`, `ExecutionEvidence`,
`LifecycleEvent`), each carrying a shared `RecordLineage` (as_of, provider
timestamp, ingestion timestamp, strategy/feature/model/cost/risk versions,
contract identity, lifecycle chain id) and field-aligned to Codex's own
`ThetaStrategyBranch`/`ThetaStrategyAction` enums so a research replay
joins against Production evidence without a translation layer.

## 2. Target definitions (frozen)

`bots/theta/quant/research/research_targets.py` freezes the exact target
list under `TARGET_DEFINITION_VERSION = "theta-research-targets-v1"`:
Primary (WholeChainNetPnL, ManagedEpisodeNetPnL, ReturnOnSecuredCapital,
ReturnPerCapitalDay), Risk (MaxDrawdown, MaxAdverseExcursion, ExpectedShortfall,
SevereDrawdownEvent), Lifecycle (Assignment, RecoveryDuration,
RecoverySuccess, CallAway, CapitalLock), Execution (Fill/NoFill, Slippage,
SpreadCapture, Markout). No premium-only label exists anywhere in this list
(tested).

## 3. Strategy-specific dataset slices

Each branch's `EconomicEpisode` rows must be filtered by `branch` before any
cross-branch comparison -- `dataset_contracts.py`'s `EconomicEpisode.branch`
field is the join key. Per-branch lifecycle boundaries (never mixed):

| Branch | Episode starts | Episode ends | Distinguishing lifecycle events |
|---|---|---|---|
| THETA_CONVENTIONAL | CSP open | Expiry/close/assignment-or-redeploy | Standard 25-60 DTE lattice |
| THETA_HOLD_STRIKE | CSP open (validated cohort) | Expiry/close/assignment-or-redeploy | 2-5 DTE, ATM/near-ATM |
| THETA_RECOVERY | Assignment reconciled | Stock sold OR CC opened OR still open (censored) | Must never be scored until either resolved or explicitly censored per `chain_resolution.py` |
| THETA_CC | CC opened | CC close/expiry/call-away | Requires confirmed stock inventory as episode precondition |
| THETA_DEFINED_RISK | Spread opened (gated) | Spread close/expiry | Disabled; dataset slice defined for completeness only, not to be populated before Level 3 + graduation |

## 4. THETA-CONVENTIONAL empirical program

Feature families to test (each its own ablation rung, per §16 below): DTE
lattice (25-35/36-45/46-60), delta lattice (0.10-0.15 through 0.30-0.40),
ownership quality, oversold state, trend, momentum, IV percentile, skew,
term, VRP proxy, event distance, flow, UOA, expected move, liquidity.
Primary questions: is there positive after-cost EV; which DTE/delta
regions; which underlying families; which volatility regimes; which
feature families matter. Answered via `regime_report.py`'s per-cell
breakdown (never a single blended number) plus `ablation.py`'s paired
comparison per feature family.

## 5. HOLD-STRIKE empirical program

Tested strictly separately from THETA_CONVENTIONAL (never pooled). Required
risk analysis alongside any WR figure: open inventory drawdown, assignment
burden, capital lock, recovery-time tails, gap risk. A high closed-trade WR
alone (H-H-02, already RETAIN in `hypotheses.json`) can never qualify as
success -- Managed Episode WR, Whole-Chain WR, and Open MTM must accompany
it, per the SQQQ/IWM failure-DNA control already documented in
`THETA_EXPERT_TO_STRATEGY_MAP.md`.

## 6. RECOVERY empirical program

`RECOVERY_WAIT` vs `SELL_STOCK` vs `SELL_CC`, same state/timestamp, via
`action_value_distribution.py`'s outcome-distribution contract (expected/
median/p25/p5/ES/probability-positive/capital-days), never a fixed
recovery-day count. Targets: future wealth, recovery duration, downside,
capital-days, call-away regret.

## 7. COVERED-CALL empirical program

Strike x expiration frontier compared against no-call/sell-stock/recovery-
wait, per `CCUtility` (already specified: EV_premium + EV_stock -
CallAwayRegret - EventRiskPenalty - ExecutionCost - TailPenalty). Analyzed
dimensions: premium, retained upside, call-away (empirically estimated
probability, never delta-derived), ex-dividend/early-assignment risk,
recovery interference, execution.

## 8. DEFINED-RISK empirical program

CSP vs put credit spread, ONLY where structures are genuinely comparable
(same underlying, same approximate risk budget). Metrics: EV, ES, capital
efficiency, fills, slippage, tail, operational complexity. Remains
`RESEARCH_ONLY`/`DISABLED` (per `strategy_registry.json` and Codex's own
`strategy-package.ts` schema refinement rejecting any non-RESEARCH_ONLY
status for this branch) regardless of research findings, until Level 3 +
THETA-Q/H/R/C/A graduation.

## 9-12. Entry / Ownership / Assignment / Management models

- **Entry model**: baseline logistic, challenger LightGBM/XGBoost, target
  `P(net-positive managed episode | state, candidate)`. Delta is never the
  target probability. Calibration mandatory (`calibration_metrics.py`
  reused, not reimplemented).
- **Ownership model**: `P(severe drawdown)`, recovery distribution,
  assignment suitability from historical drawdown/gap behavior/realized
  vol/trend/downside semivariance/fundamentals where available. Answers
  "is assignment economically survivable."
- **Assignment model**: empirically estimated assignment outcome and
  post-assignment downside conditioned on moneyness/DTE/extrinsic/ex-
  dividend state/volatility/contract state -- delta is never called
  "assignment probability" anywhere in this pipeline.
- **Management model**: HOLD/CLOSE/ROLL/ASSIGN/EXPIRE/REDEPLOY as a
  competing-risks/hazard problem, baselines before policy-value
  challengers, output via `action_value_distribution.py`'s
  `OutcomeDistribution` (already built, Codex-validated design) -- never a
  single fake point number.

## 13-15. Exit / loss / roll experiments

`ProfitTakingPolicy` (8 variants) and `LossPolicy` (6 variants) already
enumerated in `management_policy.py`; roll experiment reuses
`episode_economics.py::whole_episode_pnl`'s roll-accounting invariant. All
three experiments evaluate whole economic episodes (never leg-level),
report `WholeChainNetPnL`/`ReturnPerCapitalDay`/ES/DD/assignment burden/
execution costs together, and explicitly test rather than assume that
`NetRollCredit > 0` predicts beneficial whole-chain economics (H-R-03
already frames this as an open, testable claim, RETAIN at the architecture
level only).

## 16. Feature ablation program

`ablation.py`'s `classify_ablation_result` (IMPROVES/NEUTRAL/DEGRADES/
INCONCLUSIVE) and `paired_mean_difference` (the corrected, paired
statistic) run one feature family at a time against
`CURRENT_FEATURE_FAMILY_STATUS`'s 12 families, reporting ΔEV_net,
ΔReturnPerCapitalDay, ΔES, ΔDD, ΔBrier, ΔECE, Δassignment burden,
Δrecovery duration, Δopportunity capture with uncertainty. A feature
contributing nothing is zero-weighted/removed, never retained "because it
sounds sophisticated."

## 17-19. Strictness / gate regret / action regret

`strictness_diagnostics.py`'s `CandidateFunnel`/`RejectionBreakdown`
already distinguish selectivity from paralysis; `strategy_routing_
shadow.py`'s `GateRegretRecord`/`GateRegretSummary` already implement the
false-reject/correctly-rejected/unknown breakdown by gate. Action regret
(HOLD vs CLOSE/ROLL, SELL_CC vs RECOVERY_WAIT) extends the same shadow
pattern but remains `BLOCKED_ON_DATA` until a defensible counterfactual-
branching methodology is designed -- explicitly flagged as NOT simplistic
hindsight (a chosen ROLL's counterfactual CLOSE path branches differently
than its counterfactual HOLD path; these are not interchangeable single
numbers).

## 20-21. Regime model / strategy applicability

Baseline transparent rules/clustering before any HMM challenger (HMM only
if it shows incremental untouched-OOS value). Final applicability matrix:
branch x regime x underlying-family x DTE x delta x event-state, each cell
reporting N, EV, ES, DD, calibration, execution survival, confidence
interval. `THETA_STRATEGY_APPLICABILITY_MATRIX.md`'s STRUCTURALLY_
APPLICABLE/EMPIRICALLY_SUPPORTED/NOT_SUPPORTED/UNKNOWN labeling already
established this phase; every cell is `UNKNOWN` for empirical support
until real data exists, and no cell may claim `EMPIRICALLY_SUPPORTED` on
thin evidence.

## 22. Execution model

Baseline: `execution_simulator.py`'s existing direction-aware bid/ask
pricing (fixed this repository's own R6 defect: never midpoint-anchored).
Later: `P(fill | limit, BBO, size, state)` and slippage calibrated from
real Paper/live TCA -- structurally impossible before that data exists.
Midpoint-filled backtests remain explicitly unacceptable.

## 23. Dependence / effective sample size

`regime_report.py`'s `count_distinct_chains`/`count_same_key_clusters`
already implement the "10 correlated trades is not N=10 independent
observations" correction. Every reported N must distinguish raw_n from
independent_chain_n, and same-day/same-underlying/correlated-symbol/
repeated-regime clustering must be reported alongside any aggregate
statistic.

## 24-25. Walk-forward / leakage suite

`walk_forward.py` already implements TRAIN->embargo->VALIDATION->embargo->
FORWARD_TEST with a reserved untouched final OOS segment,
`assert_no_chain_id_leakage`, and (added R6/R6D) `decision_time`/`label_
availability_time` fields plus `assert_labels_available_before_next_
phase`. R6D/R6E added explicit tests proving roll/assignment-recovery/CC-
extending chains stay whole within a fold. Still to add once real data
exists (cannot be meaningfully tested against synthetic fixtures alone):
future option-chain/IV/event-knowledge leakage, revised-macro-value
leakage, future-recovery-state leakage, future-fill-evidence leakage --
each requires a real provider-timestamp-vs-availability discrepancy to
exercise honestly rather than a synthetic stand-in.

## 26-28. Multiple testing / calibration / uncertainty

`selection_bias.py`'s DSR (variance-vs-stddev bug fixed R6) and PBO (tie-
handling bug fixed R6) remain the standing multiple-testing guard; every
failed variant is retained in the experiment registry, never silently
dropped. `calibration_metrics.py` (Brier, log loss, reliability, ECE)
already exists and must be reported by branch/regime/DTE/delta/ticker
family, not one global number. Model uncertainty (as distinct from outcome
uncertainty) via ensemble disagreement/OOD detection remains explicitly
deferred until real data justifies the added complexity -- per the
standing "do not implement complexity without data" instruction.

## 29. Strategy health

`champion_challenger.py`'s `BranchStatus` (CHAMPION/CHALLENGER/DEGRADED/
HOLD_ONLY/RESEARCH_ONLY/RETIRED, extended R6F with the DEGRADED/HOLD_ONLY
health-drift ladder) provides the research-recommendation status; Codex's
own `strategy-package.ts` `promotionStatus` enum (`UNVALIDATED/RESEARCH_
ELIGIBLE/PROMOTED/DEGRADED/RETIRED`) is the actual Production-side status
this research recommendation feeds -- this module never sets Production
status itself.

## 30-31. Expert priors / GitHub methods

Both corpora (21 experts, 26 repositories) are already fully mapped
(`THETA_EXPERT_TO_STRATEGY_MAP.md`, `THETA_STRATEGY_GITHUB_METHOD_MAP.md`).
No further collection planned. The one remaining empirical question for
each: whether `expert_prior` (already a classified `SOFT_FEATURE` in
`feature_taxonomy.py`, UNDERLYING family) adds incremental OOS value once
real data exists -- tested via the same `ablation.py` ladder as any other
feature family, zero-weighted/removed if it does not.

## 32. Flow ablation ladder

Already specified in `THETA_FLOW_METHOD_COMPARISON.md`: BASELINE_THETA + 
unusual/UOA activity + premium size + sweep + Volume/OI + aggressor
inference + opening-confidence + net call/put flow + persistence, one
rung at a time, each its own `AblationRecord`. Leakage guards already
named (friend-bot audit): `highest_return`/`current_return` provider-
semantics verification required before any use; `size > OI` never treated
as proof of opening; UNKNOWN flow confirmation never silently becomes
CONFIRMED.

## 33-34. Profitability report / promotion

`promotion_checker.py`'s 6 failure classes (STRUCTURAL/DATA_INSUFFICIENT/
STATISTICAL/ECONOMIC/RISK/EXECUTION_FAILURE) plus `PROMOTION_ELIGIBLE_
RESEARCH` remain the research-side gate; a full profitability report (per
branch: raw N, independent N, WR, AvgWin/AvgLoss, PF, EV, ES, DD, ROSC,
ReturnPerCapitalDay, assignment rate, recovery time, Open MTM, calibration,
execution degradation) is produced by `regime_report.py` once real
`EconomicEpisode` rows exist -- never headline WR alone. `PROMOTION_
ELIGIBLE_RESEARCH` is the ceiling this research program can ever report;
Codex/owner retain sole Production-activation authority.

## 35. R6 completion definition

R6 is complete only when the questions in the directive's own final list
are answerable FROM EVIDENCE, not from architecture alone: which strategy
works, where, why, with what uncertainty; which features help/hurt; when
to enter/close/roll/accept-assignment/sell-CC; whether THETA is too
strict; true after-cost expectancy; realistic tail risk. Every module in
this document is the machinery to answer those questions the moment real
data exists -- none of them answers it yet, and none of them fabricates an
answer in the meantime.
