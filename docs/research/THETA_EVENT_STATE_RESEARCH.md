# THETA Event-State Research (EVENT_STATE_CHANGE)

Closes the gap explicitly named `GAPS` in
`THETA_FLOW_GEX_VOLATILITY_DECISION_RESEARCH.md`'s receipt
(`EVENT_STATE_RESEARCH`). New module:
`bots/theta/quant/research/event_state_research.py` (16 tests, all passing).

## 1. The seven-state model

`classify_event_state()` maps `(EventRecord, decision_timestamp,
expiration_timestamp, imminent_window_seconds, normalization_window_seconds)`
onto exactly one of:

- `NO_KNOWN_EVENT` -- reached ONLY when a caller has explicitly set
  `confirmed_no_event=True`. This is a deliberate design choice: a missing
  event timestamp with no confirmation is `EVENT_DATA_UNKNOWN`, never
  silently treated as "no event." "We checked and there is nothing" and
  "we have not checked" are structurally distinct outcomes.
- `EVENT_APPROACHING` -- known event, distance exceeds the imminence
  window, does not fall inside the current contract's life.
- `EVENT_INSIDE_CONTRACT_LIFE` -- event falls strictly between decision
  time and expiration (`decision < event < expiration`), computed from
  real timestamp comparison, never inferred from IV/skew behavior per the
  directive's explicit instruction.
- `EVENT_IMMINENT` -- inside a caller-supplied `imminent_window_seconds`.
  This module hardcodes no "earnings is imminent inside N days" figure
  anywhere; the window is a required parameter.
- `EVENT_OCCURRED` -- event timestamp at or before decision time, beyond
  the normalization window.
- `POST_EVENT_NORMALIZATION` -- event at or before decision time, within a
  caller-supplied `normalization_window_seconds`.
- `EVENT_DATA_UNKNOWN` -- any of: missing decision/expiration timestamp,
  stale event source (beyond a caller-supplied `max_freshness_seconds`),
  missing event timestamp without confirmation, or an unparseable
  timestamp. Each carries a distinct `EventUnknownReason` -- never
  collapsed into one generic "unknown."

## 2. Event temporal features (directive section 3)

`derive_event_temporal_features()` produces `DAYS_TO_EVENT`,
`TRADING_DAYS_TO_EVENT` (an approximate, non-session-calendar-aware research
feature, explicitly labeled as such), `EXPIRY_CROSSES_EVENT` (propagated
directly from the state result), `POST_EVENT_AGE_DAYS`,
`IV_CHANGE_INTO_EVENT`/`TERM_CHANGE_INTO_EVENT`/`SKEW_CHANGE_INTO_EVENT`/
`FLOW_CHANGE_INTO_EVENT` (each a plain `current - reference` delta on
caller-supplied, already-PIT-safe observations -- this function performs
no lookups of its own), and `IV_CRUSH_AFTER_EVENT` (only computed once the
event has genuinely occurred, per a real test:
`test_iv_crush_not_computed_before_event_occurs`).

Every function here remains a RESEARCH FEATURE. No event state directly
authorizes an option trade, per the directive's explicit instruction --
these feed context, not execution.

## 3. Event -> strategy hypotheses (directive section 4)

Testable, non-asserted hypotheses -- none of these are registered as new
`hypotheses.json` entries this pass since they require real event-crossing
episode data to test, which does not yet exist (`RESOLVED_WHOLE_CHAIN_LABELS_INSUFFICIENT`);
they are recorded here as candidates for later registration:

- **CSP before event**: rich premium is plausible (elevated pre-event IV),
  but gap/tail risk on the event outcome may dominate the extra premium --
  untested, requires resolved episodes crossing a real earnings date.
- **CSP crossing earnings**: same mechanism, amplified -- `EXPIRY_CROSSES_EVENT`
  is the exact feature this module now produces to identify these episodes
  for later labeling.
- **Defined Risk crossing earnings**: the capped tail may retain some of
  the event-premium richness while bounding the gap risk that a naked CSP
  cannot bound -- a genuinely different risk/reward shape worth comparing
  head-to-head once labels exist.
- **Short-DTE before event**: `EVENT_IMMINENT` combined with a short-DTE
  contract concentrates both theta decay and event-gap risk into a narrow
  window -- direction of the net effect on economics is unknown, not
  assumed.
- **Covered call crossing event**: an event inside a held CC's life may
  affect assignment likelihood asymmetrically (upside gap vs. downside
  gap) -- untested.
- **WAIT before event**: `EVENT_WAIT` (already a named category in
  `wait_diagnostics_research.py`'s ten-way classification) is the natural
  WAIT-taxonomy slot this hypothesis maps onto -- no new WAIT machinery
  needed, this is the connective tissue between the two modules.
- **Post-event volatility normalization**: `POST_EVENT_NORMALIZATION`'s
  own window is exactly the period `IV_CRUSH_AFTER_EVENT` measures --
  whether premium-selling economics genuinely improve, worsen, or are
  unaffected once normalized is an open empirical question, not assumed
  in either direction.

No hypothesis here assumes a direction is profitable, per the directive's
explicit instruction.

## 4. Real external evidence for event-driven strategy design

Two real, license-clear, source-verified repos surfaced this pass
(existence + structure verified via `gh api`, key files read):

**REPO**: `anthonymakarewicz/volatility-trading`. **LICENSE**: MIT.
**STARS**: 42. **PUSHED**: 2026-04-01 (mature, actively maintained).
**FILES_READ**: `config/backtesting/vrp_harvesting.yml`,
`config/backtesting/skew_mispricing.yml` (full), directory tree (confirms
real `src/`, `tests/`, `docs/reference/backtesting/` -- not README-only).

A real, config-driven systematic options-research framework with two
directly relevant, already-implemented strategies: `vrp_harvesting`
(short-only, `target_dte: 30`, `max_dte_diff: 7`, `rebalance_period: 5`,
`risk_budget_pct`/`margin_budget_pct` sizing caps, RegT margin modeling,
`bid_ask_fee` execution with per-leg commission) and `skew_mispricing`
(`delta_target_abs: 0.25`, `delta_tolerance: 0.10`, `max_holding_period: 30`,
a separate hedge and benchmark series). **THETA_ALREADY_HAS**: delta-
targeted contract selection (P2B), VRP research (`iv_realized_vol_research.py`).
**THETA_LACKS**: an explicit `delta_tolerance`-banded selection concept
(THETA currently reasons about delta frontiers, not a target +/- tolerance
band) and a `max_holding_period` cap as a distinct research parameter from
DTE-at-entry -- both are candidate features worth registering as
hypotheses once management-label data exists, not implemented here.
**DATA INPUT**: ORATS/yfinance/FRED, not Optionomics -- methodology
reference only. **ADOPT**: no code. **TEST_ONLY**: none. **REFERENCE_ONLY**:
the parameter/config shape (target_dte/delta_tolerance/rebalance_period/
risk_budget_pct as a coherent, testable parameter set for a future VRP or
skew-based experiment definition in THETA's own `experiment_registry.py`).
**LOOKAHEAD_RISK/FILL_BIAS/SURVIVORSHIP_RISK**: not assessed this pass
(would require reading the actual backtest engine code, not just configs)
-- named honestly as not yet evaluated rather than assumed clean.

**REPO**: `marwinsteiner/pysvi`. **LICENSE**: MIT. **STARS**: 3.
**PUSHED**: 2026-09-14 (one day before this research pass -- very fresh).
**FILES_READ**: `src/pysvi/diagnostics.py` (full, ~100 lines read).

A real SVI/SSVI/eSSVI/SABR calibration library with genuinely stronger
arbitrage diagnostics than THETA's own current `volatility_surface_research.py`:
where THETA's `check_butterfly_arbitrage_sufficient` checks only Gatheral's
SUFFICIENT condition (`b*sigma*(1+|rho|) <= 4`), pysvi's
`check_slice_arbitrage` computes the actual risk-neutral density `g(k)`
across a grid and requires it non-negative EVERYWHERE -- a necessary-and-
sufficient butterfly test, not merely a sufficient one. It additionally
checks Lee's (2004) wing-slope bound (`limsup w(k)/|k| <= 2`), which THETA
does not check at all. **THETA_LACKS**: the full risk-neutral-density
butterfly test and the Lee wing-bound check. **REFERENCE_ONLY** (numpy
dependency -- THETA's own `volatility_surface_research.py` is deliberately
dependency-free, matching `bs_reference.py`'s convention; adopting pysvi's
CODE would break that convention) -- the METHOD (full density check + Lee
bound) is a legitimate candidate for a future dependency-free
reimplementation in THETA's own module, flagged as a genuine improvement
opportunity, not implemented this pass given time budget.
**LOOKAHEAD_RISK**: N/A (a pure calibration/diagnostics library, no
backtest engine). **FILL_BIAS**: N/A. **SURVIVORSHIP_RISK**: N/A.
**LICENSE_RISK**: none (MIT).

One repo found and explicitly REJECTED: `AKhromin/Counterback`
("Execution-realistic and counterfactual backtesting" -- promising name,
directly matching this engagement's counterfactual-caution vocabulary).
**REJECT reason**: file tree confirms it is a Binance crypto order-book
depth recorder (`src/depth_recorder/`), not an options project at all, and
contains no counterfactual/TCA logic despite the repo description --
verified via `gh api` file listing before rejecting, not assumed from the
name alone.
