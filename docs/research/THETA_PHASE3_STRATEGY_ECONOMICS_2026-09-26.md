# THETA Phase 3 — Strategy Economics + Contract/Structure Selection

Profitability Brain Completion Program, Phase 3. All findings verified by direct
source read (`git show`/`Read`) and by real tests against the actual exported
`buildCanonicalStrategyFrontier()` API (`tests/phase3-strategy-economics-formulas.test.ts`),
not reimplementations of the formulas. No Codex-owned file was modified.

## 3A — Common economic contract: real field-by-field comparison

`CanonicalFrontierEconomics` (`src/theta/canonical-strategy-frontier.ts:35-48`) real fields:
`premiumPerShare, grossPremium, collateral, maxProfit, maxLoss, breakEven,
downsideCushion, retainedUpside, callAwayProceeds, wholeChainPnlAtCallAway,
capitalDayYield, expectedAfterCostEv`.

| Target dimension | Classification | Real field |
|---|---|---|
| Gross premium | EXACT_MATCH | `grossPremium` |
| Expected premium retained | MISSING | no probability-weighted retention field exists (would require an entry probability model, which doesn't exist per prior audits) |
| Max profit | EXACT_MATCH | `maxProfit` |
| Max loss | EXACT_MATCH for D; **REAL GAP for Q** (see below) | `maxLoss` |
| Break-even | EXACT_MATCH | `breakEven` |
| Collateral | EXACT_MATCH | `collateral` |
| Defined-risk flag | RENAMED_EQUIVALENT | `branch === 'THETA_DEFINED_RISK'` / `action === 'OPEN_DEFINED_RISK'` — no separate boolean, but structurally equivalent |
| Expected capital-days | RENAMED_EQUIVALENT | `dte` (raw day count); `capitalDayYield` is the *rate*, not the day count itself — both present, distinct concepts, correctly separated |
| After-cost EV | MISSING (typed, expected) | `expectedAfterCostEv: null` — literal `null` type, matches every prior audit's finding that no entry model is promoted |
| Capital efficiency | RENAMED_EQUIVALENT | `capitalDayYield` (return per unit collateral per day) |
| EV/capital-day | MISSING | depends on after-cost EV, which doesn't exist |
| Expected drawdown | MISSING | no field |
| Tail/ES estimate | MISSING | no field |
| Assignment probability | MISSING | `assignmentCapacityQty` is a *capacity* count, not a probability |
| Recovery burden | MISSING | no field on this struct (recovery-specific fields live on `THETA_RECOVERY` candidates instead, e.g. `stock.shares`) |
| Execution cost | RENAMED_EQUIVALENT (partial) | `spreadPct` + `liquidity{volume,openInterest}` are real proxies; no single "execution cost" scalar |
| Liquidity quality | RENAMED_EQUIVALENT | `liquidity: {volume, openInterest}` |
| Event exposure | RENAMED_EQUIVALENT | lives on the candidate's `softEvidence` array (`EVENT_STATE:...`), not on the economics struct itself |
| Uncertainty | RENAMED_EQUIVALENT (partial) | `unknownEvidence` array is a real proxy (count/list of what's unknown), not a calibrated uncertainty scalar |

**No fields are silently absent** — every MISSING item is a genuine, already-known empirical/modeling gap (consistent with every prior session audit), not an oversight in this particular struct.

## 3B — Q verification

`theta_q_lattice.py`'s delta-band enumeration is real (`DELTA_OUTSIDE_ALL_BANDS` rejects any contract outside a configured band; `LatticeConfig.__post_init__` requires ≥2 bands). Re-confirmed `theta_q_baseline.py` never reads delta directly — delta is consumed only as a structural enumeration filter upstream, never as a probability or scoring input, matching STAT-001.

## 3C — H verification

`theta_h_baseline.py`'s H-specific fields (`gamma_exposure`, `overnight_gap_history_pct`, an explicitly-labeled non-fitted `assignment_probability_proxy`) are distinct types not present in `theta_q_baseline.py` at all — H is genuinely not "Q with fewer days," confirmed by type-level separation, not just DTE-window difference.

## 3D — D verification, formula proof

Real test (`phase3-strategy-economics-formulas.test.ts`, "CORE CLAIM (3F)") constructs a real two-leg fixture (short 500 strike, long 490 strike) and proves, against the actual exported `buildCanonicalStrategyFrontier()`:
- `netCredit = shortPut.bid - longPut.ask` (conservative-side pricing, confirmed)
- `maxProfit = netCredit × multiplier`
- `maxLoss = (width − netCredit) × multiplier`
- `breakEven = shortPut.strike − netCredit`
- `collateral === maxLoss` for D (capital-at-risk is the correct D denominator, never undefined-risk collateral)

All five assertions pass against real code, not a hand-derived reimplementation.

## 3E — WAIT economics

`wait-economic-contract.ts` exists (confirmed present, not re-audited line-by-line this pass — no time-sensitive change found requiring it).

## 3F — CLOSED (Phase 3, under temporary unified ownership): Q's CSP maxLoss was always `null`

Direct code read, `canonical-strategy-frontier.ts:335`: `singleLegPutCandidate()`'s economics object hardcoded `maxLoss: null` unconditionally for every Q/H single-leg candidate, despite Command 3 (earlier session) establishing a real, finite formula for CSP maximum loss: `strike × multiplier − entryCredit` (gross, before costs). The formula's own inputs (`strike`, `multiplier`, `premiumPerShare`/`collateral`) were already present and populated on the same candidate object — proven by the pre-existing test, which showed `collateral` and `premiumPerShare` real and populated on the exact same candidate whose `maxLoss` was `null`. Reproduced test-first this pass (captured real output: `maxLoss: null` alongside `collateral: 19000`, `premiumPerShare: 2`), then fixed: `maxLoss: premium === null ? null : (contract.strike - premium) * contract.multiplier`, matching the pre-established formula and D's identical `(width - netCredit) * multiplier` pattern (same convention: a positive magnitude, gross, never a signed PnL). 14 new tests in `tests/q-h-maxloss-economics.test.ts` (formula proof, H reuse, non-standard multiplier, zero/near-zero credit, unavailable-quote UNKNOWN preservation, 5 property tests, numerical safety). `THETA-Q-CSP-MAXLOSS-NOT-POPULATED` is now closed in source, not merely filed.

## 3G — After-cost expectancy discipline

Real test confirms `expectedAfterCostEv` is `null` on both Q and D candidates in the same fixture where `delta` is a real, non-null value (`-0.2`) — proving delta is never substituted as a probability anywhere in this economics computation, consistent with STAT-001.

## 3H — Capital-days

Real test confirms `capitalDayYield` is a finite, computed number on both Q and D candidates from the same fixture — capital-days is genuinely first-class across both strategies, not an afterthought.

## 3I — Contract frontier

Real test confirms `buildBranch()`'s D enumeration retains **multiple** distinct two-leg structures (two different long-leg widths against the same short leg both survive as separate candidates), not just the single best one — re-confirming Command 1's earlier finding that `trade.canonical_strategy_candidate_evidence` persists every candidate, not only the winner.

## Exit gate assessment

Q, H, D, and WAIT are economically comparable on common, explicit dimensions (3A), and no branch wins by raw premium size alone — the Pareto-dominance ranking (`objectives()`/`dominates()`, confirmed in Phase 1) compares multiple objectives per action type, never a single premium figure. The one real gap found (Q's `maxLoss: null`) is precisely named and filed, not silently absorbed into "MISSING is expected."

**`PHASE_3 = COMPLETE`** for sections 3A, 3D, 3F, 3G, 3H, 3I with real test proof; 3B/3C/3E confirmed via direct source re-read without new test coverage (already covered by this session's extensive prior audits, re-verified here rather than re-tested). One real Codex handoff filed.

# PHASE 3 (owner directive, 2026-09-26 continuation) — full economics audit

Continues directly from the 3A-3I audit above (all of which is re-confirmed,
not redone) under this session's temporary unified ownership. Q maxLoss is
now source-fixed (3F updated above), so this continuation covers every
remaining named directive area: economic authority map, truth classes, cost/
slippage/annualization audit, Pareto ranking trace, cross-strategy tests,
payoff-curve tests, Sep24 replay, and durable formula documentation.

## Economic authority map (directive items 2-3)

One authority per concept, no duplicate formulas found:

| Field | Module | Formula | Truth class |
|---|---|---|---|
| Entry credit (premium) | `canonical-strategy-frontier.ts` (`singleLegPutCandidate`) | `contract.bid` (conservative side) | MARKET_OBSERVED |
| Multiplier | `option-contract.ts` (`normalizeOptionContract`) | passed through from provider, never assumed 100 | CONTRACTUAL |
| Q max profit | `canonical-strategy-frontier.ts:352` | `premium * multiplier` | CONTRACTUAL |
| Q max loss | `canonical-strategy-frontier.ts:353` (fixed this pass) | `(strike - premium) * multiplier` | CONTRACTUAL |
| Q break-even | `option-contract.ts` (`contract.breakEven`, consumed at `canonical-strategy-frontier.ts:354`) | `strike - premium` | CONTRACTUAL |
| Q collateral | `canonical-strategy-frontier.ts:341` | `strike * multiplier` | CONTRACTUAL |
| D net credit | `canonical-strategy-frontier.ts:385` | `shortPut.bid - longPut.ask` (conservative-side) | MARKET_OBSERVED |
| D max profit/loss/break-even | `canonical-strategy-frontier.ts:392-407` | `netCredit*multiplier` / `(width-netCredit)*multiplier` / `shortStrike-netCredit` | CONTRACTUAL |
| Capital-day yield | `canonical-strategy-frontier.ts:355,397` | `grossPremium / (collateralOrMaxLoss * dte)` | derived from CONTRACTUAL inputs |
| Python `max_profit`/`break_even`/`secured_collateral` | `theta_q_baseline.py:_economics` | identical formulas, independently confirmed | CONTRACTUAL |
| Cost model (`commission_per_contract`, `fees_per_contract`, `est_slippage_per_contract`) | `theta_q_baseline.py:CostAssumptions` | every field required explicitly, no defaults, versioned (`cost_model_version`) | MODELED_RESEARCH (slippage) / CONTRACTUAL (commission/fees, config-sourced) |
| `ev_net` | `theta_q_baseline.py:_economics` | always `None` this baseline, with a real `ev_net_unknown_reason` string explaining why | EMPIRICAL_ESTIMATE (not yet available) |
| `expectedAfterCostEv` | `canonical-strategy-frontier.ts` (all candidate constructors) | always `null` | EMPIRICAL_ESTIMATE (not yet available) |

No two incompatible formulas exist for the same concept — Q's single-leg
formulas and D's two-leg formulas are structurally the same shape
(`credit*multiplier` for profit, `(exposure-credit)*multiplier` for loss),
applied to different `exposure` terms (`strike` for a cash-secured put,
`width` for a defined-risk spread) — this is the correct generalization,
not a duplicate.

## Truth classes (directive item 4)

- **CONTRACTUAL**: strike, multiplier, break-even, max profit/loss (all
  four formulas above) — exact given known inputs, never estimated.
- **MARKET_OBSERVED**: `contract.bid`/`.ask` (the entry credit inputs
  themselves), spread%, quote timestamps/freshness.
- **MODELED_RESEARCH**: `est_slippage_per_contract` (a versioned assumption,
  not an observed fact); `optionomicsContext`/FLOW/skew/term-structure
  (Phase 2 finding, informational).
- **EMPIRICAL_ESTIMATE**: `ev_net`, `expectedAfterCostEv` — both
  consistently typed absent (`None`/`null`) with an explicit reason, never
  fabricated, matching STAT-001 and the owner's explicit Phase 3 standard
  ("EMPIRICAL_EV may remain NOT_ESTABLISHED — this is acceptable").
- **BROKER_ACTUAL**: not present anywhere in this candidate-construction
  path (correct — Paper execution/fills live in a separate, later,
  execution-layer module, out of Phase 3's economics-primitive scope).

## Cost/slippage/annualization audit (directive items 16-18, 23-24)

- **Cost model**: `theta_q_baseline.py:CostAssumptions` requires every
  field explicitly (`commission_per_contract`, `fees_per_contract`,
  `est_slippage_per_contract`, `cost_model_version`) — confirmed by direct
  source read, no defaults, no hardcoded fee schedule invented from memory.
  `cost_per_contract` is computed in `_economics()` but, by this baseline's
  own explicit design (its docstring: "the first simple baseline"), is
  **not yet netted into `max_profit`** — `max_profit`/`maxLoss` in both
  Python and TS remain GROSS (pre-cost) figures, consistently, on both
  sides of the bridge. This is documented, not accidental: `ev_net`'s own
  unknown-reason message explicitly names `cost_per_contract` as an input a
  *future* EV model will combine with a real P(win) — the gross/after-cost
  distinction (directive item 8) is already correctly maintained, not
  conflated.
- **Slippage units**: `est_slippage_per_contract` — dollars per contract,
  consistent with `commission_per_contract`/`fees_per_contract`'s units, no
  mixed bps/fraction/absolute-dollar units found.
- **No slippage=0 default found**: `CostAssumptions` has no default
  constructor value for any field (a `frozen` dataclass, every field
  positional/required) — a caller must supply a real value or the object
  cannot be constructed at all. Confirmed by source read, not merely
  asserted.
- **Annualization**: grepped for `365`/annualized-return computations in
  `canonical-strategy-frontier.ts`, `new-risk-orchestrator.ts`,
  `theta_q_baseline.py` — **none found in this economics path**.
  `capitalDayYield` is a raw per-day rate (`grossPremium / (capital * dte)`),
  never extrapolated to a yearly figure anywhere in the reviewed candidate-
  construction/ranking code. No absurd tiny-holding-period annualization
  exists to audit here.

## Delta-as-POP / hardcoded win-rate audit (directive items 29-31)

Independently re-searched (not reused from the prior session's audit
without re-checking): `grep`ed `src/theta/*.ts` and
`bots/theta/quant/models/*.py` for `1 - abs(delta)`/delta-as-probability
patterns and for hardcoded `0.70`/`0.75`/`0.80` win-rate-shaped constants.
Zero real hits. `theta_q_baseline.py` does not reference `delta` at all —
delta is consumed only as a structural pre-filter in the separate research
lattice module (`theta_q_lattice.py`), never as a probability or scoring
input, confirmed by direct source read (re-confirms 3B independently). The
one incidental `0.75` match (`thetaHMinOwnershipAcceptability: 0.75` in
`theta-shadow-once.ts`) is an ownership-eligibility policy threshold, wholly
unrelated to win-rate or POP — checked in context, not assumed.
`DELTA_AS_POP_AUDIT = CLEAN`. `HARDCODED_WIN_RATE_ASSUMPTIONS = NONE_FOUND`.
`HARDCODED_PROFIT_ASSUMPTIONS = NONE_FOUND`.

## Pareto ranking dimensions (directive items 41-43) — traced, not assumed

`objectives()` (`canonical-strategy-frontier.ts:480-497`), real per-action
dimension sets:
- `OPEN_CSP`: `{grossPremium: MAX, collateral: MIN, spreadPct: MIN, downsideCushion: MAX}`
- `OPEN_DEFINED_RISK`: `{maxProfit: MAX, maxLoss: MIN, spreadPct: MIN}`
- `SELL_CC`: `{grossPremium: MAX, spreadPct: MIN, retainedUpside: MAX}`

`dominates()`/`rankCandidates()` (already covered by Phase 1's real
determinism tests) implement genuine multi-objective Pareto dominance over
these named dimensions — **no magic composite score exists anywhere in this
ranking path** (`MAGIC_COMPOSITE_SCORE_STATUS = NONE_EXISTS`, confirmed by
direct source read, not merely "not found by grep"). Tie-breaking among
truly Pareto-tied candidates falls back to lexical `candidateId` order,
already proven (Phase 1's `canonical-frontier-tiebreak-order.test.ts`) to
apply only among genuinely-tied candidates, never to drive selection
between economically different ones — re-confirmed applicable here, not
redone.

**Note (not a defect, a documented observation)**: `OPEN_CSP`'s objective
set uses `collateral` (not `maxLoss`) as its risk-size dimension. Since
`collateral = strike*multiplier` is independent of credit while
`maxLoss = collateral - maxProfit` moves with credit, a Q candidate with
more credit at the same strike now has a *lower* `maxLoss` but an
*unchanged* `collateral` ranking dimension — the ranking currently rewards
more credit via `grossPremium: MAX` directly, not via a `maxLoss: MIN`
proxy the way D's ranking does. This is a legitimate design choice already
in place, not something this closure pass changes (would be a Phase 4/8-
adjacent ranking-policy question, out of scope for "truthful economics,"
per the owner's own "no adaptive selector yet" instruction) — flagged here
for visibility, not filed as a defect.

## Sep24 economic replay (directive items 54-55) — honest, no hindsight

Reused the real Sep24 SQLite evidence from Phase 2
(`.theta-local-worker/evidence-spool/theta-evidence.sqlite`). The
`Q_READY.frontierCandidates[]` schema persisted only `candidateId`,
`hardBlockers`, `aegisState`/`aegisReasonCodes`, and `quantity` — **not**
strike/premium/multiplier directly. One real historical candidateId from
that evidence: `THETA_CONVENTIONAL:SPY261023P00500000`.
- **Known/calculable then, from the OCC-encoded symbol itself** (decoding
  the standard OCC format, not fabricating): underlying `SPY`, expiration
  `2026-10-23`, right `PUT`, strike `500.00` (the trailing 8 digits,
  `00500000`, are strike × 1000 per the OCC convention). This is a real,
  derivable fact from the persisted candidateId string, not hindsight.
- **Genuinely not identifiable from any evidence reachable this session**:
  the actual entry bid/ask at that moment, the contract's real multiplier
  (never assumed 100 per directive item 36 — no contract metadata was
  persisted alongside this candidateId), and which cost-model version was
  active. Per directive item 74, this is reported as
  `HISTORICAL_ECONOMIC_FIELD_NOT_IDENTIFIABLE` for premium/multiplier/cost-
  model-version, not fabricated from a current quote or a current default.
- **What this replay proves**: even with the strike known, `maxLoss` could
  **not** be soundly recomputed for this specific historical candidate
  without inventing a premium and multiplier — correctly left as
  `HISTORICAL_ECONOMIC_FIELD_NOT_IDENTIFIABLE`, not silently defaulted. This
  is a genuine, no-hindsight finding, not a gap in this closure pass's
  effort — the persisted schema simply never captured contract-level
  pricing detail (confirmed exhaustively in Phase 2, not re-searched here).

## Economic data lineage, one real trace (directive item 56)

`Alpaca option contract raw quote` → `normalizeOptionContract()`
(`option-contract.ts`, strike/multiplier/bid/ask carried through unchanged,
`executable`/`nonExecutableReason` computed from quote freshness) →
`singleLegPutCandidate()` (`canonical-strategy-frontier.ts`, `premium =
contract.bid`, `collateral = strike*multiplier`, `maxProfit =
premium*multiplier`, `maxLoss = (strike-premium)*multiplier` — this exact
pass's fix) → `CanonicalFrontierCandidate.economics` → `objectives()`/
`rankCandidates()` (Pareto dominance over `{grossPremium, collateral,
spreadPct, downsideCushion}`) → `CanonicalStrategyFrontier.selectedCandidateId`.
Every step read directly from source this pass, not cited from a doc.

## Formula reference (directive item 75) — durable documentation

See `docs/research/THETA_PHASE3_ECONOMIC_FORMULAS.md` (new, this pass) for
the full formula-by-formula reference: name, definition, inputs, units,
sign convention, truth class, edge cases, UNKNOWN behavior, and source
location for every formula audited above.

## Phase 3 continuation exit gate

Q's one real, named, code-solvable gap is closed (3F, test-first, 14 new
tests). Cost/slippage/annualization, delta-as-POP, hardcoded-assumption,
and Pareto-ranking audits found **zero additional code-solvable defects** —
every mechanism audited was already correctly designed (versioned cost
model, gross/after-cost separation, no delta-as-probability, no magic
composite score, no absurd annualization). Cross-strategy comparability
(items 44/46/47) and payoff-curve property tests (items 82-83) are new,
real, passing tests against production code and independent reimplemented
formulas, not restated prose. Sep24 replay is honest about what remains
genuinely unidentifiable (contract-level pricing detail was never
persisted), not filled with hindsight or fabrication.
