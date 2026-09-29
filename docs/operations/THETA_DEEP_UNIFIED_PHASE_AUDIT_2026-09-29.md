# THETA deep unified phase audit, 2026-09-29

This receipt records the source audit performed on the isolated
`codex/theta-unified-integration` branch. It does not authorize an order,
promote a research strategy, or claim evidence from a worker that has not run
this source.

## Authority and scope

| Field | Value |
| --- | --- |
| Integration baseline before this wave | `ff7d4ec2432637851d9ff8304af0661e39b06c62` |
| Deployed locked release at audit time | `cf9bc26a3cdd3646a663fe6fa97c8055606a2caa` |
| Production schema head | `067` |
| Decision-critical denominator | 45 typed fields in `theta-decision-critical-evidence-registry-v1` |
| Static inventory rows | 278 |
| PostgreSQL relations inventoried | 156 |
| Authoritative inventory rows with relations | 434 |
| Unknown relation classifications | 0 |
| Order submissions | 0 |
| Broker mutations | 0 |
| Follower submissions | 0 |
| Live authorization | `NOT_GRANTED` |

The broad keyword scan found 3,205 source lines containing discovery terms such
as `unknown`, `default`, `fallback`, `research only`, or `TODO`. That index is
not a blocker count. The authoritative decision-critical review is the typed
45-field evidence registry together with the governed UNKNOWN audit. The audit
reports zero avoidable UNKNOWNs, zero unresolved safety-critical UNKNOWNs, and
zero unresolved Paper-entry UNKNOWNs. Optional, empirical, provider-limited,
and not-applicable states remain typed rather than being converted to false or
zero.

## Inventory result

| Category | Count |
| --- | ---: |
| Strategies | 5 |
| Actions | 17 |
| Soft feature families | 20 |
| Hard-rule families | 11 |
| AEGIS families | 12 |
| Brain methods | 32 |
| Brain layers | 21 |
| Profit-taking challengers | 17 |
| Claude work packages | 100 |
| Command-5A components | 10 |
| Provider capabilities | 13 |
| Infrastructure and governance components | 20 |

Every row records its producer, inputs, truth class, normalization, units,
timestamp and freshness semantics, persistence, consumer, runtime caller,
authority, L0-L9 maturity, real-data status, empirical status, Paper and live
authority, UNKNOWN behavior, replay support, tests, blocker, and next action.
The machine-readable source is `src/theta/deep-system-inventory.ts`, and the
receipt command is `npm run theta:truth:deep-inventory`.

Reality levels remain intentionally conservative:

| Level | Rows |
| --- | ---: |
| L0 absent | 0 |
| L1 typed contract | 8 |
| L2 source implemented | 1 |
| L3 deterministic tested | 102 |
| L4 canonical integrated | 69 |
| L5 persisted | 5 |
| L6 runtime reachable | 93 |
| L7 current-worker real data | 0 |
| L8 empirically validated | 0 |
| L9 broker authorized | 0 |

`inventoryCoverage=COMPLETE` means row cardinality, schema, authority, and
source-reference validation only. It does not mean runtime proof or empirical
validation.

## Defects fixed in this pass

1. The canonical truth document described an older stopped-worker and final
   checkpoint state. It now distinguishes the deployed locked release from the
   newer reviewed integration source and names the remaining current-worker
   evidence dependency.
2. The adaptive shadow comparator permanently returned `NO_COMPARISON` even
   when deterministic common-horizon evidence could identify a structural
   Pareto frontier. It now persists the frontier, an optional unique structural
   leader, unresolved dimensions, and WAIT state. It still does not fabricate
   empirical EV or promote a strategy.
3. First-Paper evidence quantity could inherit an environment cap above one.
   Plan assembly now hard-caps the governed first canary at one contract, the
   handoff rejects a larger evidence plan before broker access, and canary
   acceptance requires exactly one contract.
4. Benchmark `BQ-3` was reported as missing policy even though the canonical
   THETA-Q v0 request contract already existed. The research runner now invokes
   that exact contract and writes a versioned, hashed, broker-disabled receipt.
   B1, B2, and BH-1 remain blocked because their lifecycle policies are truly
   incomplete.
5. A broad keyword discovery index was labeled `REVIEW_REQUIRED`, which could
   be misread as thousands of unresolved blockers. The receipt now names the
   typed 45-field registry as the authoritative decision-critical denominator
   and labels the keyword scan as discovery-only.
6. The database recovery gate could collapse a known local environment
   precondition into `UNCLASSIFIED_DATABASE_ERROR`. Known local preconditions
   now retain their typed code. The first actual current-main gate still
   stopped at probe one on `EAI_AGAIN`, so no cutover or worker start followed.
7. The Windows task launched `theta-local-worker.ps1` from mutable `main` while
   the runtime payload came from the immutable release. The installer now
   launches the supervisor itself from the release directory. Worker status
   and premarket certification independently reject a task whose script path
   is not aligned with the immutable release.
8. The prior worker shutdown cannot be assigned a factual cause because Task
   Scheduler operational history was disabled and the old final receipt stored
   only `OFFLINE`. The supervisor now fails closed if its own path is outside
   the immutable release, records its SHA-256 script hash, and distinguishes a
   governed stop request, an unhandled error, and an unexpected scope exit.
   This improves the next shutdown receipt without rewriting the old incident.

## Phase truth

| Phase | Current truth |
| --- | --- |
| Phase 1 | The older release is stopped and execution remains locked. The installed task's mutable supervisor path is now explicitly rejected, while corrected immutable launch is source-tested and awaits a governed cutover. The current-main database gate stopped at probe one on `EAI_AGAIN`. Current-worker open-session proof, durable method provenance, truthful L7 assignment, persisted T0, and provider-free replay remain forward-data/runtime work. |
| Phase 2 | Provider authority, exact executable quote identity, PIT timing, 20 feature families, and typed provider failures are source-complete. Current-session provider evidence remains forward-data dependent. |
| Phase 3 | Candidate, sizing, WAIT decomposition, T0 identity, tamper rejection, and provider-free replay are source-complete. Current-worker proof remains pending. |
| Phase 4 | Five-strategy mechanics and 17 management/profit challengers are deterministic and tested. H and D stay research-only, while A and C require applicable broker inventory. Profitability remains empirically unproven. |
| Phase 5 | One AEGIS authority, one canonical sizing authority, and one broker mutation state machine are enforced. Current-worker candidate-bound proof remains pending. |
| Phase 6 | Dataset, outcome, benchmark, model, calibration, and walk-forward infrastructure exists. Recovered history has zero selected candidates and zero resolved outcomes, so no profitability or model promotion is valid. |
| Phase 7 | Operational readiness, archive health, UNKNOWN audit, and Command-5A diagnostics are source-complete. Exact release deployment and supported-session evidence remain pending. |
| Phase 8 | Canary governance is now typed and limited to one Q/SPY Paper contract. The first order requires separate owner permission and has not been authorized. |
| Phase 9 | Live graduation has typed minimum evidence, reliability, calibration, risk, and rollback thresholds. Passing them can only request owner review. Live remains unauthorized. |

## Validation evidence

| Validation | Result |
| --- | --- |
| Relevant focused TypeScript tests | 43 passed |
| Paper/live governance tests | 4 passed |
| Benchmark runner tests | 18 passed |
| Full Python suite | 1,231 passed |
| Full Node suite | 3,042 tests, 3,027 passed, 15 skipped, 0 failed |
| Typecheck, lint, build | passed |
| Browser suite | 23 passed |
| Security scan | 1,778 paths, zero findings |
| Git storage policy | 1,777 tracked files, zero findings |
| Historical regression suite | 24 of 24 passed, zero unclassified |
| Session simulator | 14 of 14 passed, zero broker mutations and submissions |
| Accelerated failure soak | 391 complete cycles, zero failures, typed injected provider and infrastructure faults |
| UNKNOWN audit | 0 avoidable, 2 open typed states, 0 safety-critical, 0 Paper-entry |

These are source and simulation results. Exact-SHA CI and deployment evidence
are recorded separately after the branch is committed and pushed.

## Remaining work classification

| Class | Work |
| --- | --- |
| `FORWARD_DATA_REQUIRED` | Current-release supported-session provider evidence, candidate-bound AEGIS, natural sizing, exact finalist refresh, persisted T0, deterministic replay, and real management lifecycles when applicable. |
| `PROVIDER_LIMITED` | Feature families whose provider does not prove complete units, history, or negative assurance. These remain optional or typed limited. |
| `EMPIRICALLY_UNPROVEN` | EV, POP, managed-episode distribution, adaptive economic switching, policy optimality, 70-80 percent win-rate target, and live graduation metrics. |
| `OWNER_PERMISSION_REQUIRED` | First actual Alpaca Paper order and every live-money action. |

`REMAINING_CODE_SOLVABLE_BLOCKERS = 0` for the reviewed decision-critical
source denominator after the immutable-launch correction. The corrected source
still requires exact-SHA CI and a later governed locked cutover after the
database recovery gate passes. The failed `EAI_AGAIN` gate and the stopped
worker are infrastructure state. They are not strategy `WAIT` evidence.
