# THETA execution-path closure receipt — 2026-10-07

- **Owner:** Claude, under the temporary unified ownership override.
- **Scope:** why no valid Paper opportunity has ever reached the broker, and the fixes on release branch `claude/phase4-d-entry`.
- **Status vocabulary:** SOURCE_COMPLETE / TECHNICALLY_READY / DEPLOYED / PAPER_AUTHORIZED / EMPIRICALLY_PROFITABLE. Each is reported separately below.

## Production evidence (read-only, Production database)

| Fact | Value |
|---|---|
| `trade.order_intent` rows, all time | **0**: no Paper order has ever been sent |
| Paper action plans since 2026-10-01 | 11 (all `OPEN_CSP`, TLT, 2026-10-05) |
| Reached the broker path | 0 |
| Leaf reason: `MUTATION_FENCE_LOST:REQUEST_MUTATION_WINDOW_EXPIRED` | 6 |
| Leaf reason: expired unclaimed (no handoff in the evidence request, old release) | 5 |
| Execution control | master enabled, `pause_new_orders=false`, set by the owner at 2026-10-05 15:55Z |
| Account | $100k Paper account, options level 3 |
| Runtime connection pool | 2 connections shared by ~100 concurrent research symbols |
| Aiven `max_connections` | 20 (3 reserved) |

- **Reproduce:** `node --import tsx tools/theta-action-ready-loss-report.ts --environment-file=process` (read-only).
- **Root cause, plans 6–11:**
  - Plan assembly for the one broker-authorized symbol waited for the full research universe.
  - Each plan was enqueued 130–150 s into its request.
  - Each was claimed after the 150 s broker-mutation window had closed.
- **Root cause, plans 1–5:** the release then running had no handoff in the evidence request. The next handoff, in a management request, ran after the 45 s decision window. Already fixed on main by the immediate handoff.

## Fixes (release branch, all regression-tested)

| Bug class | Root cause | Fix | Regression |
|---|---|---|---|
| Research blocks execution (late mutation fence) | Authorized symbol processed after all research symbols | Authorized symbols launch first; persist, plan and hand off on evaluation, serialized; research continues | `tests/oct5-tlt-mutation-window-regression.test.ts`, `tests/shadow-evidence-runtime.test.ts` |
| DB queue starvation of execution | 2-connection pool shared with research | Dedicated 1-connection execution lane (`theta-runtime-execution`) for authorized-symbol evaluation, plan, claim, coordinator and execution evidence | Lane guard in the Oct 5 regression; reviewed in `tests/postgres-owner-inventory.test.ts` |
| Silent ACTION_READY expiry | Handoff skip reason lived only in a job result | `recordHandoffNotReached` on the plan; expiry keeps the leaf reason after `DECISION_EXPIRED` | `tests/db/strategy-selection-persistence.test.ts` |
| Fence-margin blind spot | No claim latency | CLAIMED event carries `requestElapsedMs` and `mutationWindowRemainingMs` | Report tool |
| False `AEGIS_UNKNOWN` (234 scans) | Cycle with no AEGIS assessment left a null representative state | Never-assessed candidates are `NOT_EVALUATED` (`AEGIS_NOT_EVALUATED_UPSTREAM` / `CANDIDATE_AEGIS_NOT_EVALUATED_UPSTREAM`). Still size 0 and still cannot earn a GLOBAL_WAIT. An asked-and-unknown assessment stays `AEGIS_REQUIRED_UNKNOWN` | `tests/canonical-strategy-frontier.test.ts` |
| AEGIS borrowing | (guard) | Selected H/D without their own bound AEGIS fail closed; Q's verdict is never H/D evidence | `tests/phase4-paper-strategy-lifecycle.test.ts`, `tests/defined-risk-handoff.test.ts` |
| H authority not propagated | Runtime never passed the H receipt to plan assembly | Branch-bound receipt passed | Commit `47c0d6d6` |
| H identity lost under management | Entry thesis exists only for Q; H chain had no `strategyOrigin` | Origin from the persisted opening decision `strategy_branch`; H never rolls | `tests/entry-thesis-receipt.test.ts` |
| Authority written to wrong DB | `theta-strategy-authority --apply` defaulted to `.env.local` | Explicit target required (`process` = Production) | `tests/migration-checkpoint-target.test.ts` |
| Emergency lock wrote wrong DB | `paper:lock-all-execution` used `.env.local` | Script targets `.theta-local-worker/production.env`; tool has no default | `tests/migration-checkpoint-target.test.ts` |
| D management as a second authority | D policy executed its own decision | Management-authority revision v3 (`docs/architecture/THETA_MANAGEMENT_FRONTIER_V3_DEFINED_RISK.md`) | `tests/management-frontier-v3-defined-risk.test.ts`, DB runner tests |
| D production entry | No D entry path | Sealed two-leg plan, per-leg quotes, one native mleg parent, filled-open registration sweep | `tests/defined-risk-handoff.test.ts`, DB tests |

## Capital ($100k matrix, Production policy values)

- **Per-underlying hard threshold:** $22,500 (15% × 1.5).
  - A $73k CSP is rejected by policy, even though the broker could afford it.
  - A put struck above $225 can never size one contract.
  - The production `ACCOUNT_CAPACITY_ZERO` volume (about 90k candidate-evaluations) is therefore classified LEGITIMATE_DISCRETE_CONTRACT_TOO_LARGE, not a defect.
- **TLT-size CSP:** fits.
- **Defined-risk spread:** sized by bounded max loss, not strike × 100.
- **Existing exposure:** consumes capacity.
- **Unevidenced exposure:** `UNKNOWN`, which fails closed.

Test: `tests/account-100k-capital-matrix.test.ts`.

## Known source-solvable gaps (not closed in this batch)

- About 28 operational/diagnostic tools still default to `.env.local`. They need explicit-target conversion; the authority writer and the emergency lock are already fixed.
- `Invoke-ThetaPostMigrationContinuation.ps1` is a stale 067-era script.
- D emergency risk reduction is escalation-only. D event/AEGIS management feeds stay UNKNOWN.
- The execution lane adds one connection per runtime instance against Aiven's 20 (3 reserved). Watch the connection count during the first session.

## External gaps

- Account multi-leg (mleg) entitlement is unverified, so D stays unauthorized.
- No remote archive backend: REMOTE_ARCHIVE_BACKEND_REQUIRED. Backups remain on the laptop and are bounded by retention.

## Status

| Strategy | Status |
|---|---|
| Q | SOURCE_COMPLETE on the release branch. DEPLOYED only after migration 069 and the Release B cutover. PAPER_AUTHORIZED: owner execution control is enabled. |
| H | SOURCE_COMPLETE. PAPER_AUTHORIZED = NO (no governed receipt). |
| D | SOURCE_COMPLETE. PAPER_AUTHORIZED = NO (receipt absent; mleg entitlement unverified). |
| All | Paper episodes completed: 0. PROFITABILITY_STATUS = NOT_YET_PROVEN. |
