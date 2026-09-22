# THETA loss-cause contract -- Codex consumer wiring (Wave 6 Batch I close-out)

`src/research/loss-cause-integration-contract.ts` (commit `7e37843`) is
DONE and not reopened by this note -- this is the missing "exact Codex
consumer wiring instructions" piece the Batch I directive asked for, not a
re-investigation.

## Where this plugs in

`assessLossCauses()` is a pure function: `(positionId, asOf, observedNetPnl,
causes[]) -> LossCauseAssessment`. It does not read any Production state
itself -- every `LossCauseEvidence` row must be assembled by the caller
from real, already-computed signals. It is designed to be called
**alongside**, not inside, `management-action-frontier.ts`'s real action
computation -- as an additional evidence input Codex can choose to consume
when ranking/filtering actions, not a replacement for that frontier.

## Real evidence sources per cause (for Codex to map into `LossCauseEvidence` rows)

- `UNDERLYING_DECLINE`: real underlying price move vs. entry reference (already available wherever `contract.underlyingReferencePrice` / stock mark is computed, e.g. `account-exposure.ts`, `management-input-state.ts`'s `stockMark`).
- `IV_EXPANSION`: real IV delta vs. entry IV (`snapshotContract.iv` in `management-input-state.ts` vs. the persisted entry-time IV, if/when persisted -- currently NOT persisted at entry per prior Wave findings; this is a real `MISSING_PRODUCER` this contract surfaces but does not fix).
- `EVENT_DETERIORATION`: real event-proximity/severity from the Optionomics event pipeline already read into `snapshot.eventState`.
- `OWNERSHIP_DETERIORATION`: real ownership-quality signal (`snapshot.expertPriorState`, currently hardcoded `null` per `theta-shadow-cycle.ts:383` -- another real `MISSING_PRODUCER`, not fixed by this contract).
- `PORTFOLIO_STRESS`: real portfolio concentration/correlation (`snapshot.portfolioExposure`).
- `LIQUIDITY_DETERIORATION`: real spread-widening evidence, e.g. `buildSpreadExecutionBurdenEvidence`'s `quoteState` (already real and tested in `defined-risk-vs-csp-paired-study.ts`).
- `EXECUTION_DETERIORATION`: real execution-quality signal (`snapshotContract.executable`, TCA evidence where present).
- `THESIS_DETERIORATION`: the existing real `position-path-state.ts` path-SHAPE classification can be one real input into this cause's `severity`/`confidence`, but this contract's `THESIS_DETERIORATION` cause is broader (evidence-driven, not shape-only) -- Codex should not conflate the two into a single call site without deciding which one is authoritative for that cause.

## What this note deliberately does not do

It does not hand Codex a ready `riskState`/`snapshot` field mapping the way
`THETA_ASSIGNMENT_CAPACITY_RESOLUTION.md` does, because several of the
real evidence sources above (`IV_EXPANSION`'s entry-IV baseline,
`OWNERSHIP_DETERIORATION`'s `expertPriorState`) are themselves
`MISSING_PRODUCER` gaps already known from prior waves, not new findings
of this pass. Wiring this contract into a live consumer is gated on those
producers existing, not just on this contract existing. This is
research-only infrastructure (`brokerAuthority: false`) until those
producers are real.

**Codex handoff status: READY** for causes with a real evidence source
today (`LIQUIDITY_DETERIORATION`, `PORTFOLIO_STRESS`, `EVENT_DETERIORATION`,
`UNDERLYING_DECLINE`, `EXECUTION_DETERIORATION`); **BLOCKED on
MISSING_PRODUCER** for `IV_EXPANSION` and `OWNERSHIP_DETERIORATION` until
their upstream producers are built (not this pass's scope to build, per
`docs/OWNERSHIP.md`'s split).
