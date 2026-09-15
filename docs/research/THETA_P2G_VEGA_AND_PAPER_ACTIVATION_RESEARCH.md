# THETA P2G: Optionomics Vega Maximum-Capability Study + No-OPRA Execution
# Price Path + Synthetic Lifecycle Validation Design

Research-only pass. `CURRENT_MAIN_SHA_AT_START`: `59650a8c9cdc5a882ccb43a2cb5bbb865678e365`
(P2F, CLOSED; Codex is implementing P2G in parallel, not audited this
pass). No new code this pass -- every section is a design/evidence
document, consistent with the directive's own all-research scope.
Provider policy assumed throughout: `OPTIONOMICS_PLAN = VEGA` (owner's
explicit clarification).

## 0. Scope discipline

Per the directive's own "do not repeat" instructions and this
engagement's standing discipline, this document CITES rather than
re-derives: the P2E/P2F Optionomics field-by-field dossier (chain/quote
schema, GEX/gamma-flip/walls/DEX/Vanna/Charm heatmap endpoint existence,
flow endpoints, events `known_at`), the five-tier execution-quote
hierarchy and its qualification standard (P2E/P2F research), and the R7
readiness/R8-evidence-ladder design (P2F research, now closed engineering
per the P2F audit). New evidence this pass: Optionomics' own PRICING
PAGE (tier-by-tier feature breakdown, genuinely new), and Massive's
options-contracts-reference documentation (genuinely new, directly
answering the owner's narrow-use-case question).

## 1-2. Vega as primary provider -- the reframed question

Per the owner's explicit correction, this document does not ask "does
Vega provide raw OPRA" (it does not, and was never expected to) but
"what can Vega's OWN, real, documented analytics directly support, and
what genuinely remains missing." Permanent provider policy restated:

```
OPTIONOMICS_VEGA        = PRIMARY OPTIONS INTELLIGENCE
ALPACA_BASIC             = BROKER/ACCOUNT/POSITION/ORDER/FILL/ASSIGNMENT/CALL-AWAY TRUTH
MASSIVE_FREE              = OPTIONAL PIT/HISTORICAL CONTRACT REFERENCE ONLY WHERE UNIQUE
PAID_ALPACA_OPRA           = NOT PLANNED
PAID_MASSIVE                = NOT PLANNED
FRESH_EXECUTION_PRICE_QUALIFICATION_REQUIRED = YES (distinct from OPRA_REQUIRED, which is NO)
```

## 3-4. Deep-read Vega documentation -- new pricing-tier evidence, plus P2E's field dossier cited

**New this pass** (fetched `docs.optionomics.ai/getting-started/plans/`
and `optionomics.ai/for/quant-traders` directly):

| Tier | Price/mo | Adds over prior tier |
|---|---|---|
| Delta | $39 | 15 years options history, Greeks/IV readings, trade builder, watchlists, earnings calendar |
| Gamma | $59 | "The live list of options trades, as they print," unusual-activity detection, large-trade flagging, insider/Congress filings, screener/scanner, support/resistance levels, terminal+alerts |
| Theta | $79 | Trade ideas w/ entry/target/stop, daily write-ups, confidence-scored signals, ML forecasts, assistant Q&A, reasoning explanations (AI features begin here) |
| **Vega** | **$99** | **"A REST API over every reading and all of the history," MCP server (Claude/Cursor/ChatGPT), strategy backtesting (15-year history), "your own keys, plus a log of every request and delivery"** |

**Vega is the ONLY tier with programmatic (API/MCP) access at all** --
every lower tier is UI-only. This is a genuinely important finding: it
means THETA's entire Optionomics integration is necessarily gated on the
Vega tier specifically, not a design choice -- there is no cheaper
API-accessible tier to fall back to.

**Rate limit discrepancy found, flagged honestly rather than resolved**:
the API reference page (`/docs/api`, P2E's own prior fetch) states
"1,000 requests per minute," while a secondary marketing/pricing summary
found this pass states "100 requests per minute" for Vega specifically.
This is UNVERIFIED/CONFLICTING and can only be resolved by reading the
actual rate-limit response headers (`X-RateLimit-Limit`, already
documented to exist) against a real authenticated account -- exactly the
kind of fact this document's own discipline (section 36: prefer official
docs, and real-auth qualification over secondary summaries) says to defer
to real evidence rather than guess between two secondhand numbers.

**Full field-level API dossier is UNCHANGED from the P2E audit's own
findings** (options chain w/ per-contract Greeks as strings, `iv_per_trading_day`,
GEX/gamma-flip/walls/DDE via "Get metrics," Vanna/Charm exposure via "Get
heatmap," six flow endpoints (aggregate, dollar-denominated), events with
`known_at`) -- re-cited, not re-fetched, since nothing about that layer
is a live P2G uncertainty (the owner's own directive explicitly does not
ask for a re-fetch, only reframing).

## 4. Vega capability matrix

Per-family classification, reusing the P2E/P2F dossier's field-level
findings and adding the columns this directive specifically requests.
`REAL_AUTH_REQUIRED_TO_CONFIRM = YES` for every row except where the
provider's own written documentation already settles the question
without needing a live payload (marked NO).

| Family | Documented endpoint | Live/Delayed/Session/Unknown | Timestamp semantics | Raw fact vs. derived | THETA can derive independently | Execution relevance | Real-auth needed |
|---|---|---|---|---|---|---|---|
| CHAIN | `Get options chain` | SESSION_RECORDED_RESEARCH (provider's own words: "chains and metrics per session") | `as_of`-style field, ISO 8601 UTC | RAW_PROVIDER_FACT (per-contract) | N/A | Research/context only, never execution-grade per provider's own "not real-time quote or execution" self-description | YES |
| CONTRACT_IDENTITY | same endpoint | n/a | n/a | RAW_PROVIDER_FACT | N/A -- OCC symbol is the identity itself | Required baseline for every other row | NO (schema documented) |
| BID/ASK/BID_SIZE/ASK_SIZE | `Get options chain` | SESSION_RECORDED_RESEARCH | inherits chain timestamp | RAW_PROVIDER_FACT | N/A | See section 7-9 below -- the single most important row in this table | YES |
| VOLUME/OPEN_INTEREST/VOL_OI | chain + metrics | SESSION_RECORDED_RESEARCH | inherits chain timestamp | RAW_PROVIDER_FACT | VOL_OI ratio trivially derivable, no reason to duplicate | Context only | NO for existence, YES for real values |
| DELTA/GAMMA/THETA/VEGA/RHO | `Get options chain` (as strings) | SESSION_RECORDED_RESEARCH | inherits chain timestamp | RAW_PROVIDER_FACT (as reported; methodology unverified) | THETA has `bs_reference.py` (dependency-free, verification-only) as an independent cross-check | Context/research | YES |
| IV / IV_RANK / IV_PERCENTILE | `Get metrics` | SESSION_RECORDED_RESEARCH | inherits metrics timestamp | DERIVED_PROVIDER_ANALYTIC | `iv_realized_vol_research.py` already exists independently | Context/research | YES |
| SKEW/TERM_STRUCTURE/SURFACE | `Get metrics` (summary stats: rank/percentile/wings) | SESSION_RECORDED_RESEARCH | inherits metrics timestamp | DERIVED_PROVIDER_ANALYTIC (summary, not confirmed to be a raw per-strike grid) | `volatility_surface_research.py`'s raw-SVI fit remains THETA's own, fit from the CHAIN endpoint's raw per-contract IVs, not from this summary endpoint | Research | YES |
| FLOW/NET_FLOW/UOA/SWEEPS/BLOCKS | 6 documented flow endpoints | Provider's own words: "minutes behind the tape" | epoch ms (net-flow series) | RAW_PROVIDER_FACT (aggregate) | `optionomics_flow_temporal_research.py` already computes temporal deltas on the aggregate series | Research | YES (units/scale confirmation, per P2F research's own procedure) |
| ISO/aggressor-side classifications | NOT DOCUMENTED anywhere found | UNKNOWN | UNKNOWN | UNKNOWN | N/A -- print-level classification was never documented to exist | N/A | N/A (structurally absent, not merely unqualified) |
| GEX/GAMMA_FLIP/CALL_WALL/PUT_WALL | `Get metrics` | SESSION_RECORDED_RESEARCH | inherits metrics timestamp | DERIVED_PROVIDER_ANALYTIC (existence confirmed, methodology unverified) | `gex_spot_scan_research.py` (this branch) is THETA's own independent derivation, deliberately kept separate | Context only, never a direction oracle | YES |
| DEX | `Get metrics` (field named "DDE," naming ambiguity noted in the P2E audit) | SESSION_RECORDED_RESEARCH | inherits metrics timestamp | DERIVED_PROVIDER_ANALYTIC | No independent THETA-derived DEX comparator built yet (named gap, P2F audit) | Context only | YES |
| VANNA/CHARM | `Get heatmap` | SESSION_RECORDED_RESEARCH | inherits heatmap timestamp | DERIVED_PROVIDER_ANALYTIC | `exposure_temporal_convention_research.py` (this branch) provides the temporal-delta and sign-convention-mismatch-detection machinery, not an independent value computation | Context only | YES |
| EVENTS/EARNINGS | `List events` | Provider's own PIT design (`known_at`) | ISO 8601 UTC + `known_at` | RAW_PROVIDER_FACT | `event_state_research.py` (this branch) already consumes this shape | Research; never infer an event from IV behavior (standing rule, re-confirmed) | YES for real payload; the *design* is already confirmed compatible without auth |
| HISTORICAL_CHAIN/METRICS/FLOW | historical chain endpoint (date param), "15+ years" (marketing), Feb-2024-only for Alpaca's OWN historical option data (a different provider, not to be confused) | Session-recorded, backdated | date param | RAW_PROVIDER_FACT | Backtest universe construction -- see section 19 | Research | YES for real coverage depth confirmation |
| BACKTESTING (Vega-tier feature) | UI/API feature, not independently documented at the field level found this pass | n/a | n/a | Provider's own tool, not a THETA-consumed data feed per se | N/A | Not THETA's own backtest engine -- THETA's own `walk_forward.py`/`promotion_checker.py` remain the actual promotion-standard machinery; Vega's own backtester is a research convenience, not a substitute | YES if ever consumed programmatically |
| ALERTS/WEBHOOKS | advertised on marketing pages; **absent from the API reference's own endpoint list** (re-confirmed, unchanged from P2E's finding) | UNKNOWN | UNKNOWN | UNVERIFIED | N/A | N/A -- THETA has its own alert system (`theta-alerts.ts`, P2F, independently built and unrelated to Optionomics' own alerting feature) | N/A (advertised, undocumented) |
| MCP | Vega-exclusive, documented to exist ("MCP server for Claude/Cursor/ChatGPT," "23 MCP tools" per a prior session's finding) | n/a | n/a | A DIFFERENT ACCESS TRANSPORT for the same underlying data, not a new capability | N/A | Not currently how THETA's own runtime would integrate (THETA's transport is the direct REST client already built in P2F, `optionomics-provider.ts`) -- MCP is more relevant to an interactive research/assistant workflow than an autonomous runtime | NO (existence documented) but real schema unconfirmed |
| RATE_LIMITS/PAGINATION | documented, with the tier-conflict noted above | n/a | n/a | RAW_PROVIDER_FACT | N/A | Operational | Partially -- pagination confirmed, exact Vega rate limit needs real-account confirmation |

## 5. Vega vs. raw OPRA -- what becomes unnecessary

| Workload | Classification |
|---|---|
| Chain reconstruction (assembling a full options chain from raw prints) | VEGA_REPLACES_RAW_PIPELINE for RESEARCH purposes -- Vega's own chain endpoint already assembles this; THETA never needs to build an OPRA-ingestion-to-chain-reconstruction pipeline of its own |
| Greeks calculation | VEGA_PARTIALLY_REPLACES -- Vega reports Greeks per contract; THETA's own `bs_reference.py` remains as an independent cross-check (already built, dependency-free, verification-only per its own standing role), never fully retired |
| IV calculation | VEGA_PARTIALLY_REPLACES -- same reasoning as Greeks |
| IV rank/percentile | VEGA_REPLACES_RAW_PIPELINE -- a summary statistic THETA has no reason to recompute from scratch once real values are qualified |
| Skew construction / term structure (summary stats) | VEGA_PARTIALLY_REPLACES -- Vega's summary numbers are useful CONTEXT, but THETA's own raw-SVI fit (`volatility_surface_research.py`) remains the actual DECISION-GRADE surface, fit from the chain endpoint's raw per-contract IVs -- this is a case where THETA_DERIVATION_STILL_USEFUL, not redundant, because Vega's own summary fields were never confirmed to be a fittable raw grid |
| Full vol surface (raw grid + arbitrage diagnostics) | RAW_FEED_STILL_REQUIRED in the sense that THETA still does its own SVI fit from Vega's own raw per-contract chain data -- "raw feed" here means the CHAIN endpoint's raw per-contract IVs, which Vega itself supplies; no THIRD-PARTY raw feed is required |
| GEX | VEGA_PARTIALLY_REPLACES -- Vega provides a number; THETA's own spot-scan (`gex_spot_scan_research.py`) remains a DELIBERATELY SEPARATE, independently-derived cross-check, per this engagement's standing dual-provenance discipline (never merged) |
| DEX/Vanna/Charm | VEGA_PARTIALLY_REPLACES for DEX/Vanna/Charm EXISTENCE; THETA_DERIVATION_STILL_USEFUL for Vanna/Charm's temporal-delta machinery (already built); NOT_REQUIRED_FOR_THETA to build an independent DEX/Vanna/Charm VALUE computation from scratch given no strong motivating gap has been identified |
| Gamma flip / walls | VEGA_PARTIALLY_REPLACES -- Vega reports a number; THETA's own spot-scan flip remains independently maintained (dual-provenance, never merged) |
| Flow aggregation | VEGA_REPLACES_RAW_PIPELINE for the AGGREGATE series specifically -- THETA never needs to ingest raw prints to reconstruct Vega's own net-flow numbers; print-level classification (sweep/block/aggressor) remains structurally UNAVAILABLE regardless of provider, per section 14 |
| UOA detection | VEGA_REPLACES_RAW_PIPELINE for whatever Vega's own "unusual activity" feature already flags -- THETA has no reason to build its own detector from raw prints Vega has never documented providing |
| Historical chain warehousing | VEGA_PARTIALLY_REPLACES -- "15+ years" claimed; whether Vega's own historical endpoint preserves genuinely POINT-IN-TIME semantics (what was KNOWN at decision time, not merely what the chain looked like on that date with today's revisions/corrections applied) is UNVERIFIED and is exactly why THETA's own P2C-P2E persisted evidence (subjects/observations/checkpoints, all timestamped at CAPTURE time) remains NOT_REQUIRED_FOR_THETA to replace -- THETA's own real-time capture is PIT-safe by construction in a way a historical replay endpoint may not be, regardless of provider |
| Strategy backtesting datasets | VEGA_PARTIALLY_REPLACES as a RESEARCH CONVENIENCE (Vega's own backtester); NOT_REQUIRED_FOR_THETA to replace THETA's own promotion-standard machinery (`walk_forward.py`, `promotion_checker.py`, `selection_bias.py`) -- these remain THETA's own evidentiary bar regardless of what Vega's own backtester reports, since THETA's promotion standard requires THETA's own PIT-captured, immutably-labeled evidence (P2C-P2D), not a third party's research tool's output |

## 6. THETA-derived analytics -- what to keep, what to retire

None of the existing THETA-derived research modules should be retired
merely because Vega reports a similar-sounding number -- every one
already exists for a REASON beyond "Vega doesn't have this":

```
THETA_DERIVED_GEX (gex_spot_scan_research.py, existing): KEEP.
  Reason: independent cross-check against Vega's own unverified sign
  convention (P2F's own sign-disagreement-detection procedure requires
  BOTH values to exist independently). Required Vega input: none (THETA's
  spot-scan uses THETA's own bs_gamma() and caller-supplied OI/IV from
  the CHAIN endpoint, not Vega's own GEX number). Sign-convention risk:
  explicit, carried as a named GexSignConvention.verified field, never
  assumed true.

THETA_DERIVED_DEX: NOT BUILT, genuinely not required yet -- no motivating
  gap found this pass or any prior pass; flagged as NOT_REQUIRED_FOR_THETA
  unless a future need for an independent DEX cross-check emerges.

THETA_DERIVED_VANNA_EXPOSURE / THETA_DERIVED_CHARM_EXPOSURE: the
  TEMPORAL-DELTA machinery already exists (exposure_temporal_convention_research.py)
  and should be KEPT -- it operates on WHICHEVER value is supplied
  (Vega's own, once qualified) and adds no independent VALUE computation
  of its own, so there is no duplicate-computation concern here at all.

THETA_DERIVED_SKEW / THETA_DERIVED_TERM_STRUCTURE (volatility_surface_research.py):
  KEEP. Reason: Vega's own skew/term fields are confirmed to be SUMMARY
  statistics (rank/percentile/wings), not confirmed to be a raw,
  fittable per-strike grid -- THETA's own SVI fit remains the only
  confirmed source of a genuinely fittable surface, fed from Vega's own
  raw per-contract chain IVs (not duplicating Vega, complementing it).

THETA_DERIVED_VRP (iv_realized_vol_research.py): KEEP, unrelated to
  Vega's own IV-rank/percentile fields -- VRP requires a REALIZED
  volatility estimator (Parkinson/Garman-Klass/Rogers-Satchell, already
  built) that Vega has never claimed to provide.

THETA_DERIVED_EXPECTED_MOVE: NOT BUILT -- Vega's own metrics endpoint
  documents an "expected move" field (per P2E's dossier); no motivating
  gap has been found to justify an independent computation. Flagged
  NOT_REQUIRED_FOR_THETA unless real qualification reveals the provider's
  own field is unreliable.

THETA_DERIVED_FLOW_COMPOSITE (optionomics_flow_temporal_research.py):
  KEEP, unrelated to duplication concerns -- this is a TEMPORAL DELTA
  computation over Vega's own aggregate series, not an independent flow
  RECONSTRUCTION.
```

**General principle applied throughout**: THETA duplicates a Vega
capability only where (a) dual-provenance cross-checking is itself the
point (GEX sign-convention verification), or (b) Vega's own field is
confirmed to be a SUMMARY/DERIVED statistic rather than the raw input
THETA's own more rigorous method (SVI fit, realized-vol estimators)
actually requires. Every other case defers to Vega directly, per the
directive's own "do not duplicate merely because possible" instruction.

## 7-9. Vega chain/quote study and the no-OPRA execution-price standard

**Chain/quote fields**: bid/ask/sizes appear on the `Get options chain`
endpoint (confirmed, P2E dossier), described by the provider's own words
as "chains and metrics per session" -- i.e., NOT documented to update
intraday tick-by-tick, and NOT documented with a streaming/websocket
transport (no such endpoint appears anywhere in the API reference).
Spread is therefore a RAW, PER-SNAPSHOT quantity (ask minus bid at
whatever moment the chain was last computed by the provider), not a
continuously-updating derived stream. Quote recency is NOT explicitly
quantified anywhere in the documentation found this pass (no "chains
refresh every N minutes" statement) -- this is a genuine, real
UNVERIFIED item that can only be resolved empirically, by observing the
ACTUAL time delta between two consecutive real chain fetches for the
same contract (exactly the freshness-qualification procedure P2F's own
harness already implements structurally, pending real auth).

**The central distinction this document exists to make explicit**
(directive section 9): `TRUSTED_TWO_SIDED_ORDER_PRICING` does NOT require
`CONSOLIDATED_NBBO` provenance. The two tiers differ in WHAT KIND of
evidence justifies them, not in degree of the same evidence:

```
CONSOLIDATED_NBBO
  Requires the provider's OWN documentation to state it sources/aggregates
  the official OPRA consolidated tape. Vega's own documentation makes NO
  such claim anywhere found -- Vega can NEVER qualify for this tier,
  regardless of how fresh or well-behaved its quotes turn out to be. This
  is a PROVENANCE requirement, not a freshness or accuracy requirement.

TRUSTED_TWO_SIDED_ORDER_PRICING
  Does NOT require OPRA/consolidated provenance. Requires instead an
  EMPIRICALLY EARNED evidence bundle from REPEATED, REAL observation:
    - exact contract identity (OCC symbol, absolute match)
    - bid present, ask present, bid<=ask, both positive/finite
    - a genuine provider timestamp AND a THETA-received timestamp, with
      the two in causal order
    - an empirically-measured quote age distribution (not merely "we
      allow a caller-supplied bound" -- the BOUND ITSELF must be set from
      real observed update cadence, per section 8's own instruction not
      to invent an arbitrary number)
    - session alignment (a quote observed during REGULAR_SESSION used for
      a REGULAR_SESSION decision, never a stale pre-market number reused
      mid-day)
    - CONSISTENCY across repeated observations and across multiple
      different contracts -- a single lucky-looking quote proves nothing;
      the standard requires observing the SAME good behavior repeatedly
    - explicit behavior at three session boundaries: market open (quotes
      may be wide/unstable right at the open -- expected, not
      disqualifying, but the BOUND for "how wide is too wide" must itself
      be empirically set, never invented), near close, and after close
      (Vega's own "per session" cadence means an after-close chain fetch
      is almost certainly stale relative to the LAST real trade, and
      should be classified SESSION_RECORDED_RESEARCH for that window, not
      TRUSTED_TWO_SIDED_ORDER_PRICING)
    - a broker (Alpaca) indicative quote used ONLY as a WEAK sanity
      comparator (per section 11's own "do not conflate cross-provider
      variance with defect" discipline, P2F research) -- never as a
      qualification requirement in its own right, since Alpaca's own free
      feed is ITSELF non-OPRA and delayed (P2F research finding)

INDICATIVE
  Any feed the provider's own documentation describes as derived/
  approximate/delayed. Vega's chain data, absent further real
  qualification, defaults HERE, not to TRUSTED_TWO_SIDED_ORDER_PRICING,
  until the empirical evidence bundle above has actually been collected
  and shown to hold repeatedly.

SESSION_RECORDED_RESEARCH
  A feed only ever observed/replayed after the fact, or during a session
  window where "per session" cadence makes intraday freshness claims
  meaningless (the after-close case above).

UNKNOWN
  Default until checked.
```

**This is the exact mechanism by which THETA could reach
`TRUSTED_TWO_SIDED_ORDER_PRICING` WITHOUT ever paying for OPRA** -- by
treating Vega's own authenticated, repeatedly-observed, empirically
freshness-qualified chain quotes as a genuinely trusted (though not
NBBO-provenance) execution-price source. **This remains entirely
unproven pending real Vega authentication** (currently blocked, real
401, unchanged from the P2F audit) -- this section specifies the STANDARD
to apply once auth succeeds, not a claim that it already qualifies.

## 10. Paper limit-price formation without OPRA -- mechanics only, no permanent rule

Once a quote reaches `TRUSTED_TWO_SIDED_ORDER_PRICING`, reasonable
mechanics for FORMING a Paper limit price (research/operational
mechanics, never promoted to a permanent Production rule per the
directive's own explicit instruction):

```
MIDPOINT: (bid+ask)/2 -- simplest, but assumes full fill at a price
  neither side necessarily wants to trade at; reasonable starting point
  for validation, not a claim of realism.
CREDIT-SIDE CONSERVATIVE IMPROVEMENT: for a credit trade (selling), price
  slightly BELOW mid (toward the bid) by a caller-supplied fraction of the
  spread -- trades a small amount of expected credit for a higher
  probability of fill, useful for FIRST-ORDER VALIDATION where confirming
  the whole pipeline works matters more than optimizing the fill.
DEBIT-SIDE CONSERVATIVE IMPROVEMENT: mirror image, price slightly ABOVE
  mid (toward the ask) for a debit trade.
SPREAD WIDTH / TICK SIZE AWARENESS: any computed limit price must be
  rounded to a valid tick increment (typically $0.01 or $0.05 depending on
  the contract's own price band, a real listed-options mechanic, not a
  THETA invention) -- an unrounded price is a real, avoidable rejection
  source worth testing for explicitly.
REPRICING / CANCEL-REPLACE: if unfilled after a caller-justified wait, a
  bounded, small reprice toward the opposite side, with a maximum
  cancel/replace count before giving up -- exactly the TCA fields P2C/P2E
  already capture (`cancelReplaceCount`).
STALE-QUOTE INVALIDATION: if the quote's own age exceeds the empirically-
  set freshness bound (section 8-9) between decision and submission,
  refuse to submit at all rather than submit against a now-stale price --
  this is the EXECUTION_QUOTE_QUALIFICATION_STANDARD's own disqualifier
  list (P2F, unchanged), simply re-applied at the moment of submission,
  not merely at decision time.
```

No percentage or fixed spread-improvement fraction is proposed as a
permanent rule anywhere in this section -- every numeric input
(spread fraction, wait time, max cancel/replace count, tick size) remains
a caller-supplied, justified parameter, matching this engagement's
standing no-invented-threshold discipline.

## 11. Alpaca Basic authority map -- unchanged, restated briefly

Per the directive's own explicit instruction not to re-research paid
OPRA: Alpaca Basic/Paper already legitimately provides account, buying
power, positions, open orders, order state, fills, assignment, call-away,
options approval (enabled by default in Paper, per the P2F research
pass's own direct doc fetch), calendar, and broker clock -- ALL of these
remain BROKER-AUTHORITATIVE regardless of Optionomics' own tier or
qualification state, since Alpaca is the ONLY system with actual
broker-side truth. Alpaca's own free/indicative option quote data
remains, per the P2F research finding, explicitly non-OPRA and
15-minute-delayed -- usable only as the "weak comparator" role named in
section 9 above, never as a qualification requirement in its own right.

## 12. Vega + Alpaca combined architecture -- authority map

```
OPTIONOMICS VEGA:  market/options intelligence (chain, Greeks, IV, skew/
                   term/surface summaries, flow, GEX/DEX/Vanna/Charm,
                   events, historical reference) -- NEVER broker/order truth
THETA:             derived analytics (independent GEX spot-scan, SVI
                   surface fit, VRP, temporal deltas), strategy/management/
                   risk decisions, execution-quote qualification judgment
ALPACA:            broker/account/order/fill/lifecycle truth -- NEVER
                   options-intelligence authority

DATA-CROSSING POINTS (where authority could conflict, examined for
  conflict and found none structurally, given the existing P1-P2F design):
  1. Optionomics candidate (chain/Greeks/context)
     -> THETA selects exact OCC identity from Optionomics' own chain row
     -> Alpaca is asked to VERIFY the contract/broker-side tradability of
        that SAME OCC identity (options approval, contract existence) --
        Alpaca's answer here is authoritative; a candidate Optionomics
        shows but Alpaca cannot trade is REJECTED, never overridden
  2. THETA sizes the position using AEGIS (THETA-owned risk logic) against
     Alpaca's own buying-power/account truth -- Alpaca is authoritative
     for the INPUT (buying power), THETA is authoritative for the SIZING
     DECISION itself
  3. Execution price qualification (section 7-9) uses Optionomics'
     (or, weakly, Alpaca's own indicative) quote -- THETA's qualification
     JUDGMENT is authoritative for whether ANY quote is trusted enough to
     use; neither provider unilaterally decides this
  4. Alpaca Paper order submission, ack, fill, and reconciliation --
     Alpaca is ABSOLUTELY authoritative here; nothing Optionomics reports
     can ever override a broker-confirmed fill/assignment/call-away fact
     (unchanged, P1's own standing invariant, reaffirmed)

No authority conflict found in this map: each of Optionomics/THETA/Alpaca
owns a strictly separate decision domain, and the existing P1-P2F
architecture (verified across five prior audits) already enforces this
separation structurally, not merely by convention.
```

## 13. Vega feature-family independence -- which THETA branches actually REQUIRE which family

Per the directive's own explicit "avoid: missing Charm => no trades
unless a specific branch formally requires Charm" instruction: reviewing
`strategy-timing-router.ts` (P2E, audited) confirms NO canonical branch's
`routeStrategyTiming()` currently references any Optionomics family at
all as a hard requirement -- applicability is gated on lifecycle state,
DTE, and session/quote-freshness facts only. This means, as currently
built, EVERY Optionomics family is already, structurally, OPTIONAL
CONTEXT for every branch -- there is no existing hard dependency to
accidentally break. Should a FUTURE branch or policy explicitly require
a specific family (e.g., a hypothetical GEX-conditioned entry filter),
that dependency should be declared explicitly in that branch's own
applicability logic, never inherited implicitly from "Optionomics is
degraded" as a blanket condition.

## 14. Flow/UOA deep study -- documented vs. unproven, formalized

```
DOCUMENTED (provider's own words, confirmed): premium (dollars), size
  (trade_count), call/put split (separate top-call/top-put endpoints),
  execution-relative-to-bid/ask classification -- NOT documented anywhere
  found; Vol/OI, Delta, IV, DTE, moneyness -- available on the CHAIN
  endpoint separately, joinable to a flow row only via contract identity,
  never bundled into the flow row itself per the documentation read.

UNPROVEN, structurally absent from any documentation found across three
  research passes now (P2E, P2F, P2G): true buyer/seller intent (aggressor
  side), opening/closing position intent, customer/dealer counterparty.
  These require PRINT-LEVEL data with trade-condition codes (per
  LuxAlgu/whale-options' own aggressor.ts design, cited in the P2C-pass-1
  dossier) that Vega has never been documented to provide.

ENCODING (extends optionomics-capability-contract.ts's existing
  provenance vocabulary, no new module needed):
  PROVIDER_OBSERVED: premium, size, call/put split, net-flow direction
    sign (with the caveat, per P2E's dossier, that "puts typically
    negative" is a described convention, not a hard guarantee)
  PROVIDER_INFERRED: none identified -- Vega's own flow endpoints do not
    appear to claim any inferred-intent field
  THETA_DERIVED: temporal deltas/acceleration/reversal
    (optionomics_flow_temporal_research.py, existing)
  UNKNOWN: aggressor side, opening/closing, customer/dealer -- always,
    regardless of qualification effort, since the source data itself
    does not carry this information
```

## 15. GEX deep study -- unchanged from P2E/P2F, restated for completeness

`gex_spot_scan_research.py`'s existing dual-provenance discipline and the
P2F-research-pass's sign-disagreement-detection procedure (comparing
THETA's own spot-scan regime against Vega's reported GEX at matched
spot/underlying/timestamp) remain the exact, correct mechanism -- no new
research needed here; genuinely unresolved items (per-contract vs.
aggregated, OI-vs-volume weighting, dealer-side sign assumption) all stay
`UNVERIFIED_UNTIL_REAL_PAYLOAD`, per the directive's own instruction.

## 16. DEX/Vanna/Charm -- unchanged, tests specified (restated from P2F)

The P2F-research-pass's qualification procedure (units/sign/scope/spot-
scaling/temporal-comparability checks) applies unchanged. No new
sign-reversal-detection test beyond what P2F already specified is
required this pass.

## 17. Volatility intelligence -- addressed in section 6 above (KEEP THETA's own SVI fit)

## 18. Events/earnings -- addressed in the P2E/P2F dossiers; unchanged

`known_at` remains the PIT anchor; earnings/ex-dividend coverage within
Vega's own `kinds` enum remains UNVERIFIED pending real auth, exactly as
found in every prior pass -- no new evidence this pass.

## 19. Historical/backtesting -- genuine PIT caution, closed this pass

The single most important NEW caution this pass adds (beyond citing "15+
years" as a marketing claim): a provider's HISTORICAL replay endpoint
answering "what did this chain look like on date X" is NOT automatically
equivalent to "what was KNOWN at decision time on date X" -- a provider
may apply corrections, revisions, or backfilled analytics to historical
records after the fact (the EXACT problem `known_at` was designed to
solve for events specifically, per Vega's own documented reasoning,
quoted in the P2C-pass-1/P2E dossiers: "which is what keeps an
event-driven backtest from trading on announcements before they were
announced"). Nothing found this pass confirms Vega's own historical
CHAIN/METRICS/FLOW endpoints carry an equivalent `known_at`-style
PIT-availability field the way its EVENTS endpoint does. **This is
exactly why THETA's own real-time-captured, immutably-persisted P1-P2E
evidence (subjects/observations/checkpoints, each timestamped at
CAPTURE time) remains the authoritative PIT record THETA trains against
-- never a provider's own historical replay, regardless of how deep that
provider's history goes.** Survivorship and lookahead risk in a
provider's own historical endpoint are real, standing concerns that THIS
document does not need to resolve, because THETA's own architecture
already avoids depending on them.

## 20-22. Massive Free -- unique-only audit, closed this pass with new evidence

Deep-read `massive.com/docs/rest/options/contracts/all-contracts` this
pass (real fetch, not existence-only).

```
MASSIVE_UNIQUE_USEFUL:
  - as_of parameter: "Specify a point in time for contracts as of this
    date... Defaults to today's date" -- a genuine, real, documented PIT
    contract-reference lookup. Neither Alpaca's own historical-option-data
    endpoint (coverage starts February 2024 only, per the P2F research
    pass's own direct fetch) nor Vega's own documentation (no as_of-style
    parameter found on any endpoint read across three passes) offers an
    equivalent PRE-2024, point-in-time contract-existence lookup.
  - expired=true parameter: explicit expired-contract lookup -- useful
    for validating that a contract THETA's own historical labels reference
    genuinely existed with the claimed terms at the claimed time, a
    real cross-check neither other provider was found to offer this
    pass.
  - correction field: "The correction number for this option contract" --
    a genuine OCC-correction-tracking field neither Alpaca nor
    Optionomics documentation mentions.
  - additional_underlyings: an array field for complex, multi-deliverable
    adjusted contracts (mergers/spin-offs) -- directly answers section
    22's adjusted-contract research question with a real, documented
    schema, not a guess.

MASSIVE_REDUNDANT:
  - Live bid/ask/Greeks/IV: Vega already covers this (SESSION_RECORDED_
    RESEARCH tier, same limitation Massive Free would carry -- Massive
    Free's OWN rate limit, 5 requests/minute per a secondary source found
    this pass, is far MORE restrictive than Vega's, making it strictly
    worse for anything Vega already provides).
  - Flow/GEX/UOA-style analytics: not offered by Massive's options
    reference endpoint at all (a pure contract-metadata/reference API,
    not an analytics platform) -- not a comparison point, simply absent.

MASSIVE_UNCLEAR:
  - Historical DEPTH available specifically on the FREE tier: the
    fetched documentation states historical coverage "ranges from 2 years
    (Basic) to all history... (Starter/Developer/Advanced/Business
    plans)," with underlying records reportedly extending to June 2014 --
    but it is UNCLEAR from this pass's research whether Massive's actual
    FREE tier (as opposed to "Basic," a possibly-different, possibly-paid
    tier name) gets the full 2-year window or something narrower. This
    is a real, honestly-flagged ambiguity, not resolved by guessing.
```

**Massive PIT value test (section 21) -- verdict**: Massive Free's
`as_of`/`expired`/`correction`/`additional_underlyings` fields provide
GENUINE, otherwise-unavailable value specifically for HISTORICAL
CONTRACT IDENTITY and ADJUSTED-CONTRACT RECONSTRUCTION -- exactly the
NARROW use case the owner already scoped it for. For every OTHER field
category (live quotes, Greeks, IV, flow, GEX), Massive Free is
`NOT_REQUIRED` given Vega already covers the same ground at a less
restrictive rate limit.

## 22. Adjusted-contract reference requirements

Minimum fields THETA should preserve per contract, informed by Massive's
own real schema (not invented): `cfi` (ISO 10962 classification -- catches
non-standard contract types), `exercise_style` (American/European/
Bermudan -- THETA's own Wheel strategy assumes American-style short puts/
calls; a Bermudan-style contract would need different assignment-timing
assumptions, a real edge case worth guarding against), `shares_per_contract`
(never assume 100 universally -- Massive's own documentation exists
specifically because this varies for adjusted contracts),
`additional_underlyings` (for merger/spin-off-adjusted contracts
delivering more than one instrument), `correction` (an OCC correction
number, distinguishing "the contract terms changed because of a real
corporate action" from "the record itself was corrected/fixed after an
error"), and `primary_exchange`. None of these fields currently appear
anywhere in THETA's own existing contract-identity schema (per a review
of `optionomics-capability-contract.ts` and `execution-option-quote.ts`,
both P2E/P2F, neither of which carries an adjustment-metadata field) --
flagged as a genuine, real, concrete recommendation for Codex, not a
speculative one.

## 23. Synthetic lifecycle acceptance matrix -- independent design

Five canonical paths (directive's own list) plus the defined-risk
variant, each with the SPECIFIC invariant a synthetic test must prove
(not merely "runs without crashing"):

```
1. CASH -> SHORT_PUT -> CLOSED
   PROVE: whole-chain net P&L == the single leg's own realized P&L
   (no roll, no assignment -- the simplest possible chain, a sanity
   baseline every other path is compared against)

2. CASH -> SHORT_PUT -> ROLL -> SHORT_PUT -> CLOSED
   PROVE: whole-chain net P&L == old-leg realized P&L + new-leg realized
   P&L + roll execution cost (per computeTcaBreakdown's own
   rollOldCloseCost/rollNewOpenCost separation, P2C/P2E) -- NEVER just the
   new leg's own P&L (the exact roll-loss-erasure invariant, independently
   re-verified in the P2D and P2F audits, must hold for a SYNTHETIC chain
   too, not only a real one)

3. CASH -> SHORT_PUT -> ASSIGNMENT -> STOCK_HELD -> SELL_STOCK
   PROVE: stock cost basis == the assigned strike (not the stock's own
   later market price at assignment time) -- assignment must never reset
   or fabricate a fresh cost basis; whole-chain P&L == option premium
   collected + stock P&L (basis-to-sale) + fees, all three terms visible
   and separately attributable in the resolved label

4. CASH -> SHORT_PUT -> ASSIGNMENT -> RECOVERY_WAIT -> CC_OPEN -> CC_CLOSE -> STOCK_HELD
   PROVE: CC premium is ADDITIVE to the whole-chain P&L, never presented
   as if it were a separate, unrelated trade; the RECOVERY_WAIT interval
   itself must be represented as an ACTIVE decision (per the standing
   HOLD/WAIT-is-active-decision principle, P2D research) with its own
   capital-days accumulating, not a silent gap in the timeline

5. CASH -> SHORT_PUT -> ASSIGNMENT -> CC_OPEN -> CALL_AWAY -> TERMINAL
   PROVE: call-away stock P&L (sale at the CC's own strike, not the
   stock's market price at call-away time) is included in the terminal
   whole-chain P&L; the DECISION to accept assignment/allow call-away
   remains structurally distinct from the BROKER FACT that assignment/
   call-away occurred (P1's own standing decision-vs-fact separation,
   re-verified in the P2E/P2F audits) -- a synthetic test must inject the
   BROKER FACT independently of any THETA "decision" to accept it,
   proving the two are never conflated even in a fully synthetic run

DEFINED-RISK VARIANT (CASH -> DEFINED_RISK_OPEN -> {CLOSE|EXPIRE}):
   PROVE: whole-chain P&L correctly nets BOTH legs (long + short) as a
   package, max-loss is bounded by the structure's own width regardless of
   how far the underlying moves (a defined-risk-specific invariant no
   single-leg path above can exercise), and per-leg TCA (entry/exit
   phase costs on EACH leg) sums correctly into the package-level
   executionCost (computeTcaBreakdown's own packageExecutionCost field,
   P2C/P2E, already designed for exactly this)
```

**Explicitly synthetic, never real evidence** (directive's own
instruction): every one of these paths must produce output tagged with
whatever provenance/evidence-source label already exists for synthetic
data in THETA's schema (e.g. a `REPLAY_FIXTURE`/synthetic-mode tag,
matching the `OptionomicsQualificationMode` pattern P2F already
established for provider qualification) -- a synthetic lifecycle run
must NEVER be capable of writing into the same resolved-label tables
real Paper evidence populates, or it would corrupt the effective-N
accounting this entire engagement has been careful to protect.

## 24. Whole-chain accounting invariants -- reviewed, no new gap found

Every invariant named in the directive (roll loss never erased, roll
credit not mistaken for net profitability, assignment not terminal by
itself, stock basis preserves assigned-strike economics, CC premium same
chain, CC roll-close cost preserved, call-away stock P&L included, fees/
slippage included, capital-days accumulate correctly, terminal outcome
only after the entire chain ends) is ALREADY independently verified in
the P2D/P2F audits' own economic-truth-query review (the `SUM(ol.
realized_pnl)`-across-all-legs mechanism, TCA phase separation, and the
`closed_at IS NOT NULL` terminal-gating condition). **No genuine new
missing invariant found this pass** -- per the directive's own "do not
reopen P2D unless a genuine missing invariant is found" instruction,
this section closes without reopening anything.

## 25-27. Winner/loss path, small/large profit, and WAIT/HOLD paralysis validation

All THREE of these validation-design questions are ALREADY fully
specified by existing, tested research modules from prior passes:
`position_path_state_research.py`'s `assess_winner_to_loser` (already
proves a stable -5% position classifies differently from one that peaked
at +25% then fell, directive section 25's exact example), the
`ActionInactionFrontier`/`HoldEvidenceState` design (P2E/P2F, already
proves HOLD requires affirmative evidence, never a default), and
`wait_diagnostics_research.py`'s ten-way `WaitKind` taxonomy (already
distinguishes HEALTHY_WAIT/OVERSTRICT_POLICY_WAIT/POSSIBLE_LOGIC_PARALYSIS
with priority-ordered, non-arbitrary conditions). **This section's only
new contribution**: confirming that the SYNTHETIC lifecycle fixtures
(section 23) should EXERCISE these existing classifiers directly (feed a
synthetic path's checkpoints through `assess_winner_to_loser`, feed a
synthetic decision history through `calculateInactionDiagnostics`) rather
than inventing new validation logic -- the acceptance criteria already
exist; what was missing (per the P2F audit) was a fixture harness to
exercise them, which is Codex's own stated P2G scope, not a new research
question this pass needs to re-answer.

## 28-30. First Paper order readiness, observability, and temporary controls

Unchanged from the P2F-research-pass's own `FIRST_PAPER_ORDER_READY`
standard and `THETA_ACTION_INACTION_TIME_PATH_RESEARCH.md`'s
observability mapping -- both already comprehensive and already
confirmed, in the P2F audit, to map onto real existing schema with no
new tables required. This pass's only addition: the fresh-execution-price
qualification dimension (section 7-9 above) is now the SPECIFIC missing
piece within that standard's existing `executionQuoteProviderReady`
dimension -- not a new dimension, a clarification of what would need to
become true within the one that already exists. Temporary validation
controls (single order at a time, one master account, normal session,
avoid expiry-final-window, avoid multi-leg first order, smallest
meaningful size, immediate reconciliation) restated unchanged from the
P2F research pass, explicitly NOT promoted to permanent policy here
either.

## 31-32. R8 evidence ladder and completion research

Unchanged in structure from the P2F-research-pass's twelve-milestone
ladder; this pass adds the NATURAL-vs-FORCED distinction the directive
specifically asks for: `FIRST_ASSIGNMENT`, `FIRST_RECOVERY`, `FIRST_CC`,
and `FIRST_CALL_AWAY` must each be allowed to occur NATURALLY from real
market behavior interacting with THETA's own genuine decisions -- never
DELIBERATELY engineered (e.g., intentionally selecting a strike expected
to go ITM just to "check the assignment box") purely to advance a
checklist, since doing so would contaminate the very evidence R8 exists
to collect honestly. R8 completion remains a MULTI-DIMENSIONAL bar
(runtime stability, submission reliability, fill handling, reconciliation
correctness, management behavior across regimes, whole-chain correctness,
TCA completeness, provider uptime, decision freshness, multiple strategy
states, effective independent N) -- no single magic N is proposed;
`dataset_readiness.py`'s existing `DependenceGroupKey`/
`effective_sample_size` methodology remains the correct STATISTICAL
METHOD to apply once enough of the ladder's own milestones have
accumulated real data to compute against, exactly as the P2F research
pass already concluded.

## 33-34. Optionomics 401 and the post-auth activation playbook

**401 status**: `PROVIDER_BLOCKER`, unchanged, not re-diagnosed
repeatedly per the directive's own explicit instruction. One
documentation-only clarifying check performed this pass: Vega's own
pricing page states plainly "your own keys" (API keys, plural, tied to
the Vega subscription itself) -- consistent with the existing
`X-USER-EMAIL`+`X-USER-TOKEN` or `Authorization: Bearer` authentication
styles already documented (P2E dossier), and consistent with a
CONFIGURED_UNVERIFIED-vs-AUTH_INVALID distinction being a real, credible
failure mode (a key that is valid-shaped but not yet ACTIVATED, or tied
to a lapsed/incorrect subscription state) rather than necessarily a
malformed-credential problem. No credential was requested or would be
requested to investigate this further, per the standing security
discipline.

**Post-auth activation playbook** (one independently-accepted/rejected
capability per step, matching P2F's own per-family qualification
architecture exactly -- no all-or-nothing activation):

```
1. AUTH -> confirm secretState transitions to AUTH_VALID (already
   real-code-verified in P2F's qualifyOptionomicsProvider)
2. CHAIN -> run the existing REAL_AUTHENTICATED qualification path,
   confirm identity/timestamp/schema on a real payload
3. QUOTE FIELDS -> apply the section 7-9 no-OPRA qualification standard
   to the SAME real chain payload's bid/ask fields
4. GREEKS -> cross-check a sample against bs_reference.py's own
   independent BS computation (existing, dependency-free)
5. IV -> same cross-check discipline
6. SKEW/TERM/SURFACE -> confirm whether the metrics endpoint's fields are
   genuinely summary-only or unexpectedly include a raw grid (resolves
   this pass's own UNVERIFIED finding)
7. FLOW/NET_FLOW/UOA -> confirm units/scale per the P2F research pass's
   own procedure (premium vs. notional vs. contract count)
8. GEX/DEX/VANNA/CHARM -> run the sign-disagreement-detection procedure
   against THETA's own spot-scan (GEX only; DEX/Vanna/Charm have no
   independent THETA comparator yet, so these steps confirm EXISTENCE/
   SCHEMA only, not sign correctness)
9. EVENTS -> confirm known_at is genuinely populated and causally prior
   to scheduled_at on real payloads
10. HISTORY -> confirm actual coverage depth and whether any PIT-safety
    field (a known_at-equivalent) exists on historical endpoints
    specifically (this pass's own new caution, section 19)
11. QUOTE EXECUTION-PRICE QUALIFICATION -> apply the full empirical
    evidence bundle (section 9) across repeated real observations before
    ever considering TRUSTED_TWO_SIDED_ORDER_PRICING reachable
```

Each step is independently ACCEPT/REJECT -- a REJECT on step 6 (surface)
never blocks step 7 (flow) from proceeding, matching P2F's own
already-verified per-family independence.

## 35. No second provider until necessary -- verdict

**No concrete Vega capability deficiency was found this pass that THETA
cannot reasonably live without.** Every genuinely missing item found
(print-level flow aggressor/opening-closing/customer-dealer semantics;
pre-2024 point-in-time contract reference; historical PIT-safety
guarantees on non-event endpoints) is EITHER already correctly served by
Massive Free's narrow, already-approved role (contract reference) OR is
a fundamental data-availability gap no ADDITIONAL PAID FEED would
actually close either (print-level flow data was never found documented
by ANY provider searched across three research passes -- this is not a
Vega-specific gap a competitor would necessarily fill). **PAID_OPRA_REQUIRED
= NO, PAID_MASSIVE_REQUIRED = NO, per the directive's own default,
unchanged by this pass's findings.**

## 36-37. Source quality and repository research

Evidence hierarchy applied throughout: Optionomics' own official docs
(`docs.optionomics.ai`, `optionomics.ai/pricing`, `optionomics.ai/for/quant-traders`)
and Massive's own official docs (`massive.com/docs/...`) were the
PRIMARY sources this pass, consistent with section 36's own priority
order; secondary/SEO summaries were used only where a primary fetch
failed (the pricing-tier rate-limit figure, explicitly flagged as
UNVERIFIED/CONFLICTING rather than trusted). **No repos deep-studied
this pass** -- none of the six named candidate areas (synthetic broker
lifecycle, assignment modeling, order-state simulation, immutable event
sourcing, options quote qualification, adjusted-contract normalization)
required a NEW repo citation this pass, since the synthetic-lifecycle
acceptance-matrix design (section 23) was answerable directly from
THETA's own existing, already-audited P1-P2F architecture (roll/
assignment/CC/call-away mechanics, TCA phase separation) without needing
external methodology -- named honestly as not attempted, per section 37's
own "no repo-mining loop" instruction, rather than searched superficially
for the sake of populating this section.

## Receipt

```
CURRENT_CLAUDE_SHA: (see the commit this pass produces on claude/theta-r1-real-state)

OPTIONOMICS_PLAN_ASSUMED = VEGA

VEGA_CAPABILITY_MATRIX: COMPLETE (section 4 -- full family-by-family table)
VEGA_API_CAPABILITIES: COMPLETE (REST API + all metrics, Vega-exclusive;
  every lower tier is UI-only)
VEGA_MCP_CAPABILITIES: EXISTENCE-CONFIRMED (MCP server documented to exist
  for Vega; real schema unconfirmed, not currently THETA's own integration
  transport)
VEGA_HISTORICAL_CAPABILITIES: PARTIALLY VERIFIED ("15+ years" claimed;
  PIT-safety of historical endpoints specifically UNVERIFIED -- new caution
  this pass, section 19)

VEGA_REPLACES_RAW_OPRA_PIPELINE_FOR: chain reconstruction, IV rank/
  percentile, flow aggregation (aggregate series), UOA detection
VEGA_PARTIALLY_REPLACES_RAW_OPRA_PIPELINE_FOR: Greeks, IV, skew/term
  (summary stats only), GEX, DEX/Vanna/Charm, gamma flip/walls, historical
  chain warehousing, strategy backtesting datasets (as a convenience, not
  a promotion-standard substitute)
RAW_FEED_STILL_REQUIRED_FOR: NONE as a third-party feed -- THETA's own SVI
  fit uses Vega's own raw per-contract chain IVs, not an external raw feed
NOT_REQUIRED_FOR_THETA: an independent DEX/Vanna/Charm VALUE computation,
  an independent expected-move computation, a third-party historical
  options warehouse

THETA_DERIVED_ANALYTICS_RECOMMENDATIONS: COMPLETE (section 6 -- KEEP GEX
  spot-scan/SVI-fit/VRP/flow-temporal-deltas/exposure-temporal-deltas;
  DO NOT BUILD an independent DEX value or expected-move computation
  absent a concrete motivating gap)

VEGA_CHAIN_QUOTE_RESEARCH: COMPLETE (section 7 -- session-recorded cadence,
  no streaming transport documented)
VEGA_BID_ASK_DOCUMENTATION: COMPLETE (exists on the chain endpoint; spread
  is a raw per-snapshot quantity)
VEGA_QUOTE_TIMESTAMP_DOCUMENTATION: COMPLETE (ISO 8601 UTC per-chain
  timestamp; exact update cadence UNVERIFIED, requires real observation)
VEGA_QUOTE_UPDATE_CADENCE_DOCUMENTATION: UNVERIFIED (no explicit refresh
  interval documented anywhere found; empirical measurement required)
VEGA_EXECUTION_FEED_LIMITATIONS: COMPLETE (provider's own "not real-time
  quote or execution," "no endpoint here streams" self-description,
  re-confirmed unchanged across three research passes)

TRUSTED_TWO_SIDED_ORDER_PRICING_STANDARD: COMPLETE (closed this pass --
  the exact evidence bundle, explicitly NOT requiring OPRA provenance)
CONSOLIDATED_NBBO_STANDARD: COMPLETE (requires provider-documented
  OPRA/consolidated sourcing; Vega structurally cannot ever qualify here)
NO_OPRA_PAPER_EXECUTION_STANDARD: COMPLETE (closed this pass -- the
  mechanism by which Vega alone, once qualified, could support Paper
  execution without any paid OPRA subscription)

PAPER_LIMIT_PRICE_RESEARCH: COMPLETE (section 10 -- mechanics only, no
  permanent rule proposed)

ALPACA_BASIC_AUTHORITY_MAP: COMPLETE (unchanged, restated briefly per
  directive's own "do not re-research" instruction)
VEGA_ALPACA_COMBINED_ARCHITECTURE: COMPLETE (section 12 -- four data-
  crossing points examined, no authority conflict found)

VEGA_FEATURE_FAMILY_INDEPENDENCE: COMPLETE (section 13 -- confirmed no
  canonical branch currently hard-depends on any Optionomics family;
  every family is already optional context by construction)

FLOW_RESEARCH: COMPLETE (section 14)
UOA_RESEARCH: COMPLETE (section 14, same treatment)
GEX_RESEARCH: NO_CHANGE_REQUIRED (unchanged from P2E/P2F)
DEX_RESEARCH: NO_CHANGE_REQUIRED
VANNA_RESEARCH: NO_CHANGE_REQUIRED
CHARM_RESEARCH: NO_CHANGE_REQUIRED
GAMMA_FLIP_RESEARCH: NO_CHANGE_REQUIRED
WALLS_RESEARCH: NO_CHANGE_REQUIRED
VOLATILITY_RESEARCH: COMPLETE (section 6/17 -- KEEP THETA's own SVI fit,
  reasoned explicitly)
EVENT_RESEARCH: NO_CHANGE_REQUIRED
HISTORICAL_RESEARCH: COMPLETE (closed this pass -- the PIT-safety caution,
  section 19, is genuinely new)

MASSIVE_FREE_UNIQUE_CAPABILITIES: COMPLETE (closed this pass -- as_of,
  expired, correction, additional_underlyings, all real and documented)
MASSIVE_FREE_REDUNDANT_CAPABILITIES: COMPLETE (live quotes/Greeks/IV --
  Vega already covers this at a less restrictive rate limit)
MASSIVE_PIT_REFERENCE_VALUE: COMPLETE -- genuinely useful for historical
  contract identity and adjusted-contract reconstruction specifically
ADJUSTED_CONTRACT_REFERENCE_REQUIREMENTS: COMPLETE (section 22 -- cfi,
  exercise_style, shares_per_contract, additional_underlyings, correction,
  primary_exchange; none currently present in THETA's own contract schema,
  a concrete recommendation for Codex)

SYNTHETIC_LIFECYCLE_ACCEPTANCE_MATRIX: COMPLETE (closed this pass -- five
  canonical paths plus a defined-risk variant, each with a specific,
  non-trivial invariant to prove, not merely "does not crash")
WHOLE_CHAIN_ACCOUNTING_INVARIANTS: NO_CHANGE_REQUIRED -- reviewed, no
  genuine new gap found, not reopened per the directive's own instruction

WINNER_LOSS_PATH_VALIDATION: NO_CHANGE_REQUIRED (already fully specified
  by position_path_state_research.py from a prior pass)
SMALL_LARGE_PROFIT_VALIDATION: NO_CHANGE_REQUIRED (already fully specified
  by the existing ActionInactionFrontier/HoldEvidenceState design)
WAIT_PARALYSIS_VALIDATION: NO_CHANGE_REQUIRED (already fully specified by
  wait_diagnostics_research.py's ten-way taxonomy)
HOLD_PARALYSIS_VALIDATION: NO_CHANGE_REQUIRED (same reasoning)

FIRST_PAPER_ORDER_READINESS_STANDARD: NO_CHANGE_REQUIRED (unchanged from
  the P2F research pass, already comprehensive)
FIRST_PAPER_OBSERVABILITY: NO_CHANGE_REQUIRED (same)
FIRST_PAPER_TEMPORARY_VALIDATION_CONTROLS: NO_CHANGE_REQUIRED (same,
  explicitly not promoted to permanent policy)

R8_EVIDENCE_LADDER: COMPLETE (closed this pass -- adds the explicit
  natural-vs-forced distinction for assignment/recovery/CC/call-away
  milestones)
R8_COMPLETION_EVIDENCE_DIMENSIONS: NO_CHANGE_REQUIRED (unchanged
  multi-dimensional bar; no magic N proposed, effective-N methodology
  already exists)

OPTIONOMICS_401_STATUS = PROVIDER_BLOCKER (unchanged, not re-diagnosed
  repeatedly)
OPTIONOMICS_POST_AUTH_ACTIVATION_PLAYBOOK: COMPLETE (closed this pass --
  eleven independently-accepted/rejected steps)

CONCRETE_CAPABILITY_GAPS_REQUIRING_ANOTHER_PROVIDER: NONE FOUND (section 35
  -- print-level flow semantics are a universal gap no alternative
  provider was found to close either; pre-2024 PIT contract reference is
  already served by Massive Free's existing, approved, narrow role)

PAID_OPRA_REQUIRED = NO (unless proven otherwise by a concrete missing
  capability -- none found)
ALPACA_OPRA_REQUIRED = NO
PAID_MASSIVE_REQUIRED = NO

REPOS_DEEP_STUDIED: none this pass (section 37 -- no repo-mining loop;
  the synthetic-lifecycle design was answerable from THETA's own existing
  architecture)
NEW_HYPOTHESES: 0 registered (no resolved-label-dependent claim made this
  pass)

RECOMMENDATIONS_FOR_CODEX: (1) resolve the rate-limit discrepancy (1,000
  vs. 100 req/min) against real Vega response headers once auth succeeds,
  rather than trusting either secondhand figure; (2) add cfi/exercise_style/
  shares_per_contract/additional_underlyings/correction/primary_exchange
  fields to THETA's own contract-identity schema (section 22), sourced
  from Massive Free's already-approved narrow role, before any adjusted-
  contract edge case is encountered in real Paper activity; (3) the
  eleven-step post-auth activation playbook (section 34) is ready to
  execute the moment real Optionomics authentication succeeds, with no
  further research design needed first; (4) confirm whether Vega's
  historical chain/metrics/flow endpoints carry any known_at-equivalent
  PIT-availability field before ever using them for anything beyond
  cross-sectional reference (section 19's new caution).

HIGH_WIN_RATE_OBJECTIVE = ACTIVE_OPEN_ENDED_OPTIMIZATION
REFERENCE_TARGET_REGION = APPROXIMATELY_70_TO_80_PERCENT_WHOLE_CHAIN_WR_BUT_NOT_A_LIMIT_OR_REQUIREMENT
STRONG_RETURN_OBJECTIVE = ACTIVE_OPEN_ENDED_OPTIMIZATION
REFERENCE_HIGH_RETURN_REGION = 40_PERCENT_PLUS_WHERE_ECONOMICS_SUPPORT_IT_BUT_NOT_A_LIMIT_OR_REQUIREMENT
FIXED_40_PERCENT_TAKE_PROFIT = NO
FIXED_MINIMUM_PROFIT_ENTRY = NO
FIXED_MINIMUM_WIN_RATE_ENTRY = NO

MAIN_PUSHED = NO
PRODUCTION_CHANGED = NO
BROKER_ORDERS_BY_CLAUDE = 0
LIVE_OWNER_AUTHORIZATION = NOT_GRANTED
LIVE_ELIGIBLE = NO
```
