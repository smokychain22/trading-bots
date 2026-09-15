# THETA P2F: Execution Quote Authority + Optionomics Real Qualification +
# R7→R8 Activation Standard

Research-only pass. `CURRENT_MAIN_SHA_AT_START`: `3bd0484c78d393ecb1862f0c18d69c113295b1f5`
(P2E, CLOSED; Codex is implementing P2F in parallel, not audited this pass).
No new code this pass -- every section below is a design/evidence document,
consistent with the directive's own all-research scope.

## 1. Scope discipline

Per the directive's explicit "do not repeat completed research" instruction,
this document does NOT re-derive: time/path-state research
(`THETA_ACTION_INACTION_TIME_PATH_RESEARCH.md`, `position_path_state_research.py`),
basic Optionomics capability inventory
(`THETA_P2E_OPERATOR_PROVIDER_QUALIFICATION_RESEARCH.md` section 11 -- the
field-by-field DOCUMENTED/UNVERIFIED table), or basic explainability
(`explainability_schema_research.py`). It cites them by reference and
extends only where a genuinely new P2F question exists: real transport
qualification, execution-quote-authority provider comparison, and the
R7→R8 activation boundary.

## 2-4. Trusted execution quote research -- Alpaca OPRA (deep-read this pass)

Sourced via direct fetch of `docs.alpaca.markets/us/docs/real-time-option-data`,
`.../historical-option-data`, and `.../options-trading` this pass. This is
the FIRST time this engagement has directly fetched Alpaca's own current
options-market-data documentation (prior sessions worked from the TRD's
own provider assumptions, not a fresh doc pull) -- genuinely new evidence.

**The single most important finding**: Alpaca's data documentation draws
an explicit, named distinction between two feeds, and this engagement's
own standing caution about Optionomics turns out to apply to Alpaca's
OWN free tier too:

| Feed | Alpaca's own description | OPRA-sourced? | Delay | Cost |
|---|---|---|---|---|
| `indicative` | "derivative quotes (not actual OPRA quotes)... trades also derivatives and they're delayed by 15 minutes" (historical-option-data docs, quoted verbatim) | NO -- explicitly stated to be DERIVED, not real OPRA data | 15 minutes (trades) | Free |
| `opra` | The real consolidated feed; "OPRA feed is only available to subscribed users" (quoted verbatim); BBO defined as "the highest bid and lowest offer for a series of options available in one or more of the options markets" | YES | Real-time (streaming) | Paid subscription required (partner pricing found: "$1,000/month" for an equities-plan-equivalent add-on, per a secondary search result -- not independently confirmed against Alpaca's own pricing page this pass, flagged as UNVERIFIED pricing specifically) |

**Critical, previously-undocumented-in-this-engagement fact**: Alpaca's
own default/free option data feed is NOT OPRA at all -- it is a DERIVED,
15-MINUTE-DELAYED substitute the docs themselves call "indicative." This
means the exact same `INDICATIVE`/`RESEARCH`-tier classification this
engagement has applied to Optionomics throughout (P2E audit, confirmed
correct) potentially ALSO applies to whatever feed THETA's own broker
integration is actually consuming today, unless it has been explicitly
provisioned onto the paid `opra` feed -- **this is a verification item
for Codex, not something this research pass can resolve without reading
THETA's own current Alpaca subscription configuration**, flagged
explicitly in `RECOMMENDATIONS_FOR_CODEX` below.

**Quote/trade object fields** (real-time-option-data docs): trades carry
`T` (type), `S` (OCC symbol, e.g. `"AAPL240315C00172500"`), `t` (RFC-3339
nanosecond timestamp), `p` (price), `s` (size), `x` (exchange code), `c`
(condition code). Quotes carry `bx`/`bp`/`bs` (bid exchange/price/size),
`ax`/`ap`/`as` (ask exchange/price/size), `c` (quote condition). Exact
contract identity is the OCC symbol string itself -- no ambiguity, matches
this engagement's own exact-contract-identity discipline directly.

**Streaming only, no snapshot documented** for real-time quotes ("using
the stream provides much better accuracy and performance than polling the
latest historical endpoints" -- the docs actively discourage polling).
msgpack-only wire format (`Content-Type: application/msgpack`), and
wildcard subscription (`*`) is explicitly disallowed for option quotes
("there are simply too many").

**Broker trading authority vs. market-data entitlement, confirmed
SEPARATE systems** (directive's own explicit ask, section 4): the
options-trading docs state plainly "In the Paper environment, options
trading capability will be enabled by default -- there's nothing you need
to do!" -- broker ORDER PLACEMENT capability is unconditional in Paper.
But the SAME docs are explicitly SILENT on which market-data feed a Paper
account receives by default, whether it's real-time or delayed, full or
indicative. **This is a real, unresolved gap in Alpaca's own public
documentation, not an inference this engagement is making** -- the two
systems (trading authority, data entitlement) are documented as separate
services with separate subscription paths, and nothing found this pass
confirms Paper accounts get `opra`-tier data by default.

**Historical data**: "Currently we only offer historical option data since
February 2024" -- a real, hard coverage-start boundary worth knowing
before any backtest attempts to reach further back.

**Rate limits**: NOT documented in any of the three pages fetched this
pass -- `UNVERIFIED`, consistent with the directive's own instruction to
mark undocumented items honestly rather than guess.

## Other execution-quote providers (existence-level, one comparison point)

**Polygon.io (rebranded "Massive" in early 2026)**: searched, existence
and OPRA-licensing confirmed (real-time/historical/reference data via
REST/WebSocket/flat-files, sourced from "all 17 U.S. options exchanges,"
delivering "the official National Best Bid and Offer (NBBO)"). NOT
deep-read this pass (no specific field/entitlement/rate-limit page
fetched) -- named as a genuine, real, OPRA-consolidated alternative worth
a future deep-read if Alpaca's own OPRA entitlement proves
cost-prohibitive or insufficiently documented, but not qualified to any
further degree this pass. Per the directive's own section 25 instruction
("search-result existence alone does not count as deep-study"), this is
explicitly logged as EXISTENCE-CONFIRMED, NOT DEEP-STUDIED.

No other provider was searched this pass -- time budget went to the
Alpaca deep-read (the provider THETA already integrates with) and the R8
activation-standard design, judged the higher-value uses of this pass's
budget.

## 3. Provider evidence hierarchy -- requirements per tier

Restating and sharpening this engagement's existing five-tier vocabulary
with EXACT qualification requirements per tier, closing the "what exactly
proves each tier" gap:

```
CONSOLIDATED_NBBO
  Requires: a feed the provider ITSELF documents as sourcing/aggregating
  the official OPRA consolidated tape (e.g. Alpaca's `opra` feed, Polygon/
  Massive's OPRA-licensed feed) -- confirmed by the PROVIDER'S OWN
  documentation naming OPRA/consolidated-NBBO explicitly, never inferred
  from the mere presence of a bid/ask pair.

TRUSTED_TWO_SIDED_ORDER_PRICING
  Requires: CONSOLIDATED_NBBO-tier sourcing PLUS a real, empirically
  qualified freshness bound (section 10 below) confirmed against actual
  observed payloads -- a feed can be genuinely OPRA-sourced yet still fail
  this tier if its OBSERVED staleness at decision time exceeds whatever
  bound the execution logic requires.

INDICATIVE
  A feed the provider's OWN documentation describes as derived/delayed/
  approximate (Alpaca's own word for its free feed, quoted above;
  Optionomics' own "research, screening and analytics, not real-time quote
  or execution" self-description, P2E's dossier). This tier requires
  NOTHING further to assign -- the provider's own words are sufficient
  and authoritative.

SESSION_RECORDED_RESEARCH
  A feed only ever observed/replayed after the fact (e.g. Optionomics'
  own "chains and metrics per session" cadence) -- usable for research
  temporal-delta computation, never for a live pricing decision.

UNKNOWN
  Default for anything not yet checked against provider documentation --
  the SAFE default, never upgraded without the specific evidence above.
```

**Never infer NBBO merely because bid/ask exist** (directive's explicit
instruction) -- this is the single most important discipline in this
table: Alpaca's OWN `indicative` feed HAS bid/ask fields with the exact
same shape as its `opra` feed's fields (same `bp`/`bs`/`ap`/`as` schema);
the FIELD SHAPE is identical between tiers, and only the PROVIDER'S OWN
STATEMENT about sourcing distinguishes CONSOLIDATED_NBBO from INDICATIVE.
This is a concrete, real example of exactly the failure mode the
directive warns against, found in this pass's own research.

## 5. Optionomics HTTP/auth -- unchanged from P2E's dossier, cited not repeated

Base URL `https://optionomics.ai`, `X-USER-EMAIL`+`X-USER-TOKEN` or
`Authorization: Bearer`, 1,000 req/min with `X-RateLimit-*` headers and
429+`Retry-After`, "ISO 8601 in UTC unless marked otherwise" timestamps,
error codes 400/401/402/403/404/422/429/500 -- all already documented in
`THETA_P2E_OPERATOR_PROVIDER_QUALIFICATION_RESEARCH.md` section 11, not
re-fetched this pass since nothing about this layer is a live P2F
uncertainty (per section 24's own "if sufficiently answered, COMPLETE"
instruction).

## 6. Optionomics qualification sample plan -- schema vs. statistical, separated

**Schema qualification** (what section 6 actually asks for -- NOT a
trading-validity bar):

```
Per feature family:
  - >=3 independent payloads, spanning >=2 distinct trading sessions
    (never all from one snapshot -- catches an endpoint that only ever
    returns cached/stale data)
  - >=2 distinct underlying symbols (catches symbol-specific schema quirks)
  - for chain-level families (GEX/DEX/Vanna/Charm/surface): >=2 distinct
    expirations within at least one of those payloads (catches an
    endpoint that silently collapses multi-expiration data)
  - >=1 payload captured during REGULAR_SESSION and >=1 during
    MARKET_CLOSED/POST_CLOSE (catches a field that is only populated
    during live trading -- distinguishes "field is genuinely null" from
    "field is only available intraday")
  - >=1 deliberately-chosen thin/illiquid symbol, to observe a genuine
    null/missing-data example rather than only ever seeing populated rows
  - rate-limit observation: OPTIONAL, only if it can be obtained by
    ordinary qualification traffic naturally approaching the documented
    1,000/min bound -- never a deliberate stress test against a paid
    account's real limits
```

This sample plan is intentionally SMALL and NON-ARBITRARY -- its purpose
is confirming the DOCUMENTED SCHEMA matches the REAL PAYLOAD SHAPE
(section 12's `qualifyOptionomicsCapabilities` inputs), never a
statistically powered trading-edge claim. **Statistical trading
validation is an entirely separate, much larger undertaking** (R8's own
evidence ladder, section 15 below) requiring hundreds of independent
resolved episodes, not a handful of qualification payloads -- conflating
the two would either make qualification impossibly slow or make
statistical validation dangerously premature; keeping them separate is
the entire point of this section.

## 7. GEX/DEX/Vanna/Charm real qualification -- sign-convention detection test

Extends P2E's dossier (section 13, "what MUST be learned from real
responses") with the SPECIFIC test that can DETECT an incorrect sign
convention, not just flag the ambiguity:

```
1. Capture a real GEX/DEX/Vanna/Charm payload for a liquid underlying at
   a known spot price.
2. Independently compute THETA's own spot-scan value at the SAME spot,
   SAME underlying, SAME approximate timestamp using
   gex_spot_scan_research.py (already built, this branch).
3. Compare SIGN only (not magnitude -- magnitude comparison requires
   matching OI-vs-volume weighting and multiplier conventions, a separate,
   harder problem): if THETA's independent spot-scan reports a NEGATIVE
   regime (put-side gamma dominant) and Optionomics reports a POSITIVE
   GEX number at the same moment, at least one of the two sign
   conventions is inverted relative to the other -- this is a detectable
   DISAGREEMENT, not a proof of which one is "correct" (dealer-position
   sign is fundamentally a modeling assumption on both sides, per this
   engagement's own standing GEX discipline).
4. Repeat across >=3 different spot/underlying combinations spanning both
   an observed positive-gamma-regime day and a negative-gamma-regime day
   (per THETA's own spot-scan classification) -- a sign convention that
   agrees on one day and disagrees on another indicates a MORE SUBTLE
   bug (e.g. a spot-scaling mismatch, not a pure sign flip) than a
   convention that disagrees consistently.
```

This is a real, executable procedure once real payloads exist -- not
executed this pass (no key). Same procedure structure applies to
DEX/Vanna/Charm, substituting the corresponding THETA-derived comparison
(DEX has no independent THETA-derived comparator built yet -- a genuine
gap, named honestly, not fabricated).

## 8. Flow real qualification -- what can and cannot be inferred

Per P2E's dossier, Optionomics' flow endpoints are confirmed AGGREGATE and
dollar-denominated ("net flow for symbol" as a bucketed time series).
What CAN be verified from documentation + a real payload: whether the
reported number is premium (dollars) vs. notional (dollars x multiplier,
a materially different scale) vs. contract count -- checkable by
comparing the reported magnitude against a simultaneously-observed
option's own premium x a plausible contract-count range; a number in the
tens-of-thousands for a single moderate print suggests premium, a number
in the millions suggests notional or an aggregate across many prints.
What CANNOT be inferred from an aggregate feed, regardless of
qualification effort: individual-print buyer/seller aggressor side,
opening-vs-closing intent, or customer-vs-dealer counterparty -- these
require print-level data Optionomics has never documented providing
(confirmed again this pass, no new evidence found). The qualification
procedure's job here is confirming the SCALE/UNITS of the aggregate
number, not attempting to recover print-level semantics that do not
exist in the source data.

## 9. Event temporal qualification -- known_at mapping, closed this pass

Extends P2E's finding (the `known_at` field, "which is what keeps an
event-driven backtest from trading on announcements before they were
announced" -- Optionomics' own words). PIT-safe mapping, concrete:

```
EventRecord.event_timestamp     <- events endpoint's `scheduled_at` (or `date`)
EventRecord.source               <- "optionomics_events" (literal, versioned)
EventRecord.freshness_seconds    <- (decision_time - known_at), NOT
                                     (decision_time - scheduled_at) -- known_at
                                     is the PIT-safe anchor; scheduled_at may be
                                     a FUTURE date announced far in advance
EventRecord.max_freshness_seconds <- caller-supplied, per event_state_research.py's
                                     existing discipline, never invented here
```

The critical distinction this mapping makes explicit: `scheduled_at` is
WHEN the event will happen (often known far in advance for macro/fed
events), while `known_at` is WHEN THE SYSTEM LEARNED the event was
scheduled -- for a PIT-safe backtest, ONLY `known_at` may gate whether a
historical decision "knew about" the event, exactly matching
`event_state_research.py`'s own `EventRecord.freshness_seconds` design
(this branch, P2C-pass-2) without needing any redesign. Earnings/ex-
dividend coverage in the `kinds` enum remains UNVERIFIED (unchanged from
P2E's finding -- not re-tested this pass, no new evidence).

## 10. Execution quote qualification standard -- disqualifiers

```
QUOTE_DISQUALIFIERS (any ONE disqualifies a quote from execution-grade use):
  - Contract identity mismatch (OCC symbol on the quote != OCC symbol of
    the intended order) -- absolute, never overridden
  - Crossed market (bid > ask) -- a data/venue error, not a real tradeable state
  - Bid or ask missing (one-sided) when a two-sided requirement applies
  - Timestamp older than a caller-justified freshness bound (never a
    hardcoded universal number, matching this engagement's standing
    no-invented-threshold discipline)
  - Feed explicitly self-documented as indicative/derived/delayed
    (Alpaca's own `indicative` feed, Optionomics entirely) -- structural,
    not a runtime check
  - Session misalignment: a quote timestamped during a DIFFERENT session
    than the current decision's own session (e.g. a stale pre-market
    quote used mid-regular-session)
  - Locked market (bid == ask) flagged by the source itself as a
    condition code, if the feed documents such codes (Alpaca's `c`
    condition-code field) -- a genuine but unusual state, disqualifying
    pending the caller's own explicit handling policy, never silently
    traded through
```

`QUALIFICATION_PROCEDURE` (bounded, six checks, directly answering
section 10's own list): exact OCC mapping (string equality, absolute),
bid/ask sanity (bid<=ask, both positive), two-sidedness (both present),
freshness (caller-bound), session alignment (quote session == decision
session), source semantics (feed self-classification per the tier table
in section 3). Each check is independently pass/fail, never blended into
one score -- a caller can see exactly which check failed.

## 11. Cross-provider quote consistency -- without false-defect labeling

Comparing a broker feed against an external data feed (e.g. Alpaca's own
quote vs. a hypothetical Optionomics-derived one) must NOT treat every
observed difference as a bug, because genuine, non-defect sources of
difference exist: **timestamp skew** (two feeds rarely timestamp the
identical microsecond, a few-hundred-millisecond difference is normal
network/processing latency, not a data quality issue); **venue
aggregation differences** (one feed's NBBO may reflect a different set of
participating exchanges at that instant than another's, especially
during a fast market); **size differences** (displayed size at the NBBO
can differ between feeds due to iceberg/reserve orders each feed's own
venue visibility differs on); **delays** (comparing an `opra` feed
against an `indicative` feed is EXPECTED to show a 15-minute-scale
difference, not a defect -- the tier table in section 3 already
classifies this correctly, this section's contribution is the
COMPARISON discipline specifically); **odd market states** (crossed/
locked markets can appear briefly and legitimately during fast-moving
conditions, especially at the open). No trading rule is proposed for any
of this -- this is purely a QUALIFICATION-INTERPRETATION discipline, so a
future cross-provider check does not mislabel expected variance as a
provider defect.

## 12-13. Paper activation standard -- FIRST_PAPER_ORDER_READY vs. POLICY_EMPIRICALLY_VALIDATED

Directive's own explicit instruction upheld: model profitability is NOT
a precondition for a first Paper order (Paper trades are needed to
COLLECT evidence, not to confirm it in advance). The two standards, kept
structurally distinct:

```
FIRST_PAPER_ORDER_READY (operational safety only -- what this section defines):
  REQUIRED:
    - execution quote genuinely qualified per section 10 above (not merely
      "a number exists")
    - AEGIS risk gates active and unmodified from their existing P1-P2E
      configuration
    - MASTER_PAPER_EXECUTION_ENABLED=true AND PAPER_PAUSE_NEW_ORDERS=false
      AND emergencyExecutionLock=false (the existing, unchanged gate
      conjunction from the P2E audit)
    - broker reconciliation runs successfully immediately before AND
      immediately after the submission (never submit blind, never leave
      a submission unreconciled)
    - a single MASTER account only (no follower activation -- unchanged,
      structurally enforced elsewhere)
    - logging sufficient for full postmortem (section 22 below)
  NOT REQUIRED:
    - any resolved P&L history
    - any effective-N threshold
    - any calibration evidence
    - any promoted management policy (HOLD/CLOSE decisions after the
      first fill remain under existing deterministic P1-P2E rules, not
      an empirically-trained policy, since PRODUCTION_MANAGEMENT_POLICY_PROVIDER
      remains NOT_PROMOTED_UNAVAILABLE throughout R8)

POLICY_EMPIRICALLY_VALIDATED (a much later, separate standard -- R9-adjacent):
  Requires the full existing promotion contract this engagement has
  built throughout P2C-P2D (purged walk-forward, untouched OOS, DSR/PBO,
  calibration, effective-N minimums, human approval strictly after OOS
  completion) -- entirely unrelated to whether a first Paper order has
  been placed.
```

**First-Paper operational plan** (section 13, conservative-by-design,
recommendations not permanent restrictions): single master account
(already structurally the only option); tiny/safe sizing strictly within
existing AEGIS caps (no new sizing logic needed -- the existing caps
already bound this, the RECOMMENDATION is simply not to request an
AEGIS-cap increase for the first order); one strategy branch at a time
initially (reduces the number of simultaneously novel code paths under
observation, though nothing PREVENTS more once the first is validated
operationally); prefer a NORMAL REGULAR_SESSION window over
OPENING_WINDOW/CLOSING_WINDOW/EXPIRY_FINAL_WINDOW for the very first
attempt specifically (avoids conflating a genuine operational defect with
a known-volatile microstructure window, per section 3's own prior-pass
findings); immediate reconciliation before AND after (stated above).
None of this is proposed as a permanent strategy constraint -- purely a
"reduce the number of simultaneously novel variables in the very first
real-money-adjacent event" operational discipline.

## 14-15. R7→R8 boundary and evidence ladder

```
R7_ENGINEERING_COMPLETE requires (all already true per the P2E audit):
  - management-first runtime, five-branch evidence, path/timing evidence,
    action-vs-inaction frontiers -- all real, tested code (P2E, CLOSED)
  - AEGIS, follower lock, execution gate unchanged and verified (every
    audit through P2E)
  - dataset v6 exports every new evidence family with hard leakage/
    authority rejections (P2E, verified)

R7_PROVIDER_COMPLETE requires (NOT yet true -- this is P2F's own remaining work):
  - execution quote genuinely qualified per section 10 (currently
    NOT_QUALIFIED, structurally enforced)
  - Optionomics auth/capability real qualification substantially run
    (currently NOT_ATTEMPTED, correctly, no key)

R8_START requires: R7_ENGINEERING_COMPLETE AND R7_PROVIDER_COMPLETE both
  true, PLUS an explicit owner authorization to place the FIRST real
  Paper order (a distinct, deliberate go/no-go decision, never automatic
  the moment provider qualification finishes)

R8_COMPLETION requires MUCH MORE than "one Paper order placed" (directive's
  own explicit instruction) -- see the evidence ladder below; R8 completes
  when a SUFFICIENT (not minimal) set of real lifecycle events has been
  observed AND resolved, with effective-N research (not a fabricated
  final number) genuinely underway.
```

**R8 evidence ladder** (milestones, not a single N threshold):

```
FIRST_VALID_PAPER_SUBMISSION -> FIRST_FILL -> FIRST_MANAGEMENT_CYCLE ->
FIRST_CLOSE (or FIRST_LET_EXPIRE) -> FIRST_ROLL -> FIRST_ASSIGNMENT
(if naturally occurs -- never forced) -> FIRST_RECOVERY (if assignment
occurred) -> FIRST_CC (if recovery occurred) -> FIRST_CALL_AWAY
(if naturally occurs) -> FIRST_TERMINAL_WHOLE_CHAIN -> N_TERMINAL_CHAINS
(N itself a research question, not fixed here) -> EFFECTIVE_INDEPENDENT_N
_THRESHOLD_RESEARCH (ongoing, ties into the existing dependence-clustering
methodology this engagement already uses -- dataset_readiness.py's
DependenceGroupKey -- never a bare row count)
```

**No fabricated final N threshold** (directive's explicit instruction):
this engagement has never proposed one anywhere (every promotion
standard built through P2C-P2D requires a CALLER-supplied, justified
`min_independent_chain_n`, per `promotion_checker.py`'s own standing
discipline) -- this section reaffirms that discipline applies identically
to R8's own completion bar, not a new number invented here. R8 is
"complete enough to begin the SEPARATE R9 graduation conversation" when
the evidence ladder above has produced enough INDEPENDENT (not merely
numerous) terminal chains across enough of the ladder's own milestones
that `promotion_checker.py`'s existing machinery can be run at all --
a qualitative bar (ladder breadth), not a single quantitative one.

## 16-17. Operator concurrency -- stale-state and emergency-lock-clear patterns

Closes the two NON_BLOCKING_ENGINEERING_GAPs named in the P2E audit.

**Stale-state pattern recommendation**: of the four researched patterns
(optimistic locking, ETag/If-Match, monotonic state version,
compare-and-swap), **monotonic state version is the simplest robust fit**
for THETA's existing `ops.theta_operator_control_event` design (P2E,
verified). Concretely: the `current()` read already returns the latest
event's `requested_at`; extend the POST body to REQUIRE the caller to
echo back the `asOf` value it last observed (`z.object({..., observedStateAsOf:
z.string()}).strict()`), and reject with a `409`-equivalent
`STATE_CHANGED_SINCE_OBSERVATION` error when the current `asOf` no longer
matches -- this is functionally compare-and-swap over a single scalar
field, requires no new table or column (the timestamp already exists),
and directly reuses the SAME idempotency-key infrastructure already
built rather than introducing an ETag/HTTP-header-based mechanism that
would need new plumbing.

**Emergency-lock-clear pattern** (currently absent by design, per the
P2E audit -- P2E's own choice to fail permanently closed was itself the
SAFE default, not a defect; this section designs what an EXPLICIT clear
path should require when the owner decides to add one):

```
CLEAR_EMERGENCY_LOCK requires ALL of:
  - a DISTINCT, higher-privilege authorization than PAUSE/LOCK itself
    (asymmetric, matching this engagement's own P2E-research-pass
    recommendation, now reaffirmed)
  - fresh state re-read immediately before clearing (never clear against
    a stale observation -- the stale-state pattern above applies here too)
  - explicit confirmation carrying a REASON string (not just confirmed:true
    -- WHY is the lock being cleared, for the audit trail)
  - a fresh broker reconciliation run as part of the SAME clear operation
    (never clear a lock without first confirming current broker/position
    truth)
  - a full execution-gate recheck (quote qualification, AEGIS, policy
    provider state) performed AFTER clearing, before
    masterExecutionEnabled can ever read true again -- clearing the lock
    must NEVER itself flip masterExecutionEnabled; it only REMOVES the
    lock's own AND-condition, leaving every other existing gate
    (MASTER_PAPER_EXECUTION_ENABLED, PAPER_PAUSE_NEW_ORDERS, execution
    quote qualification) independently still in force
  - immutable audit row (reusing the existing ops.theta_operator_control_event
    table and its existing immutability trigger -- no new table needed,
    only a new `command` enum value, e.g. 'CLEAR_EMERGENCY_LOCK', added
    to the existing CHECK constraint)
```

**Clearing the lock must not itself authorize an order** (directive's own
explicit instruction) -- structurally guaranteed by the existing P2E
design: `masterExecutionEnabled` is computed as
`MASTER_PAPER_EXECUTION_ENABLED && !emergencyExecutionLock` at every one
of the four autonomous-runtime.ts call sites (verified in the P2E audit);
removing the lock only removes ONE of several independently-required
conditions, none of which a clear operation touches.

## 18. Path checkpoint storage -- hybrid recommendation

Closes the NON_BLOCKING_ENGINEERING_GAP named in the P2E audit (every-
cycle persistence). Three options researched:

```
EVERY-CYCLE SNAPSHOTS (P2E's current behavior): maximum research/
  auditability fidelity (every management_input_snapshot has a
  corresponding path/frontier/timing row), maximum storage cost (grows
  1:1 with management-cycle frequency across every open chain)

EVENT/TRANSITION CHECKPOINTS ONLY: minimum storage cost, but RISKS losing
  the exact peak/trough moment if the checkpoint-worthiness rule doesn't
  fire on it (e.g. a peak reached mid-cycle between two "worthy" events
  could be under-captured if worthiness is itself computed only from
  discrete triggers)

HYBRID (RECOMMENDED): persist EVERY cycle's raw PnL/spot/Greek OBSERVATION
  into a lightweight, narrower "tick" table (just the numbers needed to
  reconstruct peak/trough/velocity), but only materialize the FULL
  checkpoint_json (with classification, evidence snapshot, full context)
  on directive-section-7-named checkpoint-worthy transitions (NEW_PEAK,
  NEW_TROUGH, classification change, ROLL, ASSIGNMENT, CC_OPEN/CLOSE,
  CALL_AWAY, EXIT, SESSION_TRANSITION, DTE_TRANSITION, EVENT_STATE_CHANGE,
  FLOW_REVERSAL, GEX_REGIME_CHANGE -- the directive's own section 7 list)
```

**Protecting peak/trough/giveback reconstruction under the hybrid model**:
this is the design's central requirement -- the lightweight tick table
must NEVER be pruned/aggregated away before a chain terminates, since
`buildPositionPathCheckpoint`'s own peak/trough logic (P2E, verified)
needs the FULL raw history, not just the checkpoint-worthy subset, to
compute a mathematically correct peak. The RECOMMENDATION is therefore:
tick-table rows may be pruned/archived only AFTER the owning chain
reaches a terminal WHOLE_CHAIN_OUTCOME state (at which point the
resolved label's own `peakFutureProfit`/`worstFutureProfit` fields,
already computed and immutably persisted per P2C, become the durable
record) -- never pruned while a chain remains open. This preserves
research fidelity, training-data completeness, and storage efficiency
simultaneously, rather than trading one off against another as the
single-mode alternatives would.

## 19. Strategy versioning -- immutable-registry best practices

Using the real P2E incident as motivation only, not as proof of a
systemic problem (directive's own explicit framing) -- the incident
demonstrated the SAFETY NET worked (Production correctly rejected the
mismatch), not that the versioning architecture is broken. Best-practice
recommendations, all already substantially satisfied by the existing
design (verified in the P2E audit), restated as forward-looking guidance:

- **Semantic version + content hash together, never version alone**:
  already the case (`resolveStrategyVersion`'s `configurationHash`) --
  the hash is what actually DETECTS a silent payload change; the semver
  string is the human-facing identity. Keep both.
- **Old-version preservation**: already structurally guaranteed by the
  pre-existing `reject_immutable_mutation` trigger pattern on any
  persisted `core.strategy_version` row (P1) -- no NEW mechanism is
  recommended, since the existing one already worked correctly during
  the real incident.
- **Runtime migration**: when a strategy version changes, in-flight
  chains that reference the OLD version should continue resolving
  against it (never silently re-pointed to the new version) -- worth an
  explicit verification pass whenever a future version bump occurs,
  though no defect was found in the P2E delta specifically on this point
  (no in-flight chains existed yet at the time of the incident).
- **Reproducible backtests**: since `strategyVersion` is already part of
  every P2C/P2D/P2E outcome subject's own identity fields, any future
  backtest naturally reproduces against the EXACT version+hash that
  produced the original decision -- already correct by construction, not
  a new recommendation.
- **Rollbacks**: NOT the same as "reverting the version bump" -- a
  genuine rollback (returning to `1.0.0-research`'s exact payload) should
  itself be a NEW version (e.g. `1.0.2-research` with the old payload
  restored), never a re-use of `1.0.0-research`'s own identity, for the
  same reason the original incident occurred (reusing an identity for
  different content at different times is the exact anti-pattern this
  whole architecture exists to prevent).

## 20-21. Alerting refinement and WAIT/HOLD alert threshold

Refines P2E's own alerting schema (already built) with the two genuinely
new questions this section asks:

**Dedup semantics** (not previously specified): an alert should be
KEYED by `(alertClass, subjectIdentity)` -- e.g. `(BROKER_MISMATCH,
chainId)` or `(PROVIDER_AUTH_FAILURE, 'optionomics')` -- and a NEW
occurrence of the SAME key within a caller-justified dedup window should
UPDATE the existing alert's `lastObservedAt`/`occurrenceCount` rather
than create a new alert row; a genuinely NEW key always creates a new
alert. This prevents alert spam from a persistently-failing condition
(e.g. Optionomics auth down for an hour) generating one alert per check
cycle, while still surfacing a GENUINELY new problem (a different chain's
mismatch) immediately. `STRATEGY_VERSION_MISMATCH` (newly named this
pass, directly motivated by the P2E incident) belongs at CRITICAL
severity, matching `EXECUTION_GATE_CHANGE`'s own tier -- an unreviewed
version/hash mismatch is exactly the class of defect that incident
demonstrated can silently break runtime startup.

**WAIT/HOLD: INFO vs. WARNING, closed this pass**: a single WAIT or HOLD
cycle is ALWAYS `INFO` (or not alerted at all) -- never `WARNING` merely
because it occurred, per the directive's own explicit instruction. It
escalates to `WARNING` only when BOTH persistence AND evidence exist
simultaneously: `POSSIBLE_LOGIC_PARALYSIS`'s own existing definition
(`wait_diagnostics_research.py`, this branch) already requires BOTH
`consecutive_wait_cycles` exceeding a caller-supplied
`consecutive_wait_bound` AND (implicitly, via the classifier's own
priority ordering) the ABSENCE of a structural blocker explaining the
WAIT -- this existing, already-versioned, research-only classifier IS
the correct trigger condition; this section's only new contribution is
confirming explicitly that the ALERT layer should consume THIS
classifier's output as its trigger, rather than inventing a separate,
parallel threshold. No arbitrary un-versioned threshold is proposed here.

## 22. First-Paper observability requirements

```
Per first-Paper decision cycle, capture (mapping directly onto already-
existing P1-P2E evidence tables, no new schema needed):
  decision            -> trade.decision (existing)
  contract            -> exact OCC identity, already required throughout
  chain state         -> trade.economic_chain (existing)
  session             -> research.theta_strategy_timing_snapshot (P2E)
  quote                -> market.execution_quote_observation (existing) +
                          the qualification receipt from section 10
  strategy             -> canonicalThetaStrategyRegistry version+hash (P2E-audited)
  sizing                -> AEGIS sizing decision (existing, unchanged)
  AEGIS                -> aegisNewRiskState and every AEGIS evidence field (existing)
  submitted limit       -> TcaLegInput.submittedLimit (P2D/P2E)
  broker order ID        -> trade.broker_order (existing)
  status changes          -> trade.fill / lifecycle transitions (existing,
                            broker-reconciliation-gated)
  cancel/replace          -> TcaLegInput.cancelReplaceCount (P2E)
  TCA                      -> computeTcaBreakdown() (P2C/P2E)
  management path          -> research.theta_position_path_checkpoint (P2E)
  terminal outcome          -> research.theta_resolved_outcome_label,
                              WHOLE_CHAIN_OUTCOME (P2C/P2D)
```

Every item the directive names already has a real, existing home in the
schema built through P1-P2E -- this section's contribution is confirming
COMPLETENESS (nothing named is missing), not proposing new tables. This
is sufficient for a genuine postmortem: a reviewer can reconstruct the
full decision-to-terminal-outcome path from already-persisted, already-
immutable evidence for any first-Paper chain.

## 23. Whole-chain evidence -- reviewed, no genuine new gap found

Reviewed against the directive's own list (initial premium, roll
loss/credit, assignment, stock P&L, CC premium, CC rolls, call-away,
fees, slippage, capital-days) against the P2D-audited economic-truth
query (`option realized P&L + stock realized P&L + dividends - fees`,
independently verified to SUM every `option_leg` row -- including every
roll leg separately -- in the P2C/P2D audits). Every named dimension is
already captured: roll loss/credit is the natural consequence of summing
distinct leg rows (already verified, P2D audit's roll-loss-erasure
finding); slippage is now captured per-leg via `computeTcaBreakdown`
(P2C/P2E); capital-days is an existing observation field (P2C). **No
genuine missing research dimension found this pass** -- per the
directive's own section 24 instruction ("if sufficiently answered,
COMPLETE. Do not continue... merely because more repositories exist"),
this section closes without further action.

## 25. Repository research

**No new repos deep-read this pass.** Time budget went to the Alpaca
documentation deep-read (genuinely new, directly answers a live P2F
uncertainty) and the R7→R8/evidence-ladder design (the directive's own
stated main goal). Per section 25's own explicit instruction ("deep-study
only sources that directly answer a live P2F uncertainty" and "search-
result existence alone does not count as deep-study"), Polygon.io/Massive
is logged as EXISTENCE-CONFIRMED ONLY (section 2 above), not claimed as
deep-studied. No repo search was performed for "options quote ingestion /
OPRA-like feeds / broker order state reconciliation / optimistic-lock
operator controls / immutable strategy registries" specifically, since
this pass's two direct-documentation deep-reads (Alpaca's own docs) and
the concurrency-pattern research (section 16, derived from well-known,
uncontested computer-science patterns rather than requiring a specific
repo citation) already answered the live questions those searches would
have targeted -- named honestly as not attempted, not silently implied
covered.

## Receipt

```
CURRENT_CLAUDE_SHA: (see the commit this pass produces on claude/theta-r1-real-state)

TRUSTED_EXECUTION_QUOTE_RESEARCH: COMPLETE (section 3 -- five-tier hierarchy
  with exact per-tier qualification requirements, closing the prior "how do
  you actually assign a tier" gap)
ALPACA_OPRA_RESEARCH: COMPLETE (closed this pass -- direct doc fetch;
  genuinely new finding: Alpaca's own default feed is explicitly non-OPRA,
  derived, 15-minute-delayed; broker trading authority confirmed separate
  from and undocumented alongside market-data entitlement for Paper accounts)
OTHER_EXECUTION_QUOTE_PROVIDERS_RESEARCH: EXISTENCE-CONFIRMED ONLY
  (Polygon.io/Massive, OPRA-licensed, not deep-read)

OPTIONOMICS_HTTP_DOCUMENTATION: NO_CHANGE_REQUIRED (already closed, P2E)
OPTIONOMICS_AUTH_DOCUMENTATION: NO_CHANGE_REQUIRED (already closed, P2E)
OPTIONOMICS_RATE_LIMIT_DOCUMENTATION: NO_CHANGE_REQUIRED (already closed, P2E)
OPTIONOMICS_TIMESTAMP_DOCUMENTATION: NO_CHANGE_REQUIRED (already closed, P2E)

OPTIONOMICS_REAL_QUALIFICATION_SAMPLE_PLAN: COMPLETE (closed this pass --
  small, non-arbitrary schema-qualification sample plan, explicitly separated
  from statistical trading validation)
FLOW_REAL_QUALIFICATION: COMPLETE (units/scale verification procedure;
  buyer/seller, opening/closing, customer/dealer explicitly confirmed
  unrecoverable from aggregate data, not attempted)
GEX_REAL_QUALIFICATION: COMPLETE (closed this pass -- concrete sign-
  disagreement-detection procedure using gex_spot_scan_research.py)
DEX_REAL_QUALIFICATION: COMPLETE procedure-wise; no independent THETA-derived
  DEX comparator exists yet to run it against (named honestly as a gap)
VANNA_REAL_QUALIFICATION: COMPLETE (same procedure structure as GEX)
CHARM_REAL_QUALIFICATION: COMPLETE (same procedure structure as GEX)
EVENT_REAL_QUALIFICATION: COMPLETE (closed this pass -- known_at-vs-
  scheduled_at PIT-safe mapping, directly compatible with the existing
  event_state_research.py design)

EXECUTION_QUOTE_QUALIFICATION_STANDARD: COMPLETE (closed this pass -- six
  independent pass/fail checks)
QUOTE_DISQUALIFIERS: COMPLETE (seven named disqualifiers, including the
  Alpaca-indicative-feed-specific finding from this pass)
CROSS_PROVIDER_QUOTE_COMPARISON: COMPLETE (five named non-defect variance
  sources, no trading rule proposed)

FIRST_PAPER_ORDER_READINESS_STANDARD: COMPLETE (closed this pass --
  FIRST_PAPER_ORDER_READY vs. POLICY_EMPIRICALLY_VALIDATED kept structurally
  distinct, matching the directive's own explicit instruction)
FIRST_PAPER_OPERATIONAL_PLAN: COMPLETE (conservative recommendations, none
  framed as a permanent restriction)

R7_ENGINEERING_COMPLETION_STANDARD: COMPLETE (already true per the P2E audit)
R7_PROVIDER_COMPLETION_STANDARD: COMPLETE (design closed this pass; NOT yet
  satisfied in practice -- execution quote NOT_QUALIFIED, Optionomics
  NOT_ATTEMPTED, both correctly pending real evidence)
R8_START_STANDARD: COMPLETE (closed this pass -- requires both engineering
  and provider completion plus an explicit, separate owner go/no-go)
R8_COMPLETION_STANDARD: COMPLETE (closed this pass -- explicitly more than
  one Paper order; ties to the existing effective-N/dependence-clustering
  discipline, no threshold fabricated)
R8_EVIDENCE_LADDER: COMPLETE (closed this pass -- twelve named milestones)

OPERATOR_STALE_STATE_PATTERN: COMPLETE (closed this pass -- monotonic
  state-version recommendation, reuses existing infrastructure, no new table)
EMERGENCY_LOCK_CLEAR_PATTERN: COMPLETE (closed this pass -- six required
  elements; clearing the lock structurally cannot itself authorize execution)
PATH_CHECKPOINT_STORAGE_RECOMMENDATION: COMPLETE (closed this pass -- hybrid
  tick-table-plus-checkpoint model, peak/trough reconstruction explicitly protected)
STRATEGY_VERSIONING_RECOMMENDATION: COMPLETE (closed this pass -- five
  practices, four already satisfied, one -- rollback-as-new-version -- newly
  named)
ALERTING_RECOMMENDATION: COMPLETE (closed this pass -- dedup-by-key semantics,
  STRATEGY_VERSION_MISMATCH added at CRITICAL tier)

FIRST_PAPER_OBSERVABILITY_REQUIREMENTS: COMPLETE (closed this pass -- every
  named field mapped onto an already-existing P1-P2E evidence home)
WHOLE_CHAIN_RESEARCH_GAPS: NONE FOUND (reviewed, no genuine new gap; existing
  P2C/P2D/P2E accounting already covers every named dimension)

REPOS_DEEP_STUDIED: none new this pass (Alpaca's own documentation was the
  deep-read target instead, more directly answering this pass's live question)
NEW_HYPOTHESES: 0 registered (no resolved-label-dependent claim made this pass)

RECOMMENDATIONS_FOR_CODEX: (1) verify which Alpaca options feed (`indicative`
  vs `opra`) THETA's current broker integration is actually subscribed to --
  this pass found Alpaca's own default is explicitly non-OPRA and 15-minute-
  delayed, a fact this research could not resolve without reading THETA's own
  live subscription configuration; (2) the monotonic-state-version stale-state
  pattern (section 16) and the emergency-lock-clear design (section 17) are
  both ready to implement against the existing P2E operator-control schema
  with no new tables required; (3) the hybrid path-checkpoint storage model
  (section 18) is offered as a design answer to the P2E audit's own
  non-blocking write-volume finding.

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
