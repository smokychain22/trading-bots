# THETA Optionomics Intelligence Synthesis

Author: Claude (research lane, `claude/theta-r1-real-state`). This document
does not repeat `THETA_OPTIONOMICS_DATA_MAP.md`, `THETA_OPTIONOMICS_FEATURE_CATALOG.md`,
`THETA_OPTIONOMICS_CAPABILITY_CENSUS_2026-09-14.md`, or this branch's own
`THETA_OPTIONOMICS_CURRENT_DATA_SEMANTICS_AUDIT_2026-09-14.md` -- those remain
the canonical field-level/capability-level records. This document adds one
thing those don't have: an explicit **pipeline staging model** (fact -> temporal
feature -> regime state -> strategy/management feature) and a **professional
interpretation discipline for Flow** specifically, per the current directive's
sections 3-6. `CURRENT_MAIN_SHA` at authoring time: `e17b932fd970dcf5b4c049e192264bcde1ad1072`.

## Existing-work classification (per directive section 2)

| Area | Classification | Basis |
|---|---|---|
| Contract identity / exact-match merge (`optionomics-provider.ts`) | EXISTS_AND_STRONG | `matchOptionomicsContractIdentity`, exact-only, never fuzzy; independently re-verified twice this engagement |
| Raw observation/provenance envelope (migration 029) | EXISTS_AND_STRONG | Request time, HTTP status, rate-limit headers, schema fingerprint, credential-identity-hash, response hash -- richer than most reviewed external repos except FlashAlpha's per-feed `data_as_of` (see below) |
| Quote/execution-authority proof (`optionomics-quote-proof.ts`) | EXISTS_AND_STRONG, narrowly scoped | Correctly rejects OPTION_CHAIN for execution use; verified in this branch's prior audit to be code-scoped to that one operation, not the whole platform |
| Flow (aggregate) normalization | EXISTS_BUT_SHALLOW | Only bucketed net/aggregate flow exists; no per-print classification because the documented contract doesn't expose one (absence, not a THETA gap) |
| GEX/DEX/Vanna/Charm heatmap consumption | EXISTS_AND_STRONG, correctly limited | Per-metric echo validation; units/sign explicitly carried as unverified everywhere, matching this document's own discipline below |
| Temporal-change features (1-min/5-min/session-change, persistence, reversal) for ANY Optionomics family | MISSING | No code anywhere computes a rate-of-change, percentile-of-history, or persistence/reversal feature from repeated Optionomics observations. This is the single biggest gap this document addresses. |
| Explicit FACT-vs-INFERENCE labeling for Flow-adjacent interpretations (aggressor side, opening/closing, "smart money") | MISSING | Nothing in `origin/main` attempts a directional/intent inference from flow at all today (correctly conservative) -- but there is also no explicit taxonomy separating what WOULD be fact from what WOULD be inference if/when print-level data arrives. This document supplies that taxonomy so Codex has it ready. |
| Regime-state composition (e.g. `IV_HIGH + IV_RISING + PUT_SKEW_STEEPENING + NEGATIVE_GAMMA_REGIME`) | MISSING | Each family is normalized independently (`optionomics-feature-destinations.ts` allowlists); no code composes several families into one named regime state. |

## The pipeline (fact -> temporal feature -> regime -> strategy/management feature)

```
NORMALIZED FACT                  (one observation, one timestamp, provider units)
   |
   v
TEMPORAL FEATURE                 (requires >= 2 observations of the SAME fact,
   |                              same contract/underlying, ordered in time)
   v
REGIME STATE                     (a NAMED composition of several temporal
   |                              features, never a single raw field)
   v
STRATEGY FEATURE / MANAGEMENT FEATURE   (branch-specific consumption, gated by
                                          optionomics-feature-destinations.ts)
```

**Why this order matters, concretely:** THETA's current code already computes
raw facts and, in a few places, single-snapshot derived context (`Mid`,
`Spread`, `CSPBreakeven`, per `THETA_OPTIONOMICS_CAPABILITY_CENSUS_2026-09-14.md`'s
Feature schema v2). It has **no TEMPORAL FEATURE layer at all** -- nothing
computes `IV_1MIN_CHANGE`, `GEX_CHANGE`, `FLOW_ACCELERATION`, or a percentile
against a rolling history. Every one of this directive's illustrative examples
(`IV_HIGH + IV_RISING + ...`, `GEX + DISTANCE_TO_FLIP + GEX_CHANGE + ...`)
requires this missing layer. This is the correct next research target, not
because the existing facts are wrong, but because a single snapshot cannot
express "rising" or "accelerating" by construction.

### Per-family fact -> feature answers (the ten questions from section 3)

The table below answers the ten questions for the families this audit found
most load-bearing. Families not listed (Rho, historical/backtest bridge, news,
disclosures) are lower-priority for the entry/management decision and are
deferred, not silently skipped -- see `THETA_OPTIONOMICS_FEATURE_CATALOG.md`
for their existing TEST-status entries.

**Bid/Ask (OPTION_CHAIN)**
- Meaning: a session-recorded, provider-observed two-sided price for one exact
  contract, per Codex's own documented, code-enforced semantics.
- Units: provider's own quote currency (USD per contract's underlying unit).
- Fact vs inference: FACT (the number itself) but INFERENCE if treated as a
  currently-fillable price -- explicitly rejected for that use.
- Timestamp: `asOf`/provider timestamp field, present per census.
- Freshness: inconsistent across runs (this branch's own current-data-semantics
  audit found current-chain population itself varies run to run).
- Missing: `UNKNOWN`, never zero (existing discipline, correct, unchanged).
- Strategy use: research/candidate screening only (never sizing/pricing).
- Management use: same -- research context for a management decision's
  candidate frontier, never the executable price itself (Alpaca owns that).
- Misleading risk: treating a stale/inconsistent snapshot as "the market
  right now" -- exactly what the execution-quote rejection guards against.
- OOS test: compare Optionomics recorded mid against Alpaca's own quote at the
  same timestamp, across many samples, and report the DISTRIBUTION of the
  difference -- never assume they agree.

**Aggregate Flow (bullish/bearish/top_calls/top_puts/net)**
- Meaning: bucketed, provider-side aggregation of directional premium/volume
  over a window (5-min buckets per this branch's prior-session finding),
  NOT individual trade records.
- Units: premium in USD, counts in trades.
- Fact vs inference: the bucket TOTAL is fact; any "this means buying
  pressure" reading is INFERENCE and must stay unlabeled until tested.
- Timestamp: window start/end, not a per-trade event time.
- Freshness: current net series populated in real census runs; historical
  8h/24h/48h windows returned EMPTY in the same runs -- freshness is
  window-dependent, not uniform.
- Missing: `UNKNOWN` (already enforced -- `netCalls`/`netPuts` typed as raw
  `unknown[]`, never silently parsed).
- Strategy use: as a REGIME input only (e.g. "is aggregate flow net bullish
  or bearish over the last window"), never as a per-contract trade signal.
- Management use: same, at most a portfolio-level regime tilt.
- Misleading risk: directly named in this directive -- volume>OI is not
  automatically "opening," and large aggregate premium is not automatically
  "informed." Neither claim should ever be encoded without a tested rule.
- OOS test: does a flow-regime feature improve after-cost EV beyond what
  VOL/SKEW/TERM already explain, tested as its own ablation rung
  (`FEATURE_ABLATION_FAMILIES` already has `FLOW` at position 4 of 17).

**GEX/DEX/Vanna/Charm heatmap**
- Meaning: provider-computed dealer-exposure PROXY by strike/expiration --
  never a directly observed dealer position (no venue publishes that).
- Units: provider-reported, explicitly UNVERIFIED (Codex's own adopted
  discipline, matching `gex-terminal`'s explicit model-assumption transparency
  -- see the external-repo matrix).
- Fact vs inference: the NUMBER is a provider-computed inference already;
  THETA's own further interpretation (e.g. "this is a wall") is a second
  layer of inference on top of that, and must be labeled as such.
- Timestamp: grid `date` field only, not a live event time.
- Freshness: not separately measured this pass.
- Missing: a grid with zero cells is "not populated," never a zero exposure
  value (existing `optionomics_exposure_heatmap.py` discipline, correct).
- Strategy use: research/regime input, never a standalone entry signal.
- Management use: candidate for a "distance to gamma flip" / "wall distance"
  temporal feature (missing today -- see the gap above).
- Misleading risk: assuming a documented sign convention that hasn't been
  confirmed -- explicitly guarded against already.
- OOS test: same ablation-rung discipline as Flow.

## Flow interpretation model (section 4)

Optionomics' documented contract (per the capability census) exposes only
**aggregate/bucketed** flow -- there is no per-print schema (no sweep, block,
ISO, multi-leg, or execution-side field documented anywhere Codex has probed).
This section is therefore a **design-ahead** model: it specifies the
interpretation discipline THETA MUST apply the moment any provider (Optionomics
or another) supplies print-level flow, built now so the discipline exists
before the data does, and directly reusing this branch's own
`optionomics_flow_event.py`/`optionomics_flow_chain_fusion.py` (built two
sessions ago) rather than re-inventing it.

### Provider fact vs THETA inference -- an explicit table

| Field (if/when supplied) | PROVIDER FACT | THETA INFERENCE (never automatic) |
|---|---|---|
| `execution_side` (Above Ask/At Ask/Mid/At Bid/Below Bid/Inside) | The provider's own classification of where the print landed relative to its own observed NBBO at trade time | "Aggressive buying" (Above Ask/At Ask) or "aggressive selling" (At Bid/Below Bid) -- a REASONABLE but still inferential reading, since a provider's own NBBO snapshot can itself be stale or wrong |
| `option_type` (CALL/PUT) | Fact | Direction ("bullish"/"bearish") is EXPLICITLY FORBIDDEN by this directive -- a call can be a hedge, a spread leg, or a covered-call sale by the SELLER side, and the classification never says which side initiated the trade |
| `premium`/`size` | Fact | "Smart money"/"informed trader" -- forbidden without independent verification; a large premium can be an ETF market-maker hedge, a retail block, or a spread leg |
| `sweep`/`block` flag | Fact, if the provider actually computes and publishes it (not observed in Optionomics' current documented contract) | "Urgency"/"institutional" -- a REASONABLE prior from public options-flow literature (see `Options-Flow-Predictor` in the repo matrix), never asserted as proven for THETA's own data until tested |
| `multi_leg` flag | Fact, if supplied | A multi-leg print explicitly INVALIDATES a naive single-leg directional read -- this is a hard rule, not a soft preference, per this directive's own instruction |
| opening/closing | Almost never a provider fact (OI-based inference at best, one day lagged since OI itself settles once daily per FlashAlpha's own documented cadence table) | MUST remain UNKNOWN unless a specific, TESTED rule (e.g. `volume > available_OI_at_open` as a weak opening signal) is registered as its own hypothesis and shown to add value -- volume > OI = opening is explicitly listed by this directive as a forbidden default assumption |

### Rolling features (research-only, not promoted automatically)

Each of the following is a TEST-status research feature, added to
`experiment_registry.py`'s `FLOW_ABLATION_LADDER` framing (already existing,
one increment at a time) rather than a new parallel registry:

- `net_aggressive_premium`, `call_aggressive_premium`, `put_aggressive_premium`
  -- sum of premium classified Above Ask/At Ask minus At Bid/Below Bid, over a
  bounded rolling window; requires per-print execution-side data THETA does
  not have today (BLOCKED_ON_PROVIDER_DATA, not blocked on code).
- `large_trade_intensity`, `sweep_intensity`, `block_intensity` -- count/rate
  of flagged prints over a window; same blocker.
- `expiry_concentration`, `strike_concentration` -- Herfindahl-style
  concentration of flow across expiries/strikes; computable from AGGREGATE
  data (`top_calls`/`top_puts`) with a defined concentration formula --
  buildable now as a research module without print-level data (a legitimate
  near-term task once prioritized).
- `flow_acceleration`, `flow_persistence`, `flow_reversal` -- second-derivative/
  autocorrelation-style features on the AGGREGATE net-flow series, since that
  series IS current and populated per the census (unlike per-print data) --
  the highest-value NEAR-TERM buildable item in this whole section, because it
  needs only what Optionomics already documents.
- `flow_vs_baseline`, `flow_vs_oi`, `flow_vs_spot_move`, `flow_vs_iv_move`,
  `flow_vs_gex_regime` -- cross-family interaction features, each requiring
  its own ablation rung per section 12's plan (`FLOW x GEX`,
  `FLOW x PRICE_RESPONSE` already named in a prior session's ablation matrix).

## Bid/ask quote-intelligence research (section 5)

THETA's `matchOptionomicsContractIdentity` already enforces the identity
discipline this directive asks for (exact OCC symbol, else exact
underlying+expiration+type+strike, else `UNMATCHED` -- never fuzzy). The
remaining research question is whether, GIVEN that identity discipline, a
`bestBid = MAX(valid contemporaneous bids)` / `bestAsk = MIN(valid
contemporaneous asks)` aggregation across MULTIPLE Optionomics observations of
the exact same contract within a bounded window is semantically legitimate.

**Finding: legitimate as a `TRUSTED_TWO_SIDED_ORDER_PRICING`-ADJACENT research
construct, but NOT promotable to that class today**, for a reason specific to
this provider: `TRUSTED_TWO_SIDED_ORDER_PRICING` in `execution-option-quote.ts`
is currently used only for Alpaca's own two-sided quotes (e.g. IEX stock
exits) -- a provider Alpaca itself vouches for as tradable. Optionomics'
documented contract explicitly disclaims execution use for ANY of its
observations (per the current-data-semantics audit), so no amount of
same-contract, same-window AGGREGATION across still-non-execution-grade
observations manufactures execution-grade provenance -- aggregating several
untrusted numbers does not produce one trusted number. The correct semantic
class for this construct, if built, is a NEW one distinct from the four listed
in section 5 (`RESEARCH_QUOTE`/`MARKET_INTELLIGENCE_QUOTE`/
`ORDER_PRICING_QUOTE`/`NBBO`): a **`MULTI_OBSERVATION_RESEARCH_QUOTE`**, useful
for reducing single-snapshot noise in RESEARCH comparisons (e.g. against
Alpaca's own quote, per the OOS test above), never for pricing an order. This
mirrors this branch's own prior-session `optionomics_flow_chain_fusion.py`
finding: a composite of two research-grade inputs is still research-grade,
not execution-grade, and `ExecutionOptionQuote.sourceSemantics` has no value
for it today -- flagged again here as the same open contract gap, not a new
one.

Rejection rules for the aggregation (all already implicit in
`matchOptionomicsContractIdentity` plus this branch's PIT discipline, restated
explicitly here as the aggregation's own acceptance gate): different
contracts, different expiries, different strikes, different sessions (a
same-day but pre/post-market observation must not blend with an RTH one),
stale observations beyond a caller-justified bound, crossed quotes
(`bid > ask`), non-positive values, and any observation whose provider
timestamp is unknown.

## Temporal intelligence design (section 6)

The state representations below are DESIGNS, not implementations -- no
Production integration is proposed, per this directive's own instruction.

```
IV_STATE = {
  level: IV_HIGH | IV_NORMAL | IV_LOW | UNKNOWN,      # vs own history percentile
  direction: IV_RISING | IV_FALLING | IV_FLAT | UNKNOWN,  # requires >=2 obs
  skew_direction: PUT_SKEW_STEEPENING | FLATTENING | UNKNOWN,
  regime_tag: composed only when all three above are KNOWN -- never partial
}

GAMMA_STATE = {
  gex_level: raw provider-reported value (unverified sign, unchanged),
  distance_to_flip: |spot - gamma_flip_strike| / spot, or UNKNOWN if
    gamma_flip_status != "available" (borrowing FlashAlpha's own explicit
    nullable-with-reason-code pattern -- see repo matrix, ADOPT_METHOD),
  gex_change: requires >=2 observations, same units, same session,
  wall_distance: |spot - nearest_wall_strike| / spot,
  expiry_concentration: Herfindahl of OI/GEX across expiries,
  spot_movement: contemporaneous underlying return over the same window
}
```

Composition rule, stated as a hard constraint: **a regime tag is only formed
when every one of its component temporal features is KNOWN.** A regime built
from a mix of known and UNKNOWN components must itself report UNKNOWN, never
silently drop the missing piece and report a partial regime as if it were
whole -- this is the direct extension of the existing UNKNOWN-never-zero rule
to composed, multi-feature states, and is the main new discipline this
document adds to THETA's existing feature-family policy.

## What Codex would need to build this (not built by this branch)

A durable, timestamp-aware, per-family Optionomics observation history
(HANDOFF.md already flags "the cross-cycle Optionomics context cache is still
absent" as a known limitation) is the prerequisite for EVERY temporal feature
above -- without it, there is nothing to compute a 1-minute or 5-minute change
against. This is the single highest-leverage engineering gap this document
identifies, named precisely so Codex doesn't have to rediscover it: THETA
needs an append-only, per-(underlying, feature-family) observation log with
provider timestamp and ingestion timestamp, queryable for "the last N
observations of family X for underlying Y within window W" -- exactly the
shape FlashAlpha's per-feed `data_as_of` envelope (see repo matrix) implies its
own OWN backend must maintain internally.
