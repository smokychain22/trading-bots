# THETA Spread Stress Policy Study

Date: 2026-09-20  
Finding: `INSUFFICIENT_TEMPORAL_BASELINE`  
Activation state: `PENDING_RESEARCH_REVIEW`

## Real evidence inspected

The canonical Aiven view contains 4,729 decision-time rows with a computable two-sided relative spread. The observed window is 2026-09-16 15:32:50 UTC through 2026-09-18 16:30:55 UTC. All rows fall in the 22 to 45 DTE cohort.

Relative spread is `(ask - bid) / mid` when bid and ask are known, ordered, and the midpoint is positive.

| Statistic | Relative spread |
|---|---:|
| Minimum | 0.14% |
| p05 | 5.90% |
| p25 | 13.16% |
| Median | 25.87% |
| p75 | 78.38% |
| p95 | 200.00% |
| Maximum | 200.00% |

The wide upper tail confirms that contract comparability matters. A 200 percent relative spread can arise in very low-priced contracts and cannot be treated as a universal market-stress state without price, size, DTE, moneyness, and liquidity cohorts.

## Decision

No static spread threshold was selected. The current evidence supports the existing behavior of evaluating current executable BBO per contract and failing closed on stale, crossed, missing, or economically unusable quotes.

A production spread-stress policy requires independent sessions, cohort-normalized baselines, quote-size and price-level conditioning, and measured effects on fill probability, slippage, cancellation, and after-cost outcomes.

