# THETA Codex Deployment Handoff (2026-09-26)

Phase 1 Zero-Unknown Reclosure Pass 3, items 22-26. This is documentation
only -- nothing in this file was executed by Claude. No deploy, no Aiven
mutation, no worker restart. Claude's unified-ownership authorization for
this engagement explicitly excludes broker mutation and Production
deployment; this handoff exists precisely so Codex (or the repository
owner) can execute the cutover with zero new instrumentation required.

## Identity

- **TARGET_SHA** (this takeover branch's tip, to be deployed): re-run
  `git rev-parse HEAD` on `claude/theta-unified-takeover` immediately
  before cutover -- this document itself is committed after being written,
  so any SHA written here is already one commit stale by construction
  (item 29's explicit no-self-referential-loop guidance). As of this
  regeneration the branch tip was `8d95f8a...` (docs commit); do not treat
  that as final without re-checking.
- **CURRENT_CHECKOUT_HEAD_SHA** (worker's raw git checkout, separate from
  what it executes): `47bbf9905a27a7231a5f47cab7c777c48d29b632`, branch
  `main`, clean tree, at
  `C:\Users\<user>\Documents\Codex\2026-09-09\read-all-my-files-in-depth\work\trading-bots`.
- **CURRENT_RUNNING_BUILD_SHA** (what the worker actually executes from,
  per its own `runtime.json`/`status.json`): `af3d43d14d703c47ff52e833588130af60d61e48`.
- **WHY THEY DIFFER**: intentional release-pinning. See
  `SOURCE_RUNTIME_TRUTH_MATRIX.md`'s "Why CHECKOUT_HEAD_SHA !=
  RUNNING_PROCESS_BUILD_SHA" section for the full evidenced writeup. In
  short: the worker script resolves and executes from
  `.theta-local-worker/releases/<buildSha>/`, a full snapshot checkout, not
  the live repo directory; the live checkout has since been pulled 15
  commits past the last release cut.

## Current schema/runtime state

- `CURRENT_SCHEMA_STATE`: **SCHEMA_INCOMPATIBLE** (`serverErrorCode:
  RUNTIME_SCHEMA_INCOMPATIBLE`, `executionGate: LOCKED`, per the worker's
  own live `status.json`, last failure `2026-09-26T14:52:13Z`). This is a
  genuine, current, self-reported production state, not inferred.
- `REQUIRED MIGRATION STATE`: none required by this entire Phase 1 Pass 3
  effort (initial pass + continuation). Item 2 (source/worker SHA
  persistence) was resolved with **zero new migrations** -- it reuses the
  existing `trade.decision.receipt_json` jsonb column additively. No
  `DEPLOYMENT_MIGRATION_REQUIRED_CODEX` classification is needed for
  anything in this pass. The new `T0_REPLAY_BUNDLE` payload type
  (`t0-replay-bundle.ts`) similarly reuses the existing
  `LocalEvidenceSpool` envelope mechanism -- no schema change there either.
- **FILES CHANGED ACROSS THIS ENTIRE PASS 3 EFFORT** (full diff is in git
  history on `claude/theta-unified-takeover` between `62ebd26` and the
  current tip; run `git log --oneline 62ebd26..HEAD` for the exact commit
  list): `src/theta/postgres-theta-cycle-store.ts`,
  `src/theta/autonomous-runtime.ts`, `src/theta/autonomous-runtime-handler.ts`,
  `src/research/production-shadow-runtime.ts`,
  `src/theta/release-identity.ts` (new -- the one release-identity resolver),
  `src/theta/profitability-brain-evidence-manifest.ts` (evidenceClass +
  evidenceWorkerSha rename), `src/theta/profitability-brain-reality.ts`
  (orthogonal `historicalRealData` dimension), `src/theta/profitability-
  method-input-provenance.ts` (new -- per-method input realness, now wired
  into `runThetaShadowCycle` itself, plus `filterToRealInputEvidence`, the
  one L7 promotion authority), `src/theta/theta-shadow-cycle.ts` (additive
  `routerPortfolioOrigin`/`canonicalFrontierInput`/`methodInputProvenance`
  fields), `src/theta/theta-shadow-once.ts` (old broad AEGIS-only L7
  exclusion removed), `src/theta/t0-replay-bundle.ts` (new -- T0 replay
  mechanism, now wired into both real no-submit paths),
  `src/theta/database-independent-shadow-observation.ts`,
  `src/theta/postgres-cycle-evidence-storage.ts`,
  `tools/theta-no-submit-probe.ts`, plus their corresponding test files
  (see `git log --stat` for the full list -- over a dozen new/updated test
  files, including `tests/t0-replay-bundle-writer-integration.test.ts`,
  `tests/theta-no-submit-probe-t0-replay-wiring.test.ts`,
  `tests/method-l7-realness-authority.test.ts`,
  `tests/theta-brain-authority-doc-consistency.test.ts`), and the docs
  (`THETA_BRAIN_AUTHORITY_V1.md`, `SOURCE_RUNTIME_TRUTH_MATRIX.md`,
  `THETA_T0_RECONSTRUCTION_LEDGER_2026-09-26.md`, this file).
- **CODEX_REQUIRED_ACTIONS = deployment only, zero source work remaining.**
  Every item this handoff previously named as a source TODO (T0 replay
  bundle wiring, per-method provenance reaching real worker evidence, L7
  requiring real inputs, the authority-doc contradiction) is now resolved
  in source, on this branch, with tests. Codex's job is exactly: deploy
  `TARGET_SHA`, materialize the pinned release, confirm schema
  compatibility, restart, run no-submit verification, and read back the
  receipts this source already knows how to produce. Codex must not need
  to invent an authority map, a source-identity model, a provenance model,
  or a replay bundle -- all four already exist in source.

## Pre-deploy validation commands (read-only, safe to run against the target checkout before cutover)

```
git -C <target-checkout> rev-parse HEAD           # must equal TARGET_SHA
git -C <target-checkout> diff --quiet HEAD --      # must exit 0 (clean)
npm --prefix <target-checkout> run build            # tsc -p tsconfig.json, must succeed
npm --prefix <target-checkout> test                 # must show 0 fail (DB-dependent skips expected without TEST_DATABASE_URL)
npx --prefix <target-checkout> tsx tools/theta-no-submit-probe.ts   # read-only, must not mutate the broker; confirms source-identity guard passes
```

## Deployment steps (Codex-owned; Claude does not execute these)

1. Confirm the Vercel Production deployment for
   `https://trading-bots-one.vercel.app` is built from `TARGET_SHA` (via
   `VERCEL_GIT_COMMIT_SHA` in the deployed environment matching exactly).
2. Materialize a new `.theta-local-worker/releases/<TARGET_SHA>/` snapshot
   in the worker's checkout (matching the existing pattern of the ~34
   prior release directories), and update `.theta-local-worker/runtime.json`'s
   `releasePath`/`buildSha` to point at it. Do not skip this step and point
   `releasePath` at the live checkout directory -- the worker script's own
   guard (`THETA_RUNTIME_RELEASE_PATH_MISMATCH`) exists specifically to
   prevent that drift.
3. Do not restart the Scheduled Task until step 1-2 are both confirmed.

## No-submit startup steps (must run before any new-risk cycle is allowed)

1. With the new release in place, run `tools/theta-no-submit-probe.ts`
   (read-only w.r.t. the broker; it fails closed if the source tree is
   dirty or the identity check fails).
2. Confirm `inspectRuntimeSchemaCompatibility` reports `COMPATIBLE`
   (`sourceSha === workerSha === TARGET_SHA`), not `SCHEMA_INCOMPATIBLE`.
3. Only after both pass, allow the Scheduled Task to resume normal cycles.
   The permanent safety floor (`ORDER_SUBMISSIONS=0`, `BROKER_MUTATIONS=0`,
   `MASTER_PAPER_EXECUTION_ENABLED=false`, `PAPER_PAUSE_NEW_ORDERS=true`,
   `FIRST_PAPER_CANARY=OWNER_GATED`) remains in force regardless of
   deployment success -- this handoff does not request or imply lifting it.

## Post-deploy expected state / receipt fields (item 18's full checklist -- every one of these is already produced by existing source, none require new instrumentation)

- `TARGET_SOURCE_SHA == RUNNING_SOURCE_SHA`: `resolveReleaseIdentity()`
  (`release-identity.ts`) resolves the local worker's pinned `buildSha` as
  its real source identity (proven via the install script's own
  `git worktree`/`THETA_RELEASE_SHA_MISMATCH` invariant) -- confirm it
  equals `TARGET_SHA`.
- `TARGET_SOURCE_SHA == RUNNING_WORKER_SHA`: same resolver, same check.
- Schema compatible: `inspectRuntimeSchemaCompatibility` result
  `{compatible: true, sourceSha: TARGET_SHA, workerSha: TARGET_SHA}`; worker
  `status.json` `state` no longer `SCHEMA_INCOMPATIBLE`, `buildSha ===
  TARGET_SHA`.
- Current worker cycle reached the canonical brain: `result.strategyFrontier`
  is non-null on a real cycle, `result.canonicalFrontierInput` is present
  (the exact object the frontier ran on).
- Method execution evidence present -- read from PERSISTED evidence, never
  a transient in-memory result: for the normal Postgres path, the
  compressed evidence archive's own `methodInputProvenance` field
  (decode via `decodeCycleEvidenceArchive`); for the no-submit/database-
  independent path, the local evidence spool's `METHOD_PROVENANCE_READY`
  payload (`spool.listByPayloadType('METHOD_PROVENANCE_READY')`). Both are
  the SAME already-computed value `runThetaShadowCycle` produced -- never
  recomputed at either persistence point. Confirm `executed: true` for
  every method that ran this cycle.
- Method input realness present: the same persisted `methodInputProvenance`
  entries carry a real `inputRealness` classification (`REAL`/
  `PARTIAL_REAL`/`VERSIONED_POLICY`/`MANUAL`/`SYNTHETIC`/`UNKNOWN`), not
  absent.
- Only fully-real methods receive L7: `filterToRealInputEvidence` gates the
  manifest's `currentWorkerRealData` -- verify a method with `inputRealness
  !== 'REAL'` never shows `level: 'L7_CURRENT_WORKER_REAL_DATA'` in the
  receipt.
- `T0_REPLAY_BUNDLE` persisted/spooled: check the local evidence spool
  (no-submit path) for a `T0_REPLAY_BUNDLE` payload, or the Postgres
  evidence archive's `canonicalFrontierInput` field (normal path). Both
  archives now also carry `methodInputProvenance` alongside it, so a single
  decode/reload gives both pieces of evidence together.
- T0 replay round-trip reproduces the canonical decision:
  `replayFromT0Bundle(bundle)` on the persisted bundle reproduces the same
  `selectedCandidateId`/`selectedBranch`/`primaryAction`/`selectedQuantity`/
  `contentHash` as the original cycle (see
  `tests/t0-replay-bundle-writer-integration.test.ts` for the exact
  pattern).
- Decision receipt contains `releaseIdentity`: the next real decision
  persisted to `trade.decision.receipt_json` carries `releaseIdentity:
  {sourceSha: TARGET_SHA, workerSha: TARGET_SHA}` -- this is the first
  real, current-worker evidence confirming the target release actually ran,
  and is the specific fact that lets a future pass close
  `THETA-BRAIN-L7-CALLER-GAP` for real.
- `orders submitted = 0`, `broker mutations = 0`: unaffected by anything in
  this handoff; the permanent safety floor remains in force regardless of
  deployment outcome.

If ANY of the above cannot be confirmed from existing instrumentation,
that is a genuine remaining source gap and must be fixed before declaring
Phase 1 closed -- do not paper over a missing check.

## Pass conditions

All of the post-deploy checklist above holds: schema compatible; a real
cycle reaches the canonical brain with method execution and input-realness
evidence present; only fully-real methods reach L7; a T0 replay bundle is
persisted and its replay reproduces the original decision; the persisted
decision's `releaseIdentity` matches `TARGET_SHA` on both fields; zero
broker mutations occurred outside the existing safety floor.

## Rollback conditions

Any of: schema compatibility check fails after deploy; the worker cannot
acquire its lease; a new, previously-unseen error code appears in
`status.json`; `git diff --quiet HEAD --` on the deployed release is
non-clean (would indicate an untracked, unintended local modification in
the release snapshot). On any of these, revert `runtime.json`'s
`releasePath`/`buildSha` to the last known-good release
(`af3d43d14d703c47ff52e833588130af60d61e48`) and leave the Scheduled Task
in its current, already-failing `SCHEMA_INCOMPATIBLE` state rather than a
newly-broken one -- do not attempt a second untested cutover in the same
session.
