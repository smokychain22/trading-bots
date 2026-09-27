# THETA Phase 6 — Real Experiment Run Receipt (WP87)

**Branch:** `claude/theta-overnight-quant` · **Dataset provenance:** the full
deduplicated real historical archive under
`C:\ProjectBackups\trading-bots\daily\...\external-assets\research_exports\`,
converted via `research/historical_v1_to_v6_bridge.py` and deduplicated via
`research/historical_export_dedupe.py` (this pass, WP67-era measurement).

## What was actually run

Every real, unique (deduplicated) export snapshot in the archive (109 of
666 raw directories) was converted and its rows unioned by real row
identity (`candidateId`/`candidateSetId`/`quoteObservationId`), per
`historical_coverage_report.py`'s own contract. The full `benchmark_runner.py`
classification (WP59, complete) was run with the real, probed capability
evidence below — not assumed, not guessed.

## Unique N (deduplicated, not raw sums)

| Metric | Value |
| --- | --- |
| Raw export directories found | 666 |
| Unique export snapshots (by manifest content) | 109 |
| Date range | 2026-09-14 13:30:34 UTC – 2026-09-15 15:46:13 UTC |
| Unique candidate sets (decisions) | 302 |
| Unique candidates | 7550 |
| Unique execution-evidence (quote) rows | 8731 |
| Selected candidates | 0 |
| Management snapshots / lifecycle outcomes / whole-chain outcomes | 0 / 0 / 0 |
| Unique underlyings | 13 |

## Schema provenance

Every unique snapshot declares `schemaVersion: "theta-r6-dataset-v1"` in
its manifest, but internal row-family shape drifted across the archive
(106 snapshots have the base 8-family shape; 1 additionally has
`optionChainDecisions`; 1 additionally has the v4-era outcome families; 1
additionally has the full v6-era family set) — the `schemaVersion` string
itself was never re-stamped as the underlying export code evolved. See
`historical_v1_to_v6_bridge.py`'s module docstring for the full,
git-history-proven v1→v6 lineage this reconciles against.

**`source_hash_verified` is `False` for every one of the 109 unique
snapshots** — attempted, not assumed. Recomputing the documented
`buildDatasetExport()` hash formula (from both the v1-era and v6-era
TypeScript source) against the real archived `dataset.json` content does
not reproduce the declared `datasetHash` for any file tested. This is
reported as an unresolved discrepancy (`BLOCKED_CODEX`), not silently
patched around.

## Config / cost / split / censoring / metrics / uncertainty / OOS

**No model was fit and no split was built.** Every candidate in this
archive has `hardStatus=DATA_INSUFFICIENT`, `softStatus=REJECTED`,
`rejectionReason=CONTRACT_NOT_EXECUTABLE` — uniformly, 100%, zero
variance — because the universal soft-evidence blockers
(`OWNERSHIP_ACCEPTABILITY_UNKNOWN`, `EXECUTION_QUOTE_REQUIRED` i.e. no
real OPRA BBO, `AEGIS_STATE_UNKNOWN`, `EVENT_STATE_UNKNOWN`,
`OPEN_INTEREST_UNKNOWN`) are present on every single candidate. This
archive is a candidate-SCAN/reconnaissance capture, not an executable
population: 0 candidates were ever selectable, so there is no resolved
entry, no management action, no whole-chain outcome anywhere to build a
dataset, split, or fit a baseline from.

- **Purged walk-forward / OOS manifest**: not run — zero rows to split.
- **Calibration / DSR / PBO**: not run — zero labeled outcomes.
- **`entry_episode_training.py` (WP47)**: would report
  `NO_ELIGIBLE_RESOLVED_ENTRIES` if run against this archive (0 selected
  candidates, 0 entry-chain links, 0 whole-chain outcomes to join).

**No target-WR tuning occurred** — there is nothing to tune; this is
reported as the honest, negative empirical result, not adjusted, not
retried against a friendlier cohort, and not omitted.

## Benchmark classification against this real archive (WP59, complete)

Real, probed capability evidence used:
`has_feasible_candidates=False` (0/7550 `hardStatus=FEASIBLE`),
`has_price_paths=False` (0 management/lifecycle/whole-chain rows anywhere),
`has_lifecycle_events=False` (0 lifecycle outcomes anywhere),
`has_delta_field=False` (no `delta` field found on any candidate's
`contract`/`volatility` blob in this archive).

| State | Benchmark IDs |
| --- | --- |
| `RUNNER_IMPLEMENTED_DATA_AVAILABLE` | `B0` |
| `RUNNER_IMPLEMENTED_DATA_UNAVAILABLE` | `B3, B4, B5, B6, BQ-1, BQ-2, BQ-3, BR-1, BR-2, BA-1, BA-2, BA-3, BC-1, BC-2` |
| `BLOCKED_MISSING_POLICY` | `B1, B2, BH-1` |
| `NOT_APPLICABLE` | `A1, A2, A3, A4, A5, A6` |

## WP25 / WP26 status against this real data (restated from the ledger)

`WP25_STATUS = POPULATION_DATA_AVAILABLE_ZERO_OUTCOME_VARIANCE` — the
population exists and its rejection-reason distribution is real and
analyzable (100% `CONTRACT_NOT_EXECUTABLE`), but there is no selected/
rejected outcome contrast to measure filter sensitivity against.
`WP26_STATUS = BLOCKED_DATA` — feature ablation needs a resolved outcome
label; none exists in this archive.

## Conclusion

This is the maximum honest campaign obtainable from the currently
recoverable real historical data: a full, deduplicated, schema-bridged
population census with zero empirical outcomes to model. Every number
above is real and reproducible from the archive at the path stated; none
is synthetic, assumed, or backfilled to look more complete than it is.
