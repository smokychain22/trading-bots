# FusionSnapshot Completeness Audit

Durability artifact. Compares this task's requested FusionSnapshot vNext fields
against `src/market/fusion-snapshot.ts`'s actual current implementation, so the gap (if
any) is documented rather than assumed either way.

## Already covered by the existing implementation

`fusion-snapshot.ts`'s `fusionSnapshotInputSchema` already includes: `botId`,
`decisionTimeUtc`, `triggerType`, `marketSession`, `underlyingState`,
`contractCandidates`, `accountState`, `positionState`, `alpacaQuoteState`,
`optionomicsFeatureState`, `eventState`, `regimeState`, `expertPriorState`,
`riskState`, a full `versions` manifest (`strategyVersion`/`featureVersion`/
`riskLimitVersion`/`executionVersion`/`costModelVersion`/`dataVersion`/
`modelVersions`), `sourceProvenance` (an array of per-source records with
`provider`/`operationAlias`/`asOf`/`retrievedAt`/`state`/`contentHash`/`feed`/
`contractVersion`/`truthRole`/`requiredForNewRisk`), `freshnessFlags`,
`unknownFeatures` (with `feature`/`reasonCode`/`provider`), and an
`executableTruth` breakdown (`account`/`contract`/`quote`, each an evidence state).
It already computes a deterministic content hash (`hashJson`/`canonicalJson`) and
enforces `validForNewRisk` fail-closed on any non-`GOOD` required-truth source.
**This already satisfies the large majority of what this task's §32/R1E ask for.**

## Gaps found (real, not previously flagged this precisely)

1. **No explicit `providerHealth` top-level field distinct from `sourceProvenance`.**
   Provider-level health (Alpaca/Optionomics/PostgreSQL/Redis/worker states, per
   `docs/product/OWNER_OPS_IA.md`'s System Health section) is currently only
   reconstructable by scanning `sourceProvenance` for state per source, not a single
   named field. Minor — the information exists, just not under a dedicated name.
2. **No `portfolioExposure` field distinct from `positionState`.** Concentration/
   correlation/sector exposure (needed by `aegis.py`'s `SECTOR`/`CORRELATION`/
   `PORTFOLIO` risk families) would currently need to be derived from `positionState`
   by the caller rather than being a pre-computed, snapshot-pinned field. Whether this
   should be pre-computed into the snapshot or derived downstream is a genuine design
   choice, not resolved here.
3. **`contractCandidates` is typed as `z.array(z.unknown())`** — i.e. the raw
   candidate list has no schema of its own yet. Now that `option-contract.ts` exists
   (this session), `contractCandidates` should be tightened to
   `z.array(normalizedOptionContractSchema)` rather than `z.unknown()` — a concrete,
   easy follow-up, not made in this pass to avoid modifying `fusion-snapshot.ts`
   without a full regression pass on its existing tests in the same sitting.
4. **No dedicated `strategyRouterState` field.** Now that `strategy_router.py`/
   `strategy-router-contract.ts` exist (this session), a FusionSnapshot consumer would
   need to compute routing separately rather than finding it pinned in the snapshot.
   Whether routing results belong *in* the snapshot (since they're derived, not raw
   input) or *downstream of* it is itself a design question — flagged, not resolved.

## Recommendation (not implemented this pass)

Items 3 and 4 are the most actionable: tightening `contractCandidates`'s type and
deciding whether strategy-routing results are snapshot-resident or downstream-derived.
Both are small, well-scoped follow-ups for a future session, not urgent blockers.

## Status

Audit only — no changes made to `fusion-snapshot.ts` in this pass, to avoid touching a
file with its own passing test suite without a full, careful re-verification pass in
the same sitting (consistent with "do not rewrite completed work casually").
