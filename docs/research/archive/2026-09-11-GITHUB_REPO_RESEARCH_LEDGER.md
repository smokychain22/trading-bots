> Historical research snapshot from dc3df23, retained to preserve prior work. Not current guidance. Corrections and current status are in the parent research directory.

# GitHub Repository Research Ledger

Per the authoritative directive: this records what was ACTUALLY extracted
from each repository, not merely that it was "studied." Every entry below
reflects real file content fetched via `gh api` on 2026-09-11 (not a
README skim, unless explicitly marked as metadata-only). Commit SHAs are
the exact HEAD of each repo's default branch at inspection time — if a
repo is revisited later, re-fetch and compare against the recorded SHA
before assuming nothing changed.

Neither agent claims to have "learned" these repositories in a
model-training sense. Everything below is an explicit, auditable
extraction: read → understood → the concrete idea/formula/pattern is
named, and a recommendation is attached.

---

## FlashAlpha-lab/gex-explained

**URL:** https://github.com/FlashAlpha-lab/gex-explained
**Commit SHA inspected:** `a11321d62006311c4a72a68552587485024f2bf2`
**Last inspected:** 2026-09-11
**License:** MIT
**Category:** GEX / dealer positioning (Claude-led)
**Relevant files:** `code/compute_gex.py`, `theory/gamma-exposure.md`, `theory/dealer-hedging.md`, `code/compare_with_api.py`, `tests/test_compute_gex.py`

**What problem it solves:** Computes per-strike and total Gamma Exposure
(GEX) from a raw options-chain CSV using the "SpotGamma convention," plus
gamma-flip level, call wall, and put wall.

**Algorithms/formulas found:**
- Black-Scholes gamma: `gamma = N'(d1) / (S * sigma * sqrt(T))`, with
  `N'(x) = (1/sqrt(2*pi)) * exp(-x^2/2)`, `d1 = (ln(S/K) + (r+sigma^2/2)*T) / (sigma*sqrt(T))`.
- Per-strike dollar GEX: `GEX_strike = gamma * OI * 100 * S^2 * 0.01`
  (derived explicitly in the theory doc as "dollar delta change per 1% spot
  move, scaled by open interest").
- Sign convention: `call_gex = +gex`, `put_gex = -gex` (customers assumed
  net-long options; dealers therefore short calls/short puts, and the
  convention records dealer short-call-gamma hedging as stabilizing
  (+) and short-put-gamma hedging as destabilizing (-)).
- Gamma flip: first strike-to-strike zero crossing in the GEX profile,
  linearly interpolated between the two bracketing strikes.
- Call wall / put wall: the strike with the single highest / lowest net
  GEX value (a simple argmax/argmin, not a smoothed peak).
- IV approximation (their own words: "very rough," "use a Newton solver
  for production"): Brenner-Subrahmanyam, `IV ≈ (mid/spot) * sqrt(2*pi/T)`,
  clamped to `[0.05, 2.0]`.

**Architecture patterns found:** small, dependency-free, pure-function
module (no I/O beyond CSV load) — matches THETA's own "transparent
baseline, no hidden state" convention already used throughout
`bots/theta/quant/models/`.

**Strategy logic found:** none (this is a market-structure/context
signal generator, not a strategy).

**Risk logic found:** none directly; the "regime" classification
(`total_gex >= 0` → "POSITIVE (mean-reversion)" else "NEGATIVE
(momentum/vol-expansion)") is a widely-cited heuristic, presented here
without any empirical backtest of its own.

**Execution logic found:** none.

**Backtesting logic found:** none.

**Useful tests/invariants:** `tests/test_compute_gex.py` /
`test_unit.py` cover: zero-gamma at expiration edge cases, sign-flip
detection between adjacent strikes, and a `compare_with_api.py` script
that cross-checks the hand-rolled Black-Scholes gamma against a second,
independent source — exactly the "compare at least 2 independent
implementations" discipline the directive itself asks for; worth
replicating as a pattern in THETA's own Cboe research-only ablation work.

**Assumptions:** customers are net long options (both calls and puts);
open interest at a strike/type fully represents current dealer exposure
at that strike (no netting across expirations, no consideration of
dealer's own directional bets); risk-free rate is a caller-supplied
constant, not term-structure-aware.

**Weaknesses:** the module's own theory doc states the sign convention
is "a simplification" and can be wrong when customer positioning is
actually net short (a real, named limitation, not a hidden one). The IV
approximation is explicitly flagged by the authors as unfit for
production. No treatment of American-style early-exercise value, no
dividend adjustment.

**Look-ahead risk:** none identified — this is a single-snapshot
calculation, not a backtest; no forward-looking data is used.

**Survivorship-bias risk:** N/A (not a strategy backtest).

**Execution-model weaknesses:** N/A (no execution model).

**Licensing restrictions:** MIT — safe to independently reimplement the
formula (which is public domain mathematics regardless of license) and
even safe to closely mirror code structure if desired, with attribution.
THETA does not currently need to copy any source lines — the formula
itself is what's valuable.

**Relevant to THETA:** THETA's Cboe research-only layer
(`src/theta/cboe-regime.ts`) currently ingests VIX/VIX9D/VVIX/put-call
ratios but has no GEX computation at all — GEX is a genuinely new,
currently-absent signal category for THETA.

**Existing THETA equivalent:** none. `cboe-regime.ts` is the closest
adjacent module (also research-only, also explicitly not wired into any
production decision path).

**Better than current THETA implementation:** N/A (no existing THETA GEX
implementation to compare against).

**Recommended action:** `ADAPT`. If GEX is ever added to THETA's research
layer, use this repo's formula and sign-convention documentation as the
starting definition (cross-checked against a second source before
adoption — see the Gap Matrix), reimplemented independently in Python
under `bots/theta/quant/models/` following THETA's own transparent-
baseline/no-hidden-state conventions, with the exact same "research-only,
never a direct trade trigger" discipline Cboe already has. Do NOT wire a
"GEX regime => trade action" rule without an ablation, per the standing
Cboe production rule.

**Integration status:** NOT INTEGRATED. Formula extracted into
`docs/research/THETA_FORMULA_CATALOG.md`. No code written in THETA yet.

---

## ksanjay/Kelly-Criterion-Option-Selector

**URL:** https://github.com/ksanjay/Kelly-Criterion-Option-Selector
**Commit SHA inspected:** `43c2443cd202777650bd1c61233054a83fe31771`
**Last inspected:** 2026-09-11
**License:** MIT
**Category:** Position sizing (Claude-led)
**Relevant files:** `kelly_leaps.ipynb` (single notebook, 7KB, no other files)

**What problem it solves:** Sizes a single at-the-money LEAP call per
ticker for a 4-ticker basket using a Kelly-fraction calculation.

**Algorithms/formulas found:**
- `p = N(d2)` (Black-Scholes risk-neutral probability the option finishes
  ITM), computed via the standard `d2 = (ln(S/K) + (r - sigma^2/2)*T) /
  (sigma*sqrt(T))`.
- `b = (S-K)/premium - 1` (a rough approximation of the payoff-to-cost
  ratio if the underlying reaches the current spot price by expiry —
  NOT a modeled expected payoff distribution).
- Kelly fraction: `f* = max(0, (p*b - q) / b)` where `q = 1-p`.
- Sizing: `contracts = floor(f* * bankroll / (premium * 100))`, with an
  explicit floor of 1 contract whenever `f* > 0` (never scales below one
  contract once Kelly says "trade").

**Architecture patterns found:** none of note — a single, linear
notebook script with no reusable module structure.

**Strategy logic found:** buy one ATM LEAP call per ticker; exit/roll
rules given only as prose in a markdown cell (delta ≥ 0.75 or value ≥ 3x
cost → trim half; price -10% and delta < 0.20 → close; 365 DTE → roll up
a strike) — never implemented in code, purely documentation.

**Risk logic found:** none beyond the Kelly fraction itself — no
portfolio-level cap, no correlation check across the 4 tickers, no
drawdown control.

**Execution logic found:** none (this fetches the current chain via
`yfinance` and prints a sizing table; it never places an order).

**Backtesting logic found:** none.

**Useful tests/invariants:** none — no `tests/` directory, no assertions
beyond input-shape checks (`assert len(tickers)==4`).

**Assumptions:** `p = N(d2)` (a risk-neutral probability derived from
current IV) is treated as if it were the option's real-world win
probability. `b` is a single-point approximation, not derived from any
actual expected-return distribution.

**Weaknesses (significant — flagged explicitly for the gap matrix):**
1. **This is precisely the STAT-001 mistake THETA's own CLAUDE.md
   explicitly forbids**: "delta is not probability of profit... never
   claim WR from calibrated model confidence." Using `N(d2)` as if it
   were a real win probability conflates a risk-neutral pricing quantity
   with a real-world outcome probability — the exact anti-pattern this
   codebase's non-negotiable rules exist to prevent.
2. **Raw, un-fractional Kelly** (`fraction=1.0` implicit — no fractional
   discount applied anywhere in the notebook) is exactly what THETA's own
   standing instruction says to never deploy ("never deploy raw
   full-Kelly sizing"). Full Kelly is well known in the literature to be
   extremely volatile under any model misspecification, which is
   guaranteed here since `p` isn't even a real win probability to begin
   with.
3. No transaction costs, no slippage, no assignment/early-exercise
   handling for the "LEAP call" (American-style options can be exercised
   early against dividends).
4. Single ATM strike only — no comparison across a candidate frontier
   (exactly the "one arbitrary score" anti-pattern THETA's own
   `covered_call_ranker.py`/Pareto-frontier work already avoids).

**Look-ahead risk:** N/A (not a backtest — fetches live data at run
time).

**Survivorship-bias risk:** N/A.

**Execution-model weaknesses:** no execution model exists at all;
notebook only prints a sizing table.

**Licensing restrictions:** MIT — no restriction on studying the
formula.

**Relevant to THETA:** directly relevant as a **negative example** for
the position-sizing / Kelly section of the Gap Matrix and as concrete,
citable evidence for why THETA's `management_action_value.py`/AEGIS
sizing discipline (never a raw win-rate-derived Kelly stake, always a
fractional/AEGIS-bounded sizing) is the correct call, not merely a
cautious preference.

**Existing THETA equivalent:** `bots/theta/quant/models/sizing.py` (via
`sizing_contract.py`) already uses risk-budget/collateral/concentration
qty caps, never a raw Kelly formula — no change needed as a result of
this inspection, but this repo is now citable evidence for *why*.

**Better than current THETA implementation:** **NO.** THETA's existing
sizing discipline (caps, never delta-as-probability, no raw Kelly) is
already more conservative and more correct than this reference.

**Recommended action:** `REJECT` (as a sizing method to adopt).
`REFERENCE_ONLY` (as a documented negative example / cautionary citation
in the Gap Matrix and in any future PR that proposes adding Kelly-based
sizing to THETA — it should cite exactly why this repo's approach must
not be copied).

**Integration status:** NOT INTEGRATED (correctly, by design).

---

## HasibVortex369/riskkit

**URL:** https://github.com/HasibVortex369/riskkit
**Commit SHA inspected:** `99d1d167dc55c8a564526ef42d87e298f3e74fad`
**Last inspected:** 2026-09-11
**License:** MIT
**Category:** Position sizing / risk (Claude-led)
**Relevant files:** `src/riskkit/sizing.py`, `src/riskkit/drawdown.py` (listed, not yet read), `src/riskkit/correlation.py` (listed, not yet read), `tests/test_sizing.py` (listed, not yet read)

**What problem it solves:** Framework-agnostic position sizing: a
volatility-adjusted fixed-fractional sizer with an optional half-Kelly
ceiling and a loss/drawdown reduction ladder, plus standalone composable
helpers (`kelly_fraction`, `volatility_target_size`,
`inverse_vol_weights`).

**Algorithms/formulas found:**
- `kelly_fraction(win_rate, avg_win, avg_loss, fraction=1.0)`:
  `kelly = win_rate - (1-win_rate)/(avg_win/avg_loss)`, returned as
  `max(0, kelly * fraction)` — explicitly documents that callers should
  pass `fraction=0.5` for "the common, less-aggressive half-Kelly," and
  the `PositionSizer` class itself always calls it with `fraction=0.5`
  internally (never raw full-Kelly) whenever `win_rate`/`avg_win`/
  `avg_loss` are all supplied.
- Volatility-scaled base risk: `vol_adjusted_risk = base_risk / clip(atr
  / atr_baseline, 0.2, 5.0)` (risk shrinks when current ATR exceeds its
  baseline).
- A reduction-multiplier ladder combining consecutive-loss count,
  drawdown %, daily-loss %, and a "confluence score" into one audited
  multiplier dict (`multipliers_applied`) — every adjustment that fired
  is named and retained on the result, not just the final number.
- Absolute notional cap: position notional can never exceed
  `max_notional_pct` of equity regardless of what the risk math alone
  would produce; if the cap binds, `risk_pct` is recomputed backward from
  the capped `units` so the reported risk percentage stays internally
  consistent (never silently wrong after capping).
- `SizingResult.reason_for_zero` — an explicit, named reason whenever
  `units == 0` (e.g. "risk 0.180% below floor"), never a bare zero with
  no explanation.

**Architecture patterns found:** pure dataclasses in/out
(`SizingInputs`/`SizingResult`), zero framework dependency at the core,
with separate adapter modules (`adapters/backtesting.py`,
`adapters/freqtrade.py`, `adapters/vectorbt.py`) bridging to specific
backtest/live frameworks — a clean "policy core, thin adapters" split.

**Strategy logic found:** none (sizing only, strategy-agnostic by
design).

**Risk logic found:** see formulas above — this whole module IS the risk
logic.

**Execution logic found:** none.

**Backtesting logic found:** none directly, but the `adapters/
backtesting.py` file (not yet read this pass) bridges to the
`backtesting.py` Python library.

**Useful tests/invariants:** `tests/test_sizing.py`,
`tests/test_properties.py` (not yet read this pass — flagged for
follow-up; property-based tests are exactly the kind of edge-case
coverage the directive asks to extract).

**Assumptions:** `win_rate`/`avg_win`/`avg_loss` are assumed to be
already-calibrated, already-known historical statistics supplied by the
caller — this module does not itself estimate them from a return series,
so it cannot silently fabricate an edge (a good property, but it means
any THETA use of this pattern still needs its own calibration pipeline,
which does not exist yet — see the standing "no calibrated entry-outcome
model yet" gap already documented across `management_action_value.py`
and `theta_q_baseline.py`).

**Weaknesses:** the "confluence score" reduction/boost multipliers
(0.75x / 1.5x thresholds at specific integer score bands) read as
arbitrary, un-cited constants — presented without any backtest or
empirical justification in the file itself (a real weakness, explicitly
flagged rather than silently adopted).

**Look-ahead risk:** none identified (pure sizing function, no time-
series traversal).

**Survivorship-bias risk:** N/A.

**Execution-model weaknesses:** N/A (no execution model in this module).

**Licensing restrictions:** MIT — safe to study and independently
reimplement.

**Relevant to THETA:** directly relevant to the position-sizing / Kelly
row of the Gap Matrix, and a positive counter-example to
`ksanjay/Kelly-Criterion-Option-Selector` above — this is what a
correctly-fractionalized, auditable, floor-respecting sizer looks like.

**Existing THETA equivalent:** `sizing.py`/`sizing_contract.py`
(risk-budget/collateral/concentration qty caps, `SizingResult`-style
reason codes already exist via `ReasonCode`). THETA's existing
`reasons` list on every valuation (across `management_action_value.py`,
`covered_call_ranker.py`, etc.) already achieves the same
"every adjustment is named and auditable" property riskkit's
`multipliers_applied` dict achieves — independently arrived at, not
copied, and already just as rigorous.

**Better than current THETA implementation:** **PARTIAL.** riskkit's
absolute notional cap with backward-consistent `risk_pct` recomputation
after capping is a specific, concrete pattern THETA's own sizing model
should be checked against (confirm THETA's `sizing.py` similarly keeps
reported risk% consistent after any cap binds — not yet verified this
pass, flagged as a validation task in the Gap Matrix). The half-Kelly
convention (never full Kelly) matches THETA's own standing instruction
already.

**Recommended action:** `TEST_ONLY` for the notional-cap-consistency
pattern (write a THETA test confirming the same invariant holds in
`sizing.py`, rather than importing riskkit itself). `REFERENCE_ONLY` for
the rest (confluence-score ladder is not empirically justified enough to
adopt as-is).

**Integration status:** NOT INTEGRATED. Recorded as a verification task
in the Gap Matrix, not yet executed.

---

## goldspanlabs/optopsy

**URL:** https://github.com/goldspanlabs/optopsy
**Commit SHA inspected:** `40bb8b2aa07ef8763caeadf752961faecb494efd`
**Last inspected:** 2026-09-11
**License:** AGPL-3.0 (**strong copyleft — see the licensing note in
`THETA_GITHUB_TOP15.md`; architecture/method study only, never source
copying**)
**Category:** Backtesting (Claude-led)
**Relevant files:** `optopsy/core.py`, `optopsy/pricing.py`, `optopsy/checks.py` (listed, not yet read), `optopsy/evaluation.py` (listed, not yet read), `optopsy/calendar.py` (listed, not yet read)

**What problem it solves:** A pandas/vectorized options-strategy
backtesting library: single- and multi-leg (including calendar/diagonal)
strategy construction, entry/exit matching, fill-price/slippage
modeling, and grouped performance statistics (win rate, profit factor).

**Algorithms/formulas found:**
- Four named slippage models in `_calculate_fill_price`:
  - `"mid"` — fill at the midpoint, no slippage.
  - `"spread"` — fill at the full half-spread against the trader (worst
    realistic case for a market/marketable-limit fill).
  - `"liquidity"` — fill ratio scales with a `liquidity_score = clip(volume
    / reference_volume, 0, 1)`: illiquid contracts (`volume` far below
    `reference_volume`) get pushed toward the full half-spread, liquid
    ones toward the base `fill_ratio`.
  - `"per_leg"` — an additive slippage penalty per additional leg in a
    multi-leg strategy (`fill_ratio + per_leg_slippage * (num_legs-1)`,
    capped at 1.0) — explicitly modeling that a 4-leg iron condor fills
    worse than a 1-leg CSP.
- Multi-leg join: each leg's DataFrame is suffixed (`_leg1`, `_leg2`, ...)
  and inner-joined on shared keys (date, expiration, etc.), so a
  multi-leg strategy's P&L is a single vectorized row operation, not a
  per-trade Python loop.

**Architecture patterns found:** pipeline stages explicitly named in the
module docstring (validation → evaluation → strategy construction →
output formatting), with calendar/diagonal spreads routed through a
parallel path rather than forced through the same join logic as
same-expiration multi-leg strategies (an honest acknowledgment that
different-expiration legs need genuinely different exit-price matching).

**Strategy logic found:** none reviewed this pass beyond the generic
multi-leg join mechanism (strategy-specific construction lives in
`docs/strategies/*.md` + presumably a `filters.py`/`checks.py` — not yet
read).

**Risk logic found:** none reviewed this pass.

**Execution logic found:** the four slippage models above ARE its
execution-cost model — no live broker interaction (this is backtest-only,
as expected for its category).

**Backtesting logic found:** the entire module is the backtesting
engine; see architecture/algorithms above.

**Useful tests/invariants:** not yet read this pass (`tests/` not
enumerated) — flagged as a follow-up, since the directive specifically
calls out edge-case tests as often the most valuable extraction.

**Assumptions:** `reference_volume` (a fixed threshold, default from the
caller) is treated as "fully liquid" — a single global threshold rather
than a per-underlying-appropriate one.

**Weaknesses:** commission handling not yet reviewed this pass. No
explicit mention (in the files read so far) of assignment/early-exercise
handling for American-style options, nor of corporate actions.

**Look-ahead risk:** not yet assessed this pass — a genuine backtesting
library's entry/exit matching logic needs a dedicated look-ahead review
before any of its methodology is trusted; flagged as a required follow-up
before this repo's engine informs THETA's own R6 backtest architecture.

**Survivorship-bias risk:** depends entirely on the historical
option-chain data source the caller supplies — not addressed by the
library itself (an honest data-provider concern, not a library defect).

**Execution-model weaknesses:** the four slippage models are simple,
parametric approximations, not modeled from real fill-rate data — a
reasonable, explicitly-named simplification, not a hidden one.

**Licensing restrictions:** AGPL-3.0 — **method/architecture study only,
never source reuse**, per the Top-15 doc's licensing note.

**Relevant to THETA:** directly informs the future backtesting/R6
architecture row of the Gap Matrix (THETA has no backtesting engine
today).

**Existing THETA equivalent:** none — R6 (backtesting/OOS) is explicitly
future work per `docs/PHASED_PLAN.md`.

**Better than current THETA implementation:** N/A (no current THETA
implementation).

**Recommended action:** `ADOPT_METHOD` (the four-named-slippage-model
pattern and the "calendar spreads need a separate matching path" lesson
are both worth independently reimplementing when R6 begins), never
`ADOPT`/copy-source given the AGPL-3.0 license.

**Integration status:** NOT INTEGRATED (R6 has not started).

---

## lambdaclass/options_portfolio_backtester

**URL:** https://github.com/lambdaclass/options_portfolio_backtester
**Commit SHA inspected:** `e53ef86928777de6ee0721424762ea3dc133f993`
**Last inspected:** 2026-09-11 (updated same day with a follow-up read of `engine/engine.py` and `convexity/scoring.py`, per the R6 priority directive)
**License:** MIT
**Category:** Backtesting (Claude-led)
**Relevant files:** `options_portfolio_backtester/core/types.py`, `engine/engine.py`, `convexity/scoring.py` (all now read); `analytics/`, `execution/` directories still not file-read

**What problem it solves:** A portfolio-level (not single-strategy)
options + equity backtester, with a dedicated "convexity" module for
tail-risk-hedge analysis (per its README description and
`docs/SPITZNAGEL_RECONSTRUCTION.md`, not yet read this pass).

**Algorithms/formulas found:** `convexity/scoring.py`'s
`compute_convexity_scores` computes a daily `convexity_ratio` for deep-OTM
put positions (tail-hedge candidates) via a Rust extension
(`_ob_rust.compute_daily_scores`), taking strike/bid/ask/delta/
underlying/DTE/IV plus `target_delta`/`dte_min`/`dte_max`/`tail_drop`
policy parameters, returning `annual_cost`/`tail_payoff` alongside the
ratio — a genuine tail-hedge-overlay scoring formula, structurally the
OPPOSITE strategy family from THETA's premium-selling wheel (buying deep
OTM puts as insurance vs. selling premium), so not directly reusable, but
confirms tail-risk/convexity scoring at scale is a solved subproblem.

**Architecture patterns found:** `core/types.py`'s enum-with-`__invert__`
pattern (already recorded). `engine/engine.py`'s `BacktestEngine` composes
independently-swappable data providers, `Strategy`/`StrategyLeg`,
`TransactionCostModel`/`FillModel`/`PositionSizer`/`SignalSelector`
(execution), `Portfolio`, `RiskManager`, and analytics — a clean
composition-over-inheritance architecture (explicitly stated in its own
docstring as replacing "the monolithic Backtest class"). Defines
`HedgeFillWarning`: an explicit, named warning fired when a strategy's
assumed strike/DTE band matched no tradeable contract in a historical
era (its own example: deep-OTM SPX puts before ~2003) — the module's own
documentation is explicit that silently proceeding here would turn an
"overlay" backtest into misleading partial buy-and-hold. This is a
directly citable, concrete pattern for THETA's own
`universe-discovery.ts` point-in-time-optionability discipline: an
equivalent named warning/reason-code (e.g.
`HISTORICAL_CHAIN_BAND_UNAVAILABLE`) should exist once THETA has a real
historical chain-replay path, so a backtest never silently degrades into
a different, misleading strategy shape without saying so.

**Strategy logic found:** not yet reviewed beyond the engine's
composition shape (`Strategy`/`StrategyLeg` themselves not yet read).

**Risk logic found:** the convexity/tail-hedge scoring above; portfolio-
level `RiskManager` composition confirmed to exist but its internal
constraint logic not yet read.

**Execution logic found:** `TransactionCostModel`/`FillModel` are named,
swappable interfaces (`NoCosts`/`MarketAtBidAsk` cited as concrete
implementations in `engine.py`'s imports) — concrete class names
confirmed, internals not yet read.

**Backtesting logic found:** `engine/engine.py`'s `BacktestEngine`,
composing the pieces above; a dedicated `clock.py` (not yet read)
suggests explicit backtest/live time-stepping, distinct from optopsy's
one-shot vectorized-DataFrame approach.

**Useful tests/invariants:** not yet reviewed this pass (test suite not
enumerated).

**Assumptions:** `HedgeFillWarning`'s own docstring names its central
assumption explicitly: a fixed strike/DTE band request assumes the
historical chain actually had matching contracts every rebalance period,
which is false for many real historical eras (its own cited example:
deep-OTM SPX puts pre-2003) — the library surfaces this as a warning +
`option_fill_rate` diagnostic rather than silently interpolating or
skipping.

**Weaknesses:** the convexity-scoring module depends on a compiled Rust
extension (`_ob_rust`) not inspectable via the GitHub API content-read
path used this session — its internal numerical behavior is therefore
NOT independently verified by this ledger entry, only its documented
inputs/outputs.

**Look-ahead risk:** not fully assessed — `engine.py`'s composition
confirms a clock-driven, not vectorized-whole-history-at-once, design,
which is structurally more resistant to look-ahead than a naive vectorized
join, but the actual time-stepping logic in `clock.py`/`pipeline.py` was
not read this pass to confirm.

**Survivorship-bias risk:** depends entirely on the historical data
source supplied by the caller (`HistoricalOptionsData`/`TiingoData`),
same as noted for optopsy.

**Execution-model weaknesses:** not yet assessed (`FillModel`/
`TransactionCostModel` internals not yet read).

**Licensing restrictions:** MIT — safe to study and independently
reimplement.

**Relevant to THETA:** high relevance to R6's future backtest engine
architecture (composition pattern, `HedgeFillWarning`'s point-in-time-
availability discipline) — see `docs/research/THETA_WALK_FORWARD_SPEC.md`
§5 and `docs/research/THETA_EV_MODEL_SPEC.md` §3, both written this
session citing this repo directly.

**Existing THETA equivalent:** none (R6 not started) — THETA's own
contract/orchestrator separation (Python model / TS contract / TS
orchestrator, used throughout `bots/theta/quant/runtime/` and
`src/theta/`) is architecturally analogous in spirit to this engine's
composition-over-inheritance approach, independently arrived at.

**Better than current THETA implementation:** N/A (R6 doesn't exist yet
to compare against; the composition pattern itself is worth adopting
when it does).

**Recommended action:** `ADOPT_METHOD` for the `BacktestEngine`
composition shape and the `HedgeFillWarning` discipline (architecture
only, MIT license permits closer study but THETA should still
independently reimplement rather than depend on this package directly,
consistent with the "no new dependency without a documented missing
capability" rule). `REFERENCE_ONLY` for the convexity/tail-hedge scoring
(different strategy family, not directly applicable to THETA's premium-
selling design today).

**Integration status:** NOT INTEGRATED. `analytics/`, `execution/`
internals, `Strategy`/`StrategyLeg`, and `clock.py`/`pipeline.py` remain
flagged for further follow-up if R6 architecture work begins.

---

## alpacahq/options-wheel

**URL:** https://github.com/alpacahq/options-wheel
**Commit SHA inspected:** `3698429289065ceb0c13ffcdc31a966c576779ad`
**Last inspected:** 2026-09-11
**License:** Apache-2.0
**Category:** Execution / Wheel / Alpaca (Codex-led; Claude cross-referenced the candidate-scoring logic only, which is a quant/ranking concern)
**Relevant files:** `core/strategy.py` (fully read); `core/execution.py`, `core/state_manager.py`, `core/broker_client.py`, `models/contract.py` listed but not yet read this pass

**What problem it solves:** A runnable Alpaca options-wheel algo
template: filters underlyings by buying power, filters put candidates by
delta/yield/open-interest bands, scores and ranks them, and (in files
not yet read this pass) presumably executes and tracks wheel state.

**Algorithms/formulas found:**
- Candidate filter: `DELTA_MIN < |delta| < DELTA_MAX`, and an annualized
  yield band `YIELD_MIN < (bid/strike) * (365/(dte+1)) < YIELD_MAX`, plus
  a minimum open-interest floor.
- Candidate score: `score = (1 - |delta|) * (250 / (dte+5)) * (bid /
  strike)` — a single scalar combining "probability-of-OTM proxy"
  (`1-|delta|`), an annualization-style time factor, and yield.
- Selection: highest score per underlying, then top-N across underlyings
  by that same single score.

**Architecture patterns found:** small, focused, pure functions
(`filter_underlying`/`filter_options`/`score_options`/`select_options`)
each doing exactly one pipeline stage — a reasonable decomposition
pattern independent of the scoring formula's own merits.

**Strategy logic found:** the classic CSP-selling wheel entry filter
above; exit/roll/assignment logic lives in files not yet read this pass
(`core/execution.py`, `core/state_manager.py`).

**Risk logic found:** none beyond the delta/yield/OI bands above — no
portfolio-level concentration, no tail-risk, no capital-day accounting.

**Execution logic found:** `core/broker_client.py`/`core/execution.py`
not yet read this pass.

**Backtesting logic found:** `reports/options-wheel-strategy-test.pdf`
exists (a static report, not runnable backtest code) — not opened this
pass.

**Useful tests/invariants:** no `tests/` directory found in the top-level
tree listing.

**Assumptions:** `1 - |delta|` is used as a stand-in for "probability the
option expires OTM" — this treats delta as if it were a real-world
probability, the same STAT-001-category conflation flagged in the Kelly
repo above, though here it is used only as a RANKING heuristic (relative
ordering) rather than a claimed win-rate — a materially less severe
version of the same mistake, but still an instance of it.

**Weaknesses (flagged explicitly for the Gap Matrix):**
1. **Single opaque weighted score** combining three genuinely different
   economic dimensions (probability-of-OTM proxy, time decay, yield)
   into one scalar — exactly the "one arbitrary weighted score" anti-
   pattern the Full-H directive explicitly warns against, and exactly
   what THETA's own `covered_call_ranker.py` docstring already calls out
   by name ("never selects by max yield alone... what makes it
   structurally different from BC-1's naive max-yield policy").
2. No tail-risk, no capital-days, no assignment-economics, no execution-
   cost term anywhere in the scoring formula — a candidate with a wide
   spread or high assignment probability scores identically to one
   without, as long as delta/yield/DTE match.
3. `1-|delta|` reused as a probability-like weight compounds the "delta
   is not probability" conflation into the ranking itself, even though
   it's not asserted as a literal win rate.

**Look-ahead risk:** N/A (not a backtest in the files reviewed).

**Survivorship-bias risk:** N/A.

**Execution-model weaknesses:** not yet assessed (execution.py not read
this pass).

**Licensing restrictions:** Apache-2.0 — permissive; safe to study
closely, including source structure, with attribution if code were ever
reused (none reused here).

**Relevant to THETA:** directly relevant as a **concrete, real-world
confirmation that THETA's existing multi-dimension Pareto-frontier
approach (`pareto_frontier.py`, this session's own Full-H cross-symbol
frontier) is already a materially more rigorous design** than a popular
reference implementation's single-score ranking.

**Existing THETA equivalent:** `covered_call_ranker.py` (opening CC
decision) and the full Pareto-frontier/cross-symbol-economic-frontier
stack (item H) already avoid single-score ranking entirely.

**Better than current THETA implementation:** **NO.** THETA's Pareto-
dominance, multi-dimension approach is already strictly more rigorous
than this reference's single weighted score. This finding is recorded as
positive validating evidence for THETA's existing design choice, not a
gap to close.

**Recommended action:** `REJECT` (the scoring formula, as a method to
adopt). `REFERENCE_ONLY` (the pipeline-stage decomposition pattern is
fine and unremarkable; the wheel state-machine/execution files are
Codex's category to inspect further, not re-inspected here).

**Integration status:** NOT INTEGRATED (correctly — THETA's existing
approach is already better on this specific dimension).

---

## Repositories identified and ranked but NOT yet file-level inspected

Per the directive's instruction to select 15 and deeply inspect those
before expanding further, the remaining Top-15 entries
(`thedhruvhegde/ivsurf` beyond its `black_scholes.py` file,
`NavnoorBawa/Options-Flow-Predictor`, `milgar7969/alpaca-options-
framework`, `Ja-Ta/optionstrader`, `joncovington/MEICAgent`,
`puneet-chandna/0DTE-dealer-gamma`, `zrack/gex-terminal`,
`BitraAI/gex_app`, `AdamNaghs/Options-Spread-Conviction-Engine`) have
been identified, verified to exist, licensed-checked at the metadata
level (see `THETA_GITHUB_TOP15.md`'s table), but not yet given a full
ledger entry with extracted formulas/logic. This is recorded honestly
rather than padded with unsubstantiated entries — each will get a full
entry in a follow-up pass, prioritized by the Gap Matrix's own
"validation required" column.

### thedhruvhegde/ivsurf (partial — one file read)

**Commit SHA inspected:** `c20072a8f6c09146697bdb55dca566567d7b0535`
**File read:** `core/black_scholes.py` only.
**What was found:** a vectorized (numpy-based) Black-Scholes
pricer/Greeks module with explicit input validation
(`BlackScholesError` for non-positive S/K/sigma, a warning for `|r| >
100%`) and a T=0 guard (`sqrt(max(T, 1e-10))`) to avoid division by
zero at expiration — a genuinely useful, concrete edge-case pattern
(handling T→0 without crashing) worth confirming THETA's own Greeks
consumption path handles identically. Full Greeks/IV-solver files
(`greeks.py`, `advanced_interpolation.py`, `surface_model.py`,
`heston.py`, `jump_models.py`) not yet read.
**Recommended action:** `TEST_ONLY` — add a THETA test confirming
Optionomics-sourced Greeks/IV never divide-by-zero or crash at DTE=0
(no adoption of ivsurf's own code needed; THETA does not compute
Greeks itself, per its own architecture, Optionomics does).
**Integration status:** NOT INTEGRATED.
