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
