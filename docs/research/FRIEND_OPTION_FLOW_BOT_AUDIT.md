# Friend Option-Flow Bot Audit (R6D)

**Source provenance note (read this before anything else in this document):**
no literal source file was placed in this repository or attached to the
conversation. This audit is built entirely from the owner's own prose/pseudocode
description of the bot's pipeline, components, and reported behavior, given
directly in the R6D directive. Every finding below is therefore sourced as
`OWNER_DESCRIPTION`, never `SOURCE_LINE_CITED` -- if the actual source file is
later provided, this document must be re-verified against it line-by-line before
any finding here is treated as confirmed rather than provisional.

```
source_id: FRIEND_OPTION_FLOW_BOT_2026
implementation_evidence: OBSERVED_FROM_SOURCE (as described by the owner, not
                          independently read by Claude -- see provenance note above)
performance_claim: SELF_REPORTED / UNVERIFIED
reported_daily_return: 4-5% daily
```

The performance claim and the extracted methods are tracked as two SEPARATE
evidence streams. The 4-5%/day figure is not evidence that any specific
technique in the pipeline works -- it is one person's unverified, un-audited,
survivorship-exposed self-report, and per the standing "no fabricated
performance" instruction it changes nothing about `EV_MODEL_NOT_EMPIRICALLY_
READY`. It is recorded here only as an `INFERRED`-evidence-class prior for
"someone believes this pipeline shape is worth investigating," identical in
kind to the existing `hypotheses.json` `source_experts` evidence_state
convention (`OBSERVED`/`RECONSTRUCTED`/`INFERRED`) -- this claim is `INFERRED`
at best, since it was never independently reconstructed from a real track
record.

## 1. Pipeline mapped to existing THETA feature families

| Friend-bot component | THETA feature family / existing concept | Status |
|---|---|---|
| Optionomics unusual options activity | `FLOW` (`FeatureFamily.FLOW`, `ablation.py`) | Maps directly -- `FLOW` is `NOT_IMPLEMENTED` today |
| unusual_score | `FLOW` sub-feature | New within `FLOW`, not a new family |
| ask-side/directional flow, aggressiveness | `FLOW` sub-feature (aggressor-side inference) | New within `FLOW` -- see §5 for the leakage/inference caveats this specific sub-feature carries |
| sweep / opening trades / opening-confidence | `FLOW` sub-feature | New within `FLOW` -- see §5, opening-vs-closing is exactly the ambiguity THETA's own doctrine already warns about |
| premium, volume, open interest, volume/OI ratio | `FLOW` sub-features, closely related to existing `credit_collateral`/`contract_iv`-adjacent liquidity concepts already in `hypotheses.json`'s `feature_families_required` lists | Largely representable with existing primitives (volume/OI are already-known Optionomics/Alpaca fields) plus new `FLOW`-specific derived ratios |
| net_calls / net_puts, flow acceleration | `FLOW` sub-feature (temporal aggregation) | New -- a TIME-AGGREGATED flow signal, distinct from a single-print feature |
| quote spread, moneyness, DTE, freshness | Already-existing THETA primitives (`execution_quality.py`'s spread/freshness handling, `dte`/`log_moneyness` already used across `hypotheses.json`, e.g. H-H-01/H-A-04) | **DUPLICATE of existing features -- do not re-derive under FLOW.** Spread/DTE/moneyness are already first-class THETA inputs; the friend bot's use of them is not a new feature, it is the same feature consumed by a flow-ranking step |
| symbol cooldown / global cooldown / candidate dedup | Operational/execution-throttling concerns, not a quant feature at all | **Out of scope for a feature family.** This belongs (if ever adopted) to Codex's execution/scheduling layer, not to `bots/theta/quant/`. Not audited further here. |
| historical follow-through filter | A distinct, genuinely new mechanism (see §4 -- this is exactly the `highest_return`/leakage-risk component) | New candidate feature/filter, **not yet safe to adopt** -- see §4 |
| candidate ranking (composite score) | Conceptually parallels THETA's own cross-symbol economic frontier ranking, but on raw score components rather than after-cost economics | **Do not adopt the ranking mechanism itself** -- see §8; THETA already has a principled ranking mechanism (`cross-symbol-economic-frontier.ts`) that the friend bot's ad hoc weighted sum does not improve on structurally, since it ranks by an unvalidated composite score rather than by after-cost EV/ReturnPerCapitalDay |

**No new hypothesis is warranted for "add flow as a feature."** `hypotheses.json`
does not yet have a FLOW-specific hypothesis (FLOW is `NOT_IMPLEMENTED`/no
registered hypothesis references it directly), so once FLOW has a real THETA
implementation, exactly ONE new hypothesis should be registered --
"flow-derived features add incremental after-cost OOS value once ownership,
event-state, IV, and liquidity are already controlled for" -- not one hypothesis
per sub-feature (unusual_score, sweep, aggressiveness, etc. are all sub-
components of a single mechanism claim, not independently falsifiable
mechanisms). See §24/the flow ablation ladder in
`THETA_FLOW_METHOD_COMPARISON.md` for how the sub-components get tested
incrementally without each spawning its own hypothesis entry.

## 2. Failure-DNA audit

### A. `highest_return` / `current_return` -- leakage risk on the historical follow-through filter

**Status: LEAKAGE_RISK** (not `DEFINITELY_LEAKING`, not `VERIFIED_SAFE` --
the owner's description does not specify the exact field semantics, and per
the explicit "do not guess" instruction this stays a flagged risk, not a
resolved verdict, until the actual provider field definition is inspected).

The described mechanism -- a "historical follow-through filter" that uses a
field named `highest_return` (or `current_return` as fallback) to score
"historical wins" -- is described as being used contemporaneously in the entry
ranking. The critical question this audit cannot answer from the description
alone: does `highest_return` mean "the highest return this alert/symbol has
achieved AS OF THE DECISION TIMESTAMP" (safe, a legitimate point-in-time
historical statistic) or "the highest return this specific alert went on to
achieve over its full subsequent life" (i.e., information that could only be
known AFTER the alert, since the alert's own future price path had not
happened yet at decision time)? The second interpretation is a textbook
outcome/look-ahead leak: it would mean the ranking step silently knows how
the trade "turned out" before deciding whether to take it.

The `current_return` fallback carries the identical risk in a different
shape: "current" implies "as of now," but if "now" in the historical record
means "now, at the time this record was last updated/scored" rather than "now,
at the time of THIS decision," the same look-ahead problem applies whenever
that record was updated using information from after the original alert.

**Required resolution before this mechanism could ever be adopted:** obtain
the actual provider/database field definition (is `highest_return` computed
once at alert time from data available then, or is it a mutable field
recomputed later as the underlying's price moves?). Until that is answered,
per THETA's own point-in-time discipline (`point_in_time_join.py`'s entire
reason for existing), this mechanism is **not eligible for THETA adoption in
any form** -- not `ADOPT_METHOD`, not `ADAPT`, not even `TEST_ONLY`, since a
`TEST_ONLY` backtest run on leaking data would produce a fabricated result
indistinguishable from a real one, which is the exact failure mode
`chain_resolution.py`/`walk_forward.py` exist to prevent.

### B. Opening-flow inference from `size > open_interest`

**Status: LEAKAGE_RISK for the FALSE-NEGATIVE direction is low, but the
inference itself is materially overconfident as an "opening" signal.**

`size > OI` is a real, commonly-used heuristic (if a single print's size
exceeds the currently reported open interest, that specific print cannot be
entirely closing existing positions) but it is a NECESSARY, not SUFFICIENT,
condition for "this was opening interest," and it is subject to several
concrete confounds the owner's description does not appear to control for:

- **Stale OI.** Exchange-reported open interest typically updates once per
  day (start of session), not intraday. A trade late in the session can
  appear to exceed OI simply because same-day opening trades earlier in the
  session haven't yet been reflected in the OI figure being compared against
  -- this makes `size > OI` MORE likely to fire on an ordinary busy day,
  independent of whether the specific print was actually opening interest.
- **Same-day volume double-counting.** If multiple prints happen the same
  day, comparing each one individually against the same (stale, pre-session)
  OI baseline can flag several prints as "exceeds OI" when only their SUM,
  not each individually, actually exceeds the day's true OI change.
- **Multi-leg trades.** A single-leg print that is one leg of a spread,
  collar, or hedge is not standalone directional opening interest even when
  it is genuinely new interest -- the size comparison cannot distinguish
  "opened a naked directional position" from "opened one leg of a four-leg
  structure."
- **Closing trades and rolls.** A roll (BTC old + STO new) can produce a new
  print whose size exceeds OI in the NEW contract while being a pure
  continuation, not a new directional conviction, of an existing position.
- **Reporting timing / delayed or corrected prints.** Exchange/OPRA
  reporting delays and post-hoc trade corrections mean the print observed
  "live" may not reflect final, corrected volume/OI figures.

**Required confidence/provenance semantics, if this were ever adopted:** the
opening/closing classification produced by `size > OI` must be represented as
a probabilistic/uncertain signal (e.g. `OPENING_LIKELY` / `OPENING_UNCERTAIN`
/ `NOT_OPENING`), never as a boolean "is opening interest" fact, and any
downstream use must carry that uncertainty forward rather than silently
treating `size > OI` as ground truth. This is consistent with THETA's existing
three-valued (`true`/`false`/unknown) evidence convention used throughout
AEGIS and execution-quality inputs.

### C. Flow-confirmation fail-open

**Status: LEAKAGE-ADJACENT FAILURE DNA -- a real design defect, not a
statistical leak, but one with the same practical effect (an unvalidated
signal silently counted as validating evidence).**

As described, the 5-minute net-flow confirmation step allows the candidate
through when call/put samples are insufficient or values are malformed --
i.e. `UNKNOWN` (couldn't confirm either way) collapses to the SAME code path
as `CONFIRMED` (the candidate proceeds). This is precisely the "parser
fallback masquerading as a strategy decision" failure THETA's own doctrine
(three-valued AEGIS evidence, "missing/stale optional data becomes UNKNOWN --
never silently coerced") already exists to prevent elsewhere.

**Required fix if this mechanism is ever adopted into THETA:** the
confirmation step must produce exactly one of `CONFIRMED` / `CONTRADICTED` /
`UNKNOWN`, and whether a candidate may proceed on `UNKNOWN` is a named,
explicit, reviewable STRATEGY-POLICY decision (e.g. "THETA-FLOW policy X
requires CONFIRMED; THETA-FLOW policy Y tolerates UNKNOWN with a reduced
weight") -- never an implicit default inside the confirmation function
itself. `bots/theta/quant/research/execution_simulator.py`'s own
`FillProbability.UNKNOWN` convention and `walk_forward.py`'s censored-vs-
resolved distinction are the existing THETA precedent for exactly this kind
of explicit three-way honesty; the friend bot's fail-open behavior is the
negative example this audit exists to name and avoid repeating.

## 3. Flow is not directional truth (restated, preserved doctrine)

Nothing in this audit changes THETA's existing position, restated here per
the directive because a raw options-flow bot's entire premise implicitly
assumes the opposite: large call volume is not automatically bullish, large
put volume is not automatically bearish, a sweep is not automatically
institutional directional conviction, and "ask-side" execution is not
necessarily a naked directional buy. Spread legs, hedges, rolls, closing
transactions, market-maker inventory management, volatility trades, synthetic
stock, and collars can all produce prints that a naive aggressor-side
classifier would mislabel as directional conviction. FLOW, if ever
implemented, remains a **contextual feature family**, never a standalone
trade command -- consistent with `CURRENT_FEATURE_FAMILY_STATUS`'s existing
framing in `ablation.py`.

## 4. Composite score reconstruction (from the described components)

Reconstructed additive structure (as described, not literally read from
source):

```
score = unusual_score
      + sweep_bonus            (if has_sweep)
      + opening_bonus          (if opening-confidence high)
      + volume_oi_bonus        (volume/OI ratio scaled)
      + premium_size_bonus     (total premium/size scaled)
      + aggressive_flow_bonus  (ask-side/aggressor scaled)
      + tight_spread_bonus     (inverse of quote spread)
      + moneyness_bonus
      + historical_win_rate_bonus  (the highest_return/current_return mechanism -- see §2A)
```

| Component | Weight source | Economic rationale (as described) | Likely correlation w/ other components | Leakage risk | Calibration status | THETA equivalent | Duplicate? | Empirical status |
|---|---|---|---|---|---|---|---|---|
| unusual_score | Optionomics-provided | "activity is unusual relative to baseline" | High w/ volume_oi_bonus (both proxy for abnormal size) | Low (provider-computed, presumably PIT) | Uncalibrated (heuristic) | New under FLOW | No | Untested |
| sweep_bonus | Author-chosen constant | "sweeps indicate urgency/conviction" | High w/ aggressive_flow_bonus | Low | Uncalibrated | New under FLOW | No | Untested; conflated w/ aggressiveness |
| opening_bonus | Author-chosen constant | "new positions signal fresh conviction" | Confounded with §2B's `size > OI` uncertainty | **Elevated** (inherits §2B's opening/closing ambiguity) | Uncalibrated | New under FLOW | No | Untested |
| volume_oi_bonus | Author-chosen scaling | "high relative volume signals unusual interest" | High w/ unusual_score | Low-moderate (stale-OI confound, §2B) | Uncalibrated | New under FLOW | No | Untested |
| premium_size_bonus | Author-chosen scaling | "bigger bets matter more" | Moderate w/ volume_oi_bonus | Low | Uncalibrated | Loosely related to existing `credit_collateral`-adjacent sizing concepts | Partial | Untested |
| aggressive_flow_bonus | Author-chosen scaling | "buying at/above ask signals conviction" | High w/ sweep_bonus | Moderate (ask-side inference itself is uncertain, §3) | Uncalibrated | New under FLOW | No | Untested |
| tight_spread_bonus | Author-chosen scaling | "tight spreads mean better execution/more liquid names" | Low w/ others | Low | Uncalibrated | **DUPLICATE** of existing `execution_quality.py` spread handling | **Yes** | N/A -- already a THETA primitive |
| moneyness_bonus | Author-chosen scaling | unspecified rationale | Low | Low | Uncalibrated | **DUPLICATE** of existing `log_moneyness` primitive | **Yes** | N/A -- already a THETA primitive |
| historical_win_rate_bonus | Author-chosen scaling, via `highest_return`/`current_return` | "names with a track record of follow-through are better bets" | Low w/ others (independent mechanism) | **See §2A -- LEAKAGE_RISK** | Uncalibrated | New, but currently BLOCKED per §2A | No | **Not eligible for adoption until §2A resolved** |

**Raw weights are never imported into THETA**, per the explicit instruction.
The correct treatment of every non-duplicate row above is the same
hypothesis-shaped statement, e.g.:

```
HYPOTHESIS: sweep classification has incremental point-in-time,
out-of-sample information after controlling for premium, aggressor-side
inference, IV, liquidity, and regime.
```

...to be tested via the flow ablation ladder in
`THETA_FLOW_METHOD_COMPARISON.md`, never assumed true because the friend's
own bot weighted it `+8`.

## 5. TP/SL anecdote

**Status: ANECDOTAL MANAGEMENT HYPOTHESIS, not proof of anything about fixed
TP/SL exits.** The reported pattern (profitable before adding fixed take-
profit/stop-loss, unprofitable after) is a single, uncontrolled, non-blinded,
self-reported before/after comparison with no walk-forward discipline, no
accounting for concurrent market-regime change between the "before" and
"after" periods, and no separation of "the exit rule was bad" from "the exit
rule was fine but something else changed at the same time." It is registered
as one input data point motivating the `EXIT_FIXED_TP_SL` vs.
`EXIT_DYNAMIC_*` experiment family (see `THETA_MANAGEMENT_POLICY_RESEARCH.md`
§2), not adopted as a conclusion. It is entirely plausible that fixed TP/SL is
economically inferior to a remaining-EV-based exit for reasons that have
nothing to do with this specific anecdote (see the dynamic-management doctrine
already restated in that document) -- but the anecdote itself proves neither
direction.

## Classification summary (GitHub-research-standard form, applied to a
described-not-read source)

| Mechanism | Classification |
|---|---|
| Flow-as-contextual-feature-family (general) | `TEST_ONLY` -- structurally plausible, requires the ablation ladder before any adoption |
| `highest_return`/`current_return` historical follow-through filter | `REJECT` (in its current, unresolved form) -- see §2A; may be revisited only if the provider semantics are confirmed genuinely point-in-time |
| `size > OI` opening-flow inference | `ADAPT` -- usable only as a probabilistic, uncertainty-carrying signal, never a boolean fact |
| Fail-open net-flow confirmation | `REJECT` -- the specific fail-open behavior itself; the underlying confirmation mechanism is `TEST_ONLY` once fixed to a proper three-valued (`CONFIRMED`/`CONTRADICTED`/`UNKNOWN`) contract |
| Composite weighted-sum ranking | `REJECT` as a ranking mechanism -- THETA already has a principled after-cost economic ranking (`cross-symbol-economic-frontier.ts`); individual score components are `TEST_ONLY` as candidate features, never as a pre-weighted score |
| Fixed TP/SL vs. dynamic exit (the anecdote) | `REFERENCE_ONLY` -- motivates, does not resolve, the exit-policy experiment family |
