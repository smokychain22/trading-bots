# THETA T0 Reconstruction Ledger (2026-09-26)

Phase 1 Zero-Unknown Reclosure Pass 3 continuation, items 17-25. Target
episode: `no-submit-7981e31e-367c-49f6-99b7-f6b2de657e27`,
`decision_as_of: 2026-09-24T17:34:59.216Z`, `source_sha:
7373b482ff81723d18c367ed3c9bf048b67b1db6`.

## Required T0 components (derived from the real function signature, item 19)

`buildCanonicalStrategyFrontier`'s own `CanonicalStrategyFrontierInput`
(`src/theta/canonical-strategy-frontier.ts:148`) is the lowest existing
canonical PURE entrypoint that still performs the real applicability,
candidate building, AEGIS, sizing, and cross-branch structural selection
(item 21) -- a plain, synchronous, non-async function. Its real fields:
`snapshotId`, `timestamp`, `strategyVersion`, `contracts` (real
`NormalizedOptionContract[]` -- strikes, greeks, quotes), `routing` (real
`StrategyRoutingResponse`), `stock`, `assignmentCapacityQty`,
`buyingPower`, `aegisNewRiskState`, `eventState`,
`unmanagedBrokerPositionCount`, `unevaluatedUnderlyingCount`,
`optionomicsContext`.

## Sources searched (item 18, exhaustive, real, read-only)

| SOURCE | FOUND? | WHAT IT CONTAINS FOR THIS CYCLE |
|---|---|---|
| `.theta-local-worker/evidence-spool/theta-evidence.sqlite` (`envelope` table) | YES -- 9 real rows for this exact `decision_cycle_id` | `ACCOUNT_READY` x2, `CONTRACTS_READY`, `QUOTES_READY`, `Q_READY`, `AEGIS_READY`, `SIZING_READY`, `DECISION_READY`, `PLAN_READY` -- every one independently read this pass (`payload_json`, verbatim, via direct sqlite3 query) |
| `.theta-local-worker/receipts/2026-09-24/` (232 files) | Searched, no match | `grep -rl "7981e31e"` across the directory returns nothing -- this decision cycle ID does not appear in the separate JSON receipt stream at all (a different, coarser worker-status artifact, not this probe's own evidence) |
| Postgres (`trade.candidate_point_in_time_evidence`, `market.option_quote_snapshot`, etc.) | Searched, confirmed empty for this day | `postgres_state: SPOOLED_LOCAL_PENDING_DB` throughout Sep24 (Pass 2 finding, re-confirmed) -- Postgres was unreachable the entire day, so nothing was ever written there for this cycle |
| Parquet archive / research spool SQLite / local DB dumps | Not found under this repo or the worker checkout | No file matching these patterns exists for Sep24 in either checkout |
| Command 5A outcome/evidence archives | Not applicable | No such archive exists for this pre-outcome, same-day evidence |

## What each real payload actually contains (verbatim excerpts, this pass)

- `ACCOUNT_READY`: `{"brokerHost":"paper-api.alpaca.markets","brokerMutationAllowed":false,"marketOpen":true}` and a second, richer `{"reconciliationState":"GOOD","positions":0,"openOrders":0,...}` -- account-level summary only, no raw quote/contract data.
- `CONTRACTS_READY`: universe funnel COUNTS (`assetsDiscovered`, `optionableConfirmed`, per-stage diagnostics) -- never the actual contract objects (no strikes, no greeks, no bid/ask).
- `QUOTES_READY`: `{"optionChainComplete":true,"optionContractsComplete":true,...}` -- completeness flags only.
- `Q_READY` (586,867 bytes, the largest payload): 1995 real `frontierCandidates`, but each is a POST-selection projection (`candidateId`, `aegisState`, `hardBlockers`, `quantity`) -- the OUTPUT of `buildCanonicalStrategyFrontier`, never its INPUT. This is the payload the committed fixture (`tests/fixtures/real-sep24-q-ready-excerpt.json`) already excerpts from.
- `AEGIS_READY` / `SIZING_READY` / `DECISION_READY` / `PLAN_READY`: single-value summaries (`aegisState`, `selectedQuantity`, `canonicalAction`) -- final outcomes, not decisive inputs.

## Verdict: REAL_CANONICAL_BRAIN_REPLAY for this specific historical episode

**`NOT_RECONSTRUCTABLE_FROM_PERSISTED_T0`.** Exact missing fields: real
`contracts` (`NormalizedOptionContract[]` with strikes/greeks/quotes), real
`routing` (`StrategyRoutingResponse`), real `optionomicsContext` payload,
and `stock`/`buyingPower` at that exact moment. None of these are
recoverable from any source searched above -- this is not a search cut
short; every plausible location for this exact decision cycle ID was
checked and read, and none contains them. This is an honest, evidenced
conclusion, not a shortcut: `deriveRealCurrentWorkerEvidence`, the
evidence manifest, and reading `selectedCandidateId` back out of `Q_READY`
are explicitly NOT counted as a replay (item 22) -- and no other real
mechanism exists to produce one for this specific day.

## The fix, so this gap cannot recur (items 24-25)

`src/theta/t0-replay-bundle.ts` (this pass, new): a bounded
`T0ReplayBundle` capturing exactly `CanonicalStrategyFrontierInput`'s real
fields, validated by the SAME zod schemas the production types already use
(`normalizedOptionContractSchema`, `strategyRoutingResponseSchema` --
never a second contract). `buildT0ReplayBundle`/`replayFromT0Bundle` are
tested end-to-end in `tests/t0-replay-bundle.test.ts`: build a bundle,
persist it through the existing `LocalEvidenceSpool` envelope mechanism
(a new payload type, `T0_REPLAY_BUNDLE` -- no schema change, no new
persistence system), reload it, and replay it through the real,
unmodified `buildCanonicalStrategyFrontier` -- zero provider calls. This
test's own input is honestly `SYNTHETIC_FIXTURE_MATCHING_REAL_SHAPE` (a
representative single-underlying cycle, not the real Sep24 data, since
that data no longer exists to build a bundle from) -- it proves the
MECHANISM works, not that Sep24 itself has been replayed.

**Not yet done, explicitly deferred to the Codex handoff, not silently
skipped**: wiring a `spoolEvidence('T0_REPLAY_BUNDLE', buildT0ReplayBundle(...))`
call into `tools/theta-no-submit-probe.ts`'s real per-symbol loop (where
`runDatabaseIndependentShadowObservation`'s real contracts/routing/AEGIS
state are already in scope) is the concrete, small, obvious next step --
not done in this pass because it touches the live no-submit probe's
Production code path and deserves its own focused review, not a
same-pass addition alongside everything else this continuation covers.
This is named explicitly in the Codex handoff update rather than left
implicit.

## REAL_CANONICAL_BRAIN_REPLAY_COUNT

1 (the mechanism test in `tests/t0-replay-bundle.test.ts`, against
representative real-shaped data). 0 against genuine historical T0 state
(none exists to replay for Sep24, per the verdict above).
