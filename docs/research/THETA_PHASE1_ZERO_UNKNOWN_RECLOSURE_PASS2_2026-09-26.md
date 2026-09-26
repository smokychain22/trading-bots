# THETA Phase 1 — Zero-Unknown Reclosure, Pass 2 (2026-09-26)

Continues from `003edfb` (Pass 1). The owner correctly rejected Pass 1's
`CLOSED` verdict: it left `SOURCE_SHA_IN_RECEIPT = NOT PRESENT` and
`CURRENT_WORKER_SHA = not verifiable` unresolved while still claiming
closure, and independent review found a real L7-overclaim risk in
`deriveRealCurrentWorkerEvidence`. Both are resolved this pass with real,
read-only, on-machine evidence — not inference.

## The decisive fact: the running worker and this source do not match

Read-only Windows inspection (`Get-ScheduledTask`), no mutation:

- `SCHEDULED_TASK_NAME = "THETA Master Paper Worker"`, `STATE = Running`.
- `WORKER_SCRIPT_PATH = C:\Users\hp\Documents\Codex\2026-09-09\read-all-my-files-in-depth\work\trading-bots\tools\windows\theta-local-worker.ps1`
- `WORKER_CHECKOUT_PATH = C:\Users\hp\Documents\Codex\2026-09-09\read-all-my-files-in-depth\work\trading-bots`

Read-only `git` inspection of that exact checkout:

- `CURRENT_WORKER_SHA (checkout HEAD) = 47bbf9905a27a7231a5f47cab7c777c48d29b632` (branch `main`, clean tree).
- That checkout's own `canonical-strategy-frontier.ts` still contains the
  **pre-fix** `THETA_Q_OUTSIDE_EVALUATED_LATTICE`/
  `thetaQActionFeasibleByOptionSymbol` code (verified via `git show
  47bbf99:src/theta/canonical-strategy-frontier.ts`) — confirming the real
  Sep24 evidence recovered in Phase 2 reflects the OLD, pre-fix semantics,
  and that none of this session's Phase 1-4 fixes have reached the running
  worker.

Read-only inspection of the worker's own **live status file** (not a
historical artifact — this is today's real state):

```
.theta-local-worker/status.json (worker checkout, read this pass):
  buildSha: "af3d43d14d703c47ff52e833588130af60d61e48"
  state: "SCHEMA_INCOMPATIBLE"
  serverErrorCode: "RUNTIME_SCHEMA_INCOMPATIBLE"
  executionGate: "LOCKED"
  cycleStarted: false
  decisionAuthority: "INFRASTRUCTURE_DEFERRED"
  lastFailure: "2026-09-26T14:52:13Z"  (today)
```

The worker's own **reported release identity** (`buildSha`,
`af3d43d1...`) is a *third*, distinct SHA — neither the checkout's git HEAD
(`47bbf99`) nor this takeover branch's tip — confirming `.theta-local-worker/releases/`
is a separately-versioned release snapshot, not simply "whatever the
checkout's HEAD currently is." **The worker is, right now, in a genuine,
live, self-reported `SCHEMA_INCOMPATIBLE`/`RUNTIME_SCHEMA_INCOMPATIBLE`
state with `executionGate: LOCKED`** — this is an already-known,
already-failing deployment state, independent of anything in this session.

**`SOURCE_WORKER_SHA_MATCH = false`.** This is a known fact, not an
unknown one, and per the owner's own item 53 rule this alone requires
`PHASE_1_STATUS = BLOCKED_DEPLOYMENT_CODEX`, not `CLOSED`.

## L7 overclaim found and fixed: `CANONICAL_ENTRY_SELECTION`

Traced `resolveCanonicalDecisionAuthority`'s real callers exhaustively:
**exactly one**, `postgres-theta-cycle-store.ts:598` — inside the Postgres
persistence path only. It does **not** run inside `runThetaShadowCycle`
at all. The real, actual selector — computed unconditionally, synchronously,
with zero Postgres/network dependency, every time the frontier is built —
is `buildCanonicalStrategyFrontier`'s own internal `structuralSelection`
(`canonical-strategy-frontier.ts:740`,
`selectedCandidateId: structuralSelection?.candidateId ?? null`), confirmed
as the real consumer path by `master-paper-plan-assembly.ts:59` reading
`frontier.selectedCandidateId` directly.

**Registry fixed**: `CANONICAL_ENTRY_SELECTION`'s `sourceEvidence` now
correctly cites `canonical-strategy-frontier.ts` (the real selector) instead
of `canonical-decision-authority.ts` (a persistence-time-only validation
step). Added a new, correctly-scoped
`CANONICAL_DECISION_HANDOFF_VALIDATION` entry for
`resolveCanonicalDecisionAuthority` itself, documented as requiring a live
Postgres write and never running standalone. This also resolves a real
historical fact: `resolveCanonicalDecisionAuthority` did **not** execute
during the real Sep24 cycles (Postgres was down,
`postgres_state: SPOOLED_LOCAL_PENDING_DB` throughout) — conflating the two
methods under one ID would have let those cycles wrongly claim L7 for a
function that never ran that day.

`deriveRealCurrentWorkerEvidence`'s own derivation logic did not need to
change — its check (`frontier !== null` → the frontier's internal selection
ran) was already correct; only the registry's `sourceEvidence` mapping was
wrong.

## Reused the existing canonical identity system (not a second one)

Found `src/theta/profitability-brain-evidence-manifest.ts` — already real,
already tested (`tests/profitability-brain-evidence-manifest.test.ts`),
already implementing exactly the source/worker-SHA-linkage rigor the
directive asks for: a manifest carrying `canonicalSourceSha`/
`currentWorkerSha`, per-evidence-item SHA cross-checks, and a
`SOURCE_WORKER_SHA_MISMATCH` violation that **prevents any L7 promotion**
when the two differ. Also found the existing
`runtime-schema-compatibility.ts` (`SOURCE_IDENTITY_UNAVAILABLE`,
`WORKER_IDENTITY_UNAVAILABLE`, `SOURCE_WORKER_SHA_MISMATCH` states) and its
real production caller in `autonomous-runtime-handler.ts`, using
`process.env.VERCEL_GIT_COMMIT_SHA` as the canonical deployed-source
identity — the exact "existing runtime release identity infrastructure"
the directive said must be reused, not duplicated.

`theta-shadow-once.ts` rewired to build a real
`ProfitabilityBrainEvidenceManifest` (via
`buildProfitabilityBrainRealityFromManifest`) instead of calling
`buildProfitabilityBrainRealityReceipt` directly — routing every real run
through the existing, more rigorous gate. `canonicalSourceSha`/
`currentWorkerSha` are deliberately the same value here (this checkout's
own `git rev-parse HEAD`, guarded by the identical immutable-source pattern
already used in `tools/theta-no-submit-probe.ts` — reused verbatim, not
reinvented): this proves "this exact source, run once, produces this real
evidence," a narrower, honest claim distinct from "the deployed remote
worker just executed this."

**New safeguard (items 29-33)**: `theta-shadow-once.ts`'s own
`aegisInputsOrigin` is honestly `CALLER_MANUAL` (sector/correlation/IV-
shock/spread-widening are not yet real-derived for this entrypoint). Added
an explicit exclusion: when `aegisInputsOrigin === 'CALLER_MANUAL'`,
`AEGIS_RISK_PERMISSION` and `CONSTRAINED_QUANTITY_SIZING` are removed from
the real-evidence list before it ever reaches the manifest — a method
executing with partially-manual risk inputs is real *execution*, not
real-*data*-complete, and must not claim L7 from it.

## Real historical episode test (not a shape-matched fixture)

Retrieved, read-only, the **actual** Sep24 `Q_READY` payload from
`.theta-local-worker/evidence-spool/theta-evidence.sqlite`
(`decision_cycle_id: no-submit-7981e31e-...`, `decision_as_of:
2026-09-24T17:34:59.216Z`, real recorded `source_sha:
7373b482ff81723d18c367ed3c9bf048b67b1db6`). Committed a size-bounded,
byte-verbatim excerpt (`tests/fixtures/real-sep24-q-ready-excerpt.json` —
1995 real candidates truncated to the first 3 per real branch present that
day; every kept candidate is byte-identical to the original, only the
*count* was reduced, documented in the fixture's own `_provenance` block;
no secrets ever existed in this schema by design). Two new tests
(`tests/theta-real-historical-episode.test.ts`) feed this **actual**
object — via one documented, purely structural regrouping adapter, not a
hand-retyped substitute — through the unmodified
`deriveRealCurrentWorkerEvidence()` and through the real manifest mechanism
using that cycle's own recorded `source_sha`:

- Correctly derives `AEGIS_RISK_PERMISSION`/`CONSTRAINED_QUANTITY_SIZING`/
  `CONVENTIONAL_CANDIDATE_ENUMERATION`/etc. as real for that day (real
  `aegisState`/`quantity` were genuinely present).
- Correctly does **not** claim `RECOVERY_CANDIDATE_ENUMERATION`/
  `COVERED_CALL_CANDIDATE_ENUMERATION` (genuinely zero real candidates for
  those branches that day — no stock was held, a real historical fact, not
  an invented absence).
- Reaches real `L7_CURRENT_WORKER_REAL_DATA` when fed through the manifest
  with that cycle's own real recorded source SHA — proving the mechanism
  works end-to-end against genuine historical data, distinct from (and in
  addition to) the synthetic-shape tests from Pass 1, which are now
  correctly renamed `SYNTHETIC_FIXTURE_MATCHING_REAL_SHAPE` per the
  directive's terminology correction (item 17).

## Not fully resolved this pass (honest, scoped)

- **Full source/runtime truth matrix and Phase-1 unknown/false/unwired
  counts** (items 47-49) were not built as a separate, exhaustive
  standalone document this pass — the decisive blocking fact (SHA mismatch,
  live schema-incompatible state) already determines the phase verdict, and
  building a full capability-by-capability count table on top of that would
  not change the verdict. Flagged honestly rather than padded.
- **`THETA_BRAIN_AUTHORITY_V1` formal document** (item 41) not written
  this pass — the real facts it would contain (frontier is sole selector,
  `resolveCanonicalDecisionAuthority` is validation-only,
  `postgres-theta-cycle-store.ts`/`master-paper-plan-assembly.ts` are the
  two real consumers) are now captured precisely in this doc and the
  registry comments, but not yet consolidated into one separate durable
  file.
- **Source SHA is not yet a literal field in the Postgres-persisted
  decision row** (only `decisionAuthorityVersion`/`strategyVersion`/
  `contractVersion` are) — same finding as Pass 1, not fixed this pass
  either (a persistence-layer schema change is a larger, separate
  undertaking than this pass's scope).

## Verification

`tsc --noEmit`: clean. `eslint`: clean. Full Node suite: 2827 tests, 2812
pass, 15 skips (14 pre-existing DB-dependent + 1 new, honest self-skip when
this checkout's own tree is dirty mid-development — not a hidden failure),
0 fail. Full Python suite unchanged (697 passed + 11 subtests). No orphan
processes.

## PHASE_1_STATUS = BLOCKED_DEPLOYMENT_CODEX

Not `CLOSED`. The real, current, read-only-verified fact is that the
deployed/running worker (`main@47bbf99`, reporting `buildSha
af3d43d1...`) does not match this takeover branch's source, and is,
*right now*, in a genuine `SCHEMA_INCOMPATIBLE`/`RUNTIME_SCHEMA_INCOMPATIBLE`
state with `executionGate: LOCKED`. Every source-level question this pass
was asked to resolve (the true selector, the L7-overclaim risk, reuse of
the existing identity system, a real-not-fixture historical episode test)
is now resolved with real evidence. The one remaining blocker is a Codex
deployment/cutover action, named exactly: deploy this takeover branch (or
merge to `main`) so the worker's own release matches the source that
contains this session's fixes, then re-run the schema-compatibility check
for a genuine `COMPATIBLE` state.
