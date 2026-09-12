# R6H First Evidence Audit Template

The exact report to produce the FIRST time Codex's dataset export becomes
real and loadable -- not a strategy-profitability conclusion, a bug-finding
audit. Every field below is populated by real code already built
(`production_export_loader.py`, `dataset_readiness.py`,
`strictness_diagnostics.py`, `regime_report.py`), never invented ad hoc.

```
DATASET IDENTITY
  dataset_hash:            <LoadedDatasetExport.dataset_hash>
  hash_verified:           <LoadedDatasetExport.hash_verified>
  schema_version:          <LoadedDatasetExport.schema_version>
  source_window:           <start> .. <end>
  exported_at:             <...>
  feature_set_version:     <...>
  strategy_versions:       <...>

ROW COUNTS (raw, never independent-N -- see DEPENDENCE below)
  candidate_sets:          <len(candidate_sets)>
  candidates:              <len(candidates)>
  shadow_candidates:       <len(shadow_candidates)>
  management_snapshots:    <len(management_snapshots)>
  lifecycle_outcomes:      <len(lifecycle_outcomes)>
  whole_chain_outcomes:    <len(whole_chain_outcomes)>
  execution_evidence:      <len(execution_evidence)>

COVERAGE
  underlyings:             <count of distinct universe_evaluated entries across candidate_sets>
  contracts:                <count of distinct candidate_id-implied contract_json.symbol>
  branches represented:     <set of Candidate.branch values actually present>
  sessions/dates:           <count of distinct decision_time.date() values>

MISSINGNESS / QUALITY
  stale-data rate:          <fraction of ExecutionEvidence with data_quality in {STALE, DEGRADED}>
  provenance completeness:  <fraction of Candidates with >=1 ProviderProvenance entry per feature family>
  partial-scan rate:        <fraction of CandidateSets with completeness_state != COMPLETE>

CANDIDATE FUNNEL (strictness_diagnostics.py::CandidateFunnel, real counts)
  universe_count:           <...>
  contracts_enumerated:     <...>
  mechanically_invalid_count: <count where hard_status == INVALID>
  hard_veto_count:          <count where hard_status == HARD_VETO>
  soft_rejected_count:      <count where soft_status == REJECTED>
  ranked_count:             <count where soft_status == RANKED>
  positive_ev_count:        UNKNOWN (no calibrated EV model yet -- never fabricated)
  selected_count:           <count where selected == True>
  wait_count:               <count of GlobalWaitEvidence rows in window>

RESOLVED / UNRESOLVED LABELS (research.theta_outcome_label censoring_state)
  RESOLVED:                 <count>
  RIGHT_CENSORED:           <count>
  INVALIDATED:              <count>

EXECUTION OBSERVATIONS
  DECISION role:            <count>
  SUBSEQUENT role:          <count>
  BROKER_FILL role:         <count>
  crossed-BBO rejections:   <count caught by the loader, should be 0 in a valid export>

DEPENDENCE (dataset_readiness.py::effective_sample_size)
  raw_n (candidates):        <...>
  effective_n (distinct wheel_chain_id/underlying/session/cluster groups): <...>

READINESS VERDICT (dataset_readiness.py::classify_dataset_readiness)
  MODEL_FIT_ELIGIBLE:        YES / NO, with reasons if NO
  WALK_FORWARD_ELIGIBLE:     YES / NO
  OOS_EVALUATION_ELIGIBLE:   YES / NO

EVIDENCE SOURCE LABEL (must be stated, never blended)
  HISTORICAL_REPLAY | LIVE_SHADOW | PAPER_EXECUTION

EXPLICITLY NOT CONCLUDED FROM THIS AUDIT
  - No strategy profitability claim.
  - No opportunity-capture rate (positive_ev_count remains UNKNOWN).
  - No gate-regret figure (requires realistic counterfactual fill + outcome resolution, per item 18).
  - No calibration metric (requires resolved labels at meaningful N).
```

## What the first real audit is FOR

Per the directive's own item 27: the first real shadow days test provider
semantics, timestamp integrity, missing fields, candidate completeness,
stale data, inconsistent units, branch applicability, and quote capture --
not "does THETA make money." A first audit that surfaces zero data-quality
findings is itself suspicious (real pipelines have real edge cases); a
first audit that surfaces several is the expected, healthy outcome.
