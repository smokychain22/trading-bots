# THETA Optionomics capability census

Status date: 2026-09-14. Documentation contract: [Optionomics public API reference](https://optionomics.ai/docs/api). Authentication contract: `X-USER-EMAIL` plus `X-USER-TOKEN`. Header values are never persisted or logged.

## Contract discovery result

The current public API page contains 41 literal versioned path strings, including concrete examples and their corresponding templates. They reduce to 29 logical operation paths. The Production readiness runner first discovers this page, then probes only discovered, read-only GET routes. Probes run sequentially. POST assessment is never called. Routes needing an identifier from a parent collection remain `BLOCKED_ON_PARENT_IDENTIFIER` until the parent supplies one. A UI or marketing field absent from the public contract remains `UI_ONLY`, `MCP_ONLY`, or `UNAVAILABLE_API`.

The authenticated Production rerun at 2026-09-14T08:26Z persisted 35 capability results. All 35 returned or inherited an HTTP 200 `GOOD` transport state. Rate-limit limit, remaining and reset headers were present on every primary probe except trade-idea track record. Transport health doesn't prove populated feature data. The current SPY chain was populated and contained 12,838 sampled array elements. This is a bounded schema-census count, not a promise that every element is a distinct executable quote. The dated historical chain for 2026-09-07 returned 11,966 direct option observations. Current and dated metrics shared the same schema fingerprint. Dated metrics returned 83 named metric values. The 8h, 24h and 48h historical net-flow windows returned zero points. Historical event context returned two events with two `known_at` timestamps.

| Family | Documented operation paths | Runtime destination | Authenticated status |
|---|---|---|---|
| Authentication/universe | `/api/v1/tickers`, `/api/v1/stocks` | ProviderQualityState, research universe | HTTP 200, 6,118 sampled ticker/stock elements |
| Underlying | `/api/v1/stocks/{symbol}/quote`, `/price_history` | HistoricalContextState | HTTP 200. Current quote payload contained an explicit null, so it is research context only |
| Chain and Greeks | `/api/v1/stocks/{symbol}/options` | ContractIdentity, QuoteObservation, GreekState, VolatilityState, LiquidityState | HTTP 200, populated schema, current schema fingerprint recorded |
| Metrics/exposure | `/metrics`, `/heatmap`, `/levels` | VolatilityState, SkewState, TermStructureState, ExposureState | HTTP 200. Metrics and heatmap populated. Levels returned a valid empty array |
| Flow | `/flow/aggregates`, `/bullish`, `/bearish`, `/top_calls`, `/top_puts`, `/net` | FlowState and CrowdState research | HTTP 200. Aggregates and current net series populated. Dated 8h/24h/48h windows were empty |
| Dark pool | `/dark_pool_levels` | HistoricalContextState | HTTP 200, populated research context |
| Disclosures | `/insider_trades`, `/congress_trades`, `/disclosure_trades`, `/stocks/{symbol}/disclosure_trades` | EventState research | HTTP 200, provenance and lifecycle fields observed |
| News/events | `/news`, `/stocks/{symbol}/news`, `/events`, `/stocks/{symbol}/earning_filings`, `/earning_filings/{id}` | EventState | HTTP 200 for parent routes. ID route remains blocked on a validated parent ID |
| Vendor ideas | `/trade_ideas`, `/trade_ideas/{id}`, `/trade_ideas/track_record`, GET/POST `/trade_ideas/{id}/assessment` | No Production strategy authority | REFERENCE_ONLY. POST rejected |
| Commentary | `/market_commentaries` | HistoricalContextState | REFERENCE_ONLY |

## Authenticated response-schema evidence

Only field names, counts and SHA-256 schema fingerprints are retained here. No response values, account identifiers or credentials are included.

| Capability | Observed field families | Safe schema evidence |
|---|---|---|
| Chain | `bid`, `ask`, sizes, strike, expiry, DTE, IV, delta, gamma, theta, vega, rho, OI, volume, theoretical price, moneyness and exposure fields | Current and historical fingerprint `cef88a5a...50e3d` |
| Metrics | ATM/front/tenor IV, IV rank/percentile, RV, IV-minus-RV, skew, RR25, term slope, expected move, total GEX, delta exposures, gamma flip, walls, max pain and put/call ratios | Current and historical fingerprint `2682dc76...1aa9` |
| Heatmap | symbol, date, metric, strikes, expirations, cells and values | Fingerprint `564ca83d...086f` |
| Flow aggregates | bullish/bearish flow, top calls/puts, total premium and trade count | Fingerprint `ec92cd50...b8b` |
| Net flow | time/value series for net calls and puts | Fingerprint `c8e036be...f283` |
| Events | `known_at`, scheduled time, date, status, importance, region, ticker and pagination | Fingerprint `9fe9fa44...1dc` |
| News | publish/analyze timestamps, tickers, topic, sentiment, confidence and source URL | Fingerprint `cc5baab9...6da0` |

No explicit Vanna or Charm field appeared in the authenticated chain, metrics or heatmap schema samples. No print-level sweep, block, ISO, paid-up or hit-bid schema appeared in the documented flow responses sampled. Those capabilities remain unverified and cannot enter runtime decisions.

## Fields documented on the chain route

The route documents symbol, type, expiration date, strike, price, bid, ask, bid size, ask size, volume, open interest, DTE, IV, delta, gamma, theta, vega, rho, theoretical price, moneyness, gamma-dollar, delta exposure, gamma exposure, notional open interest, IV per day, and IV per trading day. The documented query parameter is `date`.

The previous adapter also sent `limit`, `expiration_date`, `option_type`, `strike_min`, and `strike_max`. Those parameters weren't present in the current operation contract and have been removed. Contract filtering happens locally after a complete provider response. This prevents a guessed request from masquerading as a supported capability.

## Immutable raw observation contract

Migration 029 extends each stored chain observation with:

- request time and response ingestion time
- safe request path and documented parameters
- HTTP status
- rate-limit limit, remaining, reset, and Retry-After metadata
- safe response field-name sample and SHA-256 schema fingerprint for schema discovery, with credential-like names excluded
- documentation reference and contract version
- SHA-256 credential identity reference, never the email or token
- provider session date
- provider timestamp, as-of timestamp, quality state, response hash, and sanitized payload

Raw evidence stays immutable. Normalized and derived features are versioned separately.

## Normalized and derived state

Current implemented state objects cover contract identity, quote observations, Greeks, IV, liquidity, provider exposure scalars, structural CSP economics, raw skew/term/surface evidence, and 8h/24h/48h net-flow windows.

Feature schema v2 adds transparent, non-executable calculations:

```text
Mid = (Bid + Ask) / 2
Spread = Ask - Bid
RelativeSpread = Spread / Mid
PutIntrinsic = max(K - S, 0)
CallIntrinsic = max(S - K, 0)
Extrinsic = RecordedOptionPrice - Intrinsic
CSPBreakeven = K - RecordedBidCredit
DownsideCushion = (S - CSPBreakeven) / S
SecuredCollateral = K * BrokerContractMultiplier
CreditYieldOnCollateral = RecordedBidCredit * Multiplier / SecuredCollateral
ExpectedMoveApprox = S * IV * sqrt(DTE / 365)
ExpectedMoveNormalizedStrikeDistance = abs(S - K) / ExpectedMoveApprox
```

Mid is derived research context and never assumed filled. Credit yield and expected move are comparison features, not alpha and not probability. Capital-day yield remains blocked until a defensible expected-capital-days model exists. Forward log moneyness remains blocked until a point-in-time forward is available. IV/RV comparisons remain blocked unless horizons and units match.

## Missingness and provider semantics

- `KNOWN`, `UNKNOWN`, and `INVALID` are distinct.
- A reported numeric zero stays zero.
- Missing, null, unsupported, stale, not-entitled, malformed, and provider error never become zero.
- Empty arrays prove route reachability only. They don't prove the capability has usable data.
- Flow print classifications don't prove trader intent.
- Provider exposure values don't prove dealer inventory sign.
- Optionomics session-recorded quotes stay `SESSION_RECORDED_RESEARCH` and `executionEligible=false`.

## Rate-limit and cadence policy

- Read-only requests use bounded timeout and at most three attempts for HTTP 429.
- Retry-After accepts integer seconds or an HTTP date.
- No loop retry occurs for authentication, entitlement, malformed response, network ambiguity, or server failure.
- Authenticated census probes run sequentially.
- Immutable historical snapshots should be cached by operation, safe parameters, session date, and payload hash.
- Chain, flow, events, and slow metrics need separate cadence budgets. Current Production cadence by family remains `PARTIAL` until authenticated headers and observed update rates are recorded.

## Feature destination policy

`src/theta/optionomics-feature-destinations.ts` provides a typed, explicit allowlist per branch. THETA_CONVENTIONAL, HOLD_STRIKE, RECOVERY, CC, DEFINED_RISK, MANAGEMENT, and R6_RESEARCH don't receive the same feature set. Crowd evidence is research-only. No feature family can authorize execution or replace AEGIS.

## Historical and backtest boundary

Historical Optionomics observations must retain decision cutoff, session date, strike, expiry, bid/ask, OI, volume, Greeks, IV, event state, contract version, and feature version. Labels are generated later and stored separately. One lifecycle chain cannot cross train and test partitions. Vendor backtest output is a screening comparator only. Canonical proof must be reproduced through THETA's point-in-time export, realistic fill or explicit NO_FILL, whole-chain accounting, walk-forward, OOS, and multiple-testing controls.

## Acceptance receipt

| Receipt item | State | Exact blocker and next action when partial |
|---|---|---|
| `OPTIONOMICS_ENDPOINT_CENSUS` | COMPLETE_WITH_LIMITS | 35 authenticated results persisted. ID-child routes and POST assessment remain deliberately uncalled. |
| `OPTIONOMICS_RAW_OBSERVATION` | COMPLETE | Code: `src/theta/optionomics-provider.ts`, migration 029, persistence store. Production migration applied. |
| `OPTIONOMICS_NORMALIZATION` | COMPLETE_WITH_LIMITS | Chain, quote, Greeks, IV, liquidity, metric, heatmap, aggregate-flow, event, earnings-filing, and symbol-news adapters are implemented for confirmed schemas. Unsupported print-level and Vanna/Charm families remain explicit unknowns. |
| `OPTIONOMICS_CHAIN` | COMPLETE_WITH_LIMITS | Authenticated HTTP 200. Current schema populated. Historical date returned 11,966 direct observations. Session-oriented quote semantics remain non-executable. |
| `OPTIONOMICS_GREEKS` | COMPLETE_IN_CODE | Provider units still need authenticated documentation confirmation before independent discrepancy thresholds. |
| `OPTIONOMICS_VOLATILITY` | PARTIAL | IV rank, percentile, RV and related metric fields are normalized with provider-reported units marked unverified. Horizon, unit and availability-time contracts still block economic interpretation. |
| `OPTIONOMICS_SKEW` | PARTIAL | Raw 25-delta research difference implemented. Historical z-score requires PIT history. |
| `OPTIONOMICS_TERM` | PARTIAL | Expiry IV difference implemented. Total and forward variance require defensible tenor selection and day count. |
| `OPTIONOMICS_SURFACE` | PARTIAL | Raw strike-expiry IV grid implemented. SVI/SSVI fit and arbitrage diagnostics stay R6 challengers. |
| `OPTIONOMICS_GEX` | PARTIAL | Authenticated metrics expose total/call/put gamma exposure, gamma flip and walls. Definition, sign and units remain unverified. |
| `OPTIONOMICS_DEX` | PARTIAL | Authenticated metrics expose call/put delta exposure and total DDE. DEX naming, definition and units remain unverified. |
| `OPTIONOMICS_VANNA` | UNAVAILABLE_API | No explicit Vanna field appeared in authenticated public response schemas. Exact missing capability: a documented field, units and timestamp contract. |
| `OPTIONOMICS_CHARM` | UNAVAILABLE_API | No explicit Charm field appeared in authenticated public response schemas. Exact missing capability: a documented field, units and timestamp contract. |
| `OPTIONOMICS_FLOW` | PARTIAL | Aggregate and net-series schemas are normalized and cycle-integrated. Print-level sweep/block/ISO/aggressor schemas remain unavailable in the sampled public contract. |
| `OPTIONOMICS_CROWD` | RESEARCH_ONLY_PARTIAL | Typed destination exists. No validated crowd model. |
| `OPTIONOMICS_EVENTS` | PARTIAL | Events, earnings filings, and symbol news are normalized and cycle-integrated with publication fields retained. Upcoming earnings distance, ex-dividend coverage, and full publication-time guarantees remain unverified. |
| `OPTIONOMICS_HISTORICAL` | PARTIAL | Dated chain/metrics/flow/events probes exist. Bulk archive contract and retention cadence remain unverified. |
| `OPTIONOMICS_BACKTEST_BRIDGE` | PARTIAL | THETA deterministic export exists. Vendor backtest import/reproduction mapping isn't complete. |
| `OPTIONOMICS_FEATURE_DESTINATION_MAP` | COMPLETE_IN_CODE | Typed allowlists added and tested. |
| `OPTIONOMICS_MISSINGNESS_POLICY` | COMPLETE_IN_CODE | UNKNOWN-safe parser and feature states tested. |
| `OPTIONOMICS_PROVENANCE` | COMPLETE | Migration 029 applied and invariants verified in Production. |
| `OPTIONOMICS_RATE_LIMIT_POLICY` | PARTIAL | Bounded 429 retry, header capture, sequential calls, per-family cadence, and a per-cycle request cap are implemented. Durable cross-cycle caching and empirically tuned cadence remain open. |
| `OPTIONOMICS_PIT_SAFETY` | PARTIAL | Raw/feature/label separation exists. Full historical availability-time proof remains a data-contract blocker. |
| `OPTIONOMICS_QUOTE_INTELLIGENCE_READY` | YES_WITH_LIMITS | Recorded two-sided research observations can inform research only. |
| `OPTIONOMICS_EXECUTION_QUOTE_STATUS` | REJECTED | Provider docs describe session-oriented research data, not an execution feed. Qualification guard remains locked. |
| `GITHUB_REFERENCE_METHODS_REVIEWED` | 12_REPOS_FILE_LEVEL | See `THETA_PROFESSIONAL_REFERENCE_PACK_2026-09-14.md`. |
| `NEW_OPTIONOMICS_RUNTIME_PROVIDER_REQUIRED` | NO | No new generic provider added. Execution quote authority remains a separate unresolved contract. |

This receipt does not authorize a Paper order. `READY_FOR_FIRST_PAPER_ORDER = NO` until every independent execution gate passes.
