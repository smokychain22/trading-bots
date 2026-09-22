# THETA provider capability matrix

Status: Slice 9 of the pre-VPS master continuation directive. Alpaca
findings are grounded in an exhaustive read of `src/theta/alpaca-provider.ts`
(493 lines) plus `src/execution/broker.ts` (order mutation). Optionomics
findings are grounded in **real MCP tool calls made this session** against
real, liquid symbols (AAPL/SPY/TSLA) and real completed historical sessions
-- every value below is an actual tool response, never simulated.

## Alpaca

| Capability | Endpoint/operation | Live/Session | Current/Historical | PIT-safe | Execution authority | Negative-coverage | Freshness policy | Error handling |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Market clock | `GET /v2/clock` (`fetchMarketClock`) | Live | Current | Yes | No | N/A | Real-time, no cache | Typed `AlpacaProviderError` classes |
| Market calendar | `GET /v2/calendar` | Session | Both | Yes | No | Positive-only | N/A | Same |
| Account | `GET /v2/account` (`fetchMasterAccountSnapshot`) | Live | Current | Yes | No | N/A | Real-time | Same; account ID masked to last-4 |
| Positions | `GET /v2/positions` (`fetchPositions`) | Live | Current | Yes | No (read-only) | N/A | Real-time | Same |
| Open orders | `GET /v2/orders?status=open` (`fetchOpenOrders`) | Live | Current | Yes | No (read-only) | N/A | Real-time | Same |
| **Order submission/replace/cancel** | `POST`/`PATCH`/`DELETE /v2/orders` -- lives in **`src/execution/broker.ts:274-282`**, not `alpaca-provider.ts` -- gated by `assertBrokerMutationAuthorized(...)` on every call | Live | Current | N/A | **YES -- real, gated mutation capability, idempotent via `client_order_id`** | N/A | N/A | `AlpacaPaperBrokerError` incl. `AMBIGUOUS_NETWORK` for a lost-response mutation (correctly distinct from a clean read failure) |
| Fills/activities | `GET /v2/account/activities` (bounded 20-page pagination) | Live | Historical | Yes | No (read-only) | N/A | Real-time | Throws rather than silently truncating past the bound |
| Option contracts (chain discovery) | `GET /v2/options/contracts` (`fetchOptionContracts`) | Live | Current (`status=active`) | Yes | No | **No -- cannot prove a contract does NOT exist, only lists what's returned** | Real-time, paginated with explicit `complete: false` if bound hit | Throws `MALFORMED_RESPONSE` on invalid contract identity |
| Option BBO/Greeks/IV (snapshot) | `GET /v1beta1/options/snapshots/{symbol}` (feed `opra`/`indicative`) | Live | Current | Yes | No | Positive-only | Real-time, paginated | Same |
| Delta (option) | Same snapshot endpoint (`greeks.delta`) | Live | Current | Yes | No | Same | Same | `greeks: null` when Alpaca omits the object -- never coerced to 0 |
| Stock quote (BBO) | `GET /v2/stocks/{symbol}/quotes/latest` (feed `iex`/`sip`) | Live | Current | Yes | No | N/A | Real-time | Throws if `quote` key absent |
| Stock bars (history) | `GET /v2/stocks/bars` | Session | Historical | Yes | No | N/A | Explicit `adjustment` param required (raw/split/dividend/all) -- forced-explicit, not a hidden default | Same |
| Tradable-asset universe | `GET /v2/assets?status=active&asset_class=us_equity` | Live | Current | Yes | No | N/A | Not paginated (Alpaca's own behavior); client-side truncation honestly reported via `complete: false` | Same |
| Corporate actions | Lives in `src/theta/alpaca-corporate-action-evidence.ts` (confirmed real, persisted, in a prior pass); not re-read this pass | -- | -- | -- | -- | -- | -- | -- |
| Dividends | Not found in `alpaca-provider.ts`; not independently located elsewhere this pass | PROVIDER_LIMITED (unconfirmed location) | -- | -- | -- | -- | -- | -- |
| Macro events / earnings / IV rank/percentile / RV / VRP / skew / term structure / expected move / GEX / Vanna / Charm / flow | Not covered by Alpaca -- Alpaca only returns a per-contract scalar `impliedVolatility` from the snapshot endpoint, never term structure/rank/percentile/skew/flow | **PROVIDER_LIMITED for Alpaca** -- this is Optionomics's domain | -- | -- | -- | -- | -- | -- |

**Correction to an earlier-pass claim**: a prior doc comment
(`theta-shadow-once.ts:19`) stated "the only /v2/orders reference in the
whole provider layer is fetchOpenOrders, a read-only GET." That is true only
of `alpaca-provider.ts` specifically -- a real, gated order-submission/
replace/cancel capability exists in the separate `src/execution/broker.ts`
module. The original claim was correct as narrowly scoped but reads more
broadly than it is; a future reader could mistake it for "THETA has no
order-submission code anywhere," which is false -- order submission is real,
exists, and is correctly gated and kept separate from the read-only
data-provider layer.

## Optionomics (real MCP calls, this session)

| Capability | Tool | Real example (AAPL, a real completed session) | PIT-safe | Negative-coverage | Notes |
| --- | --- | --- | --- | --- | --- |
| IV (atm/30/60/90) | `iv_term_structure` | `atm_iv:0.2627, iv30:0.2628, iv60:null, iv90:null` | Yes -- a real weekend-date call returned an explicit `{"error":"No option chain data for AAPL"}` rather than silently substituting the nearest trading day | Positive-only | `iv60`/`iv90` null for AAPL this date, `term_structure.state:"unknown"` -- a real PARTIAL_COVERAGE case, not a defect |
| IV rank/percentile | `iv_term_structure`/`option_metrics` | `iv_rank:24.68, iv_percentile:58.4` | Yes | Positive-only | Present and populated in every call made |
| RV20 | `iv_term_structure` (`realized_vs_implied.rv20`) | `0.2112` | Yes | Positive-only | Only RV window directly exposed by name |
| RV5/RV10/RV30/RV60 | No dedicated field found; `price_history`'s `summary.realized_volatility_percent` (parameterized by `days`) is a plausible but **unverified** substitute -- tested `days=5/30/60` and got real numbers, but this is a different computation path than `rv20` and was not confirmed to use the same methodology | -- | -- | **PROVIDER_LIMITED / NEEDS_DERIVATION** -- do not treat as interchangeable with `rv20` without further verification |
| `iv_minus_rv20` | `iv_term_structure` (`realized_vs_implied.spread`) | `0.0516` (arithmetic-verified: `0.2628 − 0.2112 = 0.0516`) | Yes | Positive-only | Field is named `spread`, not `iv_minus_rv20` -- a consumer must map it |
| Skew | `iv_term_structure` (`skew` object) | `calendar_skew:0.0736, gamma_skew:4505038.56, rr25:0.0086, tail_risk_indicator:1.225` | Yes | Positive-only | Four distinct skew measures bundled -- ambiguous which is "the" skew for a consumer; must be resolved explicitly, never assumed |
| Term structure | `iv_term_structure` (`term_structure` object) | `state:"unknown"` (AAPL) vs. `state:"contango"` (SPY, real full 30/60/90 curve) | Yes | Positive-only | `state` correctly reflects real coverage gaps |
| Expected move | **NOT_OBSERVED** -- no field named `expected_move` or an obvious equivalent found in `iv_term_structure`, `option_metrics`, `gamma_exposure`, or `options_chain` this pass | -- | -- | -- | May exist under an unchecked name; needs targeted follow-up |
| Max pain | `option_metrics` | `max_pain_strike:320.0, max_pain_sentiment:"neutral"` | Yes | Positive-only | Real, present in every call |
| `call_wall`/`put_wall` | `option_metrics` | AAPL: 320.0/300.0; SPY: 770.0/765.0; TSLA: 400.0/350.0 (real, date-consistent, across 3 symbols/sessions) | Yes (date-consistent) | Positive-only | **STANDING QUARANTINE MAINTAINED** -- plausible values across 3 real symbols do not, by themselves, constitute the independent corroboration this quarantine requires to lift |
| GEX | `gamma_exposure` | `net_gex:201584934.8, gamma_regime:"positive_gamma"`, per-strike `levels[]` with `type:"resistance"`/`strength`/`net_gex` | Yes (`metadata.trading_date` + `calculation_time`) | Positive-only | Includes an `inferred_dealer_positioning` narrative -- a MODELED interpretation, not raw data; qualify as `PLAUSIBLE_NOT_INDEPENDENTLY_VERIFIED` if ever consumed |
| **Vanna** | **NOT_COVERED** -- confirmed absent from `option_metrics`, `gamma_exposure`, and `options_chain` schemas this session | -- | -- | -- | Genuine provider gap, not a THETA wiring defect |
| **Charm** | **NOT_COVERED** -- same confirmation | -- | -- | -- | Genuine provider gap |
| Flow | `net_flow` | `net_call_flow`/`net_put_flow` per-timestamp series | Yes (date param honored) | Positive-only | Real, works as documented |
| Greeks (delta/gamma/theta/vega) per-contract | `options_chain` | Real chain rows, e.g. delta `-0.0007423990111845946` for a deep-OTM put | Yes | **Positive AND a real negative case observed**: 2 of 3 real contracts had `delta/gamma/theta/vega/implied_volatility: null` (far-dated, near-zero-bid, illiquid) -- correctly reported `null`, never fabricated | -- |
| Earnings / SEC filings | `earnings_analyses` | A real filing with `"status":"failed","has_analysis":false"` alongside a real analyzed 10-Q with full sentiment/financials | Yes (`filed_at` timestamps) | -- | A real provider-side analysis FAILURE surfaced honestly, not silently dropped -- a good counter-example against `PROVIDER_ERROR_MASKING` |
| Macro/Fed/earnings-calendar events | `events` (kind filter: `macro, filing, fed, treasury, commodity, company_catalyst`) | Real AAPL 8-K filing event returned for a real recent window | Yes (`scheduled_at`) | Positive-only | `kind` does NOT include a `dividend` option |
| Dividends | **NOT_COVERED by Optionomics** | -- | -- | -- | Confirmed via the `events` kind enumeration above |
| Dark pool / support-resistance levels | `dark_pool_levels`, `support_resistance_levels` | Not called this pass (time-bounded) | -- | -- | Untested this pass, not confirmed working or broken |

## Most important findings

1. **A real, gated order-submission capability exists** (`src/execution/broker.ts:274-282`), separate from the read-only data-provider layer -- a prior-pass claim implying no order-submission code exists anywhere was correct only as narrowly scoped to `alpaca-provider.ts`; worth tightening that wording if the doc is revisited.
2. **Optionomics correctly refuses a non-trading-day date** rather than silently substituting the nearest session -- strong, directly-observed positive PIT-safety evidence.
3. **Vanna and Charm are confirmed genuinely absent** from Optionomics across every relevant tool checked -- a real provider limitation, not a THETA wiring defect. Any future capability-matrix row claiming Vanna/Charm coverage would be false.
4. **RV5/RV10/RV30/RV60 are not directly served** under those names -- only `rv20` is native; `price_history`'s day-parameterized figure is a plausible but methodologically-unverified substitute and must not be silently treated as equivalent.
5. **`options_chain` correctly returns `null` Greeks/IV for illiquid contracts** while still returning bid/ask/volume/open interest -- a well-behaved negative-coverage/partial-data example, the kind of honest degradation this whole audit is looking for more of.
