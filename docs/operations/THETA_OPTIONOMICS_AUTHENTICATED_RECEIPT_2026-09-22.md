# Optionomics authenticated capability receipt, 2026-09-22

This is a sanitized, read-only account probe from canonical source `1bcf85448c8685fb7eeb823f5532b1fa2c9c1449` on 2026-09-22 at 13:16 UTC. Authentication used the existing process environment. No credential value, account email, raw payload, or provider session token is recorded here. Optionomics is research/analytics authority only. Alpaca remains Paper broker and current executable quote authority.

The [public API reference](https://optionomics.ai/docs/api) documents 30 REST endpoints, session-oriented options analytics, 1,000 requests/minute, and separate MCP access. The authenticated header-pair probe returned 23 MCP tools. A 200 response proves this account can call the operation, not that its result is complete enough for every THETA consumer.

| Operation family | Authenticated result | Served-session or completeness observation | THETA disposition |
| --- | --- | --- | --- |
| Current options and metrics | HTTP 200, populated | Served `2026-09-22` | Qualified for schema inspection, not execution pricing |
| Historical options and metrics | HTTP 200, populated | Requested and served `2026-09-18` matched | PIT research input, subject to original observation timing |
| Price history | HTTP 200, populated | Trading-session candles returned; the response has no top-level served date | Research history, verify each candle date |
| Gamma, vanna and charm heatmaps | HTTP 200, populated | Returned metric matched each requested metric | Research exposure context, never dealer inventory truth |
| Aggregate and net flow | HTTP 200, populated | No top-level provider timestamp was established by this probe | Context pending field-level timing/units qualification |
| Flow levels | HTTP 200, empty levels | Empty level set only, not provider failure | Valid empty result for this operation |
| Dark-pool levels | HTTP 200, populated | Timestamp semantics still require row inspection | Research context |
| Events, company catalyst and historical events | HTTP 200, zero rows for tested SPY windows, page complete | A complete page is not proof of a complete company/earnings calendar | Macro/Fed and company negative assurance remain separate |
| Symbol news and disclosures | HTTP 200, populated | Tested pages were incomplete | Pagination required before consumer completeness |
| Earnings filing analyses | HTTP 200, populated | Historical filing analyses, not a future earnings schedule | Do not clear prospective earnings UNKNOWN |

The current [events contract](https://optionomics.ai/docs/api) says `company_catalyst` is accepted but reserved and that today's feed populates macro, Fed and filing. The current metrics contract exposes `expected_moves.earnings_in_sessions`, and authenticated AAPL and MSFT metrics returned numeric values on the tested session. That field is a provider-derived trading-session distance. This probe did not establish its source announcement time, complete future earnings coverage, or a calendar-day conversion. It can be retained as research context, but an empty company-event result cannot become `eventNear=false` or a known absence of earnings.

Read-only Aiven inspection of `market.optionomics_event_first_observation` found six rows with six distinct provider event IDs. Five are market-wide macro events and one is market-wide Fed. All six have a provider-known time before THETA's first-observed time on 2026-09-21, and a scheduled time after that first observation. Their stored PIT timing state is `TIMING_VALID`. There are zero ticker-scoped rows and no same-ID revision in this six-row sample. These rows support forward macro/Fed context only. They do not close company earnings, ticker event proximity, or corporate-action negative coverage.

Current source already guards the documented `total_gex=0` sentinel, documented permanent legacy-null metrics, strict numeric-string parsing, requested/served dates, heatmap metric echo, and the deprecated `iv_per_day` field. The probe did not prove end-to-end persistence or runtime consumption of every capability. Aiven was still read-only, so this receipt was not written to Aiven and no worker cutover occurred.

Next required proof: inspect raw field-level timestamps and units in a bounded sanitized operation, establish PIT event/corporate-action coverage independently, persist a capability observation after database recovery, then test current-worker consumers with new risk locked. No Paper order was submitted by this probe.

## 2026-09-22 earnings-distance follow-up

Read-only authenticated `GET /api/v1/stocks/AAPL/metrics?date=...` calls returned HTTP 200 with exact requested/served sessions. `metrics.expected_moves.earnings_in_sessions` was 30 on September 18, 29 on September 21, and 28 on September 22. A current SPY metrics response returned this field as null. None of these four responses exposed a top-level provider timestamp. These are provider-reported session distances, not a THETA-observed calendar of all future company events. The normalized metrics adapter now retains the distance as a strict nonnegative integer, preserves null as UNKNOWN and malformed values as INVALID, and explicitly labels its authority `POSITIVE_DISTANCE_ONLY_NO_NEGATIVE_ASSURANCE`.

The [current public API reference](https://optionomics.ai/docs/api) documents that the `company_catalyst` events kind is accepted but reserved, while today's event feed populates macro, Fed and filing. The [Market Calendar feature](https://docs.optionomics.ai/features/calendar/) displays future earnings in the product UI, but the current public REST reference does not establish a complete, supported future-earnings-calendar endpoint. The authenticated metrics field can inform research and positive proximity when its timing is valid. It cannot establish `eventNear=false` or a complete negative earnings window. No execution or safety gate was changed.

The latest persisted authenticated MCP catalog has 23 tools. It contains `events`, `earnings_analyses`, `option_metrics`, `market_overview`, and other research operations, but no calendar or future-earnings search tool. `earnings_analyses` describes filed results, not complete future schedules. The current supported REST and MCP developer surfaces therefore remain `PROVIDER_LIMITED` for a bounded negative future-company-earnings assertion. This conclusion can be revisited if the provider publishes a new supported operation or its actual account contract changes.
