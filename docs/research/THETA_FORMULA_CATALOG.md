# THETA Formula Catalog

Formulas actually extracted from the GitHub research corpus this pass,
per `docs/research/GITHUB_REPO_RESEARCH_LEDGER.md`. Each entry names its
exact source (repo + file + commit SHA), states the assumptions/numerical
issues the source itself acknowledges (or that were identified during
review), and maps it to THETA's current implementation status. No
formula here has been adopted into THETA production code without a
corresponding verification test — see the "THETA implementation" /
"Verification test" columns; a blank means not yet done.

---

## Black-Scholes Gamma

**Equation:**
```
gamma = N'(d1) / (S * sigma * sqrt(T))
d1 = (ln(S/K) + (r + sigma^2/2) * T) / (sigma * sqrt(T))
N'(x) = (1/sqrt(2*pi)) * exp(-x^2/2)
```
**Variables:** `S` spot price, `K` strike, `T` time to expiry (years),
`r` annualized risk-free rate (decimal), `sigma` annualized IV (decimal).
**Units:** delta change per $1 move in the underlying, per share.
**Source repository:** `FlashAlpha-lab/gex-explained`
**Source file:** `theory/gamma-exposure.md`, `code/compute_gex.py`
**Source commit:** `a11321d62006311c4a72a68552587485024f2bf2`
**Assumptions:** European exercise (no early-exercise adjustment);
constant `r`/`sigma` over the option's life; log-normal underlying price
process (standard Black-Scholes assumptions).
**Numerical issues:** naive evaluation divides by `sigma * sqrt(T)`,
which is unguarded against `T=0` or `sigma=0` in the theory doc's own
equation (the accompanying `code/compute_gex.py` DOES guard this — see
its `bsm_gamma` returning `0.0` when `T<=0 or sigma<=0`).
**THETA implementation:** none — THETA does not compute Greeks itself
(Optionomics supplies Greeks per the canonical provider architecture).
**Verification test:** N/A (no THETA implementation to test). If GEX is
ever adopted as a research module, a dedicated T=0 guard test would be
required at that time.

---

## Gamma Exposure (GEX), SpotGamma convention

**Equation:**
```
GEX_strike = gamma * OI * 100 * S^2 * 0.01
call_gex   = +GEX_strike
put_gex    = -GEX_strike
Total_GEX  = sum(GEX_strike) across all strikes/types
```
**Variables:** `gamma` per the Black-Scholes gamma formula above, `OI`
open interest at that strike/type, `100` shares-per-contract multiplier,
`S` spot, `0.01` representing a 1% spot move.
**Units:** dollars of delta dealers must rehedge per 1% move in the
underlying, aggregated by strike or summed to a total.
**Source repository:** `FlashAlpha-lab/gex-explained`
**Source file:** `theory/gamma-exposure.md`, `code/compute_gex.py`
**Source commit:** `a11321d62006311c4a72a68552587485024f2bf2`
**Assumptions:** customers are net LONG both calls and puts (so dealers
are net short both, and the sign convention encodes "short call gamma
hedging is stabilizing (+), short put gamma hedging is destabilizing
(-)"); `100` is assumed as the multiplier for every contract (the source
file does not itself apply a contract-derived multiplier — THETA's own
standing rule, reaffirmed this same engagement, is to never silently
assume 100 when contract metadata provides the actual value — this is a
required adaptation, not a direct port, if GEX is ever implemented in
THETA).
**Numerical issues:** none beyond those inherited from the gamma formula
above; the IV input to the gamma calculation is (in this specific repo)
sourced from a "very rough" Brenner-Subrahmanyam approximation, which the
repo's own comments say is unfit for production — a real THETA adaptation
would source IV from Optionomics instead, never reimplement this
approximation.
**THETA implementation:** none.
**Verification test:** N/A (not yet implemented). Per the Gap Matrix,
requires cross-checking against a second independent GEX implementation
before adoption, and an OOS ablation before any router/AEGIS wiring — no
different from Cboe's existing "research-only until ablation" rule.

---

## Gamma Flip Level

**Equation:** the strike (linearly interpolated) where the running net
GEX profile crosses zero:
```
gamma_flip = k1 + (k2 - k1) * (-g1 / (g2 - g1))
  where g1, g2 are net GEX at adjacent sorted strikes k1 < k2, and g1*g2 < 0
```
**Source repository/file/commit:** same as GEX above.
**Assumptions:** exactly one sign crossing exists in the observed strike
range (the algorithm reports the FIRST crossing found while iterating in
strike order — a genuinely bimodal GEX profile with multiple crossings
would only report the lowest-strike one, an acknowledged simplification
inherited from taking "first crossing" literally).
**THETA implementation:** none.
**Verification test:** N/A.

---

## Call Wall / Put Wall

**Equation:** `call_wall = argmax(strike, GEX_strike)`, `put_wall =
argmin(strike, GEX_strike)` — the single strike with the highest (most
positive) / lowest (most negative) net GEX.
**Source repository/file/commit:** same as GEX above.
**Assumptions:** a simple argmax/argmin, not a smoothed peak-detection —
a single noisy strike could dominate the "wall" designation.
**THETA implementation:** none.
**Verification test:** N/A.

---

## Kelly Fraction (fractional, correctly applied)

**Equation:**
```
kelly = win_rate - (1 - win_rate) / (avg_win / avg_loss)
sized_fraction = max(0, kelly * fraction)   # fraction=0.5 for half-Kelly
```
**Variables:** `win_rate` in [0,1] (a REAL, historically-observed win
rate — never a delta or risk-neutral probability), `avg_win`/`avg_loss`
positive magnitudes in the same unit.
**Source repository:** `HasibVortex369/riskkit`
**Source file:** `src/riskkit/sizing.py`
**Source commit:** `99d1d167dc55c8a564526ef42d87e298f3e74fad`
**Assumptions:** `win_rate`/`avg_win`/`avg_loss` are already-calibrated
inputs the caller supplies from real historical performance — this
formula does not itself estimate them, and correctly returns `0` (no
edge) if any input is non-positive.
**Numerical issues:** none — degenerate inputs are explicitly guarded.
**THETA implementation:** THETA does not use a Kelly formula anywhere
(sizing is risk-budget/collateral/concentration-cap-based, per
`sizing.py`/`sizing_contract.py`) — this is recorded for reference and
comparison, not for adoption, since no calibrated `win_rate` input exists
yet in THETA (the same "no calibrated entry-outcome model" gap
documented throughout `management_action_value.py`/`theta_q_baseline.py`).
**Verification test:** N/A (not adopted).

---

## Kelly Fraction — ANTI-PATTERN (delta/d2 misused as win probability)

**Equation (as found, NOT to be replicated):**
```
p = N(d2)                      # risk-neutral ITM probability from Black-Scholes
b = (S - K) / premium - 1       # rough payoff-to-cost ratio
q = 1 - p
f* = max(0, (p*b - q) / b)      # raw, un-fractional Kelly
```
**Source repository:** `ksanjay/Kelly-Criterion-Option-Selector`
**Source file:** `kelly_leaps.ipynb`
**Source commit:** `43c2443cd202777650bd1c61233054a83fe31771`
**Why this is cataloged as an anti-pattern, not a candidate for
adoption:** `N(d2)` is a risk-neutral pricing quantity, not a real-world
win probability — using it as `p` in a Kelly formula is the exact
STAT-001 mistake THETA's own CLAUDE.md prohibits by name ("delta is not
probability of profit"). Additionally, `f*` here is RAW (no fractional
discount), which is the exact "never deploy raw full-Kelly sizing"
mistake called out in the authoritative directive itself. This entry
exists so a future contributor can point to a concrete, real example of
why both rules exist, rather than treating them as abstract caution.
**THETA implementation:** none, and none should ever be built this way.
**Verification test:** N/A (deliberately rejected method).

---

## Options-Strategy Fill Price (four slippage models)

**Equation:**
```
mid = (bid + ask) / 2
half_spread = (ask - bid) / 2

# slippage == "mid":       fill = mid
# slippage == "spread":    ratio = 1.0
# slippage == "liquidity": ratio = fill_ratio + (1-fill_ratio) * (1 - clip(volume/reference_volume, 0, 1))
# slippage == "per_leg":   ratio = min(fill_ratio + per_leg_slippage * (num_legs - 1), 1.0)

fill = mid + half_spread * ratio   # if buying (long)
fill = mid - half_spread * ratio   # if selling (short)
```
**Variables:** `bid`/`ask` current quote, `fill_ratio` base assumption
in [0,1], `volume`/`reference_volume` for the liquidity-scaled model,
`per_leg_slippage`/`num_legs` for the per-leg model.
**Source repository:** `goldspanlabs/optopsy` (**AGPL-3.0 — method
reference only, formula is not copyrightable expression on its own, but
the actual source lines must not be copied into THETA**)
**Source file:** `optopsy/pricing.py`
**Source commit:** `40bb8b2aa07ef8763caeadf752961faecb494efd`
**Assumptions:** `reference_volume` is a single global liquidity
threshold, not per-underlying-calibrated; the per-leg model assumes a
LINEAR slippage penalty per additional leg, not empirically fit.
**THETA implementation:** THETA's `execution-quality-contract.ts` models
spread/fill-probability/quote-size as a different (not directly
comparable) formulation — a direct dimension-by-dimension comparison has
not yet been done (see Gap Matrix follow-up #3). THETA has no
liquidity-scaled or leg-count-scaled slippage model today; its
`estimatedSlippagePerContract` is a flat, caller-supplied constant.
**Verification test:** not yet written — flagged as a Gap Matrix
follow-up, relevant once THETA-DEFINED-RISK (multi-leg) exists.

---

## Notional-Cap-Consistent Position Sizing

**Equation:**
```
risk_amount = equity * risk_pct
units = risk_amount / risk_per_unit
max_units_by_notional = (equity * max_notional_pct) / entry_price
if units > max_units_by_notional:
    units = max_units_by_notional
    risk_pct = (units * risk_per_unit) / equity   # recomputed, kept consistent
```
**Source repository:** `HasibVortex369/riskkit`
**Source file:** `src/riskkit/sizing.py`
**Source commit:** `99d1d167dc55c8a564526ef42d87e298f3e74fad`
**Assumptions:** `entry_price`/`risk_per_unit` (stop-distance) already
known and positive; an absolute notional cap always takes precedence
over the risk-fraction-derived size.
**Numerical issues:** none identified — the explicit backward
recomputation of `risk_pct` after the cap binds is exactly what prevents
a caller from reporting a risk percentage that no longer matches the
actual capped position.
**THETA implementation:** verified. THETA's `sizing.py` uses a
structurally different (and, on inspection, stronger) design than
riskkit's: it derives `capital_required` directly from the FINAL,
already-capped `quantity` every time, rather than computing a separate
risk-fraction representation first and reconciling it after a cap binds.
There is no second, independently-tracked number that could drift out of
sync — the specific bug class riskkit's backward-recomputation code
guards against cannot occur in THETA's design by construction.
**Verification test:** written this pass —
`bots/theta/tests/quant/test_sizing.py::CapConsistencyTests` (2 tests:
one confirming `capital_required` reflects the risk-budget-capped
quantity, one confirming it reflects the `ALLOW_REDUCED` multiplier's
final scaled-down quantity). Both pass.
