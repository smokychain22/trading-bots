# THETA loss cause resolution matrix

Status: Directive item 9 (Wave 3). Grounded in a complete direct read of
`src/theta/thesis-invalidation.ts` (115 lines) and `src/theta/loss-state-vector.ts`
(168 lines), both read in full this pass -- not summarized from a fork.

## Governing design (confirmed by direct read)

`assessThesisInvalidation()` produces a 5-state classification
(`NO_KNOWN_LOSS`/`PRICE_LOSS_ONLY`/`THESIS_FAILURE_SUSPECTED`/
`THESIS_FAILURE_AND_PRICE_LOSS`/`INSUFFICIENT_EVIDENCE`) by ACCUMULATING
named, individually-honest signals -- never a single indicator, never a
probability, never a close/hold/roll verdict of its own. This directly
confirms the directive's core requirement: **the same raw P&L percentage can
map to different classifications depending on which real signals accompany
it**, because `THESIS_FAILURE_SUSPECTED` can be reached with ZERO price loss
at all (e.g. a real `AEGIS_HARD_VETO` signal alone triggers it), and
conversely `PRICE_LOSS_ONLY` requires a real loss but zero thesis-failure
signals.

## Per-cause resolution

| Directive-named cause | Real producer | Persisted | Consumer | Management effect | Classification |
| --- | --- | --- | --- | --- | --- |
| `UNDERLYING_DECLINE` | `loss-state-vector.ts`'s `underlyingDrawdownFraction`/`distanceToStrikeFraction`/`distanceToBreakevenFraction` -- real, computed from current spot vs. entry spot or strike/breakeven | Not independently verified this pass | Reported in `LossStateVector`, but **NOT directly read by `assessThesisInvalidation`'s classification logic** -- `priceStructureBroken()` (thesis-invalidation.ts:65-69) independently recomputes ITM-against-thesis from `spot`/`strike`/`optionType`, which is the actual signal feeding `PRICE_STRUCTURE_BREAK_ITM_AGAINST_SHORT_PREMIUM_THESIS` | Contributes to `THESIS_FAILURE_SUSPECTED`/`_AND_PRICE_LOSS` only via the structure-break signal, not via `underlyingDrawdownFraction` directly | **PARTIAL** -- a real underlying-decline signal exists and is computed, but the classification function reads a narrower, independently-derived structural signal instead of this richer vector field |
| `IV_EXPANSION` | `loss-state-vector.ts`'s `ivCurrent`/`ivAtEntry`/`ivChange` -- `ivChange` requires a caller-supplied `LossStateEntrySnapshot` (not always available; `management-input-state.ts` does not retain entry-time data itself) | Not independently verified | Reported in `LossStateVector` only | **NOT consumed by `assessThesisInvalidation`'s classification at all** -- confirmed by reading the full function body; no reference to `ivChange`/`ivCurrent` anywhere in the classification logic | **STRUCTURAL_ONLY** -- the data plumbing exists (when an entry snapshot is supplied) but is not wired into the actual loss-cause classification |
| `EVENT_DETERIORATION` | `thesis-invalidation.ts`'s `eventStateLabel()` + a direct check: `eventLabel !== null && eventLabel !== 'CLEAR'` -> `EVENT_STATE_<label>` signal | Not independently verified | Directly feeds `thesisFailureSignals` | Contributes directly to `THESIS_FAILURE_SUSPECTED`/`_AND_PRICE_LOSS` | **REAL_AND_REACHABLE** |
| `THESIS_DETERIORATION` | The `classification` output itself IS this concept -- `THESIS_FAILURE_SUSPECTED`/`_AND_PRICE_LOSS` | N/A (this is the classification, not an input) | The classification is the deliverable | This IS the management-facing signal | **REAL_AND_REACHABLE** (as the aggregate concept; see sub-causes for what actually feeds it) |
| `OWNERSHIP_DETERIORATION` | `state.context.ownershipQuality` -- presence-checked (`ownershipQuality !== null`) | Not independently verified | Explicitly added to `uninterpretedSignals`, NEVER `thesisFailureSignals` -- the code's own comment: "no codebase-verified sub-schema this module can safely interpret" | **NEVER contributes to the classification** -- deliberately excluded, not silently ignored (reported via `uncertaintyNote`) | **STRUCTURAL_ONLY** -- presence is real, meaning is deliberately uninterpreted |
| `PORTFOLIO_STRESS` | `state.context.concentration` -- presence-checked only | Not independently verified | Same as above: `PORTFOLIO_CONCENTRATION_PRESENT_UNINTERPRETED`, never counted toward failure | **NEVER contributes to the classification** | **STRUCTURAL_ONLY** |
| `LIQUIDITY_DETERIORATION` | `loss-state-vector.ts`'s `quoteSpreadDollarsPerContract` -- real, computed from current bid/ask | Not independently verified | Reported in `LossStateVector` only | **NOT consumed by `assessThesisInvalidation`'s classification** -- no reference found in the classification logic | **STRUCTURAL_ONLY** |
| `EXECUTION_DETERIORATION` | Same `quoteSpreadDollarsPerContract` field, or `UPSTREAM_FIELDS_NOT_YET_PLUMBED`'s `roll_quality` (explicitly listed as NOT yet plumbed) | N/A | N/A | **ABSENT from classification**; `roll_quality` is explicitly enumerated as a known gap in the module's own `UPSTREAM_FIELDS_NOT_YET_PLUMBED` list | **ABSENT** |

## Additional real signals found (not in the directive's 8-item list, but real)

- `AEGIS_HARD_VETO` / `AEGIS_STATE_ADVERSE_<state>` -- a real AEGIS state check directly feeds `thesisFailureSignals`. This is a genuinely powerful real signal: an adverse AEGIS state alone (with zero price loss) is sufficient to reach `THESIS_FAILURE_SUSPECTED`.
- `DIVIDEND_EX_DATE_RISK_PRESENT` -- real, direct presence check on `state.context.dividendExDateState`, feeds `thesisFailureSignals` directly (unlike ownership/concentration/sector, which are deliberately excluded).
- `SECTOR_CORRELATION_PRESENT_UNINTERPRETED` -- same treatment as ownership/portfolio: presence-only, never interpreted, never counted.

## Explicitly confirmed: the directive's core requirement is met, narrowly

**"The same -100% option P&L must not be treated as equivalent across all
causes"** -- CONFIRMED TRUE for the specific mechanism that exists: a
`-100%` loss with a real `AEGIS_HARD_VETO`, `DIVIDEND_EX_DATE_RISK_PRESENT`,
`EVENT_STATE_<adverse>`, or `PRICE_STRUCTURE_BREAK_...` signal classifies as
`THESIS_FAILURE_AND_PRICE_LOSS`; the identical `-100%` loss with NONE of
those signals present classifies as `PRICE_LOSS_ONLY`. This is a real,
structural, non-cosmetic distinction.

**However, only 4 of the directive's 8 named causes actually drive this
distinction today** (`EVENT_DETERIORATION` via event state, plus the
AEGIS-state and dividend-ex-date signals which aren't in the directive's
named list but are real). `UNDERLYING_DECLINE` is only PARTIALLY wired (a
narrower structural-break check substitutes for the richer drawdown vector).
`IV_EXPANSION`, `LIQUIDITY_DETERIORATION`, and `EXECUTION_DETERIORATION` are
computed as real data in `LossStateVector` but **not yet read by the
classification function at all**. `OWNERSHIP_DETERIORATION` and
`PORTFOLIO_STRESS` are deliberately, honestly excluded pending a verified
sub-schema -- this is NOT a defect, it is the correct behavior for data whose
meaning is not yet safely interpretable, per this module's own stated design
philosophy (never silently guess a sub-schema).

## Classification summary

| Classification | Verdict |
| --- | --- |
| Overall mechanism (accumulate named signals, never one indicator) | REAL_AND_REACHABLE |
| EVENT_DETERIORATION | REAL_AND_REACHABLE |
| UNDERLYING_DECLINE | PARTIAL |
| IV_EXPANSION | STRUCTURAL_ONLY |
| LIQUIDITY_DETERIORATION | STRUCTURAL_ONLY |
| EXECUTION_DETERIORATION | ABSENT |
| OWNERSHIP_DETERIORATION | STRUCTURAL_ONLY (deliberately) |
| PORTFOLIO_STRESS | STRUCTURAL_ONLY (deliberately) |
| THESIS_DETERIORATION (aggregate) | REAL_AND_REACHABLE |
