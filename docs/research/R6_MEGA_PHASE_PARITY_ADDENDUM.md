# R6 Mega-Phase Parity Addendum

Inspected `db0f17a..origin/main` (through `38f1f6e`) for research-contract-
relevant diffs only, per the pace rule -- not a full re-read of migration
018 or the already-ported R6G/R6H work (Codex's own
`docs/research/THETA_R6G_PRODUCTION_PARITY.md` already records that both
were PORTED/approved).

## Migration 019 (`019_real_shadow_evidence_activation.sql`)

Two NEW tables, both additive-only (no change to any column my existing
`dataset_contracts.py`/`production_export_loader.py` already consume):
`research.theta_shadow_scan_run` (cross-symbol scan completeness/
membership metadata) and `research.theta_execution_observation_job`
(+1m/+5m/+30m/EOD deterministic quote-observation scheduling).

**PARITY_STILL_VALID** for every existing field/enum/hash convention this
branch already models. No `dataset_contracts.py`/`production_export_
loader.py`/`dataset_readiness.py` rewrite performed -- per the explicit
"do not rebuild" pace rule.

**Deferred, non-blocking:** dedicated Python dataclasses for `theta_
shadow_scan_run`/`theta_execution_observation_job` were NOT added this
phase -- they are not yet part of `postgres-dataset-export.ts`'s own
SELECT list (confirmed by re-reading that file's diff -- unchanged), so a
real dataset export does not carry them yet. Adding Python types for
tables the export itself doesn't surface would be speculative, not
schema-parity work.

## Firewall parity: Codex extended `forbiddenFeatureKeys`

`point-in-time-evidence.ts`'s diff added five bare terms: `outcome`,
`future`, `result`, `realizedreturn`, `pnl` (two of which -- `outcome`/
`result` -- this branch's R6H firewall already had). The three new bare
terms (`future`, `pnl`, `realizedreturn`) are now unioned into
`production_export_loader.py`'s `_FORBIDDEN_FEATURE_KEYS` for continued
parity. All 14 loader tests still pass unchanged.

## Real dataset status (confirmed from `docs/HANDOFF.md`'s own 2026-09-12
## R6H entry, Codex's own words)

> "Neon reports one complete SHADOW context, zero broker orders, and zero
> broker fills." "Point-in-time rows, shadow candidates, subsequent BBO
> observations, and resolved labels remain empty." "The market is closed
> and no genuine decision-time candidate scan has run."

**`DATASET_ABSENT`.** No export exists to load. This is the exact
condition the R6 mega-phase directive names as the trigger to fast-forward
into R3/R4/R5 quant responsibilities rather than wait idle -- see this
session's R3/R4/R5 deliverables below.

## Closure-run re-check: `38f1f6e..103725f` (migration 020 + local worker)

Inspected only research-contract-relevant paths. Two commits, both
additive and non-semantic for research contracts:

1. **Migration 020 (`020_local_worker_runtime.sql`)** creates
   `ops.runtime_worker_status` and `ops.runtime_worker_lease` -- worker
   lease/heartbeat/health tables in the `ops` schema, with zero overlap
   with any research evidence table (`trade.candidate_*`,
   `market.execution_quote_observation`, `research.theta_*`). No field
   this branch models changed. **PARITY_STILL_VALID.**

2. **`src/research/r6-readiness.ts`** gained `marketSessions`,
   `quoteObservations`, `invalidQuoteRate`, `providerFailureRate` and
   `observationMissedRate`. Notably, the first three are the SAME quality
   dimensions this session's `empirical_pipeline.py::DataQualityReport`
   computes independently (`sessions`, `execution_observations`,
   `invalid_quote_rate`) -- convergent, not conflicting. **PARITY_STILL_
   VALID.**

**OPTIONAL_CODEX_ENHANCEMENT (not required, nothing is wrong today):**
`providerFailureRate` and `observationMissedRate` derive from
`research.theta_shadow_scan_member` and
`research.theta_execution_observation_job`, neither of which appears in
`postgres-dataset-export.ts`'s own SELECT list. They are therefore
computable DB-side (where Codex already computes them) but NOT from a
dataset export. If an export-side audit should ever report those two
rates, the export would need to carry those two tables. This is a
coverage preference, not a mathematical defect -- recorded here rather
than raised as a `REQUIRED_CODEX_CHANGE`.

**`REQUIRED_CODEX_CHANGE` count for this closure run: 0.**
