# THETA execution-quote fallback decision

Status date: 2026-09-17

Decision state: `EXTERNAL_QUOTE_BLOCKER`

No additional runtime provider is approved by this document. It records the evidence needed for an explicit provider decision.

## Current Production evidence

An authenticated open-session Optionomics qualification ran against SPY, QQQ, and AAPL. Six `OPTION_CHAIN` calls returned HTTP 200. The responses contained 50,656 valid two-sided observations, but zero observations had a provider timestamp inside the 15-second execution window.

The result is:

- `OPTIONOMICS_PRODUCTION_AUTH = PASS`
- `OPTIONOMICS_INTELLIGENCE = READY`
- `OPTIONOMICS_EXECUTION_QUOTE = UNQUALIFIED`
- blockers: `NO_FRESH_PROVIDER_TIMESTAMPS`, `PROVIDER_DOCUMENTS_SESSION_INGESTION_NOT_EXECUTION_FEED`, `ORDER_PRICING_USE_NOT_DOCUMENTED`

HTTP receipt time is ingestion evidence only. It is not a substitute for a provider observation timestamp.

Alpaca Basic remains `ALPACA_INDICATIVE`. THETA may use it for cross-checking, research, and degradation detection. Its semantic class is `INDICATIVE`, and it cannot pass the execution-price qualifier.

## Candidate provider paths

| Path | Exact option contract | Bid/ask and sizes | Provider timestamp / stream | Account or entitlement requirement | Current decision |
| --- | --- | --- | --- | --- | --- |
| Alpaca OPRA | OCC-symbol option snapshots and stream | OPRA quote messages provide the option BBO fields supported by Alpaca's option market-data contract | REST quote timestamps and real-time WebSocket feed | Alpaca Algo Trader Plus currently documents OPRA for options. The current account returned HTTP 403 for OPRA | Preferred smallest architecture change because broker and quote authority remain Alpaca. Requires owner subscription action and a fresh entitlement proof |
| Tradier Brokerage production data | Standard OCC symbology | Quote schema documents bid, ask, bid size, ask size, bid date, and ask date. Streaming quote events document the same core fields | Production request/response and WebSocket streaming | A Tradier Brokerage account is required for real-time US option data. Sandbox data is delayed | Technically credible fallback. Adds a third runtime provider and separate brokerage identity, so it requires an architecture decision |
| tastytrade dxFeed | tastytrade instrument discovery supplies the streamer symbol | DXLink Quote events document bid price, ask price, bid size, and ask size. Separate Greeks and Summary events are available | Real-time DXLink WebSocket using a 24-hour quote token | Fully onboarded tastytrade customer and OAuth session required | Technically credible fallback. Requires symbol normalization, token refresh, streaming state, licensing review, and explicit provider approval |
| IBKR | IBKR conid identity mapped from an option contract | Top-of-book fields include bid price, ask price, bid size, and ask size | HTTP snapshots and WebSocket market data with update metadata | Authorized brokerage session, option trading permission, and relevant live market-data subscriptions. Account equity and subscription fees may apply | Capable but operationally heavier. Session constraints and a second broker identity make it the least direct first-canary path |

Official references:

- Alpaca, real-time option data: https://docs.alpaca.markets/us/docs/real-time-option-data
- Alpaca, market-data plan comparison: https://docs.alpaca.markets/us/docs/about-market-data-api
- Tradier, market data: https://docs.tradier.com/docs/market-data
- Tradier, quote schema: https://docs.tradier.com/docs/quotes
- Tradier, streaming: https://docs.tradier.com/docs/streaming
- tastytrade, API quote token: https://developer.tastytrade.com/reference/accounts-and-customers/getApiQuoteTokens/
- tastytrade, DXLink guide: https://developer.tastytrade.com/docs/guides/stream-market-data/
- IBKR, Web API market-data requirements: https://www.interactivebrokers.com/campus/ibkr-api-page/web-api-trading/
- IBKR, market-data subscriptions: https://www.interactivebrokers.com/campus/trading-lessons/subscribing-to-data/

## Recommendation

The shortest safe path is Alpaca OPRA entitlement because the adapter, exact OCC identity, Paper account, reconciliation, and execution boundary already exist. Tradier is the strongest documented independent fallback if Alpaca OPRA is not approved. No credential, account, or subscription for either path is currently present, so neither may be represented as ready.

The gate remains closed until one source proves, from an authenticated live-session response:

1. exact expected OCC contract identity,
2. positive bid and ask with bid no greater than ask,
3. sizes when the provider contract supplies them,
4. provider timestamp at or before receipt time,
5. quote age inside the versioned maximum,
6. documented order-pricing semantics,
7. stable connection and entitlement,
8. explicit provenance and schema version.

`FOLLOWER_EXECUTION = LOCKED`

`LIVE_MONEY_AUTHORIZED = NO`
