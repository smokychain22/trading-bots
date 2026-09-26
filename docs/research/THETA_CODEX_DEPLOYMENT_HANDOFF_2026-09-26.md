# THETA Codex Deployment Handoff (2026-09-26)

Phase 1 Zero-Unknown Reclosure Pass 3, items 22-26. This is documentation
only -- nothing in this file was executed by Claude. No deploy, no Aiven
mutation, no worker restart. Claude's unified-ownership authorization for
this engagement explicitly excludes broker mutation and Production
deployment; this handoff exists precisely so Codex (or the repository
owner) can execute the cutover with zero new instrumentation required.

## Identity

- **TARGET_SHA** (this takeover branch's tip, to be deployed):
  `0613a4e09ac81665070d893e2e76276481b7b7aa` (branch `claude/theta-unified-takeover`,
  as of this document's own commit -- re-run `git rev-parse HEAD` on this
  branch immediately before cutover to get the true final SHA including any
  commits after this doc).
- **CURRENT_CHECKOUT_HEAD_SHA** (worker's raw git checkout, separate from
  what it executes): `47bbf9905a27a7231a5f47cab7c777c48d29b632`, branch
  `main`, clean tree, at
  `C:\Users\hp\Documents\Codex\2026-09-09\read-all-my-files-in-depth\work\trading-bots`.
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
- `REQUIRED MIGRATION STATE`: none required by this pass's own changes.
  Item 2 (source/worker SHA persistence) was resolved with **zero new
  migrations** -- it reuses the existing `trade.decision.receipt_json`
  jsonb column additively. No `DEPLOYMENT_MIGRATION_REQUIRED_CODEX`
  classification is needed for anything in this pass.
- **FILES CHANGED THIS PASS** (full diff is in git history on this branch,
  commits `bca6e13`, `ce99a1e`, `d7001c4`, `0613a4e`, `af0e182`, and this
  doc's own commit): `src/theta/postgres-theta-cycle-store.ts`,
  `src/theta/autonomous-runtime.ts`, `src/theta/autonomous-runtime-handler.ts`,
  `src/research/production-shadow-runtime.ts`,
  `tests/db/theta-cycle-persistence.test.ts`,
  `tests/fixtures/real-sep24-q-ready-excerpt.json`,
  `src/theta/profitability-brain-evidence-manifest.ts`,
  `tests/theta-real-historical-episode.test.ts`,
  `docs/research/THETA_BRAIN_AUTHORITY_V1.md`,
  `docs/research/SOURCE_RUNTIME_TRUTH_MATRIX.md`, this file.

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

## Post-deploy expected state / receipt fields

- `runtime-schema-compatibility` result: `{compatible: true, sourceSha:
  TARGET_SHA, workerSha: TARGET_SHA}`.
- Worker `status.json`: `state` no longer `SCHEMA_INCOMPATIBLE`;
  `buildSha === TARGET_SHA`.
- The next real decision persisted to `trade.decision.receipt_json` must
  carry `releaseIdentity: {sourceSha: TARGET_SHA, workerSha: TARGET_SHA}`
  (this pass's item-2 fix) -- this is the first real, current-worker
  evidence confirming the target release actually ran, and is the specific
  fact that will let a future pass close `THETA-BRAIN-L7-CALLER-GAP` for
  real rather than via this checkout's own `git rev-parse HEAD`.

## Pass conditions

All of: schema compatibility reports `COMPATIBLE`; the worker completes at
least one real cycle without `SCHEMA_INCOMPATIBLE`/`RUNTIME_SCHEMA_INCOMPATIBLE`;
the persisted decision's `releaseIdentity` matches `TARGET_SHA` on both
fields; zero broker mutations occurred outside the existing safety floor.

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
