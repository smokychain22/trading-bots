# Data-Gap Register

Durability artifact per the standing product instruction: "Do not purchase
another provider because one field is inconvenient. Only raise
`NEW_VENDOR_REQUIRED` if a REQUIRED field remains unsupported after actual
investigation." This register is the checkable reference for that discipline —
every field THETA's runtime needs is tracked here against Alpaca + Optionomics
(the only two approved providers) before any third-vendor question is ever
raised.

Evidence labels used below:
- **OBSERVED** — a real, read-only API call was made against this environment's
  real accounts this engagement, and the response shape was directly inspected
  (never a value logged; only field names/shape/counts, consistent with the
  standing secret-handling rule).
- **DOCUMENTED** — stated in the provider's own published reference, not yet
  independently observed against a live response this session.
- **VERIFY** — neither observed nor documented yet; requires investigation
  before any code depends on it.
- **UNKNOWN** — genuinely not established either way.

## Field-by-field register

| Field | Primary | Secondary | Status | Notes |
|---|---|---|---|---|
| Account equity/cash/buying power/options level | Alpaca `/v2/account` | none | **OBSERVED** | Real PAPER account returned all of these this session (values not reproduced here). |
| Positions / open orders / activities | Alpaca `/v2/positions`, `/v2/orders`, `/v2/account/activities/*` | none | **OBSERVED** (positions/activities; orders endpoint not separately probed yet) | |
| Market clock / calendar | Alpaca `/v2/clock`, `/v2/calendar` | none | **OBSERVED** | |
| Option contract discovery (symbol/strike/expiration/tradable) | Alpaca `/v2/options/contracts` | none | **OBSERVED** | Real 25-60 DTE SPY put contracts returned. |
| Option bid/ask/quote timestamp | Alpaca `/v1beta1/options/snapshots/{symbol}` | none | **OBSERVED** | Both `feed=opra` (this account: `NOT_ENTITLED`, 403) and `feed=indicative` (GOOD) probed for real; indicative returned real, non-null bid/ask for real 25-60 DTE puts once filtered `type=put`. |
| Option Greeks (delta/gamma/theta/vega/rho) + IV | Alpaca `/v1beta1/options/snapshots` (when the feed/contract combination supplies them) | Optionomics `/api/v1/stocks/{symbol}/options` | **OBSERVED** (both) | Real finding: for this account's real 25-60 DTE SPY puts, Alpaca's own `feed=indicative&type=put` response included a real `greeks` object (delta/gamma/theta/vega/rho) and `impliedVolatility` — contrary to an earlier assumption from a single 0-DTE call. Optionomics's real option-chain response for SPY also independently returned real `delta`/`gamma`/`theta`/`vega`/`implied_volatility` fields for real contracts, confirmed as a genuine fallback. |
| Option open interest | ~~Alpaca~~ (not observed present in this endpoint's response for any probed contract) | Optionomics `/api/v1/stocks/{symbol}/options` (`open_interest` field) | **OBSERVED (Optionomics only)** | Real Optionomics response included a numeric `open_interest` field per contract (e.g. `10`, `21`) for real SPY contracts. Alpaca's snapshot endpoint did not surface an equivalent field in any response observed this session — treated as Alpaca-side UNKNOWN, not zero, per `src/theta/option-chain-ingestion.ts`. |
| Option volume | Alpaca `/v1beta1/options/snapshots` (`dailyBar.v` observed present in one real response) | Optionomics `/api/v1/stocks/{symbol}/options` (`volume` field) | **OBSERVED (both, partially)** | Alpaca's real response included a `dailyBar` with a `v` (volume) field for at least one contract observed; Optionomics's real response also independently included a numeric `volume` field per contract. `option-chain-ingestion.ts` prefers Alpaca's `dailyBar.v` when present, else Optionomics's `volume`. |
| Contract identity for merging Alpaca ↔ Optionomics | Both providers' real responses this session used the same OCC-style symbol format (e.g. `SPY260910P00500000` / `SPY261009P00500000`) | — | **OBSERVED** | `option-chain-ingestion.ts` merges by exact symbol string equality — never fuzzy strike/expiry matching, per the standing instruction. |
| IV skew / term structure / surface shape | — | Optionomics (documented product capability) | **DOCUMENTED, not yet OBSERVED** in this session's calls (only single-symbol chain/metrics endpoints were probed) | Not yet wired into any THETA feature. |
| Flow / unusual options activity | — | Optionomics `/api/v1/flow/net` | **OBSERVED reachable** (real 200 response), field-level shape not yet inspected in depth | Not yet wired into any THETA feature. |
| Earnings / dividend / corporate-action event data | — | Optionomics `/api/v1/events` (reachable, real 200) + Alpaca `/v1/corporate-actions` (reachable, real 200) | **OBSERVED reachable, field-level shape not yet inspected** | Real event-state assembly (R1F item 17 in the product instructions) is NOT yet built — this is the concrete blocker, not provider unavailability. |
| Underlying (stock) trend/RV/drawdown/gap history for ownership/regime features | — | Neither provider's historical-bars capability has been probed this session | **VERIFY** | This is the actual blocker for real ownership/regime input assembly (see below) — not a missing-vendor question; Alpaca's stock-bars REST endpoint is documented and was not yet probed this session. |

## Currently missing REQUIRED runtime fields (as of this register's writing)

None have been proven unsupported by Alpaca + Optionomics after actual
investigation. The two real gaps identified are:

1. **Historical underlying bars for ownership/regime feature computation**
   (trend, realized volatility, drawdown, gap history) — **PROVIDER AVAILABLE
   = Alpaca** (`GET /v2/stocks/bars`, `GET /v2/stocks/{symbol}/bars` are
   documented, pagination-capable endpoints); **IMPLEMENTATION STATUS =
   PARTIALLY WIRED**. `src/theta/underlying-history.ts` implements the pure
   response-parsing, pagination-following (`next_page_token`, never silently
   truncated), and no-future-leakage (`barsAsOf`) logic, tested without live
   credentials. NOT yet wired: the actual `fetch()` call against a live
   account, and the feature-computation layer (trend/RV/drawdown/gap) that
   consumes these bars for ownership/regime inputs. This is an
   implementation gap, not a provider/vendor gap — reclassified from VERIFY
   this session. Optionomics's own `/price_history` endpoint (confirmed
   reachable, real 200 earlier this session, shape not yet inspected)
   remains a documented secondary candidate if ever needed.
2. **Event-state assembly** (earnings/dividend/corporate-action, structured
   into THETA's `EventState` contract) — the underlying data is reachable
   (both providers responded 200 to their respective event endpoints this
   session) but no code parses either into the runtime's `EventState` shape
   yet. This is an engineering gap, not a data-availability gap.

**`NEW_VENDOR_REQUIRED`: NO.** Nothing in this register currently justifies
raising that flag. Re-evaluate only if either gap above, after actual
investigation of the documented endpoints, proves genuinely unsupported.

## Indicative-vs-OPRA evidence task (not yet run — future work, not a purchase decision)

Per the standing instruction, whether Alpaca's INDICATIVE feed (plus
Optionomics) is adequate for PAPER execution pricing is a future, measured,
evidence-based question — never derived from feed type alone, and OPRA is
never purchased speculatively ahead of that evidence. When it is run, it
should measure whether INDICATIVE (vs. a later OPRA comparison):

- materially changes contract ranking (Pareto/opportunity-frontier ordering)
- causes false spread rejection
- changes the chosen strike or expiration
- alters OPEN vs. WAIT decisions
- impairs limit-price logic
- distorts execution-quality/slippage/TCA estimates

See `classifyOptionFeedCapability()` in `src/providers/readiness.ts` for the
`tcaQuality: 'UNVALIDATED'` / `paperExecutionPolicy: 'NOT_YET_EVALUATED'`
fields this task will eventually update — never flipped automatically by feed
reachability alone.

## Status

This register reflects real, engagement-observed evidence gathered this
session (never re-derived from assumption), current as of the commit that
introduces this file. It should be updated whenever a new provider capability
is actually probed, not speculatively pre-filled.
