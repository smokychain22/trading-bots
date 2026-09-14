# THETA Optionomics capability census

Status date: 2026-09-14. Documentation contract: [Optionomics public API reference](https://optionomics.ai/docs/api). Authentication contract: `X-USER-EMAIL` plus `X-USER-TOKEN`. Header values are never persisted or logged.

## Contract discovery result

The current public API page exposes 29 unique versioned paths. The Production readiness runner first discovers this page, then probes only discovered, read-only GET routes. Probes run sequentially. POST assessment is never called. Routes needing an identifier from a parent collection remain `BLOCKED_ON_PARENT_IDENTIFIER` until the parent supplies one. A UI or marketing field absent from the public contract remains `UI_ONLY`, `MCP_ONLY`, or `UNAVAILABLE_API`.

| Family | Documented operation paths | Runtime destination | Current status before authenticated Production rerun |
|---|---|---|---|
| Authentication/universe | `/api/v1/tickers`, `/api/v1/stocks` | ProviderQualityState, research universe | CONTRACT_DISCOVERED |
| Underlying | `/api/v1/stocks/{symbol}/quote`, `/price_history` | HistoricalContextState | CONTRACT_DISCOVERED, research only |
| Chain and Greeks | `/api/v1/stocks/{symbol}/options` | ContractIdentity, QuoteObservation, GreekState, VolatilityState, LiquidityState | IMPLEMENTED, authenticated rerun required |
| Metrics/exposure | `/metrics`, `/heatmap`, `/levels` | VolatilityState, SkewState, TermStructureState, ExposureState | CONTRACT_DISCOVERED, response-schema census required |
| Flow | `/flow/aggregates`, `/bullish`, `/bearish`, `/top_calls`, `/top_puts`, `/net` | FlowState and CrowdState research | PARTIAL. Net windows implemented. Other response schemas require census |
| Dark pool | `/dark_pool_levels` | HistoricalContextState | CONTRACT_DISCOVERED, research only |
| Disclosures | `/insider_trades`, `/congress_trades`, `/disclosure_trades`, `/stocks/{symbol}/disclosure_trades` | EventState research | CONTRACT_DISCOVERED |
| News/events | `/news`, `/stocks/{symbol}/news`, `/events`, `/stocks/{symbol}/earning_filings`, `/earning_filings/{id}` | EventState | CONTRACT_DISCOVERED. ID route blocked on parent ID |
| Vendor ideas | `/trade_ideas`, `/trade_ideas/{id}`, `/trade_ideas/track_record`, GET/POST `/trade_ideas/{id}/assessment` | No Production strategy authority | REFERENCE_ONLY. POST rejected |
| Commentary | `/market_commentaries` | HistoricalContextState | REFERENCE_ONLY |

## Fields documented on the chain route

The route documents symbol, type, expiration date, strike, price, bid, ask, bid size, ask size, volume, open interest, DTE, IV, delta, gamma, theta, vega, rho, theoretical price, moneyness, gamma-dollar, delta exposure, gamma exposure, notional open interest, IV per day, and IV per trading day. The documented query parameter is `date`.

The previous adapter also sent `limit`, `expiration_date`, `option_type`, `strike_min`, and `strike_max`. Those parameters weren't present in the current operation contract and have been removed. Contract filtering happens locally after a complete provider response. This prevents a guessed request from masquerading as a supported capability.

## Immutable raw observation contract

Migration 029 extends each stored chain observation with:

- request time and response ingestion time
- safe request path and documented parameters
- HTTP status
- rate-limit limit, remaining, reset, and Retry-After metadata
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
| `OPTIONOMICS_ENDPOINT_CENSUS` | PARTIAL | Code: `src/providers/readiness.ts`. Current docs routes are discovered and safe GET probes expanded. Deploy and rerun with encrypted Production credential to persist actual statuses and schemas. |
| `OPTIONOMICS_RAW_OBSERVATION` | COMPLETE_IN_CODE | Code: `src/theta/optionomics-provider.ts`, migration 029, persistence store. Production migration required. |
| `OPTIONOMICS_NORMALIZATION` | PARTIAL | Chain, quote, Greeks, IV, liquidity and provider exposure scalars implemented. Dedicated crowd, event and full metric response normalizers await authenticated schemas. |
| `OPTIONOMICS_CHAIN` | COMPLETE_IN_CODE | Authenticated Production evidence must be refreshed after deployment. |
| `OPTIONOMICS_GREEKS` | COMPLETE_IN_CODE | Provider units still need authenticated documentation confirmation before independent discrepancy thresholds. |
| `OPTIONOMICS_VOLATILITY` | PARTIAL | Contract IV implemented. IV rank, percentile, RV and vol-of-vol require verified fields and horizons. |
| `OPTIONOMICS_SKEW` | PARTIAL | Raw 25-delta research difference implemented. Historical z-score requires PIT history. |
| `OPTIONOMICS_TERM` | PARTIAL | Expiry IV difference implemented. Total and forward variance require defensible tenor selection and day count. |
| `OPTIONOMICS_SURFACE` | PARTIAL | Raw strike-expiry IV grid implemented. SVI/SSVI fit and arbitrage diagnostics stay R6 challengers. |
| `OPTIONOMICS_GEX` | PARTIAL | Provider contract scalar retained. Definition/sign/units census required. |
| `OPTIONOMICS_DEX` | PARTIAL | Provider scalar retained. Definition/units census required. |
| `OPTIONOMICS_VANNA` | PARTIAL | Documented capability needs authenticated response proof and normalizer. |
| `OPTIONOMICS_CHARM` | PARTIAL | Documented capability needs authenticated response proof and normalizer. |
| `OPTIONOMICS_FLOW` | PARTIAL | Net-flow windows preserved without sentiment. Print-level sweep/block/ISO/aggressor schemas require authenticated proof. |
| `OPTIONOMICS_CROWD` | RESEARCH_ONLY_PARTIAL | Typed destination exists. No validated crowd model. |
| `OPTIONOMICS_EVENTS` | PARTIAL | Routes discovered. Point-in-time `known_at`, earnings and ex-dividend coverage need authenticated schema validation. |
| `OPTIONOMICS_HISTORICAL` | PARTIAL | Dated chain/metrics/flow/events probes exist. Bulk archive contract and retention cadence remain unverified. |
| `OPTIONOMICS_BACKTEST_BRIDGE` | PARTIAL | THETA deterministic export exists. Vendor backtest import/reproduction mapping isn't complete. |
| `OPTIONOMICS_FEATURE_DESTINATION_MAP` | COMPLETE_IN_CODE | Typed allowlists added and tested. |
| `OPTIONOMICS_MISSINGNESS_POLICY` | COMPLETE_IN_CODE | UNKNOWN-safe parser and feature states tested. |
| `OPTIONOMICS_PROVENANCE` | COMPLETE_IN_CODE | Migration 029 must be applied in Production. |
| `OPTIONOMICS_RATE_LIMIT_POLICY` | PARTIAL | Bounded 429 retry and headers implemented. Per-family observed budgets require Production census. |
| `OPTIONOMICS_PIT_SAFETY` | PARTIAL | Raw/feature/label separation exists. Full historical availability-time proof remains a data-contract blocker. |
| `OPTIONOMICS_QUOTE_INTELLIGENCE_READY` | YES_WITH_LIMITS | Recorded two-sided research observations can inform research only. |
| `OPTIONOMICS_EXECUTION_QUOTE_STATUS` | REJECTED | Provider docs describe session-oriented research data, not an execution feed. Qualification guard remains locked. |
| `GITHUB_REFERENCE_METHODS_REVIEWED` | 12_REPOS_FILE_LEVEL | See `THETA_PROFESSIONAL_REFERENCE_PACK_2026-09-14.md`. |
| `NEW_OPTIONOMICS_RUNTIME_PROVIDER_REQUIRED` | NO | No new generic provider added. Execution quote authority remains a separate unresolved contract. |

This receipt does not authorize a Paper order. `READY_FOR_FIRST_PAPER_ORDER = NO` until every independent execution gate passes.
