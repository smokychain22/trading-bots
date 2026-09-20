# THETA IV Shock Policy Study

Date: 2026-09-20<br>
Finding: `INSUFFICIENT_TEMPORAL_BASELINE`<br>
Activation state: `PENDING_RESEARCH_REVIEW`

## Real evidence inspected

The canonical Aiven view contains 4,147 rows with known implied volatility. The observed window is 2026-09-16 15:32:50 UTC through 2026-09-18 16:30:55 UTC. All known rows fall in the 22 to 45 DTE cohort.

| Statistic | Implied volatility |
|---|---:|
| Minimum | 0.00235 |
| p05 | 0.26793 |
| p25 | 0.32955 |
| Median | 0.36120 |
| p75 | 0.49635 |
| p95 | 0.98052 |
| Maximum | 3.78412 |

Thousands of rows from two trading days do not form a historical baseline. Cross-sectional contract count cannot substitute for independent time coverage.

## Policy implications

No fixed IV shock, percentile, z-score, or volatility-regime threshold is promoted. The very low minimum and high upper tail also require contract-quality and moneyness conditioning before they can be interpreted as market stress rather than sparse or unusual contracts.

The next valid study requires:

- multiple independent sessions and regimes
- comparable contract cohorts by underlying, DTE, moneyness, option type, and liquidity
- point-in-time rolling baselines using only observations available before each decision
- separate absolute IV, relative IV change, IV/RV, skew, term, and surface diagnostics
- after-cost outcome and tail-risk evaluation

Until those conditions exist, IV remains observed context. It does not become an automatic trade or risk command.
