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

## Third source slice: executable outcome analysis and episode materialization

The existing empirical pipeline now consumes `--controlled-pairs` and dispatches
the canonical 10 R8B and 14 R8C comparison definitions to one paired-outcome
analyzer. The canonical dataset readiness gate is retained. It requires a matching
dataset/release, a hashed pair manifest, policy freeze before the decision, PIT
features, common horizon/capital/cost/fill semantics and available resolved labels.
Censored pairs and their dependency clusters remain explicit. Cluster-level paired
means/standard errors are descriptive research, not proof of effective independent
N or promotion. Treatment-decision generation and automatic replay-to-pair exports
remain separate open engineering items.

The same pipeline automatically emits `whole_chain_episode_dataset.json`, joining
management, lifecycle and labels by explicit chain IDs. Candidate scans are not
episodes. Multiple label revisions are retained with unresolved selection rather
than picked arbitrarily. Managed-episode IDs are not assumed to be chain IDs.
An explicit entry-candidate-to-chain join remains required before entry training.
Bounded exported paths are not called complete lifetime paths.

Dependency grouping now uses connected components of shared chain, episode,
underlying/session and correlation-cluster/session evidence. Different decision
IDs no longer inflate same-session N. The legacy `effective_n` field is explicitly
documented as a dependency-component proxy, not calibrated statistical effective N.

Tests exercise registry dispatch, PIT/common-basis rejection, censoring, duplicate
protection, immutable artifact reload, chain grouping and repeated-scan suppression.
No model, strategy or management policy receives Production authority.

## Fourth source slice: feature and readiness truth

Matching requested/served sessions alone no longer claims PIT safety. Identified
provider-known and THETA-first-observed timing must fit the decision and validity
window. Raw nonempty provider objects are OBSERVED_UNQUALIFIED, not known economic
features. The strategy-quality diagnostic is a real shadow-cycle consumer and
retains this distinction in persisted behavior receipts.

The research feature-contribution function now checks quality, decision timing,
expiry and PIT state before ranking. A zero-weight field alone is not a score.
Duplicate candidates/features fail validation and tied scores share ranks rather
than assigning different ranks from input order. This function remains an offline
research consumer, not a live weighted ranker. Empirical status cannot be promoted
by passing a flag to the feature builder.

The DTE-edge diagnostic no longer asserts dominance across different expirations
or returns false when comparison inputs are missing. It records an explicit
common-horizon/missing-objective state. No freshness, spread, strategy or sizing
threshold changed.

The empirical pipeline no longer upgrades research readiness using unverified
walk-forward/OOS flags, candidate-scan counts or session counts as regime coverage.
The separate validation runner executes real split/calibration logic, but a
dataset-bound feature/label join into the central pipeline remains open engineering.
Contract-integrity failures now prevent experiment eligibility, rather than merely
appearing in a report alongside an OK status.

At 14:13 UTC the database read recovered: schema 064, read-only off, one active
lease, GOOD reconciliation, zero positions/open orders, and a fresh persisted
14:10 evidence cycle. The worker remained locked on 36917ee. Prior transient
connection failures remain recorded. This read does not establish a complete
  current-release SPY funnel or R8A maturity credit.

## Fifth source slice: accounting identity and explicit entry joins

The research roll comparison is now v2. A roll's net cash movement is separate
from its marked chain P&L. The old close debit is included in old-leg realized
P&L once, the newly sold option carries an explicit liability, prior chain P&L
and unchanged inventory remain visible, and actual fills cannot be charged a
second slippage deduction. No new liability mark means unknown marked P&L.

The whole-chain resolver records label availability at the actual post-query
evidence time rather than retroactively at chain closure. The close timestamp
remains separate. Invalid times, nonfinite money, blank values and string boolean
substitutes cannot create labels. No existing outcome label is overwritten.

The PostgreSQL export now carries optional `entryChainLinks` within the existing
hashed manifest. This is label-side lineage, not a future feature. It joins the
first unambiguous CSP leg to its actual decision, selected candidate and exact
contract. Python validates and consumes it into the canonical episode dataset.
Old exports without these links retain their explicit missing-link state. The
new family does not infer chains from symbols, timestamps or repeated scans.

The deterministic tests and disposable PostgreSQL export exercise prove code
integration. Real newly filled/resolved chain evidence remains absent, so no L7
or empirical model readiness is claimed. Full feature qualification, training,
model-registry and replay-to-treatment generation remained open at that slice.

## Sixth source slice: dataset-bound entry baseline execution

The canonical pipeline now accepts `--entry-training-policy` and
`--entry-baseline-policy`. Both are explicit frozen research specifications.
The CLI verifies `--source-code-commit` exists on the fetched canonical line.
The entry join requires a selected Conventional CSP candidate, its explicit
ledger-chain link, an actual persisted Alpaca decision quote, correct PIT timing
and a v2 closed-ledger after-cost label. Unknown, censored, revised, late or stale
evidence is excluded with reasons, never filled with zero or a negative label.

Qualified rows enter the existing dependency-grouped purged walk-forward engine.
Only training rows determine scaling and the logistic fit. Validation rows fit
calibrators and forward rows produce metrics. Final OOS remains reserved. The
runner persists reproducible per-run model identities, coefficients, scaling,
calibration and evaluation receipts alongside the dataset and policy hashes.
The target is explicitly whole-chain after-cost positive, not generic POP or EV.
The operation is retrospective research replay, not a claim that these models
were deployed or predicted historical trades in real time.

These are L5 integrated offline components, verified with synthetic fixtures.
No new real resolved episodes exist in this pass, so no empirical or Production
promotion follows. Richer qualified feature vocabularies, automatic challenger
treatment generation and global champion/challenger governance remain open.

The same pipeline now accepts `--entry-ablation-policy`. It refits preregistered
feature subsets with identical observations and purged splits, compares paired
forward Brier loss, and groups repeated scores before reporting uncertainty.
No new field is added to a feature vector by an ablation and no missing fit
becomes zero improvement. This is predictive ablation, not economic strategy
selection or proof of profitability. Shadow threshold ablation and automatic
champion promotion are separate unfinished capabilities.
