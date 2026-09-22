# Optionomics GEX / expected-move / RV methodology assessment (pre-VPS Wave 2, Slice 17)

Status: synthesis of prior real findings (`THETA_GEX_DEFINITION_MATRIX.md`,
`THETA_OPTIONOMICS_FIELD_QUARANTINE.md`, `THETA_OPTIONOMICS_FIELD_QUALIFICATION_2026-09-22.md`,
`THETA_OPTIONOMICS_CAPABILITY_CENSUS_2026-09-14.md`) against a direct read of
the code that actually consumes these fields (`src/theta/optionomics-feature-engine.ts`,
`src/theta/optionomics-provider.ts`) this pass. No new MCP calls were made
this pass -- this is a code-and-prior-evidence synthesis, not a fresh
provider-qualification pass. `brokerAuthority: false` throughout.

## 1. GEX (gamma exposure)

### 1a. What Optionomics returns

`src/theta/optionomics-provider.ts:236,402` carries a per-contract
`gammaExposure` field (`gamma_exposure`/`gammaExposure` in the raw payload).
The heatmap-scoped surface (`optionomics-provider.ts:602,779`) separately
exposes `gamma_exposure` as one of three heatmap metrics (alongside
`vanna_exposure`/`charm_exposure`), and the aggregate `option_metrics` surface
(`:683-697`) exposes `callGammaExposure`/`putGammaExposure`/`putCallGammaExposureRatio`
plus the derived positioning fields `callWall`/`putWall`.

**Optionomics documents none of these as a specific computation.** No sign
convention (dealer-long vs. dealer-short gamma), no fixed-vs-scanned-spot
methodology, and no aggregation axis (per-strike vs. cumulative) is stated
anywhere this engagement has found in the provider's own docs or MCP schema.

### 1b. Why that absence is a real, not cosmetic, gap

`THETA_GEX_DEFINITION_MATRIX.md` (prior slice, independently read five public
GEX reference implementations) found **four genuinely different, mutually
inconsistent definitions of "GEX" / "zero gamma" / "gamma flip"** in active
public use:

1. Per-strike zero crossing of the raw GEX profile (`FlashAlpha-lab/gex-explained`).
2. Zero crossing of the **cumulative** sum of per-strike GEX (`puneet-chandna/0DTE-dealer-gamma`).
3. Cumulative sum restricted to a windowed strike range with a noise
   threshold, plus a separate `argmax`/`argmin` per-strike call/put wall
   (`hedarthy/DealerFlow`) -- this is the only one of the five to also model
   vanna/charm exposure and the only one with an explicit T->0 floor via
   seconds-to-close rather than calendar days.
4. A **spot-domain scan** (not strike-domain): repricing total dealer gamma
   across a range of hypothetical spot prices with each contract's own
   IV/strike/expiry held fixed, then finding where that repriced curve
   crosses zero (`sgdividends/spx-dealer-gamma`).

These are not minor implementation variants -- they operate on different axes
(strike vs. cumulative-strike vs. windowed-cumulative-strike vs. spot) and can
produce different signs, different flip levels, and in one case a completely
different quantity (a call/put wall from raw `argmax`/`argmin` vs. from a
cumulative-curve crossing). **Given this, "Optionomics's `gamma_exposure`
field" is not a single well-defined quantity until Optionomics states which of
these (or a fifth) methodology it uses.**

### 1c. What THETA's own code does with the field

`optionomics-feature-engine.ts:175` (`contractFeatures`) does the **minimum
safe thing**: it passes `entry.gammaExposure` through a `finite()` guard
(`GEX_UNKNOWN` if null, `INVALID` if non-finite) and does not recompute,
interpret, threshold, or aggregate it into a call/put wall or zero-gamma
estimate anywhere in this file. This is correct defensive practice given 1a/1b
-- THETA is not currently manufacturing a false sense of GEX precision by
computing its own zero-gamma crossing on top of an unverified upstream
definition.

`call_wall`/`put_wall` specifically remain `QUARANTINED` per
`THETA_OPTIONOMICS_FIELD_QUARANTINE.md` -- confirmed frozen/implausible across
three independently-requested historical dates (2013, 2018, 2022 all returned
`call_wall≈695-700`/`put_wall≈680`, tracking the *current* 2026 session, not
the requested historical date) while `underlying_price`/`max_pain_strike` on
the SAME responses varied correctly. This is independent, concrete evidence
that at least the wall fields are not computed the way their name implies for
historical queries, and per the standing quarantine policy this extends to
"treat as UNKNOWN for every date, past or present" until a dense contiguous-date
transition study proves otherwise -- not just historical dates.

### 1d. Assessment

`gamma_exposure` (contract-level and aggregate) is **PROVIDER_LIMITED /
METHODOLOGY_UNVERIFIED**, not `REAL`. THETA's current handling (pass-through
with UNKNOWN/INVALID typing, no derived wall/flip computation, explicit
quarantine of the wall fields) is the correct conservative posture given the
evidence. The concrete, actionable gap is a **documentation/vendor-verification
question for Codex**, not a code defect: ask Optionomics (or find in its
changelog/support docs) which of the four-plus known GEX conventions its
`gamma_exposure`/`call_wall`/`put_wall` fields implement, with sign convention
and aggregation axis stated explicitly. Until that answer exists, no THETA
decision path should treat `gammaExposure`-derived quantities as more precise
than "a number of unverified sign and aggregation convention" -- which is
exactly how `optionomics-feature-engine.ts` already treats it today.

## 2. Expected move

### 2a. What "expected move" could mean here

Two candidate sources exist in the codebase for an "expected move" concept,
and they are **not the same computation**:

1. **Provider-native `expected_move`**: per `THETA_OPTIONOMICS_FIELD_QUALIFICATION_2026-09-22.md`
   line 22, a dedicated search for a field literally named `expected_move` (or
   an obvious equivalent) across the MCP tools checked that pass found
   **nothing** -- status `NOT_OBSERVED`, explicitly flagged as possibly
   present under an unchecked field name rather than confirmed absent.
2. **THETA's own locally-derived `expectedMoveApprox`**
   (`optionomics-feature-engine.ts:130-131,139`): computed as
   `stockPrice * impliedVolatility * sqrt(dte / 365)` -- the standard
   one-standard-deviation lognormal approximation, using **that specific
   contract's own IV**, not a dedicated ATM/straddle-implied IV. This is a
   THETA-side derivation, not a value read from Optionomics at all.

### 2b. Assessment

THETA does not currently consume a genuine provider-supplied "expected move"
figure (none has been confirmed to exist in the provider), and its own local
approximation has two disclosed-here-for-the-first-time methodology
characteristics worth flagging to Codex:

- It uses **per-contract IV**, not ATM/straddle IV. For an OTM CSP strike
  well away from the money, that contract's own IV (which typically differs
  from ATM IV due to skew) is used to estimate the "expected move" against
  which `expectedMoveNormalizedStrikeDistance` (`:140-141`) is then measured
  -- i.e., the yardstick used to judge strike distance is itself derived from
  a point on the same skew curve the distance is being measured across. This
  is a real methodological choice (not necessarily wrong -- some practitioners
  prefer the option's own IV over ATM IV for exactly this reason, since it is
  "closer" to the strike in question), but it is undocumented as a deliberate
  choice anywhere in the file; the doc comment does not state why per-contract
  IV was chosen over ATM IV.
- The `sqrt(dte / 365)` calendar-day scaling (not trading-day) is the
  simplest common convention and is internally consistent with how DTE is
  computed elsewhere in this codebase (not independently re-verified this
  pass whether DTE is calendar or trading days at the source), but is worth
  Codex confirming matches the DTE convention used everywhere else it is
  compared against, since a calendar/trading-day mismatch would silently
  bias `expectedMoveNormalizedStrikeDistance`.

Neither of these is a correctness defect found this pass -- both are
documented-here methodology characteristics that should be either
consciously affirmed or revisited, since `expectedMoveNormalizedStrikeDistance`
appears to be a structural-economics feature that could plausibly feed a
future ranking/gating decision.

## 3. RV (realized volatility)

### 3a. What Optionomics returns, by field

Per `optionomics-provider.ts:668-673` and re-confirmed against real MCP calls
in `THETA_OPTIONOMICS_FIELD_QUALIFICATION_2026-09-22.md`:

| Field | Status this pass's synthesis | Source tool |
| --- | --- | --- |
| `rv20` | **QUALIFIED** -- served under `iv_term_structure`'s `realized_vs_implied.rv20`, matched, decimal units, arithmetic-verified against `iv30` (`iv_minus_rv20` reconciled exactly) | `iv_term_structure` |
| `rv5` / `rv10` / `rv30` / `rv60` | **PROVIDER_LIMITED** -- no dedicated field found under these names anywhere checked; `price_history`'s `summary.realized_volatility_percent` (parameterized by `days`) is a "plausible but unverified substitute," not confirmed equivalent to a native `rv5`/`rv10`/`rv30`/`rv60` | `price_history` (unverified substitute) |
| `iv_minus_rv20` | **QUALIFIED** -- served as `realized_vs_implied.spread`, a different literal field name than the TS type's field name but arithmetic-consistent | `iv_term_structure` |

### 3b. Assessment

RV20 is the only realized-volatility horizon THETA can currently treat as
qualified provider evidence; RV5/RV10/RV30/RV60 either do not exist under
their expected names or exist only via an unverified substitute
(`price_history.summary.realized_volatility_percent`) whose windowing
parameter (`days`) has not been cross-checked against `iv_term_structure`'s
own `rv20` to confirm it computes realized volatility the same way (same
annualization convention, same return type -- log vs. simple, same trading-day
count assumption). Per the field-qualification doc's own stated next step,
this is a **targeted, concrete follow-up**: call `price_history` with
`days=20` for a symbol/date already qualified under `iv_term_structure`'s
`rv20`, and confirm the two independently-sourced RV20 values agree within a
small tolerance before treating `price_history` as a valid substitute source
for the other four horizons.

## 4. Net assessment and what remains open

| Concept | Status | Confidence this pass adds |
| --- | --- | --- |
| GEX (raw field pass-through) | PROVIDER_LIMITED / METHODOLOGY_UNVERIFIED | Ties the existing GEX-definition research (4 distinct public methodologies) directly to Optionomics's actual field usage in THETA's own feature engine for the first time -- prior slices had these as two separate, unconnected findings |
| `call_wall`/`put_wall` | QUARANTINED (unchanged) | Reconfirms via code read that THETA correctly never derives its own wall/flip estimate as a substitute |
| Expected move (provider-native) | NOT_OBSERVED (unchanged) | No new evidence -- still needs a targeted MCP field search before concluding absence |
| Expected move (THETA-local) | REAL, but two undocumented methodology choices newly flagged (per-contract IV, calendar-day scaling) | New this pass -- neither previously written down explicitly |
| RV20 | QUALIFIED (unchanged) | No new evidence |
| RV5/10/30/60 | PROVIDER_LIMITED (unchanged) | No new evidence; the cross-check follow-up remains unexecuted |

**Nothing in this document changes any registry `currentState`, quarantine, or
Production file.** It is a synthesis intended to give Codex one place that
connects "what does the code do with this field" to "what do we actually know
about the field's definition" for GEX/expected-move/RV specifically, since
those three concepts were previously documented in three-plus separate places
(`THETA_GEX_DEFINITION_MATRIX.md`, `THETA_OPTIONOMICS_FIELD_QUARANTINE.md`,
`THETA_OPTIONOMICS_FIELD_QUALIFICATION_2026-09-22.md`,
`THETA_OPTIONOMICS_CAPABILITY_CENSUS_2026-09-14.md`) without an explicit
cross-reference to the feature-engine code that consumes them.

## 5. Agent handoff

**OWNER:** Claude (quant research + adversarial validation)
**TASK:** Pre-VPS Wave 2, Slice 17 -- Optionomics GEX/expected-move/RV
methodology assessment
**FILES CHANGED:** this document (new); no source file touched
**KEY FINDING:** GEX is not one thing -- four incompatible public
methodologies exist, Optionomics documents none of them, and THETA's own code
correctly does not compensate by inventing a fifth. Expected move has two
undocumented-until-now methodology choices in THETA's local approximation
(per-contract IV, calendar-day scaling) that should be consciously affirmed.
RV20 is the only qualified realized-vol horizon; the other four remain
PROVIDER_LIMITED pending a same-symbol/same-date cross-check between
`iv_term_structure.rv20` and `price_history.summary.realized_volatility_percent`.
**NEXT RECOMMENDED TASK:** (1) Codex/vendor-relations follow-up: ask
Optionomics directly which GEX convention (of the matrix's four, or a fifth)
its `gamma_exposure`/`call_wall`/`put_wall` fields implement. (2) A targeted
MCP call to search for a genuine `expected_move`-equivalent field under
alternate names before concluding NOT_OBSERVED is final. (3) The RV20/`price_history`
cross-check described in Section 3b.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
