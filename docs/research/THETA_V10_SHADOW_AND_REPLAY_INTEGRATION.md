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
- The structural bridge is L4 until PostgreSQL round-trip checks succeed. It is not
  L7 until an aligned worker produces current real data containing the new receipt.
- The replay dispatcher is tested source and has an offline CLI. It is not a trained
  management policy and does not imply empirical or broker authorization.

`EV_MODEL_NOT_EMPIRICALLY_READY`, `PROFITABILITY=EMPIRICALLY_UNPROVEN`, and
`70_TO_80_PERCENT_WR=RESEARCH_TARGET_NOT_PROVEN` remain unchanged.
