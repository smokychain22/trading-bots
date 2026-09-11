# THETA Strategy Spec Duplication Audit (R6F)

Applies the novelty process to `THETA_STRATEGY_ENGINE_AND_IMPLEMENTATION_SPEC_v1.0`
(owner-supplied, read in full this phase) against everything already built on
this branch through R6E, before adding anything new. The second owner-supplied
PDF (`THETA_Master_Profitability_Decision_Intelligence_Blueprint_v2_Expanded`)
was not independently re-read this phase -- the primary spec's own §0.1 source
lineage states it already distills that document's content (hard/soft evidence,
management utility, strictness, WAIT, gate regret), and R6D/R6E already built
the corresponding research code from the same lineage. Re-reading it would
duplicate work already done, not surface new requirements.

## Reused as-is (no new code)

| Spec section | Already exists as | Notes |
|---|---|---|
| §12 Strategy Router / Applicability Matrix | `models/strategy_router.py` | Real, tested lifecycle/ownership/event eligibility router across all 6 families |
| §19 Position Sizing | `models/sizing.py` | `Qty=min(risk_budget, collateral, concentration, assignment_capacity, broker)`, qty=0 valid, no martingale, already tested; R6E added the monotonicity invariants the spec restates |
| §20 Management Action Frontier (point valuation) | `models/management_action_value.py` + `research/candidate_actions.py` | Real HOLD/CLOSE/ROLL/ASSIGN/EXPIRE/REDEPLOY same-state utility comparison, NetRollCredit-vs-RollUtility distinction (H-R-03) already enforced |
| §23 Roll Policy accounting invariant | `episode_economics.py::whole_episode_pnl` | The exact +200/-350/+180/-15=+15 example already a regression test |
| §40 Accounting definitions (PremiumCapture, ReturnOnSecuredCapital, ReturnPerCapitalDay, WholeChainPnL) | `episode_economics.py` | Already implements all four as explicitly distinct functions |
| §21/§22 Profit-taking / Loss-management policy families | `management_policy.py`'s `ProfitTakingPolicy`/`LossPolicy` (R6E) | Exact member-for-member match to the spec's own lists |
| §33 Hypothesis registry discipline ("should remain small... do not inflate with synonyms") | `hypotheses.json` (14 entries) + `THETA_HYPOTHESIS_REGISTRY_RECONCILIATION.md` | Already audited this phase-family; no new entries added below |
| §37 Strategy Health/Drift/Retirement statuses | `champion_challenger.py`'s `BranchStatus` (R6E) | CHAMPION/CHALLENGER/RESEARCH_ONLY/RETIRED already implemented; DEGRADED/HOLD_ONLY intermediate states are the one genuine gap (see "Extended" below) |
| §38 Shadow/Gate Regret/Action Regret | `strategy_routing_shadow.py` (R6E) | `GateRegretRecord`/`GateRegretSummary`/`StrategySelectionRegret`/`RouteRegret`/`MissedStrategyOpportunity` already implemented |
| §39 Promotion blockers (STRUCTURAL/DATA/STATISTICAL/ECONOMIC/RISK_FAILURE) | `promotion_checker.py` | Already has all 5 plus `PROMOTION_ELIGIBLE_RESEARCH`; `EXECUTION_FAILURE` named in the spec is the one new blocker class to add (see below) |
| §Formula Registry (BreakEvenWR, EdgeBuffer, ExpertReliability) | Partially -- `selection_bias.py`/`ablation.py` cover DSR/PBO/paired-ablation; `ExpertReliability` is new (see below) |

## Extended this phase (not rebuilt from scratch)

- `promotion_checker.py`: added `EXECUTION_FAILURE` as its own `PromotionResult`
  (the spec explicitly separates it from `RISK_FAILURE` -- "edge disappears
  after spread/slippage/fill reality" is a distinct failure mode from tail/ES/
  drawdown).
- `champion_challenger.py`: `BranchStatus` gains `DEGRADED` and `HOLD_ONLY` as
  intermediate states between CHAMPION/CHALLENGER and RETIRED, matching the
  spec's `PAPER_CHAMPION -> DEGRADED -> ALLOW_REDUCED/HOLD_ONLY -> CHALLENGER/
  RETIRED` health ladder exactly.
- `feature_taxonomy.py`: added a second classification dimension (feature
  FAMILY: UNDERLYING/VOLATILITY/CONTRACT/FLOW_CONTEXT/EVENT/OWNERSHIP/
  PORTFOLIO_RISK/EXECUTION/MANAGEMENT/REGIME) alongside the existing ROLE
  dimension -- the spec's §6 registry names families the R6E taxonomy did not
  yet track explicitly.
- `THETA_STRATEGY_APPLICABILITY_MATRIX.md`: extended with the spec's own
  4-way structural/empirical support labeling
  (STRUCTURALLY_APPLICABLE/EMPIRICALLY_SUPPORTED/NOT_SUPPORTED/UNKNOWN).

## Genuinely new this phase

- `bots/theta/quant/research/data/strategy_registry.json`: the runtime-
  branch-shaped registry (5 records matching `THETA_CONVENTIONAL`/
  `HOLD_STRIKE`/`RECOVERY`/`CC`/`DEFINED_RISK`, per spec §3's exact field
  list) -- distinct from the pre-existing `strategy_archetypes.json`, which
  organizes CROSS-CUTTING RESEARCH programmes (THETA-Q/H/R/C/A/D) and
  explicitly disclaims being the runtime branch enum in its own
  `$schema_note`. **Adapted format: JSON, not YAML** -- the repository's
  existing research-data convention (`hypotheses.json`,
  `strategy_archetypes.json`) is JSON; introducing YAML for one new file
  while every existing research-data file is JSON would itself be a
  needless duplication of format, so this phase followed existing
  convention over the spec's own illustrative YAML examples.
- `strategy_config.py`: the immutable `StrategyConfig` + `strategy_config_
  hash()` (§35's exact field list: strategy_id/version/status/model
  versions/candidate_lattice/hard_rules/soft_features/management_policy_id/
  promotion_evidence_hash), reusing `reproducibility.py`'s canonical-JSON
  hashing rather than inventing a second hashing scheme.
- `THETA_EXPERT_TO_STRATEGY_MAP.md`: the spec's own §28 expert table (17
  sources, more complete than the 11 previously mapped) transcribed into
  the OBSERVED/RECONSTRUCTED/INFERRED/UNKNOWN + `ExpertReliability`-concept
  format, cross-referenced against `hypotheses.json`'s existing 14 entries
  (no new hypothesis created merely because a source is newly named --
  every new source's lesson was checked against the existing registry
  first).
- `THETA_STRATEGY_GITHUB_METHOD_MAP.md`: the spec's own §31 repository
  table, cross-referenced against this branch's own prior deep-reads (GEX
  repos, `thedhruvhegde/ivsurf`, `NavnoorBawa/Options-Flow-Predictor` --
  each with a real commit SHA already recorded in earlier docs) rather than
  re-reading all ~20 repositories the spec names without a specific new
  gap, per the explicit "do not re-read 50 repos" instruction.
- `THETA_STRATEGY_VALIDATION_MATRIX.md`: ties the spec's 9-stage validation
  stack (§39) to `promotion_checker.py`'s actual gates, naming which stages
  are code-enforced today versus still procedural-only.

## Explicitly rejected (would have been duplicates)

- A third action-vocabulary enum: the spec's Appendix B action taxonomy
  matches `candidate_actions.py`'s `CandidateAction` closely enough (HOLD/
  CLOSE/ROLL/ASSIGN/EXPIRE/REDEPLOY/SELL_CC/etc.) that no new enum was
  created; `management_policy.py`'s own `ManagementAction` duplicate
  (flagged in R6E) remains flagged, not further multiplied.
- A second strategy router: `strategy_router.py` already implements §12.
- A second sizing engine: `sizing.py` already implements §19.
- A second management valuation engine: `management_action_value.py`
  already implements §20's point-estimate comparison;
  `action_value_distribution.py` (R6E) already implements the
  distributional extension the spec's richer outcome-distribution language
  implies.
