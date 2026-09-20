# THETA Severe Drawdown Empirical Policy Study

Date: 2026-09-20  
Study version: `theta-risk-policy-empirical-study-v1`  
Immutable receipt hash: `d9936a7cdf8328da2818fb7d24f279be6c224261de201829f139d264055c9d7c`  
Finding: `NO_POLICY_EMPIRICALLY_SUPPORTED`  
Activation state: `PENDING_RESEARCH_REVIEW`

## Data contract

The study used 36,893 real Alpaca IEX daily stock bars for 24 explicitly classified research symbols. The requested source window was 2016-01-01 through 2026-09-20. Actual resolved observations span eight calendar years. Bars were requested with `adjustment=split`, consistent with the canonical bar-adjustment policy, so stock splits and reverse splits cannot silently appear as economic drawdowns.

Each entry observation uses its split-adjusted close. Maximum adverse excursion uses only later daily lows inside the specified calendar horizon. Observations whose full horizon was unavailable are right-censored and never counted as survived or breached. Effective N uses fixed, horizon-length time blocks per underlying so daily overlapping windows do not masquerade as independent samples.

The universe contains broad ETFs, sector ETFs, lower-volatility single stocks, and higher-volatility single stocks. It is a current curated liquid reference universe, not point-in-time index membership. Survivorship bias therefore remains a known limitation.

## Primary grid

| Policy | Resolved N | Censored N | Effective N | Breaches | Breach rate | Median MAE | 5th percentile MAE |
|---|---:|---:|---:|---:|---:|---:|---:|
| A, 30 days / 10% | 36,388 | 504 | 1,791 | 5,710 | 15.69% | -3.64% | -17.77% |
| B, 45 days / 15% | 36,124 | 768 | 1,194 | 3,859 | 10.68% | -4.44% | -21.35% |
| C, 60 days / 20% | 35,860 | 1,032 | 907 | 2,772 | 7.73% | -5.08% | -24.29% |

Continuous MAE distributions were computed before threshold labels. The sensitivity grid also evaluated 30/15, 45/10, 45/20, and 60/15. Those cells remain research diagnostics and are not activated policies.

## Family instability

| Family | A breach rate | B breach rate | C breach rate |
|---|---:|---:|---:|
| Broad ETFs | 6.81% | 3.06% | 1.17% |
| Sector ETFs | 7.54% | 4.32% | 2.84% |
| Lower-volatility single stocks | 13.71% | 8.00% | 4.83% |
| Higher-volatility single stocks | 45.74% | 37.18% | 30.56% |

This variation is too large for one unconditional threshold to serve as a production risk definition across the current universe. Policy C is rarer, but rarity alone does not establish that 60 days and 20 percent are economically correct for THETA.

## Temporal concentration

2022 produced 35.71 percent of A breaches, 35.63 percent of B breaches, and 36.83 percent of C breaches. Annual breach rates also change materially. For example, B ranges from 3.21 percent in 2020 to 22.84 percent in 2022, with 15.25 percent in 2025.

The volatility-scaled MAE diagnostic is more stable across horizons, with median values near -0.58 and fifth-percentile values near -2.1. This supports further volatility-conditioned research. It does not authorize a volatility threshold.

## Decision

`NO_POLICY_EMPIRICALLY_SUPPORTED` is the only defensible finding from this run.

The bar sample is large enough to reject a universal fixed threshold, but it is not enough to promote a production severe-drawdown label because:

- family and regime effects are large
- the universe has current-survivor bias
- underlying MAE is not identical to CSP whole-chain economic loss
- no option-entry state, premium, assignment burden, recovery path, or after-cost policy outcome is attached to these stock-only labels
- research review and out-of-sample policy validation remain pending

No pending production policy artifact was created. No severe-drawdown model was trained, registered, or promoted.

## Reproduction

The production-safe command is `npm run theta:risk-policy-study`. It calls the authenticated read-only runtime operation and writes a mode-0600 derived receipt under `.theta-local-worker/receipts`. It never exports provider credentials or raw provider payloads.
