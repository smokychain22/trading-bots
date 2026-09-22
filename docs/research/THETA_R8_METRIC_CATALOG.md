# THETA R8 metric catalog

Status: Slice 12 of the pre-VPS master continuation directive (R8 governance).
Defines every metric this engagement's R8 research track uses, so that
"profit %" never silently mixes ROC/ROR/ROE/premium-capture/RPCD, and so a
future consumer of any R8 export knows exactly what a number means without
re-deriving it.

| Metric | Formula | Unit | Denominator | Horizon | Gross/Net | Realized/Unrealized | N/A semantics |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `WholeChainNetPnL` | Sum of every real leg cash flow across a full chain (`computeWholeChainPnl`, `src/theta/whole-chain-*.ts`) | Dollars | N/A | Full chain (open to close/expiry/call-away) | Net (after fees/TCA) | Realized once the chain fully closes; `null` (not zero) while any leg is UNKNOWN | `null` when any component leg is UNKNOWN -- never coerced to 0 |
| `WholeChainWin` | `WholeChainNetPnL > 0` | Boolean | N/A | Same as above | Net | Realized only | Requires a non-null `WholeChainNetPnL`; undefined (not `false`) otherwise |
| `ProfitFactor` | `sum(grossProfitComponent) / abs(sum(grossLossComponent))` across a COHORT of resolved chains | Ratio (dimensionless) | Cohort of resolved outcomes | Cohort-level, not per-trade | Gross (before netting wins against losses) | Realized only (uses only resolved chains) | `null` when `sum(grossLossComponent) == 0` (never a fabricated Infinity) -- see `computeCohortOutcomeMetrics` in `src/research/defined-risk-vs-csp-paired-study.ts` for the reference implementation |
| `AvgWin` | Mean of `WholeChainNetPnL` over chains where `WholeChainWin == true` | Dollars | Count of winning chains | Cohort-level | Net | Realized only | `null` when zero winning chains exist |
| `AvgLoss` | Mean of `WholeChainNetPnL` over chains where `WholeChainWin == false` | Dollars | Count of losing chains | Cohort-level | Net | Realized only | `null` when zero losing chains exist |
| `ExpectedShortfall` | Mean of the worst `tailFraction`-share of a cohort's `WholeChainNetPnL` distribution (`tailFraction` is caller-supplied, never a hidden default) | Dollars | Cohort of resolved outcomes | Cohort-level | Net | Realized only | `null` when the cohort is empty or the tail sample would be empty. **Canonical tail-risk metric for this engagement's R8 comparisons** -- see `canonicalTailRiskMetric` in `cross-strategy-common-horizon-contract.ts`. `CVaR` (below) is a DISTINCT, non-canonical field -- never coalesced with `ExpectedShortfall` |
| `CVaR` (if retained from an upstream source) | Whatever definition the upstream model/export uses -- NOT assumed identical to `ExpectedShortfall` unless a specific export's documentation proves it | Dollars | Depends on source | Depends on source | Depends on source | Depends on source | Retained only for provenance/observability; never substituted for `ExpectedShortfall` in any R8 comparison logic |
| `MaxDrawdown` | Minimum (most negative) `MaxAdverseExcursion` observed across a cohort's resolved chains | Dollars | Cohort of resolved outcomes | Cohort-level | Net (uses realized MAE) | Realized only | `null` when no resolved chain has a known MAE |
| `CapitalDays` | Discrete daily sum of committed capital over a measurement window, including zero-capital idle days (contributing 0, never excluded) -- see `src/research/capital-days-definition.ts` | Dollar-days | N/A (this IS the denominator basis for `ReturnPerCapitalDay`) | Caller-defined window | N/A | N/A | `0` is a real, valid value (no capital ever committed) -- distinct from `null` (unknown), which this module never returns for a well-formed daily series |
| `ReturnPerCapitalDay` | `NetPnL / CapitalDays` | Dollars per dollar-day (dimensionless rate) | `CapitalDays` | Same window as the `CapitalDays` figure used | Net | Realized (uses realized `NetPnL`) | `null` when `CapitalDays <= 0` -- never a fabricated Infinity or 0 |
| `AssignmentRate` | Count of chains with a real assignment event / count of chains in the cohort eligible for assignment | Ratio (0-1) | Cohort of assignment-eligible chains | Cohort-level | N/A | Realized only | `null` when the eligible cohort is empty. Never conflated with "failure" -- assignment is a modeled lifecycle transition (standing rule) |
| `RecoveryDuration` | Calendar days from `ASSIGNED_STOCK` entry to `STOCK_RECOVERED`/`CASH` exit for a real chain | Days | N/A | Per-chain, then optionally averaged across a cohort | N/A | Realized only (needs a real resolved recovery episode) | `null` while recovery is still open (never a partial/estimated duration presented as final) |
| `CallAwayRegret` | Whole-chain P&L actually realized via a real ALLOW_CALL_AWAY minus the whole-chain P&L that would have resulted from a real, identified alternative (HOLD_CC/CLOSE_CC) -- an ESTIMABLE counterfactual, per `management-outcome-schema.ts`'s provenance discipline | Dollars | N/A | Per-chain | Net | The realized side is realized; the counterfactual side is always `ESTIMABLE` or `NOT_IDENTIFIABLE`, never presented as `OBSERVED_PARALLEL` unless a genuinely independent shadow execution exists | `NOT_IDENTIFIABLE` when no real alternative candidate was ever evaluated at the decision point |
| `TCA` | Sum of real, actual (never estimated-only) transaction cost across every leg of a chain -- execution slippage vs. the decision-time mid/mark, per this engagement's standing TCA-never-double-subtracted rule | Dollars | N/A | Per-chain, then optionally summed across a cohort/horizon | Net cost (always a cost, sign convention: positive = cost incurred) | Realized only | `null` when any leg's fill price is UNKNOWN -- never estimated from a mid-price assumption presented as real |

## Explicitly prevented conflations

The following distinct metrics must **never** be displayed under a generic
"profit %" label, since they have different denominators and different
economic meanings:

- **PremiumCapturePct** = realized credit retained / opening credit received (a single-leg, single-cycle measure)
- **ReturnOnCollateral** = `WholeChainNetPnL / collateral` (ignores time -- NOT the same as `ReturnPerCapitalDay`, which is time-normalized)
- **ReturnOnRisk** = `WholeChainNetPnL / maxLoss` (defined-risk structures only; undefined for a bare CSP without invoking `cashSecuredPutMaxLossAtZero`)
- **ReturnOnEquity** = `WholeChainNetPnL / account equity` (account-level, not chain-level -- a completely different denominator)
- **RPCD** = `ReturnPerCapitalDay` (see above) -- the only one of these five that is time-normalized and capital-days-based

Any dashboard, report, or export that labels a number simply "return %" or
"profit %" without naming which of the above it is violates this catalog and
should be corrected before promotion.
