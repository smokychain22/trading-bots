# THETA GEX Definition Matrix (R6B)

**Status: RESEARCH_ONLY.** GEX is not wired into THETA's executable feature set.
This document exists to prevent the single most common GEX mistake: assuming every
public "gamma exposure" / "zero gamma" / "gamma flip" calculator computes the same
quantity because it uses the same name. It does not. Six repositories were read at
the source-file level; five had extractable GEX logic (`BitraAI/gex_app` did not —
see below). **No two of the five compute "zero gamma" the same way**, and even
within one repo (`zrack/gex-terminal`) the author explicitly ships two differently
named methods rather than conflating them.

If/when GEX is ever promoted past research, THETA must pick ONE definition per term,
name it explicitly (not "gamma flip" generically), and never let a chart/report
silently mix values computed by different methods.

## Per-strike GEX formula: broadly convergent

All five repos with extractable logic use the same dollar-gamma-per-1%-move formula,
modulo naming:

```
GEX_strike = sign * OI * multiplier * Γ(spot, strike, T, iv, r) * spot^2 * 0.01
sign = +1 for calls, -1 for puts   (an assumed dealer-short-calls/long-puts convention,
                                      NOT an observed fact about real dealer inventory)
```

This is a genuine, converged convention across independently-written repos — the
strongest single finding in this matrix. Where they diverge is what happens next.

## Comparison table

| Repo | Commit SHA (read) | Gamma source | "Zero gamma" / "gamma flip" method | Call wall / put wall method | Notable divergence |
|---|---|---|---|---|---|
| `FlashAlpha-lab/gex-explained` | `a11321d62006311c4a72a68552587485024f2bf2` | Black-Scholes, computed once at current spot | First sign-change crossing of the **raw per-strike** (non-cumulative) GEX profile, scanning strikes low→high | Not separately extracted this phase (prior phase) | Baseline: per-strike, non-cumulative crossing |
| `puneet-chandna/0DTE-dealer-gamma` | `8da6fa67328b4aa34956c033f0b7cbb74431501d` | Black-Scholes, computed once at current spot | Zero crossing of the **cumulative sum** (`np.cumsum`) of per-strike GEX, low→high, linear-interpolated between bracketing strikes; explicit `below_range`/`above_range`/`in_range` classification | Not extracted this phase | **Genuinely different quantity from gex-explained**: cumulative-curve crossing vs. per-strike crossing. A profile with several sign flips in the raw series can have only one cumulative crossing (or none) |
| `hedarthy/DealerFlow` | `14c7a0f345116c93b43641893aaa372a4cf19085` | Black-Scholes, computed once at current spot (also computes VEX/CEX) | **Cumulative** sum low→high, but restricted to a ±25% (default) strike window around spot, with a minimum-fraction-of-windowed-gross-exposure noise threshold to suppress spurious wing crossings, ties broken by nearest-to-spot; returns `0.0` (explicit neutral) if no crossing survives filtering | `argmax` of per-strike GEX (call wall) / `argmin` (most negative, put wall) on the **raw per-strike** grid — not cumulative | A third distinct cumulative-crossing variant (windowed + thresholded), plus the only repo of the five to also model VEX (vanna) and CEX (charm), and the only one with an explicit T→0 fix (floors at 1 hour via seconds-to-close instead of calendar `.days`, to avoid collapsing all 0-2 DTE gamma to the same floor) |
| `zrack/gex-terminal` | `72d68f47a41c2c330351476cef99b48411f9fe3d` | Black-Scholes; quantity-weighted-mean gamma aggregation per strike | Ships **two self-labeled, non-conflated** methods: (1) `zero_gamma_semantics: "legacy_strike_profile"` — adjacent-strike sign-change interpolation on the raw per-strike profile (same family as gex-explained), falling back to nearest-to-zero strike if no crossing exists; (2) a separate `compute_directionalized_gex_matrix` path whose own docstring states the strike-profile crossing "is a crossing of the strike-bucket profile, not the underlying spot where aggregate portfolio gamma reprices to zero" | `argmax(abs(net_gex))` for a single "gamma wall"; separately, `argmax(call_gex)` for call wall and `argmax(abs(put_gex))` for put wall | The only repo that **documents, in its own code, the exact distinction this matrix exists to make** — that a strike-bucket crossing is not the same claim as "the spot price at which portfolio gamma reprices to zero." Also the only repo with a large surrounding harness (adapters, replay corpus, work-packet docs) rather than a single calculation script — read as a GEX-*methodology* source, not adopted as infrastructure |
| `sgdividends/spx-dealer-gamma` | `4b49ede031a17daa2a18c087e7fdb200a0c1d26f` | CBOE-vendor-supplied gamma at current spot for the headline net GEX; **separately recomputes Black-Scholes gamma at a scanned range of hypothetical spot prices** (each contract's own quoted IV/strike/expiry held fixed) to find zero crossings of the repriced curve | **Spot-domain scan**, not strike-domain: steps a hypothetical spot through a ±15% (default) band, recomputing total signed dealer gamma at each hypothetical spot, and finds where that curve crosses zero (interpolated) — genuinely different axis from every other repo above (all of which cross strikes, holding spot fixed) | Top-N strikes ranked by `abs(GEX)` — no separate call/put wall split | A **fourth, structurally distinct** method: repricing gamma across a spot scan rather than reading (or cumulating) a fixed per-strike profile at the current spot. The repo's own docstring flags the assumption this requires: IV/strike/expiry held fixed while spot varies, i.e. no vol-surface skew shift with spot |
| `BitraAI/gex_app` | `b1234c65452581fccf5375cb7488b990423ed79c` | N/A | N/A | N/A | Repository contains no source files — only a single PNG asset (`assets/GEXbyStrike.png`). **REJECT**: nothing to extract; not a real implementation to compare against |

## Precise term definitions (per this matrix — not a THETA decision yet)

- **Raw per-strike GEX**: the dollar-gamma-per-1%-move value at a single strike,
  computed once (no cumulation, no spot scan).
- **Cumulative GEX profile**: the running sum of raw per-strike GEX from the lowest
  strike upward. Its zero-crossing answers "at what strike does the *summed* exposure
  below this point balance the summed exposure above it" — a different question from
  where any single strike's own value crosses zero.
- **Zero gamma (strike-domain)**: a crossing found by walking strikes (raw or
  cumulative) while holding spot fixed at its current, observed value.
- **Zero gamma (spot-domain)**: a crossing found by walking a *hypothetical spot
  price* while holding each contract's own IV/strike/expiry fixed, and asking at
  which hypothetical spot the aggregate portfolio's Black-Scholes gamma reprices to
  zero. This is the only one of the four methods that actually answers "where would
  dealer gamma flip sign if price moved," as opposed to "where does today's
  strike-indexed exposure profile balance."
- **Gamma flip**: used interchangeably with "zero gamma" by four of the five repos;
  `zrack/gex-terminal` is the only one that explicitly warns against this
  interchangeability in its own docstrings.
- **Call wall / put wall**: in every repo that computes them, this is the single
  strike with the largest positive (call wall) or most negative (put wall) *raw*
  per-strike GEX — never a cumulative quantity. This is the one term with reasonable
  cross-repo agreement.
- **Dealer sign assumption**: universal across all five (calls +1, puts -1) — an
  assumed convention, explicitly flagged as an assumption (not an observed fact) in
  `sgdividends/spx-dealer-gamma`'s own docstring, and implicitly assumed elsewhere.

## Classification (GitHub research standard)

All five extractable repos: **REFERENCE_ONLY**. None are `ADOPT_METHOD` or `ADAPT`
this phase — GEX has no THETA feature-family implementation yet, no real historical options-chain data exists
to calibrate or ablate any of these four zero-gamma methods against, and TRD
provider ownership is Alpaca + Optionomics only — none of these repos' data sources
(yfinance, CBOE delayed quotes, Databento, IBKR, Tradovate) are approved THETA
providers. `BitraAI/gex_app`: **REJECT** (no source to evaluate).

If GEX is ever built for THETA: (1) pick exactly one of the four zero-gamma methods
above and name it precisely in code/docs (never "gamma flip" unqualified), (2) run a
pre-registered baseline versus baseline-plus-GEX ablation under the model-promotion
contract before any promotion, (3) never let two dashboard panels compute "zero gamma" by two
different methods and label both just "Zero Gamma."
