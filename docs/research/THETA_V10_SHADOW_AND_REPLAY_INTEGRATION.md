# V10 shadow comparison and replay integration

This receipt describes source wiring, not real-worker observation or profitability.
Starting main and locked worker: `05bb4422a727ffe9793d82442c74722721c698dc`.

## Implemented paths

1. Canonical Q/H/D candidates -> identity/BBO/structure validation -> same-underlying,
   same-expiration, one-analytical-lot normalization -> existing common-horizon
   comparator -> structural credit/capital/theoretical-loss/spread Pareto set ->
   adaptive shadow receipt -> existing `trade.canonical_strategy_frontier.frontier_json`
   persistence -> existing dataset export `strategyFrontiers`.
2. Immutable offline episode evidence -> 17-policy replay dispatcher -> PIT and
   execution-cost validation -> HOLD/CLOSE/UNRESOLVED -> estimated exit or censoring
   -> content-hashed local receipt. The CLI verifies evidence-manifest hashes and
   source ancestry against `origin/main`, and refuses to overwrite an artifact.

No new database table, migration, broker client, Production threshold or order path.
Q retains its selected action and quantity. Shadow quantities are analytical units,
not order instructions. Structural Pareto membership is not profitability superiority.
No cross-expiration comparison assumes reinvestment or an invented terminal mark.

## Replay use

`node --import tsx tools/theta-profit-taking-replay.ts --input=<episode.json> --manifest=<manifest.json> --output=<new-receipt.json>`

Input schema lives in `src/research/profit-taking-replay.ts`. A manifest contains
`version=theta-replay-evidence-manifest-v1`, `canonicalSourceSha`, and observations
with `evidenceId` and `normalizedObservationSha256`. Observation hashes use sorted-key
canonical JSON. The input's `sourceManifestHash` hashes the exact manifest bytes.
Existing canonical source ancestry must resolve locally. Caller labels do not prove
that an episode is authentic or empirically sufficient. Preserve source evidence.

Fixed percentage rules are gross premium-capture benchmarks. Net outcomes separately
subtract entry/exit fees and adverse slippage. TIME and DTE parameters are caller-
versioned research policies. Dynamic challengers require dated, common-unit after-cost
continuation forecasts. Missing forecasts censor those paths rather than defaulting
to HOLD. Observed hard risk/event exits can close independently of a missing EV model.
An estimated close at an observed ask is not an actual broker fill.

## Remaining engineering and evidence

- Common-horizon outcome, episode-to-replay export and empirical experiment dispatch
  still need a complete current-source audit and integration. This patch does not
  declare R8B through R8F complete.
- Trained continuation models, managed episode outcomes, empirical thresholds and
  OOS profitability remain unproven. Their null values are preserved.
- The structural bridge passed a real disposable PostgreSQL round-trip in exact
  CI 36005235693, including nested receipt hash and authority assertions. It is
  persisted/reloadable and wired to the runtime caller. Current-worker L7 proof
  remains pending, not inferred from this integration test.
- The replay dispatcher is tested source and has an offline CLI. It is not a trained
  management policy and does not imply empirical or broker authorization.

`EV_MODEL_NOT_EMPIRICALLY_READY`, `PROFITABILITY=EMPIRICALLY_UNPROVEN`, and
`70_TO_80_PERCENT_WR=RESEARCH_TARGET_NOT_PROVEN` remain unchanged.

## Second source slice: diagnostic truth and offline validation

The evidence-completeness diagnostic no longer considers a feature known simply
because no UNKNOWN reason was emitted. Each of the 20 declared feature families
requires positive identified, dated completeness evidence. Empty ownership
components and null AEGIS results are not known. This diagnostic is research-only,
not an additional Production gate or proof that all families have consumers.

Management cohort aggregation rejects duplicate episodes and nonfinite economics.
Terminal worst-episode P&L is now separate from unavailable marked-equity maximum
drawdown. Return per capital-day requires complete denominators and has no extra
synthetic capital day. Lower-tail P&L uses fractional empirical boundary mass.

`research.validation_experiment` now runs a content-addressed offline workflow:
timing manifest -> dependency-group folds -> label-window purge/time embargo ->
training membership/PIT prediction checks -> validation-only Platt/isotonic fit ->
forward-only metrics/reliability bins -> immutable reloadable JSON receipt.

Run with `PYTHONPATH=bots/theta/quant` and
`python -m research.validation_experiment --input <input.json> --output <new.json>`.
The input contract and executable test example are in
`bots/theta/tests/quant/test_validation_experiment.py`. Scores and observations have
separate canonical hashes. The CLI checks source ancestry against origin/main and
refuses overwrites. It does not load credentials or contact a provider. The test
artifact is explicitly DETERMINISTIC_TEST, never REAL_PERSISTED or real performance.

This is calibration/evaluation infrastructure for supplied base-model predictions,
not completion of the full dataset-to-training/model-registry/promotion pipeline.
Final OOS remains untouched. Model promotion and broker authority stay false.
Nonfinite probabilities/features, missing coefficients, a string "false" calibration
flag, nonconverged Platt fitting and isotonic tied-score ordering now fail honestly.

## September 24 open-session evidence

The tested release `36917eeb5ff5f1c45128ee2d467cff08fb1b9d87` replaced the starting
worker through the documented locked installer. At 13:26 UTC one active lease,
GOOD reconciliation, schema 064, zero positions/open orders and all locks were read.
The worker completed a closed-session cycle and reported ONLINE.

The physically read-only open-session probe failed closed at SHADOW_EVIDENCE_SCAN
with POSTGRES_CHECKED_OUT_CLIENT_LOST. The resident worker subsequently reported
HTTP_503 / POSTGRES_ECONNRESET in RUNTIME_EVIDENCE_CYCLE. A bounded 13:46 UTC read
could not retrieve database runtime evidence. Alpaca account, clock, positions,
orders and calendar still returned 200, with zero positions and open orders.
No complete current-release SPY funnel or R8A session credit is claimed. No worker
restart, threshold change, order submission or broker mutation followed the failure.
