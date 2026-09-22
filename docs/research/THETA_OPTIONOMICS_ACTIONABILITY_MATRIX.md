# THETA Optionomics actionability matrix (Wave 11)

Adds the one layer the existing methodology research doesn't have yet:
**decision role** (should this field block, rank, size, restructure, or
stay shadow). Field-level provenance/PIT/methodology status below is
reused, not re-derived, from
`THETA_OPTIONOMICS_GEX_EXPECTED_MOVE_RV_METHODOLOGY_2026-09-22.md`,
`THETA_OPTIONOMICS_FIELD_QUALIFICATION_2026-09-22.md`, and
`THETA_OPTIONOMICS_FIELD_QUARANTINE.md` -- this doc does not re-open
Vanna/Charm/walls, per this wave's own instruction, and does not
re-verify GEX/RV/expected-move (already closed, see those docs).

**Principle governing every "decision role" assignment below**: real,
paid data should be used professionally where qualified -- but existing
qualification status is never overridden to justify a role. A
`PROVIDER_LIMITED` or `METHODOLOGY_UNVERIFIED` field gets `SHADOW_ONLY`
or `DO_NOT_USE`, never `HARD_SAFETY`, regardless of how useful it would
be if verified. Nothing here creates a new hard gate.

| Field | Provenance | PIT status | Methodology | Provider status | **Decision role** |
|---|---|---|---|---|---|
| ATM IV (`atm_iv`) | PROVIDER_NATIVE | CURRENT_ONLY (real-time chain read, not historically verified PIT-safe this pass) | METHODOLOGY_VERIFIED (standard ATM IV) | PROVIDER_QUALIFIED | `SOFT_RANKER` (candidate IV-level ranking) |
| IV rank (`iv_rank`) | PROVIDER_NATIVE | CURRENT_ONLY | METHODOLOGY_UNVERIFIED (lookback window/percentile method not confirmed) | PROVIDER_LIMITED (field present in code, real-response presence not independently qualified this pass) | `SHADOW_ONLY` |
| IV percentile (`iv_percentile`) | PROVIDER_NATIVE | CURRENT_ONLY | METHODOLOGY_UNVERIFIED | PROVIDER_LIMITED (same as IV rank) | `SHADOW_ONLY` |
| Per-contract IV (`impliedVolatility`) | PROVIDER_NATIVE | CURRENT_ONLY | METHODOLOGY_VERIFIED (standard BS-implied) | PROVIDER_QUALIFIED | `SOFT_RANKER` / `STRUCTURE_MODIFIER` (already a real input to `expectedMoveApprox`) |
| RV20 (`realized_vs_implied.rv20`) | PROVIDER_NATIVE | CURRENT_ONLY | METHODOLOGY_VERIFIED (arithmetic-cross-checked against `iv_minus_rv20`) | **PROVIDER_QUALIFIED** (the only RV horizon confirmed) | `SOFT_RANKER` |
| RV5 / RV10 / RV30 / RV60 | DERIVED (unverified substitute: `price_history.summary.realized_volatility_percent`) | CURRENT_ONLY | METHODOLOGY_UNVERIFIED (no cross-check against RV20 performed yet) | PROVIDER_LIMITED | `SHADOW_ONLY` -- do not rank on these until the RV20 cross-check (already scoped in the methodology doc) passes |
| VRP / IV-minus-RV20 (`iv_minus_rv20`) | PROVIDER_NATIVE | CURRENT_ONLY | METHODOLOGY_VERIFIED (arithmetic-consistent) | PROVIDER_QUALIFIED | `SOFT_RANKER` |
| `vrp_20` (distinct field, legacy) | N/A | N/A | N/A | **DOCUMENTED_LEGACY_NULL** -- provider's own documented always-null field (`optionomics-provider.ts:657-659`) | `DO_NOT_USE` |
| Skew (`impliedVolatilitySkewZScore`, `riskReversal25`) | PROVIDER_NATIVE | CURRENT_ONLY | METHODOLOGY_UNVERIFIED (z-score baseline/lookback not confirmed) | PROVIDER_LIMITED | `SHADOW_ONLY` |
| Term structure (`termSlope`) | PROVIDER_NATIVE | CURRENT_ONLY | METHODOLOGY_UNVERIFIED | PROVIDER_LIMITED | `SHADOW_ONLY` |
| Expected move, provider-native | N/A | N/A | N/A | **NOT_OBSERVED** (no confirmed field found under this or an equivalent name -- distinct from confirmed-absent) | `DO_NOT_USE` until the targeted field search (already scoped) resolves NOT_OBSERVED one way or the other |
| Expected move, THETA-derived (`expectedMoveApprox`) | **DERIVED_EXPECTED_MOVE_V1** (formal name assigned here, per this wave's request) -- `stockPrice * impliedVolatility * sqrt(dte / 365)`, per-contract IV, calendar-day DTE | CURRENT_ONLY | METHODOLOGY_VERIFIED as a formula, but 2 disclosed methodology choices (per-contract not ATM IV; calendar not trading-day scaling) never consciously affirmed | N/A (THETA-computed, not provider) | `STRUCTURE_MODIFIER` (already real input to `expectedMoveNormalizedStrikeDistance`) -- **not** `HARD_SAFETY`: a derived approximation with disclosed, unconfirmed methodology choices must not gate entry |
| GEX (`gammaExposure`, `totalGex`, `callGammaExposure`/`putGammaExposure`) | PROVIDER_NATIVE | CURRENT_ONLY | **METHODOLOGY_UNVERIFIED** -- 4 incompatible public GEX conventions exist, Optionomics documents none | PROVIDER_LIMITED | `SHADOW_ONLY` |
| Call wall / put wall (`callWall`/`putWall`) | PROVIDER_NATIVE | **PIT_UNSAFE** -- confirmed frozen/implausible across 3 historical dates, tracking current session instead | N/A (quarantined before methodology matters) | **QUARANTINED** | `DO_NOT_USE` -- unchanged, not reopened this pass |
| Max pain (`maxPainStrike`) | PROVIDER_NATIVE | CURRENT_ONLY (PIT status for historical dates not separately re-verified this pass, distinct from the walls) | METHODOLOGY_UNVERIFIED | PROVIDER_LIMITED | `SHADOW_ONLY` |
| Vanna (`vannaExposureHeatmap`) | PROVIDER_NATIVE | CURRENT_ONLY | METHODOLOGY_UNVERIFIED | **PROVIDER_LIMITED** (unchanged, not reopened) | `DO_NOT_USE` per standing policy |
| Charm (`charmExposureHeatmap`) | PROVIDER_NATIVE | CURRENT_ONLY | METHODOLOGY_UNVERIFIED | **PROVIDER_LIMITED** (unchanged, not reopened) | `DO_NOT_USE` per standing policy |
| Net flow / PCR ratios (`putCallVolumeRatio` etc.) | PROVIDER_NATIVE | CURRENT_ONLY | METHODOLOGY_UNVERIFIED | PROVIDER_LIMITED | `SHADOW_ONLY` |
| Trend/context (Optionomics `providerContext`) | PROVIDER_NATIVE | CURRENT_ONLY | `interpretation: 'PROVIDER_CONTEXT_WITH_UNVERIFIED_UNITS_NO_EXECUTION_AUTHORITY'` (the type itself already says this) | PROVIDER_LIMITED | `RESEARCH_ONLY` -- the type system already enforces this; not a new finding |

## Why nothing here is `HARD_SAFETY`

Every genuinely `HARD_SAFETY` gate in THETA's real entry path today is
Alpaca-sourced, not Optionomics-sourced: quote freshness, spread width
(both correctly hard per `THETA_HARD_VS_SOFT_DECISION_AUDIT.md`'s
correction), and AEGIS's own risk families. No Optionomics field is
currently, or is being recommended here to become, a first-Paper entry
blocker. This is deliberate: Optionomics intelligence is real and useful
context, but every field above is either `PROVIDER_QUALIFIED` (safe to
use as a `SOFT_RANKER`/`STRUCTURE_MODIFIER`) or still has an open
methodology/PIT/provider question (`SHADOW_ONLY`/`DO_NOT_USE` until
resolved). Using unqualified data as a ranker still risks noise; using it
as a hard gate would risk exactly the false-paralysis failure mode this
engagement exists to prevent.

## The concrete, actionable next step (not done this pass)

Wiring `atmIv`/`realizedVolatility20d`/`ivMinusRealizedVolatility20d`
(the 3 fields marked `PROVIDER_QUALIFIED` above) as real `SOFT_RANKER`
inputs into the entry economic ranker (`canonical-strategy-frontier.ts`
or `opportunity_frontier.py`) is the one genuinely ready, low-risk
integration this matrix identifies -- currently `CAN_REPRESENT`-only per
the hard-vs-soft audit's earlier finding, not yet consumed anywhere in
the real entry-candidate path. Not implemented this pass (research
synthesis only); a real Codex/Claude integration task for a future pass,
scoped narrowly to the 3 qualified fields, not the whole family.
