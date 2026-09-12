# R6H Dataset Integrity Standard

The scientific intake gate a Production dataset export must pass before any
research code may touch it. Every check below is implemented as real code
in `bots/theta/quant/research/production_export_loader.py` and tested in
`bots/theta/tests/quant/test_production_export_loader.py` -- nothing here
is aspirational.

## 1. Schema-version check

`load_dataset_export` rejects any `schemaVersion` other than
`DATASET_SCHEMA_VERSION = "theta-r6-dataset-v1"` (mirroring `point-in-time-
evidence.ts`'s `datasetExportVersion`) with `SCHEMA_VERSION_MISMATCH`. No
best-effort parsing of an unrecognized schema is ever attempted.

## 2. Dataset-hash check

The loader recomputes the same canonical-JSON + SHA-256 hash Production's
own `buildDatasetExport` computes and compares it to the declared
`datasetHash`. A mismatch raises `DATASET_HASH_MISMATCH`. Known limitation
(documented in the loader's own docstring): cross-language JSON number
formatting can differ; a real mismatch must be triaged for that
possibility, not assumed to be corruption on sight.

## 3. Deterministic ordering check

Production's own export sorts every row group by canonical JSON
(`byCanonical`, per `point-in-time-evidence.ts`). The loader verifies
candidate/candidate-set rows are already in that order and raises
`NON_DETERMINISTIC_ORDERING` if not -- this catches a broken export
pipeline (e.g. an unsorted intermediate step) independent of the hash
check.

## 4. Duplicate identity check

`candidate_id`, `candidate_set_id`, `quote_observation_id`, and
`outcome_label_id` must each be unique across their own row group.
`DUPLICATE_IDENTITY:<label>:<id>` on violation.

## 5. Required lineage validation

Every `Candidate` carries `StrategyLineage` (strategy/risk/feature/cost-
model/regime/execution-model versions) -- all six fields required, no
default. Every `ProviderProvenance` entry's `provider_timestamp <= as_of`
and `ingestion_timestamp >= as_of` invariant is re-verified (not just
trusted), raising `PROVIDER_TIMESTAMP_AFTER_AS_OF` /
`INGESTION_TIMESTAMP_BEFORE_AS_OF` on violation. The same PIT-order check
applies to `ExecutionEvidence`'s `observed_at`/`provider_timestamp`/
`ingestion_timestamp` triple.

## 6. Enum normalization

Every enum-typed field (`branch`, `hard_status`, `soft_status`,
`completeness_state`, `data_quality`, `observation_role`, `censoring_
state`, `subject_type`) is parsed through the matching Python `Enum`
constructor. An unrecognized value raises `ValueError` (a Python
`ValueError`, not a silently-substituted default) -- there is no `.get(x,
DEFAULT)` fallback anywhere in the loader.

## 7. Unit validation

Crossed BBO (`bid > ask`) is rejected (`CROSSED_BBO_INVALID`), mirroring
the DB-level CHECK constraint in `market.execution_quote_observation`.
Beyond that, this loader does not attempt currency/percentage/annualization
unit CONVERSION at all -- per the directive's own instruction ("unit
mismatch should be a HARD_DATA_FAILURE, not auto-converted unless
conversion provenance is explicit"), a genuine unit ambiguity is a reason
to reject the row, never silently normalize it.

## 8. UNKNOWN preservation

Every Optional field in `dataset_contracts.py` stays `None` when the raw
export has it null -- the loader never substitutes `0.0`, `False`, or an
empty string for a genuinely missing value anywhere in its `_load_*`
functions.

## 9. Feature/label firewall (recursive)

`assert_no_future_labels` walks every feature-family JSON blob
RECURSIVELY (arrays and nested objects, not just top-level keys),
normalizing each key (strip non-alphanumerics, lowercase) before checking
it against `_FORBIDDEN_FEATURE_KEYS` -- the union of `point-in-time-
evidence.ts`'s own forbidden-key set and the R6H directive's own explicit
additions (`realized_pnl`, `future_pnl`, `outcome`, `result`,
`assigned_after`, `recovered_after`, `future_fill`, `future_quote`,
`future_return`). A hit anywhere raises
`FUTURE_LABEL_IN_FEATURE_PAYLOAD:<path>`.

## 10. Candidate-set referential integrity

Every non-null `best_candidate_id`/`second_best_candidate_id`/`best_
rejected_candidate_id` on a `CandidateSet` must reference a candidate_id
actually present in the export's own `candidates` row group --
`CANDIDATE_SET_REFERENCES_UNKNOWN_CANDIDATE` otherwise. A partial scan
(`completeness_state != COMPLETE`) is preserved as data, never silently
treated as if it were complete by any downstream experiment (enforced at
the `dataset_readiness.py` layer, which requires the caller to account for
completeness explicitly rather than the loader hiding it).
