"""Machine-readable research phase-completion manifest.

Exists so a future session knows what is FINISHED and never re-derives,
re-audits, or rebuilds it. Every entry names the module/test that makes
the claim checkable -- a `COMPLETE` entry whose module does not exist is
a bug this file's own test suite catches.

`BLOCKED_ON_DATA` entries name the exact missing evidence, never a vague
"needs more work". Nothing here grants execution authority: Codex owns
canonical main, Production, migrations, Neon, worker activation,
execution gates, and broker submission.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Dict, List, Optional, Tuple


class PhaseState(str, Enum):
    COMPLETE = "COMPLETE"  # built, tested, and not to be rebuilt
    PARTIAL = "PARTIAL"  # genuinely unfinished -- MUST carry an exact remaining blocker
    BLOCKED_ON_DATA = "BLOCKED_ON_DATA"  # machinery ready; only real evidence is missing
    SUPERSEDED = "SUPERSEDED"  # replaced by a canonical Production contract; never rebuild


@dataclass(frozen=True)
class PhaseItem:
    key: str
    state: PhaseState
    modules: Tuple[str, ...]  # research modules that implement/prove the claim
    blocker: Optional[str] = None  # REQUIRED for PARTIAL and BLOCKED_ON_DATA, forbidden otherwise
    note: Optional[str] = None


_ITEMS: Tuple[PhaseItem, ...] = (
    # ---- R6 research engineering: finished, do not rebuild ----
    PhaseItem("R6_DATASET_CONTRACTS", PhaseState.COMPLETE, ("dataset_contracts.py",),
              note="Mirrors migration 018 field-for-field; migration 019 additive-only, parity re-verified."),
    PhaseItem("R6_EXPORT_LOADER", PhaseState.COMPLETE, ("production_export_loader.py",),
              note="Fail-closed intake: schema version, dataset hash, ordering, duplicate identity, enums, PIT order, crossed BBO."),
    PhaseItem("R6_PIT_FIREWALL", PhaseState.COMPLETE, ("production_export_loader.py", "point_in_time_join.py"),
              note="Recursive future-label firewall; key set unioned with Codex's own forbiddenFeatureKeys."),
    PhaseItem("R6_TARGETS", PhaseState.COMPLETE, ("research_targets.py",),
              note="Frozen under TARGET_DEFINITION_VERSION; no premium-only label exists."),
    PhaseItem("R6_DEPENDENCE", PhaseState.COMPLETE, ("dataset_readiness.py", "correlation_metrics.py", "regime_report.py"),
              note="effective_sample_size over explicit dependence-group keys."),
    PhaseItem("R6_READINESS_ENGINE", PhaseState.COMPLETE, ("dataset_readiness.py",),
              note="Six-state cumulative machine; no stage can be skipped."),
    PhaseItem("R6_EXPERIMENT_DEFINITIONS", PhaseState.COMPLETE, ("experiment_registry.py", "ablation.py", "management_policy.py"),
              note="Machine-readable experiment/ablation/policy family registry."),
    PhaseItem("R6_PROMOTION_CONTRACT", PhaseState.COMPLETE, ("promotion_checker.py", "champion_challenger.py"),
              note="Six failure classes plus PROMOTION_ELIGIBLE_RESEARCH ceiling."),
    PhaseItem("R6_AUTO_PIPELINE", PhaseState.COMPLETE, ("empirical_pipeline.py",),
              note="One entry point plus a thin `python -m research.empirical_pipeline` CLI: load -> audit -> readiness -> eligible experiments -> artifacts."),
    PhaseItem("R6_WALK_FORWARD_ENGINE", PhaseState.COMPLETE, ("walk_forward.py",),
              note="Purge/embargo/label-availability/chain-grouping all implemented and tested."),
    PhaseItem("R6_SELECTION_BIAS", PhaseState.COMPLETE, ("selection_bias.py",),
              note="DSR (sigma-scaled) and PBO (average-rank tie handling) both repaired and fixture-tested."),
    PhaseItem("R6_LOSS_TAXONOMY", PhaseState.COMPLETE, ("loss_taxonomy.py",),
              note="Failure-category enum + process/outcome grid; attribution requires evidence (raises without it) -- never labels every loss a mistake."),
    PhaseItem("R6_VOLATILITY_SURFACE", PhaseState.COMPLETE, ("volatility_surface_research.py",),
              note="Dependency-free raw-SVI quasi-explicit calibration (grid search + exact linear sub-solve), butterfly/calendar arbitrage diagnostics, SurfaceResidual. Verified against noiseless synthetic SVI data (near-zero residual, exact curve recovery)."),
    PhaseItem("R6_IV_RV", PhaseState.COMPLETE, ("iv_realized_vol_research.py",),
              note="Four RV estimators (close-to-close/Parkinson/Garman-Klass/Rogers-Satchell) with documented assumptions; VRP quantities refuse to compute across mismatched IV/RV horizons."),
    PhaseItem("R6_TERM_STRUCTURE_CHALLENGER", PhaseState.COMPLETE, ("term_structure_research.py",),
              note="Resolves RESEARCH_CHALLENGER A: implements all-strike-mean (mirrors Production), ATM-relative, matched-log-moneyness, total-variance, and forward-variance term methods side-by-side; declares no winner."),
    PhaseItem("R6_PAPER_BASELINE_DTE_BIAS", PhaseState.COMPLETE, ("paper_baseline_dte_bias.py",),
              note="Resolves RESEARCH_CHALLENGER B: DTE-bucket funnel (raw/eligible/frontier/selected/near-miss) built ahead of data per the standing instruction; auto-detects a genuine short-DTE selection skew the moment real baseline receipts exist."),
    PhaseItem("R6_FAMILY_ADAPTERS", PhaseState.COMPLETE, ("research_family_adapters.py",),
              note="Wires surface/IV-RV/term/DTE-bias research into READY/INSUFFICIENT_DATA/INVALID_INPUT/NOT_APPLICABLE states. Candidate.contract/market/volatility are confirmed opaque (both here and in Production's own point-in-time-evidence.ts) -- extraction requires an explicit caller-supplied FeatureFieldMap rather than a guessed key name; confirming the real key names is a named, narrow RESEARCH_HANDOFF item, not fabricated here. Companion to, never a modification of, empirical_pipeline.py (which is independently ported/maintained on canonical main)."),
    PhaseItem("R6_HYPOTHESIS_EXPERIMENT_LINKAGE", PhaseState.COMPLETE, ("experiment_registry.py",),
              note="All 14 hypotheses now resolve to at least one experiment_id (7 were previously unlinked: H-H-01/02, H-C-01/02, H-A-02/03/04, H-D-01); FEATURE_ABLATION_FAMILIES gained SKEW/TERM/SURFACE as first-order ablations distinct from the general VOLATILITY bucket, backed by the new dedicated research modules."),
    PhaseItem("R6_OPTIONOMICS_CONTEXT_METRICS", PhaseState.COMPLETE, ("optionomics_context_metrics.py",),
              note="Consumes Codex's confirmed normalizeMetrics field mapping (verified directly against src/theta/optionomics-provider.ts @ 1a00fa9 -- not a guess), preserving KNOWN/UNKNOWN/INVALID exactly. Wires TermMethod.PROVIDER_TERM_METRIC using the confirmed termSlope<-vol_term_structure_slope mapping."),
    PhaseItem("R6_GAMMA_REGIME", PhaseState.COMPLETE, ("gamma_regime_research.py",),
              note="Simple rule-based gamma-regime classifier matching models/regime_v0.py's exact discipline (versioned/required thresholds, UNKNOWN preserved, reason codes) -- a CHALLENGER input to regime_v0's axes, never a replacement without OOS evidence. Never asserts GEX-sign-implies-direction; requires explicit sign_convention_verified=True before classifying a sign at all. FEATURE_ABLATION_FAMILIES gained GEX/DEX as first-order ablations backed by this module."),
    PhaseItem("R6_WR_ILLUSION_DETECTOR", PhaseState.COMPLETE, ("wr_illusion_detector.py",),
              note="Five structural checks for the primary mission question (\"is the apparent 70-80% WR real or an accounting illusion?\"): many-small-wins/few-unresolved-large-losses, closed-vs-whole-chain WR divergence, open-inventory exclusion, roll-loss erasure, event-period cherry-picking. Every check is None (never a guessed verdict) until its own inputs are known; any_illusion_confirmed is likewise None until every check has actually run."),
    PhaseItem("R6_EXPOSURE_HEATMAP", PhaseState.COMPLETE, ("optionomics_exposure_heatmap.py",),
              note="Consumes Codex's now-confirmed gamma/Vanna/Charm exposure-heatmap grids (canonical main a36ac88/92f9fc1; each request validated to echo its own requested metric). Never interprets a cell's sign/magnitude as directional -- units and sign convention stay provider-unverified through every result. FEATURE_ABLATION_FAMILIES gained VANNA/CHARM as first-order ablations (15->17)."),
    PhaseItem("R7_PUBLIC_EVIDENCE_HIERARCHY", PhaseState.COMPLETE, ("../public_evidence/loader.py", "../public_evidence/data/public_evidence_sources.json"),
              note="R7 'STRATEGY EDGE DISCOVERY PROGRAM' section-1 evidence hierarchy: named, publicly citable sources (Cboe PUT/BXM index methodology+performance, Carr & Wu 2009 variance-risk-premia, tastytrade's own published 45-DTE/21-DTE/50%-management findings) actually fetched via WebSearch 2026-09-14, each tiered (AUDITED_BENCHMARK_INDEX > PEER_REVIEWED_ACADEMIC > TRANSPARENT_PRACTITIONER_STUDY) and cross-linked to hypotheses.json via a new optional public_evidence_refs field (H-Q-01/H-Q-02 VRP entry, H-R-01/H-R-02 management timing, H-C-01 covered-call). Every source carries a mandatory does_not_prove field -- none of this is THETA-specific backtest evidence; every linked hypothesis stays status TEST. Distinct from expert_priors/ (private D_EXPERT_DNA corpus, not duplicated)."),
    PhaseItem("R7_PROFIT_PRESERVATION_RESEARCH", PhaseState.COMPLETE, ("profit_preservation_research.py",),
              note="R7 'DYNAMIC PROFIT PRESERVATION + STRATEGY SWITCHING' directive: PROFIT_CAPTURE_RATIO/PEAK_CAPTURE_RATIO/PROFIT_GIVEBACK/GIVEBACK_RATIO/REMAINING_REWARD/REMAINING_REWARD_PER_CAPITAL_DAY/REMAINING_REWARD_TO_RISK computed as pure arithmetic on caller-supplied facts; HOLD_CONTINUATION_VALUE/CLOSE_AND_REDEPLOY_VALUE deliberately never computed -- return a named MODEL_REQUIRED/REDEPLOY_OPPORTUNITY_SET_REQUIRED blocker instead of a fabricated number. GIVEBACK_RATIO is None (never 0) when peak was never positive. PROFIT_TAKING_POLICIES extended 8->19 (experiment_registry.py) with the full fixed-percentage lattice plus DYNAMIC_PROFIT_GIVEBACK. hypotheses.json gained H-Q-03 (cross-branch regime-conditioned switching, TEST, gated same as H-D-01), H-Q-04 (switching-cost measurement discipline, RETAIN), and (P2 pass) H-Q-05/H-Q-06 (VRP-collapse and skew-steepening switching, restated in strictly options-chain terms per the R7 options-trading-research-boundary directive -- never an underlying-price proxy). See docs/research/THETA_DYNAMIC_MANAGEMENT_AND_STRATEGY_SWITCHING.md."),
    PhaseItem("R7_WAIT_DIAGNOSTICS", PhaseState.COMPLETE, ("wait_diagnostics_research.py",),
              note="R7 P2C directive: closes the 'WAIT_RESEARCH = GAPS' item carried across two prior sessions. classify_wait() maps a per-cycle funnel (mirrors canonical-strategy-frontier.ts's own candidate/branch counters) into the ten named WAIT categories, priority-ordered so a structural blocker (data/quote/event/liquidity/portfolio) always outranks OVERSTRICT_POLICY_WAIT/POSSIBLE_LOGIC_PARALYSIS. evaluate_false_reject() requires a tail-adjusted edge AND a genuinely feasible fill (never assumed) before ever calling a rejection FALSE_REJECT -- profitability alone is explicitly insufficient. 20 tests."),
    PhaseItem("R7_FLOW_TEMPORAL", PhaseState.COMPLETE, ("optionomics_flow_temporal_research.py",),
              note="R7 P2C directive: closes the FLOW_ACCELERATION/DECELERATION/REVERSAL/PERSISTENCE gap named two sessions ago, scoped to the CONFIRMED-populated aggregate net-flow series (not per-print flow, which optionomics_flow_event.py already covers separately, still schema-unknown). Mirrors optionomics-temporal-features.ts's exact discipline: same-underlying/same-window-label check, strict causal ordering, caller-supplied bounded gap, UNKNOWN/INVALID propagation. classify_flow_direction() requires exactly three observations (two deltas) and a caller-supplied persistence_tolerance -- no hardcoded default. 15 tests."),
    PhaseItem("R7_GEX_SPOT_SCAN", PhaseState.COMPLETE, ("gex_spot_scan_research.py", "bs_reference.py"),
              note="R7 P2C directive: formalizes THETA's independent spot-scan gamma-flip methodology (method cited from sgdividends/spx-dealer-gamma, no code adopted -- see THETA_EXTERNAL_REPO_PATTERN_MATRIX.md). Recomputes each contract's Black-Scholes gamma (new bs_gamma() added to the canonical bs_reference.py) across a caller-supplied spot grid, aggregates signed exposure under an explicit, never-silently-verified GexSignConvention, and reports NO_CROSSING/COMPUTED/MULTIPLE_CROSSINGS/SPARSE_CHAIN/INVALID_GRID -- never a fabricated single answer. Deliberately distinct from and never merged with Optionomics' own provider-reported gammaFlipStrike (matches the dual-provenance discipline already verified in options-chain-decision-intelligence.ts). 14 tests (5 bs_gamma + 9 spot-scan)."),
    PhaseItem("R6_FLOW_WEBHOOK_COMPOSITE_QUALIFICATION", PhaseState.BLOCKED_ON_DATA,
              ("optionomics_flow_event.py", "optionomics_webhook_validation.py", "optionomics_flow_chain_fusion.py"),
              blocker="No real Optionomics flow/webhook payload has ever been observed by this branch. Confirmed via WebFetch (2026-09-14) of optionomics.ai/features/api (webhook transport advertised for 'Options Flow'/'Unusual prints' alert channels, zero payload schema documented) and optionomics.ai/docs/api (developer reference states verbatim 'there is no webhook functionality described for Option Alerts or Options Flow'). All three modules are schema-agnostic and fully tested against synthetic fixtures (FeatureFieldMap-style explicit field maps; every field defaults to None/UNKNOWN, nothing guessed); they activate the moment a real captured payload supplies actual key names. Composite fusion requires a caller-supplied, justified max_event_to_chain_latency_seconds and classification_tolerance -- never hardcoded here.",
              note="Direct Optionomics execution-quote qualification remains separately, independently CLOSED as NOT_QUALIFIED (session-snapshot chain reads; see docs/research/R6_MEGA_PHASE_PARITY_ADDENDUM.md). This item is the SEPARATE composite/temporal-fusion path (flow print + immediate chain fetch) -- not yet observable, not yet disproven. ExecutionOptionQuote.sourceSemantics has no existing value for a temporally-fused composite; flagged for Codex, not silently mapped onto CONSOLIDATED_NBBO/TRUSTED_TWO_SIDED_ORDER_PRICING/INDICATIVE."),

    # ---- R6 empirical evidence: only real data is missing ----
    PhaseItem("R6_REAL_PIT_DATA", PhaseState.BLOCKED_ON_DATA, ("empirical_pipeline.py",),
              blocker="No Production dataset export exists. Codex handoff 2026-09-12: zero point-in-time rows, zero shadow candidates, zero resolved labels, zero subsequent quote observations."),
    PhaseItem("R6_MODEL_FIT", PhaseState.BLOCKED_ON_DATA, ("empirical_pipeline.py", "baseline_models.py"),
              blocker="Requires MODEL_FIT_ELIGIBLE readiness, which requires resolved labels that do not exist."),
    PhaseItem("R6_WALK_FORWARD", PhaseState.BLOCKED_ON_DATA, ("walk_forward.py",),
              blocker="Requires resolved chains spanning enough sessions to build folds."),
    PhaseItem("R6_OOS", PhaseState.BLOCKED_ON_DATA, ("walk_forward.py", "promotion_checker.py"),
              blocker="Requires a walk-forward plan plus a reserved untouched final segment."),
    PhaseItem("R6_CALIBRATION_EMPIRICAL", PhaseState.BLOCKED_ON_DATA, ("calibration_metrics.py",),
              blocker="Requires predicted probabilities paired with realized binary outcomes."),
    PhaseItem("R6_GATE_REGRET", PhaseState.BLOCKED_ON_DATA, ("strategy_routing_shadow.py",),
              blocker="Requires defensible counterfactual fill semantics plus resolved outcomes for soft-rejected candidates."),
    PhaseItem("R6_ACTION_REGRET", PhaseState.BLOCKED_ON_DATA, ("strategy_routing_shadow.py",),
              blocker="Counterfactual management paths branch; requires a defensible branching methodology plus resolved alternative outcomes."),

    # ---- Fast-forward research phases ----
    PhaseItem("R3_QUANT", PhaseState.COMPLETE, ("account_risk_capacity.py",),
              note="Per-account isolated capacities, min-of-capacities quantity, isolation violations, exit check."),
    PhaseItem("R4_QUANT", PhaseState.COMPLETE, ("follower_copy_economics.py",),
              note="Follower sizing from own capacity only, copyability decisions, lifecycle eligibility, roll leg independence, degradation metrics, master-fill-first confirmation, DIRECTION-AWARE credit/debit price deterioration (Codex-identified defect, repaired), sizing-basis research (equity/risk-budget/collateral/ES-CVaR/hybrid, always subordinate to the hard capacity cap), exit check."),
    PhaseItem("R8_COHORT_ANALYTICS", PhaseState.COMPLETE, ("paper_cohort_analytics.py",),
              note="15-dimension cohort vocabulary, per-episode PnL decomposition (decision/execution/sizing/management/tail) with a reconciliation check that raises on a mismatched sum."),
    PhaseItem("R5_QUANT", PhaseState.COMPLETE, ("quant_explanation_contracts.py",),
              note="Candidate/position/strategy/performance explanations, uncalibrated-probability guard, decision-field consistency validation, exit check."),
    PhaseItem("R7_RESEARCH_GATE", PhaseState.COMPLETE, ("research_evidence_packet.py",),
              note="Fourteen-dimension all-True packet; any False or None blocks readiness."),
    PhaseItem("R8_ANALYTICS", PhaseState.COMPLETE, ("paper_validation_analytics.py",),
              note="Paper-only summary contract, operational incident tally, stability recommendation."),
    PhaseItem("R9_RESEARCH_GATE", PhaseState.COMPLETE, ("research_evidence_packet.py",),
              note="Live-small research evidence gate; recommendation only, never an activation."),

    # ---- Superseded by canonical Production contracts ----
    PhaseItem("RESEARCH_STRATEGY_REGISTRY", PhaseState.SUPERSEDED, ("strategy_config.py",),
              note="src/theta/strategy-package.ts is the canonical strategy-version/config authority; do not extend the research copy."),
    PhaseItem("RESEARCH_FEATURE_TAXONOMY", PhaseState.SUPERSEDED, ("feature_taxonomy.py",),
              note="Codex's TypeScript hard/soft evidence contract owns runtime classification; the Python taxonomy stays research-only."),
    PhaseItem("NARROW_PAPER_READINESS_PRECHECK", PhaseState.SUPERSEDED, ("research_evidence_packet.py",),
              note="REMOVED from dataset_readiness.py (Codex removed the same helper on canonical main, 115285b). research_evidence_packet.research_ready_for_paper (14 dimensions) is now the ONLY R7 entry point; do not reintroduce an 8-dimension subset."),
)

PHASE_STATUS: Dict[str, PhaseItem] = {item.key: item for item in _ITEMS}


def get(key: str) -> Optional[PhaseItem]:
    return PHASE_STATUS.get(key)


def items_in_state(state: PhaseState) -> List[PhaseItem]:
    return [item for item in _ITEMS if item.state == state]


def blockers() -> Dict[str, str]:
    """Every currently-blocking item mapped to its exact blocker text --
    the single place a future session reads to learn what is genuinely
    left, without re-deriving it from commit history."""
    return {item.key: item.blocker for item in _ITEMS if item.blocker is not None}


def validate_manifest() -> List[str]:
    """Structural self-check: PARTIAL/BLOCKED_ON_DATA must carry a
    blocker; COMPLETE/SUPERSEDED must not; every item must name at least
    one module. Returns violations (empty = valid)."""
    violations: List[str] = []
    for item in _ITEMS:
        requires_blocker = item.state in (PhaseState.PARTIAL, PhaseState.BLOCKED_ON_DATA)
        if requires_blocker and not item.blocker:
            violations.append(f"{item.key}: {item.state.value} requires an exact blocker")
        if not requires_blocker and item.blocker:
            violations.append(f"{item.key}: {item.state.value} must not carry a blocker")
        if not item.modules:
            violations.append(f"{item.key}: no implementing module named")
    return violations
