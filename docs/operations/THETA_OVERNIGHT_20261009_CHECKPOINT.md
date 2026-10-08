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
| O1 | Review the date/DTE fix and assemble a minimal cutover scope | IN_PROGRESS | Focused parser, SQL DATE, UTC and failure tests; diff against deployed SHA |
| O2 | Make missing-DTE management comparisons truthful | TESTED_SOURCE_ONLY | The bootstrap policy now declines a complete comparison when open CSP/CC DTE is unknown; frontier records a typed system hold. Reproduced failing test, then 102 focused tests and TypeScript check pass. |
| O2a | Preserve subsecond account evidence timing for assignment capacity | TESTED_SOURCE_ONLY | Reproduced a 500 ms future `pg` timestamp gaining capacity after `String(Date)` dropped milliseconds; ISO conversion fixes it. Included in the 102 focused tests. |
| O3 | Paper indicative quote qualification | TESTED_SOURCE_ONLY | Existing adapters explicitly select `feed='indicative'`. Nine focused tests pass, including new zero-bid buy-to-close, ask, time, identity, session and source-semantics boundaries. No OPRA change or paid feed. No natural open-session quote was certified overnight. |
| O4 | Capital, AEGIS and lifecycle | TODO | Inspect authoritative consumers, fix only reproducible gaps with tests |
| O5 | Runtime and release package | TODO | Bounded final validation, exact-SHA CI, deployment no-go/go evidence |
| O6 | Dot PR #18 typed research handoff | REVIEWED_NO_MERGE | Draft H DTE 3-5 challenger. Current review source already has `researchDteConsistent` guard and tests from `f98f0ffb`. PR has zero qualified market observations/fills and no profitability proof. Research proposal remains disabled; exclude its temporary `vercel.json` safeguard from any future integration. |

## Read-only resident status

At 2026-10-08 22:42 UTC, the installed Windows status command reported one supervisor, exact release SHA `bc7ffbd5c87595040d69ce165dbcded52885b893`, online heartbeat age 65 seconds, and `executionGate=LOCKED`. This local status does not itself certify fresh broker close quotes, account lease renewal or source release readiness.

## Resume

Run `git status --short --branch` in this repository. Continue O2 in `src/theta/paper-bootstrap-management-policy.ts` and `tests/management-input-state.test.ts`. Do not assume any source fix is deployed. Update this file after each completed vertical slice.
