# THETA pre-VPS unknown ledger

Status: **Slice 1 (seed) + Slice 3 (expansion) of the pre-VPS zero-avoidable-
unknown directive.** Built from direct source reads plus two rounds of
targeted fork audits -- Slice 1 covered `src/theta/` and `src/execution/`;
Slice 3 extended to `src/providers/`, `src/worker/`, `src/market/`, `src/ops/`,
`src/database/`, `src/customer/`, and the Python quant layer
(`bots/theta/quant/models/*.py`) -- plus the real
`docs/operations/THETA_R7_LIVE_SESSION_FORENSIC_2026-09-21.md` forensic (an
actual live-session read against real Aiven/Alpaca evidence, not a
simulation). It is **still not** an exhaustive whole-repo audit -- see
`THETA_PRE_VPS_AUDIT_SCOPE_AND_PLAN.md` for what remains.

**Item 4 below (`CONTRACT_NOT_EXECUTABLE`) has its own dedicated, much deeper
investigation**: `THETA_CONTRACT_NOT_EXECUTABLE_INVESTIGATION.md`. That
investigation found the real executability gate has **10 independent
conditions**, not just the multiplier check this ledger's first pass
suspected -- read that document for the full picture; the summary here is
kept brief and now points to it as the authoritative source.

**Item 2/5 below has been re-verified this pass via a direct, line-by-line
read of `bots/theta/quant/models/aegis.py` (not a fork summary) and is now
the single most severe finding in this entire ledger**: AEGIS unconditionally
returns `HOLD_ONLY` (permitting zero new-risk-opening actions) on every real
Production evaluation today, entirely independent of the
`CONTRACT_NOT_EXECUTABLE` gap. This is promoted to `P0_FIRST_PAPER_BLOCKER`
throughout every downstream document (acceptance contract, Codex backlog,
capability registry, brain capability matrix).

Every entry below is grounded in an actual file read (cited by path/line) or
the real forensic document — never inferred from a function name alone.

## Legend

`AVOIDABLE` = could THETA realistically know this at decision time with a real
producer that does not currently exist or is not currently wired, vs.
`LEGITIMATE` = a real, structural, or provider-bounded unknown that should
remain UNKNOWN.

## Confirmed AVOIDABLE unknowns (real producer missing or not wired)

### 1. `rollCandidate` / `ccCandidate` are always `null` in Production management evaluation

- **FIELD**: `PaperBootstrapCandidateSource.candidatesFor()` result (`src/theta/paper-bootstrap-management-policy.ts:1127-1136`)
- **STAGE**: Management brain -- roll/CC candidate evaluation for an open CSP/CC chain
- **CURRENT_VALUE_STATE**: Always `{ rollCandidate: null, ccCandidate: null }` in every real Production call
- **WHY_UNKNOWN**: The real call site, `autonomous-runtime.ts:353`, invokes `createPaperBootstrapManagementPolicyProvider()` with **zero arguments** (confirmed again this pass: `grep -n "createPaperBootstrapManagementPolicyProvider" src/theta/autonomous-runtime.ts` -> line 41 import, line 353 call, no argument supplied), so the constructor's default `candidates = noCandidates` (line 1146/1155) is what actually runs. `noCandidates` (line 1134) is a stub that always resolves both fields to `null`.
- **PRODUCER_EXPECTED**: A real `PaperBootstrapCandidateSource` implementation that enumerates real roll/CC candidates from the live contract lattice for the chain's underlying.
- **PRODUCER_ACTUAL**: None wired. A real, tested DISCOVERY module already exists in this research branch (`src/research/paper-bootstrap-candidate-source.ts::enumerateCandidates`/`buildPaperBootstrapCandidateSet`, built in an earlier pass of this engagement) but has never been adopted as the real `PaperBootstrapCandidateSource` implementation feeding `autonomous-runtime.ts`.
- **PROVIDER**: Alpaca (contract lattice), Optionomics (context only)
- **PERSISTENCE_PATH**: N/A -- this is a live per-cycle lookup, not a persisted table
- **CONSUMER**: `evaluatePaperBootstrapManagementPolicy` -- the real, sophisticated, already-tested roll/CC valuation machinery (`evaluateRollCandidates`, `RollIncrementalUtility`, `valueForRollFromCandidates`, `valueForRollCcFromCandidates`, `valueForSellCcFromCandidates`) that is structurally unreachable today because it never receives a non-null candidate.
- **SAFETY_AUTHORITY**: Management policy (not AEGIS) -- this degrades the specific action (ROLL/SELL_CC) to UNKNOWN/unavailable, not a hard safety block
- **FIRST_PAPER_REQUIRED**: YES for any chain that reaches an open-position management decision (roll or CC), which is most of the bot's real lifetime value proposition (the Wheel is a management-heavy strategy, not just an entry strategy)
- **VPS_REQUIRED**: YES
- **AVOIDABLE_OR_LEGITIMATE**: **AVOIDABLE** -- confirmed real machinery exists on both sides of the gap (a real valuator, a real discovery module); only the wiring between them is missing
- **REMEDIATION**: Wire a real `PaperBootstrapCandidateSource` implementation (adapting `src/research/paper-bootstrap-candidate-source.ts` or an equivalent Codex-owned implementation) into the call at `autonomous-runtime.ts:353`
- **OWNER**: Codex (Production wiring; `src/theta/` and `src/execution/` are Codex-owned)
- **VERIFICATION_TEST**: A new Codex-side test asserting `createPaperBootstrapManagementPolicyProvider()`'s real call site in `autonomous-runtime.ts` is invoked with a non-default candidate source, plus an integration test proving a real open CSP chain with a real roll candidate in the lattice produces a non-null `rollCandidate` through the full path

### 2. `stressIvShockDetected` / `stressSpreadWideningDetected` have zero real producer anywhere in the repo -- **PROMOTED TO P0: this alone unconditionally blocks all new-risk actions today**

**Verified line-by-line this pass, `bots/theta/quant/models/aegis.py`**: `_liquidity()` returns `HOLD_ONLY` whenever `stress_spread_widening_detected is None`; `_system()` returns `HOLD_ONLY` whenever ANY of its 3 stress inputs is `None`. Since both fields are confirmed always `None` in Production, BOTH the LIQUIDITY and SYSTEM families are always `HOLD_ONLY`. `assess_aegis()` takes the worst state across every family (`_worse()`, strictest wins), so `new_risk_state` is **provably always `HOLD_ONLY` or worse in Production today**, and `_NEW_RISK_ACTIONS_BY_STATE[HOLD_ONLY] = frozenset()` -- an empty set. **AEGIS unconditionally permits zero new-risk-opening actions (OPEN_CSP/SELL_CC/ROLL/OPEN_DEFINED_RISK_SPREAD) today, regardless of every other family's real state, independent of the `CONTRACT_NOT_EXECUTABLE` gap.** This is now the single most severe finding in this entire ledger -- even a perfectly executable, perfectly-sized, perfectly-routed candidate would still be refused by AEGIS. Exit supremacy (CLOSE/CANCEL/RECONCILE/etc.) is unaffected and remains real.

- **FIELD**: `aegisInputs.stressIvShockDetected`, `aegisInputs.stressSpreadWideningDetected`
- **STAGE**: AEGIS SYSTEM-family risk gate
- **CURRENT_VALUE_STATE**: Always `null` in the real Production path (`src/theta/account-exposure.ts`'s `deriveCandidateInclusiveAegisInputs`, confirmed via `aegis-derivation.ts:24-27`'s own doc comment: "Production callers supply null, never an unevidenced false"). Note: `theta-shadow-once.ts:104` hardcodes both to `false`, but that file is an explicit dev-only manual-input CLI entrypoint gated behind `--allow-manual-inputs` and is never the real autonomous runtime path -- classified `NOT_APPLICABLE_DEFAULT`, not a Production defect.
- **WHY_UNKNOWN**: No IV-shock or spread-widening history baseline has ever been built.
- **PRODUCER_EXPECTED**: A real detector comparing current IV/spread against a rolling historical baseline.
- **PRODUCER_ACTUAL**: None. Confirmed via `grep -rln "stressIvShockDetected" src/theta/ src/execution/` -> only the two files above reference the field at all.
- **PROVIDER**: Optionomics (`iv_term_structure`, `option_metrics` for IV history), Alpaca (option BBO polling for spread history)
- **PERSISTENCE_PATH**: Not yet designed
- **CONSUMER**: `bots/theta/quant/models/aegis.py`'s SYSTEM family, which requires 3 non-`None` stress signals to evaluate; only `stressGapDetected` is real today, so this family can structurally never reach a real evaluated state
- **SAFETY_AUTHORITY**: AEGIS (hard safety)
- **FIRST_PAPER_REQUIRED**: **YES, confirmed no longer merely governance-dependent** -- this pass's direct code trace proves the gap is not "the SYSTEM family stays unevaluated" (a softer framing) but "AEGIS unconditionally returns `HOLD_ONLY` for new risk, every cycle, with zero exceptions, until real producers exist." `docs/research/THETA_AEGIS_FIRST_PAPER_POLICY_GAP.md` (built in an earlier pass) still correctly frames the SECOND, narrower question of whether the SYSTEM family should require exactly 3 real signals or could operate safely at 2-of-3 as governed policy -- but that framing is no longer sufficient on its own, because the LIQUIDITY family (a SEPARATE family, not the SYSTEM family) is ALSO always `HOLD_ONLY` from the same missing `stressSpreadWideningDetected` producer, and worst-family-wins means either family alone is already fully blocking.
- **VPS_REQUIRED**: Same governance dependency
- **AVOIDABLE_OR_LEGITIMATE**: **AVOIDABLE** in principle (real data sources exist to build a producer) but **currently honestly represented** -- this is a `PRODUCER_MISSING` classification, not an `IMPLEMENTATION_DEFECT`, because the field is correctly `null`, never false-defaulted
- **REMEDIATION**: Build the two real detectors, OR make an explicit, documented governance decision that SYSTEM-family non-evaluation is acceptable for first Paper (a 2-of-3-signal or 1-of-1-real-signal threshold, chosen deliberately, not by omission)
- **OWNER**: Codex (AEGIS/Production risk policy) for the governance decision; either agent for the underlying detector build (research prototype could be Claude's, Production integration is Codex's)
- **VERIFICATION_TEST**: A test proving the SYSTEM family reaches a real evaluated (non-perpetually-unresolved) state once 2-of-3 (or whatever threshold is governed) signals are real

### 3. Multi-position sector/correlation concentration has no real producer beyond the single-underlying case

- **FIELD**: `aegisInputs.sectorConcentrationPct`, `aegisInputs.correlationClusterExposurePct`
- **STAGE**: AEGIS SECTOR/CORRELATION-family risk gate
- **CURRENT_VALUE_STATE**: Real only when exactly one underlying is held (`account-exposure.ts`'s `soleRiskGroup` proxy); `null`/unproduced for 2+ concurrent positions
- **WHY_UNKNOWN**: No real multi-position sector classification or correlation-cluster computation has been built and wired into the AEGIS input derivation path
- **PRODUCER_EXPECTED**: A real sector/correlation exposure computation across all currently-held positions
- **PRODUCER_ACTUAL**: Only the 1-underlying special case
- **PROVIDER**: Optionomics (sector/correlation context), Alpaca (real position list)
- **CONSUMER**: AEGIS SECTOR/CORRELATION families
- **SAFETY_AUTHORITY**: AEGIS (hard safety)
- **FIRST_PAPER_REQUIRED**: Only materially matters once THETA holds 2+ concurrent positions -- for a single-symbol Paper bootstrap start, this may be acceptable, but must be explicitly governed, not silently assumed
- **AVOIDABLE_OR_LEGITIMATE**: **AVOIDABLE** -- this session's Slice D correlation-research prep (20/60/120-session cohort tooling, explicitly deferred in the prior Slice C/D directive) is the natural research precursor to a real multi-position producer
- **REMEDIATION**: Build real multi-position sector classification + correlation cluster computation
- **OWNER**: Codex (Production AEGIS integration); Claude (research precursor -- correlation cohort tooling, not yet built this session)
- **VERIFICATION_TEST**: A test with 2+ simulated held positions in different/same sectors proving a real, non-proxy `sectorConcentrationPct`/`correlationClusterExposurePct`

### 4. `CONTRACT_NOT_EXECUTABLE` is the single dominant real-session rejection reason -- root cause not yet independently verified against the live Alpaca API

- **FIELD**: `NormalizedOptionContract.executable` / `nonExecutableReason` (`src/theta/option-chain-ingestion.ts:147-160`)
- **STAGE**: Entry brain -- contract ingestion, immediately before candidate lattice construction
- **CURRENT_VALUE_STATE**: Per the real 2026-09-21 forensic (`docs/operations/THETA_R7_LIVE_SESSION_FORENSIC_2026-09-21.md`), `CONTRACT_NOT_EXECUTABLE` was the rejection reason for **3,299 of 3,876** persisted candidate rows in a single real session window -- by far the largest single rejection category (next largest: `DELTA_OUTSIDE_ALL_BANDS` at 416)
- **WHY_UNKNOWN**: Traced to `option-chain-ingestion.ts:154`: `if (contract.multiplier === null) { ...executable: false... }`. `contract.multiplier` originates at `alpaca-provider.ts:337`: `multiplier: asNumberOrNull(c.size)`, reading the real Alpaca `/v2/options/contracts` response field `size`.
- **PRODUCER_EXPECTED**: A real, correctly-mapped per-contract multiplier from Alpaca's option-contracts endpoint (nearly always `100` for standard US equity options).
- **PRODUCER_ACTUAL**: `asNumberOrNull(c.size)` -- **not independently verified this pass** against a live Alpaca response, because this research environment has no connected Alpaca MCP/API access (only Optionomics is connected here; Alpaca execution/data access is Codex's domain). Two competing explanations are both plausible from the code alone and are NOT distinguished by this ledger:
  1. **PROVIDER_MAPPING_DEFECT**: Alpaca reliably returns `size` for essentially every listed contract, and the mapping/field name is subtly wrong (e.g. a different real field name, a nested location, or a type Alpaca returns that `asNumberOrNull` does not parse), causing a large fraction of genuinely executable contracts to be wrongly marked non-executable.
  2. **PROVIDER_INCAPABLE / real session correlation**: The 3,299 count reflects the SAME real session in which Aiven write availability failed and the worker reported repeated `HTTP_503`/`RUNTIME_BROKER_CYCLE` errors (per the same forensic) -- it is possible a large share of `size`-null contracts correlates with degraded/incomplete Alpaca responses during that specific window, not a permanent mapping defect.
- **PROVIDER**: Alpaca
- **CONSUMER**: `new-risk-orchestrator.ts:405-430` -- excludes every non-executable contract from the candidate lattice entirely, before AEGIS or economics are ever computed
- **SAFETY_AUTHORITY**: Not a safety gate -- a data-completeness gate (correctly conservative: never fabricates a `100`-share assumption for capital/premium math)
- **FIRST_PAPER_REQUIRED**: YES -- this is the single largest observed real-session bottleneck between "3,876 real candidates evaluated" and "0 candidates selected with positive quantity"
- **VPS_REQUIRED**: YES
- **AVOIDABLE_OR_LEGITIMATE**: **UNDETERMINED -- HIGHEST-PRIORITY OPEN QUESTION IN THIS LEDGER.** Do not report this as closed either way without a real, live Alpaca `/v2/options/contracts` response sample examined directly.
- **REMEDIATION**: See `THETA_CONTRACT_NOT_EXECUTABLE_INVESTIGATION.md` for the full, refined analysis. Key update: the real executability gate has **10 independent conditions** (not just the multiplier check), and the single most likely dominant cause is contracts that were simply never quoted at all in a wide-lattice scan (4 of the 10 conditions fail simultaneously for an unquoted contract) -- not a multiplier mapping defect specifically. Critically, **Codex does not need a fresh live Alpaca pull to resolve this first**: the granular per-candidate rejection reason (`reasons[].detail`) is already preserved in the persisted shadow evidence for the 2026-09-21 session (`new-risk-orchestrator.ts:709`) -- a `GROUP BY` on that existing data, once Aiven writes are readable again, answers this without any new provider call.
- **OWNER**: Codex (has real Alpaca credentials, Aiven forensic context, and the persisted shadow-evidence rows this research branch does not)
- **VERIFICATION_TEST**: See the dedicated investigation doc's two-step verification request (persisted-data breakdown first, live Alpaca sample second)

### 5. AEGIS SYSTEM-family AND LIQUIDITY-family gap is worse than "never reaches a state" -- it forces `new_risk_state` to `HOLD_ONLY` (or worse) EVERY CYCLE, unconditionally, blocking ALL new-risk actions

- **FIELD**: `_system()` (`bots/theta/quant/models/aegis.py:155-166`) AND `_liquidity()` (`:129-135`) -- **two separate families, both driven by the same missing `stressSpreadWideningDetected` producer**, confirmed via a direct line-by-line read this pass (not merely a fork summary)
- **STAGE**: AEGIS final assessment (`assess_aegis()`'s `_worse()` worst-family-wins fold)
- **CURRENT_VALUE_STATE**: `_liquidity()`: `stress_spread_widening_detected is None` -> `HOLD_ONLY`, unconditionally (confirmed always the case in Production). `_system()`: ANY of its 3 stress inputs being `None` -> `HOLD_ONLY` (2 of 3 are always `None` in Production). Since `assess_aegis()` takes the STRICTEST state across every family, **`new_risk_state` is provably `HOLD_ONLY` or worse on every real Production AEGIS evaluation today**, and `_NEW_RISK_ACTIONS_BY_STATE[HOLD_ONLY] = frozenset()` -- confirmed by direct read of the exact dict literal. This is not "this family is unevaluated" -- it is "new-risk-opening is unconditionally impossible," independent of every other family's real state, independent of `CONTRACT_NOT_EXECUTABLE`. Exit supremacy (CLOSE/CANCEL/RECONCILE) is real and unaffected.
- **WHY_UNKNOWN**: Same root cause as item 2 -- no producer for `stressIvShockDetected`/`stressSpreadWideningDetected`.
- **AVOIDABLE_OR_LEGITIMATE**: Same as item 2 (AVOIDABLE in principle, currently honestly represented -- `null`, never false-defaulted) -- this refines the SEVERITY of item 2's consequence from "one restrictive family" to "the entire new-risk decision, unconditionally," it is not a new separate defect.
- **OWNER**: Codex

### 6. `src/providers/capability-registry.ts` already exists as a real module -- relevant prior art, not yet cross-referenced

A Slice 3 fork confirmed this file exists in the real codebase (`src/providers/capability-registry.ts`) and was not previously known to this engagement. It was **not read in depth this pass** -- flagged as directly relevant prior art for this engagement's own `src/research/pre-vps-capability-registry.ts` (Slice 2) and worth reconciling in a future pass rather than maintaining two independent capability inventories long-term.

### 7. `src/customer/`/`src/database/` spot-check: no new avoidable defects found, but not exhaustively read

A Slice 3 fork spot-checked (not exhaustively line-by-line) `src/customer/alpaca-paper-verification.ts`, `src/customer/paper-copy.ts`, `src/customer/customer-store.ts`, and `src/database/legacy-*.ts`. Every `??`/fallback pattern found there was `LEGITIMATE_DEFAULT` (fail-closed-toward-not-eligible on unknown account approval level; `null` correctly preserved distinct from `false` for follower-record-absent cases; row-count `?? 0` idioms in migration/forensic tooling). **No new avoidable defects found in this surface**, but `src/customer/copy-engine-contract.ts`, `src/customer/operator-readiness.ts`, and the full `src/worker/resident-worker.ts` were NOT read in detail this pass -- flagged as remaining scope, not cleared.

## Confirmed LEGITIMATE unknowns (correctly represented, not a defect)

These are cited as positive reference patterns -- the discipline they show is
what the rest of the codebase should be checked against, per directive item 5
(hard-required vs. optional evidence).

- **`sizingEvidenceUnknown` / `globalWaitEarned` gating** (`canonical-strategy-frontier.ts:525-532`, and the real fix in commit `bf6d80e` "distinguish unknown sizing from earned global wait", confirmed present on current `main`): a risk-feasible candidate with zero quantity **solely because a required sizing input (e.g. AEGIS) is unknown** is now classified `SYSTEM_HOLD` with an explicit `CANDIDATE_SIZING_EVIDENCE_UNKNOWN` reason, distinct from a genuinely earned `GLOBAL_WAIT`. This is the correct governing pattern: an incomplete evaluation must never look like an economic WAIT decision. **Confirmed on `main` but per the same forensic doc, not yet active in the currently pinned/deployed worker release** -- a real, already-fixed-but-not-yet-deployed gap, tracked as a Codex deployment item, not a code defect.
- **`whole-chain-component-evidence.ts` UNKNOWN stock-share fields**: `status !== 'UNKNOWN' && (value ?? 0) > 0` -- status is checked BEFORE the value is ever used in a comparison. Real, wired, correctly governed.
- **`management-input-state.ts` fee UNKNOWN handling**: an explicit `unknown_fill_fees` boolean flag is checked first; `fees` only defaults to a real known `0` when fees are genuinely known-zero, never as a coercion of missing data.
- **`empiricalUtilityState: 'UNKNOWN_NOT_YET_CALIBRATED'`** (`canonical-strategy-frontier.ts:542`): honestly hardcoded as not-yet-calibrated since no calibration has ever been attempted in-repo -- correctly `EMPIRICAL_UNPROVEN`, not a wiring defect, and correctly never faked as a real calibrated figure.
- **No `||` (falsy-coercing) false-safe defaults, and no silent `catch -> []/false/0` patterns found** anywhere sampled in `src/theta/` or `src/execution/` this pass (see the companion false-safe scan section below) -- every default observed used `??` (null/undefined-only coalescing) and every sampled `catch` block either re-threw, rolled back and re-threw, or produced a typed failure classification.

## Companion: static false-safe / false-risk scan (directive item 13, Production paths)

Scope this pass: `src/theta/**/*.ts`, `src/execution/**/*.ts` (Codex-owned,
Production-critical). `src/research/` and the Python quant layer were **not**
scanned this pass -- deferred.

**Result: no `UNSAFE_FALSE_SAFE`, `UNSAFE_TRUE_SAFE`, `UNSAFE_ZERO_SAFE`, or
`PROVIDER_ERROR_MASKING` instances were found in the sampled surface.** This
is a genuinely positive finding, not a clean bill of health for the whole
repository -- it covers `??`/`||`/`catch` patterns across roughly 200 files in
the two scanned directories, not an exhaustive line-by-line review.

Representative `LEGITIMATE_DEFAULT` findings (full detail in the fork
transcript, summarized here):

| File:Line | Pattern | Classification | Why |
| --- | --- | --- | --- |
| `canonical-strategy-frontier.ts:541` | `structuralSelection?.sizing.quantity ?? 0` | LEGITIMATE_DEFAULT | `0` means "no candidate structurally selected" -- matches the standing "quantity zero is a valid outcome" rule, not an unknown-evidence coercion |
| `cross-symbol-economic-frontier.ts:157-158` | `paretoEntry?.survivesFrontier ?? false` | LEGITIMATE_DEFAULT (borderline) | `paretoEntry` should always exist for every candidate; a fail-closed default if it were ever absent. Flagged to Codex as worth a defensive assertion/log, not a defect. |
| `management-input-state.ts:185` | `unknown_fill_fees === true ? null : numeric(row.fees) ?? 0` | LEGITIMATE_DEFAULT | UNKNOWN checked first and preserved separately; `0` only used for genuinely known-zero fees |
| `paper-bootstrap-management-policy.ts:797` | `nearExhaustedExecutableFractionThreshold ?? 0.10` | LEGITIMATE_DEFAULT | Versioned, documented, caller-overridable policy default (already hardened in an earlier pass of this engagement) |

## Counts (Slice 1 + Slice 3 combined)

- **AVOIDABLE_UNKNOWN_COUNT**: 4 confirmed (items 1, 2/5 combined as one root cause, 3, 6/7 surfaced no new defects so don't add to this count), plus **1 undetermined high-priority item (item 4)** that could be either avoidable (mapping defect) or legitimate (provider/session-transient) -- resolving item 4 is the single highest-leverage next step.
- **LEGITIMATE_UNKNOWN_COUNT**: 4 confirmed well-governed patterns cited above, plus the `src/customer/`/`src/database/` spot-check findings (item 7) -- not exhaustive.
- **NOT_APPLICABLE_COUNT**: 1 (`theta-shadow-once.ts`'s dev-only hardcoded AEGIS fixture)
- **PROVIDER_LIMITED_COUNT**: 0 confirmed this pass (item 4 may resolve to this category, or may not -- undetermined)
- **TOTAL_DECISION_CRITICAL_UNKNOWN_STATES entered this pass**: 7 (items 1-7)

This ledger will be extended, not restarted, as further slices of the pre-VPS
audit are completed. Full whole-repo exhaustiveness (every file in every
directory, line-by-line) has still not been attempted and should not be
assumed from this document's coverage.
