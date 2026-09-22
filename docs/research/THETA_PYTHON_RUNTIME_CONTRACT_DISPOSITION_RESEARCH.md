# THETA Python runtime contract disposition research (Wave 7 Batch 2)

Deep-traces the intended architecture of the 5 `bots/theta/quant/runtime/*.py`
contracts the method census (`THETA_METHOD_USAGE_CENSUS.md`) found unwired
from the TS Python bridge, rather than calling all five defects.

## Method

Each script's own docstring names the real TS-side consumer it was built
to satisfy (all 5 were self-documented, real evidence, not inferred). For
each named TS consumer, traced its real importers with the same
static-import method the method census used, to determine whether that
TS consumer is itself `PRODUCTION_REACHABLE` or part of the already-known
QUARANTINED "Pipeline B" cluster from prior waves.

## Finding: 4 of 5 trace to the same already-QUARANTINED TS cluster

| Script | Docstring-named TS consumer | TS consumer's real importers |
|---|---|---|
| `assignment_contract.py` | `assignment-assembly.ts` | `assignment-orchestrator.ts` only |
| `covered_call_contract.py` | (opening decision) reused via `management_contract.py` for ongoing management | `covered-call-management-orchestrator.ts` only |
| `management_contract.py` | `src/theta/management-contract.ts` + `management-assembly.ts` | `management-orchestrator.ts`, `management-cycle.ts` |
| `recovery_contract.py` | `recovery-orchestrator.ts` (via `recovery-contract.ts`) | `management-cycle.ts` |

Tracing one level further: `assignment-orchestrator.ts`,
`covered-call-management-orchestrator.ts`, `management-orchestrator.ts`,
`management-cycle.ts`, and `recovery-orchestrator.ts` are **only
imported by each other and by `src/theta/autonomous-runtime-handler.ts`**
-- and `autonomous-runtime-handler.ts` is itself not on the real worker
entry's (`src/worker/index.ts`) static import path (confirmed by the
method census's BFS, and re-confirmed directly here). This is the exact
same "Pipeline B" cluster prior waves already established as
`QUARANTINED` by name for its TS half
(`management_action_value.py`/`management-cycle.ts`/
`covered-call-management-orchestrator.ts`/`management-orchestrator.ts`,
per this engagement's own prior finding, `PIPELINE_B_AS_PRODUCTION_AUTHORITY = REJECTED`
in `docs/operations/THETA_RESOLVED_AND_ACTIVE_WORK.md`). These 4 Python
contracts are simply the Python-side JSON boundary for that same
already-rejected pipeline -- their unwired state is **consistent with**,
not contradictory to, the existing quarantine, and confirms it
independently from the Python side.

**None of these 4 are recommended for `REQUIRED_PRODUCTION_WIRE`.** Wiring
any of them into the bridge allowlist would be reviving Pipeline B by a
side door -- exactly what this batch was told to guard against.

### `assignment_contract.py` -- additional note

Main `b9cd49a` ("Wire broker-backed management assignment capacity and
PIT timing," merged this pass) independently solved the real assignment-
capacity gap by computing `assignmentCapacity`/`assignmentCapacityEvidence`
**directly in `management-input-state.ts`** -- a simpler, TS-native
mechanism that does not go through `assignment_contract.py` or
`assignment-assembly.ts` at all. This makes `assignment_contract.py`'s
real TS integration path even less likely to ever be needed, not more:
Codex already built and shipped a working alternative.

**Disposition: `SUPERSEDED_BY_TS_AUTHORITY`** (Codex's `b9cd49a` fix is
the real, live authority for this concept now).

### `covered_call_contract.py`, `management_contract.py`, `recovery_contract.py`

Each wraps an already-tested, real, pure Python model
(`models.covered_call_ranker`, `models.management_action_value`,
`models.recovery_decision` respectively) that is NOT itself defective --
the docstrings show real, careful design (e.g. `covered_call_contract.py`
explicitly defaults to WAIT rather than selling merely because shares
exist; `recovery_contract.py` honestly reports `partialSellStock: {modeled:
false}` rather than fabricating a formula that doesn't exist). The
models are reusable, real, pure computation -- the problem is entirely on
the TS integration side (the QUARANTINED orchestrator cluster), not in
these Python contracts or the models they wrap.

**Disposition: `QUARANTINED`** (matches the TS side's existing
classification -- these Python contracts belong only to the
already-rejected Pipeline B architecture). If a real management-candidate
integration is ever built (the P0-1 gap this engagement has tracked
since early waves -- `paper-bootstrap-management-policy.ts` has zero real
roll/CC candidate injection), it should be evaluated on its own merits
against the REAL, live `paper-bootstrap-management-policy.ts` /
`management-action-frontier.ts` path, not by reviving these orchestrators.
The underlying **models** (`covered_call_ranker`, `management_action_value`,
`recovery_decision`) may still be legitimately reusable pure computation
for that real path -- that is a real, open question for whoever builds
the real management-candidate source, not resolved here.

## `har_rv_contract.py` -- the one genuinely different case

Self-documented in its own docstring: **"Research/shadow only -- this
contract has no live Production caller and confers no broker authority."**
It wraps `bots/theta/quant/features/realized_volatility.py`'s HAR-RV
(Corsi, 2009) forecaster, built explicitly to avoid reimplementing that
fit in TypeScript (per the repo's own `MODEL-001` "no duplicate model"
rule). Its docstring's leakage-safety description (features strictly
at-or-before index i, target only the single next value) is real,
specific, and matches the discipline this engagement has verified
elsewhere.

Checking for a legitimate research/feature consumer: `HAR_RV_CONTRACT` is
already a real row in `pre-vps-capability-registry.ts` (pre-existing,
not added this pass), and `src/theta/har-rv-contract.ts` is the TS-side
wrapper -- per the method census, this file is `RESEARCH_OR_SHADOW_REACHABLE`
(has a real, non-test TS importer, just not on the worker's static path),
consistent with its own self-declared research/shadow status.

**Disposition: `RESEARCH_ONLY`** (confirmed, matches its own explicit
self-declaration -- no change needed, no Codex action required).

## Summary

```
assignment_contract.py    -> SUPERSEDED_BY_TS_AUTHORITY (main b9cd49a)
covered_call_contract.py  -> QUARANTINED (Pipeline B)
management_contract.py    -> QUARANTINED (Pipeline B)
recovery_contract.py      -> QUARANTINED (Pipeline B)
har_rv_contract.py        -> RESEARCH_ONLY (self-declared, confirmed)
```

**No Codex handoff required for any of the 5.** This closes the "classify,
don't just call them defects" instruction: none are Production-required
DEAD code and none should be wired as-is. The one real open question this
research surfaces (whether `covered_call_ranker`/`management_action_value`/
`recovery_decision`'s pure model logic is reusable by a FUTURE real
management-candidate source, distinct from reviving their current
orchestrator wrappers) is recorded here for whoever eventually builds
that real path, not actioned by this pass.
