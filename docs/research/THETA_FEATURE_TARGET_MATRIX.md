# THETA Feature/Target Matrix (R6)

Every row: a feature genuinely available at decision time (X), whether it
is already wired into a real THETA runtime path, and its relationship to
the target defined in `THETA_EV_MODEL_SPEC.md` (Y = WholeChainPnl /
CapitalDays, per resolved or censored chain). Per item 8: point-in-time
safety is enforced by construction — every X below is asserted only
insofar as it is ALREADY computed from data available at or before
decision time in the real runtime path cited; this matrix does not invent
a feature that isn't already point-in-time safe somewhere in the
codebase.

## Legend

- **Wired today:** the feature is computed by real, tested code in this
  repository right now (cite the file).
- **Research-only:** computed, but explicitly not permitted to influence
  any production decision path yet (Cboe-style discipline).
- **Not yet computed:** named here as a candidate, not yet implemented
  anywhere.

## Underlying / market features

| Feature | Wired today? | Source | Point-in-time note |
|---|---|---|---|
| Recent returns (1d/5d/20d/60d), MA slope/relative, RV (10/20/60), drawdown, gap frequency/magnitude | Wired today | `underlying-features.ts`/`underlying-history.ts`, consumed by `ownership_v0.py`/`regime_v0.py` | `barsAsOf` explicitly excludes any bar timestamped after `asOf` (tested, `tests/underlying-history.test.ts`) |
| Regime classification (bull/bear/range, RV band, stress state) | Wired today | `regime_v0.py`/`regime-contract.ts` | consumes only the above point-in-time-safe underlying features |
| Event proximity (earnings/ex-div/corporate action distance) | Partial | `event-state.ts` assembles it; earnings distance stays permanently UNKNOWN (no real source wired) per the item D discipline | UNKNOWN is honestly propagated, never a fabricated "no event" |
| GEX / dealer positioning | Not yet computed | Candidate formula extracted this session, `FlashAlpha-lab/gex-explained` (see `THETA_FORMULA_CATALOG.md`) | would require a real, point-in-time OI/gamma snapshot per strike — not sourced anywhere today |
| Volatility surface shape (skew, term structure beyond the narrow VIX/VIX9D ratio) | Research-only, narrow | `cboe-regime-features.ts`'s `computeNearTermVolRatio` (VIX9D/VIX only) | explicitly research-only; `thedhruvhegde/ivsurf` reviewed only at the `black_scholes.py` level so far, no THETA adoption |

## Contract-level features

| Feature | Wired today? | Source | Point-in-time note |
|---|---|---|---|
| Strike, DTE, delta, IV, spread%, OI, volume | Wired today | `option-contract.ts` normalization, Alpaca+Optionomics merge in `option-chain-ingestion.ts` | `dataAgeSeconds`/`quoteTimestamp` make staleness checkable; `data-freshness.ts` gates any stale quote to WAIT, never silently used |
| Multiplier (contract-derived, never assumed 100) | Wired today (fixed this session) | `alpaca-provider.ts` parses real `size`; `option-chain-ingestion.ts` forces `executable=false` when unverified | closes exactly the "unknown must never become executable truth" gap Codex's review flagged |
| Ownership acceptability score | Wired today | `ownership_v0.py` | computed from the same point-in-time-safe underlying features above |

## Portfolio/account features

| Feature | Wired today? | Source | Point-in-time note |
|---|---|---|---|
| Capital committed, concentration, assignment capacity | Wired today | `account-exposure.ts` | derived from the current cycle's own fetched positions/orders, never a future state |
| AEGIS state | Wired today | `aegis.py`/`aegis-contract.ts` | computed from the same-cycle inputs above |

## Target-side (Y) construction status

| Component of Y | Wired today? | Source |
|---|---|---|
| Realized/unrealized stock P&L, dividends, fees | Wired today | `ledger-contract.ts`'s `computeWholeChainPnl` |
| Realized option-leg P&L, roll linkage (old leg's P&L preserved, never blended into the new leg's) | Wired today | `ledger-contract.ts`'s `OptionLeg`/`rolledFromOptionLegId`/`rolledToOptionLegId` |
| Unrealized option-leg mark-to-market | **Not yet computed** | `computeWholeChainPnl`'s own docstring names this gap explicitly (`hasUnresolvedOpenPositions` flag surfaces it rather than assuming zero) |
| Commission/modeled slippage as a distinct line item | **Not yet computed** | currently folded into `fees` per the same docstring; a future execution-quality integration may split it out |
| CapitalDays (denominator for ReturnPerCapitalDay) | Partially wired | `new-risk-orchestrator.ts` computes it per-candidate at OPEN time; not yet joined across a chain's full lifetime into one per-episode figure |

## What this matrix does NOT do

It does not assert that a calibrated model can be fit today — see
`THETA_EV_MODEL_SPEC.md` §1's explicit
`EV_MODEL_NOT_EMPIRICALLY_READY` status. This matrix only inventories
which X-side features are genuinely point-in-time safe and available,
and exactly which Y-side components are implemented versus still
required, so a future model-fitting attempt starts from an accurate
inventory rather than a guess.
