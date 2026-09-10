# Timeframe / Horizon Registry

Durability artifact naming the distinct time horizons THETA's features and decisions
operate on, per this task's explicit "do not force every feature to use the same
lookback" requirement.

| Horizon | Scale | Used for | Status |
|---|---|---|---|
| MICRO / execution | seconds-minutes | BBO, spread, quote freshness, fill probability, underlying move around submission | `option-contract.ts`'s `dataAgeSeconds`/`executable` check; `execution_quality.py` |
| INTRADAY | minutes-hours | Realized move, volatility shock, session behavior, market stress, execution quality | Not yet a distinct feature family — `regime_v0.py`'s inputs are currently daily-scale (`rv20`, `ma_slope`); an intraday-scale regime input would be a genuine future addition, not yet built |
| SHORT (≈1-5 trading days) | days | THETA-H's entry/management window, event/gap risk, short-term vol, assignment probability | `theta_h_baseline.py`'s 2-5 DTE window; `regime_v0.py`'s `max_adverse_gap`/`rv20` inputs are the closest existing short-horizon signals |
| MEDIUM (weeks) | 30-60 days | THETA-Q's research envelope, trend, ownership | `theta_q_lattice.py`'s DTE window; `ownership_v0.py`'s `ret_20d`/`ma20_rel`/etc. |
| RECOVERY | days-weeks-months | Recovery probability, capital-days, drawdown, CC decision, stock exit | `recovery_spec.py`'s `RecoverySummary` (P5/P10/P20-day probabilities, median/P95 recovery days) |

## Discipline

No single feature or model in this repository is required to share another's lookback
window. `ownership_v0.py` already demonstrates this correctly (multiple return
horizons — `ret_1d`/`ret_5d`/`ret_20d`/`ret_60d` — as independent inputs, not collapsed
into one). This registry exists so a future INTRADAY-scale regime/feature addition
(genuinely not built yet) has a clear place to land rather than being bolted onto an
existing daily-scale model.

## Status

Descriptive registry. INTRADAY horizon features are the one genuine gap named above —
everything else already has at least a partial implementation at the stated horizon.
