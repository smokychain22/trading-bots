# THETA overnight engineering checkpoint, 2026-10-09

This is a source-work checkpoint, not a Production certification. Keep the resident worker unchanged and full-submit locked. No broker mutations, Production writes, migration 071, paid OPRA, or Production deployment are authorized for this shift.

## Starting state

- Review branch: `codex/theta-v4-integration` at `d0b479f3dfd0a6d9a1e79a699308cab09ed9f1ba`, clean and equal to its local remote-tracking ref at start.
- Production worker: `bc7ffbd5c87595040d69ce165dbcded52885b893`, not this review branch.
- Original-master credential recovery is closed. Preserve the protected private recovery receipts outside Git.
- XLE short-put date defect is source-corrected by `34b630e5`, but the installed worker still has the old parser. The last observed management input had a locale-form expiration and unknown DTE. An after-hours HOLD is not an open-session executable-close certification.
- Paper option snapshots on the installed source explicitly select Alpaca's free `indicative` feed. The OPRA 403 came from a separate diagnostic request. Indicative evidence is Paper-only and not NBBO.

## Work register

| ID | Work | State | Next evidence |
| --- | --- | --- | --- |
| O1 | Review the date/DTE fix and assemble a minimal cutover scope | TESTED_SOURCE_ONLY | Isolated minimal hotfix branch `codex/theta-date-hotfix-review` at `822703ccc989edf3fd94371217673b1f5f5a72c1`, based on deployed `bc7ffbd5`; 99 focused management tests and TypeScript check pass. No deployment. |
| O2 | Make missing-DTE management comparisons truthful | TESTED_SOURCE_ONLY | The bootstrap policy now declines a complete comparison when open CSP/CC DTE is unknown; frontier records a typed system hold. Reproduced failing test, then 102 focused tests and TypeScript check pass. |
| O2a | Preserve subsecond account evidence timing for assignment capacity | TESTED_SOURCE_ONLY | Reproduced a 500 ms future `pg` timestamp gaining capacity after `String(Date)` dropped milliseconds; ISO conversion fixes it. Included in the 102 focused tests. |
| O3 | Paper indicative quote qualification | TESTED_SOURCE_ONLY | Existing adapters explicitly select `feed='indicative'`. A new regression found that missing provider underlying metadata was replaced with the plan's underlying, making incomplete contract identity look proven. Both Paper quote sources now require the actual provider underlying, expiration and strike to match the exact plan. Ten focused quote/source tests pass. A canonical Phase-2 re-execution passed 610 source cases; reviewed requirement `2.4.FRESH_CYCLE` remains evidence-invalidated until its disposable-DB proof is rerun. No OPRA change or paid feed. No natural open-session quote was certified overnight. |
| O4 | Capital, AEGIS and lifecycle | IN_PROGRESS | Existing schema-071 account observation, shared reservation, broker reflection and plan-intent stores reviewed. A regression proved that missing options buying power fell back to generic margin buying power for prospective secured assignment; management now holds capacity UNKNOWN. Another regression proved that omitted short-call commitment evidence freed shares for a covered-call candidate; the frontier now sizes zero. Contradictory long-side/negative-quantity broker stock and option rows also previously produced usable inventory or call capacity; the read-only sources now classify them UNKNOWN. Focused inventory/frontier and handoff suites passed 150 cases after these fixes. Seven disposable-PostgreSQL tests skipped because no `TEST_DATABASE_URL`; Docker Desktop engine is not running. No claim of real DB concurrency proof this shift. |
| O5 | Runtime and release package | IN_PROGRESS | Full local Node 4,582 pass / 86 skipped, Python 1,358 pass, browser 23 pass and ten Windows safety scripts passed on the earlier scoped checkpoint. Exact-SHA CI passed for `7ee17dc0`, `f1597c2b` and `6e45f273`. CI for `cbea226e` failed one stale synthetic test fixture after the covered-call fail-closed correction; the current uncommitted follow-up fixes that fixture and focused tests pass. Phase-2 through Phase-6 reviewed cases were re-executed against the latest source bytes (611 / 265 / 229 / 248 / 128 pass). TypeScript, lint, build, security scan (zero findings) and Git storage policy pass locally. Final exact-SHA CI and Production deployment approval remain. |
| O6 | Dot PR #18 typed research handoff | REVIEWED_NO_MERGE | Draft H DTE 3-5 challenger. Current review source already has `researchDteConsistent` guard and tests from `f98f0ffb`. PR has zero qualified market observations/fills and no profitability proof. Research proposal remains disabled; exclude its temporary `vercel.json` safeguard from any future integration. |

## Read-only resident status

At 2026-10-08 22:42 UTC, the installed Windows status command reported one supervisor, exact release SHA `bc7ffbd5c87595040d69ce165dbcded52885b893`, online heartbeat age 65 seconds, and `executionGate=LOCKED`. This local status does not itself certify fresh broker close quotes, account lease renewal or source release readiness.

## Resume

Run `git status --short --branch` in this repository. Review the Phase-3/4 regenerated artifacts and commit this checkpoint, then fetch the review remote, verify fast-forward ancestry and absence of sensitive material, and push only the reviewed branch for exact-SHA CI. Continue O4 only for a specific reproducible capital or lifecycle defect. Do not assume any source fix is deployed. Update this file after each completed vertical slice.
