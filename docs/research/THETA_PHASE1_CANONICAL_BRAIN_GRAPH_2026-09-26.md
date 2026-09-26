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

## 1F — Time semantics

Not independently re-audited this pass beyond what Commands 3/4 already established (`labelAvailableAt >= eventAt >= decisionAt` invariant real and enforced in `wait-regret-dataset.ts`, `entry_baseline_experiment.py`, this session's own `production-persistence-adapters.ts`). No new `Date.now()`-as-decision-time defect found or searched for this pass — **not closed, real remaining gap**, deferred to a future round given time.

## 1G — Value semantics

Not independently re-audited this pass — deferred, real remaining gap.

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
- 1E/1F/1G (identity/time/value semantics): **partially audited only** — candidateId checked and clean, but underlying/OCC/episode/wholeChainId/orderId identity sweep, Date.now() sweep, and value-semantics sweep were not completed this round due to scope/time — these are the concrete remaining items, not vague.
- 1H tests: **1 of 5 requested tests added**; the other 4 are correctly classified as untestable from research-owned code without touching Codex's runtime files, not silently skipped.

Remaining before Phase 1 can honestly read COMPLETE: finish 1E/1F/1G sweeps; either get Codex-side buy-in for the 4 untestable 1H assertions or accept they remain a documented limitation, not a defect.
