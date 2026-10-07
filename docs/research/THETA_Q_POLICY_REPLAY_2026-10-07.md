# THETA Q policy replay, SPY bounded run

## Result

The replay completed against authenticated, read-only Alpaca data through 2026-10-06. It compared the current Q emulation,
the economic Q shadow, and 2,200 selection-management combinations. No result in this report changes Production policy or
establishes profitability.

The governed capital lane produced zero episodes for a specific reason. It was not an empty-contract or market-quality result.
All 136 weekly decision points had at least one structurally eligible SPY contract, but every structurally eligible contract
failed the account-concentration gate under the replay's $100,000 equity assumption and 22.5% hard ticker cap.

| Funnel item | Value |
| --- | ---: |
| completed underlying sessions | 756 |
| option contracts with bounded history | 15,416 |
| weekly decisions | 136 |
| raw decision-contract observations | 88,447 |
| structurally eligible before capital | 38,675 |
| capital eligible at $100,000 equity | 0 |
| decisions blocked only by capital | 136 |
| minimum qualifying collateral | $30,500 |
| minimum equity for that contract at the 22.5% hard cap | $135,555.56 |

Gate failure counts overlap and therefore must not be summed as mutually exclusive rejections: DTE 38,861, delta 6,778,
modeled spread 13,642, volume 12,207, capital 88,447, and non-positive modeled credit 1,692. The report now persists these
counts and the capital-only decision classification so a zero-episode run cannot be described as `NO_OPPORTUNITY`.

## Capital-unconstrained research comparison

These rows show one-contract economics without account-capacity authority. They are useful for policy research only.

| Policy | N | Win rate | Expectancy/trade | Profit factor | Net P&L | Max drawdown | ES5 | Annualized return on capital-days | Assignment rate | Average hold |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| current Q + current management emulation | 22 | 95.45% | $355.70 | 9.88 | $7,825.45 | -$881.52 | -$788.70 | 6.17% | 4.55% | 35.95 days |
| economic Q + current management emulation | 21 | 100.00% | $102.43 | undefined, no losses | $2,150.98 | $0.00 | $33.38 | 1.86% | 0.00% | 37.71 days |
| economic Q + 50% capture | 47 | 97.87% | $50.01 | 11.30 | $2,350.28 | -$228.10 | -$86.92 | 2.21% | 2.13% | 15.06 days |

The expanding-window selector chose the same low-delta 25% capture challenger for all three profile labels. Its walk-forward
sample was 40 to 43 episodes, all realized winners, with 2.81% to 2.94% annualized return on capital-days. That result is not a
promotion signal. The path-risk measure remained negative, the sample is small and overlapping-market dependent, and a no-loss
sample makes tail and loss estimates weak. In addition, 432 profile policies failed the in-sample execution-stress gate.

## Evidence limits

- Option prices are daily trade closes, not executable historical quotes.
- Entry and exit spreads are modeled. Base half-spread is `max($0.01, 3% of mid)` and the stress case doubles it.
- IV and Greeks are Black-Scholes inversions using option and underlying daily closes that may not be simultaneous.
- Historical open interest, candidate-bound AEGIS, ownership and event gates are not available in this replay.
- The universe is today's fixed universe, so survivorship remains.
- Assignment is marked at expiry. Assigned stock is not managed through A/C in this run.
- Weekly decisions and non-overlapping positions reduce the effective sample. A 100% observed win rate does not prove a
  no-loss strategy or a 70% to 80% durable win rate.

## Artifact provenance

- Replay contract: `theta-q-policy-replay-v2`
- Generated at: `2026-10-07T20:16:49.504Z`
- Data end: `2026-10-06`
- Authenticated provider requests: 286, all GET-only
- Aggregate artifact: `C:\ProjectBackups\trading-bots\research-outputs\q-replay-spy-funnel-20261008-011459.json`
- Artifact SHA-256: `3eff01836f91470bdb0c6f90cb7c05932f6751accdb226e9612fe542a2dbb182`
- Raw fetch cache: deleted after the bounded run
- Broker submissions: 0
- Broker mutations: 0

## Decision

`CURRENT_Q`, `ECONOMIC_Q`, and all management challengers remain shadow research. The run proves that the current $100,000
capital assumption is structurally incompatible with a cash-secured SPY put under the existing hard ticker cap. The correct next
comparison is Q versus defined-risk D under the same thesis and capital envelope. The cap must not be loosened to manufacture Q
activity.
