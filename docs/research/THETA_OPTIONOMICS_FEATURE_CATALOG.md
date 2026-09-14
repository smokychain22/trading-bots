# THETA Optionomics Feature Catalog

Status date: 2026-09-14

Features stay separate until evidence supports an interaction. There is no
single unexplained Optionomics score.

| Feature family | Example hypotheses | Required controls | Initial status |
|---|---|---|---|
| IV level and IV/RV | Premium richness predicts after-cost CSP EV | symbol, DTE, regime, event distance | TEST |
| IV rank and percentile | Relative IV adds value beyond raw IV | raw IV and lookback availability | TEST |
| Downside skew | Skew predicts assignment burden and recovery duration | moneyness, DTE, regime | TEST |
| Term structure | Backwardation marks event or stress risk | earnings, macro events, realized vol | TEST |
| Surface shape | Local curvature improves contract selection | liquidity and exact PIT grid | TEST |
| GEX and gamma flip | Dealer structure changes outcome distribution | explicit sign convention and universe | TEST |
| Put and call walls | Distance to walls changes tail and assignment outcomes | spot, expiry aggregation, methodology | TEST |
| Vanna and Charm | Exposure matters near events and short DTE | time, IV shock, sign convention | TEST |
| Flow and UOA | Acceleration improves timing after controls | aggressor uncertainty, symbol, regime | TEST |
| Crowd horizons | Persistence or reversal adds conditional value | current, 8h, 24h, 48h PIT windows | TEST |
| OI and volume | Liquidity reduces execution and exit risk | spread, size, quote age | ADOPT as safety evidence after validation |
| Earnings and events | Near-event risk changes feasible action set | known-at timestamp | ADOPT where contract is proven |
| Historical analytics | Accelerates hypothesis selection | no future leakage, no assumed fills | ADAPT |
| Recorded quote economics | Mid, spread and relative spread describe the observed market | two-sided non-crossed quote, provider time | ADOPT as research context, never assumed fill |
| CSP structural economics | Breakeven, cushion, multiplier-safe collateral and credit yield compare feasible contracts | broker multiplier, stock price, recorded bid | ADOPT as transparent context, not alpha |
| Expected-move distance | Strike distance scaled by `S * IV * sqrt(DTE/365)` improves cohort comparison | verified IV units and DTE | TEST, never POP |

## Experiment outcome vocabulary

Every experiment ends as `KEEP`, `KEEP_CONDITIONALLY`, `REMOVE`, `REJECT`, or
`INSUFFICIENT_DATA`. Required reporting includes raw N, effective independent N,
Managed Episode WR, Whole-Chain WR when applicable, after-cost EV, Profit Factor,
average win and loss, max drawdown, ES/CVaR, capital-days, calibration, and
execution quality. Win rate cannot promote a feature by itself.

## Current empirical state

The repository has authenticated descriptive context and a PIT evidence path.
It does not yet have sufficient resolved independent episodes to show that any
of these features improves after-cost policy performance.

`EV_MODEL_NOT_EMPIRICALLY_READY = YES`.
