# THETA Correlation Policy Study

Date: 2026-09-20  
Finding: `NO_CORRELATION_THRESHOLD_PROMOTED`  
Activation state: `PENDING_RESEARCH_REVIEW`

## Evidence

The study used the same 36,893 split-adjusted Alpaca daily bars and 24-symbol research universe as the severe-drawdown study. It computed synchronized point-in-time log returns at 76 monthly as-of snapshots. Missing overlap and zero variance remain `UNKNOWN` through the canonical correlation evidence contract.

| Lookback | Snapshots | Pairwise correlation p05 | Median | p95 | Median known-pair coverage |
|---|---:|---:|---:|---:|---:|
| 20 bars | 76 | -0.26 | 0.42 | 0.89 | 100% |
| 60 bars | 76 | -0.15 | 0.40 | 0.86 | 100% |
| 120 bars | 76 | -0.10 | 0.41 | 0.85 | 100% |

The broad distributions show that one static pairwise threshold would behave differently across lookbacks and market states. This run therefore does not select a threshold or a cluster algorithm for production.

## Required semantic separation

A correlation cluster threshold decides which positions are treated as related. An exposure cap decides how much aggregate risk may be carried after the cluster exists. They are separate controls and must not share one unexplained number.

The current research output supports a threshold-graph method as an interpretable challenger only. A production policy still needs temporal stability analysis, stress-period behavior, turnover analysis, and direct impact on THETA assignment and tail exposure.

## Sector source and ETF semantics

No canonical current provider evidence supplies a verified sector mapping. Ticker text is not a sector source, so no sector cap is promoted.

The explicit ETF labels in the research universe are research-family metadata only:

- broad ETFs represent broad-market exposure
- sector ETFs represent the issuer-defined sector basket as a single instrument
- neither label proves constituent-level concentration or current sector weights

A future sector policy requires a versioned source, effective dates, point-in-time mappings, ETF constituent semantics, refresh cadence, and conflict handling before any cap can become active.

## Decision

Correlation evidence generation is operational and reproducible. Production cluster and exposure thresholds remain unset. No AEGIS threshold changed.

