# THETA Conditional Edge Hypotheses — Narrative Index

Durability artifact. Every hypothesis in `research/data/hypotheses.json` already states
its own `state` field (Trend/Volatility/Event/Liquidity/Stress conditions under which
it's expected to apply) — this file exists only to make those conditions scannable
across all 14 hypotheses at once, since the JSON's per-entry structure makes
cross-hypothesis regime comparison harder than it needs to be. No new conditional claim
is introduced here.

| Hypothesis | Regime conditioning (from `hypotheses.json`'s `state` field) | Status |
|---|---|---|
| H-Q-01 | Any trend/vol; excludes near-term earnings by branch default; NORMAL liquidity; NORMAL/CORRECTION stress | TEST |
| H-Q-02 | HIGH volatility preferentially selected by the naive filter this hypothesis critiques; any event state (that's the point) | TEST |
| H-H-01 | Range-bound/mild trend preferred (unverified); gap risk dominates regardless of vol level; excludes near-term earnings; tight-spread NORMAL liquidity; NORMAL stress | TEST |
| H-H-02 | Any — measurement discipline, not regime-conditional | RETAIN |
| H-R-01 | Any trend; elevated volatility plausibly favors early close (unverified); NORMAL liquidity needed to close/roll without slippage | TEST |
| H-R-02 | Any trend; low/normal volatility plausibly favors patience (unverified) | TEST |
| H-R-03 | Any — the discipline should hold everywhere, unlike H-R-01/H-R-02's regime-conditional claims | RETAIN |
| H-C-01 | Upside/uptrend or event-catalyst regime matters most for call-away regret; particularly near earnings/ex-div | RETAIN |
| H-C-02 | Underwater relative to assignment basis specifically | RETAIN |
| H-A-01 | Any, conditioned on ownership_acceptability above floor; NORMAL/CORRECTION stress — CRISIS-regime assignment explicitly untested | RETAIN |
| H-A-02 | Any — architectural constraint, not regime-conditional | RETAIN |
| H-A-04 | Underwater relative to assignment basis; any event state (thesis-invalidating events are exactly what a good bound reacts to) | TEST |
| H-A-03 | Any — measurement discipline | RETAIN |
| H-D-01 | Any — gated, not to be evaluated regardless of regime until gating conditions met | TEST (gated) |

## Notable explicit regime gaps (flagged in the source hypotheses, not resolved here)

- **CRISIS-regime assignment** (H-A-01) is explicitly named as untested — this
  repository does not claim assignment-acceptance reasoning transfers into a CRISIS
  stress state, and no hypothesis currently covers that case directly.
- **H-R-01 vs. H-R-02's regime claims are both "(unverified)"** in their own source
  text — elevated-vol-favors-early-close and low-vol-favors-patience are stated as
  plausible mechanisms, not established findings, and only A5 (dynamic management
  ablation) can resolve which (if either) actually holds and in which regime.

## Status

Cross-reference only. `hypotheses.json` remains the single source of truth for the
full field set (mechanism, alternatives, label_type, acceptance/rejection criteria,
etc.) — this file surfaces one field (`state`) across all entries for readability.
