# R7 Paper-entry evidence review, 2026-09-21

This is a sanitized source and provider receipt. It does not authorize Paper entry, follower orders, or live trading. The deployed worker remains on `853beb4fde989c2f6deb83ad9cb13a9a3e87e76a` with new risk locked until a separate tested release.

## Six immutable Optionomics event revisions

The protected Aiven inspection joined each `market.optionomics_event_first_observation` row to its raw provider observation and FusionSnapshot. All six came from one `optionomics.list_events` response ingested at `2026-09-21T14:00:24.787Z`, before the `2026-09-21T14:00:25.325Z` decision. Raw quality was `GOOD`, PIT timing was `TIMING_VALID`, and each scheduled time was after the decision. The provider response carried no independent response timestamp, so THETA's ingestion/first-seen time is the usable local boundary. The provider's `known_at` dates are preserved as separate claims, not backdated THETA observation times.

| Event identity hash prefix | Kind | Scheduled UTC | Provider known UTC | Revision | Forward at THETA decision? |
| --- | --- | --- | --- | ---: | --- |
| `4af6fac1` | fed | 2026-10-28 18:00 | 2026-08-07 14:15 | 1 | Yes |
| `188e761b` | macro | 2026-09-30 12:30 | 2026-08-31 04:15 | 1 | Yes |
| `d21d8bcb` | macro | 2026-10-15 12:30 | 2026-09-15 04:15 | 1 | Yes |
| `7f796edd` | macro | 2026-10-15 12:30 | 2026-09-15 04:15 | 1 | Yes |
| `ce9640d9` | macro | 2026-10-14 12:30 | 2026-09-14 04:15 | 1 | Yes |
| `be834592` | macro | 2026-10-02 12:30 | 2026-09-02 04:15 | 1 | Yes |

The October 15 rows have distinct provider-event hashes. They are not a demonstrated revision of one event. All six have `ticker=null`. They support bounded market-wide event research, not company earnings coverage or ticker-level negative event evidence.

## Prospective event and earnings semantics

Authenticated Vega qualification reached REST and MCP. MCP listed 23 tools. `events` accepts a kind and optional symbol/date window; `earnings_analyses` lists filings by symbol/form. REST `/api/v1/events` is a prospective feed for populated macro/Fed/filing families. Its documented `company_catalyst` filter is reserved and not currently populated. `/api/v1/stocks/{symbol}/earning_filings` and MCP `earnings_analyses` return historical analyzed filings. The Optionomics UI calendar displays prospective company earnings, but a supported complete future earnings REST/MCP search has not been established. An authenticated empty result is not a certified absence. Macro/Fed coverage remains separate from company/earnings coverage.

The qualification now explicitly probes the documented company-catalyst filter. Its actual response must be checked after deployment. This probe cannot itself establish completeness of future company coverage.

## Alpaca corporate actions

The positive producer requests `GET https://data.alpaca.markets/v1/corporate-actions` for governed proposed/open symbols, a bounded 45-day process-date window, `data_quality=all`, and up to five 1,000-row pages. It validates the symbol and page chain, preserves each positive family/payload revision with a hash and THETA first-observed timestamp, and stores a separate immutable query receipt. Provider-known time remains UNKNOWN because the endpoint does not supply a guaranteed publication timestamp. Non-cash-dividend future action families, including unrecognized families, flag pending unsupported risk for review. Cash dividends remain available as positive early-assignment context.

The producer never emits `unsupportedCorporateActionPending=false` from an empty query. Alpaca explicitly warns that corporate actions can arrive late. The query filters by process date, which is not a complete prospective-announcement search. Thus even a fully paginated empty response cannot certify bounded negative coverage. The narrow remedy is a separately qualified complete prospective corporate-action calendar or a versioned, explicit governance policy for symbols whose unsupported-action absence cannot be proven. No such policy is promoted here.

## Four entry-critical fields

| Field | Current status | Exact missing proof |
| --- | --- | --- |
| `universe.unsupportedCorporateActionPending` | Positive facts can be observed, negative remains UNKNOWN | Complete prospective corporate-action absence for the proposed symbol/window |
| `universe.eventNear` | Macro/Fed positive and bounded macro negatives are separate; company state remains UNKNOWN | Complete prospective earnings/company-catalyst search and a versioned proximity horizon |
| `event.prospectiveKnownAt` | Known only for six market-wide events | Ticker-specific prospective provider-known and THETA-first-seen evidence |
| `event.earningsDistanceDays` | UNKNOWN | Verified future earnings date/session and timestamp semantics |

The four fields are not closed. The whole UNKNOWN register is not decremented. A new-entry plan must keep failing closed. Management and reconciliation of existing exposure remain separate.

## AEGIS real-input matrix

| Input family | Current production derivation | Remaining limitation |
| --- | --- | --- |
| Account, buying power, positions, orders | Alpaca broker read plus reconciliation | Missing or malformed values stay UNKNOWN |
| Ticker concentration, portfolio capital at risk, inventory/assignment/recovery capacity | Derived from real broker account/positions/orders when the inputs are trustworthy | Contract multiplier and pending-order intent require exact broker/contract evidence |
| Candidate-inclusive capacity | Uses candidate collateral footprint and versioned caps | Quantity zero remains valid |
| Liquidity, execution quality | Current candidate BBO/spread and quality | Must not stand in for full book stress history |
| Provider state | Required capability quality in the same cycle | Partial/degraded data remains UNKNOWN |
| Gap stress | Observed one-day return and versioned threshold | Missing bars remain UNKNOWN |
| Sector concentration | Caller-supplied UNKNOWN in production | PIT sector classification not wired |
| Correlation cluster | Caller-supplied UNKNOWN in production | Cross-position PIT return series not wired |
| IV shock, spread-widening stress | Caller-supplied UNKNOWN in production | Historical baseline and detector not wired |

The public `defaultShadowCycleConfig` contains demo/manual seed values. The production shadow runtime overrides unavailable AEGIS inputs with `null`, and the shadow cycle derives the supported real inputs before invoking Python AEGIS. These manual defaults are not proof of real safety. The AEGIS matrix still contains unresolved inputs and cannot be described as complete.

## Entry path and release boundary

The production new-entry path is `runProductionShadowEvidenceScan` to `assembleMasterPaperEvidencePlan` to `PostgresMasterPaperActionPlanStore.enqueue` to `claimNext` to `MasterPaperActionHandoff` to `PaperOrderCoordinator`. The only production new-risk enqueue found is in `src/research/production-shadow-runtime.ts`, and it requires `assessUniverseEventEvidence(...).state === ELIGIBLE`. The store claim requires `allowNewRisk`, which derives from the execution gate. Management plans have a separate path. No alternate production new-entry publisher was identified by the source audit, but this static trace is not a substitute for a runtime no-submit test.

The requested real no-submit test must remain blocked until an actual eligible candidate has verified event/corporate-action governance, AEGIS, positive bounded quantity, and a persisted intent. No manually selected contract or synthetic event absence will be used to satisfy it. The old worker must not be cut over or unlocked because this code passes tests.

## Canonical research export

The producer emits only sanitized immutable event rows with authority `OPTIONOMICS_SESSION_RESEARCH`, immutable evidence IDs, a deterministic canonical-key-order content hash, market-wide `symbolCount=0`, and Vercel production build SHA/deployment URL release facts. These strings must be externally compared with the actual deployed GitHub/Vercel release before acceptance. The export does not label Optionomics session data as an executable Alpaca quote. The other authority classes remain `ALPACA_EXECUTABLE_MARKET`, `ALPACA_BROKER_LIFECYCLE`, and `THETA_PERSISTED_DECISION` for later exports.

Claude's `theta-real-data-export-contract-v3` fixes the v2 ID/hash/scope weaknesses. Its validator still checks SHA syntax, so the production producer adds release binding and the operator must compare that release to canonical main. No research runner or learned policy is promoted by this export.
