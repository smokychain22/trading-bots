# THETA severe-drawdown label policy research packet, 2026-09-20

Canonical main at time of research: `5e7f12156b3c38c0512b5c7f3b57a8c3b3a0370a`.

## 0. Critical scope limitation — read this first

**This session has no live Alpaca API credentials, no database connection string,
and no cached historical price data anywhere in this repository.** Confirmed by
direct inspection: `.env` does not exist (only `.env.example` with empty
placeholders), no `DATABASE_URL`/`PG*`/`AIVEN`/`ALPACA_*` environment variables
are set, and no `.csv`/historical-bars `.json` fixture exists in the tree.

This means **Sections 4, 7, 9, 10 of the requested research (the empirical
historical drawdown study, dependence/effective-N counts, candidate breach
rates, and temporal-stability analysis) cannot be executed honestly in this
session.** Per the standing rule this very research thread was built on --
"never call synthetic outcomes empirical evidence" -- I am not fabricating
quantiles, breach rates, or effective-N figures and presenting them as
findings. Where those figures would go, this packet says exactly what
computation is needed and hands it to whoever has real Alpaca/DB access
(Codex) to execute.

What this packet DOES deliver, entirely from real, already-existing sources
(no data access required): the governance/context review, the methodological
framework (horizon and threshold candidate narrowing, tied to THETA's actual
DTE lattice), the professional-literature review, a fully-specified candidate
grid ready for someone with data access to fill in and select from, and the
AEGIS policy-status audit. The final verdict is **`NO_POLICY_READY`** for
exactly this reason -- not because the methodology is unclear, but because no
empirical evidence exists yet to select among the candidates.

## 1. Existing governance (read in full before writing anything below)

- `bots/theta/quant/models/severe_drawdown_spec.py` -- canonical, unchanged.
  `SevereDrawdownLabelSpec(spec_version, horizon_days, threshold_family,
  threshold_value)`, `DrawdownThresholdFamily` (`PERCENT_FROM_ENTRY` implemented;
  `PERCENT_FROM_STRIKE`/`MULTIPLE_OF_RV`/`ABSOLUTE_DOLLAR` named but not
  implemented), `clustering_unit` defaults to
  `"underlying_symbol_and_overlapping_window"`. The dataclass docstring is
  explicit that horizon/threshold have **no default by design** (TRD §51:
  risk/research parameters are versioned configuration, never baked in).
- `docs/quant/phase2/PHASE2_MASTER_SPEC.md` §5 confirms: *"Label spec:
  IMPLEMENTED. Fitted predictive model: SPECIFIED, BLOCKED_BY_DATA."* It also
  flags a genuine, already-identified, not-yet-implemented gap: a fourth
  `CORPORATE_ACTION_AMBIGUOUS` status (beyond `BREACHED`/`SURVIVED`/`CENSORED`)
  for split/merger/spinoff cases where breach/survive is genuinely undecidable
  -- this packet adopts that proposal rather than reinventing corporate-action
  handling (directive §8).
- `docs/quant/phase2/MODEL_REGISTRY.md` confirms the same status and lists
  `p_severe_drawdown`'s promotion criteria (calibration by regime/DTE/delta/
  ticker-family cohort, downstream `EV_net` improvement) -- not touched by
  this packet, since this is a label-policy exercise, not model fitting.
- `feature_families.json`: `drawdown` (raw, derived) is marked
  `USABLE_NOW_ALPACA_HISTORICAL`; `p_severe_drawdown` is marked
  `MODEL_OUTPUT_NOT_RAW_FEATURE`. Confirms directive's own framing: the label
  can be built from ordinary historical bars, with no dependency on THETA's
  own Paper trade history.
- `hypotheses.json`/`experiments.json`: `p_severe_drawdown` is required input
  to several existing hypotheses (ownership-quality, IV-rank, recovery,
  capital-days) but **no hypothesis or experiment proposes a specific
  horizon_days or threshold_value** -- confirming this genuinely is an open
  policy gap, not something already decided and merely unwired.
- `bots/theta/quant/research/validation.py`: walk-forward/embargo windows are
  **caller-supplied config with no hidden constants** ("Minimum sample sizes
  are caller policy, never hidden constants in this module") -- this packet's
  candidate clustering approach stays consistent with that discipline: no
  embargo/window length is proposed as a silent default either.
- `src/theta/strategy-package.ts`: confirmed DTE lattices --
  `THETA_CONVENTIONAL` 25-60 DTE, `THETA_HOLD_STRIKE` 2-5 DTE, `THETA_RECOVERY`
  0-3650 DTE (effectively unbounded).

## 2. What the label actually measures (directive §2)

$$
Y_t(D,H) = \mathbb{1}\left[\min_{u \in (t, t+H]} \frac{P_u - P_t}{P_t} \le -D\right]
$$

This is a statement about the **underlying's own price path**, entirely
independent of strike, premium, assignment, or whether THETA held a position.
It is explicitly NOT `P(win)`, `P(profit)`, `P(expire OTM)`, `P(assignment)`,
or `EV` -- conflating any of those with this label would corrupt both the
label itself and every downstream ownership/AEGIS consumer that expects a
pure tail-risk signal.

## 3. Candidate horizons -- justified from THETA's actual exposure lifecycle, not round numbers

The only strategy branch this label currently needs to serve is
`THETA_CONVENTIONAL` (the sole live-executable branch; `severeDrawdownProbability`
feeds `ownership_v0.py`, consumed only by the CSP-selling path). Its lattice
is 25-60 DTE. Candidate horizons are derived from that fact, not chosen for
convenience:

| Horizon | Justification | Rejected reason for the ones not carried forward |
|---|---|---|
| 5 days | Rejected | Directive's own §6 question answers itself: a 5-day horizon would systematically miss the dominant tail risk of a 30-45 DTE CSP -- most of the position's real drawdown exposure window would fall entirely outside the label's observation window. Not carried into the candidate grid. |
| **30 days** | **Carried forward** | Matches the low end of THETA_CONVENTIONAL's DTE range and the median of the 25-60 lattice's lower half; captures the exposure window for a typical near-30-DTE entry through to a natural management/roll point. |
| **45 days** | **Carried forward** | Matches the midpoint of the 25-60 DTE lattice; captures the exposure window for a mid-range entry through to expiration without assuming early close. |
| 60 days | Considered, held as a stretch candidate only | Matches the far end of the lattice, but a full 60-day horizon on a 25-DTE entry would extend ~35 days past that position's own expiration -- i.e. past the point where the *original* entry decision would normally have already been closed, rolled, or assigned. Per directive §6's own second question, this risks including risk the original decision no longer governs. Retained only as a sensitivity check, not a primary candidate. |
| 90 days | Rejected | Same reasoning as 60 days, more severely -- would include an entire subsequent CSP cycle's worth of price action attributed to a decision made at t=0. Not carried into the candidate grid. |

**Fixed calendar horizon vs. DTE-tied horizon**: the current `severe_drawdown_spec.py`
contract takes an explicit `horizon_days` integer -- a DTE-tied horizon (`horizon_days = candidate.dte`)
is conceptually appealing (ties tail-risk exposure exactly to the position's own duration)
but is **not implemented and would require a label-contract change**, which directive
§6 explicitly says not to do during this pass. This packet therefore proposes only fixed
calendar horizons (30, 45 days) for `PAPER_RISK_V1`, and records DTE-tied horizon as a
documented, not-yet-built alternative for a future v2 label-contract discussion.

## 4. Candidate thresholds -- professional reference review (directive §13)

| Source | Definition | Population | Horizon | Applicability to single-stock CSP tail risk | Limitation |
|---|---|---|---|---|---|
| [Cboe S&P 500 Left Tail Volatility Index methodology](https://cdn.cboe.com/api/global/us_indices/governance/Cboe_SnP_500_Left_Tail_Volatility_Index_Methodology.pdf) | Prices the implied cost of a ≥10-standard-deviation index move over one week using deep-OTM SPX puts and an extreme-value distribution. | S&P 500 index | 1 week | Low direct applicability -- this is an *implied, forward-looking, index-level* tail-cost measure, not a realized single-stock drawdown definition. Useful only as a conceptual reminder that "severe" is properly a statistical-extremity concept, not a fixed round number. | Index-level; cannot be applied to single names without a separate idiosyncratic-risk adjustment. |
| Firm-specific crash-risk literature (accounting/finance, e.g. the Chen-Hong-Stein / Hutton lineage cited in current crash-risk surveys) | A firm-week crash event is realized weekly residual return falling below **3.2 standard deviations** of that firm's own mean weekly residual return (a volatility-SCALED, firm-specific definition, not a fixed percentage). | Individual US equities, firm-year panel | 1 week (aggregated to firm-years) | High conceptual relevance -- this is exactly the "standardize by the underlying's own realized volatility" alternative directive §5 asks to examine *for comparison only*. Empirical crash-year incidence in this literature runs roughly **~14%** of firm-years using this definition, per the surveyed studies -- i.e. not a rare-event definition, closer to a "meaningfully bad but not once-a-decade" threshold. | A firm-YEAR incidence rate is not directly comparable to a fixed-horizon (30/45-day) breach rate without re-deriving the analogous multi-week statistic; cited here as a scale/interpretation anchor, not a plug-in number. |
| [Maximum Drawdown at Risk literature (ScienceDirect)](https://www.sciencedirect.com/science/article/abs/pii/S1544612317300156) | Models the distribution of maximum peak-to-trough decline over a horizon as a function of the return distribution's volatility and drift, rather than a single fixed threshold. | Portfolio/strategy return series | Model-parameterized, any horizon | Confirms the standardized (volatility-scaled) family is an actively used professional approach, reinforcing directive §5's instruction to examine `drawdown / prior RV` as a parallel diagnostic even while keeping v1 canonical under `PERCENT_FROM_ENTRY`. | Portfolio-level methodology; adapting it to a single-underlying fixed-horizon label is itself a research project, not something to improvise into v1. |
| [OCC Characteristics and Risks of Standardized Options](https://www.theocc.com/getcontentasset/a151a9ae-d784-4a15-bdeb-23a029f50b70/dfc3d011-8f63-43f6-9ed8-4b444333a1d0/riskstoc.pdf) | Describes assignment-risk mechanics qualitatively (deep-ITM options approach ~100% assignment probability near expiration); does not publish a quantitative decline-probability table. | N/A | N/A | Confirms assignment risk is a separate concept from the underlying-drawdown label (directive §2's own distinction) -- assignment probability is a function of moneyness at expiration, not itself a tail-risk magnitude. Used here only to keep the two concepts explicitly separate, not as a threshold source. | No quantitative threshold to extract. |

**Conclusion for v1**: no professional source provides a directly-transplantable
fixed percentage for a 30-45 day single-stock CSP tail-risk label -- and
directive §13 explicitly warns against pretending an index-level or portfolio-level
definition is automatically appropriate here. The professional literature's
main contribution to this packet is confirming that (a) "severe" should be a
statistical-extremity concept calibrated against the *actual* empirical
distribution (directive §4's own instruction), not a copied round number, and
(b) a volatility-standardized cross-check (≈3.2 sigma-style, or `drawdown /
prior RV`) is a legitimate professional alternative to keep as a parallel
research diagnostic. Candidate fixed thresholds below (10%, 15%, 20%) are
therefore proposed as a **starting empirical-study grid**, not as
literature-derived truth -- their final selection depends entirely on the
Section 5 empirical quantile study this session cannot run.

## 5. Candidate policy grid (directive §9, §14)

Three candidates, each fully specified, each requiring the same empirical
execution before any one can be selected. `?` marks every field that requires
real historical Alpaca bars to compute -- **none of these are filled with a
guess.**

### POLICY_CANDIDATE_A

```
specVersion:        theta-severe-drawdown-label-v1-candidate-a
thresholdFamily:     PERCENT_FROM_ENTRY
horizonDays:         30
thresholdValue:      0.10   (10% adverse move from entry)
clusteringUnit:      underlying_symbol_and_overlapping_window (canonical default, unchanged)
economicInterpretation:
  Ties directly to the low end of THETA_CONVENTIONAL's 25-60 DTE lattice.
  A 10% threshold is a moderate-severity bar -- more inclusive than a crash
  definition, closer to "meaningfully adverse" than "catastrophic."
empiricalBreachRate:        ? (requires Alpaca historical bars, not available this session)
effectiveN:                 ? (requires the same dataset, clustered by underlying+overlapping window)
regimeStability:            ? (requires regime-labeled historical windows)
advantages:          Shortest horizon among the two primary candidates -- best
  temporal resolution, least exposure to unrelated later-cycle risk.
limitations:         A 10% bar may be common enough to be a frequent, low-
  information event for some tickers, or too strict for a genuinely high-
  volatility name -- this is exactly what the empirical quantile study
  (directive §4) would reveal and this session cannot compute.
```

### POLICY_CANDIDATE_B

```
specVersion:        theta-severe-drawdown-label-v1-candidate-b
thresholdFamily:     PERCENT_FROM_ENTRY
horizonDays:         45
thresholdValue:      0.15   (15% adverse move from entry)
clusteringUnit:      underlying_symbol_and_overlapping_window
economicInterpretation:
  Ties to the midpoint of the 25-60 DTE lattice. A 15% threshold sits above
  Candidate A's severity, intended to better separate "ordinary volatility"
  from "genuinely severe" moves for typical optionable large/mid-cap names.
empiricalBreachRate:        ? (requires live data)
effectiveN:                 ? (requires live data)
regimeStability:            ? (requires live data)
advantages:          Horizon matches the DTE lattice's center of mass; a
  15% bar is closer to conventional "correction"-adjacent severity language
  without being tied to a borrowed index-level definition.
limitations:         Longer horizon than Candidate A slightly increases the
  chance of including price action past a typical management/roll point for
  the shorter end of the DTE lattice.
```

### POLICY_CANDIDATE_C (stretch/sensitivity candidate, not primary)

```
specVersion:        theta-severe-drawdown-label-v1-candidate-c
thresholdFamily:     PERCENT_FROM_ENTRY
horizonDays:         60
thresholdValue:      0.20   (20% adverse move from entry)
clusteringUnit:      underlying_symbol_and_overlapping_window
economicInterpretation:
  Ties to the far end of the DTE lattice; a 20% bar approaches conventional
  "bear market" severity language (used here only as a sensitivity anchor,
  explicitly NOT adopted merely because it is a familiar round number).
empiricalBreachRate:        ? (requires live data)
effectiveN:                 ? (requires live data)
regimeStability:            ? (requires live data)
advantages:          Useful as an upper-bound sensitivity check against
  Candidates A/B -- if breach rates are wildly different in shape (not just
  magnitude) across A/B/C, that itself is diagnostic information.
limitations:         As discussed in Section 3, a 60-day horizon on a 25-DTE
  entry extends materially past that entry's own natural resolution window --
  retained only for comparison, not recommended as PAPER_RISK_V1 on its own.
```

### Standardized (volatility-scaled) research-comparison-only diagnostic

Per directive §5, alongside whichever `PERCENT_FROM_ENTRY` candidate is
eventually selected, compute (research-only, never the canonical v1 label):

```
drawdown_at_horizon / prior_realized_volatility_at_entry
```

for the same (horizon, underlying) pairs, to check whether the fixed-percentage
candidates are disproportionately trivial for high-RV names or disproportionately
severe for low-RV names. This diagnostic does NOT change which candidate is
selected for v1 -- it only characterizes how uniform or non-uniform the chosen
fixed threshold's real severity is across the universe.

## 6. What is required before any candidate can be selected (directive §4, §7, §9, §10)

For each of Candidates A, B, and (as a sensitivity check) C, over the currently
tradeable universe and the longest available point-in-time-clean Alpaca daily-bar
history:

1. For every (underlying, decision-date) pair, compute the forward minimum
   cumulative return over each candidate horizon -- **do not** collapse to a
   binary label yet; report the empirical distribution (P50/P75/P90/P95/P97.5/P99
   of the forward adverse move) by horizon and, where regime data is
   PIT-valid, by regime.
2. Apply corporate-action handling: use split/dividend-adjusted bars, and mark
   any window whose corporate-action history is ambiguous as
   `CORPORATE_ACTION_AMBIGUOUS` (adopting `PHASE2_MASTER_SPEC.md` §5's proposed
   fourth status) rather than silently scoring it BREACHED or SURVIVED.
3. Cluster by `underlying_symbol_and_overlapping_window` (the canonical
   default already in `severe_drawdown_spec.py`) and report, separately:
   raw rows, effective/clustered independent groups, distinct underlyings,
   distinct non-overlapping windows. Selection must be judged on the
   clustered/effective count, never the raw row count.
4. Only then collapse to BREACHED/SURVIVED/CENSORED per candidate (H, D) pair
   and report breach rate, survival rate, censored rate, breach rate by
   underlying family, breach rate by regime, temporal stability across at
   least quiet/normal/high-volatility/stress periods where data permits, and
   the maximum concentration of positive events falling inside any single
   crisis window (to catch a definition whose apparent "severe" rate is
   actually driven by one episode).
5. Select among A/B/(C) using the criteria in Section 5 above and directive
   §9's usability bar (not so rare estimation is impossible, not so common
   "severe" loses meaning) -- **entirely independent of THETA's own downstream
   historical trade results**, per directive §12's explicit prohibition on
   outcome-guided policy leakage. There were, in any case, zero resolved
   THETA Paper chains at the time of this packet, so no such leakage was even
   possible to commit accidentally.

## 7. Why this is not model promotion (directive §18)

Selecting `PAPER_RISK_V1`'s `horizon_days`/`threshold_value` only defines WHICH
event `p_severe_drawdown` will eventually predict. It says nothing about
whether that event can be predicted well from point-in-time features. After a
label policy is frozen, Codex still must: materialize the historical dataset,
fit a transparent baseline (logistic regression per the project's stated model
progression -- no GBM/HMM/neural model until a simpler baseline is shown
insufficient), run purged walk-forward validation (`validation.py`'s existing
grouped-by-`economic_chain_id` machinery, or an analogous grouping for this
pre-Paper-history label), calibrate (Brier/log-loss/reliability), validate OOS,
produce a versioned model artifact, get it reviewed, and only then wire it
into `ownership_v0.py`'s `p_severe_drawdown` input. None of that happened in
this packet.

## 8. AEGIS policy status audit (directive §19)

| Policy | Threshold cap defined? | Measurement methodology defined? | Status |
|---|---|---|---|
| Correlation | Yes -- `maxCorrelationClusterPct: 0.3` exists in `theta-shadow-once.ts`'s `aegisPolicy` (a research/shadow config, not yet a canonical Production policy bundle). | No -- no real multi-symbol correlation computation exists anywhere in the codebase; `correlationClusterExposurePct` is only ever the "sole risk group" single-underlying special case (`account-exposure.ts`), never a genuine pairwise/clustered correlation estimate. Lookback window, clustering algorithm, and PIT-alignment rules are all undefined. | **POLICY_MISSING** (cap exists, methodology does not) |
| Sector | Yes -- `maxSectorConcentrationPct: 0.3` exists in the same shadow config. | No -- no sector classification source has been chosen (per the prior review's finding: Alpaca asset metadata is not a reliable taxonomy source, and no licensed/versioned classification dataset has been adopted). | **POLICY_MISSING** |
| IV-shock | No numeric cap exists anywhere for this specifically (it's a boolean gate, `stressIvShockDetected`, not a percentage threshold). | No -- no real historical IV baseline exists; the input remains a caller-supplied placeholder per the prior adversarial review's `aegis-derivation.ts` audit. | **POLICY_MISSING** (and NOT_IMPLEMENTED as a producer) |
| Spread-widening | Same as IV-shock -- boolean gate, no numeric threshold defined. | No -- no real historical option-BBO baseline exists. | **POLICY_MISSING** (and NOT_IMPLEMENTED as a producer) |

None of these four were implemented or altered by this packet, per the
directive's explicit instruction to only identify status, not build.
