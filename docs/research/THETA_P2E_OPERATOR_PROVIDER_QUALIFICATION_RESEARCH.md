# THETA P2E: Session/Expiry/Management Intelligence + Optionomics Provider
# Qualification + Operator Safety Research

Research-only pass. `CURRENT_MAIN_SHA_AT_START`: `6bd29d22e64da46eedd1078b75da8dbb0d9f08a8`
(P2D, CLOSED; Codex is implementing P2E in parallel, not audited this pass).
New module this pass: `bots/theta/quant/research/explainability_schema_research.py`
(6 tests).

## 1-2. Master objective and R/P roadmap gap map

```
PHASE  ENGINEERING GAP                         EMPIRICAL GAP                          PROVIDER GAP                          OWNER ACTION NEEDED
P1     none (CLOSED)                            n/a                                    n/a                                    none
P2A    none (CLOSED)                            n/a                                    n/a                                    none
P2B    none (CLOSED)                            n/a                                    n/a                                    none
P2C    none (CLOSED)                            0 resolved labels (expected -- online resolver just deployed) n/a               none
P2D    none (CLOSED)                            0 whole-chain/regret subjects (expected -- requires closed chains / 2+-alternative decisions, not yet observed) n/a  none
P2E    IN PROGRESS (Codex)                      n/a (P2E is an intelligence/operator layer, not a label-accumulation phase) Optionomics remains 100% missing -- unauthenticated  owner: provide a real Optionomics API key when ready (see section 12's qualification plan, no key needed to prepare it)
R6     COMPLETE engineering (dataset v5, promotion checklist, walk-forward, DSR/PBO) BLOCKED_ON_DATA (needs real Paper history) n/a                                    none -- time/data, not work
R7     research modules COMPLETE (this branch: WAIT taxonomy, Flow/GEX/vol-surface, event-state, path-state, decision-freshness, label-quality, TCA/fill-sensitivity, action-vs-inaction) none (research artifacts, not empirical claims) n/a  none
R8 (named in prior sessions as the future empirical-validation program) NOT YET SCOPED as its own phase -- this document treats it as "whatever runs once P2D/P2E-produced labels are sufficient," not a phase with its own engineering backlog yet BLOCKED_ON_DATA (structurally, by design -- TRAINING_READY hardcoded NO until then) n/a  owner: decide when to formally open R8 once P2D label counts are non-trivial
R9     NOT NAMED ANYWHERE in this engagement's documents -- no invented content here per the directive's own "do not invent missing phases" instruction; flagged as an open naming question for the owner/Codex, not filled in
```

No phase is invented past what P1-P2D/R6-R7 already establish. R8/R9 are
named in the directive's own header but this document does not assign them
new scope beyond what's already implied by the standing empirical-blocker
language (`RESOLVED_*_LABELS_INSUFFICIENT`) -- that is an owner/Codex
scoping decision, not a research one.

## 3. Session / market microstructure -- deep research

**PROBLEM**: how does listed US options behavior (spread, liquidity, IV,
Gamma, Theta, dealer exposure, execution quality, assignment/expiration
mechanics) vary across open/mid-session/late-session/close/expiry-session/
early-close?

This engagement has NOT previously done a dedicated literature pass on
session microstructure specifically (prior sessions covered VRP, GEX
conventions, flow classification, and vol-surface methodology in depth,
but not intraday session shape). Rather than fabricate unsourced claims,
this section is honest about what is and is not established:

- **Structurally well-known, not requiring a citation to state as fact**
  (exchange-mechanics-level, not a THETA-specific research claim): US
  equity options spreads are typically widest at the open (post-overnight
  gap price discovery), tighten through the regular session as market-
  maker inventory and two-sided flow normalize, and often widen again into
  the close as market-makers reduce overnight risk -- this is standard
  market-microstructure behavior for any listed derivative, not an
  options-specific finding requiring new evidence.
- **0DTE/expiry-session-specific, genuinely different from a normal
  session**: same-day-expiring contracts see Gamma concentrate sharply
  near the money as time-to-expiry approaches zero (`gamma_regime_research.py`'s
  existing 0DTE-instability flag already encodes this), and dealer hedging
  flow in aggregate is understood in the practitioner literature (e.g. the
  SqueezeMetrics/`sgdividends`-style GEX writeups already cited in this
  engagement's GEX research) to become a larger share of underlying
  volume on 0DTE-heavy names into the close on expiry days specifically --
  this is a THEORY with public discussion behind it (SpotGamma, Cboe's own
  0DTE commentary pieces), not a peer-reviewed, audited finding; this
  document does not claim it as proven, only as a testable hypothesis
  once real path-checkpoint data accumulates via this branch's own
  `position_path_state_research.py` (session-state field, section 12 of
  the prior action/inaction document).
- **Early-close sessions** (the day before Independence Day, the Friday
  after Thanksgiving, Christmas Eve): the regular session compresses into
  half a day; liquidity and open interest roll-off dynamics for that day's
  expiring contracts are a genuine but UNSTUDIED-by-this-engagement edge
  case, named honestly as a gap rather than asserted.

**No universal clock rule proposed** -- per the directive's own explicit
instruction, session-state CLASSIFICATION must come from broker/exchange
truth (already stated in `THETA_ACTION_INACTION_TIME_PATH_RESEARCH.md`
section 12), and this section adds only the BEHAVIORAL HYPOTHESES a
classified session state should eventually be tested against, not a
lookup table of times.

## 4. Expiration mechanics

| DTE bucket | Gamma | Theta | Extrinsic value | Exercise/assignment | Pin risk | Notes |
|---|---|---|---|---|---|---|
| 0DTE | Peaks sharply near the money; can be an order of magnitude larger than a 30-45DTE contract at the same moneyness | Nearly all extrinsic value decays within the single session | Near zero by session end | American-style exercise decision effectively same-day | Highest -- price often gravitates toward high-OI strikes into the close (documented market phenomenon, "pinning," widely discussed though not universally proven causal) | `gamma_regime_research.py`'s existing 0DTE flag |
| 1DTE | Still elevated Gamma, one session of decay ahead | High Theta/day, but spread over a full session | Small but nonzero | Same mechanics, one day of runway | Elevated | |
| 2-5DTE | Meaningfully lower Gamma peak than 0-1DTE | High but per-day Theta share declining | Moderate | Standard | Present but lower | Directive's own named bucket |
| 7DTE | Lower still | Moderate | Larger | Standard | Lower | |
| 14DTE | Lower | Moderate-low | Larger | Standard | Low | |
| 21DTE | Low | THETA's own existing challenger vocabulary includes `21DTE`/`14DTE`/`7DTE` as named management-policy challengers (P2C's `evaluatePolicyChallenger`) -- this table's bucket boundaries deliberately match those existing challenger names | | | |
| 30-45DTE | Lowest of the actively-managed range | Lower per-day Theta but larger absolute extrinsic value | Largest | Standard, most runway | Lowest | The conventional CSP "sweet spot" DTE range cited across the options-selling literature broadly (e.g. `anthonymakarewicz/volatility-trading`'s own `target_dte: 30` default, prior session finding) |
| Longer DTE | Very low near-term Gamma | Low Theta/day | Very large | Standard | Minimal | Capital-inefficient for premium-selling given slow Theta decay per day; a LEAPS-style holding period, out of THETA's stated Wheel scope |

**Exchange vs. broker vs. strategy-research, kept separate** (directive's
explicit instruction): exchange mechanics (American-style exercise
windows, OCC assignment lottery/pro-rata mechanics) are FACTS, not
research claims -- this table cites them as background, not as something
this engagement has independently verified against a primary OCC source
this pass (flagged honestly: no OCC rulebook citation was pulled this
pass; a future pass should cite the actual OCC Rule 805/806-family
assignment procedure text directly rather than restating secondhand
market commentary).

## 5. Assignment / exercise / call-away reference

- **Short put assignment**: American-style; can occur any day the put is
  ITM, not only at expiration, though early assignment away from
  expiration/ex-dividend is statistically rare for short-dated OTM-at-
  entry puts per standard options-education material (not independently
  verified against a primary source this pass).
- **Early assignment risk**: concentrated around ex-dividend dates for
  ITM calls (the classic "dividend capture" assignment-risk scenario) --
  this is THETA's `EX_DIVIDEND` event kind, already a named `EventKind`
  in `event_state_research.py` (this branch, prior pass), confirming the
  research schema already anticipated this exact mechanism.
- **Covered-call assignment / call-away**: the short call is exercised
  against the held shares; THETA's existing lifecycle
  (`ALLOW_CALL_AWAY`/`CALLED_AWAY`, per `CLAUDE.md`'s own canonical
  lifecycle diagram) already names this transition.
- **Expiration ITM/OTM handling**: OCC's standard automatic-exercise
  threshold (commonly cited publicly as $0.01 ITM, subject to each
  broker's own exercise-cutoff policy and an account holder's ability to
  submit exercise/do-not-exercise instructions) is a BROKER-SPECIFIC
  overlay on top of OCC's own default -- this document does not assert
  Alpaca's specific policy without a primary-source citation, named as a
  verification item for whoever owns the Alpaca provider-adapter
  integration (Codex), not asserted here.
- **Broker reconciliation**: THETA's own `applyConfirmedTerminalLifecycle`
  (P1, already verified) is explicitly the mechanism that converts a
  BROKER-CONFIRMED assignment fact into a lifecycle transition -- this
  document reaffirms (restated from the P2C audit) that a policy's
  TOLERANCE for assignment (a decision) must never be conflated with the
  broker's own REPORT of one (a fact).

## 6-7. Winner/loss path research and HOLD vs. CLOSE -- deepened only where new

Already substantially closed this branch (`position_path_state_research.py`,
`profit_preservation_research.py`, `THETA_ACTION_INACTION_TIME_PATH_RESEARCH.md`).
Per the directive's own "deepen only what remains useful" instruction, no
new module is built this pass. One genuine addition: a literature check on
whether professional options-management sources support the SPECIFIC
feature list named (profit giveback, Delta deterioration, IV expansion,
time-to-expiry interaction, Gamma acceleration, event crossing, capital
opportunity cost) as opposed to being THETA-invented. Finding: every one of
these appears in some form across the sources already cited in this
engagement (`anthonymakarewicz/volatility-trading`'s skew-mispricing/VRP-
harvesting strategy definitions use DTE/Delta-tolerance bands;
`charlieyanhx/exitkit`'s six exit-model families -- stop-loss, take-profit,
time-based, volatility, signal-reversal, convergence -- map directly onto
giveback/time/IV-expansion/reversal respectively) -- this is CONVERGENT
evidence that the feature LIST is well-grounded in general practitioner
practice, though none of these sources constitute peer-reviewed proof that
any SPECIFIC formula (e.g. this branch's own giveback-velocity threshold
design) is optimal. No new hold-vs-close formulation is proposed; the
existing multi-dimensional target design
(`THETA_P2D_EMPIRICAL_POLICY_LEARNING_DESIGN.md` sections 6-7) stands.

## 8. Rolling -- when it changes economics vs. hides loss

A roll GENUINELY changes future economics when: (a) the new strike/DTE
combination has a materially different expected-value profile than simply
holding the old contract to its own resolution (not merely "the position
continues to exist"), (b) the roll captures additional credit that exceeds
its own transaction cost (`compute_roll_execution_cost`, P2C-pass-2), and
(c) the roll is not merely deferring an assignment decision the underlying
economics no longer support. A roll MERELY HIDES loss when it is
economically equivalent to closing at a loss and re-entering a fresh
position with a cosmetically "still open" chain -- which is precisely why
ROLL-001 (old leg's realized P&L immutable, summed not overwritten,
independently re-verified in the P2D audit's roll-loss-erasure finding)
exists as a hard architectural invariant rather than a research
recommendation. No "always roll at X DTE" is proposed anywhere in this
document, per the directive's explicit instruction.

## 9. Strategy timing -- hypotheses, not rules

| Strategy | DTE sensitivity | IV/VRP | Skew/term | Flow/GEX | Event | Trend | Liquidity | Capital |
|---|---|---|---|---|---|---|---|---|
| CONVENTIONAL (CSP) | Favors 30-45DTE per the sweet-spot convention (section 4) -- untested by THETA | Favors elevated VRP (richer premium) | Favors rich downside skew (already H-Q-05/H-Q-06) | GEX regime as context only, never a signal (standing discipline) | Avoids EVENT_IMMINENT crossing unless compensated (section 4 of the event-state research) | Weakly favors range-bound/mean-reverting regimes (untested) | Requires adequate OI/volume at the target strike | Secured-capital-heavy |
| HOLD_STRIKE | Same-strike continuation across roll cycles -- DTE resets each roll | Same | Same | Roll-timing may interact with Flow reversal (untested) | Same crossing caution | Same | Same | Same, plus cumulative roll capital-days (section 8 of the P2D design doc) |
| DEFINED_RISK | May tolerate closer event proximity than CSP given the capped tail (a genuine, testable difference from CONVENTIONAL, per this engagement's own P2C-pass-1 event-strategy hypotheses) | Favors steep skew specifically (H-Q-06) | Same | Same | Less avoidance needed than CSP -- untested but structurally plausible given the capped tail | Same | Needs liquidity on BOTH legs, a stricter requirement than CSP's single leg | Lower capital per trade (width-based) |
| RECOVERY | DTE largely irrelevant (post-assignment stock-holding decision, not an option-DTE decision) | N/A directly, though CC-selling-on-recovery reintroduces DTE relevance | N/A | N/A | Event proximity relevant for the STOCK's own catalysts (earnings on held shares), a different event-relevance channel than the option's own crossing | Strongly relevant -- a recovering position benefits from constructive trend, untested formally | N/A | Capital already committed (sunk from THETA's perspective; the decision is forward-looking only, per the standing "past entry does not control the next decision" principle) |
| CC | DTE choice trades off premium vs. call-away probability | Favors elevated IV on the covered name | Relevant to strike selection above spot | Same | Earnings before the CC's own expiry raises call-away-timing uncertainty | Unfavorable in a strongly bullish trend (caps upside) -- the classic, well-known CC trade-off, not a new finding | Standard | Capital already committed (shares held) |

All hypotheses stated, none registered as new `hypotheses.json` entries
this pass (would require real resolved-label data to test against, per
the standing `RESOLVED_*_LABELS_INSUFFICIENT` blocker) -- flagged as
future-registration candidates.

## 10. WAIT/HOLD paralysis -- reviewed, no new metric added

Per the directive's own "do not create more metrics simply for volume"
instruction: reviewed the full anti-paralysis framework
(`wait_diagnostics_research.py`'s ten-way `WaitKind` classification,
`THETA_ACTION_INACTION_TIME_PATH_RESEARCH.md`'s 18 anti-paralysis/anti-
overtrading metrics) against this directive's own list -- every named
metric already has a definition. The REQUIRED_UNKNOWN vs. OPTIONAL_UNKNOWN
separation (section 23 of the prior document) already exists and already
states explicitly that it applies ONLY to the research/policy comparison
layer, never to hard execution/risk gates -- re-confirmed here, not
re-derived. No new metric added.

## 11. Optionomics public capability dossier -- CLOSED this pass, major refresh

Sourced via direct fetch of `optionomics.ai/docs/api` and
`optionomics.ai/features/api` this pass (not from memory of a prior
session's fetch, which was materially less detailed). Genuinely new
findings versus this engagement's prior capability census:

| Family | Endpoint(s) | Classification | Key documented detail |
|---|---|---|---|
| Options chain | `Get options chain` | **DOCUMENTED** | Full chain with per-contract Greeks (as STRINGS, not numbers -- a real parsing gotcha for a future adapter), annualized IV, "dollar gamma, delta and gamma exposure, notional OI" per contract, `iv_per_trading_day` (IV / sqrt(252)) |
| GEX / gamma flip / walls | `Get metrics` | **DOCUMENTED existence, UNVERIFIED methodology** | "GEX; gamma flip strike; call/put walls; DDE" named as fields within a 70+-field metrics payload -- sign convention, OI-vs-volume weighting, and dealer-assumption methodology are NOT specified in the docs fetch and remain unverified until a real payload is inspected |
| DEX | `Get metrics` (as "DDE" -- likely "dealer delta exposure," naming not fully self-explanatory from the docs alone) | **PARTIALLY_DOCUMENTED** | Field exists by name; no formula/sign-convention documentation found |
| Vanna / Charm | `Get heatmap` | **DOCUMENTED existence, UNVERIFIED methodology** | "Gamma, vanna, charm exposure; sparse cells (strike-major)" -- a genuinely new finding versus prior sessions, which had NOT previously confirmed Vanna/Charm as documented Optionomics fields at all |
| Surface (skew/term) | `Get metrics` | **PARTIALLY_DOCUMENTED** | "IV surface (rank, percentile, term structure, skew, wings)" listed as derived-analytics field NAMES within the metrics payload -- these read as SUMMARY statistics (e.g. a skew rank/percentile), not necessarily a full raw per-strike surface grid; raw grid availability is UNVERIFIED |
| Flow / UOA | 6 flow endpoints (`all flow rankings`, `top bullish/bearish flow`, `top call/put premium`, `net flow for symbol`, `flow levels`, `dark pool levels`) | **DOCUMENTED** | Confirmed AGGREGATE, not print-level -- "net flow for symbol" is explicitly a bucketed TIME SERIES (epoch ms, dollars), not individual trade prints; this independently confirms this engagement's own standing scope decision (`optionomics_flow_temporal_research.py` deliberately targets the aggregate series, not per-print classification, because per-print data was never documented -- now doubly confirmed) |
| Events | `List events` | **DOCUMENTED, genuinely well-designed for PIT safety** | Kinds: macro, fed, treasury (reserved), commodity (reserved), company_catalyst, filing (off by default). Carries a `known_at` field the docs describe explicitly as designed to prevent "trading on announcements before they were announced" -- directly compatible with `event_state_research.py`'s own `EventRecord.freshness_seconds`/`max_freshness_seconds` PIT-safety design. **Gap**: earnings and ex-dividend are NOT explicitly named among the listed `kinds` -- `company_catalyst` may or may not cover earnings; UNVERIFIED, not guessed |
| Webhooks | advertised on `/features/api` ("webhook delivery system," six notification channels including webhooks); **explicitly absent from `/docs/api`'s own endpoint reference** | **UNVERIFIED (advertised, undocumented)** | This is the SAME finding a prior session made (feature described, no payload schema documented) -- re-confirmed, not resolved, by this pass's fresher fetch |
| Rate limits | account-level | **DOCUMENTED** | 1,000 requests/minute; `X-RateLimit-*` headers; 429 with `Retry-After` |
| Authentication | account-level | **DOCUMENTED** | `X-USER-EMAIL`+`X-USER-TOKEN` headers OR `Authorization: Bearer` |
| Timestamp semantics | account-level | **DOCUMENTED** | "ISO 8601 in UTC unless marked otherwise"; market-schedule semantics follow US Eastern |
| Data freshness | account-level | **DOCUMENTED, and explicitly NOT execution-grade** | "Flow rankings minutes behind the tape," "chains and metrics per session," and -- most importantly -- the docs' own words: "Built for research, screening and analytics, not real-time quote or execution" and "No endpoint here streams." This is Optionomics' OWN explicit self-classification, not THETA's inference. |

`OPTIONOMICS_DOCUMENTED_CAPABILITIES`: options chain w/ Greeks+exposures,
GEX/gamma-flip/walls/DDE (existence only), Vanna/Charm heatmap (existence
only), 6 flow endpoints (aggregate, dollar-denominated), events w/
PIT-safe `known_at`, price history, quote+regime, rate limits, auth,
timestamps.
`OPTIONOMICS_UNVERIFIED_CAPABILITIES`: every sign convention/formula/OI-
vs-volume weighting for GEX/DEX/Vanna/Charm; webhook payload schema; raw
per-strike surface grid availability (vs. summary skew/term stats only);
whether `company_catalyst` covers earnings; DDE's exact definition.

## 12. Provider qualification plan -- designed, no key required

For EVERY feature family above, the validation sequence to run the moment
a real key exists:

```
1. MINIMUM PAYLOAD SAMPLES: >=3 consecutive real payloads per endpoint,
   spaced across at least one full session, to observe both a stable
   period and at least one refresh boundary.
2. IDENTITY CHECKS: every contract-level row must resolve to an exact OCC
   identity (underlying+expiration+strike+right) -- reject any row that
   cannot be mapped, per this engagement's standing exact-contract-identity
   discipline (never join on underlying+strike alone).
3. TIMESTAMP CHECKS: confirm every documented "ISO 8601 UTC" field parses
   as claimed; confirm `known_at` (events) is genuinely <= the event's own
   publication artifact's timestamp elsewhere (e.g. a news item), not
   silently backfilled after the fact.
4. FRESHNESS CHECKS: measure actual observed lag between two consecutive
   metrics/heatmap payloads to confirm the documented "per session" cadence
   claim empirically, not just cite the docs.
5. MISSINGNESS CHECKS: for every documented field, sample real payloads and
   record the ACTUAL null/missing rate -- this engagement's standing rule
   (UNKNOWN never becomes zero) requires knowing which fields are
   routinely null before any downstream code is written to consume them.
6. UNIT CHECKS: confirm Greeks are genuinely per-contract (not per-100-
   shares or already dollar-scaled) by cross-checking a known ATM
   option's delta against an independently-computed BS delta
   (`bs_reference.py`, this branch, already dependency-free and
   verification-only per its own standing role statement).
7. SIGN-CONVENTION CHECKS: for GEX/DEX/Vanna/Charm specifically, compare
   the SIGN of the reported gamma-flip-adjacent exposure against this
   branch's own independently-computed `gex_spot_scan_research.py` result
   on the SAME underlying/day -- agreement or disagreement is itself the
   finding (matches the dual-provenance PROVIDER_FACT-vs-THETA_DERIVED
   discipline already verified in `options-chain-decision-intelligence.ts`).
8. CROSS-SNAPSHOT CONSISTENCY CHECKS: confirm a contract's OCC identity,
   strike, and expiration are IDENTICAL across two consecutive chain
   payloads for the same underlying (catching any silent re-indexing or
   symbol-reuse bug before it corrupts a temporal-delta computation).
```

Every one of `FLOW_PROVIDER_QUALIFICATION` / `GEX_PROVIDER_QUALIFICATION` /
`DEX_PROVIDER_QUALIFICATION` / `VANNA_PROVIDER_QUALIFICATION` /
`CHARM_PROVIDER_QUALIFICATION` / `SURFACE_PROVIDER_QUALIFICATION` /
`EVENT_PROVIDER_QUALIFICATION` runs this SAME eight-step sequence, scoped
to its own family's specific fields -- one procedure, not seven
near-duplicate ones.

## 13. GEX/DEX/Vanna/Charm -- provider-integration-specific deepening

Beyond this branch's own already-built independent methodology
(`gex_spot_scan_research.py`, `exposure_temporal_convention_research.py`),
the NEW provider-integration-specific questions this pass identifies:
(a) is Optionomics' GEX/DDE aggregated at the PORTFOLIO (whole-chain,
summed across all strikes) or CONTRACT level, or both -- the docs list it
under "Get metrics" (a per-symbol summary endpoint) suggesting portfolio/
underlying-level aggregation, but this is UNVERIFIED without a real
payload; (b) is spot-scaling applied server-side (i.e., does the reported
GEX already reflect a specific spot price, and if so, AT WHAT SPOT --
current, or a stale cached one) -- directly relevant to whether
Optionomics' own value can ever be temporally compared against this
branch's own spot-scan result at a DIFFERENT spot without first
normalizing; (c) temporal comparison validity depends entirely on (b) --
`exposure_temporal_convention_research.py`'s `derive_exposure_temporal_change`
already refuses to diff two observations under different sign conventions,
but has no mechanism (nor should it invent one) to detect a spot-scaling
mismatch specifically -- flagged as a genuine qualification-time check
(step 6/7 above), not a code gap.

## 14. Flow/UOA -- provider data-model pitfalls, specified

Print-level pitfalls (aggressor inference, sweep/block classification,
opening/closing ambiguity, customer/dealer ambiguity, duplicate prints,
timestamp ordering) are ALL MOOT for Optionomics specifically, since
section 11 confirms its flow endpoints are aggregate/bucketed, not
print-level -- this branch's own `LuxAlgo/whale-options` dossier
(P2C-pass-1) remains the reference for what print-level classification
WOULD require if a future provider ever supplies raw prints, but
Optionomics itself needs no such qualification test. What DOES need
qualification for Optionomics' aggregate series specifically: (a) window
aggregation boundary alignment (does "net flow for symbol"'s bucketing
align to clean minute/hour boundaries, or a rolling window -- determines
whether `optionomics_flow_temporal_research.py`'s `maximum_gap_seconds`
parameter needs adjustment), (b) premium normalization (confirmed
dollar-denominated per the docs, consistent with this branch's existing
assumption), (c) whether "puts typically negative" (the docs' own stated
sign convention) is a HARD guarantee or a typical-case description --
worth confirming with real payloads before code depends on the sign
being reliably negative for every put row.

## 15. Surface -- provider vs. THETA integration

Given section 11's finding that Optionomics' surface fields are SUMMARY
statistics (rank/percentile/skew/wings) rather than confirmed to be a raw
per-strike IV grid: this branch's own `volatility_surface_research.py`
(raw-SVI fit from raw strike-level points) REMAINS THE ONLY SOURCE of a
fittable surface unless/until a real payload confirms Optionomics exposes
raw per-strike IVs (likely via the `Get options chain` endpoint's own
per-contract IV field, which IS documented, rather than the `Get metrics`
endpoint). Recommended split once qualified: RAW per-contract IV (from
chain endpoint) stays a PROVIDER_FACT feeding THETA's own raw-SVI fit;
Optionomics' OWN summary skew/rank/percentile stays a SEPARATE
PROVIDER_FACT for cross-checking, never merged into THETA's own derived
surface. The stronger risk-neutral-density/Lee-wing-bound diagnostic
identified in `marwinsteiner/pysvi` (P2C-pass-2 dossier) remains a
FUTURE candidate improvement to THETA's own fit quality gate -- this pass
does not require or recommend implementing it now, per the directive's
own "do not automatically require implementation" instruction.

## 16. Events

Section 11's `known_at` finding is the headline result here: if verified
real, Optionomics' events endpoint would be the FIRST Optionomics field
in this entire engagement confirmed by documentation (not yet by a real
payload) to be PIT-safe by design. The exact metadata `event_state_research.py`
needs (event_timestamp, kind, source, freshness) maps cleanly onto the
documented fields (`scheduled_at`/`date`, `title`/`kind`, the endpoint
itself as source, `known_at` as the freshness-equivalent signal) --
GENUINE compatibility, not forced. **Still unresolved**: whether earnings
specifically are covered (see section 11's gap) and whether ex-dividend
dates appear at all in this endpoint or require a separate corporate-
actions source (Alpaca's own corporate-actions data, already cited as a
possible source in `event_state_research.py`'s own `EventKind.EX_DIVIDEND`
docstring from the prior pass).

## 17. Execution quote boundary

Optionomics' OWN documentation explicitly disqualifies itself from
`TRUSTED_TWO_SIDED_ORDER_PRICING` in its own words: "Built for research,
screening and analytics, not real-time quote or execution" and "No
endpoint here streams." This is the provider's own self-classification,
not THETA's inference -- the strongest possible evidence for the
`INDICATIVE`/`RESEARCH` classification this engagement has maintained
throughout (unchanged from every prior session's finding, now backed by a
direct quote from the current docs rather than an older/thinner fetch).
Optionomics cannot and should not be claimed to replace OPRA-sourced
execution-quote semantics under any circumstance this documentation
supports.

## 18. Provider outage degradation

Principle: EVERY function whose correctness depends on broker
reconciliation, position safety, or mandatory lifecycle management
(fill confirmation, assignment detection, AEGIS risk gates, follower
lock) must have NO Optionomics dependency at all -- confirmed unchanged
by this pass's own grep of the P2D delta (zero Optionomics references
found in any P2C/P2D file). Functions that DO depend on Optionomics
(research-side chain-decision intelligence, GEX/flow/surface context)
must degrade to their already-existing UNKNOWN/PROVIDER_BLOCKED states
(verified throughout P1-P2D) rather than fail the whole cycle -- this is
already the case; this section confirms no new outage-handling code is
needed, only that whatever P2E builds for Optionomics integration must
preserve this same separation.

## 19. Operator UI / control research

Best-practice semantics for the named controls, restated for an options-
trading operator context specifically:

- **PAUSE NEW ENTRIES**: should be scoped (new OPEN actions blocked;
  existing position management -- HOLD/CLOSE/ROLL/assignment handling --
  continues unaffected) since pausing management too would leave open
  positions unmanaged, a strictly worse safety state than pausing entries
  alone.
- **EMERGENCY LOCK**: should be the most restrictive state and should NOT
  be scoped -- it must halt everything including management, on the
  assumption that whatever triggered it (a suspected bug, a data
  corruption event) makes even "safe" management actions untrustworthy
  until a human clears it.
- **RESUME**: must require the SAME or higher privilege than whatever
  paused/locked the system, and should re-verify current broker/provider
  state before resuming (never assume the world is unchanged since the
  pause).
- **RUN RECONCILIATION / RUN DATASET EXPORT / TEST PROVIDER / RUN PROVIDER
  QUALIFICATION**: these are read-mostly or idempotent-by-design
  operations (reconciliation reads broker truth; dataset export is
  already content-addressed and idempotent per P2C/P2D; a provider test
  call should never write). Each should still require confirmation given
  the API cost/rate-limit consumption a real provider-qualification run
  would incur (section 12's 8-step sequence against a real, rate-limited
  API).

## 20. Explainability -- CLOSED this pass

New module: `explainability_schema_research.py` (6 tests). Answers every
directive-named question (WHAT chosen, WHAT ELSE feasible, WHY it won,
WHAT DATA missing, WHAT time state, WHAT position path, WHAT provider
facts, WHAT action/inaction risk) from an `ExplanationEvidence` struct
assembled ENTIRELY from fields this branch's or Codex's existing modules
already produce -- `render_explanation_text()` is a pure, deterministic,
template-based function (real test:
`test_rendering_is_deterministic_for_identical_evidence`), never an LLM
call, matching the directive's explicit instruction that structured reason
codes, not generic prose, are the source of truth. `MissingDataSeverity`
reuses the REQUIRED_UNKNOWN/OPTIONAL_UNKNOWN vocabulary from
`THETA_ACTION_INACTION_TIME_PATH_RESEARCH.md` directly (no new taxonomy
invented) and renders the two severities into visibly separate sections
so an operator can distinguish "this blocked the decision" from "this
merely widened uncertainty."

## 21. Alerting schema

```
INFORMATIONAL: decision stale (re-evaluation triggered, no action needed),
  provider stale (Optionomics-only, degraded gracefully per section 18),
  routine reconciliation completed
WARNING: provider auth failure (Optionomics), excessive WAIT rate trending
  up (ENTRY_PARALYSIS candidate per THETA_ACTION_INACTION_TIME_PATH_RESEARCH.md
  section 21), excessive HOLD rate trending up (HOLD_PARALYSIS candidate,
  same doc section 22), position expiry imminent (a scheduled, expected
  event needing operator awareness, not necessarily action)
CRITICAL: worker offline, broker mismatch (a reconciliation discrepancy
  between THETA's own state and the broker's), assignment detected
  (unexpected lifecycle transition needing operator awareness even though
  it is a modeled, not automatically failed, transition per CLAUDE.md),
  unexpected call-away, execution gate changed (any change to AEGIS/
  quote-freshness/follower-lock gate configuration -- always critical
  regardless of direction, since an unreviewed gate change is itself the
  risk), emergency lock activated
```

Strategy paralysis and excessive WAIT/HOLD are graded WARNING not
CRITICAL deliberately -- they are policy-behavior signals worth a human
look, not safety failures; conflating them with a broker mismatch or an
offline worker would dilute the CRITICAL tier's own urgency.

## 22. Performance philosophy

Unchanged, restated verbatim per the directive's own instruction -- see
the receipt below. No section of this document converts a reference
region into a threshold; every DTE/session/strategy-timing table above is
explicitly hypotheses for later testing, never an executable rule.

## 23-24. Professional strategy research and public index/academic context

No new evidence found this pass beyond what prior sessions already
established (Cboe put/covered-call indices, Carr-Wu VRP research,
`anthonymakarewicz/volatility-trading`'s real VRP-harvesting/skew-
mispricing strategy shapes). Evidence-hierarchy discipline
(AUDITED_BENCHMARK > PEER_REVIEWED > INSTITUTIONAL > REPRODUCIBLE_SYSTEMATIC
> TRANSPARENT_PRACTITIONER > RECONSTRUCTED_METHOD > ANECDOTAL) is applied
throughout this document -- every hypothesis in section 9's table is
explicitly labeled "untested by THETA" rather than elevated by association
with a cited source.

## 25. Repository mining

No new repos deep-read this pass (time budget went to the Optionomics
dossier, explainability module, and document breadth). Every repo named
in sections 3-9 above (`anthonymakarewicz/volatility-trading`,
`charlieyanhx/exitkit`, `marwinsteiner/pysvi`, `LuxAlgo/whale-options`,
`sgdividends/spx-dealer-gamma`) was deep-read in a PRIOR pass of this
engagement, cited here by reference with their prior dossier's own
license/SHA/files-inspected detail, not re-verified this pass -- named
honestly per the directive's own "do not name repositories as studied if
only search-result existence was observed" instruction. `QuantConnect/Lean`,
`pfhedge`, `FinancePy`, `QuantLib` remain existence-only references from
searches, never deep-read across this entire engagement -- flagged
explicitly as NOT_STUDIED rather than silently implied covered.

## 26. Migration/schema review guidance -- research recommendation only

```
MUST_PERSIST (immutable, already the P1-P2D pattern): decision subjects,
  observations, resolution receipts, resolved labels, policy-learning
  records -- unchanged, this document adds nothing new here.

MUST_PERSIST (new, if P2E adds Optionomics-derived research attachments):
  the raw provider payload's own timestamp/freshness/completeness fields
  per this engagement's own standing ChainScopedAttachment discipline
  (PROVIDER_FACT vs THETA_DERIVED, already verified in P2B) -- never
  discard provenance to save space.

SHOULD_DERIVE (never persist as a separate row): velocity/acceleration
  features (position_path_state_research.py's compute_trajectory),
  distance-to-strike, DTE-at-a-checkpoint -- all pure functions of
  already-persisted checkpoint data; persisting them separately would be
  database bloat without any provenance benefit, since they are
  100% reproducible from what's already stored.

PROVIDER_PAYLOAD_RAW_OPTIONAL: the full raw Optionomics JSON response
  body, kept ONLY behind an explicit research/debug flag (not by default)
  -- valuable for post-hoc qualification-check re-runs (section 12) but
  genuinely bloat-risk at full retention given Optionomics' own 70+-field
  metrics payload.

RESEARCH_ONLY_EPHEMERAL (never migrate into Production schema): anything
  this branch's own modules compute for illustration/testing (synthetic
  fixtures, WAIT-diagnostics funnel counters used only for a single
  research report) -- these belong in `bots/theta/quant/research/`'s own
  Python-side artifacts, never a Postgres migration.
```

## 27. Button/control threat model

| Threat | Recommendation for Codex |
|---|---|
| Double-click / duplicate submission | Every control action should be idempotent server-side (matching P1-P2D's own content-addressed-insert discipline) -- a second identical click within a short window should be a no-op, not a second state transition |
| Stale UI (operator viewing an outdated state, acting on it) | Every control mutation should require the operator's client to submit the LAST-KNOWN state version/hash it observed; a mismatch should be refused with a "state changed, refresh and retry" response, never silently applied against stale assumptions |
| Replay request (a captured request resubmitted later) | Time-bound request validity (a short-lived nonce/token) plus the idempotency requirement above jointly close this |
| CSRF | Standard same-site/token-based CSRF protection on every state-mutating operator endpoint -- a generic web-security requirement, not options-specific, but worth naming since this is a financial control surface |
| Role misuse | RESUME/EMERGENCY-LOCK-CLEAR should require an explicit, distinct privilege level from PAUSE/LOCK itself (asymmetric: locking should be easy for any authorized operator to do fast under stress; unlocking should require deliberate, possibly multi-step, confirmation) |
| Accidental resume | A confirmation step (not a bare button) specifically for RESUME after an EMERGENCY LOCK, re-stating WHY the lock was engaged before allowing it to be cleared |
| Emergency-lock race (two operators, conflicting actions near-simultaneously) | Lock state should be a single, atomically-updated source of truth (a DB row with a version/timestamp), with the LOCK action always winning a race against a concurrent RESUME (fail toward the safer state, matching this engagement's standing fail-closed discipline applied to a UI-safety context) |
| Provider-test leaking a secret (a "TEST PROVIDER" control echoing a raw API key/response into logs or the UI) | The provider-test control must NEVER echo the raw key back, and should redact/omit raw payload bodies from any user-facing response or log line -- report PRESENT/VALID/INVALID only, exactly matching this engagement's own standing credential-handling rule (`CLAUDE.md`'s security instructions) applied to a UI control specifically |
| Malicious client setting execution-authority flags | Structurally prevented already at the data layer by P1-P2D's own DB CHECK constraints (`execution_authorized=false`, `promoted=false`) -- no operator control, however compromised, can flip these via a normal write path; this document confirms that invariant remains the right backstop and recommends the operator UI itself never even EXPOSE an execution-authority toggle, so there is no control surface to misuse in the first place |

## Receipt

```
CURRENT_CLAUDE_SHA: (see the commit this pass produces on claude/theta-r1-real-state)

R_P_ROADMAP_GAP_MAP: COMPLETE (section 2 -- no invented phases; R9 explicitly
  named as unscoped rather than filled in)

SESSION_MICROSTRUCTURE_RESEARCH: COMPLETE (section 3 -- exchange-mechanics-level
  facts kept separate from untested THETA-specific hypotheses)
EXPIRY_RESEARCH: COMPLETE (section 4 -- DTE-bucket table, exchange/broker/
  research separation maintained)
ASSIGNMENT_RESEARCH: COMPLETE (section 5 -- no broker-specific claim asserted
  without a primary-source caveat)
ROLL_RESEARCH: COMPLETE (section 8 -- "changes economics" vs. "hides loss"
  criteria specified, no fixed-DTE roll rule)
HOLD_VS_CLOSE_RESEARCH: NO_CHANGE_REQUIRED (section 6-7 -- already substantially
  closed by prior passes; one literature-convergence check added)
STRATEGY_TIMING_RESEARCH: COMPLETE (section 9 -- five-strategy x eight-dimension
  hypothesis table, none registered pending real data)
SHORT_DTE_RESEARCH: NO_CHANGE_REQUIRED (already closed,
  THETA_ACTION_INACTION_TIME_PATH_RESEARCH.md section 16)

OPTIONOMICS_PROVIDER_DOSSIER: COMPLETE (closed this pass -- major refresh via
  direct doc fetch, genuinely new findings on GEX/Vanna/Charm/DEX field
  existence and the events endpoint's known_at PIT-safety design)
OPTIONOMICS_DOCUMENTED_CAPABILITIES: see section 11 table
OPTIONOMICS_UNVERIFIED_CAPABILITIES: see section 11 table (sign conventions,
  formulas, webhook schema, raw-surface-grid availability, earnings coverage)

OPTIONOMICS_QUALIFICATION_PLAN: COMPLETE (section 12 -- one 8-step procedure
  applied per feature family, no key required to have designed it)

FLOW_PROVIDER_QUALIFICATION: COMPLETE (section 14 -- print-level pitfalls
  confirmed moot given documented aggregate-only shape; three real
  aggregate-specific checks specified)
GEX_PROVIDER_QUALIFICATION: COMPLETE (section 13)
DEX_PROVIDER_QUALIFICATION: COMPLETE (section 13 -- DDE naming ambiguity
  flagged explicitly)
VANNA_PROVIDER_QUALIFICATION: COMPLETE (section 13)
CHARM_PROVIDER_QUALIFICATION: COMPLETE (section 13)
SURFACE_PROVIDER_QUALIFICATION: COMPLETE (section 15 -- raw-chain-IV vs.
  summary-stats distinction specified)
EVENT_PROVIDER_QUALIFICATION: COMPLETE (section 16 -- known_at compatibility
  confirmed structurally; earnings/ex-dividend coverage flagged UNVERIFIED)

EXECUTION_QUOTE_PROVIDER_REQUIREMENTS: COMPLETE (section 17 -- Optionomics'
  own documentation self-disqualifies it from TRUSTED_TWO_SIDED_ORDER_PRICING,
  quoted directly, strongest evidence found to date)
PROVIDER_OUTAGE_DEGRADATION_PLAN: COMPLETE (section 18 -- confirmed zero
  Optionomics coupling exists anywhere in the P1-P2D safety-critical path)

OPERATOR_CONTROL_RESEARCH: COMPLETE (section 19)
OPERATOR_CONTROL_THREAT_MODEL: COMPLETE (section 27 -- nine named threats,
  each with a concrete recommendation)
EXPLAINABILITY_SCHEMA: COMPLETE (closed this pass -- explainability_schema_research.py,
  6 tests, deterministic template rendering, never an LLM call)
ALERTING_SCHEMA: COMPLETE (section 21 -- three severity tiers, paralysis
  signals deliberately kept below CRITICAL)

MUST_PERSIST_FIELDS: see section 26
DERIVABLE_FIELDS: see section 26 (velocity/acceleration/distance-to-strike/
  DTE-at-checkpoint -- all reproducible, never persisted separately)

REPOS_DEEP_STUDIED: none new this pass (five repos cited by reference to
  their own prior-pass dossiers; QuantConnect/Lean, pfhedge, FinancePy,
  QuantLib remain NOT_STUDIED, named honestly)
ACADEMIC_OR_INDEX_EVIDENCE: unchanged from prior sessions (Cboe indices,
  Carr-Wu VRP research)
NEW_HYPOTHESES: 0 registered in hypotheses.json this pass (section 9's
  strategy-timing table and section 3's session-microstructure claims are
  stated as testable, not yet registered pending real path-checkpoint/
  resolved-label data)

RECOMMENDATIONS_FOR_CODEX: (1) the nine threat-model items in section 27,
  most concretely the idempotency/stale-state-version and the provider-
  test-secret-redaction requirements, worth applying directly whenever
  P2E's operator controls are implemented; (2) section 12's qualification
  plan is ready to execute the moment a real Optionomics key is available
  -- no further research design needed first.

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
