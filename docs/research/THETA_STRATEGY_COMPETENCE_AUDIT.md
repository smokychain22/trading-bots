# THETA Strategy-Competence / Anti-Paralysis Audit — 2026-09-18

Branch `claude/theta-management-challenger`, audited against canonical main
`5dab6448861bd438815579b1c9ff16b3034dc3db`. Pure research/read-only pass — no
Production code changed, no broker authority, no order submitted. Master Paper
champion left running throughout.

Every finding below cites a real file:line from the current source, verified by
direct reading (this pass, or a parallel research sub-task whose output was checked
against the same discipline) — never inferred from a doc, a constant's name, or
memory alone. Where a claim could not be independently re-verified in the time
available, it is labeled "not re-verified this pass" rather than presented as fact.

## PRODUCTION_STRATEGIES

Five branches are defined in `src/theta/strategy-package.ts`
(`canonicalThetaStrategySources`) and consumed by `src/theta/canonical-strategy-
frontier.ts` (`buildCanonicalStrategyFrontier`). **None carries `status:
'PROMOTED'` or a live-execution flag that is actually enforced** (see the
`executionEnabled` finding below) — every branch is `SHADOW` or `RESEARCH_ONLY`,
and `executionAuthorized: false` is hardcoded at candidate, branch, and frontier
level.

| Branch | Status | Candidate generator | Hard feasibility | Management path |
|---|---|---|---|---|
| **THETA_CONVENTIONAL** (THETA-Q) | `SHADOW` | `singleLegPutCandidate`, DTE∈[25,60] (strategy-package.ts:129, canonical-strategy-frontier.ts:423) | route eligibility, AEGIS not HOLD/VETO/EXIT-only, assignment capacity>0 | `management-action-frontier.ts`: HOLD/CLOSE_FULL/ROLL/LET_EXPIRE/ACCEPT_ASSIGNMENT |
| **THETA_HOLD_STRIKE** (THETA-H) | `RESEARCH_ONLY` | same generator, DTE∈[2,5] (strategy-package.ts:134) | identical gates, narrower DTE | same |
| **THETA_DEFINED_RISK** (THETA-D) | `RESEARCH_ONLY`, **schema-forced** (strategy-package.ts:68-70 — cannot be set to anything else) | `definedRiskCandidate`, DTE∈[7,60], capped 1,000 structures/cycle (line 142/429) | width>0, matched expiry/multiplier, positive net credit (canonical-strategy-frontier.ts:289) | HOLD/CLOSE_FULL only (strategy-package.ts:151) |
| **THETA_RECOVERY** (THETA-A) | `SHADOW` | `stockActionCandidate` (RECOVERY_WAIT/SELL_STOCK) + `coveredCallCandidate` alternatives | `stock !== null && shares > 0` — bypasses the strategy router entirely (canonical-strategy-frontier.ts:410) | RECOVERY_WAIT/SELL_STOCK/SELL_CC → `paper-bootstrap-management-policy.ts` |
| **THETA_CC** (THETA-C) | `SHADOW` | `coveredCallCandidate`, DTE∈[1,60] CALL | covered shares > 0, AEGIS not DEFINED_RISK_ONLY | SELL_CC/HOLD_CC/CLOSE_CC/ROLL_CC/ALLOW_CALL_AWAY |

No sixth strategy exists in code. Nothing was invented for this table.

## CURRENT_APPLICABILITY_RULES / HARD_GATE_MAP / SOFT_EVIDENCE_MAP / BASELINE_RULES

| Rule | File:line | Classification | Reason |
|---|---|---|---|
| Not tradable / not option-enabled / invalid asset metadata | `universe-policy.ts:83-91` | HARD_SAFETY | Structurally cannot trade; correctly the only unconditional Stage-A rejections |
| Current price UNKNOWN | `universe-policy.ts:96-97` | HARD_FEASIBILITY | Cannot compute CSP economics at all without it — DEFERRED, not REJECTED |
| No usable option chain at all | `universe-policy.ts:102-103` | HARD_FEASIBILITY (REJECTED, distinct from low-liquidity) | Correctly separated from the liquidity soft-floor below it |
| Liquidity (`avgDollarVolume`) below floor | `universe-policy.ts:108-109` | SOFT_EVIDENCE (DEFERRED) | Explicitly never REJECTED — "deferred, not rejected" in the code's own reason text |
| Account collateral momentarily infeasible | `universe-policy.ts:114-119` | SOFT_EVIDENCE (DEFERRED) | Q=0/momentary shortfall correctly never becomes a permanent rejection |
| Ownership suitability unacceptable/unknown | `universe-policy.ts:123-128` | SOFT_EVIDENCE (DEFERRED) | Graded economic judgment, not a binary bullish screen, per its own comment |
| Unsupported corporate action pending | `universe-policy.ts:132-134` | HARD_SAFETY | Genuinely cannot be safely evaluated |
| Event proximity alone | `universe-policy.ts:135-137` | SOFT_EVIDENCE (DEFERRED) | Explicitly never an automatic veto — matches directive §3's own anti-paralysis requirement |
| DTE∈[25,60] THETA_CONVENTIONAL | `strategy-package.ts:129`, `canonical-strategy-frontier.ts:423` | HARD_FEASIBILITY | Contracts outside window never become candidates — no soft path around it; this is a real, literal "hardcoded DTE window" per directive §3, but scoped to ONE branch, not a universal law (THETA_HOLD_STRIKE uses a different window) |
| DTE∈[2,5] THETA_HOLD_STRIKE | `strategy-package.ts:134` | HARD_FEASIBILITY | Same mechanism; branch explicitly labeled a narrow research challenger (TRD §15), not a universal rule |
| `deltaResearchBuckets` | `strategy-package.ts:55` | RESEARCH_ONLY, declared but unused | Grepping all of `src/theta/` shows it is read nowhere outside its own declaration/schema — delta is genuinely never a hard gate anywhere in the live path, matching TRD's "delta ≠ probability" rule |
| `executionEnabled` field | `strategy-package.ts:41`, echoed at `src/customer/api.ts:541` | **LEGACY_SUSPECT** | Schema-validated (cannot be `true` unless `status !== 'RESEARCH_ONLY' && promotionStatus === 'PROMOTED'`) but consumed exactly once, only to echo into a status API response — nothing in the order-submission/worker path reads it to gate anything. Either a promotion-ladder switch not yet wired to real enforcement, or the real gate lives entirely in a separate readiness layer (`first-paper-order-readiness.ts`, not traced this pass) that doesn't consult it. **This is worth a direct question to Codex**, not a Claude-side fix — it's ambiguous whether this is dead governance or a real gap. |
| Final cross-branch tie-break: `candidateId.localeCompare()` | `canonical-strategy-frontier.ts:403` | SOFT_EVIDENCE gap | Among multiple Pareto-rank-1, equally-unknown candidates, THETA picks whichever option symbol sorts alphabetically first — not unsafe, but economically arbitrary at the margin. `capitalDayYield` exists on the candidate type but isn't used as the tie-break. |
| THETA-Q first-stage ranking: `rank_candidates` sorts strictly by `ownership_score` (Python, `theta_q_baseline.py:345-363`) | `theta_q_baseline.py:362` | BASELINE_ONLY, explicitly labeled | `EV_net` is permanently `None` here by explicit design (L269-289 docstring: a calibrated entry-outcome model doesn't exist yet) — this stage genuinely ranks by ownership alone, with premium/capital-days/spread present as *inputs* to the SEPARATE `pareto_frontier.py` stage (15 real dimensions: ev_net, edge_buffer, return_per_capital_day, fill_probability, expected_tail_loss, assignment_probability, severe_drawdown_probability, capital_requirement, capital_days, liquidity_spread_pct, expected_slippage, model_uncertainty, ownership_quality, event_risk_penalty, concentration_impact, capital_opportunity_cost — `pareto_frontier.py:72-89`), never the final ranking authority |
| `rankEligibleUnderlyings` ranks only by `avgDollarVolume` | `universe-policy.ts:189-223` | BASELINE_ONLY, explicitly labeled | The function's own doc comment states this is "v1 placeholder ranking feature, not final economic ranking" and that real premium-opportunity ranking needs option-chain data unavailable at this cheap pre-chain-fetch stage by design — an honest, self-aware maturity gap, not a silently-promoted universal law |

**No historical baseline (30-45 DTE / 0.20-0.25 delta / 50% take-profit) was found silently enforced as a universal production law.** Every DTE window found is branch-scoped and explicitly labeled in its owning module's docstring as either the primary baseline (THETA_CONVENTIONAL) or a narrow research challenger (THETA_HOLD_STRIKE). Delta and win-probability are never consumed as gates anywhere in the live TS/Python source. No fixed take-profit constant was found gating entry at all (profit management is a management-phase question, not an entry gate, and — separately — `managed-episode-path-features.ts`'s MFE/MAE interface exists specifically so no such fixed rule is needed there either, per the prior C1 audit).

## POSSIBLE_OVERRESTRICTIVE_GATES

1. **THETA_CONVENTIONAL's DTE∈[25,60] hard cutoff** (`strategy-package.ts:129`) is a real hard AND-condition at candidate ENUMERATION time (not a soft ranking input) — a genuinely attractive 24-DTE or 61-DTE contract never becomes a candidate at all for this branch. This is exactly the "hardcoded DTE window" pattern directive §3 asks to look for. It is not obviously wrong (a bounded lattice is a legitimate cost-control choice, consistent with `universe-policy.ts`'s own "never scan unboundedly" design principle), but it is a genuine, unlabeled-as-provisional hard AND-gate, unlike the liquidity/ownership/event stages in the same codebase, which are explicitly soft. Recommend: confirm with Codex/owner whether this specific window is meant to be a hard production law or should itself carry the same "BASELINE, not universal" framing THETA_HOLD_STRIKE's docstring already gives its own window.
2. **The alphabetical Pareto tie-break** (`canonical-strategy-frontier.ts:403`) does not itself cause a WAIT, but it can silently prefer an economically-arbitrary candidate among truly-tied ones rather than surfacing the tie or breaking it on a real dimension (`capitalDayYield` is right there, unused).

## POSSIBLE_UNDERRESTRICTIVE_GATES

None found this pass. Every AEGIS/hard-safety gate inspected (`HOLD_ONLY`/`HARD_VETO`/`EMERGENCY_EXIT_ONLY`, `UNSUPPORTED_CORPORATE_ACTION`, `assignmentCapacityQty <= 0`) is a genuine structural/safety block, correctly scoped, not a place asking for more restriction.

## UNREACHABLE_STRATEGY_PATHS

**One genuine structural risk identified, not confirmed as an active bug:**
`sizedNewRisk` (`canonical-strategy-frontier.ts:467-468`) filters candidates only
by `action ∈ {OPEN_CSP, OPEN_DEFINED_RISK} && quantity > 0` — it does **not**
check the owning branch's `status`. THETA_HOLD_STRIKE (`RESEARCH_ONLY`) shares
the identical `action: 'OPEN_CSP'` tag as THETA_CONVENTIONAL (`SHADOW`), so a
THETA_HOLD_STRIKE candidate can Pareto-dominate and become
`frontier.selectedBranch`/`selectedCandidateId` even though its branch is
`RESEARCH_ONLY`. `executionAuthorized: false` is hardcoded throughout so nothing
executes it regardless — but if any downstream consumer trusts
`selectedBranch`/`selectedCandidateId` as "the pick" without independently
re-checking `strategy-package.ts`'s own `status`/`promotionStatus`, a
RESEARCH_ONLY structure's identity flows forward as if it were the production
recommendation. **This was not traced further downstream in this pass** (out of
scope — would require reading every consumer of `selectedBranch`) and is flagged
as an open question, not a confirmed defect.

No candidate branch was found that can structurally never win a Pareto rank
(i.e., no branch is unreachable by construction) — all five branches feed the
same `rankCandidates` pool on equal footing. THETA_DEFINED_RISK's gating behind
`policy.theta_d_gate_satisfied` (`strategy_router.py:239-244`) with no visible
activation path in that file is confirmed intentional per TRD (gated regardless
of state, requires Level 3 options approval + full graduation), not a bug.

**Separate finding: a research module targets a frontier shape that doesn't
exist under that name.** `bots/theta/quant/research/wait_diagnostics_research.py`
defines a `WaitCycleFunnel`/`globalWaitEarned`/`blockedApplicable`-shaped
classification scheme intended to explain WAIT causes, but no module in the
current codebase (`canonical-strategy-frontier.ts` included) exposes that exact
interface — the live frontier's actual shape (`globalWaitEarned` derived from
whether every applicable branch was fully evaluated, `SYSTEM_HOLD` vs.
`GLOBAL_WAIT`, per `canonical-strategy-frontier.ts:476-485`) is close in spirit
but not identical in structure. This research module cannot currently be wired
to real runtime output without first reconciling that mismatch — flagged as
doc/research-code drift, not a Production defect.

## WAIT_PARALYSIS_RISKS

`universe-policy.ts`'s staged design is genuinely well-built anti-paralysis
architecture, confirmed by direct reading: it evaluates stages **sequentially**
(stopping at the first terminal state), and only Stage A (`tradable`,
`optionEnabled`, `assetDataValid`) and two narrow Stage-B/E conditions
(`hasUsableOptionChain === false`, `unsupportedCorporateActionPending`) are hard
REJECTED gates. Every other condition — liquidity, account collateral, ownership
suitability, event proximity — explicitly DEFERS rather than REJECTS, and the
module's own header comment states the anti-paralysis discipline as a named
design goal ("never combined into an AND-gate of a dozen technical
conditions"). This is the single strongest piece of evidence against a
systemic wait-paralysis problem existing in the universe-narrowing stage.

Concrete risks found (all with direct file:line citations, verified either by this
author or by a dedicated sub-task whose findings were checked against the same
citation discipline before inclusion):

1. **The single biggest real answer to "why does THETA never enter a new position" is a model-completeness gap, not a threshold problem.** `cross-symbol-economic-frontier.ts:50-59,226-236`: `returnPerCapitalDay`/`evNet` are always `null` because no calibrated entry-outcome model exists yet (THETA-Q's baseline has none) — the frontier can **structurally never reach `EXECUTABLE_SELECTION`** this cycle; every live evaluation can only produce `RESEARCH_RANKING_ONLY` or `NO_SURVIVORS`. This is honest, intentional, correctly-labeled behavior (the code does not fake a calibration it doesn't have — exactly right per TRD's anti-shortcut rules) but it functions as a hard, permanent WAIT gate on cross-symbol execution until an R6 calibrated EV model lands. This should be understood as the dominant, structural reason for the current all-WAIT behavior, ahead of any of the narrower filter-chain findings below.
2. **THETA_CONVENTIONAL's DTE window is a hard AND-gate at enumeration**, not a soft ranking dimension (see POSSIBLE_OVERRESTRICTIVE_GATES #1) — this is the one place in the universe/branch-eligibility path a genuinely hardcoded window can silently eliminate an attractive candidate before any economics are computed.
3. **UNKNOWN handling is correctly non-paralytic in most places directly inspected**: `universe-policy.ts` treats unknown liquidity/ownership/collateral as DEFERRED (soft), never REJECTED; `canonical-strategy-frontier.ts` pushes unknown IV/delta/OI/volume/event evidence into an `unknownEvidence` list used only as a Pareto tie-break weight; `strategy_router.py:210-212` treats `ownership_acceptable is None` as ineligible-with-a-named-reason, never a silent zero; `new-risk-orchestrator.ts:114-123` explicitly distinguishes `HARD_VETO` (a real capability failure) from `TRANSIENT` (not-yet-attempted/unknown), so plain data unavailability is never miscounted as a risk veto.
4. **One real exception to that discipline found**: `new-risk-orchestrator.ts:624` derives `eventNear` as `regimeResult.data.eventState === null ? true : ...` — an UNKNOWN event state is silently coerced to the MOST restrictive boolean (`eventNear = true`) rather than surfaced as its own UNKNOWN outcome. This is the one place in the paths read this pass that violates CLAUDE.md's own non-negotiable rule ("missing/stale optional data becomes UNKNOWN — never silently coerced"), even though the coercion direction (toward caution, not toward permissiveness) makes it a safety-conservative bug rather than a risk-taking one. Worth a follow-up check of how `opportunity_frontier.py` actually consumes `eventNear=true` (hard fail vs. soft demotion) before deciding whether to correct it.
5. **`GLOBAL_WAIT` is structurally distinguished from `SYSTEM_HOLD`** (`canonical-strategy-frontier.ts:476-485`): `GLOBAL_WAIT` requires every applicable branch to have been fully evaluated (not blocked on missing input) with zero risk-feasible candidates — an *earned* WAIT, not a default. If the strategy router itself is unavailable, the frontier reports `SYSTEM_HOLD` instead, correctly distinguishing "nothing good found" from "couldn't evaluate."
6. **Provider-concentration risk is architecturally intentional, not a bug**: `new-risk-orchestrator.ts:88-101`'s `REQUIRED_FOR_NEW_RISK` list is Alpaca-only (`ALPACA_ACCOUNT`/`ALPACA_OPTION_CONTRACTS`/`ALPACA_OPTION_CHAIN`); Optionomics/event data are explicitly informational and never hard-gate the cycle, per TRD's provider-ownership rules (Alpaca = broker truth, Optionomics = features only, never a blocker). This means any Alpaca option-chain staleness single-handedly holds the whole cycle, with zero Optionomics-side redundancy — correct per the frozen provider architecture, and per CLAUDE.md should not be "fixed" by adding redundancy without a TRD revision, but worth naming explicitly as the concentration point it is.
7. **A four-stage AND-chain in candidate generation exists** (`new-risk-orchestrator.ts:399-504`: executable flag → non-null delta → quote-freshness classification → Python lattice DTE/delta-band membership) — each stage individually is a defensible fail-closed check, but they are unconditionally chained with limited cycle-level visibility into which stage actually did the filtering. A `wait_diagnostics_research.py` funnel-classification module exists specifically to answer this (`bots/theta/quant/research/wait_diagnostics_research.py`) but — a genuine doc/code-drift finding — it's written against a frontier module (`globalWaitEarned`/`blockedApplicable`-shaped interface) that does not exist under that name anywhere in the current codebase; it cannot currently be wired to real runtime output without reconciling that mismatch first.
8. **THETA_H's eligibility check collapses two independently-diagnosable causes into one reason code**: `strategy_router.py:226-235` requires both `ownership_acceptable is not None` AND `not market.event_near` in one condition, reporting a single `THETA_H_CONDITIONS_NOT_MET` regardless of which failed — reduces diagnosability for a branch that's presumably already rare to trigger.

## TOP_CONTEXT_USAGE_FINDINGS (economic thesis per strategy)

Per-strategy stated economic rationale, quoted from the code's own docstrings
(never invented) — see `THETA-Q`, `THETA-H`, `THETA-C`, `THETA-A` docstring
citations above from the contract-selection/timing research pass:

- **THETA-Q**: "acceptable ownership + acceptable liquidity + [eventually] positive after-cost EV," explicitly NOT high-IV-alone (`iv_rank` marked informational-only in `theta_q_baseline.py`, "never a standalone gate"). The volatility-richness half of its own stated thesis (IV vs. RV / VRP) has **no implementation yet** — stated but unbuilt.
- **THETA-H**: intentional 2-5 DTE assignment + isolated recovery-wait, specifically because "a closed-trade WR can hide unresolved stock drawdown" (H-H-02) — explicitly claims no proven win-rate edge, only a measurement-discipline rationale for why it's tracked separately.
- **THETA-C**: WAIT (retain full stock upside) is the DEFAULT; a covered call is only chosen when `premium − forfeited_upside − event_penalty − execution_cost` beats WAIT's own forward stock-value estimate — never "sell a call because shares exist" (H-C-01/H-C-02).
- **THETA-A/recovery**: explicitly bounded patience (H-A-02: no unconditional wait), comparing RECOVERY_WAIT/SELL_STOCK/SELL_CC on one shared state.
- **THETA-D**: only a name + a one-line gating comment ("gated, THETA-Q alternative only," `strategy_router.py:32`) was found — no standalone economic-thesis docstring exists for this branch.

## TOP_CONTRACT_SELECTION_FINDINGS

1. Two genuinely separate ranking stages exist and are both live-reachable (`theta_q_contract.py` → `new-risk-orchestrator.ts:577-579`, `pareto_frontier_contract.py` → `cross-symbol-economic-frontier.ts:138-140`): a Python ownership-only baseline sort, then a real 15-dimension Pareto frontier. This is NOT a single-scalar "highest premium wins" system.
2. Skew, term-structure, and expected-move have **no field at all** in either `CandidateEconomics` (pareto_frontier.py) or `CspCandidateInputs` (theta_q_baseline.py) — confirmed by reading the actual dataclasses, not inferred from a doc.
3. Open question (not confirmed): whether candidates bucketed `infeasible` by the ownership stage purely due to `quantity=0` still reach the Pareto stage for comparison, or are dropped before the richer multi-factor comparison ever sees them. Not traced to a conclusion this pass.

## TOP_ENTRY_TIMING_FINDINGS

1. **No rate-of-change volatility signal exists anywhere in the live path.** `regime_v0.py`'s `rv20` and `underlying-features.ts`'s realized-vol aggregates are both single-window snapshots — two candidates with an identical absolute `rv20` are classified identically regardless of whether that number is rising into a shock or falling out of one. This is a real, confirmed gap (directive §8's "rapid volatility expansion" vs. "compression" distinction does not exist in code today).
2. No GEX/flow-at-decision-time feature is consumed by any live entry-scoring path found — consistent with GEX's existing `RESEARCH_ONLY` status (not re-verified fresh this pass, but no live GEX consumer was found in the files actually read).
3. **This gap does not need a new "EntryTimingBrain"** — the existing `bots/theta/quant/features/realized_volatility.py` (ported from C2 this session) already computes the daily/weekly/monthly HAR-RV feature triplet that could express volatility acceleration as `daily − weekly` or `weekly − monthly` differences; no new infrastructure is required to close this gap once real historical option data exists, only a new feature derived from already-built pieces.

## MANAGEMENT_LEARNING_OPPORTUNITIES (wait/entry/management regret — directive §9-13)

**Major finding: this infrastructure already exists, comprehensively, and does
not need to be designed.** `src/research/resolved-outcome-engine.ts` defines
exactly the outcome-label taxonomy directive §§9-13 ask for —
`outcomeLabelTypes` includes `WAIT_OUTCOME`, `SELECTED_ACTION_OUTCOME`,
`SELECTED_CONTRACT_OUTCOME`, `NEIGHBOR_STRIKE_OUTCOME`,
`OTHER_EXPIRATION_OUTCOME`, `OTHER_STRUCTURE_OUTCOME`,
`MANAGEMENT_ACTION_OUTCOME`, `MANAGEMENT_ALTERNATIVE_OUTCOME`,
`STRATEGY_OUTCOME`, `WHOLE_CHAIN_OUTCOME`, `ACTION_REGRET`, `CONTRACT_REGRET`,
`STRATEGY_REGRET` — plus an `OutcomeProvenance` enum
(`BROKER_ACTUAL`/`MARKET_OBSERVED`/`REPLAY_OBSERVED`/`MODELED_RESEARCH`/
`UNRESOLVED`/`INVALID`) that is exactly directive §9's requested
OBSERVED/ESTIMABLE/NOT_IDENTIFIABLE classification, already more granular than
what was asked for. `src/theta/action-inaction-frontier.ts`'s
`calculateInactionDiagnostics` already computes `waitRate`, `holdRate`,
`actionRate`, `opportunityCaptureRate`, `rejectedCandidatePositiveOutcomeRate`,
`correctRejectRate`, and `unresolvedRate` from a `resolvedOutcome` field — this
IS the "was waiting correct?" research interface directive §9 asks for. Live
consumers confirmed: `src/theta/p2e-evidence-store.ts` and
`tools/p2d-outcome-resolve.ts` (not dead code).

What genuinely does not exist yet: **real trade data to feed it.** Master Paper
has zero fills; every horizon in `standardOutcomeHorizons` (15min/1d/3d/5d) and
every resolver in `outcome-resolver.ts` (e.g. `resolveWholeChainOutcome`,
correctly `BLOCKED` when any of nine named UNKNOWN conditions holds — never a
fabricated resolution) is honestly `PENDING`/`UNRESOLVED` until the first real
episode closes. No further design work is needed here; the correct next step
once real Paper data exists is simply to run this already-built pipeline, not
to build a new one.

## DATA_REQUIRED_FOR_EMPIRICAL_VALIDATION

Unchanged from `docs/research/HISTORICAL_OPTIONS_DATA_GAP.md`'s standing
conclusion (cited, not re-derived): real historical option bid/ask and
intraday-quote-timestamp coverage from Alpaca/Optionomics remain the open
verification item, not a new data provider. For this audit specifically:
real Master Paper fills (currently zero) are the blocking input for every
regret/counterfactual metric below — the resolution machinery is ready and
waiting, not missing.

## RECOMMENDED_SHADOW_METRICS

All of these compose the ALREADY-EXISTING `resolved-outcome-engine.ts` /
`action-inaction-frontier.ts` machinery — no new decision authority, no new
brain:

1. `InactionDiagnostics.opportunityCaptureRate` / `rejectedCandidatePositiveOutcomeRate` / `correctRejectRate` (already implemented) — track once WAIT/reject decisions accumulate resolved outcomes.
2. Per-branch selection-vs-status audit: how often does `selectedBranch` come from a `RESEARCH_ONLY` branch (THETA_HOLD_STRIKE, THETA_DEFINED_RISK)? This directly tests the UNREACHABLE_STRATEGY_PATHS finding above without requiring any code change — just a query over already-emitted frontier records.
3. Pareto-tie frequency and margin: how often does the alphabetical tie-break (`canonical-strategy-frontier.ts:403`) actually decide a real, non-trivial choice (as opposed to a true near-zero-economic-difference tie)? If it fires often on non-trivial gaps, that's evidence the tie-break should use `capitalDayYield` instead.
4. DTE-window edge-loss estimate: for THETA_CONVENTIONAL's [25,60] hard cutoff, track (once contract data is available) how many economically-attractive contracts at DTE 22-24 or 61-65 existed and were never even enumerated as candidates.
5. HAR-RV acceleration feature (daily − weekly, weekly − monthly, from the already-ported `realized_volatility.py`) as a new, purely observational feature on resolved outcomes — testing directive §8's timing-quality hypothesis without granting it any gate authority.
6. `RESEARCH_RANKING_ONLY` vs. `EXECUTABLE_SELECTION` cycle-rate tracking on `cross-symbol-economic-frontier.ts` output — makes the dominant structural WAIT cause (no calibrated EV model yet) directly visible over time, distinct from every narrower filter-chain finding above, without changing any code.
7. `eventNear` UNKNOWN-vs-coerced-true rate on `new-risk-orchestrator.ts:624` — count how often `eventState === null` actually drives the coercion (vs. a genuine known event), to size whether the finding in WAIT_PARALYSIS_RISKS #4 is a rare edge case or a frequent one before deciding it's worth a fix.

## Receipt

See the conversation's final receipt for structured status fields; not repeated
here.
