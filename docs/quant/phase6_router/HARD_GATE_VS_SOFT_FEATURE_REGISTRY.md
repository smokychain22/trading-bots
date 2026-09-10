# Hard-Gate vs. Soft-Feature Registry

Durability artifact. Names, explicitly, which conditions are allowed to be hard
gates (rare, binary, block everything) versus soft features (influence ranking/size/
structure/confidence, never an automatic veto). This is the registry the task's
"do not turn every imperfect condition into a veto" principle needs to be checkable
against, rather than re-litigated ad hoc at every review.

## Hard gates (rare, justified, already implemented where noted)

| Gate | Where enforced today |
|---|---|
| Invalid/UNKNOWN critical data (quotes, contracts, timestamps, broker state) | `strategy_router.py`'s Layer-0 check; `theta_q_baseline.py`'s `SPREAD_UNKNOWN`/`QUOTE_AGE_UNKNOWN` hard vetoes |
| Market closed for an action that requires it open | Not yet implemented — flagged as a required addition to the scheduler/decision-assembly layer |
| Insufficient buying power | `sizing.py`'s `UNKNOWN_INPUT` path (buying power unknown → qty 0); an explicit "known but insufficient" hard gate is implicit in the sizing cap arithmetic but not a named gate yet |
| Broker not authorized / provider INVALID | `aegis.py`'s `_provider` family (`HARD_VETO` on `provider_state == "INVALID"`) |
| Missing confirmed stock for a covered call | `strategy_router.py`'s THETA-C eligibility check (`stock_shares_held > 0`) |
| Unacceptably illiquid contract | `theta_q_baseline.py`'s `OPEN_INTEREST_INSUFFICIENT`/`VOLUME_INSUFFICIENT`; `option-contract.ts`'s `executable=false` on wide spread |
| AEGIS HARD_VETO | `aegis.py`'s aggregation (strictest family wins) |

## Soft features (influence ranking/size/structure, never an automatic veto)

| Feature | Effect | Where enforced today |
|---|---|---|
| Moderately elevated model uncertainty | Reduces size (`OPEN_REDUCED`), never rejects outright | `opportunity_frontier.py`'s `reduced_size_uncertainty_threshold` check |
| Moderate model disagreement | Classified (`UNCERTAIN_EDGE` etc.), influences size/structure | `ModelDisagreementState` in `strategy_router.py`; full wiring into a disagreement-to-size mapping is a future refinement, not yet built |
| Slightly weaker ownership score (above floor, below "strong") | Currently binary (floor pass/fail) in `ownership_v0.py`/`strategy_router.py` — **a genuine gap**: there is no graded "weaker but acceptable" size adjustment yet, only a hard floor. Flagged for a future session rather than silently implying it already exists. |
| Moderately wider but still executable spread | Feeds `execution_quality.py`'s heuristic fill-probability/slippage estimate continuously, not a binary cutoff (the binary cutoff — `max_acceptable_spread_pct` — is itself a hard gate; below that cutoff, spread still continuously affects the estimate) |
| Moderate regime uncertainty (`RegimeSnapshot.confidence < 1`) | Currently informational only — `regime_v0.py`'s `confidence` field is surfaced but no downstream model yet consumes it to adjust size/structure. Flagged as a gap. |

## Discipline

A new condition should default to **soft** unless it meets the hard-gate bar: the
condition makes the decision *unsafe to evaluate at all* (not merely less attractive).
"Slightly worse" is definitionally soft; "cannot be trusted / cannot be executed /
violates a risk limit" is hard. When in doubt, this registry — not an ad hoc judgment
at implementation time — is the reference.

## Status

Registry reflecting actual current implementation state, with two explicit gaps
flagged (graded ownership scoring, regime-confidence-to-size wiring) rather than
silently assumed to exist.
