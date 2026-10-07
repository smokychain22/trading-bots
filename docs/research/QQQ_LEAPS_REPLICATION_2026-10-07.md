# QQQ_LEAPS_DIP_BUY_V1: independent replication (2026-10-07)

**Provenance:** OWNER_CURATED_SOURCE_CLAIM (master guide §14). THETA's results below are THETA's own and are never recorded as
the source's numbers. Research only; no broker authority.

**Rule.** After a QQQ down day of at least 1% (close to close), buy a call of about 0.60 delta expiring about 12 months out
(the nearest third-Friday monthly), on a $5 strike grid. Take profit at +50% on the daily close. No stop. If the target is
never hit, hold to expiry. Every rule the source leaves open is run as a SOURCE_RULE_UNSPECIFIED variant.

**Data.**
- QQQ daily SIP bars from 2016-01-04 to 2026-10-06 (2,705 sessions), split-adjusted; dividends ignored.
- **MODEL_PRICED:** Black-Scholes, rate 3%, IV proxy = RV60 × {0.9, 1.1, 1.3} clamped to [0.12, 0.60]. No skew, and no
  option prices before 2024 exist on Alpaca.
- **MARKET_PRICED:** real Alpaca option daily closes from 2024-02 onward.
- **Costs:** 1% of the option price as half-spread on each side, plus $0.65 per contract.

## Replication against the source targets

| | Source target | THETA MONTHLY_CAP (IV ×0.9) | THETA MONTHLY_CAP (IV ×1.1) |
|---|---|---|---|
| Trades | 112 | 108 | 108 |
| Win rate | 91.1% | 90.7% | 88.9% |
| Profit factor | 6.26 | 6.34 | 4.55 |
| Avg win / avg loss | ~$2.0k / ~$3.3k | $1.44k / $2.23k | $1.60k / $2.81k |
| Max drawdown | ~$18k | $15.5k closed ($37k mark-to-market) | $26k closed ($53k mark-to-market) |
| Avg hold | ~127 d | 112 d | 137 d |

**Status: HISTORICALLY_REPLICATED (model-priced)** for trade count, win rate and profit factor under the **one entry per
calendar month** reading of the rule. Entering on every −1% day gives about 400 trades and a closed drawdown of about $98k,
so the source rule is evidently month-capped.

## Regime split (IV ×1.1, by entry date)

| Variant | 2015–2020 | 2021–2022 | 2023 onward |
|---|---|---|---|
| MONTHLY_CAP | N 48, PF 17.0, exp +$834 | N 23, **PF 0.83, exp −$225**, DD $28k | N 37, 100% wins, exp +$2,290 |
| MONTHLY_CAP + close > SMA200 | N 39, PF 14.7 | N 12, PF 1.37, exp +$320, DD $10.5k | N 35, 100% wins |

The edge depends on the regime. The 2021–2022 bear market has negative expectancy, and the SMA200 trend filter turns it
positive while cutting drawdown by about 63%, at a small cost in the 2023-onward bull market. This matches the source's
own observation that its weak period was a bear market. Neither the filter nor the rule is promoted: the 2023-onward
sample is one regime, with no losses, and that is not evidence of robustness.

## Benchmark: is it an options edge?

Each LEAPS trade is compared with holding the delta-equivalent QQQ shares (entry delta × 100) over the **same** window.

| Variant (IV ×1.1) | LEAPS P&L | Delta-equivalent stock P&L | Excess | Stock win rate | Avg premium / avg notional |
|---|---|---|---|---|---|
| MONTHLY_CAP | $119.6k | $149.9k | **−$30.3k** | 88.9% | $3.19k / $18.6k |
| MONTHLY_CAP + SMA200 | $117.9k | $124.1k | −$6.2k | 89.5% | $3.15k / $19.6k |
| NO_OVERLAP | $34.4k | $37.0k | −$2.5k | 92.9% | $2.75k / $17.8k |

**Conclusion.**
- The 90% win rate is QQQ drift plus the target-exit selection. The delta-equivalent stock wins just as often and earns more
  over the same windows.
- The real benefit of the LEAPS is **capital efficiency with a defined maximum loss**: about 1/6 of the capital at risk.
- That is a portfolio and sizing property, not alpha. It is only worth taking where capital efficiency is the binding
  constraint.

**Market-priced check (2024-02 onward):** 7 closed MONTHLY_CAP trades, all winners, with a $11k mark-to-market drawdown.
75 entries were skipped because the chosen LEAPS strike had no trade print that day. The sample is too thin to confirm or
refute the model-priced result, and it covers a single bull regime.

**Limitations:**
- model IV proxy, with no skew or term structure;
- daily-close fills;
- dividends ignored;
- constant rate;
- one underlying.

**Next:**
- a real-IV history source;
- a walk-forward that selects the cadence and filter on 2015–2022 only;
- allocator handling of delta-equivalent exposure (§14.5).
