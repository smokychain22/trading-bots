# THETA strategy economics authority

Status: SHADOW (observation only). No Production hurdle values exist in source. Owner decisions are required before any
hurdle or economic ranking can change which trade is entered.

## Authorities (unchanged separation)

| Question | Authority |
| --- | --- |
| Which strategies apply? | Router (applicability only) |
| What trade makes economic sense? | Strategy + **strategy economics** (this document) |
| Is the risk acceptable? | AEGIS |
| How much risk capacity exists? | Portfolio allocator (separate branch, OFF → SHADOW → PARITY → ENFORCED) |
| Which already-feasible proposal wins? | Canonical frontier |
| Execute | PaperOrderCoordinator |

Economics never sizes, never changes a quantity, never overrides AEGIS, and never submits.

## Postmortem: first Paper fill (2026-10-07, Q, XLE 57P, 44 DTE)

Durable decision receipt facts:

- The Q branch built 124 put candidates. 4 were evaluated: the finalist shortlist picks 5 contracts on structure alone
  (delta-band distance, DTE, spread, quote age), and 119 were `NOT_EVALUATED_SHORTLIST_BOUND`.
- Two finalists reached `OPEN_REDUCED` at quantity 1 under AEGIS `ALLOW_REDUCED`:
  - 57P: about $27 executable credit on $5,700 collateral, 11.9% break-even cushion.
  - 63P: about $155 on $6,300, 4.5% cushion.
- The structural top-two diagnostic was `NEAR_TIE`: same Pareto rank, same unknown count.
- Calibrated EV is unavailable (`EV_MODEL_NOT_EMPIRICALLY_READY`), so `returnPerCapitalDay` was null for both. The
  decision assembly then fell back to `candidateId.localeCompare`, and `XLE261120P00057000` sorts before
  `XLE261120P00063000`.

**Ranking defect 1.** Without EV, the final choice is OCC-symbol order. That order systematically prefers the lowest
strike and the nearest expiry, which means the smallest premium.

**Ranking defect 2.** Economics never enters the finalist shortlist, so most contracts are never compared at all.

Economics at the fill (0.28 credit, modeled opening cost $1.70):

| Metric | Value |
| --- | --- |
| Max profit | $26.30 net |
| Return on collateral | 0.46% |
| Annualized | 3.8% |
| Return per capital-day | 0.0105% |
| Break-even | 56.72 (11.9% below spot at decision) |
| IV minus RV20 | +0.085 (IV 0.283 against a same-day RV20 of 0.198, not point-in-time) |
| Loss at expiry after a −2σ implied move | about $387 |
| Reward to stress | 0.07 |

The `LOW_CAPITAL_EFFICIENCY_SUSPECTED` diagnostic fires on all three signals against the owner sensitivity reference.

A 50% credit-capture target on this trade is about $13. That figure comes from the entry choice. An exit rule cannot
repair it.

## Ranking defect 3, found by the live shadow scan

A read-only scan at 16:26Z covered 8 underlyings and 1,765 liquid candidates. Ranking by raw return per capital-day
(no calibrated EV) puts first:

- the highest-|delta| CSPs (|delta| ≈ 0.45);
- 1–3%-OTM credit spreads $1–$7.50 wide, with annualized "ROC" above 1,000%.

Without EV, yield measures how much risk is sold, not edge. The economic order is therefore constraint-first: the
hurdle verdict comes first, then EV per capital-day once calibrated, then return per capital-day, then reward to
stress, then cushion, with the ID last. `ENFORCED` is downgraded to `SHADOW` unless the owner configures at least one
risk-bounding hurdle (minimum cushion, minimum reward to stress, or maximum stress loss).

## What exists in source (`src/theta/strategy-economics.ts`)

**`StrategyEconomicsReceipt`** covers CSP (Q/H) and put credit spreads (D). It reports:

- credit gross and net, width, capital, max profit and loss, break-even;
- distance to strike and to break-even;
- ROC, annualized ROC and return per capital-day;
- reward to max loss, worst-leg spread, IV−RV, IV rank;
- a labelled |delta| ITM proxy, which is not a probability of profit;
- gap and −2σ stress losses, and reward to stress;
- opportunity cost, EV (UNKNOWN until calibrated), event risk and liquidity.

Every missing input is a typed UNKNOWN with a reason.

**Optional per-class hurdles**, each `NOT_CONFIGURED` unless the owner sets it:

- minimum net credit, max profit, ROC, annualized ROC;
- minimum expected return and expected return per capital-day;
- minimum IV−RV edge and minimum break-even cushion;
- maximum spread, event risk and stress loss;
- minimum reward to stress.

The verdict is `PASS`, `FAIL`, `UNDETERMINED` or `NOT_CONFIGURED`. Mode is `OFF`, `SHADOW` (the default) or
`ENFORCED`. Hurdle enforcement reports `ENFORCEMENT_NOT_CERTIFIED`.

**`LOW_CAPITAL_EFFICIENCY_SUSPECTED`** is a diagnostic only. It requires an explicit reference.

**Decision assembly** records `economicRanking` on every Q decision: the legacy winner, the economic winner, whether they
diverge, and whether the economic order was applied. In `SHADOW` the selection is unchanged.

## Not yet built (source-solvable, owner policy needed)

1. **Economic shortlist.** Rank finalists by economics within the risk constraints, not by delta-band distance alone.
2. **Entry price ladder.** Today the entry is one bounded DAY limit at the favorable side, with no repricing. A ladder
   (favorable → mid → less favorable) needs a minimum acceptable credit derived from the hurdles, and must re-run the
   economics at each refreshed quote: `INVALIDATE_AND_REEVALUATE`.
3. **Exit engine inputs.** Add profit captured versus remaining reward and tail risk (profit decay), return per
   capital-day while held, and a maximum acceptable debit for BUY_TO_CLOSE.
4. **D two-leg economics in the production D path**, and A/C whole-chain P&L in the outcome ledger.
5. **Episode store and dashboard.** Per strategy and regime: expectancy, profit factor, drawdown, return per
   capital-day, assignment rate and slippage. Policy changes only after walk-forward and out-of-sample validation.

`PROFITABILITY_STATUS = NOT_YET_PROVEN`.
