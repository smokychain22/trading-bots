# THETA Severe Drawdown Empirical Policy Study

Date: 2026-09-20<br>
Study version: `theta-risk-policy-empirical-study-v1`<br>
Immutable receipt hash: `633e9a649bae02b1e46118ca5d47a6c3909fb99e30c6cafccc101d0fd9bf0cc3`<br>
Finding: `NO_POLICY_EMPIRICALLY_SUPPORTED`<br>
Activation state: `PENDING_RESEARCH_REVIEW`

## Data contract

The study used 36,893 real Alpaca IEX daily stock bars for 24 explicitly classified research symbols. The requested source window was 2016-01-01 through 2026-09-19. The returned bar window is 2018-11-01 through 2026-09-18 and spans eight calendar years. Bars were requested with `adjustment=split`, consistent with the canonical bar-adjustment policy, so stock splits and reverse splits cannot silently appear as economic drawdowns.

Each entry observation uses its split-adjusted close. Maximum adverse excursion uses only later daily lows inside the specified calendar horizon. Observations whose full horizon was unavailable are right-censored and never counted as survived or breached. Effective N uses fixed, horizon-length time blocks per underlying so daily overlapping windows do not masquerade as independent samples.

The universe contains broad ETFs, sector ETFs, lower-volatility single stocks, and higher-volatility single stocks. It is a current curated liquid reference universe, not point-in-time index membership. Survivorship bias therefore remains a known limitation.

## Full seven-cell grid

| Policy | Resolved N | Censored N | Censor rate | Effective N | Effective positive groups | Breaches | Breach rate | Median MAE | 5th percentile MAE |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| A, 30 days / 10% | 36,388 | 504 | 1.37% | 1,791 | 604 | 5,710 | 15.69% | -3.64% | -17.77% |
| B, 45 days / 15% | 36,124 | 768 | 2.08% | 1,194 | 308 | 3,859 | 10.68% | -4.44% | -21.35% |
| C, 60 days / 20% | 35,860 | 1,032 | 2.80% | 907 | 173 | 2,772 | 7.73% | -5.08% | -24.29% |
| S, 30 days / 15% | 36,388 | 504 | 1.37% | 1,791 | 322 | 2,618 | 7.19% | -3.64% | -17.77% |
| S, 45 days / 10% | 36,124 | 768 | 2.08% | 1,194 | 541 | 7,583 | 20.99% | -4.44% | -21.35% |
| S, 45 days / 20% | 36,124 | 768 | 2.08% | 1,194 | 172 | 2,107 | 5.83% | -4.44% | -21.35% |
| S, 60 days / 15% | 35,860 | 1,032 | 2.80% | 907 | 288 | 4,773 | 13.31% | -5.08% | -24.29% |

Continuous MAE distributions were computed before threshold labels. All seven cells, including complete family and calendar-year breakdowns and censor rates, are published in `THETA_R7_RISK_POLICY_EMPIRICAL_SUMMARY_2026-09-20.json`. Secondary cells remain research diagnostics and are not activated policies.

## Family instability

| Family | 30d/10% | 45d/15% | 60d/20% | 30d/15% | 45d/10% | 45d/20% | 60d/15% |
|---|---:|---:|---:|---:|---:|---:|---:|
| Broad ETFs | 6.81% | 3.06% | 1.17% | 0.98% | 10.79% | 0.41% | 4.81% |
| Sector ETFs | 7.54% | 4.32% | 2.84% | 2.22% | 11.62% | 1.81% | 6.14% |
| Lower-volatility single stocks | 13.71% | 8.00% | 4.83% | 4.72% | 19.30% | 3.24% | 10.60% |
| Higher-volatility single stocks | 45.74% | 37.18% | 30.56% | 28.94% | 54.29% | 25.05% | 42.43% |

This variation is too large for one unconditional threshold to serve as a production risk definition across the current universe. Policy C is rarer, but rarity alone does not establish that 60 days and 20 percent are economically correct for THETA.

## Temporal concentration

| Year | 30d/10% | 45d/15% | 60d/20% | 30d/15% | 45d/10% | 45d/20% | 60d/15% |
|---|---:|---:|---:|---:|---:|---:|---:|
| 2020 | 9.05% | 3.21% | 1.68% | 2.70% | 10.65% | 1.25% | 3.64% |
| 2021 | 9.49% | 6.58% | 4.84% | 4.17% | 14.18% | 3.45% | 8.29% |
| 2022 | 33.86% | 22.84% | 16.96% | 15.33% | 42.88% | 13.57% | 28.32% |
| 2023 | 9.33% | 4.95% | 3.12% | 3.52% | 13.12% | 2.53% | 6.08% |
| 2024 | 11.54% | 8.15% | 5.49% | 5.94% | 15.39% | 3.97% | 9.90% |
| 2025 | 17.57% | 15.25% | 12.20% | 9.93% | 23.58% | 8.68% | 18.90% |
| 2026 | 14.79% | 8.62% | 5.15% | 5.56% | 21.23% | 3.94% | 11.70% |

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
