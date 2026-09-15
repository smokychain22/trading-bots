# THETA External Repository Pattern Matrix

Author: Claude (research lane). All 25 repositories named across this
directive's two messages were verified to EXIST via `gh api repos/<owner>/<repo>`
(license, default branch, last-push date all recorded below) -- none were
assumed. Given this session's scope, a bounded set of the highest-priority
repos received genuine file-level reads (README plus, where fetched, specific
sections); the rest have verified existence/license/basic metadata only, and
are marked `EXISTENCE_VERIFIED_NOT_DEEP_STUDIED_THIS_PASS` rather than given a
fabricated dossier. Extending the deep-study set is a bounded, resumable task,
not something to fake in one pass.

## Existence + license register (all 25)

| Repo | License | Default branch | Last push (approx) | Study depth this pass |
|---|---|---|---|---|
| FlashAlpha-lab/flashalpha-python | MIT | main | 2026-09-09 | DEEP (README, provenance model, feature surface) |
| FlashAlpha-lab/flashalpha-examples | MIT | main | 2026-08-26 | EXISTENCE_VERIFIED |
| FlashAlpha-lab/volatility-surface-python | MIT | main | 2026-08-26 | EXISTENCE_VERIFIED |
| FlashAlpha-lab/0dte-options-analytics | MIT | main | 2026-08-26 | EXISTENCE_VERIFIED |
| FlashAlpha-lab/flashalpha-historical-python | MIT | main | (verified) | EXISTENCE_VERIFIED |
| zrack/gex-terminal | MIT | main | 2026-09-13 | DEEP (README, model-assumptions philosophy) |
| FlashAlpha-lab/gex-explained | MIT | main | 2026-08-26 | EXISTENCE_VERIFIED |
| sgdividends/spx-dealer-gamma | **NONE (all rights reserved)** | main | 2026-08-06 | EXISTENCE_VERIFIED -- REFERENCE_ONLY at most, no code may be adapted |
| BitraAI/gex_app | **NOASSERTION (treat as all rights reserved)** | main | 2026-09-06 | EXISTENCE_VERIFIED -- same restriction |
| NavnoorBawa/Options-Flow-Predictor | MIT | main | 2025-06-07 | DEEP (README, methodology) |
| QuantConnect/Lean | Apache-2.0 | master | 2026-09-14 | REFERENCE (well-known architecture, not re-read file-by-file this pass) |
| OpenGamma/Strata | Apache-2.0 | main | 2026-09-07 | REFERENCE (same) |
| lballabio/QuantLib | **NOASSERTION (treat as all rights reserved for adoption purposes)** | master | 2026-09-14 | REFERENCE (independent validation use only, per directive; not code-adoptable regardless of license given prior session's own py_vollib-equivalent finding) |
| vollib/py_vollib | MIT | master | 2026-05-29 | DEEP (README) -- **note: package renamed to `vollib`; `py_vollib.*` imports are now a deprecated compatibility shim** |
| thedhruvhegde/ivsurf | MIT | main | 2026-07-09 | EXISTENCE_VERIFIED |
| goldspanlabs/optopsy | **AGPL-3.0** | main | 2026-06-30 | DEEP (README) -- **AGPL: code must never be copied into proprietary THETA Production per this directive's own section 16** |
| goldspanlabs/optopsy-mcp | **NONE (all rights reserved)** | main | 2026-04-07 | EXISTENCE_VERIFIED -- REFERENCE_ONLY |
| lambdaclass/options_portfolio_backtester | MIT | master | 2026-07-28 | EXISTENCE_VERIFIED |
| alpacahq/options-wheel | Apache-2.0 | main | 2025-06-05 | DEEP (README) |
| milgar7969/alpaca-options-framework | **NONE (all rights reserved)** | main | 2026-07-03 | DEEP (README) -- **findings below are FACTUAL OBSERVATIONS about the Alpaca API's own documented behavior, not adopted code; safe to act on regardless of license, since the underlying facts are about Alpaca's API, not this repo's expression of them** |
| ShayantoDutta/alpaca-wheel-bot | **NONE** | main | 2026-05-05 | EXISTENCE_VERIFIED |
| joncovington/MEICAgent | MIT | main | 2026-07-11 | DEEP (README) |
| pfnet-research/pfhedge | MIT | main | 2024-08-30 | EXISTENCE_VERIFIED |
| quants-net/PyFENG | **GPL-2.0** | main | 2026-08-07 | EXISTENCE_VERIFIED -- REFERENCE_ONLY, never adoptable into proprietary code |
| domokane/FinancePy | **GPL-3.0** | master | 2026-09-12 | EXISTENCE_VERIFIED -- REFERENCE_ONLY, never adoptable |

**License summary, stated plainly for Codex:** `goldspanlabs/optopsy` (AGPL-3.0),
`quants-net/PyFENG` (GPL-2.0), and `domokane/FinancePy` (GPL-3.0) may be studied
for IDEAS but their code must never be copied, translated line-by-line, or
otherwise incorporated into THETA's proprietary Production tree. `sgdividends/
spx-dealer-gamma`, `BitraAI/gex_app`, `goldspanlabs/optopsy-mcp`,
`milgar7969/alpaca-options-framework`, and `ShayantoDutta/alpaca-wheel-bot`
carry no declared license at all, which defaults to all-rights-reserved --
same restriction, reference-only.

## Deep-study dossiers

### REPO: FlashAlpha-lab/flashalpha-python
PINNED_SHA: `747335f4bbf69ec89b7eaa2744b7e0ff5743b21f`
LICENSE: MIT
FILES_READ: `README.md` (full)

PROBLEM_SOLVED: a commercial (paid-tier-gated), Python-client options-analytics
API most structurally similar to what Optionomics claims to be -- GEX/DEX/
Vanna/Charm, IV/skew/term/surface, 0DTE analytics, a live screener, and a
"strategy decision envelope" endpoint family.

DATA_INPUT_MODEL: caller supplies a symbol or explicit option parameters
(spot/strike/dte/sigma) to typed client methods; no chain ingestion pipeline
of THETA's own kind since it's a hosted API, not a raw-feed normalizer.

DATA_OUTPUT_MODEL: every JSON-OBJECT response (not bare-array endpoints)
carries a `data_as_of` envelope PER UPSTREAM FEED (`equity_feed`,
`equity_options_feed`, `index_feed`, `futures_feed`, `flow_feed`, `oi_feed`,
`macro_feed`), each independently timestamped, plus `endpoint_version`.

PROVENANCE_MODEL: **the single most valuable pattern found this pass.**
Provenance is not one blob timestamp -- it's per-feed-family, so a caller can
tell "my options-quote feed is fresh but my OI feed is a session old" instead
of one ambiguous number. `data_as_of != as_of`: `as_of` is response-generation
time; `data_as_of` describes the FEEDS behind the answer.

TIMESTAMP_MODEL: ISO-8601 per feed; `oi_feed` explicitly dated to the prior
session's 16:00 ET close (settled OI updates once daily by nature, not a bug).

FRESHNESS_MODEL: documented EXPECTED CADENCE per feed ("seconds during market
hours" for options/equity/index feeds; "daily" for OI; "minutes, reports its
oldest component" for the macro bundle) -- freshness is judged against the
feed's OWN cadence, not a single global SLA.

MISSING_DATA_MODEL: `gamma_flip` is explicitly nullable with a CLOSED set of
reason codes (`no_boundary`, `insufficient_local_coverage`,
`insufficient_quote_quality`, `sensitive_root`, `uncertain_root_path`,
`stored_sign_mismatch`, `search_budget`, `quality_budget`) -- only
`gamma_flip_status == "available"` guarantees a number, and the README
explicitly warns future unrecognized codes must ALSO be treated as "not
published," never silently formatted as if numeric.

QUOTE_MODEL: not the focus (this is an analytics API, not a quote feed).
FLOW_MODEL: `flow_feed` is "classified options and stock trade tape";
`flow_zero_dte_strike_flow` returns "per-strike SIGNED AGGRESSOR flow" --
confirms aggressor-side classification is a real, established pattern in
professional options-analytics APIs, not a THETA invention.
GREEKS_MODEL: first/second/third-order (delta/gamma/theta/vega/rho; vanna/
charm/vomma; speed/zomma/color/ultima) -- a full order-3 greeks surface,
broader than THETA currently consumes from Optionomics (which only reaches
vanna/charm, order 2).
VOLATILITY_MODEL: ATM IV, RV(20d), IV-RV spread with a qualitative
"assessment," 25-delta skew, SVI parameters, butterfly/calendar arbitrage
flags, variance-swap fair values -- a materially richer surface-diagnostics
set than THETA's current `PARTIAL` surface state.
EXPOSURE_MODEL: GEX/DEX/VEX/CHEX by strike plus named "levels" (call wall, put
wall, gamma flip with status).
REGIME_MODEL: `vrp_regime` ("harvestable" etc.), `regime` ("positive_gamma"
etc.), `dealer_flow_risk` score -- i.e. this vendor already does the
fact->regime composition THETA's own pipeline (see the intelligence
synthesis doc) currently lacks.

STATE_MODEL / EXECUTION_MODEL / REPLAY_MODEL / TESTING_MODEL: not observable
from a client README; out of scope to guess.

FAILURE_MODES: none documented in the README itself (a marketing-adjacent
document); no adversarial failure catalog visible from this file alone.
LOOKAHEAD_RISK / SURVIVORSHIP_RISK: not assessable from a client README.

THETA_ALREADY_HAS: exact-contract identity matching; explicit UNKNOWN-never-
zero discipline; typed feature-destination allowlists per branch.
THETA_MISSING: per-feed-family freshness envelope (THETA has one timestamp per
observation, not one per underlying data source); order-3 greeks; a named
regime-composition layer; a live screener/ranking surface across a universe.

REPO_BETTER_THAN_THETA: the `data_as_of` per-feed provenance pattern, and the
closed-set nullable-reason-code pattern for `gamma_flip`.
THETA_BETTER_THAN_REPO: THETA's raw-observation immutability (migration 029)
and PIT-safety discipline are more rigorous than anything a client README
documents about its own backend (which is opaque to a client library user).

ADOPT_METHOD: the per-feed-family provenance concept and the closed-set
nullable-reason-code pattern -- as DESIGN PATTERNS for Optionomics' own
observation envelope, not as code (this is a different, paid, unrelated
vendor; nothing here is copyable and nothing should be).
ADAPT: n/a.
TEST_ONLY: n/a.
REFERENCE_ONLY: the full feature catalog (order-3 greeks, SVI, variance-swap
fair value) as a MENU of what a mature vendor considers table-stakes, useful
for gap-checking Optionomics' own eventual authenticated schema once known.
REJECT: adopting FlashAlpha as an actual second data vendor -- out of scope
(new-vendor decisions require the standing missing-capability + controlled
OOS-ablation justification, and are Codex/owner's call, not mine to propose
here).

REASON: this is intelligence about what "good" looks like in this exact
product category, gathered to sharpen THETA's own Optionomics contract design
-- not a vendor-switch proposal.

REQUIRED_CODEX_CHANGE: none. This is a design-input document, not a defect
report.
REQUIRED_TESTS: none from this repo directly; see the intelligence-synthesis
doc's "durable observation history" gap for the actual buildable item this
pattern motivates.

---

### REPO: zrack/gex-terminal
PINNED_SHA: `182822c27654216b62c380f467f195aeb2b105b6`
LICENSE: MIT
FILES_READ: `README.md` (partial, first ~70 lines)

PROBLEM_SOLVED: a local-first terminal workbench for inspecting GEX PROXIES
(explicitly not claimed to be observed dealer inventory) across futures and
equity/index options, with replay and offline-certified fixtures.

DATA_INPUT_MODEL: pluggable provider adapters (bundled demo/replay,
Databento, Tradovate, IBKR, yfinance), each explicitly labeled by its own
certification status (`offline-certified`, `live-uncertified`, `scaffold`,
`delayed`).
DATA_OUTPUT_MODEL: strike-level exposure grid, walls, a "documented strike-
profile flip," feed-health state.

PROVENANCE_MODEL: keeps "provider readiness, runtime connection state, model
verification, and predictive validity as separate claims" -- this is
ALMOST VERBATIM the same discipline this engagement's own capability-census
work already applies to Optionomics (HTTP-200 transport health != quantitative
usefulness != execution fitness). Independent convergence on the same
discipline from an unrelated author is a strong signal it's the right one.
TIMESTAMP_MODEL / FRESHNESS_MODEL: not detailed in the README excerpt read.
MISSING_DATA_MODEL: `predictive_validity` is explicitly `unmeasured` as a
STANDING, undismissable label -- this repo will not let its own users forget
that offline tests prove software behavior, not a forecasting edge.

QUOTE_MODEL: n/a (not a quote-focused tool).
FLOW_MODEL: n/a (GEX-focused, not flow-focused).
GREEKS_MODEL: prices futures-option rows with **Black-76** and equity/index-
option rows with **Black-Scholes** BEFORE strike aggregation -- an explicit,
important methodological detail: mixing these two pricing conventions
silently (using Black-Scholes for a futures option, or vice versa) is a real,
named class of bug this repo defends against by design.
VOLATILITY_MODEL: n/a beyond the above.
EXPOSURE_MODEL: keeps open interest, raw trade volume, and "directionalized
volume" as three SEPARATE position models rather than blending them --
directly relevant to any THETA GEX/DEX research, since blending OI with
volume (a stock/flow confusion) is a known way to get a GEX estimate
structurally wrong.
REGIME_MODEL: n/a beyond wall/flip identification.

STATE_MODEL: version-tagged research releases ("0.5.0 -- Offline Research
Foundation"), explicit alpha status.
EXECUTION_MODEL: none -- explicitly a research/inspection tool, not an
execution system.
REPLAY_MODEL: "replays bundled sessions and provider-shaped fixtures without
credentials" -- a pattern THETA's own `optionomics_flow_event.py`/
`optionomics_flow_chain_fusion.py` (built ahead of real payloads, tested only
against synthetic fixtures) already independently follows.
TESTING_MODEL: "offline tests and fixtures verify software behavior" only,
explicitly distinguished from "a credentialed certification report" which
"can establish bounded transport and input evidence for its exact run" but
still "neither form of evidence establishes a forecasting edge... or
profitability" -- this is essentially THETA's own DATASET_ABSENT/
EV_MODEL_NOT_EMPIRICALLY_READY discipline, independently arrived at.

FAILURE_MODES: doesn't "present proxy calculations as observed dealer
inventory" -- i.e. explicitly guards the exact GEX-sign/interpretation
overclaim THETA's own `gamma_regime_research.py` already refuses to make
without `sign_convention_verified=True`.
LOOKAHEAD_RISK / SURVIVORSHIP_RISK: not assessable from the excerpt read.

THETA_ALREADY_HAS: the identical "transport health != usefulness != execution
fitness" separation; the identical GEX-sign-never-assumed discipline.
THETA_MISSING: an explicit Black-76-vs-Black-Scholes convention CHECK for any
underlying that might ever be a futures-referenced product (SPX/futures-
options-adjacent underlyings) -- worth confirming Optionomics' own documented
theoretical-price field uses the correct convention per underlying type,
since THETA's own capability census doesn't currently record which convention
Optionomics applies.

REPO_BETTER_THAN_THETA: the three-way OI/volume/directionalized-volume
separation is more explicit than anything in THETA's own GEX/DEX consumer
today (which treats Optionomics' reported values as opaque scalars).
THETA_BETTER_THAN_REPO: THETA's immutable raw-observation persistence
(migration 029) is more rigorous than a local terminal tool needs to be.

ADOPT_METHOD: the OI/volume/directionalized-volume separation, as a research
question to ask of Optionomics' own GEX methodology (does it conflate them?
unknown -- worth a documented question for Codex/owner to raise with the
provider, not something this branch can answer without their methodology
doc).
ADAPT: n/a.
TEST_ONLY: n/a.
REFERENCE_ONLY: the Black-76-vs-Black-Scholes distinction, as a checklist item.
REJECT: n/a.

REASON: convergent, independently-arrived-at validation of THETA's existing
transport/usefulness/sign-convention discipline, plus one concrete new
checklist item (pricing-convention-per-underlying-type).

REQUIRED_CODEX_CHANGE: none proven necessary -- a QUESTION for Codex to put to
Optionomics' documentation/support (which pricing convention does the
theoretical-price field use for any futures-referenced underlying, if THETA
ever trades one), not a code change.
REQUIRED_TESTS: none from this repo directly.

---

### REPO: NavnoorBawa/Options-Flow-Predictor
PINNED_SHA: `da83ec361c1cb7494a0b1b96dbca8edc4a09e788`
LICENSE: MIT
FILES_READ: `README.md` (full)

PROBLEM_SOLVED: a single-notebook ML system (Random Forest + XGBoost
ensemble) that predicts short-term stock price movement from options-flow-
derived features (put/call ratio, unusual volume, "dealer positioning,"
volatility-structure patterns).

DATA_INPUT_MODEL / DATA_OUTPUT_MODEL: not specified beyond feature-category
prose in the README; no data schema, no provenance model, no timestamp model
documented at all.
PROVENANCE_MODEL / TIMESTAMP_MODEL / FRESHNESS_MODEL / MISSING_DATA_MODEL:
**none documented** -- this is the README's own most important limitation:
zero discussion of data freshness, point-in-time discipline, or missing-data
handling anywhere in the file.

QUOTE_MODEL: n/a.
FLOW_MODEL: put/call VOLUME ratio, unusual-volume detection (vs historical
pattern, undefined lookback), and an assumed "dealer positioning" read from
inferred gamma exposure.
GREEKS_MODEL: uses ATM IV level and "risk reversal patterns" as ML features,
not as pricing.
VOLATILITY_MODEL: IV-across-strikes-and-expiries as a feature source for
"detecting institutional directional bets," described but not formalized.
EXPOSURE_MODEL: "gamma exposure calculations showing dealer hedging
pressures" used directly as a predictive feature -- i.e. this repo treats
GEX-implies-dealer-behavior as an ASSUMED FACT, not a hypothesis, which is
precisely the overclaim this directive (and THETA's own gamma_regime_research.py)
explicitly refuses to make.
REGIME_MODEL: "market regime detection" (low-vol/high-vol/trending/ranging)
gates predictions -- a reasonable idea, unformalized.

STATE_MODEL / EXECUTION_MODEL / REPLAY_MODEL / TESTING_MODEL: not documented;
this is a single Jupyter notebook, not a system with a defined architecture.

FAILURE_MODES: **not discussed at all in the README.** No mention of
lookahead risk, no walk-forward/OOS methodology described, no mention of
transaction costs, no calibration discussion.
LOOKAHEAD_RISK: HIGH, by omission -- an ML system trained on options-flow
features to predict "short-term stock price movements" with no stated PIT
discipline is a textbook candidate for future-information leakage (e.g. using
same-day closing IV as a feature to predict same-day movement). This is not
a leveled accusation against the author's actual implementation (not read at
the code level this pass) -- it is a named RISK this directive explicitly asks
to flag, based on what the README itself fails to address.
SURVIVORSHIP_RISK: not discussed; unknown universe-construction methodology.

THETA_ALREADY_HAS: the exact opposite discipline this repo lacks -- explicit
PIT firewalls, purged walk-forward, embargo, and a standing rule that GEX sign
is never assumed without verification.
THETA_MISSING: nothing this repo demonstrates that THETA lacks; if anything
this comparison is reassurance that THETA's stricter discipline is the
correct posture, not an oversight.

REPO_BETTER_THAN_THETA: nothing identified this pass.
THETA_BETTER_THAN_REPO: PIT/leakage discipline, UNKNOWN-never-assumed
discipline, explicit hypothesis-vs-fact separation for flow interpretation --
across the board.

ADOPT_METHOD: none.
ADAPT: none.
TEST_ONLY: the general FEATURE CATEGORIES (put/call ratio, unusual-volume
z-score, IV-across-strikes) are reasonable HYPOTHESIS SOURCES for THETA's own
flow-feature ablation ladder (section 4/12) -- registerable as TEST-status
research features, never as confirmed predictive signals, and never claiming
this repo's own (unverified, unaudited) performance as evidence.
REFERENCE_ONLY: the ensemble-modeling approach (RF+XGBoost) as a possible
future ADVANCED-MODEL challenger, strictly after baseline/PIT/calibration
discipline is satisfied per section 46 of the prior directive.
REJECT: any claimed accuracy/performance number from this repo as evidence of
anything -- none was independently verified, and the README's total silence
on leakage/costs/calibration makes any such number unusable as evidence even
if it had been stated.

REASON: a genuine, useful hypothesis-generation source, but a clear example
of exactly the "testimonial/self-reported performance" tier this directive
warns against promoting from -- this dossier classifies it correctly rather
than either over- or under-crediting it.

REQUIRED_CODEX_CHANGE: none.
REQUIRED_TESTS: none directly; the hypotheses it generates already map onto
existing TEST-status entries in `hypotheses.json`'s Flow-adjacent framing.

---

### REPO: goldspanlabs/optopsy
PINNED_SHA: `40bb8b2aa07ef8763caeadf752961faecb494efd`
LICENSE: **AGPL-3.0 -- REFERENCE_ONLY, never code-adoptable**
FILES_READ: `README.md` (full)

PROBLEM_SOLVED: a mature, actively-developed Python options backtesting and
statistics library -- 38 built-in strategies, per-leg delta targeting, a
chronological trade simulator with capital tracking, portfolio-level
simulation, multiple slippage models, and a large risk-metrics library
(Sharpe, Sortino, VaR, CVaR, Calmar, Omega, tail ratio).

DATA_INPUT_MODEL: a data CLI with pluggable providers (EODHD shown), local
caching with gap detection.
DATA_OUTPUT_MODEL: performance-statistics objects via `simulate()`/
`simulate_portfolio()`/`compute_risk_metrics()`.
PROVENANCE_MODEL / TIMESTAMP_MODEL / FRESHNESS_MODEL: not detailed in the
README (this is a backtesting library, working from cached historical data,
not a live-feed consumer).
MISSING_DATA_MODEL: not detailed in the README excerpt read.

QUOTE_MODEL: slippage modeling explicitly supports MID, SPREAD, LIQUIDITY-
BASED, and PER-LEG fill assumptions -- a genuinely richer fill-model taxonomy
than THETA's current `execution_simulator.py` is confirmed (from memory) to
have; worth checking THETA's own module against this taxonomy as a
completeness benchmark.
FLOW_MODEL: n/a (not a flow tool).
GREEKS_MODEL: per-leg delta TARGETING (select strikes by `target, min, max`
delta per leg) -- directly comparable to THETA's own DTE/delta lattice
research design; the "min/max around a target" framing is a useful pattern
for expressing THETA's delta bins as a targeting range rather than a fixed
point.
VOLATILITY_MODEL: IV Rank is one of 80+ entry-signal indicators (via
`pandas-ta-classic`) rather than a first-class backtest dimension of its own.
EXPOSURE_MODEL: n/a.
REGIME_MODEL: n/a beyond generic TA-indicator entry filters.

STATE_MODEL: position-limit-aware chronological simulation (not vectorized/
event-agnostic).
EXECUTION_MODEL: bid/ask-aware fills with commission modeling (per-contract,
base fee, min fee).
REPLAY_MODEL: chronological simulation via `simulate()`.
TESTING_MODEL: a documented API reference and example set exists (not read
this pass beyond the README).

FAILURE_MODES / LOOKAHEAD_RISK / SURVIVORSHIP_RISK: not assessable from the
README alone; would require reading the simulator's fill-timing code, out of
scope this pass given the AGPL license already rules out code adoption --
the value here is purely in the DESIGN VOCABULARY (slippage-model taxonomy,
delta-targeting-range API shape).

THETA_ALREADY_HAS: bid/ask-aware fill discipline (per prior sessions'
execution-quote qualification work); multi-leg cash-flow discipline (a roll is
close-old+open-new, never netted).
THETA_MISSING: an explicit, NAMED multi-slippage-model taxonomy (mid vs
spread vs liquidity-based vs per-leg) as a first-class research configuration
-- worth checking `execution_simulator.py` against this exact vocabulary.

REPO_BETTER_THAN_THETA: the named slippage-model taxonomy and the delta-
targeting-range API shape, as VOCABULARY (not code).
THETA_BETTER_THAN_REPO: whole-chain (CSP->assignment->stock->CC->call-away)
lifecycle accounting -- optopsy's own README describes strategy backtesting,
not a full assignment/recovery/covered-call lifecycle model.

ADOPT_METHOD: none (AGPL -- no code path).
ADAPT: the slippage-model taxonomy and delta-targeting-range naming, as
independently-authored THETA concepts inspired by (not copied from) this
public vocabulary -- permissible since a naming/design IDEA is not the
copyrighted expression.
TEST_ONLY: none.
REFERENCE_ONLY: risk-metrics list (Sharpe/Sortino/Calmar/Omega/tail ratio) as
a completeness check against THETA's own `SLICE_METRICS`/`ABLATION_DELTA_METRICS`.
REJECT: any code adoption whatsoever, per AGPL.

REASON: strong design reference, zero code-adoption risk once the license is
respected.

REQUIRED_CODEX_CHANGE: none proven necessary; a worthwhile FOLLOW-UP RESEARCH
TASK (not this pass) is comparing `execution_simulator.py`'s slippage model
against this taxonomy and naming any genuinely missing model explicitly.
REQUIRED_TESTS: none from this repo directly.

---

### REPO: alpacahq/options-wheel
PINNED_SHA: `3698429289065ceb0c13ffcdc31a966c576779ad`
LICENSE: Apache-2.0
FILES_READ: `README.md` (full)

PROBLEM_SOLVED: Alpaca's OWN official reference implementation of the wheel
strategy -- CSP -> assignment -> CC -> call-away, config-file-driven, single
symbol-list universe.

DATA_INPUT_MODEL: a static symbol list (`config/symbol_list.txt`) plus tunable
parameters (`config/params.py`) for buying-power limits, option
characteristics, and scoring thresholds.
DATA_OUTPUT_MODEL: not detailed beyond "picks the right puts and calls, tracks
positions, turns the wheel."

PROVENANCE_MODEL / TIMESTAMP_MODEL / FRESHNESS_MODEL / MISSING_DATA_MODEL: not
documented in the README -- this is explicitly a simple reference script, not
a hardened system, and does not claim otherwise.

QUOTE_MODEL / FLOW_MODEL / GREEKS_MODEL / VOLATILITY_MODEL / EXPOSURE_MODEL /
REGIME_MODEL: not documented at this README's level of detail.

STATE_MODEL: "assumes an empty or fully managed portfolio" -- i.e. it does
NOT claim to safely reconstruct state alongside pre-existing manual positions,
a real and stated limitation.
EXECUTION_MODEL: sequential wheel-turn logic via a single `run-strategy`
entry point.
REPLAY_MODEL / TESTING_MODEL: not documented.

FAILURE_MODES: none catalogued in the README.
LOOKAHEAD_RISK / SURVIVORSHIP_RISK: n/a (live-trading reference script, not a
backtester).

THETA_ALREADY_HAS: everything this repo does NOT have -- whole-chain
accounting, an explicit AEGIS-equivalent risk layer, a Paper-evidence-tier
separation, multi-branch strategy routing (Conventional/Hold-Strike/Defined-
Risk/Recovery/CC as DISTINCT branches rather than one linear wheel script),
explicit lifecycle-state machine with 15 named states.
THETA_MISSING: nothing this repo demonstrates -- it is a simpler system than
THETA in essentially every dimension this comparison checked.

REPO_BETTER_THAN_THETA: nothing identified.
THETA_BETTER_THAN_REPO: architecture maturity across the board -- this
comparison is useful precisely as a BASELINE showing how much further THETA
has already come than the "naive wheel bot" starting point, not as a source
of new patterns.

ADOPT_METHOD / ADAPT / TEST_ONLY: none.
REFERENCE_ONLY: as the simplest possible Alpaca-wheel baseline, useful when
explaining to a reviewer what THETA is NOT (a linear, single-portfolio-
assumption script).
REJECT: adopting anything from this repo's approach -- it would be a
downgrade.

REASON: confirms THETA's architecture is already well ahead of the "obvious"
reference implementation; the real value this pass found for wheel/lifecycle
risk was in `milgar7969/alpaca-options-framework` (below), not here.

REQUIRED_CODEX_CHANGE: none.
REQUIRED_TESTS: none.

---

### REPO: milgar7969/alpaca-options-framework
PINNED_SHA: not pinned (no license -- README-only facts extracted, no code
read or adopted)
LICENSE: **NONE (all rights reserved)** -- findings below are documented FACTS
about Alpaca's own API behavior, safe to act on regardless of this repo's
license, since a fact about a third party's (Alpaca's) API is not this
author's copyrightable expression.
FILES_READ: `README.md` (first ~50 lines -- the "What the Documentation
Doesn't Tell You" section)

PROBLEM_SOLVED: a production-oriented Alpaca options bot framework whose
README is, unusually, primarily a CATALOG of undocumented Alpaca API failure
modes the author hit in live/paper trading -- the single most operationally
valuable document found in this entire repo study, precisely because it names
real Alpaca-specific quirks with exact error codes.

**Nine concrete, named Alpaca API failure modes (all facts about Alpaca's own
API, independently checkable against THETA's own code):**

1. Bracket orders rejected for options (`error 42210000: complex orders not
   supported`) -- the only reliable exit is `close_position()`.
2. A sell-limit order on an option position can be misread by Alpaca as an
   attempt to OPEN a new short position (`error 40310000: cannot submit sell
   order — no existing position`) -- relevant to THETA the moment a
   long-option leg (e.g. THETA_DEFINED_RISK's long put) needs a SELL_TO_CLOSE;
   THETA's current Wheel-only action set (SELL_TO_OPEN CSP/CC, BUY_TO_CLOSE)
   never triggers this today, since it never needs to sell-to-close a long
   leg -- **this becomes directly relevant the moment THETA-D is ungated.**
3. Alpaca's own Greeks return `null` for 0DTE contracts (Black-Scholes is
   undefined at T=0) -- relevant to THETA_HOLD_STRIKE's 2-5 DTE research
   cohort, though not literally 0DTE; worth confirming Alpaca's Greeks
   behavior at DTE=2 specifically before relying on them there.
4. The underlying stock feed can update on a slower cadence (1-min bars) than
   option quotes -- a source of a stale-underlying-price bug distinct from a
   stale-option-quote bug; worth checking THETA's own underlying-price
   consumption path for the same mismatch.
5. Option subscriptions can go stale intraday if the underlying moves far
   from the originally-subscribed strike range -- a live-streaming concern
   more relevant to a future real-time worker than to THETA's current
   REST-poll-based cycle model.
6. Premarket price != official open price -- a genuine PIT-adjacent risk if
   THETA (or any decision path) ever consumes a pre-9:30-ET underlying quote
   as if it were the regular-session price.
7. A crashed process can leave an open position at the broker unknown to
   local state -- THETA already has an equivalent (`broker-reconciliation-
   worker.ts`'s `localOnlyIntentCount`/`externalOrUnknownCount` tracking,
   independently verified in this branch's own prior integration audit).
8. **A cancelled buy order can still fill** (an `asyncio.CancelledError`
   racing a WebSocket teardown does not guarantee the cancel wins) -- the
   framework defends with (a) re-checking order status after a cancelled wait
   before assuming the cancel succeeded, and (b) a periodic REST-based "ghost
   sweeper" that force-closes any option position not tracked locally.
9. WebSocket teardown can hang the event loop for 20+ seconds at end-of-day,
   which can cascade into a restart loop under a naive watchdog -- solved by
   verifying the account is flat via REST with retries, then a hard process
   exit rather than a graceful WebSocket shutdown.

DATA_INPUT_MODEL / DATA_OUTPUT_MODEL / PROVENANCE_MODEL / TIMESTAMP_MODEL /
FRESHNESS_MODEL / VOLATILITY_MODEL / EXPOSURE_MODEL / REGIME_MODEL: not the
focus of the excerpt read; this dossier is scoped to the failure-catalog
section specifically, which is where the real value is.

QUOTE_MODEL: implied by point 3/4 above -- Greeks/underlying-price staleness
as a quote-quality concern.
FLOW_MODEL: n/a.
GREEKS_MODEL: point 3 above -- 0DTE null-Greeks handling via a "proxy delta."
STATE_MODEL: REST-based startup reconciliation of existing positions (point 7).
EXECUTION_MODEL: `close_position()`-centric exit strategy (points 1-2); a
race-aware order-status recheck after a cancel (point 8).
REPLAY_MODEL / TESTING_MODEL: not documented in the excerpt read.

FAILURE_MODES: the nine points above, ARE the failure catalog -- exceptionally
concrete and directly turnable into THETA regression-test scenarios (see
below).
LOOKAHEAD_RISK: point 6 (premarket vs open price) is precisely a PIT-adjacent
risk if not handled.
SURVIVORSHIP_RISK: n/a (not a backtesting concern here).

THETA_ALREADY_HAS: broker-reconciliation for the local-only-intent direction
(point 7's inverse) -- verified in a prior audit round
(`broker-reconciliation-worker.ts`'s `localOnlyIntentCount`).
THETA_MISSING (candidates to VERIFY, not confirmed defects -- this dossier
does not claim to have read THETA's order-submission code line-by-line this
pass, only to have identified what to check): (a) whether THETA's order
construction ever attempts a raw `sell`-type limit order on an option position
it already holds (point 2) rather than routing exclusively through a
close-position-equivalent path; (b) whether a cancelled-but-possibly-filled
order is re-checked by status before being treated as cancelled (point 8);
(c) whether an `externalOrUnknownCount > 0` (broker-side unknown position)
is ever auto-force-closed by THETA the way this framework's "ghost sweeper"
does, or only flagged/degraded -- and if THETA already only flags (consistent
with the prior audit's finding that `ORDER_RECONCILIATION` returns `degraded`
rather than mutating), that is a DELIBERATE, MORE CONSERVATIVE choice than
this framework's auto-force-close, worth stating explicitly as
THETA_BETTER_THAN_REPO rather than a gap, since auto-force-closing a
broker-side position THETA doesn't recognize could wrongly close a user's
own manually-placed position.

REPO_BETTER_THAN_THETA: names 9 EXACT, reproducible Alpaca API quirks with
error codes -- a level of concrete adversarial detail this engagement's own
audits have not produced for the Alpaca options order-submission path
specifically (prior audits focused on the execution-authorization-tier/
paper-evidence layer, not Alpaca's own API-level order-rejection quirks).
THETA_BETTER_THAN_REPO: the conservative "flag, never auto-force-close an
unrecognized broker position" posture (if confirmed) is safer than this
framework's aggressive ghost-sweeper for a paper-first, safety-critical
platform serving real users' own accounts.

ADOPT_METHOD: the specific FACTS about Alpaca's own API (bracket orders
rejected for options; sell-limit-on-existing-position misread as open;
0DTE null Greeks; cancel-can-still-fill race) as VERIFICATION CHECKLIST
ITEMS against THETA's own order-construction and reconciliation code --
not code, just facts to check.
ADAPT: n/a (no code read/adopted).
TEST_ONLY: the nine failure modes, turned into acceptance-test SCENARIOS for
Codex (see below).
REFERENCE_ONLY: the hard-exit-after-REST-flat-check pattern for point 9, as a
worker-lifecycle idea Codex may or may not need depending on THETA's own
worker architecture (not assessed this pass).
REJECT: n/a.

REASON: the single highest actionable-defect-hunting value of any repo
studied this pass, precisely because it's a first-person account of REAL
Alpaca API behavior, not a generic pattern.

REQUIRED_CODEX_CHANGE: none PROVEN necessary from this pass alone (this
dossier did not re-read THETA's order-construction/reconciliation code
against these nine points this session, given time budget already spent on
new synthesis work -- that verification is the concrete next task, not
something to claim as already done).
REQUIRED_TESTS (regression-test scenarios to hand to Codex, unverified against
current code, framed as questions):
  1. Does an attempt to close a long option leg (relevant once THETA-D exists)
     ever construct a raw `sell`-type limit order, or does it always route
     through Alpaca's `close_position()`-equivalent endpoint?
  2. Is a cancelled order's status re-checked before being treated as
     cancelled, to catch a cancel-vs-fill race?
  3. When `externalOrUnknownCount > 0` (broker-side unknown position), is the
     current behavior "flag and degrade" or "auto-close"? (If the former,
     record it as an intentional NO_CHANGE_REQUIRED safety choice.)
  4. Does THETA's Greeks consumption path handle a null/undefined Greeks
     response at very short DTE (independent of provider) without silently
     defaulting to zero?

---

### REPO: joncovington/MEICAgent
PINNED_SHA: not pinned (README-only)
LICENSE: MIT
FILES_READ: `README.md` (first ~50 lines)

PROBLEM_SOLVED: an autonomous 0DTE index-options agent (Multiple Entry Iron
Condor) that runs its OWN decision loop inside Claude Code itself (an unusual
architecture: the agent IS the orchestrator, not a traditional cron-scheduled
bot), trading tastytrade directly via OAuth2.

DATA_INPUT_MODEL: live quotes read each decision cycle (few-minute cadence)
plus a stack of risk gates.
DATA_OUTPUT_MODEL: enter/hold/close decisions, now also a full parallel
zero-capital "paper-trading system" shadowing four risk profiles
simultaneously against live quotes.

PROVENANCE_MODEL / TIMESTAMP_MODEL / FRESHNESS_MODEL / MISSING_DATA_MODEL: not
detailed in the excerpt read.

QUOTE_MODEL / FLOW_MODEL / GREEKS_MODEL / VOLATILITY_MODEL / EXPOSURE_MODEL:
not detailed in the excerpt read.
REGIME_MODEL: n/a from this excerpt.

STATE_MODEL: a persistent local database (`src/db.py init_db`), config-driven.
EXECUTION_MODEL: live trading gated behind an explicit config flag, DEFAULTS
TO DRY-RUN -- a real, good safety default worth noting as consistent with
THETA's own paper-first posture.
REPLAY_MODEL: the "shadow-trades all four risk profiles against live quotes
with zero capital" paper system is directly analogous to THETA's own Shadow-
vs-Paper-vs-Live evidence separation (reviewed and accepted in an earlier
session of this engagement).
TESTING_MODEL: `pytest`/`pytest-asyncio` mentioned as optional dev dependency.

FAILURE_MODES: the README explicitly calls out one CORRECTED bug in its own
release notes: **"corrected MEIC exit rules (cash-settled positions are now
left to expire, not force-closed)"** -- i.e. a prior version of this agent
was WRONGLY force-closing cash-settled index option positions instead of
letting them expire and cash-settle naturally. This is a concrete, real,
previously-shipped LIFECYCLE BUG in a comparable system: treating "the
position is still open near expiry" as always requiring an active CLOSE
action, when for a cash-settled instrument the correct action can be to do
nothing and let it expire/settle. Directly relevant to THETA's own
`EXPIRE_OTM`/`LET_EXPIRE` vs `BTC_CLOSE` decision boundary -- worth an
explicit confirmation (not assumed broken) that THETA's own management
frontier never forces an unnecessary close on a position that should be left
to expire.
LOOKAHEAD_RISK / SURVIVORSHIP_RISK: n/a from this excerpt.

THETA_ALREADY_HAS: an explicit Shadow/Paper/Live evidence-tier separation,
independently converging with this repo's "shadow-trade all profiles at zero
capital" pattern.
THETA_MISSING: nothing this repo demonstrates as missing; the "corrected exit
rule" note is a useful NEGATIVE example (a documented past mistake) rather
than a pattern to adopt.

REPO_BETTER_THAN_THETA: nothing structurally identified this pass.
THETA_BETTER_THAN_REPO: THETA's lifecycle state machine already has distinct
`EXPIRE_OTM` and `CLOSE_STOCK`/`BTC_CLOSE` states rather than one generic
"close" action, which is precisely the distinction whose ABSENCE caused this
repo's own documented bug.

ADOPT_METHOD: none (no code read).
ADAPT: none.
TEST_ONLY: the "cash-settled positions should expire, not be force-closed"
lesson, restated as a verification question for Codex (see below) --
THETA's own instruments (equity/ETF options, physically settled, assignable)
are not cash-settled index options, so this exact bug shape may not directly
transfer, but the GENERAL lesson (don't default to an active close near
expiry when doing nothing is correct) is transferable.
REFERENCE_ONLY: the "agent runs its own decision loop inside an AI coding
assistant" architecture, as an unusual but real pattern -- not relevant to
THETA's own scheduler-based design, noted only for completeness.
REJECT: n/a.

REASON: a small but concrete, previously-shipped lifecycle bug in a
comparable system, useful as a named regression-test prompt for THETA's own
equivalent decision boundary.

REQUIRED_CODEX_CHANGE: none proven necessary.
REQUIRED_TESTS: confirm THETA's management frontier never selects an active
CLOSE action for a short option that would otherwise expire worthless/OTM
without economic benefit to closing early (i.e. `LET_EXPIRE`/`EXPIRE_OTM`
genuinely competes with `CLOSE_FULL` from the same decision state, per the
existing competing-actions framework -- this is exactly what section 13 of
the prior directive already asked to verify structurally; this dossier adds
one more concrete reason it matters).

---

### REPO: vollib/py_vollib (now `vollib`)
PINNED_SHA: `11f2058f709328339e3906d99cb04ff41af97776`
LICENSE: MIT
FILES_READ: `README.md` (full)

PROBLEM_SOLVED: fast, accurate Black/Black-Scholes/Black-Scholes-Merton
option pricing, implied volatility (via Peter Jaeckel's LetsBeRational), and
analytical/numerical greeks.

**Important update from a prior session's finding:** the canonical package
name is now `vollib` (not `py_vollib`) as of `vollib 1.0.7`; `py_vollib.*`
imports remain available only as a DEPRECATED compatibility shim during a
transition period. Any future reference to this library in THETA's own docs
should use the current name.

DATA_INPUT_MODEL: strike (`K`) must be strictly positive for all three pricing
families -- `K=0` raises `ZeroDivisionError` for calls AND puts (no special-
cased limit), `K<0` raises `ValueError`. This CONFIRMS, again, the same
invariant this branch found and corrected an overclaim about in an earlier
session (`bs_reference.py` already returns `None` for the equivalent
boundary rather than raising -- a DIFFERENT but equally fail-closed strategy,
not a stronger or weaker one; restating this because a prior draft of this
branch's own ledger had briefly overclaimed vollib was stronger before being
corrected, and this dossier is the right place to re-confirm the corrected
conclusion stands).

DATA_OUTPUT_MODEL / PROVENANCE_MODEL / TIMESTAMP_MODEL / FRESHNESS_MODEL /
MISSING_DATA_MODEL: n/a (a pure pricing library, no data feed of its own).
QUOTE_MODEL / FLOW_MODEL / EXPOSURE_MODEL / REGIME_MODEL: n/a.
GREEKS_MODEL: analytical AND numerical greeks for each of Black/Black-
Scholes/Black-Scholes-Merton.
VOLATILITY_MODEL: implied volatility via LetsBeRational, described as
"extremely fast and accurate."
STATE_MODEL / EXECUTION_MODEL / REPLAY_MODEL / TESTING_MODEL: n/a.
FAILURE_MODES: the strict-positive-strike domain requirement IS the
documented failure mode -- raises rather than returning a silent default.
LOOKAHEAD_RISK / SURVIVORSHIP_RISK: n/a (not a backtesting tool).

THETA_ALREADY_HAS: an equivalent invariant in `bs_reference.py` (confirmed,
not merely assumed, in a prior session).
THETA_MISSING: nothing new identified this pass.

REPO_BETTER_THAN_THETA: n/a (parity, not superiority, on the specific
invariant checked).
THETA_BETTER_THAN_REPO: n/a.

ADOPT_METHOD / ADAPT: none needed -- already equivalent.
TEST_ONLY: none.
REFERENCE_ONLY: as an independent cross-check reference for THETA's own
Black-Scholes implementation, per this directive's own instruction ("use as
independent validation references... never replace Optionomics value merely
because another model differs").
REJECT: none.

REASON: confirms prior-session finding stands; flags the package rename for
documentation hygiene.

REQUIRED_CODEX_CHANGE: none.
REQUIRED_TESTS: none.

## Repos verified but not deep-studied this pass

`FlashAlpha-lab/flashalpha-examples`, `FlashAlpha-lab/volatility-surface-python`,
`FlashAlpha-lab/0dte-options-analytics`, `FlashAlpha-lab/flashalpha-historical-python`,
`FlashAlpha-lab/gex-explained`, `sgdividends/spx-dealer-gamma`, `BitraAI/gex_app`,
`QuantConnect/Lean`, `OpenGamma/Strata`, `lballabio/QuantLib`, `thedhruvhegde/ivsurf`,
`goldspanlabs/optopsy-mcp`, `lambdaclass/options_portfolio_backtester`,
`ShayantoDutta/alpaca-wheel-bot`, `pfnet-research/pfhedge`, `quants-net/PyFENG`,
`domokane/FinancePy` -- existence, license, and default branch verified via
`gh api` (table above); no file-level content read this pass. Extending this
list with the same dossier format is a bounded, resumable follow-up task, not
a gap to paper over with a fabricated summary.

## Cross-repository synthesis (section 9)

### A. Option quote model

| System | Bid/Ask | Sizes | Mid/Spread | Trade | Timestamp | Freshness | Provenance | Fill assumption |
|---|---|---|---|---|---|---|---|---|
| THETA (current) | Yes (Alpaca OPRA-gated/IEX, Optionomics research-only) | Yes (Alpaca) | Derived (`Mid`, `Spread`, `RelativeSpread` in Optionomics feature v2) | No confirmed print from Optionomics | Per-observation (`asOf`) | Not modeled as change-over-time | Migration 029: rich, per-observation | Never assumed -- explicit `sourceSemantics` enum, execution requires `TRUSTED_TWO_SIDED_ORDER_PRICING`/`CONSOLIDATED_NBBO` |
| Optionomics (as documented) | Yes | Yes | Not provider-native (THETA derives it) | No (session-recorded, no confirmed print field) | Yes | Inconsistent run-to-run (this branch's own finding) | Documented as session-ingested research | Explicitly non-executable |
| FlashAlpha | Not the focus (analytics API) | n/a | n/a | Implied via flow_feed "trade tape" | Per-feed `data_as_of` | Documented per-feed cadence | Best-in-class of anything reviewed | n/a (not an order-routing API) |
| LEAN (architecture, reference only) | Yes, native Quote/Trade/OI separation | Yes | Derived | Yes (native Trade type) | Yes | Feed-dependent | Framework-level | Configurable fill models |
| Optopsy | Historical bid/ask from cached provider | n/a documented | Derived | n/a (backtest, not live) | Historical bar timestamp | n/a (historical) | n/a | Multiple named slippage models (mid/spread/liquidity/per-leg) |

**Recommendation:** THETA's current architecture (strict `sourceSemantics`
enum, execution requires Alpaca-sourced trust, Optionomics permanently
research-only) is already the CORRECT shape and should not be redesigned.
The one gap this synthesis surfaces concretely: THETA has no per-feed-family
freshness envelope (FlashAlpha's `data_as_of` pattern) and no named
multi-slippage-model taxonomy (Optopsy's pattern) -- both are additive,
non-breaking enhancements to the EXISTING architecture, not replacements.

### B. Flow model

```
RAW PRINT (not documented in Optionomics' current contract at all)
   -> SIDE CLASSIFICATION (Above Ask/At Ask/Mid/At Bid/Below Bid -- FlashAlpha
      calls this "classified... trade tape"; a real, established pattern
      THETA's own optionomics_flow_event.py already models, ahead of data)
   -> STRUCTURE (sweep/block/multi-leg flags -- also undocumented in
      Optionomics' contract today; Options-Flow-Predictor treats these as
      assumed-informative without verification, which THETA must not repeat)
   -> NORMALIZATION (premium/size/OI/volume as separate typed fields, never
      blended -- gex-terminal's OI-vs-volume separation reinforces this)
   -> WINDOW (rolling aggregation -- Optionomics' own 5-min bucket aggregate
      is the only real, current data THETA has for this stage)
   -> ANOMALY (unusual-volume z-score vs history -- a TEST-status feature,
      Options-Flow-Predictor's central idea, unverified)
   -> REGIME (net aggressive premium tilt, as a portfolio-level input only)
   -> STRATEGY FEATURE (gated by optionomics-feature-destinations.ts,
      FLOW already at position 4/17 in FEATURE_ABLATION_FAMILIES)
```

**Recommendation:** the pipeline shape above is sound and matches what
THETA's own prior-session flow modules already anticipate; the concrete GAP
is that stages 1-3 (raw print, side classification, structure) have NO real
provider data behind them today (Optionomics' documented contract stops at
stage 4/aggregate). Nothing to build differently -- the code is ready and
waiting, correctly, for the data.

### C. GEX model

| System | Formula basis | Sign convention | OI treatment | Multiplier | Spot scaling | Walls/flip |
|---|---|---|---|---|---|---|
| Optionomics (as consumed) | UNKNOWN -- provider-reported scalar only | Explicitly UNVERIFIED (THETA's own discipline) | UNKNOWN whether OI-weighted vs volume-weighted | UNKNOWN | UNKNOWN | Provided as named fields (`gammaFlipStrike`, walls), methodology unverified |
| FlashAlpha | Documented per-strike, nullable with 8 named reason codes when undetermined | Not itself claimed by the README to be independently derived (a vendor black box, same epistemic status as Optionomics) | Implied but not detailed in the README excerpt | Implied | Implied | `call_wall`/`put_wall`/`gamma_flip` with explicit availability status |
| gex-terminal | Black-76 (futures) vs Black-Scholes (equity/index) BEFORE strike aggregation -- explicit convention split | Explicitly a PROXY, never claimed as observed dealer inventory | OI, raw volume, and directionalized volume kept as THREE SEPARATE models | Not detailed in excerpt | Documented strike-crossing/spot-scan choice exists (per README's "spot-scan vs strike-crossing" framing in the original directive, not independently confirmed by the excerpt read) | "documented strike-profile flip" |
| Options-Flow-Predictor | Treated as an assumed-correct INPUT feature, no own methodology | Assumed, not verified | Not discussed | Not discussed | Not discussed | Not discussed |
| THETA | N/A -- consumes Optionomics scalars, never computes its own GEX | Explicitly never assumed (gamma_regime_research.py requires `sign_convention_verified=True`) | N/A | N/A | N/A | Consumes provider-reported wall/flip fields as opaque, unverified |

**Exact mathematical differences documented:** none can be stated with
certainty for Optionomics itself, since its methodology is UNVERIFIED and
UNDOCUMENTED beyond field names -- this is not a gap in THETA's research, it
is a gap in the PROVIDER's own public documentation. The one concrete,
checkable methodological question this comparison surfaces: **does
Optionomics' GEX separate OI from volume the way gex-terminal explicitly
does, or could it conflate them?** Unknown, and worth a documented question
for Codex/owner to put to the provider rather than an assumption either way.

**Recommendation:** no merge of incompatible definitions has occurred or is
proposed -- THETA correctly treats Optionomics' GEX as an opaque, unverified
scalar and should continue to do so until the provider's own methodology is
confirmed.

### D. Volatility model

| System | IV | RV | VRP | IV Rank/Pctl | Skew | Term | Surface | Expected Move |
|---|---|---|---|---|---|---|---|---|
| Optionomics | Per-contract, provider-reported | Not provider-native (THETA computes via `iv_realized_vol_research.py`, 4 estimators) | THETA-computed from the two above, horizon-aligned | Provider-reported, PARTIAL per census | Raw 25-delta difference implemented, z-score needs PIT history | Expiry IV difference implemented, total/forward variance blocked on tenor/day-count choice | Raw strike-expiry grid implemented, SVI/SSVI deferred | THETA-computed (`ExpectedMoveApprox = S*IV*sqrt(DTE/365)`) |
| FlashAlpha | Yes, plus RV(20d), IV-RV "assessment," 25d skew, SVI parameters, butterfly/calendar arbitrage flags, variance-swap fair values | Yes, native | Yes, native, qualitatively labeled | Not detailed | Native, richer (full SVI) | Not detailed beyond skew | SVI-fitted, natively | Not detailed |
| QuantLib/vollib | Pricing/IV-inversion primitives only, no vendor-style aggregate features | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| ivsurf | Not studied this pass (existence-verified only) | -- | -- | -- | -- | -- | -- | -- |
| Optopsy | IV Rank as one of 80+ generic TA-style entry signals | n/a native | n/a native | Yes, via `pandas-ta-classic` | n/a | n/a | n/a | n/a |

**Recommendation:** THETA's existing volatility-surface/term-structure
modules (SVI fit with arbitrage-diagnostic deferral, explicit horizon-
alignment requirement for IV/RV comparisons) are methodologically sound and
match or exceed the sophistication of every OTHER system in this comparison
except FlashAlpha's own vendor-side SVI+arbitrage-flag combination (which
THETA cannot adopt without a new-vendor decision). No change recommended;
continue deferring full SVI/SSVI arbitrage diagnostics as R6 challengers per
existing status.

### E. Lifecycle model

| System | Entry | Partial fill | Cancel | Expiry | Assignment | Stock | CC | Call-away | Restart |
|---|---|---|---|---|---|---|---|---|---|
| THETA | 11-state `ThetaLifecycleState` machine, fail-closed to `UNKNOWN` | Handled via order-intent state machine (per prior audits) | Handled via broker-reconciliation | `EXPIRE_OTM` distinct state | `ASSIGNED` distinct state, whole-chain linkage | `STOCK_HELD`/`RECOVERY_WAIT` distinct | `CC_PROPOSED`/`CC_OPEN` distinct | `CALL_AWAY` distinct state | `broker-reconciliation-worker.ts` + `localOnlyIntentCount`/`externalOrUnknownCount` |
| alpacahq/options-wheel | Sequential script, single linear flow | Not documented | Not documented | Implicit in "keep collecting until called away" | Implicit "if you get assigned" step | Implicit | Implicit "sell covered calls" step | Implicit "called away" step | "assumes an empty or fully managed portfolio" -- explicitly NOT restart-safe |
| milgar7969/alpaca-options-framework | Not detailed beyond order-construction quirks | Race-aware (cancel-can-still-fill defense) | `close_position()`-only exit | Not detailed | Not detailed | Not detailed | Not detailed | Not detailed | REST-based reconstruction on startup + periodic "ghost sweeper" |
| MEICAgent | Config-gated dry-run default | Not detailed | Not detailed | Corrected bug: cash-settled positions now left to expire, not force-closed | n/a (index options, not assignable in THETA's sense) | n/a | n/a | n/a | Persistent local DB |

**Recommendation:** THETA's 11-state lifecycle machine remains the most
complete of anything compared here. The two concrete, actionable items this
comparison surfaces (already listed as `REQUIRED_TESTS` above): (1) verify
THETA's order-construction never risks the sell-limit-misread-as-open quirk
once THETA-D exists, and (2) verify a cancelled order's status is re-checked
before being treated as cancelled, guarding the exact race
`milgar7969/alpaca-options-framework` found in production.

## Deep-study dossier: dominickkubica/options-scanner (P2, options-first pass)

Found this pass via a targeted search for real chain-level, contract-selection
implementations (per the R7 "OPTIONS-TRADING RESEARCH BOUNDARY" directive's
explicit requirement to prioritize repos operating on actual option-chain rows,
not ticker-only signals).

REPO: `dominickkubica/options-scanner`
SHA/TAG: not pinned (read via GitHub API `contents` at `main`, 2026-09-15)
LICENSE: **NONE (all rights reserved) -- REFERENCE_ONLY, no code adoptable**
FILES_READ: `src/optscan/screener/scoring.py` (full)

PROBLEM: a mature, actively-maintained (pushed same day as this research pass)
options-selling screener that ranks CANDIDATE CONTRACTS/STRUCTURES (singles and
spreads) from daily option-chain captures, then "validates its own scores
against settled outcomes" (per its own README framing) -- i.e. it is explicitly
built to answer whether its own contract-selection score actually predicts
anything, not just to rank contracts.

DATA MODEL: a `Candidate` (contract/structure) scored into an `Opportunity`
carrying every component that produced its score, plus a `ScoreComponents`
record (premium, iv_rank, liquidity, probability, event_risk) and warnings.
TIMESTAMP MODEL: `fetched_at`/`asof`/`source` carried on every scored
component -- matches THETA's own per-observation provenance discipline.
QUOTE MODEL: consumes real bid/ask/OI/volume from daily chain snapshots
(providers: Alpaca, yfinance, Robinhood order import -- `src/optscan/providers/`).
STRATEGY MODEL: `screener/strategies/{singles,spreads}.py` -- explicit
contract-selection logic, not a ticker-level signal.
MANAGEMENT MODEL: not read this pass (out of scope for the file actually read).
EXECUTION MODEL: none (a screener, not an execution system).
FORMULAS (read directly, not paraphrased from a README):
- **Log-ramp normalization for annualized return**, with an explicit,
  well-reasoned justification worth quoting: the population of candidates'
  annualized returns spans orders of magnitude (13% to 13,572% in this
  repo's own stated range), so a LINEAR 0-1 ramp either pins everything
  above a low ceiling at 1.0 or squashes the interesting middle below a high
  ceiling. A log ramp treats a 10x jump as equally significant wherever it
  sits on the scale -- "20% versus 200% is the same kind of gap as 200%
  versus 2000%." **Directly relevant to any future THETA candidate-ranking
  work that would normalize premium/return across a wide DTE/delta lattice.**
- **Composite-score weight renormalization over present components only**,
  rather than scoring a missing component as zero: "a missing IV rank shifts
  its weight onto the others instead of dragging every score down equally."
  This is a genuine, different TECHNIQUE from THETA's own current discipline
  (which avoids fabricating a composite score at all when inputs are
  missing) -- not necessarily better, but a real, precisely-specified
  alternative worth naming for Codex/future research to weigh, since THETA's
  own candidate ranking may face the exact same "IV rank isn't available yet
  for a new symbol" problem this repo explicitly built the renormalization
  for.
- **Event-risk as a graduated penalty, not a hard exclusion**, when the
  earnings filter itself is turned off (earnings -0.6, early-assignment
  risk -0.3, ex-dividend -0.1, floored at 0.0) -- an explicit design choice
  distinct from THETA's own typical hard-block-on-event-proximity pattern.
  Worth noting as a genuine alternative (soft-penalty vs. hard-block for
  event risk), not adopted here.
- **Thin-surface warning at a named threshold** (`THIN_SURFACE_SOLVE_RATE =
  0.5`: fewer than half of an expiry's contracts solving for a usable
  implied vol triggers an explicit warning) -- a concrete, citable reference
  point for THETA's own deferred sparse-chain-behavior caveat in
  `volatility_surface_research.py` (the 0.5 threshold is THIS repo's own
  choice, not independently justified for THETA -- cited as a reference
  point, not adopted as THETA's own number).
- Term-structure backwardation flagged as "usually means a pending event" --
  independently converges with THETA's own existing term-structure research
  hypothesis (backwardation as an event/stress signal).

TESTS: not read this pass (out of scope for the one file read).

ASSUMPTIONS/FAILURE_MODES (from the module's own docstring, not this
branch's inference -- an unusually honest self-critique worth quoting
directly): *"The weights and the normalization ramps are the least
defensible numbers in the project. They encode opinions like '25 percent
annualized is full marks' that nothing outside the config file justifies...
nothing here has been validated against outcomes yet... the honest possible
answer is no."* This is the SAME epistemic discipline THETA's own
`EV_MODEL_NOT_EMPIRICALLY_READY` standing status encodes, independently and
convergently arrived at by an unrelated author -- strong validation that
this is the right posture for an unvalidated scoring/ranking system, not an
excess of caution.

LOOKAHEAD_RISK/SURVIVORSHIP_RISK: not assessable from the one file read
(would require reading `storage/holdout.py` and `analytics/outcomes.py`,
not done this pass -- their existence in the tree is itself a positive
signal that this repo takes OOS/holdout discipline seriously, worth a
deeper read in a future pass).

THETA_ALREADY_HAS: the same missing-data-is-UNKNOWN-never-zero discipline,
applied at the FIELD level; the same "no validated score until outcomes
prove it" posture.
THETA_MISSING: a composite-score renormalization TECHNIQUE for the specific
case of ranking many candidates where some optional features (e.g. IV rank
for a newly-tracked symbol) are legitimately absent for SOME candidates but
not others -- THETA's current approach (documented in
`research_family_adapters.py`) is to report `NOT_APPLICABLE`/skip a whole
adapter rather than renormalize a composite score, which is more
conservative but may be too conservative for a RANKING (as opposed to a
pass/fail gate) use case.

ADOPT_METHOD: log-ramp normalization for wide-range return distributions;
the renormalize-on-missing-component technique, as a candidate approach for
a future THETA candidate-ranking (not gating) context specifically.
ADAPT: n/a (no code path, no-license repo).
TEST_ONLY: n/a.
REFERENCE_ONLY: the thin-surface-solve-rate warning pattern, the graduated
event-risk-penalty design, the whole repo's holdout/outcomes-validation
architecture (unread this pass, flagged for a future deeper read).
REJECT: no code adoption regardless of technique value, per the no-license
finding.

EXACT_CODEX_RECOMMENDATION: none proposed -- these are research-technique
options for a future THETA candidate-scoring/ranking design decision, not a
current defect or required change.
