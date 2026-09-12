# R6H Production <-> Research Schema Parity

Compares `migrations/018_point_in_time_evidence_pipeline.sql`,
`src/research/point-in-time-evidence.ts`, and `src/research/postgres-
dataset-export.ts` (all read this phase, origin/main `db0f17a`) field-by-
field against `bots/theta/quant/research/dataset_contracts.py`. Per the
directive: where Production has already chosen a canonical field, research
ADAPTS to it -- `dataset_contracts.py` was rewritten this phase to match
exactly (R6G's version, written before this Production schema existed, is
superseded).

| Semantic concept | Production field | Research field | Units | Timestamp meaning | Null meaning | Status | Action |
|---|---|---|---|---|---|---|---|
| Candidate identity | `trade.candidate_point_in_time_evidence.candidate_id` (uuid) | `Candidate.candidate_id` (str) | opaque id | n/a | never null (PK) | MATCH | none |
| Candidate branch | `...candidate_point_in_time_evidence.branch` (text) | `Candidate.branch` (`ThetaStrategyBranch`) | enum string | n/a | never null | MATCH | Python enum mirrors `strategy-package.ts`'s `thetaStrategyBranch` exactly |
| Hard eligibility | `...hard_status` CHECK(FEASIBLE/HARD_VETO/INVALID/DATA_INSUFFICIENT) | `Candidate.hard_status` (`HardStatus`) | enum | n/a | never null | MATCH | none |
| Soft ranking | `...soft_status` CHECK(RANKED/REJECTED/UNKNOWN) | `Candidate.soft_status` (`SoftStatus`) | enum | n/a | never null | MATCH | none |
| Decision timestamp | `...decision_time` (timestamptz) | `Candidate.decision_time` (ISO str) | UTC instant | the PIT moment this candidate was evaluated | never null | MATCH | none |
| Feature-family blobs | `contract_json`/`market_json`/`volatility_json`/`technical_json`/`event_json`/`flow_json`/`ownership_json`/`account_json`/`portfolio_json`/`aegis_json`/`execution_json`/`known_economics_json` (jsonb, opaque object) | `Candidate.{contract,market,volatility,technical,event,flow,ownership,account,portfolio,aegis,execution,known_economics}` (`Dict[str,Any]`) | opaque | n/a | `{}` = no data recorded, distinct from a key present with `null` value | MATCH | Research module never redefines their internal shape -- validated only for future-label contamination (`production_export_loader.py::assert_no_future_labels`) |
| Unknown economics | `unknown_economics_json` (jsonb array of strings) | `Candidate.unknown_economics` (tuple of str) | list of field names | n/a | `[]` = nothing unknown | MATCH | none |
| Provenance | `provider_provenance_json` (jsonb array), each entry: source/operationAlias/providerTimestamp/ingestionTimestamp/asOf/version/state | `ProviderProvenance` dataclass, same 7 fields | mixed | `provider_timestamp <= as_of`, `ingestion_timestamp >= as_of` (both DB-and-TS-enforced) | `provider_timestamp` nullable = provider gave no timestamp | MATCH | Both invariants re-verified in `production_export_loader.py`, not just trusted because the row came from Production |
| Data quality | `state`/`data_quality` CHECK(GOOD/DEGRADED/STALE/UNKNOWN/INVALID/NOT_ENTITLED) | `DataQuality` enum | enum | n/a | never null | MATCH | none |
| Candidate-set completeness | `trade.candidate_set_evidence.completeness_state` CHECK(COMPLETE/PARTIAL/UNKNOWN) | `CandidateSet.completeness_state` (`CompletenessState`) | enum | n/a | never null | MATCH | none |
| Candidate-set selection | `best_candidate_id`/`second_best_candidate_id`/`best_rejected_candidate_id` (uuid, nullable, on `candidate_set_evidence`) | `CandidateSet.{best_candidate_id,second_best_candidate_id,best_rejected_candidate_id}` | opaque id | n/a | `null` = no such candidate exists for this set | MATCH | R6G's separate `SelectedCandidate` type REMOVED -- would have been a parallel schema |
| Universe/branch coverage | `universe_evaluated_json`/`branches_considered_json` (jsonb arrays) | `CandidateSet.{universe_evaluated,branches_considered}` | list | n/a | never null (empty array if none) | MATCH | none |
| Quote observation | `market.execution_quote_observation.*` | `ExecutionEvidence` dataclass, 1:1 field mirror | USD/share for bid/ask, integer/decimal for sizes | `provider_timestamp <= observed_at`, `ingestion_timestamp >= observed_at`, both DB-CHECK-enforced | bid/ask nullable = no quote captured | MATCH | Crossed-BBO (`bid > ask`) is a DB CHECK constraint in Production and re-verified in the research loader |
| Outcome label subject | `research.theta_outcome_label.subject_type` CHECK(CANDIDATE/MANAGED_EPISODE/WHOLE_CHAIN/EXECUTION) | `EconomicEpisode.subject_type` (`SubjectType`) | enum | n/a | never null | MATCH | none |
| Censoring | `research.theta_outcome_label.censoring_state` CHECK(RESOLVED/RIGHT_CENSORED/INVALIDATED) | `EconomicEpisode.censoring_state` (`CensoringState`) | enum | n/a | never null | MATCH | R6G's `resolved: bool` REPLACED -- a boolean cannot represent RIGHT_CENSORED distinctly from INVALIDATED |
| Whole-chain/managed-episode economics | `whole_chain_net_pnl`/`managed_episode_pnl`/`return_on_secured_capital`/`return_per_capital_day`/`max_adverse_excursion`/`max_favorable_excursion`/`recovery_duration_days`/`realized_execution_cost` (numeric, nullable) | Same field names (snake_case, identical semantics) on `EconomicEpisode` | USD / dimensionless ratio / days | `label_available_at` marks when the label became knowable | `NULL` = genuinely unresolved/unknown, never coerced to 0 | MATCH | `max_favorable_excursion` was ADDED to `research_targets.py`'s `RiskTarget` this phase -- a real Production column R6G's target list had missed |
| Lifecycle-specific outcomes (assignment/recovery-success/call-away/capital-lock) | folded into `outcomes_json` (generic jsonb object), NOT dedicated columns | `EconomicEpisode.outcomes` (`Dict[str,Any]`) | opaque | n/a | `{}` = nothing recorded | MATCH (via the same generic container) | R6G's dataclass had wrongly modeled these as dedicated typed fields; corrected this phase to match the real generic `outcomes_json` shape |
| Global WAIT evidence | `trade.global_wait_evidence.*` | `GlobalWaitEvidence` dataclass, 1:1 field mirror | mixed | `decision_time` | `earned` boolean, `validation_violations_json` empty array = fully earned | MATCH | Directly supersedes R6D/R6E's own research-only `GlobalWaitEvidence`/`validate_global_wait_evidence` in `management_policy.py` for any REAL data use -- that module remains for synthetic-fixture research only, per its own `management_policy.py` REJECT status in the Codex gap audit |
| Shadow opportunity | `trade.shadow_opportunity.*` (per export SELECT list) | `ShadowCandidate` dataclass, 1:1 field mirror | mixed | `observed_at` | most fields nullable pre-resolution | MATCH | none |
| Management snapshot + action frontier | `trade.management_input_snapshot` LEFT JOIN `trade.management_action_frontier` (per export's own join) | `ManagementSnapshot` (actions embedded) | mixed | `observed_at` | `actions=()` if the frontier was never computed for this snapshot | MATCH | R6G's separate `ManagementActionSet` type folded IN, matching Production's own pre-joined export shape |
| Lifecycle event | `trade.lifecycle_application.*` | `LifecycleEvent` dataclass, 1:1 field mirror | mixed | `applied_at` | `provider_activity_ref_hash` nullable = no broker activity reference | MATCH | `event_kind` kept as a free string on both sides -- Production's own storage layer does not constrain it to a fixed enum either |
| Dataset export identity | `datasetExportVersion = "theta-r6-dataset-v1"` (TS constant) | `DATASET_SCHEMA_VERSION` (Python constant, `production_export_loader.py`) | string | n/a | n/a | MATCH | Loader rejects any other value outright |
| Dataset hash | `sha256(canonicalJson(unsigned))` (TS) | `sha256_hex(canonical_json(unsigned))` (Python, same algorithm) | hex string | n/a | never null | MATCH, WITH A CAVEAT | Cross-language float-formatting differences could produce a spurious mismatch on a REAL export before either side has actually diverged -- documented explicitly in `production_export_loader.py`'s own docstring, not glossed over |

## Genuinely new fields found this phase (not in R6G's dataset contract at all)

`rank_at_decision`, `decision_id` (nullable -- a candidate can exist without
a decision, e.g. it was generated but the cycle resulted in WAIT),
`fusion_snapshot_id`, `chain_id` (on `ManagementSnapshot`/`LifecycleEvent`),
`change_json`/`unknown_fields_json` (on `management_input_snapshot`),
`evidence_key` (on `lifecycle_application`), `feed` (on quote
observations), `operation_alias` (Optionomics/Alpaca operation identity, per
the R6F spec's own provider operation map). All now present in the rewritten
`dataset_contracts.py`.

## `REQUIRED_CODEX_CONTRACT_CHANGE` items

**None found.** Every field Claude's research contracts needed already
exists in Production's real schema, under Production's own chosen name and
semantics. No mismatch required a Codex-side change this phase.
