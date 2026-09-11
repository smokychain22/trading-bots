# THETA external strategy catalog

2026-09-11. Strategy hypotheses only. These are inspected code behaviors, not recommendations to run the strategies. Repository commits and source paths are in [the ledger](GITHUB_REPO_RESEARCH_LEDGER.md). No claimed return or win rate has been accepted as verified. Configuration outside the reviewed files is explicitly unverified, never invented.

## alpacahq/options-wheel

Source commit `3698429289065ceb0c13ffcdc31a966c576779ad`, [core/execution.py](https://github.com/alpacahq/options-wheel/blob/3698429289065ceb0c13ffcdc31a966c576779ad/core/execution.py), [core/state_manager.py](https://github.com/alpacahq/options-wheel/blob/3698429289065ceb0c13ffcdc31a966c576779ad/core/state_manager.py), [core/broker_client.py](https://github.com/alpacahq/options-wheel/blob/3698429289065ceb0c13ffcdc31a966c576779ad/core/broker_client.py).

| Field | Inspected behavior |
|---|---|
| Entry | Sells score-ranked puts and covered calls on held shares. Single-symbol state reconstruction is a useful starting point, not a durable lifecycle ledger. |
| Exit | Market sells, default quantity one, no deterministic client_order_id or explicit option intent in reviewed request construction. Liquidation does not wait for the option close to settle before stock liquidation. |
| DTE | Not established as a validated policy parameter by this pass. |
| Delta | Not established as a calibrated win-probability input. No delta-to-WR adoption. |
| IV conditions | No THETA-ready IV threshold validated. |
| Underlying filters | Exact universe configuration not certified by this targeted pass. See survivorship risks below. |
| Event filters | No complete point-in-time event policy verified. |
| Profit target | No validated THETA target extracted. |
| Stop / roll | Tracks put collateral with 100 × strike × quantity. Hardcoded multiplier must be replaced by verified contract metadata. |
| Assignment policy | Rebuilds state from positions, does not constitute complete activity reconciliation. |
| Recovery | No calibrated assignment-recovery policy demonstrated in inspected source. |
| Covered-call policy | Automatically considers calls on held stock, no independent recovery economics proven. |
| Sizing | Tracks put collateral with 100 × strike × quantity. Hardcoded multiplier must be replaced by verified contract metadata. |
| Claimed win rate | Not adopted or represented as verified. No comparable Managed Episode evidence established. |
| Claimed return | Not adopted or represented as verified. |
| Evidence quality | File-level methods/failure cases only. External suites not executed. |
| Backtest quality | No point-in-time replay or OOS evidence established from these files. |
| Look-ahead / survivorship | Current snapshots only, not a historical feature archive. Historical universe and delisted symbols unverified. |
| Weaknesses | Automatic covered calls do not implement recovery economics. Positions alone cannot explain fills, assignment activities, or immutable roll losses. |
| THETA relevance / action | assignment-orchestrator.ts, order-intent-state.ts, account-exposure.ts. ADAPT. State/reconciliation test requirements extracted, no external code imported. |

## ShayantoDutta/alpaca-wheel-bot

Source commit `40c550cf44109028f9a99cdee2863a74c93ba833`, [wheel_bot.py](https://github.com/ShayantoDutta/alpaca-wheel-bot/blob/40c550cf44109028f9a99cdee2863a74c93ba833/wheel_bot.py).

| Field | Inspected behavior |
|---|---|
| Entry | Delta0.25±0.1, DTE14-28, IV-rank30,50% profit target,2× premium loss threshold, five-day wait in inspected configuration. Static NVDA event estimates. |
| Exit | 50% premium target and2× premium loss threshold in inspected configuration. Submitted intent is not proof of a fill. |
| DTE | 14-28 days in configuration. |
| Delta | 0.25 target,0.10 band. |
| IV conditions | IV rank threshold30, short/incomplete history needs explicit unknown handling. |
| Underlying filters | Exact universe configuration not certified by this targeted pass. See survivorship risks below. |
| Event filters | Static estimated NVDA earnings and2026 holidays. Reject as authoritative broker calendar. |
| Profit target | 50% in source configuration, not adopted. |
| Stop / roll | Order quantity1 and assumed100 multiplier. Static2026 holiday list lacks full exchange-session behavior. |
| Assignment policy | Option disappearance plus stock check can falsely book full premium. |
| Recovery | No calibrated assignment-recovery policy demonstrated in inspected source. |
| Covered-call policy | Wheel stock/call path exists, no full-H justification established. |
| Sizing | Order quantity1 and assumed100 multiplier. Static2026 holiday list lacks full exchange-session behavior. |
| Claimed win rate | Not adopted or represented as verified. No comparable Managed Episode evidence established. |
| Claimed return | Not adopted or represented as verified. |
| Evidence quality | File-level methods/failure cases only. External suites not executed. |
| Backtest quality | No dedicated test suite or validated OOS record found. |
| Look-ahead / survivorship | Static earnings/calendar approximations and current IV snapshots. Fixed chosen symbol(s), no historical-universe proof. |
| Weaknesses | Automatic inference can book a false win. No deterministic clientid/position intent, atomic persistence or full-H recovery policy proven. |
| THETA relevance / action | lifecycle/accounting regression fixtures. TEST_ONLY. Not empty: GitHub size10 is KB. Reject trading/accounting implementation. |

## milgar7969/alpaca-options-framework

Source commit `fd1c411da1abfee9009186fda99d8e9c02ca4166`, [orders.py](https://github.com/milgar7969/alpaca-options-framework/blob/fd1c411da1abfee9009186fda99d8e9c02ca4166/orders.py), [state.py](https://github.com/milgar7969/alpaca-options-framework/blob/fd1c411da1abfee9009186fda99d8e9c02ca4166/state.py), [risk.py](https://github.com/milgar7969/alpaca-options-framework/blob/fd1c411da1abfee9009186fda99d8e9c02ca4166/risk.py).

| Field | Inspected behavior |
|---|---|
| Entry | Long-option framework with stop/risk policy, not a Wheel assignment engine. |
| Exit | Explicit BUY_TO_OPEN, cancellation/fill race handling. Partial fills are not resolved adequately. get_positions failure=>[] and fill-price failure=>0 are unsafe. |
| DTE | Not established as a validated policy parameter by this pass. |
| Delta | Not established as a calibrated win-probability input. No delta-to-WR adoption. |
| IV conditions | No THETA-ready IV threshold validated. |
| Underlying filters | Exact universe configuration not certified by this targeted pass. See survivorship risks below. |
| Event filters | No complete point-in-time event policy verified. |
| Profit target | No validated THETA target extracted. |
| Stop / roll | Daily counters can be restored, but stop-distance sizing forces at least1. Counter restoration is not durable reservations. |
| Assignment policy | No complete assignment policy verified. |
| Recovery | No calibrated assignment-recovery policy demonstrated in inspected source. |
| Covered-call policy | No THETA-compatible CC policy established. |
| Sizing | Daily counters can be restored, but stop-distance sizing forces at least1. Counter restoration is not durable reservations. |
| Claimed win rate | Not adopted or represented as verified. No comparable Managed Episode evidence established. |
| Claimed return | Not adopted or represented as verified. |
| Evidence quality | File-level methods/failure cases only. External suites not executed. |
| Backtest quality | No OOS validation established. |
| Look-ahead / survivorship | Real-time functions not a replay implementation. Universe history unverified. |
| Weaknesses | In-memory flags and CSV cannot replace atomic lease/idempotent event ledger. No deterministic submission identity in inspected path. |
| THETA relevance / action | order-intent-state.ts, scheduler/reconciliation infrastructure. TEST_ONLY. Use failure scenarios only. No unlicensed source reuse. |

## ksanjay/Kelly-Criterion-Option-Selector

Source commit `43c2443cd202777650bd1c61233054a83fe31771`, [kelly_leaps.ipynb](https://github.com/ksanjay/Kelly-Criterion-Option-Selector/blob/43c2443cd202777650bd1c61233054a83fe31771/kelly_leaps.ipynb).

| Field | Inspected behavior |
|---|---|
| Entry | ATM long LEAPS on a fixed four-symbol list. Uses N(d2) as probability and current spot payoff proxy. |
| Exit | No broker reconciliation path established. |
| DTE | Long-dated expiry chosen after a fixed calendar cutoff. |
| Delta | ATM selection, N(d2) misused as probability. |
| IV conditions | No THETA-ready IV threshold validated. |
| Underlying filters | Fixed four-symbol list. |
| Event filters | No complete point-in-time event policy verified. |
| Profit target | No validated THETA target extracted. |
| Stop / roll | Raw Kelly and forced one contract after rounding can violate budget. Each symbol may independently spend the bankroll. |
| Assignment policy | No complete assignment policy verified. |
| Recovery | No calibrated assignment-recovery policy demonstrated in inspected source. |
| Covered-call policy | No THETA-compatible CC policy established. |
| Sizing | Raw Kelly and forced one contract after rounding can violate budget. Each symbol may independently spend the bankroll. |
| Claimed win rate | Not adopted or represented as verified. No comparable Managed Episode evidence established. |
| Claimed return | Not adopted or represented as verified. |
| Evidence quality | File-level methods/failure cases only. External suites not executed. |
| Backtest quality | No credible managed-episode OOS result in notebook inspection. |
| Look-ahead / survivorship | Current option lastPrice/expiry selection does not reconstruct historical entry data. Hand-picked surviving symbols. |
| Weaknesses | Risk-neutral ITM probability is not physical profitable-episode probability. b=(S-K)/premium-1 is not a forecast payoff distribution. |
| THETA relevance / action | sizing.py, AEGIS, EV model provenance. REJECT. No sizing or strategy adoption. |

## joncovington/MEICAgent

Source commit `333ff77b68aaba07c68bcbcacb6d439ebceda4b6`, [src/paper.py](https://github.com/joncovington/MEICAgent/blob/333ff77b68aaba07c68bcbcacb6d439ebceda4b6/src/paper.py), [tests/test_paper_calendar.py](https://github.com/joncovington/MEICAgent/blob/333ff77b68aaba07c68bcbcacb6d439ebceda4b6/tests/test_paper_calendar.py).

| Field | Inspected behavior |
|---|---|
| Entry | Intraday iron-condor simulation with different stop/management profiles. Not a CSP/stock recovery system. |
| Exit | Synthetic fills, not Alpaca Paper brokerage. Tastytrade-specific fee assumptions must not become Alpaca cost truth. |
| DTE | Intraday expiry/settlement path in simulation. |
| Delta | Not established as a calibrated win-probability input. No delta-to-WR adoption. |
| IV conditions | No THETA-ready IV threshold validated. |
| Underlying filters | Exact universe configuration not certified by this targeted pass. See survivorship risks below. |
| Event filters | No complete point-in-time event policy verified. |
| Profit target | No validated THETA target extracted. |
| Stop / roll | Cash settlement versus physical-delivery force-close distinction is useful. Missing strike/spot can return0 in settlement helper, unsafe for accounting. |
| Assignment policy | Synthetic cash settlement or physical-product close treatment, not a Wheel recovery policy. |
| Recovery | No calibrated assignment-recovery policy demonstrated in inspected source. |
| Covered-call policy | No THETA-compatible CC policy established. |
| Sizing | Cash settlement versus physical-delivery force-close distinction is useful. Missing strike/spot can return0 in settlement helper, unsafe for accounting. |
| Claimed win rate | Not adopted or represented as verified. No comparable Managed Episode evidence established. |
| Claimed return | Not adopted or represented as verified. |
| Evidence quality | File-level methods/failure cases only. External suites not executed. |
| Backtest quality | Same-snapshot variants are dependent observations. Snapshot dates plus wall-clock _now_et timestamps require replay audit. |
| Look-ahead / survivorship | Wall clock in historical replay can contaminate event timing. Fixed product scope does not establish delisted equity handling. |
| Weaknesses | Date heuristics must defer to actual exchange schedule. No Wheel assignment/recovery model demonstrated. |
| THETA relevance / action | management ablation, assignment/expiration fixtures. ADAPT. Variant lineage and settlement tests proposed, strategy not integrated. |

## NavnoorBawa/Options-Flow-Predictor

Source commit `da83ec361c1cb7494a0b1b96dbca8edc4a09e788`, [Options Flow Predictor.ipynb](https://github.com/NavnoorBawa/Options-Flow-Predictor/blob/da83ec361c1cb7494a0b1b96dbca8edc4a09e788/Options%20Flow%20Predictor.ipynb).

| Field | Inspected behavior |
|---|---|
| Entry | RF/XGBoost directional predictions over stock history and currently fetched options context. Selected notebook code inspected, not every output cell. |
| Exit | No audited executable BBO/partial-fill/accounting engine. |
| DTE | Not established as a validated policy parameter by this pass. |
| Delta | Not established as a calibrated win-probability input. No delta-to-WR adoption. |
| IV conditions | No THETA-ready IV threshold validated. |
| Underlying filters | Exact universe configuration not certified by this targeted pass. See survivorship risks below. |
| Event filters | No complete point-in-time event policy verified. |
| Profit target | No validated THETA target extracted. |
| Stop / roll | Missing features are ffilled/fillna(0), RSI may default50 and missing VIX9D may use VIX. These substitutions fabricate neutral knowledge. |
| Assignment policy | No complete assignment policy verified. |
| Recovery | No calibrated assignment-recovery policy demonstrated in inspected source. |
| Covered-call policy | No THETA-compatible CC policy established. |
| Sizing | Missing features are ffilled/fillna(0), RSI may default50 and missing VIX9D may use VIX. These substitutions fabricate neutral knowledge. |
| Claimed win rate | Not adopted or represented as verified. No comparable Managed Episode evidence established. |
| Claimed return | Not adopted or represented as verified. |
| Evidence quality | File-level methods/failure cases only. External suites not executed. |
| Backtest quality | TimeSeriesSplit alone cannot fix stale/current options context, symbol grouping or overlapping labels. No untouched-OOS Wheel economics proven. |
| Look-ahead / survivorship | Current-chain data attached to stock-history modeling requires explicit date proof before historical use. User-selected current tickers and provider history do not establish point-in-time universe. |
| Weaknesses | README/notebook academic-return rhetoric is not repository performance proof. Large volume does not identify initiator, opening/closing or dealer inventory. |
| THETA relevance / action | Optionomics feature-family contracts and dataset lineage. REFERENCE_ONLY. No model, threshold or performance claim adopted. |

## Other reviewed repositories

optopsy and lambdaclass supply evaluators/strategy representations, not a single validated trading policy. QuantLib and LEAN are math/architecture references. FlashAlpha, DealerFlow, puneet, zrack, Bitra and sgdividends provide positioning calculations, which do not define a complete entry/exit/assignment/sizing system. ivsurf provides pricing/validation research. None supplies evidence to switch THETA into all strategies at once.

## Promotion boundary

First test full-H baseline versus one challenger on identical point-in-time data, execution costs and capital rules. Report raw and independent N, managed/whole-chain WR, EV, PF, average win/loss, DD, ES, capital-days, recovery duration, calibration and fill quality. Keep failed folds, delisted names and unresolved stock losses. Only demonstrated incremental benefit warrants integration, followed by real Paper evidence. This catalog changes no strategy parameter or order gate.
