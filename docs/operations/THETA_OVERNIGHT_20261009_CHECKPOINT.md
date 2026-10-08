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
| O1 | Review the date/DTE fix and assemble a minimal cutover scope | TESTED_SOURCE_ONLY | Isolated minimal hotfix branch `codex/theta-date-hotfix-review` at `50e88834400a2ffa2b076ce3ea7a3950da44cfbe`, based on deployed `bc7ffbd5`; 99 focused management tests, TypeScript check and exact-SHA CI run 37857980367 pass. No deployment. |
| O2 | Make missing-DTE and management discovery truthful | TESTED_SOURCE_ONLY | The bootstrap policy declines a complete comparison when open CSP/CC DTE is unknown; frontier records a typed system hold. Reproduced discovery defects marked an open CSP/CC with unknown ledger option quantity as valid empty, and let `NaN` stock shares pass a covered-call quote candidate because the numeric comparison returned false. Discovery now emits `PARTIAL_COVERAGE` for unknown quantity and requires finite whole shares sufficient for the full existing CC roll size. Focused discovery/frontier/plan tests passed 38 cases. No natural open-session management decision is certified. |
| O2a | Preserve subsecond account evidence timing for assignment capacity | TESTED_SOURCE_ONLY | Reproduced a 500 ms future `pg` timestamp gaining capacity after `String(Date)` dropped milliseconds; ISO conversion fixes it. Included in the 102 focused tests. |
| O3 | Paper indicative quote qualification | TESTED_SOURCE_ONLY | Existing adapters explicitly select `feed='indicative'`. A regression found that missing provider underlying metadata was replaced with the plan's underlying, making incomplete contract identity look proven. Both Paper quote sources now require actual provider underlying, expiration and strike to match the exact plan. Ten focused quote/source tests and 611 canonical Phase-2 reviewed source cases passed. The Phase-2 register's `2.4.FRESH_CYCLE` is a source-test PASS, not current-worker/open-session proof. No OPRA change or paid feed. No natural open-session quote was certified overnight. |
| O4 | Capital, AEGIS and lifecycle | IN_PROGRESS | Existing schema-071 account observation, shared reservation, broker reflection and plan-intent stores reviewed. Regressions proved three fail-open cases: missing options buying power fell back to generic margin buying power for assignment, omitted short-call commitment evidence freed shares for a covered-call candidate, and contradictory or missing broker position sides understated stock/option exposure. The first now holds assignment capacity UNKNOWN, the second sizes covered calls zero, and the third marks affected broker inventory and portfolio exposure UNKNOWN. Focused account/inventory/frontier tests pass. Seven disposable-PostgreSQL tests skipped because no `TEST_DATABASE_URL`; Docker Desktop engine is not running. No claim of real DB concurrency proof this shift. |
| O5 | Runtime and release package | IN_PROGRESS | Full local Node 4,582 pass / 86 skipped, Python 1,358 pass, browser 23 pass and ten Windows safety scripts passed on the earlier scoped checkpoint. Exact-SHA CI passed for `7ee17dc0`, `f1597c2b`, `6e45f273` and `4b42da12`; `cbea226e` failed one outdated covered-call test fixture, corrected in `4b42da12`. Phase-2 through Phase-6 reviewed source cases passed (611 / 265 / 229 / 249 / 128). TypeScript, lint, build, security scan (zero findings) and Git storage policy pass locally. `911aa840` exact CI and the management-discovery follow-up source CI remain to be verified. Production deployment approval remains. |
| O6 | Dot PR #18 typed research handoff | REVIEWED_NO_MERGE | Draft H DTE 3-5 challenger. Current review source already has `researchDteConsistent` guard and tests from `f98f0ffb`. PR has zero qualified market observations/fills and no profitability proof. Research proposal remains disabled; exclude its temporary `vercel.json` safeguard from any future integration. |

## Read-only resident status

At the latest read-only status check, the installed Windows status command reported one supervisor, exact release SHA `bc7ffbd5c87595040d69ce165dbcded52885b893`, online heartbeat age 36 seconds, and `executionGate=LOCKED`. The first status attempt against the review checkout correctly showed no local runtime there; only the installed Production checkout is the worker source. This local status does not itself certify fresh broker close quotes, account lease renewal or source release readiness.

## Resume

Run `git status --short --branch` in this repository. Finish the small management-discovery source/test diff, then fetch the review remote, verify fast-forward ancestry and absence of sensitive material, and push only the reviewed branch for exact-SHA CI. Wait for the exact-SHA result before claiming final source certification. Do not assume any source fix is deployed. The governed main merge, Vercel deployment and Windows worker cutover need separate owner authorization after a fresh Production preflight.
