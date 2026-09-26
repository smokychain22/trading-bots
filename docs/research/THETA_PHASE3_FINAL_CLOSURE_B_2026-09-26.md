# THETA Phase 3 Final Closure B (2026-09-26)

Continues from accepted head `d4093365d14393e25cd865b3c0cb7fdcacb13dc3`.
Closes the specific semantic gaps the owner named as still-open in that
receipt (items marked "not re-audited"/"not separately tested"/"out of
scope"). No strategy redesign, no AEGIS/sizing policy work, no Phase 4.

## A. Per-share / per-contract / position-total — closed with a real, reusable helper

Traced every `CanonicalFrontierEconomics` formula: **every monetary field
is per-contract**, confirmed by source read — none multiply by
`sizing.quantity`. This was previously implicit. New module
`src/theta/candidate-position-economics.ts`:

- `computeCandidatePositionEconomics(candidate, quantity)` — the one
  canonical place a quantity is applied. Scales `grossPremium`,
  `collateral`, `maxProfit`, `maxLoss`; leaves `breakEven` (a per-share
  price) and `capitalDayYield` (a rate) untouched. Validates `quantity`
  independently (finite, integer, non-negative) — negative/non-integer/
  NaN/Infinity all fail closed with a named `invalidReason`, never
  silently rounded or coerced.
- A parallel, heavier research module already existed
  (`defined-risk-vs-csp-economics.ts`, paired D-vs-CSP comparison, its own
  OCC-reparsing/validity machinery) — deliberately **not** duplicated:
  different purpose (a comparison record, not a general adapter), different
  input shape (not a real `CanonicalFrontierCandidate`). Both apply the
  identical scaling rule to different real inputs — no duplicate formula.
- 12 tests (`tests/candidate-position-economics.test.ts`): quantity matrix
  (0/1/2/5), doubling-quantity property test, quantity=0 real-zero (not an
  ambiguous null), invalid-quantity matrix, UNKNOWN-per-contract-stays-
  UNKNOWN, numerical safety, D and H position scaling (items 40-41).

## B. Assignment entry economics — corrected scope (was wrongly marked out-of-scope)

The prior receipt's `ASSIGNMENT_ECONOMICS = out of Phase 3 scope per item
88` conflated two different things: Phase 3 correctly does not model
assignment *probability* or optimize Recovery — but it should expose the
deterministic *contractual consequence if assigned*. Added
`computeShortPutAssignmentEntryExposure()` in the same new module:

- `assignedShareCount = multiplier * quantity` — never assumes 100.
- `assignmentCashRequirement = strike * multiplier * quantity`.
- `effectiveAssignedBasisPerShare = strike - premiumPerShare` — documented
  as identical to the candidate's own `breakEven` (a relationship, not a
  duplicate independent formula; tested).
- A non-`STANDARD_EQUITY` (`ADJUSTED`/`UNKNOWN`) deliverable classification
  fails closed to `null` rather than naively applying the formula.
- 4 tests cover standard multiplier, nonstandard known multiplier, adjusted/
  unknown deliverable fail-closed, and invalid-quantity fail-closed.
- No assignment probability, tail/ES, or recovery burden is modeled —
  correctly remains genuine `UNKNOWN`, per item 37.

## C. Cost model lineage — real gap found and closed at the safe layer

Traced `CostAssumptions` (Python) → `_economics()` → `CandidateEconomics` →
`theta-q-contract.ts` → `new-risk-orchestrator.ts` → canonical frontier.
**Real finding**: the versioned cost model (`commission_per_contract`,
`fees_per_contract`, `est_slippage_per_contract`, `cost_model_version`) was
computed in Python but **only ever embedded as a free-text fragment inside
`ev_net_unknown_reason`** — never returned as real, structured,
machine-consumable data. Fixed at the safe, contained layer (this is
Claude-owned quant/`bots/theta/quant/` territory, not a Codex-runtime
change):

- `theta_q_baseline.py`: `CandidateEconomics` gains the four fields
  (additive, `max_profit`/`break_even_price` unchanged/still gross);
  `_economics()` populates them from the same `CostAssumptions` already in
  scope. 1 new Python test (`test_cost_model_is_real_structured_data_not_only_a_string_fragment`).
- `theta-q-contract.ts`: `economicsSchema` gains the same four fields,
  **nullable** (not required) — because a real TS consumer
  (`postgres-theta-cycle-store.ts`'s `projectPersistableThetaCandidates`)
  constructs a synthetic economics record for a canonical candidate the
  live Q bridge never evaluated, which genuinely has no cost data; `null`
  is honest there, not a fabricated version string. 2 new tests.
- **Does not reach `canonical-strategy-frontier.ts`** — and this pass
  deliberately does not wire it further. Rationale (directive item 47's own
  explicit permission): `canonical-strategy-frontier.ts` computes its
  economics 100% independently from raw contract data — it has never
  consumed *any* Python-sourced economics field, cost-related or otherwise.
  Wiring cost data into it would mean establishing a wholly new data-flow
  into the canonical frontier that doesn't exist for any field today, which
  is a materially larger, riskier change than "make cost data
  retrievable" — and the canonical frontier's ranking being gross-only is
  already a deliberate, correct architecture (empirical/cost-aware
  selection is explicitly later-phase work). `RANKING_ECONOMICS_BASIS =
  GROSS_PRE_COST`, now made explicit rather than implicit, per item 47's
  fallback instruction.

## D. UNKNOWN EV never becomes zero — proven, not just asserted

3 new tests (`tests/unknown-ev-never-zero.test.ts`):
`expectedAfterCostEv`/`ev_net` are `null` on every candidate type; a JSON
round-trip preserves `null` (never coerces to `0`); a real
`parseThetaQResponse` fixture with `ev_net: null` stays `null` through
parsing, and a filter-based aggregation over multiple candidates correctly
finds zero real numeric values rather than treating the null as `0`.
Additionally **re-confirmed by source trace** that `objectives()`
(Pareto ranking) has no `expectedAfterCostEv`/`ev_net` dimension at all —
EV is never consulted in ranking today, so the null-vs-zero risk cannot
manifest in the live comparison path.

## E. capitalDayYield vs Return-on-Capital — corrected, not just re-labeled in prose

The prior receipt's "capitalDayYield is the real ROC field" was too loose.
Added a genuinely distinct field, `grossReturnOnCollateral =
grossPremium / collateral` (dimensionless, no time basis) to
`CanonicalFrontierEconomics`, alongside the existing `capitalDayYield =
grossPremium / (collateral * dte)` (a rate, per day). Both GROSS (no
after-cost version exists, matching item 47/C above). 1 new test proves
they are numerically distinct and related by the exact division (`dte`),
not two names for the same number. Neither is Return On Capital in the
account-equity sense — both are documented as collateral-relative, not
equity-relative, and neither is annualized (re-confirmed: no `365`/
annualization anywhere in this path, matching the original Phase 3 audit).

## F. Premium capture — audited, correctly NOT_APPLICABLE_AT_ENTRY

Searched `src/` exhaustively for `premiumCapture`/`capturePct`/
`creditCaptured`. Exactly one real hit:
`outcome-resolver.ts`'s `return_metrics_json` SQL builder, where
`premiumCapture` (along with `returnOnSecuredCapital`/`returnOnMaxRisk`/
`annualizedCapitalReturn`) is an explicit, reserved `NULL` slot in a
POST-HOC, resolved-episode outcome-labeling record — a management/exit-
lifecycle concept requiring a close/exit price that does not exist at
entry. `PREMIUM_CAPTURE_STATUS = NOT_APPLICABLE_AT_ENTRY`, correct owner
identified as `outcome-resolver.ts`'s outcome-labeling layer (a later-
phase concern), not fabricated here.

## G. WAIT economics — re-audited line by line, real finding

`wait-economic-contract.ts` (v3, "hardened") is a genuinely mature,
well-designed research module: a real validation function
(`validateWaitEconomicEvidence`, enforcing the counterfactual-provenance
pairing and the capital-reference-chain consistency) and a real projector
(`waitAsComparisonCandidate`) that puts WAIT into the exact same
comparison shape real candidates use. It correctly avoids a fake `$0 EV` —
`expectedAfterCostWholeChainPnl`/`probabilityProfitable` are `null`;
`collateral: 0`/`capitalRequirement: 0` are genuine structural zeros (WAIT
truly commits no capital), never conflated with an EV claim.

**Real finding**: grepped for every consumer of
`waitAsComparisonCandidate`/`WaitEconomicEvidence` across `src/` —
**zero production consumers**. This is exactly the "file exists but no
consumer" pattern the directive warns about. The REAL, actually-consumed
production WAIT mechanism is `canonical-strategy-frontier.ts`'s own
`globalWaitEarned`/`primaryAction === 'GLOBAL_WAIT'` (already extensively
tested in Phase 2's WAIT-taxonomy and false-WAIT-prevention tests) — a
simpler, purely structural "no risk-feasible action exists" signal that
does not carry `wait-economic-contract.ts`'s richer
cash-preserved/capital-days-avoided/assignment-burden-avoided evidence.
`WAIT_REAL_CONSUMER = globalWaitEarned (canonical-strategy-frontier.ts)`;
`wait-economic-contract.ts` classified honestly as `RESEARCH_ONLY /
NO_PRODUCTION_CONSUMER`, not silently assumed wired. 1 new test
(`WAIT VS TRADE`, item 30) proves case A (feasible → real trade) vs case B
(infeasible → real governed `GLOBAL_WAIT`) using the actually-consumed
mechanism, with no fabricated EV either way.

## H. Multiplier / quote lineage — re-confirmed independently

`option-contract.ts`'s raw schema: `multiplier: z.number().finite().positive()`
— required, no `.default()` anywhere in the parser; the normalized value is
passed through unchanged (`multiplier: raw.multiplier`). Re-confirmed by
direct source read this pass (not merely reused from the first Phase 3
pass). `IMPLICIT_100_AUDIT = CLEAN`. Entry-credit quote-side lineage
(bid for a short leg, conservative-side pricing) and D's two-leg quote
freshness handling were already covered exhaustively in the first Phase 3
pass and Phase 2's provider-failure tests — not re-audited a third time
per the directive's own "no need to redo the entire hardcoded-number grep
unless source changed" instruction (source in this area did not change).

## Full verification gate

`tsc --noEmit`: clean. `eslint` (src+tests+public/assets): clean. Full Node
suite: 2813 tests, 2799 pass, 14 pre-existing DB-dependent skips, 0 fail.
Full Python suite: 695 passed (+1 new) + 11 subtests, 0 fail. Manual review
of every changed production file (Python + 3 TS files): no duplicate
formulas, no dead code, no gross/net confusion, no implicit multiplier, no
unknown→zero coercion, no dynamic nondeterminism. Security grep on the full
diff: clean. No orphan Phase-3 processes found (`ps aux`/`jobs -l` clean at
start and end of this pass).

## PHASE_3_STATUS = CLOSED (Final Closure B)

Every named remaining semantic gap (A-H above) is closed with real code,
real tests, or an honest, precisely-scoped audit finding — none left as
"not separately tested"/"out of scope" without a specific, correct reason.
Sep24 historical premium/multiplier remains genuinely
`HISTORICAL_ECONOMIC_FIELD_NOT_IDENTIFIABLE` (evidence source exhausted,
per the directive's own instruction not to re-search it). Phase 4 can now
consume `computeCandidatePositionEconomics`/
`computeShortPutAssignmentEntryExposure` directly rather than re-deriving
any Q/H/D formula.
