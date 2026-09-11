# THETA Options-Flow Method Comparison (R6D)

Compares methodology (not feature-name accumulation) across the three flow-
adjacent sources reviewed this phase. `LuxAlgo/whale-options` is not in the
approved research corpus and was not read (no evidence it was previously
approved; not added speculatively).

| Method | Source / SHA | License | Intent inference | Aggressor inference | Opening/closing inference | Multi-leg handling | Temporal aggregation | Leakage risk | Provider requirement | THETA suitability | Action |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Print-level unusual-activity ranking (sweep/opening/aggressiveness/composite score) | `FRIEND_OPTION_FLOW_BOT_2026` (owner description, not a read source file -- see `FRIEND_OPTION_FLOW_BOT_AUDIT.md`) | N/A (private) | Per-print classification (unusual_score, sweep, aggressiveness) | Ask-side/bid-side inferred per print | `size > OI` heuristic, no closing-trade exclusion described | Not handled -- no described mechanism to detect or exclude spread/hedge legs | 5-minute rolling net-flow confirmation window | **Elevated** -- `highest_return`/`current_return` historical-follow-through field has unresolved point-in-time semantics (§2A of the audit); fail-open confirmation is a separate non-statistical but equally serious defect | Real-time print-level options tape (not confirmed Optionomics/Alpaca-compatible) | Individual sub-features `TEST_ONLY` after the ablation ladder below; the historical-follow-through mechanism itself `REJECT`ed until PIT semantics are confirmed | `TEST_ONLY` (partial) / `REJECT` (historical-follow-through component) |
| Aggregate put/call-ratio + unusual-volume + ML ensemble forecast | `NavnoorBawa/Options-Flow-Predictor`, commit `da83ec361c1cb7494a0b1b96dbca8edc4a09e788`, `Options Flow Predictor.ipynb` | Repo license not verified this pass (single-notebook repo; treat as unverified until checked before any adoption) | None at the print level -- operates on AGGREGATE daily put/call volume and OI ratios, no per-print aggressor/opening classification at all | None -- no bid/ask-side inference anywhere in the notebook (confirmed by keyword search: zero matches for "bid"/"ask"/"aggressor"/"sweep"/"opening"/"closing") | None | Not applicable -- works on aggregated daily volume/OI, not individual trades | Daily bars feeding an RF/XGBoost ensemble forecasting 1/3/5-day forward returns | `detect_unusual_volume`'s own UOA threshold (`volume/OI > 1.25`) and `calculate_putcall_ratios`'s naive sentiment mapping (`pcr_volume < 0.7 -> "bullish"`) are exactly the naive-directional-inference pattern THETA doctrine already rejects (large call volume != bullish, restated in `FRIEND_OPTION_FLOW_BOT_AUDIT.md` §3); `_calculate_targets` computes forward returns from `date_idx` forward within the same array, which is PIT-consistent AS FAR AS THAT ONE FUNCTION SHOWS, but the surrounding feature-assembly functions (`_calculate_options_features`, `_calculate_regime_features`, etc.) were not read this pass and are UNKNOWN for leakage | yfinance (not Alpaca/Optionomics) | The naive PCR-based sentiment classification: `REJECT`. The unusual-volume ratio (UOA > threshold) as a raw feature: `TEST_ONLY`. The RF/XGBoost ensemble architecture itself: `REFERENCE_ONLY` -- a legitimate general ML pattern, but built entirely on yfinance, not point-in-time verified, and its own header claims "40+ basis points daily returns, Sharpe ratios exceeding 2.0" citing unspecified "academic research" -- an unsupported claim per the standing "do not adopt unsupported 70-80%/Sharpe claims" instruction, not adopted here in any form | `TEST_ONLY` (UOA ratio only) / `REJECT` (sentiment mapping, performance claim) |
| Optionomics-native flow fields (as already integrated into THETA today) | THETA's own existing Optionomics contract (`bots/theta/app`, Codex-owned) | N/A -- internal | Whatever Optionomics itself classifies -- not independently re-derived by either external repo above | Whatever Optionomics itself provides | Whatever Optionomics itself provides | Whatever Optionomics itself provides | Whatever Optionomics itself provides | Already subject to THETA's existing point-in-time join discipline | Already the approved provider | N/A -- this is THETA's existing Production input, the baseline both external methods are compared AGAINST, not a new method to classify | `BASELINE` (not itself an external-research finding) |

## Method comparison, not feature accumulation

The two external sources represent genuinely DIFFERENT methodological
families, not two flavors of the same idea:

1. **Print-level, event-driven, real-time ranking** (friend bot): reacts to
   individual prints, requires low-latency tape access, and its core
   epistemic risk is per-print INTENT MISCLASSIFICATION (was this opening or
   closing, aggressive or passive, hedge or speculation).
2. **Aggregate, daily-bar, supervised-ML forecasting** (Options-Flow-
   Predictor): reacts to daily aggregate put/call and volume/OI statistics
   fed into a trained classifier/regressor, and its core epistemic risk is
   FEATURE-LEVEL OVERSIMPLIFICATION (treating a raw PCR threshold as a
   sentiment label) plus unverified performance claims baked into the
   notebook's own header.

THETA should not adopt either method wholesale. If FLOW is ever built, it
should draw the print-level PROBLEM AWARENESS (aggressor/opening ambiguity,
the leakage risks named in the friend-bot audit) while explicitly avoiding
the aggregate-PCR-as-sentiment oversimplification the second repo
demonstrates is a real, common failure mode -- these are two independent,
corroborating negative examples of the same underlying doctrine THETA
already holds (`FLOW = contextual feature family, not standalone trade
command`).

## Flow ablation ladder (research plan, not yet run -- no real data exists)

A controlled ladder over `BASELINE_THETA` (whatever THETA's already-validated
non-flow feature set produces), adding ONE increment at a time, each
evaluated via `ablation.py`'s `classify_ablation_result` with a pre-declared
`meaningful_effect_size` and `min_independent_n` (never a hardcoded default):

```
BASELINE_THETA
  + unusual/UOA-style activity ratio
  + premium/size magnitude
  + volume/OI ratio
  + sweep classification
  + aggressor-side (ask/bid) inference
  + opening-confidence classification
  + net call/put temporal flow
  + flow persistence (multi-window confirmation)
```

Each increment is its own `AblationRecord` (`experiment_id`,
`feature_family_added=FeatureFamily.FLOW`, `feature_set` naming the exact
sub-feature(s) added at that step) -- never all eight added simultaneously
and the aggregate improvement attributed to "flow" as a whole. A feature
found `NEUTRAL`/`DEGRADES`/`INCONCLUSIVE` at its own rung does not
automatically block a LATER rung (e.g. sweep classification might add
nothing alone but interact usefully with aggressor-side inference) -- but
each rung's OWN incremental claim must be tested on its own terms, per the
standing "reject theoretically-sensible-but-zero-value features" instruction.

## What flow may or may not help (research questions, not answered)

Flow's candidate incremental value must be tested SEPARATELY against each of:
candidate ranking, `EV_net`, `ReturnPerCapitalDay`, severe-loss avoidance,
assignment quality, drawdown, Expected Shortfall, calibration, regime
selection, and management timing. A feature that helps ranking quality but
adds nothing (or hurts) tail-risk/ES is a real, reportable, asymmetric
result -- never averaged away into one "flow works" or "flow doesn't work"
verdict.
