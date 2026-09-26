# THETA implementation board

## Quoted-identifier backup guard repair, 2026-09-26

- PROVEN_INCIDENT: the governed pre-migration dump completed its custom archive
  and schema dump, then failed during all-table row counts with
  `BACKUP_SNAPSHOT_QUERY_INVALID`. The complete dump was preserved under
  `restore-tests/incomplete-2026-09-25_200045-d383d0e2`; neither `latest` nor
  the previous verified generation was replaced, and no migration ran.
- ROOT_CAUSE: the read-only guard scanned quoted identifiers as SQL keywords.
  A generated `SELECT count(*) FROM "copy".<table>` query was therefore
  misclassified as the mutating PostgreSQL `COPY` statement.
- FIX: the guard now removes SQL strings, quoted identifiers, dollar-quoted
  values, and comments before checking mutation keywords. It still requires
  the original statement to begin with `SELECT`, `SHOW`, or `WITH` and still
  rejects real mutations and data-modifying CTEs.
- REGRESSION_COVERAGE: tests now include the real quoted `copy` schema shape,
  mutation words inside literals/comments, and the existing positive and
  adversarial mutation cases.

## Pre-migration backup guard repair, 2026-09-25

- PROVEN_INCIDENT: the bounded September 25 backup completed its custom archive
  and schema dump, then failed before inventory capture with
  `BACKUP_SNAPSHOT_QUERY_INVALID`. The failed generation remains quarantined
  under `restore-tests`; neither `latest` nor the previous verified generation
  was replaced.
- ROOT_CAUSE: the exported-snapshot guard accepted only SQL beginning directly
  with `SELECT` or `SHOW`. Both canonical inventory files begin with comments
  and a read-only `WITH`, so valid inventory SQL was rejected after the
  expensive dump had already completed.
- CODE_COMPLETE/VERIFIED_SOURCE: the guard now strips leading SQL comments,
  accepts read-only `SELECT`, `SHOW`, and `WITH`, and rejects mutation keywords,
  including data-modifying CTEs. The backup preflights both production
  inventory files before acquiring an exported snapshot or starting a dump.
- VERIFIED_REAL_READ_ONLY: both canonical inventory queries executed through
  one real exported Aiven snapshot and returned a 153-table structure inventory
  plus the global-state inventory. No data mutation, backup promotion,
  migration, or worker restart occurred.
- REGRESSION_COVERAGE: the PowerShell test covers both production inventory
  files, ordinary reads, comment-prefixed CTEs, mutation statements,
  data-modifying CTEs, and stacked read-plus-mutation SQL. Exact CI runs the
  guard test on every push.

## PostgreSQL backend-crash containment, 2026-09-25

- PROVEN_INCIDENT: at `2026-09-25T14:54:45Z`, Aiven terminated a PostgreSQL
  client backend with signal 9 while it was executing the
  `trade.fusion_snapshot` insert. PostgreSQL terminated the remaining server
  processes, performed automatic recovery, and briefly rejected new sessions
  with `53000`. The exact SIGKILL trigger is confirmed. A provider or node
  resource limit is likely, but the kernel-level reason is not exposed and is
  not claimed as proven.
- ROOT_CAUSE_BOUNDARY: the failure occurred before canonical candidate
  enumeration completed. It is infrastructure-deferred evidence, not a Q WAIT,
  AEGIS result, sizing result, finalist result, or strategy result. The worker
  remains unchanged on `af3d43d`, locked and degraded. Orders and broker
  mutations remain zero.
- CODE_COMPLETE/VERIFIED_SOURCE: the full immutable cycle now has one gzip
  source archive with a deterministic content hash. PostgreSQL's hot JSONB
  stores bounded operational projections. The projection retains selected,
  near-miss, best-rejected and open-position contracts. Production mode no
  longer duplicates the full chain into the research chain table, full raw
  Optionomics chain payload, full per-candidate rows, or an unbounded shadow
  opportunity set inside the market-critical transaction.
- CODE_COMPLETE/VERIFIED_SOURCE: the closed-session SQLite/Parquet exporter
  reads the full frontier from the compressed source archive, verifies the
  original frontier hash, and does not mistake the compact PostgreSQL
  projection for complete research history.
- SAFETY_UNCHANGED: no strategy, AEGIS, sizing, quote, event, execution, or
  authorization policy changed. No PostgreSQL evidence was deleted. Migration
  `067_postgres_cycle_evidence_compaction` is additive and must pass the
  governed backup, migration, invariant, and locked-runtime sequence before a
  cutover.
- VERIFIED_SOURCE: 2,307 Node tests passed with 14 skipped, TypeScript, lint,
  build, and the security scan passed. Real migration and current-release
  runtime proof remain pending.
- Full receipt: `docs/operations/THETA_POSTGRES_BACKEND_CRASH_CONTAINMENT_2026-09-25.md`.

## V12 five-strategy and research-storage closure, 2026-09-25

- CODE_COMPLETE/VERIFIED_SOURCE: D now produces an exact, bounded, two-leg
  locked plan from the canonical finalist. It retains both OCC identities,
  sides, strikes, expiry, multiplier, two-sided Alpaca BBO timing, quantity,
  net credit, max profit, max loss, breakeven, capital and evidence lineage.
  The plan is `brokerAuthority=false`, `submissionAllowed=false`, and cannot be
  passed to the existing single-leg Paper action schema.
- VERIFIED_PROVIDER: the authenticated Alpaca Paper account reports options
  approval/trading level 3. Official Alpaca semantics classify that account as
  supporting atomic `mleg` orders, but THETA has no multi-leg mutation adapter
  and D remains research-only. This is capability truth, not execution
  permission.
- CODE_COMPLETE/VERIFIED_SOURCE: D management replay evaluates all 17 existing
  profit-taking challengers with conservative two-leg close economics, explicit
  fees/slippage, and censoring for stale, malformed or unqualified leg evidence.
  Expiration states include retained premium, short-leg assignment with long
  protection, defined max-loss region, pin risk and unknown input.
- CODE_COMPLETE/VERIFIED_SOURCE: Production keeps the canonical frontier and
  decision audit in PostgreSQL, but stops writing the duplicate per-candidate
  relational projection. Dataset export and zero-trade diagnostics fall back to
  the canonical frontier JSON without duplicating rows.
- VERIFIED_REAL_ARCHIVE: a bounded read-only Aiven export projected one real
  canonical frontier into 1,096 research rows in an immutable SQLite WAL. A
  real ZSTD Parquet compaction passed payload hashes, row counts and DuckDB
  read-back. The archive receipt distinguishes persistence-stable hashes from
  legacy embedded hashes and reports partial coverage if its 10,000-frontier
  safety bound is reached.
- CODE_COMPLETE/VERIFIED_SOURCE: the Windows worker performs frontier archive
  and Parquet compaction only while the market is closed. Both are noncritical
  and cannot interrupt reconciliation or trading safety. Production Vercel does
  not write ephemeral SQLite.
- GOVERNED_DEFERRED: migration 065 remains optional Optionomics IV research
  persistence. Migration 066 remains an outage-outbox canonical backfill. Both
  are excluded from this release because schema 064 is sufficient for the
  current locked Paper path and neither is required for the storage cutover.
- SAFETY_UNCHANGED: Q remains the only Paper-facing new-risk branch, and it is
  locked. H and D remain research-only. A and C remain lifecycle-only and need
  broker-confirmed inventory. No rows were deleted, no retention cleanup was
  authorized, and profitability remains empirically unproven.
- Full receipt: `docs/operations/THETA_V12_FIVE_STRATEGY_AND_STORAGE_RECEIPT_2026-09-25.md`.

## Storage authority and Aiven growth closure, 2026-09-25

- VERIFIED_READ_ONLY: Aiven measured 3,812,898,495 bytes across 153 relations at
  `2026-09-24T20:01:26.599Z`. Research history accounts for 2,384.90 MiB,
  short-retention observations 771.88 MiB, indexes 221.45 MiB and TOAST
  2,440.46 MiB. All relations have a governed storage classification. No row
  was deleted, vacuumed, reorganized or migrated.
- CODE_COMPLETE/VERIFIED_SOURCE: storage authority is explicit. Transactional
  trading state and audit receipts remain in PostgreSQL, outage envelopes use
  the existing SQLite WAL, and high-volume research/history uses verified
  Parquet/DuckDB archives. Existing high-volume PostgreSQL writers have not yet
  been cut over, and the registry marks that transition pending. Retention cleanup is ineligible until archive
  manifest, row count, digest, Parquet read-back and schema parity all pass.
- VERIFIED_ARCHIVE: a real 115,813,769-byte sanitized research export was
  compressed into a 3,811,257-byte Parquet archive containing 25,125 rows at
  `C:\ProjectBackups\trading-bots\research-archives\2026-09-25_330cd39_cb9a967a`.
  DuckDB read-back and per-payload hashes pass. The archive proves the mechanism
  but does not yet prove table-by-table Aiven archive coverage, so it grants no
  cleanup authority.
- CODE_COMPLETE/VERIFIED_SOURCE: open-session Windows cycles defer large
  research exports, empirical pipeline work and durable dataset mirroring.
  Closed-session cycles resume pending exports. Trading, reconciliation,
  executable BBO and safety evidence retain resource priority.
- ACTIVE_STORAGE_BLOCKER: the bootstrap storage budget is breached for research
  and TOAST. The total database and observation budgets are at warning. Direct
  timestamp-window counts show 86,652 research rows for 89 completed decisions
  in the latest observed New York session, or 973.62 research rows per decision.
  Comparable session-bound relation sizes are still required before claiming a
  sustained byte-growth rate. Production cleanup remains owner-authorized work
  only after exact relation archive parity.
- Full measured receipt: `docs/operations/THETA_STORAGE_DECOUPLING_AND_AIVEN_AUDIT_2026-09-25.md`.

## Database-resilient observation closure, 2026-09-24

- CODE_COMPLETE/VERIFIED_SOURCE: a durable local SQLite WAL outbox now records
  immutable, hash-chained observation checkpoints with source SHA, decision and
  snapshot identity, provider timestamps, payload hashes, restart-safe
  idempotency, and secret rejection. Local-only evidence is structurally unable
  to authorize a broker mutation.
- CODE_COMPLETE/VERIFIED_SOURCE: the GET-only no-submit fallback can continue
  real Alpaca/Optionomics universe discovery, the canonical Q cycle, AEGIS,
  sizing, decision evidence, and an exact selected-contract Alpaca refresh when
  PostgreSQL is unavailable. It reports
  `BLOCKED_CANONICAL_POSTGRES_REQUIRED`, never `no opportunity` or an approved
  Paper plan.
- CODE_COMPLETE/VERIFIED_SOURCE: migration 066 adds an immutable canonical
  archive for local envelopes. Backfill verifies the local hash chain, source
  SHA, canonical identity, ambiguous outcomes, and is idempotent. The Windows
  supervisor backfills only after two healthy database probes.
- VERIFIED: database failure injection covers ACCOUNT, CONTRACTS, QUOTES, Q,
  EVENT, AEGIS, SIZING, DECISION, and PLAN. Required computation survives and
  mutation remains blocked. Optional H/D shadow failure does not poison Q.
- RELEASE_PENDING: migration 066 still requires the governed pre-migration
  verified backup, Aiven migration/invariant proof, post-migration verified
  backup, exact CI, immutable release, and locked single-worker observation.
  No execution permission changed.

## V10 integration in progress, 2026-09-24

- Replaced the adaptive receipt's unconditional `NO_COMPARISON` with an actual
  same-expiration structural Q/H/D comparison. It persists inside the existing
  canonical frontier and cannot select a broker action. Incomplete evidence and
  cross-horizon economics remain explicit. PostgreSQL round-trip and exact-release
  runtime proof are separate acceptance gates.
- Added an executable offline dispatcher for all 17 profit-taking challengers,
  dated forecast and quote validation, conservative explicit fill costs, censoring,
  immutable-manifest checks and deterministic output. This closes the registry-only
  execution gap for that dispatcher, not empirical management-policy validation.
- Full R8B-F execution integration remains OPEN pending current-source tracing.
  No claim of zero remaining code-solvable V10 work is made by these changes.

Source capability inventory: run `npm run theta:truth` or import
`src/theta/canonical-system-truth.ts`. Current worker, database, broker and
funnel observations come from `npm run theta:truth-runtime`. This board records the history of fixes.
An older row or research matrix cannot establish current-worker or Paper-order
readiness. The decision-critical UNKNOWN denominator is now `COMPLETE`, while
runtime, policy approval and empirical proof remain separate readiness checks.

Started from canonical source `133227cf7c08aca174ed761d162159fea4cd3130` on 2026-09-22. The table includes this implementation wave's source changes, and is not a claim that the running worker has been upgraded. Evidence levels must be kept separate: source, fixture test, authenticated provider, persisted production observation, running worker, broker result, and empirical outcome.

## Non-negotiable operating state

- Master Alpaca Paper only. No live-money authority and no follower submission.
- No forced order, no relaxation of AEGIS, event, corporate-action, quote, sizing, or broker-reconciliation gates to increase trade count.
- The worker was cut over on 2026-09-24 to verified canonical release `f737c76f0e527a667c10e2ada82e97b389519034`. It is `MASTER_THETA_PAPER`, new-risk `LOCKED`, with one active database lease. Alpaca Paper authentication passed, reconciliation was `GOOD`, and both positions and open orders were zero. Read this state afresh before any later release decision.
- The owner reports Aiven Developer-1, 8 GB, during an accidental temporary upgrade and rebalancing. No further plan change, downgrade, evidence deletion, or provider migration is authorized. Aiven's write tests below passed through the existing connection, but this alone does not authorize a worker cutover.
- Research branches can collect candidates, but only the bounded Conventional route may enter the master Paper entry assembler. Research outputs cannot self-promote.

## September 24 closure update

- `5bd1ed3d98b59ce9588ec279e3fef8cb4fea28b0` removes hardcoded dynamic first-Paper UNKNOWNs from the operator path. Each immutable runtime behavior diagnostic now carries sanitized per-symbol event policy, Q lattice/decision, finalist refresh, AEGIS, sizing, Paper-plan and exact pre-submit evidence. The operator derives each readiness state from this persisted receipt. A stage not reached by a natural candidate remains UNKNOWN, a real current blocker remains FAIL with its cause, and the proof surface cannot submit an order.
- `8079a41bdac44ecd4275807ce66b372d680c522e` adds the canonical read-only exact-contract pre-submit proof. `ead5f77f2e3088d87a2a5256b8f8f3da34aeb5fc` keeps quote, event, AEGIS, sizing, Paper-plan, provider validation and provider transport failures distinct in the no-submit receipt. Optionomics is explicitly rejected as execution authority.
- `a5f57fc4adf88436d2fc568511705c191da56663` closes an approved-instrument reachability defect. The universe provider formerly truncated Alpaca's provider-ordered tradable assets before liquidity ranking, then bounded optionability again. Paper authority was assigned to the top two discovered symbols instead of the approved manifest intersection. The sole approved bootstrap instrument, SPY, could therefore be absent from both the scan and Paper authority while hundreds of candidates for unapproved symbols were evaluated. The provider now retains manifest-required symbols only when Alpaca confirms them tradable, carries them through the bounded optionability stage, and assigns Paper authority only to provider-discovered, owner-approved symbols. It does not invent an absent asset, relax eligibility, or authorize another instrument. Focused tests and the full 2,144-test suite passed.
- `79209ca7bc1156843534ab95ed17fdc4ff1c0d76` refreshes canonical source truth after the reachability repair. The UNKNOWN audit is `COMPLETE` with zero avoidable UNKNOWNs. SPY is approved, but first-Paper readiness remains blocked by genuine AEGIS session maturity and natural open-session proof on a current locked release.
- Runtime truth formerly reported `databaseReachable=false` when its core Aiven query succeeded but a later optional evidence aggregate timed out. The diagnostic now separates connectivity from evidence completeness, reports the sanitized failing stage and SQLSTATE, and uses a 5,000-row recent sample for the expensive PIT-lineage summary. The first corrected run exposed `CURRENT_UTC_DAY_SEED / 57014` as partial evidence while keeping reachability true. The bounded query then completed. The final receipt reported database reachable, read-only `off`, schema 064, evidence complete, Alpaca authentication PASS, one active worker lease, good reconciliation, zero positions, zero open orders, and no submitted order timestamp.
- Canonical source `f737c76f0e527a667c10e2ada82e97b389519034` passed the full local release suite and exact GitHub CI run 35975546271. The single Windows worker was then safely cut over from `96b7acccafb7a29e012be3ccd15c64723c32c2c1` to that immutable release. Its first natural closed-session cycle persisted successfully and reported `MASTER_PAPER_MARKET_CLOSED`, new-risk `LOCKED`, follower gate `LOCKED_LOCAL_CONFIG`, live money `NOT_AUTHORIZED`, one active lease, Aiven health `GOOD`, Alpaca health `GOOD`, reconciliation `GOOD`, zero positions and zero open orders. The closed-session no-submit probe returned `MARKET_CLOSED_NO_SCAN`, zero broker mutations and zero submissions. No safety threshold or execution permission changed. The full SPY no-submit funnel remains forward-session work.
- Optionomics qualification v1 produced false generic `CAPABILITY_NOT_PROBED` blockers because it authenticated only the chain operation. Qualification v2 now executes the existing strict normalized adapters for chain, historical chain, net flow, flow aggregates, metrics, gamma, vanna and charm heatmaps, and bounded events. A real authenticated run persisted 13 sanitized family results. Net flow, GEX, vanna, charm, volatility, historical sessions and walls qualified for research use. Chain identity gaps, flow timing, incomplete event pagination, delta-exposure semantics, the lack of a dedicated UOA contract and an absent current gamma-flip value remain exact `PARTIAL` states. Every family remains non-executable, and Alpaca remains executable Paper quote authority.
- A direct authenticated events probe returned page 1 of 3 for the requested macro/Fed/filing window. The adapter now recognizes both nested and top-level pagination, but the observed first page cannot prove bounded negative coverage. Empty results remain distinct as complete or unverified coverage. No empty event result was converted to `false`.
- Runtime truth now queries the latest persisted decision carrying an AEGIS action instead of emitting the hard-coded `NOT_QUERIED` placeholder. The current result is null, meaning no persisted AEGIS decision action has been observed. This does not imply an allow, reject or runtime failure.
- Broker order snapshots no longer default an absent `filled_qty` to zero. The Alpaca Paper adapter now requires strict finite numeric order quantities, preserves an explicit provider zero, and rejects missing, blank, malformed, negative or overfilled evidence. Activity quantity and price fields also reject blank or malformed strings instead of allowing JavaScript numeric coercion to create a zero. This is a reconciliation-truth correction with no broker mutation or execution authority.
- Alpaca position and open-order reads no longer fabricate empty-string identities when a provider row lacks its symbol or order ID. Non-object rows and blank required identities now make the collection `MALFORMED_RESPONSE`, while malformed optional economics remain explicit UNKNOWN and continue to fail closed downstream. No valid empty collection is affected.
- Alpaca calendar and tradable-asset reads now apply the same identity discipline. Invalid calendar dates and anonymous tradable assets fail the provider collection instead of creating an empty session or consuming a bounded universe slot. Valid empty arrays remain distinct from malformed rows, and the approved-symbol retention policy is unchanged.
- Management input assembly no longer turns a malformed reconciliation calendar row into `{ date: "" }`. A malformed explicit calendar is retained as `market.calendarSessions = null` with a named UNKNOWN field, while a valid session is preserved. Expiration and assignment management therefore cannot treat corrupted session identity as usable timing evidence.

## Active vertical slices

September 23 open-session closure receipt: A locked natural no-submit scan on
`47ccac7f22fa46fd69dfcadb67e81514d1b2f4c2` completed three symbols with
zero ready Paper plans and zero broker mutations. Four completed open-session
diagnostics on the running `c40f85b` worker reported 1,092 Conventional
candidates in total, all quantity zero with
`CANDIDATE_SIZING_EVIDENCE_UNKNOWN:AEGIS_UNKNOWN`. This is a concrete risk
evidence block, not an empty universe or a profitability result. At the UTC
day seed check, 1,333 candidate PIT rows included 703 Alpaca-IV-lineage rows
and 1,333 Alpaca-BBO-lineage rows. These are lineage counts, not fully
qualified detector baselines. The latest sampled IV cohorts had zero prior
sessions; spread cohorts were mixed and sometimes current-observation stale;
the gap assessment was ready. `theta:aegis:baseline-progress` reports this
without trading authority. Database migration head is 064 with read-only
setting off. Intermittent PostgreSQL disconnect/57P03 remains observable.
The UNKNOWN audit denominator is COMPLETE. Typed company-event and
corporate-action policies now govern provider limitations without turning
absence into false. SPY is the sole approved bootstrap instrument, and the
new source guarantees its provider-confirmed scan reachability. AEGIS baseline
maturity and current-release open-session proof still block new risk. Do not unlock
new risk or cut over the worker based on the completed no-submit scan alone.

| Slice | Current evidence | Next closure proof |
| --- | --- | --- |
| Database operability, WRITES_RESTORED_NOT_RELEASE_READY | Fresh Aiven capture `2026-09-22_100128-c600e016` passed isolated restore and preserved the previous verified generation. On 2026-09-22 the existing connection reported both read-only settings `off`, database size 688,453,311 bytes and migration head `064_alpaca_corporate_action_observation`. A rollback-safe temporary write, rollback-safe worker-cycle update/readback and immutable quote-ledger insert/readback passed. The quote row count remained 8,755 after rollback. Five newly persisted worker cycles succeeded. No management input/frontier row yet exists, so management persistence remains unobserved. | Confirm the provider transition is fully RUNNING and monitor real storage/memory. Verify management persistence and broker reconciliation on the locked current release; do not restart or unlock merely because DB writes recovered. |
| First-Paper blocker budget, VERIFIED_SOURCE_AWAITING_RUNTIME | The operator status emits `theta-first-paper-blocker-budget-v1` with twelve separate dynamic checks, source and blocker code/class. The current runtime writes a typed immutable `theta-first-paper-runtime-evidence-v1` envelope containing the SPY event policy, Q decision, finalist refresh, AEGIS, sizing, Paper plan and exact pre-submit proof. The operator parses that envelope and derives checks rather than hardcoding UNKNOWN. Any stage not naturally reached stays UNKNOWN. This receipt has no execution authority. | Cut over the locked worker, then observe authenticated current-release event coverage, finalist/pre-submit refresh, AEGIS, positive sizing and Paper-plan evidence during a natural open-session locked no-submit run. |
| Bounded universe discovery, POST_VWAP_FIX_REACHED_PROVIDER_FANOUT | The 14:56:58 UTC authenticated scan proved provider-zero optional VWAP. The narrow adapter now stores that VWAP as unavailable while keeping only valid OHLCV. Vercel's 15:07:26 UTC post-fix request reached six stock-bars calls, 29 option-contract calls, four option-snapshot calls and 24 Optionomics calls. It then timed out at the platform's 300-second function limit before final scan persistence. The prior 15:02 HTTP 503 is separately proven by `ops.runtime_worker_cycle.error_code=POSTGRES_57P03`, and later short runtime jobs succeeded. Alpaca read calls now have a 15-second transport deadline so a stalled call becomes explicit provider uncertainty. The explicit checkout `.env.local` pair still returns 401; Vercel Production broker reconciliation is the authenticated source. No trade eligibility, quote threshold, credential, or safety gate changed. | Prove a complete natural scan and persisted funnel after the read deadline. If it still exceeds 300 seconds, inspect per-stage timing and split or bound research fan-out without weakening Paper safety. Restore the explicit local credential source separately. |
| Bounded option-snapshot expiration scope, DEPLOYED_NOT_RUNTIME_CLOSED | The shadow cycle applies the validated primary and optional short-DTE research expiration envelope to its Alpaca option-chain snapshot read. Previously it fetched all expirations even though contract discovery was bounded. The [Alpaca option-chain API](https://docs.alpaca.markets/us/reference/optionchain) supports both expiration bounds. CI passed, but the 15:35 natural Production scan still timed out at 300 seconds, with its final traced outbound operation the SHOP snapshot request. The existing pagination cap and incomplete-state semantics remain intact, and the Paper strategy/quote thresholds are unchanged. | Use the new sanitized stage trace to distinguish snapshot request/parsing from later merge/orchestration time and memory. Do not call this optimization a runtime fix yet. |
| Shadow-cycle stage timing, SOURCE_TESTED | Production-only structured receipts now mark contract-fetch completion/failure, snapshot start/completion/failure, contract merge and new-risk orchestration with elapsed milliseconds, bounded counts and RSS MB. They contain no provider payload, request URL, broker identifier or credential. All 1,491 Node tests, typecheck, lint, build and security scan passed locally. | Observe the next natural locked cycle and isolate the failing stage; retain `UNKNOWN` on timeout. |
| Aiven transient availability, ACTIVE_RUNTIME_BLOCKER | The first natural cycle after the bounded-snapshot deployment began at 15:27:38 UTC and ended `FAILED` with persisted SQLSTATE `POSTGRES_57P03`, so it did not test the new snapshot scope end to end. A read-only SQL probe immediately afterward succeeded with both read-only settings `off`, approximately 826 MB database size, 15 connections of the 20 allowed and one active connection. The earlier 15:20 request on the prior deployment exited after 251.9 seconds with 708 MB reported by Vercel. These are distinct failures, and no provider-side root cause has been established. | Establish sustained Aiven connection availability, then collect one completed natural scan on the new source before inferring any quote/strategy outcome. Do not restart or unlock the old worker merely to retry. |
| Historical unmatched broker facts, CLOSED_VERIFIED | An authenticated read-only Alpaca reconciliation on 2026-09-22 persisted `GOOD` evidence with zero positions, zero open orders and zero local-only intents. It retained all 11 raw facts: two terminal filled orders, five fills, three fees and one journal. The canonical current-impact classifier found 11 `HISTORICAL_ACCOUNTING_ONLY`, zero current exposure, zero current reconciliation defects and zero unknown current impact. The entry-blocking count is therefore zero while the raw count remains 11. Unknown activity/status semantics and all current positions/orders still fail closed. No broker mutation occurred. | Observe the same classification on the eventual locked current-worker release. Do not rediscover or erase these facts unless contradictory broker evidence appears. |
| Historical broker-fact lineage, CLOSED_VERIFIED | Immutable reconciliation snapshots include hashed-reference observations for each unmatched order/activity plus a versioned per-fact current-impact result and aggregate. Age never participates in classification. Same-cycle order status, positions and settled posted-activity semantics are required. Operator readiness uses the current-impact count and falls back to the raw count for old snapshots without the new receipt. | Locked worker release observation only. Raw facts and original timestamps stay preserved. |
| Option contract executability | Read-only persisted 2026-09-21 Aiven evidence contains 3,876 shadow rows. Exactly 3,299 are `CONTRACT_NOT_EXECUTABLE`: 2,014 stale and wide, 787 wide only, 498 stale only. These detail strings account for all 3,299, so the observed bottleneck is quote age/spread rather than a proven missing multiplier. Provider timestamps exist for all 3,876 rows; quote age at decision was p50 101 seconds, p90 2,664 seconds, p95 3,904 seconds, p99 5,898 seconds. The persisted `ingestion_timestamp` matches decision timing at this granularity, so it cannot yet separate upstream feed staleness from internal scan delay. No quote or executability gate was relaxed. All 3,876 candidate PIT rows lacked a persisted AEGIS assessment, which means not evaluated, not AEGIS rejected. | During an open session, compare exact Alpaca BBO/contract metadata and quote latency to persisted candidate observations. Use fresh finalist refresh where supported. Do not infer a parser defect from stale or wide historical quotes. |
| Executability causal telemetry, SOURCE_TESTED | New non-executable observations retain `CONTRACT_NOT_EXECUTABLE` for compatibility and persist independent codes for missing sides/time, stale quote, wide/crossed market, invalid feed/authority/quality and unverified multiplier. The read-only funnel script reports granular counts and labels legacy rows separately; the September 21 sample is 3,299 legacy rows and zero granular rows. These labels do not alter a trade gate. | Observe new persisted rows on a writable current worker, then compare initial and refreshed rejection reasons. |
| Exact-contract pre-submit quote scope, SOURCE_TESTED | Both Alpaca Paper indicative quote sources now constrain the snapshot request to the approved OCC contract's expiration and strike, then require its exact symbol in a complete provider response. Invalid identity or incomplete pagination returns no quote. This reduces broad-chain work at the final quote boundary but does not change freshness, spread, AEGIS, sizing, or submission authority. Focused mocked-provider tests pass. | Measure authenticated request latency and verify the same exact-contract quote semantics on a locked current release. Finalist refresh upstream of AEGIS remains a separate open item. |
| Candidate quote-age policy, SOURCE_TESTED | The former literal 30-second candidate executability age is now an independently versioned and effective-dated policy. The Paper bootstrap default remains 30 seconds. Invalid or future-effective policy fails closed. The policy version is retained in the immutable FusionSnapshot, and a full mocked-provider cycle proves 40-second-old quotes fail at 30 seconds and pass this one stage at 60 seconds. No Production threshold was loosened. | Measure real quote latency, implement finalist BBO refresh upstream of AEGIS, and separately govern pre-submit age. Do not confuse candidate-stage acceptance with permission to submit. |
| Pre-submit quote-age policy, SOURCE_TESTED | The exact-contract Alpaca refresh now has an independent versioned and effective-dated freshness policy. Its 45-second upper bound preserves the former action-plan-window maximum, while the actual bound is the smaller of that policy and the remaining decision window. Invalid or future-effective policy blocks before broker access. Execution-price evidence records the policy version in its sanitized reason code. | Observe exact-contract refresh age and policy lineage on a locked current release. No order was submitted and no threshold was loosened. |
| Finalist BBO refresh, SOURCE_TESTED | The real shadow/new-risk cycle now builds a deterministic bounded PUT shortlist from structural lattice proximity, fetches each finalist from Alpaca by exact expiration/strike/type, and freezes the refreshed evidence before FusionSnapshot, spread stress, AEGIS and sizing. Candidate, finalist and pre-submit freshness policies are independent and versioned. A missing exact contract, incomplete pagination or provider error fails that finalist closed and remains explicit in `alpacaQuoteState`; it never falls back to an older quote as executable. The refresh stage has no ranking, AEGIS, sizing or broker authority. | Observe open-session provider timestamps and latency on a locked current release. Compare initial and refreshed rejection causes before changing any threshold. |
| Alpaca provider parsing | Strict numeric parsing now keeps blank/boolean/malformed account, contract and quote fields UNKNOWN. Missing contract/snapshot collections are classified malformed, while explicit empty collections remain valid. Fixture tests pass. | Authenticated provider observation and runtime release proof; no quote gate changed |
| Optionomics chain completeness | A malformed row in an otherwise valid options array now makes the response UNKNOWN after success instead of silently dropping that row while claiming a complete chain. Explicit empty arrays remain valid. Fixture tests pass. | Authenticated provider observation and persisted historical coverage proof; Optionomics remains research-only for quotes |
| Alpaca stock-bar integrity | Historical bars now validate page shape, prices, volume, optional counts and basic OHLC relationships before risk/volatility consumers can use them. A malformed page becomes a named provider error; a real zero-volume bar remains valid. Fixture tests pass. | Authenticated stock-bar observation and runtime release proof |
| Shadow strategy reachability | Source now requests a separate Alpaca 2-19 DTE research window, retains router-inapplicable counterfactuals, and passes mocked-provider tests. Research failures stay separately visible from primary contract quality | Observe authenticated open-session rows and confirm persisted H/D contracts and quotes |
| AEGIS stress, SOURCE_COMPLETE_FORWARD_DATA_REQUIRED | The schema-064 Paper path has strict Alpaca exact-contract IV normalization, independent-session baseline assessment and an Alpaca BBO spread-stress detector with cohort-specific maturity. The optional schema-065 Optionomics detector is research persistence and is not required by Paper execution. Missing or immature real-session baselines never become false. | Keep migration 065 deferred and non-blocking. Accumulate independent authenticated Alpaca sessions, then observe current IV, spread and gap assessments on a locked current release. Current quote safety remains mandatory during cold start. |
| AEGIS IV symbol and PIT isolation, SOURCE_TESTED | The bounded multi-symbol scan requests Optionomics IV evidence for each scanned underlying, rejects an assessment whose underlying differs, rejects a conflicting provider-reported metrics symbol, and freezes the live assessment time after the provider observation. A failed research-only breadth challenger remains visible in its own evidence but cannot become a Paper blocker for a champion symbol. The schema-064 Alpaca contract-IV detector remains the required Paper path. Migration 065 is optional research persistence and is deferred without blocking Paper. | Observe per-symbol schema-064 Alpaca IV assessments and source timestamps in a locked current release. Independent real sessions must mature the baseline. |
| Schema-064 locked worker and IV Paper-plan gate, PARTIAL_REAL_DB_PROOF | On a new disposable PostgreSQL 18 database migrated exactly through 064, the current locked `ResidentThetaWorker` initialized and completed two injected evidence cycles without an order-table change. A mocked Optionomics response against real PostgreSQL returned `AEGIS_IV_PERSISTENCE_42P01`, and the worker remained alive. The Production scan now requires a persisted IV assessment before Paper-plan assembly; a real accumulating baseline may use only the existing versioned cold-start exception. Missing tables, provider failures, missing assessments and invalid baselines block. This is a real database and worker-shell proof, not an end-to-end broker/provider cycle. | Run the full current-source broker reconciliation, universe, candidate, AEGIS, management and no-submit cycle against schema 064 with isolated credentials and a disposable database. Observe a locked current release before any cutover or Paper-entry readiness claim. |
| Event and corporate actions | Authenticated Optionomics AAPL metrics reported `expected_moves.earnings_in_sessions` 30/29/28 for September 18/21/22 with exact served dates, while SPY reported null. The adapter now types this as positive-distance-only context, not negative calendar assurance. The public events contract says `company_catalyst` is reserved and not currently populated; the public REST surface does not prove complete future earnings coverage. Alpaca corporate-action negative coverage remains unproven. | Persist and consume positive PIT evidence only where justified. Keep future earnings and corporate-action absence `PROVIDER_LIMITED` or UNKNOWN until a complete supported query contract is proven; do not turn an empty page into CLEAR. |
| Earnings event evidence, SOURCE_TESTED | Canonical FusionSnapshot event evidence now retains Optionomics `earnings_in_sessions` as a typed trading-session distance with provider/session timing, THETA observation timing, response-hash lineage and explicit positive-only authority. Missing, invalid and not-observed states remain distinct. It is never renamed to calendar days and cannot provide negative event assurance. This closes the lost-consumer wiring defect while leaving the narrower provider limitation open. | Observe authenticated known and unknown metrics rows in a locked current release. A complete prospective calendar or governed session-based policy is still required before the final Paper event gate can emit a qualified clear state. |
| Macro/Fed regime policy, SOURCE_TESTED | The bounded Optionomics macro/Fed coverage producer now feeds a versioned `PAPER_BOOTSTRAP_NOT_EMPIRICALLY_OPTIMAL` regime policy. A timestamp-valid event within three calendar days produces true. Complete coverage with no event inside that horizon produces false. Incomplete coverage, count/family mismatch, missing schedule time and invalid PIT timing remain UNKNOWN or INVALID. Company/earnings coverage stays separate. | Observe authenticated true/false/unknown states on the locked current release. R8 may challenge the bootstrap horizon, but the version that generated each state remains persisted. |
| Corporate-action final-gate wiring, SOURCE_TESTED | Production now indexes the safety-enriched scan candidates at the final Paper event gate. A real positive unsupported corporate action therefore survives from the Alpaca producer into final entry gating. The former lookup used pre-enrichment discovery rows and could discard that positive signal. Empty Alpaca results still map to UNKNOWN because publication timing cannot establish bounded negative assurance. Focused regression tests pass. | Observe one positive or controlled replay receipt through the locked current release. Negative assurance remains provider-limited and is not converted to false. |
| Paper-plan event boundary, SOURCE_TESTED | The master Paper entry assembler now requires the underlying's event/corporate-action evidence and independently re-evaluates the canonical gate. Missing coverage, known unsupported actions and known nearby events block plan creation even if a future caller forgets the outer pre-check. The current scan passes its safety-enriched candidate, and a missing candidate falls back to UNKNOWN. No absence is converted to false. | Verify the new argument and blockers in a locked current-source no-submit cycle; prospective company and corporate-action negative assurance remain open provider/policy blockers. |
| Management candidates, VERIFIED_CI_NOT_RUNTIME | A Production-owned Alpaca Paper candidate source now enumerates roll, covered-call and covered-call-roll alternatives without ranking. It checks exact OCC identity, broker root/underlying/style, standard single-equity deliverables, actual multiplier/tradability, pagination, bid/ask, quote timestamp and freshness. Missing or adjusted deliverables are rejected explicitly; `show_deliverables=true` is requested. Batched quote observations enter the existing immutable ledger. The runtime fetches and persists candidates before freezing the management input, and the one bootstrap policy reads only timely persisted alternatives. Provider error, incomplete, stale, invalid and valid-empty remain distinct. Focused fixtures and read-only Aiven management-query syntax checks passed. [CI run 35725794330](https://github.com/smokychain22/trading-bots/actions/runs/35725794330) passed the disposable-PostgreSQL candidate-write/idempotency test and full suite on `bbdfd54cf0b91b2c66bf20fe61bcc9b94a8bca11`. No running worker has observed this path. | After Aiven is writable, run real no-submit provider/management proof, measure latency/coverage, inspect persisted alternatives/rejections and prove each action-plan lifecycle before locked worker cutover. |
| Management assignment capacity, CLOSED_ENGINEERING | The missing `riskState.assignmentCapacity` dependency is removed from the canonical management input. The shared secured-lot calculation now adds only broker-confirmed collateral already reserved for the open short put to current free options buying power. It records account, reconciliation, option-position, strike and multiplier lineage. This avoids treating zero *new-order* buying power as zero capacity for an already-secured obligation. Focused positive, insufficient, stale, missing and non-applicable fixtures pass. The management SQL also passed read-only `EXPLAIN` against Aiven. Do not rediscover the missing-producer issue without contradictory evidence. | Verify persisted account/option-position lineage and ACCEPT_ASSIGNMENT frontier on a locked current-release worker after database recovery. This is a runtime release check, not an open calculation redesign. Broker-confirmed assignment reconciliation remains authoritative regardless of this prospective frontier. |
| Management decision timing, WIRED_SOURCE | The candidate producer now fetches and persists target and current-leg BBO before the management input query and `decisionAsOf` freeze. Input hash/JSON records candidate lineage and rejects future-observed evidence. The policy separately refuses target quotes stale at the frozen decision time. Focused PIT fixtures pass; no worker release has observed this path. | Verify persistence timestamps and action selection against real locked-runtime evidence after database recovery. |
| Strategy authority | Hold-Strike and Defined Risk remain research-only; source selection and Paper plan assembly explicitly reject them. WAIT diagnostics count Conventional candidates separately from research alternatives | Confirm the new immutable source in a locked worker and collect real H/D evidence without promotion |
| Research exports | Some canonical contracts exist; real contract coverage and row counts vary | Versioned immutable evidence IDs, source SHA, PIT cutoff, no synthetic rows |
| Historical replay export, REAL_PERSISTED_EVIDENCE | A read-only canonical exporter now captures the persisted Sep 16, Sep 18 and Sep 21 candidate evidence with explicit `ALPACA_EXECUTABLE_MARKET` and `THETA_PERSISTED_DECISION` authorities, immutable evidence IDs, canonical hashing, source SHA and no broker authority. The first real artifact contains 8,605 candidates across 39 symbols and 17,588 immutable evidence references with zero import-contract issues. Session counts are 139, 4,590 and 3,876. All 8,605 historical rows recorded zero selected quantity, 1,342 were executable at the historical candidate stage, and the legacy data did not persist candidate-level AEGIS state. This is evidence of the former funnel state, not proof that current sizing can never be positive. | Feed the artifact to the research false-reject studies. Open-session current-code observation is still required to separate refreshed quote, AEGIS and sizing effects. Do not infer a fill or a present-day opportunity from historical candidates. |
| First-Paper sizing telemetry, SOURCE_TESTED | The mutation-free one-shot receipt now reports total and Conventional candidates, positive/zero quantity counts, binding sizing constraints, per-candidate AEGIS states and sanitized finalist-refresh timing/counts. It grants no broker authority. A closed-session authenticated run stopped before candidate sizing, so positive quantity remains `NOT_OBSERVED`, not failed. | Observe this receipt in a supported open options session with real finalist refresh, real AEGIS evidence and broker submission disabled. |
| Worker release | Source and worker SHAs differ intentionally | Writable database, verified migration/CI, no-submit test, locked new-risk cutover, observed cycles, no duplicate worker |
| Old-worker HTTP 503 | The earlier `RUNTIME_BROKER_CYCLE` HTTP 503 stopped after Aiven writes resumed. The unchanged `853beb4` worker is now `ONLINE`, gate `LOCKED`, and newly persisted cycles report `SUCCEEDED`. The old local status retained only HTTP status, so the exact former server error code remains unproven even though DB read-only is the leading cause. New source keeps only a strict allowlisted server error code in future degraded status receipts. This source patch is not running on the old worker. | Observe sustained broker-cycle health and prove the sanitized diagnostic on the next controlled locked release. Do not restart solely to explain the former 503. |
| Empirical profitability | Insufficient real independent whole-chain outcomes | After-cost fill, lifecycle, capital-day and loss-tail evidence with walk-forward/OOS before promotion |

## September 23 closure update

- Alpaca account, market-clock and latest-stock-quote adapters now reject a null, primitive or malformed root payload as `MALFORMED_RESPONSE`. Option snapshots preserve a missing or null optional quote/Greeks/daily-bar object as absence but reject primitive and array substitutes. These responses can no longer resemble a valid empty account, closed clock or all-null market snapshot. Focused provider tests, typecheck and lint pass. Runtime release observation remains pending and no broker mutation was attempted.
- Alpaca option-contract expiration identity now uses strict calendar-date validation shared with market-calendar rows and snapshot request bounds. A shaped but impossible date such as February 30 is a named malformed provider response rather than a usable contract. Focused provider tests, typecheck and lint pass.
- The canonical truth register now reflects the active schema-064 Paper AEGIS path. Independent Alpaca IV/spread session maturity, a current observation and locked-runtime proof remain forward-data requirements. The optional schema-065 Optionomics detector remains secondary research and is not a Paper-path migration blocker.
- Read-only broker reconciliation now applies the strict decimal contract to position quantity, entry price, current price, market value, cost basis and unrealized P&L. Blank, malformed and non-finite provider values fail reconciliation instead of becoming zero through JavaScript coercion, while an explicit provider zero remains a known zero. Focused reconciliation tests, typecheck and lint pass with zero mutation calls.
- Execution-side broker schemas now validate order submission instants, activity dates/instants, market-clock instants, calendar dates and exchange-session times. Malformed time evidence can no longer satisfy reconciliation's presence checks or create false GOOD session quality. Nanosecond RFC3339 provider timestamps remain accepted. Focused broker/reconciliation tests, typecheck and lint pass.
- Execution-side broker and reconciliation identities now require nonblank account, position, order, client-order, symbol, activity and linked-order references. Whitespace-only provider values fail before persistence or lifecycle classification instead of creating anonymous evidence. Focused adapter/reconciliation tests, typecheck and lint pass.
- Valid-JSON broker success payloads with an invalid schema now receive an explicit safe category. Read operations report `MALFORMED_RESPONSE`. Submit/replace success payloads that cannot be parsed report `AMBIGUOUS_NETWORK`, requiring reconciliation before any retry because broker acceptance is uncertain. Tests cover malformed clock evidence and malformed mutation responses without exposing payloads.
- Canonical source `7fd1b41885484d333bce30dcc48f38adf64f3d82` passed the complete local release gate after provider and broker-evidence hardening: 2,163 Node tests with 2,149 passing and 14 explicitly skipped, 610 Python tests, typecheck, lint, build, security scan with zero findings across 1,257 paths, and 23 Playwright browser/accessibility tests. Aiven preflight and verification passed separately on schema 064. No order submission or broker mutation was attempted.

- One bounded current-source `theta:no-submit:probe` was attempted in the open session at approximately 14:59 UTC after a short read showed Aiven writable and the old locked worker online. It failed closed with `DATABASE_CLIENT_TERMINATED`, zero broker mutations and zero submissions. A separate short read at 15:00 UTC succeeded with read-only `off`, one active worker lease and the old worker still locked. This is intermittent database connection loss, not a completed no-submit proof. The probe now records a sanitized stage on future failures; it was not retried in this pass.
- The local worker's evidence request is allowed up to 290 seconds, while the server previously issued a 150-second primary-worker lease at request start. The server lease window now covers the bounded 300-second runtime request plus 60 seconds, preventing another host from taking the lease while a normal long request is still in flight. The change is source/CI-level until the locked worker's server requests are observed on the new release; it does not repair Aiven `57P03` or grant order authority.
- A read-only next-session AEGIS diagnostic now uses the actual Alpaca Paper calendar and persisted schema-064 PIT/quote history without inventing a future current quote. The September 23 14:20 UTC snapshot exposed three KVUE put cohorts for the next Alpaca session, September 24. Qualified same-feed IV history contained only one independent session in the two cohorts with any IV rows, against a 20-session minimum. Spread history contained one or two sessions and at most a one-day span, against five sessions and four days. One cohort had no matching IV history at all. The underlying bounded IV read scanned 468 rows, rejected 396 on strict lineage/identity/timing parsing and counted 219 numeric IV rows without proven Alpaca source among those rejections. Those rows were not retroactively promoted. At 14:45 UTC, the latest snapshot instead held three PFE put cohorts; each still had only one qualified IV and spread session. The diagnostic now measures spread temporal maturity using the live detector's ingestion timestamps, separately from provider-session span, so backfilled older sessions cannot fake maturity. This is historical eligibility only, not an IV/spread stress outcome or a Paper allow state. The old `c40f85b` worker remains locked and running.
- A later 14:49 UTC PCG cohort read sampled 1,100 bounded PIT rows. Of 846 IV-parser rejections, 629 lacked proven Alpaca IV-source authority and 217 had an exact option BBO already older than the 30-second capture requirement at receipt. The latter are provider/receipt-age failures, not time spent after candidate construction. The 196 legacy numeric non-Alpaca IV rows are a subset of the 629 unproven-source rows. The diagnostic still reported just one qualified IV and spread session for the observed cohorts. No stale price was promoted.
- The server-side runtime pool now handles and sanitizes idle PostgreSQL client disconnects, with bounded idle and connection lifetime settings. This prevents an idle pool error from becoming an unhandled process error after Aiven rebalancing. It does not retry a failed transaction or resolve the ongoing `POSTGRES_57P03` provider refusal. At 14:36 UTC, Aiven read-only was `off`, schema head remained 064, one worker lease was active, Alpaca Paper reads and broker reconciliation were healthy, and the latest persisted failed evidence cycle still carried `POSTGRES_57P03`. Source and worker remain on different SHAs; no cutover or order submission occurred.
- The schema-064 Alpaca contract-IV authority is source-complete and fixture-tested, with explicit exact-contract BBO and IEX moneyness-reference timing, forward IV-source lineage, independent-session cohorts, persisted FusionSnapshot assessment, and a committed-evidence Paper gate. The bounded Aiven census found zero qualifying old Alpaca IV rows in sampled SHOP/SCHW cohorts, so `BASELINE_NOT_STARTED` remains a real blocker until new source-proven history accumulates. Optionomics ATM IV remains separate research. The worker remains on its prior locked SHA, and no order was submitted. See `THETA_AEGIS_SCHEMA064_IV_AUTHORITY_2026-09-23.md`.
- The September 23 read-only Aiven capture completed a custom archive, schema dump, inventories, checksums and a local PostgreSQL restore, but the restore failed data parity. Structure parity passed. Four actively growing tables differed between the archive snapshot and later live-source row-count capture: `ops.scheduler_checkpoint` by 288, `ops.runtime_worker_cycle` by 90, `trade.broker_reconciliation_snapshot` by 83 and `ops.runtime_worker_event` by 3. Critical digests also failed. The incomplete generation remains outside `latest`; the September 22 verified generation is preserved. The next DR correction must establish one consistent snapshot for dump and parity baselines, including sequence semantics, before migration 065. No backup was promoted and no migration ran.
- The tested 19-commit R7 branch was fast-forwarded into canonical main at `37ad9d2d442e149f32bd9298eb35a50da28852f0`; main CI `35825448574` passed. The old worker remains on `853beb4` with new risk locked. A read-only replay summary of 8,605 real candidates now measures per-session quote age, executability and rejection counts while leaving false-reject and regret metrics unavailable where AEGIS and outcome labels were not historically captured. The WAIT research metric no longer emits numeric zero for missing regret/false-accept denominators. The false-reject analyzer no longer attributes a passing re-evaluation to a code fix without explicit release provenance. See `THETA_PERFORMANCE_AND_REPLAY_RECEIPT_2026-09-23.md`.
- Candidate economics persistence no longer fills an unknown breakeven with the strike or records a zero credit/collateral ratio when collateral is invalid. Incomplete economics now persist as null with `CANDIDATE_ECONOMICS_INCOMPLETE`, zero feasible quantity and a source-level regression test. This is a persistence-truth correction, not a new economic model or release authorization. Locked worker runtime proof remains pending.
- The September 23 Aiven preflight had one transient DNS `EAI_AGAIN`, then passed PostgreSQL 18.6, TLS, ordinary transaction writes with rollback, and read-only settings `off`. It observed 15 of 20 available connections. The latest verified local backup pointer remained September 22, so migration 065 was not started without its mandatory fresh backup and restore checkpoint. The preflight now emits only a bounded error code on failure and never an uncaught connection stack or database hostname. This does not authorize a worker cutover.
- First-Paper readiness now carries UNKNOWN-audit coverage and separate unresolved safety-critical and Paper-entry counts. Each incomplete/nonzero value adds an explicit blocker to the operator receipt, so downstream readiness cannot see an empty blocker list while the provider-limited safety register remains open. Fixture regression tests cover the formerly false-READY case. Current Production still passes `PARTIAL` and unknown counts, so this change does not unlock risk.
- A bounded one-connection current performance read measured a 1.63 GB Aiven database, 3 of 20 connections, and 99 succeeded of the latest 100 worker cycles. Candidate PIT evidence is the largest relation at roughly 629 MB. Seven Optionomics operations have bounded successful-persistence latency samples, while the general `core.provider_request` ledger supplied no endpoint samples and cannot establish provider failure rates. A transient DNS error was classified and independent work continued. No database evidence was deleted or optimized.
- A sanitized read-only inspection verified all six persisted Optionomics event revisions individually. Every row is a GOOD `optionomics.list_events` observation with valid provider-known, THETA-first-observed, decision and scheduled-time ordering. All six are prospective macro/Fed rows. None establishes company/earnings negative assurance. The dedicated receipt is `THETA_EVENT_REVISION_INSPECTION_2026-09-23.md`.
- The UNKNOWN register was recomputed from the current producer state. Positive corporate-action mapping and persistence are built, so their remaining absence problem is now classified `PROVIDER_NOT_CAPABLE`, not an unfinished mapper. The verified event clock producer is resolved. Avoidable open UNKNOWNs fell from six to two. Audit coverage remains `PARTIAL`, so the system is not declared ready.
- The explicit THETA `.env.local` now authenticates read-only Alpaca Paper calls. The staged no-submit scan reached real account, positions, orders, clock, calendar, stock history, contracts, option snapshots, Optionomics chain, flow and context. It produced 30 candidates and reached canonical decision authority. The confirmed closed market correctly produced `SYSTEM_HOLD`, quantity zero and no broker mutation.
- Provider readiness now keeps Alpaca OPRA as `NOT_ENTITLED` while accepting the separately typed healthy Alpaca Paper indicative feed for the isolated Paper workflow. It does not label indicative data as OPRA and does not relax any live-money boundary.
- Aiven currently accepts reads and rollback-safe writes. Migration 065 is still deferred because the governed pre-migration checkpoint has not been refreshed under the owner's no-backup-loop instruction. The IV producer reports the missing table as an explicit persistence blocker rather than crashing the scan.
- The old worker remains online at `853beb4fde989c2f6deb83ad9cb13a9a3e87e76a`, `MASTER_THETA_PAPER`, gate `LOCKED`. Its latest broker, lifecycle, management, observation and evidence scopes all succeeded with zero positions, zero open orders and zero submitted orders. No restart or cutover occurred.
- On 2026-09-23 the explicit THETA `.env.local` returned HTTP 200 for Alpaca Paper account, clock, positions, orders and assets. A staged mutation-free scan discovered 500 source assets, retained 492 exchange-qualified assets, obtained usable bars for 437, confirmed all 30 bounded optionability checks and selected SPY by the declared dollar-volume rank. It reached canonical authority and returned `SYSTEM_HOLD` because the market was confirmed closed. It submitted zero orders. The optional short-DTE research fetch was incomplete and remained an explicit research blocker without weakening the primary Paper boundary.

## September 22 authenticated closure update

- The owner credential bundle was imported through an explicit Git-ignored source with secret-safe output. The canonical THETA loader now authenticates locally against Paper `/v2/account`, `/v2/clock`, `/v2/positions`, `/v2/orders` and `/v2/assets`, all HTTP 200. The prior local 401 was an environment-source collision caused by ambient PowerShell precedence, not an Alpaca account failure. The explicit loader gives `.env.local` precedence and no parent or other-repository environment is scanned.
- The 15:55:46 UTC natural locked scan reached SCHW, SKHY and SHOP. Contract pages took 29-79 ms and bounded Alpaca snapshot pages took 34-49 ms, with 280, 548 and 403 snapshot rows respectively. All three orchestrations completed. The invocation still timed out during post-decision persistence, with only two of the three fusion snapshots committed and no completed cycle receipt. This rules out the option snapshot request itself as the measured dominant bottleneck in that cycle. The source now has Production-only `THETA_PERSIST_STAGE_V1` timings and RSS counts to isolate the next natural cycle's slow write stage. No quote, strategy, AEGIS, sizing, or execution rule changed.
- The latest authenticated good broker reconciliation has zero positions and zero open orders while preserving 11 unmatched historical facts. A versioned same-cycle current-impact policy classifies the two terminal filled orders, five fills, three fees and one journal as historical accounting only. Entry-blocking facts are zero. Their age was not used. The policy and persistence were verified with real Alpaca reads and Aiven writes, and the broker mutation count was zero.
- The 16:07 UTC locked cycle measured a concrete N+1 write bottleneck. A 403-contract symbol reached PIT evidence persistence in 24.6 seconds but did not commit until 110.1 seconds because `trade.shadow_opportunity` was inserted with one database round trip per opportunity. The 548-contract symbol reached the decision stage in 17.8 seconds, but its PIT stage had not completed before the overall function timeout. The narrow correction batches shadow-opportunity inserts inside the same transaction, preserving every row, uniqueness, idempotency and failure rollback. This is source-level until the disposable PostgreSQL test and a later natural Production scan pass; the large PIT stage remains under observation.
- The shadow-opportunity batch correction passed disposable-PostgreSQL multi-row and replay-idempotency tests in [CI run 35752815091](https://github.com/smokychain22/trading-bots/actions/runs/35752815091), and Vercel deployed it. The 16:25 UTC natural Production cycle measured a 417-contract symbol committed in 25.2 seconds and a 403-contract symbol committed in 28.7 seconds. The latter had taken 110.1 seconds in the previous per-row path. The third, 548-contract symbol reached decision assembly in 17.0 seconds but did not finish PIT persistence before the cycle failed with `POSTGRES_57P03`. The performance improvement is observed for two symbols, not a completed full scan. At the later 16:29 UTC read-only check, both transaction read-only settings were `off`, database size was 1,039,005,375 bytes, two connections were visible and the PostgreSQL start time remained 13:23:21 UTC. Intermittent database availability remains a release blocker even when a separate probe succeeds.
- `vercel env run` in this checkout loaded `.env.local`, and all five read-only Paper endpoints returned HTTP 401. From an isolated directory, `vercel env run --environment production` exposed only redacted `ALPACA_*` values to the local process. The actual Vercel Production process then returned HTTP 200 with request IDs present for bounded GETs to Paper `/v2/account`, `/v2/clock`, `/v2/positions`, `/v2/orders` and `/v2/assets`. This proves the Production environment pair authenticates, while the explicit checkout `.env.local` pair is mismatched or invalid for Paper. There is no evidence that another repository's environment file was selected. No credential values were emitted, copied or rotated, and the diagnostic has no broker mutation or trading authority. [CI run 35753988817](https://github.com/smokychain22/trading-bots/actions/runs/35753988817) passed on the final defensive logging source.
- The THETA Vercel variable-name inventory found `ALPACA_API_KEY`, `ALPACA_SECRET_KEY` and `ALPACA_BASE_URL` present in Production and absent from Preview and Development. `APCA_API_KEY_ID`, `APCA_API_SECRET_KEY` and `APCA_API_BASE_URL` aliases are absent in all three scopes and are not required by the current environment schema. The adapter maps the canonical names to Alpaca's `APCA-API-KEY-ID` and `APCA-API-SECRET-KEY` HTTP headers and enforces the Paper host. The source receipt is Production process environment for the successful server-side probe and the explicit THETA checkout `.env.local` for the failed local probe; no parent or other-repository env file was used.
- The old Windows worker remained on `853beb4fde989c2f6deb83ad9cb13a9a3e87e76a`, `MASTER_THETA_PAPER`, new-risk `LOCKED` and follower/live authority unchanged at the 16:29 UTC check. Its status was `DEGRADED` with `RUNTIME_EVIDENCE_CYCLE` HTTP 503 after the same failed scan. The worker was not restarted or cut over. The 16:25 cycle is an interrupted evidence run, not a completed WAIT or an eligible action.
- A second natural evidence cycle at 16:34 UTC also ended `FAILED` with persisted `POSTGRES_57P03`; the prior 16:07 evidence cycle still has no terminal receipt after the platform timeout. Short broker cycles between these failures succeeded. A subsequent read-only SQL check showed the same PostgreSQL postmaster start time, two connections and database size 1,073,272,511 bytes. The provider's exact reason for intermittently refusing connections is not yet proven. The zero-trade diagnostic now reports failed and aged-out `RUNNING` evidence cycles separately from completed opportunity decisions. It never counts an interrupted scan as WAIT, healthy selectivity or a candidate rejection. A read-only Aiven `EXPLAIN` used the recent-cycle index; all 1,494 Node tests, typecheck, lint, build and security scan passed locally for this diagnostic-only change.
- On September 23, a bounded preflight against current Aiven passed SSL and rollback-safe writes with both read-only settings `off`. The migration head remained 064, size was 1,633,760,959 bytes and 16 of 20 connections were in use. One authenticated Optionomics metrics read through the current IV producer then returned `AEGIS_IV_PERSISTENCE_42P01` because schema 065 was absent. The result was sanitized, no assessment was persisted, and no order path was invoked. This confirms the real provider and database failure boundary, but it does not prove a full current-source runtime cycle or authorize migration/cutover.
- The September 23 AEGIS source wave added same-feed Alpaca spread baselines, candidate-specific liquidity/execution inputs, current-open versus previous-completed-close gap evidence, explicit zero-MAD fallbacks and session/maturity state. Authenticated Optionomics SPY metrics and options reads returned current-session IV values but no usable provider as-of timestamp. The IV assessment now preserves `PROVIDER_ASOF_UNAVAILABLE` and cannot certify either no shock or the Paper cold-start exception from that session label alone. These changes are source-tested, not current-worker proof. Migration 065 remains unapplied.
- The single bounded September 23 pre-migration backup attempt lost its Aiven connection during a long custom dump of `trade.candidate_point_in_time_evidence`. The exported snapshot keeper disappeared, so that run could not establish dump/restore parity. No new generation was promoted; verified September 22 `2026-09-22_100128-c600e016` and previous September 21 `2026-09-21_215137-51b9c85f` remain preserved. The backup script now fails fast after an exported-snapshot dump failure instead of retrying against a dead snapshot. No further backup attempt, migration, worker cutover or execution unlock occurred in this wave.

## September 23 PostgreSQL resilience source wave

- A current-worker receipt on `c40f85ba740b1e918824d1454f783b7bd275bffd` recorded another locked `RUNTIME_EVIDENCE_CYCLE` HTTP 503 with `POSTGRES_57P03`. A short sanitized Aiven read later succeeded with read-only off, five of twenty connections and one active lease. An older `RUNNING` evidence cycle remained stranded while a later cycle succeeded. The provider-side reason for intermittent 57P03 is still unproven. A separate AEGIS read diagnostic failed with `POSTGRES_CONNECTION_TERMINATED`, so short-read success is not a stability receipt.
- Source now classifies transient connection errors separately from permanent SQL/auth errors, disposes broken checked-out clients, retries only bounded read operations on fresh clients and never replays an uncertain write. An ambiguous COMMIT is accepted only if a fresh identity check proves the atomic write. Aged `RUNNING` runtime cycles are marked failed, not WAIT, on a later healthy cycle. The supervisor enters a lightweight database-and-lease probe mode after a safe PostgreSQL 503 and requires two successes before a full scan. A worker restart, cutover, migration and execution unlock have not occurred.
- New-risk Paper plan assembly and persistence require `DERIVED_FROM_REAL` AEGIS input lineage in addition to the selected AEGIS state. A manual or fixture-derived ALLOW cannot enter the new-risk plan queue. This is source-tested, not yet a current-worker observation. Existing decision receipts without that lineage remain blocked from new-risk enqueue.
- Remaining release blockers include sustained Aiven availability, migration 065 with its verified pre/post backup workflow, authenticated complete real no-submit evidence, locked current-release runtime observation, prospective company-event/corporate-action assurance, and AEGIS IV provenance/baseline maturity. Other transaction paths, including Paper action-plan state transitions, still require a separate checked-out-client failure audit. No first-Paper readiness or empirical profitability claim follows from this source wave.

### Execution-critical transaction closure

- The nine remaining raw P0 transaction methods were converted to `withRuntimePostgresTransaction`: new-risk plan enqueue, atomic management-plan publication, action-plan claim, action-plan transition, order-intent transition, trade-update/fill application, management-only Paper authorization, first-canary authorization and operator-control application. Order-intent insertion and execution-attempt writes also gained deterministic ambiguous-commit verification. No broker POST is retried by this database layer.
- Fresh-connection reconciliation verifies action-plan identity and content hash, complete management decision/plan groups, worker claim window, transition target and order-intent link, deterministic order intent and provider order, provider event/fill identity, Paper authorization state and operator idempotency key. Absent state remains `POSTGRES_COMMIT_OUTCOME_UNKNOWN`; conflicting state raises a named reconciliation conflict. Failure-injection tests cover lost COMMIT responses, absent and conflicting action-plan state, complete management groups, claims, submitted plans, broker-order transitions and fills.
- A bounded preflight after these source edits reported PostgreSQL 18.6, SSL enabled, both read-only settings off, rollback-safe write PASS and 16 of 20 connections at that instant. A later lightweight diagnostic reported four connections, one active lease, approximately 2.04 GB database size and multiple completed broker/lifecycle/management/observation/evidence cycles on the still-pinned `c40f85b` worker. This is a stable cutover window, not proof that intermittent Aiven failures are permanently gone.

### Current locked release and governed entry-safety closure

- Canonical main `4ff999b13bfd9ba1caeca80d875690b3388f42d7` passed the full local release suite and GitHub CI run 35898049592. The Windows worker was safely cut from `c40f85b` to the same immutable SHA with new risk locked, follower execution locked and live money disabled. Exactly one local supervisor remained. The current worker acquired the lease and completed natural broker, lifecycle, management, observation and evidence cycles. No order was submitted.
- `CompanyEventPaperPolicy` now keeps operating-company earnings, qualified non-company funds and macro/Fed coverage separate. Optionomics `earnings_in_sessions` remains `TRADING_SESSIONS`. The policy counts Alpaca exchange sessions through the selected expiration and never derives calendar days. Unknown instrument class, incomplete session coverage, company coverage uncertainty and invalid PIT evidence block explicitly.
- `CorporateActionPaperPolicy` now distinguishes relevant positives, adjusted contracts, provider errors, incomplete pagination, unknown negative assurance, qualified clearance and the bounded Paper-only fallback. The fallback requires a tradable exact OCC contract, ordinary equity deliverable, multiplier 100, approved instrument, one-risky-underlying scope, good reconciliation, approved AEGIS and a fresh quote. Empty provider results never become qualified absence.
- New contract discovery requests Alpaca deliverables, and the normalized contract/frontier preserves `STANDARD_EQUITY`, `ADJUSTED` or `UNKNOWN`, plus tradability and exercise style. The content-addressed safety receipt is required independently by new-risk plan assembly and again at final handoff. Management plans are not forced through the new-entry policy.
- The decision-critical evidence denominator is a machine-checked 43-field registry. The legacy nullable event/corporate fields are resolved through governed typed policies, and the unsupported calendar-day earnings field is retired. The current UNKNOWN audit is `COMPLETE` with one avoidable Paper-entry blocker: the Production instrument-classification manifest has no approved entries. It was intentionally not populated from research ETF labels, ticker knowledge or inferred provider absence.

## Release sequence

### September 24 canonical Q-decision integration

- The locked worker was cut over from `853beb4` to verified main `a96b321577996b15cfd33646890afc3230d0eb96` after CI 35940392430 passed. It reported `MASTER_THETA_PAPER`, execution `LOCKED`, one active lease, good broker reconciliation, zero positions and zero open orders. No broker mutation or order submission was attempted. This observation is not an open-session candidate or AEGIS-allow proof.
- Current-source tracing found a real Paper-facing selection gap: the canonical strategy frontier could choose the first structurally feasible Conventional put without binding to `NewRiskDecisionReceipt`, which had already performed the Python-backed after-cost economic and execution-quality selection. That could mislabel an economic WAIT or choose a different candidate by structural/lexical order.
- Source now passes per-contract THETA Q action feasibility and the immutable Q decision receipt into the canonical frontier. An OPEN requires the same snapshot and decision timestamp, exact underlying and contract, positive Q quantity, structural risk feasibility and positive canonical sizing. Selected quantity is capped by both authorities. A Q WAIT/PASS stays non-OPEN; mismatched, unavailable or held decision evidence stays `SYSTEM_HOLD`. H/D remain shadow/research, and broker authority is unchanged.
- Regression tests cover infeasible lattice candidates, missing Q evidence, economic winner identity, WAIT and mismatched evidence. Source-level verification passed 2,168 Node tests with 2,154 passing and 14 skipped, 613 Python tests, typecheck, lint, build, 23 Playwright checks and a zero-finding secret scan. Locked-runtime observation of this new source is still pending a CI-tested immutable release and safe cutover.
- A follow-up current-source audit found that `GLOBAL_WAIT` completeness used all research/shadow branches, so missing Hold-Strike/Defined-Risk evidence could relabel an otherwise complete Conventional economic WAIT as `SYSTEM_HOLD`. Paper-facing completeness, sizing-unknown and top-level near-miss/rejected references now use only Conventional evidence. H/D incompleteness remains visible in its own branch receipts and cannot acquire Paper gate authority. This follow-up is a separate source change and needs its own CI and locked-runtime release proof.
- A further Q-lattice trace found that the Python Q path intentionally evaluates a filtered subset and can return `thetaQ=null` when every candidate fails quote freshness. Unassessed contracts outside that lattice are now known exclusions, not `MISSING_INPUT`; when Q is null no lattice map is supplied. The immutable Q receipt still prevents an OPEN and preserves its real WAIT. Tests cover both an excluded contract and a null-lattice freshness WAIT. This is a source correction after the earlier CI, pending its own CI and runtime proof.
- The top-level earned-WAIT reason now states `PAPER_AUTHORIZED_BRANCH_EVALUATED`. It no longer claims all applicable research branches were evaluated when H/D inputs are incomplete.

1. Merge only tested source changes. Record branch-level provenance and CI.
2. Recover Aiven through a supported method. Do not prune evidence to make space.
3. Verify fresh local backup and database write health.
4. Reconcile Alpaca Paper account and orders without mutation.
5. Run real provider no-submit evaluation and verify all safety gates without a fabricated candidate.
6. Cut over one worker with new risk locked, then observe runtime SHA, DB writes and multiple natural cycles.
7. Consider controlled Paper entry only after a separate readiness receipt. Follower and live-money execution remain locked.

No item is complete merely because its type, config, fixture, or UI label exists. An `UNKNOWN` is closed only by a real producer plus valid authority, timing, persistence, consumer wiring and runtime evidence.

## V10 September 24 second integration slice

- VERIFIED: common-horizon structural shadow receipt persistence on disposable
  PostgreSQL in exact CI 36005235693. Worker cut over locked to 36917ee, one lease
  and GOOD broker reconciliation observed before the open-session database failure.
- CLOSED_SOURCE_DEFECT: absent feature errors no longer mean all 20 features are
  known. Empty ownership and null AEGIS cannot count as known diagnostics.
- CLOSED_SOURCE_DEFECT: management cohort RPCD uses complete actual capital-days,
  worst episode P&L is not labeled drawdown, duplicate episodes cannot inflate N.
- CODE_COMPLETE/TESTED: PIT-purged offline calibration runner, immutable manifests,
  validation-only fitting, forward metrics, reliability bins and reloadable output.
  CLI integration is tested with explicitly synthetic data, not empirical proof.
- CLOSED_SOURCE_DEFECT: nonfinite calibration/model inputs, missing coefficients,
  string-false calibration flags and isotonic tied-score handling fail honestly.
- EXTERNAL_BLOCKED: current-release SPY no-submit proof encountered PostgreSQL
  connection loss. Latest local worker error identifies POSTGRES_ECONNRESET. Keep
  it locked, do not restart for this transient provider failure.
- OPEN_ENGINEERING: complete episode-to-replay export, governed R8B/C/D experiment
  dispatch and full dataset-to-base-model training/registry integration. Do not
  relabel these engineering tasks as merely missing future outcomes.
- WIRED/TESTED: canonical empirical pipeline dispatches paired-outcome analysis
  for the existing 10 entry and 14 management comparison definitions and persists
  receipts. Readiness, PIT, common-basis and censoring gates remain active. This
  does not yet generate each treatment's policy decisions automatically.
- WIRED/TESTED: canonical whole-chain materializer emits explicit chain joins,
  preserves unresolved/revised labels, and does not invent chains from scans.
- CLOSED_SOURCE_DEFECT: dependency counting no longer splits repeated same-symbol
  session scans merely because their decision IDs differ. Count remains a stated
  dependency-component proxy, not empirically validated independent N.
- CLOSED_SOURCE_DEFECT: historical date agreement cannot establish PIT safety
  without observation lineage. Raw nonempty provider context is not known data.
- CLOSED_SOURCE_DEFECT: shadow contribution excludes expired/unqualified/zero-
  weight evidence, rejects duplicates and gives deterministic shared tie ranks.
- CLOSED_SOURCE_DEFECT: DTE-edge dominance requires the same horizon and complete
  objectives. Missing comparison evidence remains null with an exact reason.
- CLOSED_SOURCE_DEFECT: caller walk-forward/OOS flags cannot upgrade central
  pipeline readiness. Candidate scans cannot stand in for labeled training rows.
- OPEN_ENGINEERING: central export-to-feature/label join and training integration
  remain required. Independent calibration and paired-outcome runners are working
  research infrastructure, not a complete autonomous empirical program.
- OBSERVED 2026-09-24T14:13Z: Aiven readable/read-only off, one active locked worker,
  GOOD reconciliation, zero positions/open orders, and fresh 14:10 evidence.
  Exact-source alignment and a complete current-release SPY proof are still owed.
- CLOSED_SOURCE_DEFECT: observed locked cutover exposed a supervisor mutex race.
  A non-owner exit previously ran lease-release/OFFLINE cleanup. Cleanup and stop-
  flag removal now require ownership. The installer waits boundedly for the old
  supervisor's mutex release before changing runtime identity. Real Windows AST
  execution tests prove a non-owner performs no lease/status mutation and the
  owner still cleans up. This fixes ownership, not PostgreSQL availability.
- OBSERVED 2026-09-24T14:27Z: source and worker aligned on 38fef55, one active
  lease, GOOD broker reconciliation, zero positions/open orders, schema 064,
  read-only off, master/follower locked. The subsequent physically read-only
  current-release scan failed at SHADOW_EVIDENCE_SCAN with
  POSTGRES_CHECKED_OUT_CLIENT_LOST. No order or broker mutation occurred. This is
  not a completed SPY session and earns no R8A independent-session credit.
- CLOSED_SOURCE_DEFECT: research roll identity double-counted the old close debit
  and omitted the new short liability. V2 separates cash movement from marked
  chain P&L, preserves prior realized loss, charges costs once, refuses a second
  slippage charge on actual fills and leaves an absent liability mark unknown.
  No Production ledger rows or management thresholds were changed.
- CLOSED_SOURCE_DEFECT: WAIT diagnostics mislabeled every unknownEvidence entry
  optional. Required quote/AEGIS/event/assignment evidence is now distinct from
  explicitly optional context. Unclassified evidence stays unclassified and the
  actual hard-blocker location remains visible. No new decision gate was added.
- CLOSED_SOURCE_DEFECT: whole-chain label availability was backdated to closure.
  V2 records actual post-read evidence availability, preserves economic close
  time separately and rejects nonfinite/blank/malformed evidence. The existing
  persisted labels are untouched. Concurrent duplicate inserts are idempotent.
- WIRED/TESTED: the canonical PostgreSQL exporter now includes additive
  entryChainLinks from the first unambiguous CSP option leg to its exact decision,
  selected candidate and contract. Roll legs, pre-existing stock and tied first
  legs are excluded rather than assigned an invented entry. Python verifies the
  identities and timing and the existing episode materializer consumes the join.
  Legacy exports remain readable with explicit missing entry linkage. This closes
  the CSP identity join, not feature qualification or model training readiness.
- OPEN_ENGINEERING: dataset-bound feature vector selection, label/cost validation,
  base-model training and immutable model registry integration remain. The V10
  wave must not call all remaining limitations forward-data-only.
- OBSERVED 2026-09-24T14:40Z: locked 38fef55 worker's evidence cycle again returned
  HTTP_503 / POSTGRES_ECONNRESET after 102763ms. Preserve the worker and defer
  another cutover until exact CI and a safe database window. Broker mutations=0.
- WIRED/TESTED: canonical empirical pipeline now materializes selected CSP entry
  features joined to explicit ledger-chain outcomes and persisted Alpaca decision
  BBO. Late/stale BBO, absent linkage, unresolved/revised/legacy labels, nonfinite
  values and retrospectively created feature policy remain excluded.
- WIRED/TESTED: a frozen research baseline policy executes dependency-grouped,
  label-purged chronological splits, train-only scaling and logistic fitting,
  validation-only calibration, forward evaluation and content-addressed per-run
  model registry receipts. Final OOS remains untouched. CLI verifies source SHA
  ancestry. This is selected-entry exploratory research, not market-wide POP,
  expected-value authority, empirical qualification or automatic promotion.
- STILL OPEN_ENGINEERING: rich qualified feature joins, automatic treatment
  replay generation, cross-strategy outcome dispatch and champion/challenger
  governance remain. Do not mislabel the bounded baseline as completion of all
  R8E/F model types or all V10 requirements.
- WIRED/TESTED: frozen feature-subset ablations now execute baseline and variant
  fits on identical PIT folds, retain paired forward scores, aggregate repeated
  scores by dependency component and persist Brier deltas. Missing fits remain
  partial/unknown. Predictive improvement is not an economic-profit conclusion.
- CLOSED_SOURCE_DEFECT: profit replay rejects provider timestamps after receipt
  and arithmetic overflow rather than estimating a fill or serializing infinity
  as null. Operator reality includes the bounded baseline/ablation at L5, not L8.
- CLOSED_SOURCE_DEFECT: common-horizon paired Q/H and Q/D outcome analysis now
  requires actual branch identities, a matching underlying, numeric capital
  basis and explicit common terminal-mark/cash-treatment policies. Identical
  strings alone cannot prove comparable economics. Automatic real paired-outcome
  materialization remains open and no branch obtains broker authority.
- OBSERVED 2026-09-24T15:04Z: clean 8b106bd source/worker alignment, one active
  lease, all locks preserved, Alpaca GET checks 200 with zero positions/open
  orders. Aiven then interrupted the no-submit probe at MASTER_ACCOUNT_LOOKUP
  with POSTGRES_CONNECTION_TERMINATED. The new worker also recorded HTTP_503 /
  POSTGRES_57P03 in RUNTIME_BROKER_CYCLE. No completed SPY proof or R8A session
  credit is claimed. Broker mutations and order submissions remain zero.
- WIRED/TESTED 2026-09-24 database-resilient observation: a SQLite WAL spool now
  preserves ordered, hash-chained no-submit checkpoints when PostgreSQL loses a
  checked-out client. Backfill is idempotent and identity checked. Local-only
  evidence can never authorize a broker mutation. A Windows worker fallback and
  bounded local replay completed SPY through contracts, quotes, Q, decision and
  locked plan evidence while Aiven returned POSTGRES_CHECKED_OUT_CLIENT_LOST.
- CLOSED_SOURCE_DEFECT: the default history acquisition window is now 400
  calendar days, enough to evaluate the required MA200 ownership component.
  The former 120-day request made StructuralQuality permanently UNKNOWN. A live
  read-only SPY cycle proved the corrected ownership path can make Q quantity 1
  under the explicit uncalibrated Paper bootstrap. No unknown was coerced clear.
- CLOSED_SOURCE_DEFECT: candidate portfolio-risk capacity was previously folded
  into the field named brokerAllowedQty. On the current roughly 100k Paper
  account, a cash-secured SPY put had true broker capacity 1 but the concentration
  hard cap reduced preliminary risk capacity to 0, producing the false reason
  BROKER_QTY_ZERO before AEGIS ran. Broker capacity and AEGIS capacity are now
  separate. Current read-only evidence reaches Q with quantity 1, then records
  the real AEGIS hard-veto families: UNDERLYING, SECTOR and CORRELATION, with
  PORTFOLIO and ASSIGNMENT reduced. SPREAD_WIDENING and SYSTEM stress remain
  unknown in the database-independent path. No risk limit was changed.
- POLICY_BLOCKED: with SPY as the only owner-approved Paper instrument, one
  cash-secured put currently consumes about 72 percent of account equity. The
  existing 15 percent ticker policy and 1.5 hard-cap multiplier make that CSP
  structurally ineligible. Resolution requires a governed policy/account change
  or empirical promotion of a bounded-risk branch. Engineering must not relabel
  this as missing broker capacity or loosen it to manufacture activity.
- WIRED/TESTED: database-independent observation now persists bounded exact-Q
  Alpaca contract BBO/IV observations into the existing hash-chained local WAL
  evidence stream. Strict lineage parsing rebuilds prior-session spread and IV
  cohorts during an Aiven outage, rejects hash/identity/timing/source ambiguity,
  and injects the canonical AEGIS assessors into the next read-only cycle. An
  immature history remains BASELINE_ACCUMULATING with a null stress result. It
  never becomes false merely because PostgreSQL is unavailable. Current SPY
  observations with an unqualified IEX moneyness reference remain explicitly
  rejected and therefore cannot mature either detector.
- CLOSED_SOURCE_DEFECT: the read-only no-submit probe used a pool listener that
  covered idle PostgreSQL disconnects only. A provider termination on a checked-
  out client could therefore reach the process emergency handler before the
  local observation fallback ran. The shared runtime pool now handles and
  sanitizes both idle and checked-out client errors. Awaited query failure still
  owns retry/fallback behavior and broken-client disposal.
- WIRED/TESTED: when Alpaca's IEX latest quote is stale, the shadow cycle now
  requests the authenticated IEX latest trade and may use a fresh trade only as
  the underlying reference needed for option moneyness and risk-cohort identity.
  The normalized contract records `ALPACA_IEX_TRADE` explicitly. Alpaca option
  snapshots remain the sole option bid/ask source and the final executable BBO
  authority. A trade never substitutes for an option quote, and a stale or
  malformed trade preserves the existing unknown state. Local AEGIS history
  accepts this typed reference lineage without weakening quote-age checks.
- OBSERVED 2026-09-24T18:50Z: a clean immutable no-submit run on `5a9ac72`
  completed the Aiven-outage fallback after `POSTGRES_CONNECTION_TERMINATED`.
  SPY produced five exact-Q observations, and all five qualified for both the
  local spread cohort and Alpaca contract-IV cohort with the new reference
  lineage. The 15 earlier unqualified observations remain immutable and
  rejected. This begins real forward baseline accumulation, but same-session
  scans do not create independent sessions and current AEGIS stress remains
  UNKNOWN until qualified prior-session evidence exists. Q produced five
  candidates, two with positive broker quantity, and the canonical result was
  `GLOBAL_WAIT`. UNDERLYING, SECTOR and CORRELATION remained genuine AEGIS hard
  vetoes under the unchanged concentration policy. Orders and broker mutations
  remained zero.

## V16 overnight certification closure, 2026-09-25

- ID: V16-ARCHIVE-HEALTH. DOMAIN: storage. SOURCE: `src/storage/local-research-archive-health.ts`,
  `tools/verify-local-research-parquet.py`, and the Windows supervisor. RUNTIME CALLER:
  the closed-session worker. CURRENT_STATE: WIRED/VERIFIED. TARGET_STATE: CLOSED.
  CLASSIFICATION: CODE_SOLVABLE. IMPLEMENTATION: Aiven 53000 is a typed 12-hour
  transfer-quota circuit, storage-audit 53000/57014 failures receive bounded
  cooldowns, and both supported Parquet manifest formats receive cached real
  DuckDB read-back. UNIT/INTEGRATION/FAULT: PASS. STATUS: CLOSED. NEXT_RETRY_WHEN:
  the persisted cooldown expires or archive inventory changes.
- ID: V16-HISTORICAL-FAILURES. DOMAIN: runtime safety. SOURCE:
  `src/operations/historical-failure-registry.ts`. RUNTIME CALLER:
  `theta:premarket:historical-regressions`. CURRENT_STATE: 23/23 PASS.
  TARGET_STATE: CLOSED. CLASSIFICATION: CODE_SOLVABLE. UNIT/INTEGRATION/REPLAY/FAULT:
  PASS. STATUS: CLOSED. Historical failures F01 through F23 now map to executable
  sanitized regression evidence with zero unclassified cases.
- ID: V16-SESSION-SOAK. DOMAIN: liveness. SOURCE:
  `src/operations/accelerated-session-soak.ts`. RUNTIME CALLER:
  `theta:premarket:accelerated-soak` and premarket certification. CURRENT_STATE:
  391 deterministic minute cycles pass across the complete 6.5-hour session with
  typed database, provider, stale-quote, backpressure, and lease-delay injection.
  TARGET_STATE: CLOSED_ENGINEERING. CLASSIFICATION: CODE_SOLVABLE. UNIT/FAULT/SOAK:
  PASS. STATUS: CLOSED_ENGINEERING. Live provider/economic proof remains
  FORWARD_DATA_REQUIRED and is not implied by this deterministic soak.
- ID: V16-FINAL-LIVE-VALUE. DOMAIN: current market evidence. RUNTIME CALLER:
  locked current worker. CURRENT_STATE: PENDING_OPEN. TARGET_STATE: CURRENT_RELEASE
  SPY no-submit receipt. CLASSIFICATION: FORWARD_DATA. CODE_SOLVABLE: NO.
  STATUS: FORWARD_DATA. NEXT_RETRY_WHEN: next supported U.S. options session.

## Migration 067 archive and research-export durability closure

- ID: ARCHIVE-BACKLOG-DRAIN. DOMAIN: local research archive. SOURCE:
  `src/storage/canonical-frontier-local-archive.ts`. CURRENT_STATE:
  CODE_COMPLETE/VERIFIED_TEST. The exporter inventories immutable canonical
  frontier identities, excludes batches already present in SQLite, processes
  the oldest missing batches first, and reports backlog start/end, coverage,
  pending ages and monotonicity. A bounded run can no longer repeat the same
  newest rows forever. Production keeps `persistRelationalCandidateEvidence=false`.
- ID: ARCHIVE-BRANCH-PRESERVATION. DOMAIN: evidence projection. CURRENT_STATE:
  CODE_COMPLETE/VERIFIED_TEST. Candidate records carry the full branch receipt,
  selected state, frontier and fusion identities, and source hash verification.
  A branch with no candidates receives an explicit `BRANCH_WITHOUT_CANDIDATES`
  record, so projection cannot silently erase a branch.
- ID: PARQUET-RESTART-SAFETY. DOMAIN: local research compaction. SOURCE:
  `tools/compact-local-research-spool.py`. CURRENT_STATE:
  CODE_COMPLETE/VERIFIED_TEST. Final archive identity is content-derived,
  Parquet is written and DuckDB-verified in a staging directory, finalization is
  atomic, and an existing finalized archive is hash/readback verified before
  SQLite state is advanced. A real simulated interruption after Parquet write
  resumes to one finalized archive with one archived batch and no duplicate.
- ID: ARCHIVE-RUNTIME-CERTIFICATION. DOMAIN: current worker evidence.
  CURRENT_STATE: SOURCE_FIXED_AWAITING_RUNTIME. TARGET_STATE: one migration-067
  current-worker cycle decoded from PostgreSQL, projected to verified SQLite,
  compacted to ZSTD Parquet, read through DuckDB, and reconciled by batch,
  branch, candidate, selection and identity. NEXT_RETRY_WHEN: migration 067,
  post-migration restore parity, and locked current-worker cutover all pass.

## Schema-067 runtime compatibility closure, 2026-09-25

- ID: SCHEMA-064-WORKER-42703. DOMAIN: runtime/database compatibility. OBSERVED:
  the locked `af3d43d` supervisor completed broker, lifecycle, management and
  observation scopes, then the evidence persistence scope failed with SQLSTATE
  42703 when `PostgresThetaCycleStore.persist` referenced
  `trade.fusion_snapshot.storage_contract_version`. That column is introduced
  by migration 067 in commit `cd2fb840a8e66b231a8ed1000e4168eaf9f980c4`.
  CLASSIFICATION: INFRASTRUCTURE_DEFERRED, never strategy WAIT. The old worker
  was stopped, with zero order submissions and zero broker mutations.
- ID: RUNTIME-SCHEMA-COMPATIBILITY-V1. DOMAIN: runtime admission. SOURCE:
  `src/theta/runtime-schema-compatibility.ts`. CURRENT_STATE:
  CODE_COMPLETE/VERIFIED_SOURCE. Every normal runtime scope and database lease
  probe now checks the ordered migration inventory and exact source-worker SHA
  before worker registration, lease acquisition or cycle start. Schema below
  067, schema above the supported maximum, missing migration metadata and a
  source-worker release mismatch return `RUNTIME_SCHEMA_INCOMPATIBLE`, keep the
  gate locked and carry no broker authority.
- ID: WINDOWS-WORKER-HEALTH-TRUTH. DOMAIN: operator health. CURRENT_STATE:
  CODE_COMPLETE/VERIFIED_SOURCE. Scheduled Task state, supervisor process count,
  immutable release SHA, health SHA, heartbeat age and reported schema state
  are now separate. A running wrapper with no supervisor is `WORKER_ABSENT`, a
  duplicate is `DUPLICATE_SUPERVISOR`, stale health is `STALE_HEARTBEAT`, and
  schema mismatch is `SCHEMA_INCOMPATIBLE`. The local status command labels the
  database lease unverified instead of claiming lease health without a DB read.
- ID: F24-HISTORICAL-REGRESSION. DOMAIN: regression safety. CURRENT_STATE:
  CLOSED_SOURCE. `SCHEMA_064_WORKER_42703` is registered as F24 with executable
  fail-closed tests. Stale RUNNING cycle recovery remains bounded to rows older
  than seven minutes, at most 32 rows per pass with `FOR UPDATE SKIP LOCKED`,
  and records `INTERRUPTED_STALE_LEASE` rather than WAIT.

## Governed migration-checkpoint incidents, 2026-09-26

- ID: PRE-BACKUP-QUOTED-COPY-GUARD. DOMAIN: disaster recovery. OBSERVED: the
  first schema-067 checkpoint completed a 1.413 GB custom dump and schema dump,
  then the local read-only SQL guard mistook the quoted schema identifier
  `"copy"` for the PostgreSQL `COPY` command. No migration ran. CLASSIFICATION:
  CODE_SOLVABLE. CURRENT_STATE: CLOSED_SOURCE at `8939372`; the guard now strips
  quoted identifiers, values, dollar-quoted bodies and comments before keyword
  classification while real mutation statements remain rejected.
- ID: PRE-BACKUP-CRITICAL-DIGEST-TLS-EOF. DOMAIN: disaster recovery/provider
  stability. OBSERVED: the second checkpoint completed the same 1.413 GB custom
  dump, schema dump, structure/global inventories, all-table counts and sequence
  state, then a critical-table digest query lost its TLS connection with
  `unexpected eof while reading`. The completed dump was preserved under
  `restore-tests/incomplete-2026-09-25_223047-98fac688`. No migration ran and
  schema remains 064. CLASSIFICATION: CODE_SOLVABLE plus external provider
  instability. CURRENT_STATE: SOURCE_VERIFIED_AWAITING_EXACT_CI_AND_FRESH_CHECKPOINT. The v2 digest hashes a
  bounded integrity projection for high-volume evidence tables, including their
  immutable payload/archive hashes, rather than rematerializing giant JSON/blob
  columns inside constrained PostgreSQL. Read-only transient connection errors
  can retry against the still-live exported snapshot. Exact table identity is
  included in any digest failure.
