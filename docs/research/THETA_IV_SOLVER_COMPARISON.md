# THETA IV/Volatility-Surface Solver Comparison (R6D)

Deep-read `thedhruvhegde/ivsurf` (`core/black_scholes.py`, commit
`c20072a8f6c09146697bdb55dca566567d7b0535`) against THETA's own current
posture: **THETA does not solve IV internally in Production** -- it consumes
Optionomics-provided IV directly, and Codex's own v2 execution-quality/
normalization work (per `docs/HANDOFF.md`, 2026-09-11) already isolates a
non-finite IV or a T=0/expired contract to that single contract, explicitly
so a batch of contracts is never contaminated by one bad member. This
document's purpose is to verify that discipline against an independent,
real, non-THETA implementation -- not to add an IV solver to THETA.

## Findings from `ivsurf`'s `black_scholes_price` / `implied_volatility`

- **Newton-Raphson solver** (`_implied_vol_newton`): initial guess `sigma=0.2`,
  vectorized across a batch, uses `vega` for the update step, clips `sigma`
  to `[1e-4, 5.0]` each iteration, and -- correctly -- sets any contract whose
  final price-vs-target difference still exceeds `tol` after `max_iter` to
  `NaN` rather than returning the last (non-converged) guess. This matches
  THETA's own "fail closed to UNKNOWN, never silently wrong" doctrine.
- **Brent's method** (`_implied_vol_brent`): brackets the root search to
  `[1e-4, 5.0]`, catches exceptions, returns `NaN` on failure. Documented in
  `ivsurf`'s own docstring as "more robust but slower" than Newton -- a real,
  reasonable trade-off note worth citing (bracketing methods are more robust
  to a bad initial guess / low-vega region than Newton, at the cost of more
  function evaluations).
- **Low-vega / near-expiry guard**: `valid_vega = vega_val > 1e-10` prevents
  a division blowup in the Newton step. It does not, by itself, guarantee
  convergence for a deep ITM/OTM or near-expiry contract -- it relies on the
  post-loop `final_diff > tol -> NaN` check to fail closed for exactly those
  hard cases, rather than claiming a spurious converged value.
- **Intrinsic-value bound check**: before solving, `implied_volatility`
  computes each contract's intrinsic value and requires
  `price >= intrinsic - tol`; a violation triggers a warning and a `NaN`
  result. This is the repo's only no-arbitrage check -- there is no
  cross-strike monotonicity check and no calendar-spread (cross-expiry)
  arbitrage check anywhere in this file.

## Two confirmed batch-contamination bugs -- exactly the failure mode
## THETA's own Codex-authored fix already prevents

Both of the following are real, source-confirmed defects in `ivsurf`'s
vectorized implementation, and both are the SAME class of bug Codex's v2
execution-quality/normalization work explicitly fixed for THETA (per
`docs/HANDOFF.md`: "A non-finite IV becomes UNKNOWN for that contract while
valid sibling contracts remain usable... A contract at T=0 or earlier is
non-executable, while later expiries in the same batch are evaluated
independently"). Citing them here as the concrete negative example that
confirms THETA's existing per-contract isolation is the RIGHT design, not
merely a stylistic preference:

1. **T=0 batch contamination.** `black_scholes_price` checks
   `if np.any(T == 0): return maximum(S-K, 0) or maximum(K-S, 0)` for the
   ENTIRE input array -- if even one contract in a batch has `T=0`, every
   OTHER contract in that same call (including genuinely live, non-expiring
   contracts) is silently returned as pure intrinsic value instead of its
   real Black-Scholes price. This is precisely the batch-isolation failure
   THETA's own per-contract T=0 handling was built to avoid.
2. **Intrinsic-bound-violation batch contamination.** `implied_volatility`
   checks `if np.any(price < intrinsic - tol): return NaN for the WHOLE
   price array` -- one bad/stale/crossed quote anywhere in a batch nukes the
   implied-vol result for every other, perfectly valid contract in that same
   call. Again, the same class of contamination THETA's per-contract
   isolation already prevents.

**Classification: `REFERENCE_ONLY`.** The Newton/Brent methods and the
fail-closed-to-NaN convergence discipline are legitimate, well-known
numerical techniques worth knowing about, but THETA does not need an
internal IV solver today (Optionomics-sourced IV is the Production truth),
and if one is ever built for verification/backtest-reconstruction/fallback-
research purposes (per the standing "never a second contradictory Production
truth" instruction), it must NOT reproduce either contamination bug above --
per-contract isolation is a hard requirement, not a nice-to-have, confirmed
by this exact negative example.

## No-arbitrage bounds, T=0, deep ITM/OTM, skew/smile/term structure,
## interpolation/extrapolation

`ivsurf`'s own `core/interpolation.py`, `core/advanced_interpolation.py`,
`core/surface_model.py`, and `core/surface_smoothing.py` implement its actual
surface-fitting layer (smile/skew/term-structure interpolation across
strikes and expiries); `models/heston_advanced.py`, `models/jump_diffusion.py`,
and `core/stochastic_vol.py` implement stochastic-vol/jump alternatives to a
pure Black-Scholes surface. These were NOT deep-read this pass (file-tree
enumerated only, ~100+ files) -- the single most valuable, directly
comparable file for THETA's actual current need (a Black-Scholes IV
inversion, which is the only IV-adjacent math THETA might ever verify
against) was `core/black_scholes.py`, and that file has now been fully read.
Going further into the surface-fitting/stochastic-vol layers would be
`TEST_ONLY`/`REFERENCE_ONLY` research for a future surface-construction
effort THETA has no current requirement for (THETA consumes Optionomics'
own IV per contract; it does not build its own smile/surface). Flagged here
as an explicitly deferred, not silently skipped, scope boundary.

QuantLib was not independently deep-read this pass either (Codex's own
research ledger already scored it at commit
`ca953b7ebdb400f2839d86f18eeb0d4a2a4a30a4`, adopted verbatim onto this
branch in a prior phase per `GITHUB_REPO_RESEARCH_LEDGER.md`) -- re-reading
it directly would duplicate Codex's own independent review rather than add
new information, given THETA has no active IV-solver-building task this
phase.

## A genuine numerical finding surfaced while building the reference fixture

Building THETA's own dependency-free reference solver (`bs_reference.py`,
below) to cross-check ivsurf's approach surfaced a real, independently
confirmed phenomenon, not specific to either implementation: for a deep-ITM
contract with very little time remaining, the option's time value is many
orders of magnitude smaller than its intrinsic value, so price-vs-sigma
sensitivity underflows to numerically indistinguishable-from-flat at double
precision (confirmed here: `vega` computed at `1e-107` for a 60%-ITM,
0.02-year contract). A price-matching IV solver is genuinely ill-posed in
this regime -- not a bug to fix, but the reason real vendors typically solve
IV via the OTM-equivalent side of a contract (put-call parity) rather than
directly on a deep-ITM one. THETA does not solve IV itself today, so this has
no Production consequence, but it is a concrete, citable reason never to
build a naive direct-ITM IV solver later without accounting for it.

## Numerical fixtures added

See `bots/theta/tests/quant/test_iv_reference_fixtures.py` -- a small,
dependency-free (no scipy) reference Black-Scholes price/vega
implementation used ONLY to cross-check THETA's already-existing formula
catalog entries, covering ATM/ITM/OTM/deep-ITM/deep-OTM/near-zero-DTE/
high-IV/low-vega cases. This is a verification utility, not a Production IV
solver -- it never runs against real THETA data and never feeds any
executable decision.
