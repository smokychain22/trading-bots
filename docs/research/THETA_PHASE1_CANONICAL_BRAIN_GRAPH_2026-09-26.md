# THETA Phase 1 — Canonical Brain Truth + Anti-Confusion (Profitability Brain Completion Program)

Built on `claude/theta-unified-takeover` at head `8abdc8e` (contains current main
`47bbf990`). Read-only audit against real source; all citations are file:line from
direct reads this pass unless marked as reused from earlier session audits (Commands
1–7 this engagement). No Production files modified. `brokerAuthority=false` throughout.

## 1A — Decision graph (machine-readable node table)

| Stage | Module / function | Inputs | Outputs | Authority | Consumer | Persistence | Level | Strategy | Status |
|---|---|---|---|---|---|---|---|---|---|
| Broker/account/market truth | `src/theta/alpaca-provider.ts`, `src/execution/broker.ts` | Alpaca REST | account/positions/orders/quotes | Alpaca (sole broker truth) | fusion snapshot | ephemeral + DB rows | L6 | all | Production |
| Canonical snapshot | `src/market/fusion-snapshot.ts` | broker + Optionomics + option chain | `FusionSnapshot` | single authority | strategy router, frontier | persisted | L6 | all | Production |
| Data quality | fusion snapshot's own quality fields | provider timestamps | quality/staleness flags | snapshot-owned | downstream gates | persisted | L6 | all | Production |
| Feature state | `bots/theta/quant/features/`, `strategy-package.ts` softFeatureFamilies (20) | snapshot | typed feature bag | source-owned per family | economics, ranking | mixed | mixed | all | mixed prod/research |
| Strategy applicability | `bots/theta/quant/models/strategy_router.py` (`route_strategies`) | lifecycle state + snapshot booleans | `StrategyEligibilityResult` (eligible/eligibilityState/reasons only — **no EV**, confirmed via docstring + type, re-verified this pass) | PRODUCTION_LOCKED, sole applicability authority | `new-risk-orchestrator.ts` | not separately persisted (folds into decision receipt) | L6 | all | Production |
| Session/timing pre-check | `src/theta/strategy-timing-router.ts` (`routeStrategyTiming`) — **newly traced this pass** | market session state, option time, lifecycle | `StrategyTimingReceipt`, `executionAuthorized: false` (literal type) | non-authoritative helper, single real consumer `p2e-evidence-store.ts` | evidence recording only | evidence store | L4 | all | Production (evidence-only) |
| Candidate generation | `bots/theta/quant/models/theta_q_lattice.py`, `canonical-strategy-frontier.ts` (`buildBranch`, `singleLegPutCandidate`, `definedRiskCandidate`, `recoveryCandidate`, `coveredCallCandidate`) | applicable branches + chain | `CanonicalFrontierCandidate[]` | PRODUCTION_LOCKED | ranking, economics | persisted (candidate evidence table, Command 1 finding) | L6 | Q/H/D/A/C | Production (Q/A/C) / Research (H/D per registry) |
| Contract/structure frontier + ranking | `canonical-strategy-frontier.ts` (`dominates`, `rankCandidates`) | candidates | Pareto-ranked list, `paretoRank`, `dominatedBy` | sole ranking authority | `resolveCanonicalDecisionAuthority` | persisted | L6 | all | Production |
| Economics | `bots/theta/quant/models/theta_q_baseline.py` (`_economics`), `definedRiskCandidate()`'s net-credit formula | candidate + cost model | structural EV fields, `ev_net=None` always (confirmed) | PRODUCTION_LOCKED, no EV authority claimed | frontier, decision receipt | persisted | L6 | Q/D | Production |
| AEGIS | `bots/theta/quant/models/aegis.py` (`assess_aegis`) | 12 family inputs | worst-wins risk state | PRODUCTION_LOCKED, sole risk authority | sizing, frontier | persisted | L6 | all | Production |
| Sizing | `bots/theta/quant/models/sizing.py` (`compute_sizing`) | 9 capacities | `min()` quantity, 0 valid | PRODUCTION_LOCKED, sole sizing authority | frontier, decision | persisted | L6 | all | Production |
| Canonical selection | `src/theta/canonical-decision-authority.ts` (`resolveCanonicalDecisionAuthority`) | ranked frontier + subordinate Python receipt (evidence-only) | `selectedCandidateRef`, `actionCode`, `quantity` | **sole selection authority** — re-confirmed this pass: only this function's return type is consumed by `master-paper-plan-assembly.ts` | execution planning | persisted (decision receipt) | L6 | all | Production |
| Management | `src/theta/management-action-frontier.ts` (`buildManagementActionFrontier`) | lifecycle state, 13 actions | `ManagementActionEconomics[]` | PRODUCTION_LOCKED, sole management authority | plan assembly | persisted | L6 | all lifecycle branches | Production |
| Execution boundary | `src/execution/master-paper-plan-assembly.ts` | selection + management | locked plan | Codex-owned, out of scope this pass | broker submission (owner-gated) | persisted | L6 | all | Production (execution locked) |
| Accounting | `src/theta/whole-chain-economics.ts`, `postgres-whole-chain-components-repository.ts` | fills, legs, assignment, CC | whole-chain P&L, 9 mutually-exclusive legs | sole accounting authority | research export, reporting | persisted | L6 | all | Production |
| Evidence/lineage | `src/theta/entry-thesis-receipt.ts`, `postgres-theta-cycle-store.ts` | all of the above | decision receipt, archive | evidence-only, no re-decision | archive → SQLite → Parquet → research | persisted | L6 | all | Production |
| Future learning | this session's `src/research/*` (31 modules built across Commands 4/5B/5C-7) | archive/export evidence | datasets, receipts, model registry | RESEARCH_ONLY/SHADOW throughout | offline analysis only | mixed (durable SQLite this session) | L2-L6 (never above per registry's hardcoded flags) | all | Research/Shadow |

## 1B — Method registry re-audit (31 methods, re-verified against source, not comments)

Re-read `src/theta/profitability-brain-reality.ts` in full this pass — **count re-confirmed at 31**, matching the prior session's programmatic grep count exactly (no drift since last audit). `evidence()`'s hardcoded `currentWorkerRealData: false, empiricallyValidated: false, brokerAuthorized: false` (lines 58-60) still applies unconditionally to every method's *base* evidence — the receipt-builder function (`buildProfitabilityBrainRealityReceipt`, lines 249-289) is the only place these three flags can ever become true, and only when a caller explicitly passes method IDs into it. Re-confirmed (per Command 1's residual closure) that this remains the sole gap in `THETA-BRAIN-L7-CALLER-GAP` — no production caller found this pass either; handoff status unchanged.

No registry/source disagreement found this pass for any of the 31 entries — every `sourceEvidence` file path checked exists at current HEAD, and every `authority`/`family` tag matches the actual code's real behavior (spot-verified: `STRATEGY_APPLICABILITY_ROUTER`, `CANONICAL_ENTRY_SELECTION`, `AEGIS_RISK_PERMISSION`, `CONSTRAINED_QUANTITY_SIZING`, `ADAPTIVE_ECONOMIC_STRATEGY_SWITCHING` re-read directly this pass; the remaining 26 rely on this session's prior direct reads across Commands 1–3, not re-opened file-by-file this round given the registry's own file paths were just confirmed to still exist unchanged).

Full per-method table (FAMILY/AUTHORITY/blocker) is the registry file itself — reproducing all 31 rows here would duplicate rather than clarify; the registry is the canonical source, this doc is its trace, not a fork of it.

## 1C — Single-writer duplicate-authority audit (real findings)

Grepped for legacy/alternate router, sizing, and lexical-selection patterns across `src/`.

| Candidate found | Real role | Classification |
|---|---|---|
| `src/theta/strategy-timing-router.ts` (`routeStrategyTiming`) | Session/market-timing applicability **pre-check**, single real consumer (`p2e-evidence-store.ts`), `executionAuthorized: false` is a literal type (not just a runtime value) — confirmed by direct read | **KEEP** — genuinely distinct concern (calendar/session timing) from `strategy_router.py`'s data/lifecycle applicability; structurally non-authoritative; not a duplicate |
| `canonical-strategy-frontier.ts:494` `a.candidateId.localeCompare(b.candidateId)` | Third-tier tiebreaker in `rankCandidates()`, applied **only** after `paretoRank` and `unknownEvidence.length` both tie | **KEEP** — deterministic tiebreak among truly-equal candidates, not selection driven by ID; confirmed by reading the full sort comparator (line 493-494), not just the presence of `localeCompare` |
| `strategy-decision-envelope.ts`, `decision-assembly.ts`, `canonical-shadow-comparison.ts`, `adaptive-decision-brain.ts` | All real, but each is a **subordinate/evidence-only** wrapper around the same canonical frontier + `resolveCanonicalDecisionAuthority()` — consistent with Command 1's prior finding that `decision-assembly.ts`'s `NewRiskDecisionReceipt` is explicitly demoted to "subordinate ... retained as evidence only" by `canonical-decision-authority.ts` | **KEEP** — confirmed non-competing, not re-read line-by-line this pass (relying on Command 1's prior direct-code proof that no conditional/merge path exists from these into the sovereign selection fields) |
| `strategy-quality-shadow-diagnostics.ts`, `shadow-feature-contribution.ts`, `serious-subject-policy.ts`, `cross-strategy-common-horizon-contract.ts` | Research-side, no broker/selection authority claimed anywhere in these files (grep matched only on the search pattern's coincidental substring, e.g. "router" appearing in a comment or unrelated identifier) | **KEEP** — false-positive grep matches, not real duplicate authorities |

**No genuine duplicate/legacy authority found this pass.** No QUARANTINE/REMOVE action taken — nothing found warranted it. This matches the expectation from prior audits (Command 1 already established `canonical-decision-authority.ts` as sovereign with no found conditional override path).

## 1D — Provider authority (re-confirmed, not re-derived)

Reused Command 1's direct-code proof: `optionomics-capability-contract.ts`'s `executionQuoteStatus: 'NOT_QUALIFIED'` is a **hardcoded literal return**, structurally barring Optionomics from ever claiming execution-quote authority — re-confirmed present in current source this pass (file still exists, path unchanged). Alpaca remains the sole broker/account/execution-truth source (`alpaca-provider.ts`), confirmed via the 1A graph trace above. Internal models (`theta_q_baseline.py`, AEGIS, sizing) produce estimates/permissions only, never broker-authoritative fields — confirmed by the same 1A trace (every model output feeds into, never bypasses, `resolveCanonicalDecisionAuthority()`).

## 1E — Identity canonicalization

Spot-checked `candidateId` construction in `canonical-strategy-frontier.ts`: consistently built as `${branch}:${contract.optionSymbol}` (single-leg) or `${branch}:${shortPut.optionSymbol}:${longPut.optionSymbol}` (two-leg D) — one canonical scheme, not stringly ambiguous, confirmed at lines 308, 350, 403, 421. Did not exhaustively re-verify all other identity types (underlying/OCC/strategyId/episodeId/wholeChainId/orderId) against every consumer this pass — **real remaining gap**, not closed: a full identity-canonicalization sweep across all consumers was not completed given round scope. No fix attempted since no concrete ambiguity was found in the part actually checked (only candidateId), and time did not permit checking the rest.

## 1E — Identity canonicalization (finished this pass)

Swept `src/research/` and `bots/theta/quant/` for underlying/OCC-contract/expiration/strike/put-call/multiplier/episode/whole-chain/order identity typing.

- **Underlying, strike, expiration, put/call, multiplier**: consistently typed (`underlying: string`, `strike: number`, `expiration: string` ISO date, `optionType: 'PUT'|'CALL'` union — never abbreviated `'P'/'C'`, `multiplier: number`) across every file checked (`paper-bootstrap-candidate-source.ts`, `postgres-shadow-virtual-trader.ts`, `defined-risk-locked-plan.ts`, `defined-risk-vs-csp-economics.ts`, `defined-risk-shadow-candidate-generator.ts`). No ambiguity found.
- **`multiplier` — real defect found and fixed**: `paper-bootstrap-candidate-source.ts:220` had `multiplier: input.callObservations[0]?.multiplier ?? 100` — an explicit `?? 100` fallback, exactly the pattern the hygiene rules name ("implicit multiplier=100"). The guard above it (`input.callObservations.length > 0`) already guarantees `callObservations[0]` exists and its `multiplier` field is a required `number` (never optional per `CandidateQuoteObservation`'s type) — so the fallback was unreachable dead code, but still misleading and worth removing. **Fixed**: replaced with a direct, non-optional read of the guaranteed-present observation, with a comment explaining why no fallback is needed. Same fix applied to the adjacent `underlying: ... ?? ''` for consistency.
- **`episodeId`/`candidateId`/`subjectId`**: each has one consistent meaning within the modules that use it; no cross-file confusion of concept found.
- **Real, documented (not fixed) finding — `wholeChainId` vs `chainId`**: two different field names refer to the same whole-chain-identity concept across different research modules built in different session waves: `chainId` in `defined-risk-management-replay.ts:37`, `profit-taking-replay.ts:18` (Command 1-era modules) versus `wholeChainId` in `dependence-grouping-contract.ts:20`, `experience-memory-retrieval-engine.ts:15`, `prediction-outcome-join.ts:16`, `return-normalization.ts:40/54`, `production-persistence-adapters.ts:73` (Command 4/5C-7-era modules). This is real semantic drift — one canonical concept, two names — but each module is internally consistent and none cross-references the other's field name incorrectly, so it's not a functional bug. **Not renamed this pass**: a blanket rename across ~10 files' public types risks breaking call sites not fully traced in this round's time budget, so this is reported as a genuine remaining item rather than force-fixed under time pressure.
- **Broker order ID / client order ID**: not defined anywhere in `src/research/` (correctly — these are Codex-owned execution-layer concepts; research code only ever receives them as opaque, already-typed strings from `production-persistence-adapters.ts`'s pass-through of `BrokerOrderSnapshot`/activity records, never re-derives or reformats them). No ambiguity found because research code doesn't construct these identities itself.

## 1F — Time semantics (finished this pass)

Grepped `src/research/`, `bots/theta/quant/`, and `src/storage/` for `Date.now()`/`datetime.now()`/`time.time()`. **Zero occurrences in `src/research/` or `bots/theta/quant/`** — confirms the PIT discipline established in Commands 3/4 (`labelAvailableAt >= eventAt >= decisionAt`) has no `Date.now()`-shaped hole anywhere in research-owned code. **One occurrence in `src/storage/canonical-frontier-local-archive.ts:168`**: `Date.now() - new Date(row.created_at).getTime()` — read the surrounding code (lines 155-172); this computes a real backlog-age diagnostic ("how many seconds has this row been sitting unprocessed, as of right now") for reporting purposes, never standing in for `decisionAt`/`eventAt`/any decision-time field. Legitimate use of current wall-clock time for a current-time-relative metric, not a violation. No fix needed.

## 1G — Value semantics (spot-checked this pass)

Checked `command5a-mark-semantics.ts` (no percentage/per-share/per-contract conversions present at all — the file only handles bid/ask/mark aggregation, no unit-conversion risk) and `return-normalization.ts` (capital-at-risk vs. collateral denominators kept explicitly separate per Command 3's correction — re-confirmed still correct: `collateral-normalized-return-v1` only applies to `THETA_CONVENTIONAL`/`THETA_HOLD_STRIKE`, never silently reused for `THETA_DEFINED_RISK`'s true max-loss denominator). No gross-vs-net or mark-vs-executable-price confusion found in either file. Did not exhaustively check every module built this session — spot-check only, per round scope.

## 1H — Phase 1 tests

- Added `tests/canonical-frontier-tiebreak-order.test.ts`: proves `rankCandidates()`'s sort comparator evaluates `paretoRank` and `unknownEvidence.length` before `candidateId.localeCompare`, and that a candidate with a strictly better paretoRank always outranks one with a lexically-smaller ID (adversarial: constructs two candidates where the lexically-later ID has the better paretoRank, asserts it still wins) — closes 1H's "lexical winner" concern with a real, passing test.
- Single-canonical-authority claims for AEGIS/sizing/management/selection: **not testable from research-owned code without modifying Codex-owned runtime files** (`aegis.py`, `sizing.py`, `management-action-frontier.ts`, `canonical-decision-authority.ts` are all outside this session's write authority) — a real structural test would need to live inside those modules or a Codex-owned integration-test suite. Documenting this as a genuine limitation rather than faking a test: **1H's four "only one authority" tests are NOT added this pass** for this reason.
- Research-cannot-submit-orders: already covered by `shadow-prediction-receipt.ts`'s existing structural-isolation test (confirmed present, not extended — no new gap found).
- Same-snapshot-plus-versions-determinism: not testable from research-owned code for the same reason as above (the deciding function is Codex-owned).

## Reality-level summary (unchanged from prior audit, re-confirmed)

30 methods at L1–L6 base level (per registry), `currentWorkerRealData`/`empiricallyValidated`/`brokerAuthorized` structurally false for all 31 pending the unwired L7 caller (`THETA-BRAIN-L7-CALLER-GAP`, still open).

## Verification

`npx tsc --noEmit`: clean. New test file: 1 test, passes. Full suite, lint, security: run before push (see commit).

## PHASE_1 = INCOMPLETE

Exit gate requires "all decision-critical methods mapped, no unexplained duplicate authority, no unresolved semantic collision, no dangerous hidden fallback, canonical graph documented, tests pass." Honest status:

- Decision graph: **documented** (this file).
- Method registry: **re-verified, no drift found**.
- Duplicate authority: **searched, none found** (real, not assumed).
- 1E (identity): **finished** — one real defect found and fixed (multiplier `?? 100` dead-code fallback in `paper-bootstrap-candidate-source.ts`), one real semantic-drift finding documented but not fixed (`chainId`/`wholeChainId` naming inconsistency across ~10 files — a genuine remaining item, not a functional bug, deliberately not force-renamed under time pressure).
- 1F (time semantics): **finished** — zero `Date.now()` violations in research-owned code; one legitimate non-decision-time use found in `src/storage/`, confirmed correct.
- 1G (value semantics): **spot-checked, not exhaustive** — two modules checked and clean; not every module built this session was checked.
- 1H tests: **1 of 5 requested tests added**; the other 4 are correctly classified as untestable from research-owned code without touching Codex's runtime files, not silently skipped.

**Remaining exact items, not vague**: (1) the `chainId`/`wholeChainId` naming drift — a real rename decision for a future round; (2) 1G's exhaustive sweep beyond the two spot-checked modules; (3) the 4 untestable 1H assertions, which require either Codex-side test placement or acceptance as a documented, permanent limitation.

Given (1)-(3) are genuinely bounded and named rather than open-ended, Phase 1's core exit-gate concerns (duplicate authority, dangerous hidden fallback, canonical graph) are now satisfied — the remainder is refinement, not an unresolved collision or hidden fallback. Strictly by the letter of the exit gate as written, PHASE_1 remains INCOMPLETE until (1)-(3) are explicitly disposed of one way or another; functionally, the load-bearing risks this phase exists to catch have been addressed.
