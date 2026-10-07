# THETA strategy library, claim registry and gap audit

Status: RESEARCH / SHADOW. Nothing here grants Paper or broker authority. No strategy below is broker-enabled by this
document.

## Current integration truth, 2026-10-08

The gap audit later in this document is retained as a historical baseline from commit `35057dc2`. It is not current
source truth. The controlled integration branch has since closed these source-level gaps without changing Production
authority:

| Capability | Current source truth | Remaining limit |
| --- | --- | --- |
| Q broad economics | `q-economic-funnel.ts` evaluates every structurally eligible put before the bounded finalist set and records excluded economic leaders. | Selection remains shadow until governed evidence supports promotion. |
| Q/H/D independent ranking | `branch-economic-shadow.ts` ranks each branch across strikes and expiries with the shared risk-constrained economics engine. | Expected after-cost EV remains uncalibrated. |
| Q vs D | `canonical-shadow-comparison.ts` compares same-underlying, same-expiration Q/H/D structures on one-lot deterministic economics and preserves WAIT opportunity cost as unknown. | There is no calibrated common-horizon profitability winner. |
| Q management | `management-economics/q-management.ts` compares the configured management alternatives with explicit repricing and costs. | Challenger choice is research-only pending resolved episodes. |
| H management | `management-economics/h-management.ts` adds gamma, move-speed and short-DTE early-warning evidence and preserves the no-roll rule. | Independent outcome evidence is absent. |
| D management | `management-economics/d-management.ts` treats the spread as one two-leg economic position. | Real spread episodes and fill calibration are absent. |
| C opportunity cost | `management-economics/covered-call-utility.ts` can prefer `HOLD_SHARES_NO_CC` when forfeited upside dominates premium. | Utility weights remain shadow and unvalidated. |
| Whole-chain accounting | `management-economics/episode-accounting.ts` keeps Q, assignment, stock, C and exit in one episode. | Real resolved complete-chain sample size is insufficient. |
| Entry price | `management-economics/entry-price-engine.ts` produces non-submittable price bounds from candidate economics. | No Production repricing policy is promoted. |
| Market regime | `strategy-intelligence/market-regime.ts` is attached to every reached decision receipt and archive-persistence tested. | Thresholds are implementation inference, not empirical policy. |
| Edge hypothesis | `strategy-edge-receipt.ts` persists candidate-scoped mechanism, payer, current evidence and falsification rules. | Edge strength and confidence stay null until calibrated outcomes exist. |
| Q replay | `research/q-policy-replay/*` compares current and challenger entry/management policies with PIT-safe costs and walk-forward splits. | The bounded SPY replay is research evidence, not a promotion artifact. |
| Generic orphan recovery | `broker-orphan-position-recovery.ts` is wired into management observation and recognizes persisted Production intent case-insensitively. | Mutation remains governed and Production deployment is separate. |

The named strike and expiry optimization capability is implemented through the branch economic ranking pass over every
candidate combination. Creating a second optimizer with separate math would duplicate authority. The missing item is
empirical promotion of that shared ranker, not another source module.

## Provenance labels

| Label | Meaning |
| --- | --- |
| `OWNER_CURATED_SOURCE_CLAIM` | Stated in the owner's directives ("Professional Options Trader Intelligence Build", "Strategy Brain Rebuild") as a summary of their premium source material. |
| `IMPLEMENTATION_INFERENCE` | Claude's engineering choice. Unvalidated. |
| `MATH_PROVEN` | Reproduced exactly by `src/theta/strategy-intelligence/*` with a test. |
| `EMPIRICALLY_DERIVED` | None yet. Requires point-in-time replay, walk-forward and Paper shadow evidence. |

**The source transcripts themselves are not in this repository or session.** No claim below is labelled
`SOURCE_EXPLICIT`. To complete the source-claim registry (directive item 102), each transcript must be supplied and
processed one by one: strategy, construction, regime, entry, strike, expiry, Greeks, management, adjustments, exits,
"risk-free" wording, examples, and unspecified parameters. Source examples (sample premiums, strikes, PCR or OI levels)
must never become Production thresholds (item 104).

## Shared engines (built in this branch)

| Engine | Module | State |
| --- | --- | --- |
| Payoff + Greeks | `option-payoff.ts` | **MATH_PROVEN**, 9 tests. Covers arbitrary legs with exact multipliers; an exact piecewise-linear expiry profile with unbounded detection and breakevens; calendars and diagonals valued at the front expiry with Black-Scholes back legs (a separate, labelled method); and European BS Greeks recomputable at any spot, IV or elapsed time. |
| No-loss claim evaluator | `no-loss-claims.ts` | **MATH_PROVEN**, 5 tests. Uses 8 typed claims. Path risk is reported separately: 42 mark-to-market scenarios, short American early-assignment exposure, and a cost-adjusted floor. |
| Adjustment / profit lock | `adjustment-proposals.ts` | **MATH_PROVEN**, 5 tests. Adjustments are modelled as close + open, with realized P&L that cannot change afterwards. Every variant gets a leg-direction check, and a naked short call can never be created. The verdict is IMPROVES only against a stated objective and a capital limit. EV is UNKNOWN. |
| MarketRegimeReceipt + forward evidence | `market-regime.ts` | **IMPLEMENTATION_INFERENCE** thresholds (`theta-regime-thresholds-v0-unvalidated`), 7 tests. The forward evaluator is point-in-time by construction, with a tamper test. |
| Strategy economics receipt | `src/theta/strategy-economics.ts` (parent branch) | SHADOW. |

Still incomplete: an empirically qualified IV-rank history, a calibrated expected-move model, and promotion-grade
performance evidence. The current expected-move and volatility inputs remain typed partial evidence where provider or
historical semantics are incomplete.

## Mapping onto existing THETA identities (no duplicate engines)

| Library structure | THETA identity | Rule |
| --- | --- | --- |
| Short put / cash-secured put | **Q** `THETA_CONVENTIONAL` | Source short-put knowledge improves Q first. |
| Short-DTE hold-strike put | **H** `THETA_HOLD_STRIKE` | Separate economics. Production stays NO_ROLL. |
| Bull put credit spread (put credit spread) | **D** `THETA_DEFINED_RISK` | One canonical implementation. Never add a second "PUT_CREDIT_SPREAD" engine. |
| Assignment recovery | **A** `THETA_RECOVERY` | Starts only on broker-confirmed stock. |
| Covered call | **C** `THETA_CC` | Broker-confirmed free shares only. Never a naked call. |
| Protective put | Profit-lock **transformation** (`buildProfitLockProposal`) and future entry | Not a new executor. |
| Everything else | Future, research only | Payoff engine reused. No broker authority. |

## Strategy specifications (template, item 135)

Rows run STRATEGY_ID, then purpose and source claims, then payoff, regime, entry and do-not-enter, then
strike/expiry/Greeks/volatility/liquidity, then capital/AEGIS/sizing, then profit, loss and sideways management,
then adjustments, exit and assignment, then restart, failure modes and backtest, then shadow and authority.

### Q: THETA_CONVENTIONAL (cash-secured put)

| Field | Value |
| --- | --- |
| **Purpose** | A bullish-to-neutral short-volatility thesis with acceptable assignment (`OWNER_CURATED_SOURCE_CLAIM`). |
| **Payoff** | Max profit = credit. Max loss = (strike − credit) × multiplier. Breakeven = strike − credit. Theta positive; vega and gamma negative (`MATH_PROVEN`). |
| **Regime** | Direction from FLAT to STRONG_UP, no strong downside acceleration, supportive geometry. **Do not enter** in STRONG_DOWN, inside an event window, or when IV−RV ≤ 0 (seller gets no variance premium). All three are `IMPLEMENTATION_INFERENCE`, pending validation. |
| **Strike / expiry** | Rank several strikes per eligible expiry (25–60 DTE canonical) on cushion versus support, premium/collateral, stress loss and liquidity. Do not use delta alone. |
| **Capital** | Collateral = strike × exact multiplier. AEGIS and sizing are unchanged. The envelope comes before sizing (allocator branch). |
| **Profit** | Credit-capture levels 25/50/65/75/80% are a research grid, measured on expectancy, capital turnover and tail. |
| **Loss** | Research triggers: delta expansion, support break, breakeven threat, IV shock, premium multiple, event arrival. |
| **Sideways** | Favourable; time decay accrues. |
| **Adjustments** | A roll is close + open (Production policy allows ROLL on Q). A credit-spread conversion (`SHORT_PREMIUM_TO_CREDIT_SPREAD`) is research only. |
| **Exit / assignment** | Existing frontier: CLOSE_FULL, LET_EXPIRE, ACCEPT_ASSIGNMENT, then A. |
| **Failure modes** | Gap through strike; assignment into a falling stock; tiny premium on large collateral (the XLE 57P case). |
| **Backtest / shadow** | Point-in-time chains with bid/ask fills. Comparison is CURRENT_Q versus ECONOMIC_Q. |
| **Authority** | Paper-authorized structure; the improvements are SHADOW. |

### H: THETA_HOLD_STRIKE

| Field | Value |
| --- | --- |
| **Purpose** | A short-DTE (2–5) put held at its strike with no roll. It is not "Q with fewer days" (`OWNER_CURATED_SOURCE_CLAIM`). |
| **Payoff** | Same as a CSP, but with gamma far larger per dollar of premium. Annualized ROC is misleading at 2 DTE. |
| **Regime** | SLOW or COMPRESSED movement (unless the compression sits near a level), no event in the window, contained short-term RV. |
| **Entry metrics** | Distance to strike and breakeven in ATR terms, RV5, gamma per premium dollar, theta per day, near-expiry liquidity. |
| **Management** | Early warning on delta acceleration, distance-to-strike velocity, move speed against ATR, and time to expiry. React before an uncontrolled assignment. |
| **Adjustments** | Production stays NO_ROLL (`hold-strike-lifecycle.ts:12` `rollAllowed:false`). Roll ideas are shadow research only. |
| **Authority** | Paper bootstrap, per-strategy receipt. |

### D: THETA_DEFINED_RISK (bull put credit spread)

| Field | Value |
| --- | --- |
| **Purpose** | The same bullish thesis as Q with defined maximum loss, used when CSP collateral is inefficient. |
| **Payoff** | Max profit = net credit. Max loss = width − credit. Breakeven = short strike − credit. Reward to max loss = credit / (width − credit). `MATH_PROVEN` for both legs. |
| **Ranking fields** | Credit to max loss, cushion, short-leg delta, width, liquidity and slippage on both legs, expected move, stress loss, event. Annualized ROC is never ranked alone: narrow near-the-money spreads produce >1,000% figures. |
| **Q vs D** | Same underlying and thesis, both receipts produced, and the frontier compares already-feasible proposals. |
| **Management** | Whole two-leg position: HOLD, TAKE_PROFIT, FULL_CLOSE, RISK_CLOSE, EXPIRY, ASYMMETRIC_EMERGENCY. A naked fallback is never allowed. |
| **Broker** | Native multi-leg only (mleg). |

### A: THETA_RECOVERY

| Field | Value |
| --- | --- |
| **Purpose** | Recovery of broker-confirmed assigned stock. |
| **Alternatives** | HOLD, SELL_STOCK, SELL_CC, BUY_PROTECTIVE_PUT, DEFINED_RISK_OVERLAY. Each needs the new payoff, additional capital, new max loss and breakeven, and capital-days. Payoff tools: `buildAdjustmentProposal` and `buildProfitLockProposal`. |
| **Basis** | Whole-chain effective basis = stock cost − put premium − call premiums ± closes − fees (`whole-chain-economics.ts:87`, `:136`). |

### C: THETA_CC

| Field | Value |
| --- | --- |
| **Purpose** | Premium on free broker-confirmed shares (owned − committed − pending). |
| **Strike ranking** | Distance above cost basis and above the whole-chain basis, premium yield, call-away probability proxy, forfeited upside, IV, liquidity, ex-dividend and event risk. |
| **Management** | HOLD_CALL, TAKE_PROFIT, BUY_TO_CLOSE, ALLOW_ASSIGNMENT, ROLL (only if canonical policy allows), SELL_STOCK, RECOVERY_WAIT. |

## Future strategy matrix (items 105 and 142; research only, no broker authority)

Columns:
- **Regime** is `OWNER_CURATED_SOURCE_CLAIM`.
- **Max loss** and **max profit** are `MATH_PROVEN` by `option-payoff.ts` tests.
- **Broker** is the broker requirement.
- **Pri** is implementation priority.

| Strategy | Regime | Payoff / legs | Max loss | Max profit | Key Greeks | Bad conditions | Broker | THETA reuse | Pri |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| LONG_CALL | Strong up, fast | +C | Debit | Unbounded | +Δ +Γ −Θ +V | Sideways, IV crush | Single | Payoff, profit lock | 8 |
| LONG_PUT | Strong down, fast | +P | Debit | K − debit | −Δ +Γ −Θ +V | Sideways, IV crush | Single | Payoff | 8 |
| SHORT_CALL | Bear or neutral | −C | **Unbounded** | Credit | −Δ −Γ +Θ −V | Rally | Not authorizable naked; use a call credit spread | Payoff | 10 |
| BULL_CALL_SPREAD | Up, cost-capped | +C(K1) −C(K2) | Debit | Width − debit | +Δ | Down | mleg | Payoff | 7 |
| BEAR_CALL / CALL_CREDIT_SPREAD | Bear or neutral | −C(K1) +C(K2) | Width − credit | Credit | −Δ +Θ | Rally | mleg | Mirror of D | 6 |
| LONG_BUTTERFLY | Range, centre target | 1:−2:1 | Debit | Wing − debit | Γ− near body, +Θ | Breakout | mleg (3 strikes) | Payoff | 9 |
| SHORT_BUTTERFLY | Breakout, direction unknown | −1:+2:−1 | Wing − credit | Credit | +Γ near body | Pin at centre | mleg | Payoff | 9 |
| LONG_STRADDLE | Large move, long vol | +C +P same K | Debit | Unbounded | +Γ +V −Θ | Priced-in event, crush | mleg | Payoff, expected move | 9 |
| SHORT_STRADDLE | Very slow | −C −P | **Unbounded** | Credit | −Γ −V +Θ | Breakout | Research only (wings required) | Payoff | 10 |
| SHORT_STRANGLE | Range, slow | −C(OTM) −P(OTM) | **Unbounded** | Credit | −Γ −V +Θ | Breakout | Research only, converts to a condor | Adjustment planner | 10 |
| IRON_CONDOR | Range, vol contraction | PCS + CCS | max(width) − credit | Credit | −Γ −V +Θ | Trend or breakout | mleg (4 legs) | D + mirror | 5 |
| CALENDAR | Term-structure view | −front +back, same K | ≈ debit (BS-valued) | Model-dependent | +V −Γ near K | Big move, term inversion | mleg, cross-expiry | Payoff (front-expiry method) | 9 |
| DIAGONAL | Term structure + direction | −front K2 +back K1 | Model-dependent | Model-dependent | Mixed | Big adverse move | mleg | Payoff | 9 |
| CALL_BACKSPREAD | Big up move, vol up | −1 C(K1) +2 C(K2) | Valley at K2 | Unbounded | +Γ +V | Pin near K2 | mleg ratio | Payoff, claim evaluator | 9 |
| PUT_BACKSPREAD | Big down move, vol up | −1 P(K1) +2 P(K2) | Valley at K2 | Bounded at spot 0 | +Γ +V | Pin near K2 | mleg ratio | Payoff | 9 |
| PROTECTIVE_PUT | Profit lock or hedge | Stock or long call + P | Bounded | Unbounded | Δ reduced | Repeated hedge cost | Single | Profit-lock builder | 4 (as A/C transformation) |
| COVERED_CALL | Inventory exists | Stock − C | Basis − credit | K − basis + credit | — | — | Existing | **C** | n/a |

## Claim table (items 59–61 and 143). Structures from `OWNER_CURATED_SOURCE_CLAIM`; results `MATH_PROVEN` in tests.

| Claim wording (summary) | Exact construction | Math result | Path risk | Execution risk | Evidence status |
| --- | --- | --- | --- | --- | --- |
| "Lock profit" on a winning long call with a put | Long C100 @2 + long P110 @1.5 (spot 115) | **LOCKED_MINIMUM_PROFIT reproduced**: min expiry P&L +$650 | MTM scenarios reported; floor $646 after $2 per contract cost | Two fills, hedge slippage | MATH_PROVEN; empirical none |
| Convert a winning long call into a spread | Long C100 @2 − C120 @6 (spot 125) | **Reproduced**: floor +$400 | Short call carries early assignment (American) | mleg fill | MATH_PROVEN |
| "Risk-free" credit backspread | −C100 @5 + 2×C110 @2 | ZERO_NET_DEBIT and CREDIT_FINANCED_LONG_VOL **reproduced**; STATIC_NO_LOSS **not**: classified **LOSS_VALLEY_PRESENT** (−$900 at 110), never NO_LOSS | Valley, vega and theta drag | Ratio fill | MATH_PROVEN |
| Delta-hedged long straddle "can't lose locally" | +C +P ATM, residual delta re-hedged | DELTA_HEDGED_LOCAL_RANGE **reproduced** (instantaneous only) | Theta and IV crush are path risks, not covered | Hedge frequency and costs | MATH_PROVEN; gamma-scalp economics unproven |
| Short strangle "made safe" by wings | Strangle to iron condor | LIMITED_LOSS: unbounded becomes **$300** | — | Wing slippage | MATH_PROVEN |
| Losing position into a butterfly | Long C100 + 2×(−C105) + C110 | Floor −$300 becomes **+$240** in fixture (price-dependent) | Early assignment on the shorts | 3-strike fill | MATH_PROVEN only for the stated prices |
| Calendar hedge on a short call | −C100 front + C100 back | Unbounded loss becomes **bounded** | Term-structure inversion, front assignment | Cross-expiry fill | MATH_PROVEN with BS back-leg valuation |
| Margin reduction | Any | **UNDETERMINED**: no broker margin model | — | — | Needs broker requirements |
| Gamma scalping profits | Long gamma + hedging | Not evaluated: needs the research simulator with costs | — | — | Not started |

A non-negative expiry payoff is never a statement about path risk, and path risk never voids a proven expiry floor.

## Historical THETA gap audit at commit `35057dc2` (item 136)

The rows below explain what the integration work fixed. Use the current integration table above and the live call graph
for present truth. Do not reopen a row merely because its historical finding remains recorded here.

Classes: MISSING, PARTIAL, CORRECT, WRONG_WIRING, NOT_APPLICABLE.

| # | Area | Finding | Class | Where |
| --- | --- | --- | --- | --- |
| Q1 | Q shortlist | Five finalists are chosen by structural closeness only: gate failure, capital misfit, delta-band distance, DTE midpoint, spread, quote age, then OCC symbol. Economics is absent. 124 → 4 on the XLE decision. | WRONG_WIRING | `finalist-quote-refresh.ts:190-217`; `theta-shadow-once.ts:182` (`maxFinalists: 5`) |
| Q2 | Q final tie-break | With no calibrated EV, the selection fell to `candidateId.localeCompare` (OCC lexical order). The economic ranking record exists in SHADOW. | WRONG_WIRING (Production) / PARTIAL (shadow) | `decision-assembly.ts:349-356` |
| Q3 | Q Pareto objectives | Gross premium, collateral, spread and cushion are not capital-normalized: no ROC, return per capital-day, reward to stress or IV−RV. | PARTIAL | `canonical-strategy-frontier.ts:989-994` |
| Q4 | Q delta lattice | Bands are `[0,0.25]` and `[0.25,0.5]`, with centres 0.125 and 0.375 as shortlist targets. Delta is the de facto selector. | PARTIAL | `paper-bootstrap-runtime-policy.ts:15` |
| Q5 | Q profit taking | CLOSE_FULL utility is +1 only when the executable remaining value is ≤10% **and** DTE ≤5. Otherwise it is −1. There is no credit-capture or capital-release rule. | MISSING | `paper-bootstrap-management-policy.ts:228-232`, `:820-821`, `:857` |
| Q6 | Q loss management | Thesis-invalidation bias defaults to 0, so there are no delta, support, IV-shock or premium-multiple triggers. | MISSING | `paper-bootstrap-management-policy.ts` (`thesisUtilityAdjustment`, `:403`) |
| Q7 | Q roll | Built as close + open, with candidates compared across strike and expiry. | CORRECT (structure) | `roll-incremental-utility.ts:84` |
| H1 | H selection | `bestCandidateId` uses the same Pareto rank → unknown count → **candidateId lexical** order. There is no gamma, move-speed or short-RV ranking. | WRONG_WIRING | `hold-strike-production-decision.ts:29-30`; `canonical-strategy-frontier.ts:1029` |
| H2 | H management | Triggers are event, AEGIS, liquidity and DTE≤1 only. There is no delta acceleration, distance velocity or gamma early warning. | PARTIAL | `hold-strike-lifecycle.ts:28-35` |
| H3 | H no-roll identity | `rollAllowed:false`, and ROLL is removed from H actions. | CORRECT | `hold-strike-lifecycle.ts:12`; `management-action-frontier.ts:461` |
| D1 | D selection | Same lexical `bestCandidateId`. The objectives are maxProfit, maxLoss and spread only, with no credit/width, cushion or both-leg slippage. | WRONG_WIRING | `defined-risk-production-decision.ts:38`; `canonical-strategy-frontier.ts:995-999` |
| D2 | D management | Two-leg aware, with asymmetric and emergency states and no naked fallback. | CORRECT | `defined-risk-management.ts:100-136`, `management-action-frontier.ts:408-442` |
| D3 | D profit taking | There is no take-profit trigger; it closes only on expiry, event, AEGIS or liquidity triggers. | MISSING | `defined-risk-management.ts:126-136` |
| D4 | Q vs D comparison | There is no same-thesis comparison. Q is the default decision branch. | MISSING | `canonical-strategy-frontier.ts` (`decisionBranch ?? 'THETA_CONVENTIONAL'`) |
| A1 | A alternatives | RECOVERY_WAIT, SELL_STOCK and SELL_CC exist. There is no protective put or defined-risk overlay. | PARTIAL | `recovery-orchestrator.ts:55` |
| A2 | Whole-chain basis | The effective basis and whole-chain P&L are computed, with fees UNKNOWN when unproven. | CORRECT | `whole-chain-economics.ts:87`, `:136` |
| C1 | C strike utility | The default utility weights are **all zero**, so utility is premium income alone. The highest-premium call wins: forfeited upside, spread and event are not penalized. Ties go to option contract ID order. | WRONG_WIRING | `paper-bootstrap-management-policy.ts:21-23`, `:648`; `covered-call-lattice.ts:161-177`, `:372-375` |
| C2 | C whole chain | Called-away and not-called whole-chain P&L are computed per candidate. | CORRECT | `covered-call-lattice.ts:246-251` |
| X1 | Expected value | `EV_MODEL_NOT_EMPIRICALLY_READY` everywhere, honestly. | MISSING (calibration) | Repo-wide |
| X2 | Entry price ladder | One DAY limit at the favorable side, no repricing, and no minimum-credit link to economics. | MISSING | Execution handoff |
| X3 | Regime engine in Production | The Production regime contract is coarse (trend, vol, event, liquidity, stress). The new receipt is research only. | PARTIAL | `regime-contract.ts`; `strategy-intelligence/market-regime.ts` |
| X4 | Management contract at entry | The entry thesis receipt exists, with invalidation conditions. There is no per-structure profit, flat or loss contract. | PARTIAL | `entry-thesis-receipt.ts` |

## Promotion path (item 94)

SOURCE → MATH (this branch) → UNIT TEST (this branch) → HISTORICAL (point-in-time chains) → WALK-FORWARD → PAPER SHADOW
→ PAPER CANARY → PAPER AUTHORIZED. One strategy at a time: Q, then H, then D.
