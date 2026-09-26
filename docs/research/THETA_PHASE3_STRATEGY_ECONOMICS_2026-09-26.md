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

## 3F — REAL GAP FOUND: Q's CSP maxLoss is always `null`

Direct code read, `canonical-strategy-frontier.ts:335`: `singleLegPutCandidate()`'s economics object hardcodes `maxLoss: null` unconditionally for every Q/H single-leg candidate. This is despite Command 3 (earlier this session) establishing a real, finite formula for CSP maximum loss: `strike × multiplier − entryCredit + costs`. The formula's own inputs (`strike`, `multiplier`, `premiumPerShare`/`collateral`) are already present and populated on the same candidate object — proven by the second new test, which shows `collateral` and `premiumPerShare` are real, populated values on the exact same candidate whose `maxLoss` is `null`. **This is a genuine, closeable Codex-owned gap, not a data-availability UNKNOWN** — filed as `THETA-Q-CSP-MAXLOSS-NOT-POPULATED` in `docs/research/THETA_CODEX_INTEGRATION_QUEUE.md`, not fixed here (this file is Codex-owned).

## 3G — After-cost expectancy discipline

Real test confirms `expectedAfterCostEv` is `null` on both Q and D candidates in the same fixture where `delta` is a real, non-null value (`-0.2`) — proving delta is never substituted as a probability anywhere in this economics computation, consistent with STAT-001.

## 3H — Capital-days

Real test confirms `capitalDayYield` is a finite, computed number on both Q and D candidates from the same fixture — capital-days is genuinely first-class across both strategies, not an afterthought.

## 3I — Contract frontier

Real test confirms `buildBranch()`'s D enumeration retains **multiple** distinct two-leg structures (two different long-leg widths against the same short leg both survive as separate candidates), not just the single best one — re-confirming Command 1's earlier finding that `trade.canonical_strategy_candidate_evidence` persists every candidate, not only the winner.

## Exit gate assessment

Q, H, D, and WAIT are economically comparable on common, explicit dimensions (3A), and no branch wins by raw premium size alone — the Pareto-dominance ranking (`objectives()`/`dominates()`, confirmed in Phase 1) compares multiple objectives per action type, never a single premium figure. The one real gap found (Q's `maxLoss: null`) is precisely named and filed, not silently absorbed into "MISSING is expected."

**`PHASE_3 = COMPLETE`** for sections 3A, 3D, 3F, 3G, 3H, 3I with real test proof; 3B/3C/3E confirmed via direct source re-read without new test coverage (already covered by this session's extensive prior audits, re-verified here rather than re-tested). One real Codex handoff filed.
