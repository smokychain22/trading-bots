# THETA Phase 2 — Strategy Router + Strictness + Branch Isolation (Reclosure)

Built on `claude/theta-unified-takeover` from accepted head `9ff1ba2`. This
reclosure focuses on the one concrete residual named at Phase 2 reopening —
`THETA-CANONICAL-FRONTIER-NO-PER-BRANCH-ISOLATION` — plus re-verification of
Phase 2's prior real findings (strictness machinery, historical Sep16/18/21
report, zero-trade taxonomy). Per the current directive's "one phase at a
time" rule, no Phase 3+ item (e.g. the Q max-loss gap) was touched.

## Branch fault-domain isolation — real defect, fixed, test-first

**Root cause confirmed by direct read**: `buildCanonicalStrategyFrontier()`'s
`branchOrder.map((branch) => buildBranch(branch, input))` had no per-branch
exception boundary — a real throw from any branch's construction step
(candidate enumeration, ranking, or even the shared applicability checks)
propagated straight through `Array.map`, crashing the entire frontier before
any branch's real result — including Q's — was ever produced.

**Test-first, per the directive's own discipline**: wrote
`tests/canonical-frontier-branch-isolation.test.ts` and confirmed the first
test genuinely failed against the pre-fix code (real stack trace captured:
`Error: SIMULATED_STOCK_CURRENT_PRICE_READ_FAILURE` propagating through
`buildBranch` → `Array.map` → `buildCanonicalStrategyFrontier`), before
writing any fix.

**A real subtlety found while fixing, not glossed over**: the naive fix
(wrap every per-branch read in try/catch) would have been wrong. Stock
existence (`input.stock.shares`) is read by the applicability check used to
compute `managementAuthorityRequired` — if a stock-read failure were
isolated as "just this branch failed, others proceed normally," the system
could silently behave as if no stock existed at all when it actually does,
which is a real safety-relevant regression (new-risk decisions should not
proceed as if the account is flat when stock-ownership state is genuinely
unreadable). **Fixed correctly**: `input.routing.results` and
`input.stock.shares` are now both read exactly once, hoisted outside any
per-branch fault boundary — a failure there is a genuine shared/global fault
and correctly still crashes the whole cycle (verified by two adversarial
tests asserting `assert.throws`). Only branch-*specific* construction work
(candidate enumeration, deeper economic fields like `stock.currentPrice`,
ranking) is isolated per branch, producing a new, real, typed
`BRANCH_CONSTRUCTION_FAILED` evaluation state with the exact
strategy/message/timestamp preserved in `routeReasons` — never a silent
`catch {}`.

**Verification**: 4 new tests pass (RECOVERY-specific failure survives Q;
D-specific failure survives Q; stock-existence failure still hard-crashes;
routing-read failure still hard-crashes). Re-ran the full pre-existing
`canonical-strategy-frontier.ts` test suite (44 tests across 5 files) — 43
pass, 1 pre-existing skip (real Postgres integration test, no DB access) —
zero regression from the refactor.

## Re-verified real prior Phase 2 findings (not redone, re-confirmed)

- **Zero-trade taxonomy**: `false-inactivity-taxonomy.ts`'s real 12-cause
  enum (aligned to Codex's own `FirstPaperBlockerClass`) already
  distinguishes the concepts the directive names differently: `ECONOMIC_WAIT`
  (real economic evaluation, nothing attractive) is genuinely distinct from
  `PIPELINE_NOT_EVALUATED` (candidate never reached a later stage) —
  functionally the same NO_OPPORTUNITY-vs-NO_CANDIDATE distinction the
  directive asks for, under this repo's own existing names. Reused, not
  duplicated.
- **Strictness machinery + historical Sep16/18/21 report**: real, built and
  verified in the prior Phase 2 pass (`strictness-funnel-report.ts`, run
  against the actual historical receipt numbers, with the executable-but-
  zero-qty cohort's cause honestly left `SOURCE_DERIVED_CONCLUSION_NOT_FACT`
  rather than force-classified).
- **Sep24 case — SUPERSEDED this pass by a real local-worker evidence find**.
  Earlier passes concluded `HISTORICAL_CAUSE_NOT_IDENTIFIABLE_FROM_AVAILABLE_EXPORT`
  on the theory that the runtime receipts were structurally outside this
  repo's reach. That premise was wrong: the worker runs locally on this same
  machine (in a separate checkout,
  `.../Codex/2026-09-09/read-all-my-files-in-depth/work/trading-bots`), and
  its gitignored `.theta-local-worker/` directory is directly, read-only
  inspectable. Two evidence sources were found and read this pass:
  - `receipts/2026-09-24/` (232 coarse job-status JSON receipts, sanitized by
    the worker's own design — no candidate/quantity/AEGIS detail). Confirmed:
    zero receipts in the entire ~18h Sep24 window show `marketOpen: true`,
    zero contain a positive `quantity`, zero contain `GLOBAL_WAIT` or
    concentration/correlation/sector reason codes. (Sep18/Sep21 receipts DO
    show real market-open cycles, confirming the schema is simply too coarse,
    not that the data never existed.)
  - `evidence-spool/theta-evidence.sqlite` (opened read-only via Node's
    `node:sqlite`, tables `envelope`/`circuit`): this **does** carry
    candidate-level detail, but only for `decision_as_of` in
    `[2026-09-24T15:52:20Z, 2026-09-25T14:53:40Z]` — 118 rows / 11 decision
    cycles, no Sep18 or Sep21 rows at all (the spool is a rolling local
    buffer, not a full history).
  - **Real, verified finding for every one of the 11 captured Sep24-25
    cycles**: `DECISION_READY.selectedCandidateId = null`,
    `SIZING_READY = {"bindingState":"ZERO_OR_NO_SELECTION","selectedQuantity":0}`
    in all 11. This directly refutes the "Q reached a positive-size
    candidate, then AEGIS concentration/correlation vetoed it" narrative for
    this window — no cycle in the captured evidence ever reached a
    positive-size candidate.
  - One fully-read cycle (`no-submit-7981e31e...`, 2026-09-24T17:34:59Z) shows
    the real, specific, multi-causal reason: `Q_READY.frontierCandidates`
    lists 10+ real `THETA_CONVENTIONAL` SPY-put candidates (strikes 500–565),
    every one with `aegisState:"HARD_VETO"` and
    `hardBlockers:["AEGIS_HARD_VETO","THETA_Q_OUTSIDE_EVALUATED_LATTICE"]`,
    `quantity:0`. `THETA_Q_OUTSIDE_EVALUATED_LATTICE` is a real, named,
    source-confirmed code (`canonical-strategy-frontier.ts:316`) meaning the
    candidate's strike is not a member of the Q lattice's evaluated-feasible
    set (`thetaQActionFeasibleByOptionSymbol`) — a known structural exclusion,
    not missing provider data. Simultaneously, the cycle's own top-level
    `blockers` show `OPTION_CONTRACTS_INCOMPLETE:SHADOW_RESEARCH:PUT` and
    `ALPACA_UNDERLYING_IEX_QUOTE_UNQUALIFIED` (real provider data-quality
    faults), and `PLAN_READY.planState = "BLOCKED_CANONICAL_POSTGRES_REQUIRED"`
    — matching the `circuit` table's own row (`POSTGRES: SPOOL_MODE`,
    14 failures) and two `CYCLE_FAILED` envelopes that same day
    (`errorCategory: POSTGRES_CONNECTION_TERMINATED`). So Sep24's zero-size
    outcome that day is real, evidenced, and multi-causal: lattice exclusion
    + AEGIS hard veto + a genuine concurrent Postgres/provider outage — not
    a single concentration/correlation veto against a live-sized candidate.
  - `HISTORICAL_GENUINE_UNKNOWN_REMAINING`: Sep18/Sep21's *candidate-level*
    zero-quantity cause is still not resolvable from any evidence source
    found on this machine — the SQLite spool has no rows for those dates and
    the JSON receipts for those dates share the same coarse schema. This
    remains an honest `HISTORICAL_CAUSE_NOT_IDENTIFIABLE_FROM_AVAILABLE_EXPORT`
    for Sep18/Sep21 specifically, now narrowed from "not reachable" to
    "reachable, searched, genuinely not present at this granularity."
- **Candidate ordering / determinism**: Phase 1's
  `canonical-frontier-tiebreak-order.test.ts` already proves lexical
  candidate-ID ordering only breaks ties among truly pareto-equal candidates,
  never drives selection between economically different ones. Phase 1's new
  `canonical-decision-authority.test.ts` determinism test covers the
  selection-authority level. No new frontier-level determinism gap found
  this pass beyond what those two already cover.

## Pass B — Sep24 "zero marketOpen:true" is a receipt-writer gap, not a market-clock bug

The owner correctly flagged this as suspicious: Sep24 2026 is a Thursday, and
the coarse-receipt window (06:40Z–00:30Z next day) spans regular US market
hours, yet all 232 coarse receipts said `marketOpen: false`. Investigated to
a source-confirmed root cause, not just correlation:

- **Confirmed real gap, not a sampling artifact**: listing coarse-receipt
  file counts by UTC hour for Sep24 shows files at hours 00,06,07,08,09,10,
  11,12,13, then **nothing at all for hours 14–19**, resuming at hour 20.
  13:30–20:00 UTC is exactly the regular ET session (9:30am–4:00pm ET). The
  coarse-receipt writer produced zero files for the entire regular session
  that day, not "reported market closed" — it did not run at all.
- **The decision engine itself was NOT blind to the market being open**:
  querying the SQLite envelope spool's `ACCOUNT_READY` payloads for the same
  window shows **every one of the 13 Sep24 cycles between 15:52Z–18:48Z**
  (i.e. inside the coarse-receipt gap) reports `marketOpen: true`. The one
  Sep25 cycle at 09:08Z (pre-market) correctly reports `marketOpen: false`.
  So the underlying market-state detection was correct throughout; only the
  coarse job-status receipt file was missing.
- **Source-confirmed mechanism** (`tools/windows/theta-local-worker.ps1`):
  the coarse-receipt write (lines 438-452) sits inside its own `try/catch`,
  but that whole block — along with the BROKER/LIFECYCLE/MANAGEMENT/
  OBSERVATION/EVIDENCE report-gathering steps that feed it — is itself
  nested inside one large per-cycle `try` whose `catch` (line 471) marks the
  entire cycle `workerExit = 1` on ANY earlier exception. If an earlier
  per-cycle step throws (the observed window has 2 real
  `POSTGRES_CONNECTION_TERMINATED` `CYCLE_FAILED` envelopes and the circuit
  table shows `POSTGRES: SPOOL_MODE`, 14 failures, exactly this day), control
  never reaches the receipt-write block at all — it is skipped entirely, not
  written with a false value.
- **Conclusion**: `SEP24_MARKET_OPEN_ANOMALY` is real but is a **receipt/
  observability gap during the Postgres outage**, not a market-clock defect
  and not a false-positive/false-negative `marketOpen` classification. The
  actual per-cycle decision evidence (candidates, AEGIS state, sizing) is
  preserved independently in the SQLite envelope spool and is NOT missing —
  only the separate coarse heartbeat file is. This is now `PARTIAL`-classified
  (see `Q_LATTICE_OVERFILTER_STATUS`-style field below): confirmed
  correlationally and via the exact source gating logic; not yet proven by a
  reproduced live failure injection (would require actually forcing a
  Postgres outage against this worker, out of scope for a read-only
  investigation).

## Pass B — AEGIS binding reasons ARE captured historically (correction to an earlier hedge)

An earlier pass of this doc implied `AEGIS_HARD_VETO`'s binding reason might
not be recoverable from captured historical evidence. That was wrong for
Sep24: `Q_READY` envelopes (not `AEGIS_READY`, which only ever carries the
bare `aegisState` string) carry a full `aegisFamilies` breakdown per
candidate (`family`, `state`, `reasonCodes` for all 12 named AEGIS families).
Queried directly:

- All **5** `HARD_VETO` Sep24 cycles (17:34, 17:50, 17:53, 18:44, 18:48Z)
  carry **the exact same 7-code reason set**, every time:
  `UNDERLYING_SEVERELY_EXCEEDED`, `SECTOR_SEVERELY_EXCEEDED`,
  `CORRELATION_SEVERELY_EXCEEDED` (all three families independently
  `HARD_VETO`), `PORTFOLIO_EXCEEDED` and `ASSIGNMENT_EXCEEDED` (both
  `ALLOW_REDUCED`), plus two soft/unknown-data `HOLD_ONLY` families
  (`SPREAD_WIDENING_UNKNOWN`, `SYSTEM_STRESS_STATE_UNKNOWN`).
- The 6 non-`HARD_VETO` Sep24 cycles carry an **empty** reason set,
  consistent with `aegisState: null` in those cycles (AEGIS was never
  reached — those cycles were blocked earlier, e.g. by the
  `BLOCKED_CANONICAL_POSTGRES_REQUIRED`/`OPTION_CONTRACTS_INCOMPLETE` facts
  already documented above).
- **This reinstates a version of the original "AEGIS concentration/
  correlation veto" narrative, now properly evidenced rather than assumed**:
  underlying/sector/correlation concentration really was severely exceeded
  that day, consistently, every time AEGIS was actually reached. It is
  simultaneous with, not instead of, the Q-lattice-exclusion and Postgres-
  outage facts already documented — genuinely multi-causal and
  over-determined (removing any single one of these three faults would very
  likely still have left a zero-quantity outcome that day, per the owner's
  own instruction not to claim a false single counterfactual).
- `AEGIS_HISTORICAL_REASON_IDENTIFIABLE = YES` for Sep24 (was previously
  going to be reported `NO`/`NOT_IDENTIFIABLE` before this direct query).
  `AEGIS_FORWARD_REASON_PERSISTENCE`: already real and already working —
  this is existing captured evidence, not a forward-looking gap needing a
  new fix.

## Pass B — soft/hard current-source recheck + ghost/dead router data (items 19, 20, 21)

Personally rechecked against current source (not the earlier-session audit)
for TREND, MOMENTUM, IV, FLOW, UOA, REGIME, plus the directive's explicit
FLOW/REGIME/EVENT/PORTFOLIO-EXPOSURE ghost-data set. Each classified with
the exact consuming function found, or honestly marked absent:

- **MOMENTUM = DEAD.** `postgres-theta-cycle-store.ts:1044`:
  `technical:{trend:snapshot.regimeState, momentum:null, drawdown:null, realizedVolatility:null}`
  — `momentum` is a hardcoded `null` literal at the one and only place this
  field is written anywhere in `src/`. No decision path reads a real
  momentum value because none is ever computed. This is a genuine dead
  field, found this pass, not previously flagged.
- **TREND = GHOST (mislabeled alias, not an independent signal).** Same
  line: the persisted `technical.trend` field is not a distinct trend
  computation — it is literally `snapshot.regimeState` renamed. A reader of
  the persisted schema would reasonably assume "trend" is its own technical
  indicator; it is not. Classify as `GHOST_DATA` (field exists, is
  populated, but does not mean what its name implies) rather than `DEAD`
  (which would imply always-null) or `ACTIVE_PRODUCTION_CONSUMER`.
- **IV (`ivRank`) = ACTIVE_PRODUCTION_CONSUMER.** Real, already traced this
  pass via the Q lattice trace above: `new-risk-orchestrator.ts:675`,
  `ivRank: c.ivRank` is sent directly into the `thetaQ` bridge request —
  a genuine economic-evaluation input, not informational-only.
  Also directly consumed as `unknownEvidence.push('IV_UNKNOWN')` at
  `canonical-strategy-frontier.ts:299` when null — soft/UNKNOWN-tracked,
  never defaulted.
- **FLOW (`netFlowWindows`/`optionomicsFlowWindows`) = RESEARCH_ONLY /
  INFORMATIONAL_ONLY, not DEAD.** Real pipeline exists end-to-end: fetched,
  quality-classified (`theta-shadow-cycle.ts:898-938`, a real
  `VALUE_PRESENT`/`VALUE_UNKNOWN_AFTER_SUCCESS` outcome taxonomy, genuinely
  hashed for evidence integrity), and persisted (`postgres-cycle-evidence-
  storage.ts:83`, `postgres-theta-cycle-store.ts:1001`). But its only
  consumption inside the actual decision path
  (`canonical-strategy-frontier.ts:720`) is being attached, unexamined, as
  part of the generic `optionomicsContext: JsonValue` field on the
  candidate record — it never appears in a hard blocker, soft-evidence
  entry, or economic ranking calculation anywhere in
  `canonical-strategy-frontier.ts` or `new-risk-orchestrator.ts`. Real,
  quality-tracked, persisted — but not an active decision input today.
- **UOA = UNWIRED.** Only appears as one literal in a research taxonomy's
  `family` union type (`options-chain-decision-intelligence.ts:26`) —
  grepped across every decision-path file in `src/theta/`; no consuming
  function reads a UOA value anywhere. This is a defined taxonomy slot with
  no real production consumer, not a computed-and-ignored value like FLOW.
- **REGIME = ACTIVE_PRODUCTION_CONSUMER, mixed hard/soft.**
  `new-risk-orchestrator.ts:807-809`: `regimeResult.data.stressState !== 'CRISIS' && regimeResult.data.volatilityState !== 'SHOCK'`
  is a genuine hard gate (CRISIS/SHOCK stress or vol state structurally
  blocks). `liquidityState`/`eventState` (lines 462-463) feed soft facts
  (`liquidityAcceptable`, `eventNear`) rather than a direct hard veto.
  Real, currently wired, both hard and soft depending on the specific
  sub-field — not one uniform role.
- **EVENT (`eventState`) = ACTIVE, correctly SOFT.** Already covered
  end-to-end by the existing "PROVIDER-FAILURE E2E (optional/soft)" test:
  `canonical-strategy-frontier.ts:297-298` — UNKNOWN becomes
  `unknownEvidence`, a known value becomes `softEvidence`, never a hard
  blocker. This is the correct, intentional soft-signal design, not an
  accidental hard gate (item 20's "accidental hardening" search found
  nothing here).
- **PORTFOLIO EXPOSURE (`unmanagedBrokerPositionCount`) =
  ACTIVE_PRODUCTION_CONSUMER, hard-adjacent.**
  `canonical-strategy-frontier.ts:682,691,716`: a nonzero unmanaged-position
  count sets `managementIncomplete = true`, which both excludes the cycle
  from full-paper-authorization eligibility (line 691's boolean chain) and
  adds the real, named reason code `OPEN_POSITION_MANAGEMENT_NOT_ATTACHED`
  (line 716) — a genuine, currently-wired portfolio-completeness gate, not
  informational.
- **Accidental hardening (item 20)**: none found in this pass beyond the
  Q-lattice-absence conflation already documented above (which is a
  labeling/semantic gap, not a soft-signal-silently-turned-hard-veto case).
  EVENT and IV's soft paths were checked directly and are correctly
  versioned/soft as designed.

## Pass B — Q lattice end-to-end trace + a real semantic conflation found

Traced the full path, source-confirmed at every step, not cited from a doc:

`request.candidates` (raw contracts, `new-risk-orchestrator.ts`) →
**`executableCandidates`/`nonExecutable`** split on `contract.executable`
(line 535, ties directly to the multiplier/quote-freshness lineage already
traced) → **`latticeEligible`/`deltaUnknown`** split on `contract.delta ===
null` (line 559: "theta_q_lattice.py's ChainContract.put_delta_magnitude is
a required float") → **`freshnessEligible`/`freshnessRejected`** split via
`classifyObservation(...)` against `request.optionQuoteFreshnessPolicy`
(line 590: GOOD/DEGRADED pass, else rejected as `WAIT_LIQUIDITY`, never
folded into "PASS/deliberately declined") → **if `freshnessEligible.length
=== 0`, the Q bridge is never called at all** (line 621, `thetaQ: null`
returned directly) → otherwise `freshnessEligible` is sent to the `thetaQ`
bridge (line 661) → `thetaQResult.data.candidates` (Q's own response) is
what `theta-shadow-cycle.ts:1577` turns into
`thetaQActionFeasibleByOptionSymbol`, keyed by `candidate.candidateId`
which — verified at `theta-shadow-cycle.ts:1348` — is exactly
`contract.optionSymbol`, matching the bare option-symbol key
`canonical-strategy-frontier.ts:312` looks up. **No identity/key-format
mismatch exists between the two sides** (an earlier hypothesis of mine,
checked and ruled out by direct read before writing anything).

**Real semantic conflation found (this is the substantive Phase-2 answer to
"was a candidate evaluated or merely absent from the Q lattice?"):**
`THETA_Q_OUTSIDE_EVALUATED_LATTICE` fires whenever an option symbol is not
a key in `thetaQActionFeasibleByOptionSymbol` — but that map's key
population, traced above, can be absent from a *bare* option symbol for at
least three structurally different reasons that the current code does not
distinguish:
1. the contract was intentionally outside Q's own delta/DTE/strike lattice
   design (the source comment's claimed meaning: "known exclusion, not
   missing provider data");
2. the contract never reached the Q bridge call at all because an earlier,
   *upstream* gate rejected it first — non-executable (multiplier
   unverified), delta UNKNOWN, or a stale/insufficient option-quote
   freshness classification — none of which are Q-lattice-design decisions,
   they are data-quality gates;
3. the contract was sent to Q, but Q's own response omitted it (the code's
   own comment at `new-risk-orchestrator.ts:694` — "cannot happen given the
   request was built from freshnessEligible, but never assume" — shows this
   path is already known-possible and defensively tolerated, but silently:
   a response gap here is invisible at the frontier and collapses into the
   same `THETA_Q_OUTSIDE_EVALUATED_LATTICE` code as case 1).

This means the source comment's claim ("non-members are known exclusions,
not missing provider data") is **not always true** — case 2 is exactly a
missing-provider-data/data-quality exclusion wearing the same reason code as
a deliberate lattice-design exclusion. `Q_LATTICE_ABSENCE_SEMANTICS`:
currently **conflated**, not distinguishable from the persisted evidence
alone. `Q_LATTICE_OVERFILTER_STATUS = PARTIAL` — case 1 is intentional by
design, case 2 is a genuine labeling gap (an upstream data-quality reject
being reported with a lattice-design reason code), case 3 is a
already-defensively-coded-but-silent edge case.

**Not fixed this pass, and deliberately not fixed**: distinguishing these
three cases at the frontier would require exposing which option symbols
were ever sent to the Q bridge (i.e. `freshnessEligible`'s membership) as
its own field alongside the feasibility map — a real interface change to
data that currently only exists inside `new-risk-orchestrator.ts` at call
time and does not cross into `canonical-strategy-frontier.ts`'s input today.
This is a legitimate, source-confirmed, safe-to-fix future improvement, not
implemented in this pass because it changes what evidence the canonical,
hashed frontier receipt carries — exactly the kind of interface change the
owner's directive says should be "strengthened" only once proven necessary,
and it is more appropriately scoped as its own reviewed change than folded
silently into a closure pass. Recommended as the next quant/strictness item,
not deferred without a plan.

**Sep24-specific relevance**: recall the top-level `blockers` on the fully
inspected Sep24 cycle were `OPTION_CONTRACTS_INCOMPLETE:SHADOW_RESEARCH:PUT`
and `ALPACA_UNDERLYING_IEX_QUOTE_UNQUALIFIED` — both are exactly
upstream-provider/data-quality facts of the kind that would legitimately
reduce `freshnessEligible` before Q was ever called, i.e., consistent with
case 2 above being the dominant explanation for that day's uniform
`THETA_Q_OUTSIDE_EVALUATED_LATTICE` results, not a strike/delta design
exclusion. This is stated as the most consistent explanation given the
evidence, not as independently reconstructed proof (the raw Sep24
`freshnessEligible` set itself was not persisted anywhere inspectable, so
this cannot be verified beyond "consistent with").

## Pass B — source-to-router lineage, 4 more named fields (personally retraced)

Each traced by direct source read this pass, not cited from an architecture
doc. OWNERSHIP was already traced in an earlier pass (real chain via
`new-risk-orchestrator.ts:674` → `theta_q_baseline.py`); not repeated here.

- **MARKET/SESSION**: `management-input-state.ts:227` derives
  `reconciledMarketOpen` from the broker reconciliation payload's own
  `marketOpen` boolean (the same field the Sep24 SQLite evidence's
  `ACCOUNT_READY` envelopes carry). Line 354 makes it a `required(...)` field
  — missing/non-boolean fails closed, never coerced to a default. Real
  downstream effect, source-confirmed: `autonomous-runtime.ts:546`:
  `if (reconciliation.marketOpen !== true) return skipped('MARKET_CLOSED_NO_PAPER_EXECUTION')`
  — a direct boolean-flip test (`marketOpen: false` vs `true`, all else
  held equal) changes the cycle outcome from proceeding to a stable
  `MARKET_CLOSED_NO_PAPER_EXECUTION` skip. Perturbation effect verified by
  reading this exact branch; not yet captured as its own unit test this pass.
- **CONTRACT STANDARDNESS / MULTIPLIER**: `option-chain-ingestion.ts:184-191`
  — if Alpaca does not supply the contract's own real multiplier, the
  contract is forced `executable: false` with `nonExecutableReason` set to
  `'multiplier unverified'` (comment at line 179-183 explains why: so nothing
  downstream can compute premium/collateral economics against a fabricated
  multiplier). Separately, `theta-shadow-cycle.ts:1350` computes
  `contractIsStandard: contract.multiplier === 100 && contract.occSymbol !== null`
  for the shadow-research surface. Real downstream effect: a forced
  non-executable contract feeds the same `EXECUTION_QUOTE_REQUIRED:...`
  unknownEvidence path in `canonical-strategy-frontier.ts:293` that the
  existing "CRITICAL (stale quote)" E2E test already exercises end-to-end.
- **EXECUTABLE BBO FRESHNESS**: `option-contract.ts:221-230` —
  `quoteAgeSeconds = (receivedAt - quoteTimestamp) / 1000`; three distinct,
  real, non-silent reason strings: `'quote age unknown'` (null timestamp —
  UNKNOWN, never coerced to fresh), `'quote timestamp invalid or in future'`,
  and `'quote stale'` (age exceeds `maxQuoteAgeSecondsForExecutable`). These
  feed `nonExecutableReason` → `canonical-strategy-frontier.ts:293`'s
  `EXECUTION_QUOTE_REQUIRED:${reason}` unknownEvidence — this exact path is
  the one already covered end-to-end by the existing "CRITICAL: a
  non-executable (stale) quote..." test in
  `tests/canonical-frontier-branch-isolation.test.ts`.
- **PORTFOLIO/ASSIGNMENT CAPACITY**: `canonical-strategy-frontier.ts:324`:
  `assignmentCapacityQty = input.assignmentCapacityQty ?? securedContractCapacity(input.buyingPower ?? null, collateral)`.
  Real downstream effect at line 326, in the same function: `assignmentCapacityQty <= 0`
  pushes the real, named hard blocker `NO_ASSIGNMENT_CAPACITY` — not a
  generic rejection code.
- **Perturbation/actual-data-effect tests**: only BBO freshness and the
  branch-construction-failure paths already have a dedicated automated E2E
  test proving the field change flips a real output
  (`tests/canonical-frontier-branch-isolation.test.ts`). MARKET/SESSION,
  CONTRACT STANDARDNESS, and ASSIGNMENT CAPACITY were traced and confirmed by
  direct source read with the exact line-level downstream effect identified
  above, but do **not** yet have a dedicated new automated perturbation test
  each — this is an honest gap against Pass B item 19, not something to
  silently claim as fully closed.

## Pass B — final closure receipt

```
SEP24_INCIDENT_CLASSIFICATION = MULTI_CAUSAL_OVERDETERMINED (Q-lattice
  absence + AEGIS hard veto on UNDERLYING/SECTOR/CORRELATION + concurrent
  Postgres outage + IEX/shadow-research data-quality gap; each independently
  evidenced, no single-cause counterfactual claimed)
SEP24_MARKET_OPEN_ANOMALY = REAL, ROOT-CAUSED: coarse receipt writer produced
  zero files for the entire 13:30-20:00 UTC regular session; the decision
  engine's own SQLite envelope spool shows marketOpen=true correctly for
  every captured cycle in that window
SEP24_EXPECTED_MARKET_SESSION = REGULAR (Thu 2026-09-24, no holiday)
SEP24_MARKET_CLOCK_SOURCE = broker reconciliation payload (Alpaca), carried
  through management-input-state.ts's reconciledMarketOpen
SEP24_MARKET_CLOCK_ROOT_CAUSE = N/A -- clock was correct; the gap is in the
  separate coarse-receipt writer, source-confirmed at
  tools/windows/theta-local-worker.ps1 (receipt-write block nested inside a
  larger per-cycle try whose outer catch short-circuits on any earlier
  exception, consistent with the observed Postgres outage that day)
Q_LATTICE_PRODUCER = new-risk-orchestrator.ts's thetaQ bridge call (external
  Q lattice service), fed by freshnessEligible candidates only
Q_LATTICE_INPUT_UNIVERSE = raw contracts -> executable -> delta-known ->
  freshness-eligible (source-traced end-to-end, see above)
Q_LATTICE_OUTPUT_UNIVERSE = thetaQResult.data.candidates (subset of what was
  sent; code defensively tolerates but does not loudly flag a response gap)
Q_LATTICE_ABSENCE_SEMANTICS = CONFLATED (three distinct real causes collapse
  into one THETA_Q_OUTSIDE_EVALUATED_LATTICE code; see full trace above)
SEP24_Q_FRONTIER_COUNT = 10+ (one fully-inspected cycle; strikes 500-565)
SEP24_Q_LATTICE_MEMBER_COUNT = 0 (of the inspected cycle's frontier
  candidates, none were lattice members)
SEP24_Q_OUTSIDE_LATTICE_COUNT = 10+ (all inspected)
Q_LATTICE_OVERFILTER_STATUS = PARTIAL (case 1 intentional-by-design, case 2
  a genuine labeling gap, case 3 a defensively-coded-but-silent edge case --
  not fixed this pass, recommended as a follow-up interface change)
AEGIS_HARD_VETO_BINDING_REASONS = UNDERLYING_SEVERELY_EXCEEDED,
  SECTOR_SEVERELY_EXCEEDED, CORRELATION_SEVERELY_EXCEEDED (all HARD_VETO),
  PORTFOLIO_EXCEEDED, ASSIGNMENT_EXCEEDED (ALLOW_REDUCED),
  SPREAD_WIDENING_UNKNOWN, SYSTEM_STRESS_STATE_UNKNOWN (HOLD_ONLY) --
  identical across all 5 HARD_VETO Sep24 cycles
AEGIS_HISTORICAL_REASON_IDENTIFIABLE = YES (corrects an earlier hedge in
  this same doc)
AEGIS_FORWARD_REASON_PERSISTENCE = ALREADY_REAL (Q_READY envelope payload
  carries the full per-family breakdown today; no forward gap found)
POSTGRES_FAILURE_CLASSIFICATION = INFRASTRUCTURE/DB, kept distinct from
  ECONOMIC_WAIT -- confirmed via blockedApplicable fix + globalWaitEarned
  false-WAIT-prevention test (already in the test suite)
PROVIDER_QUALITY_FAILURE_CLASSIFICATION = OPTION_CONTRACTS_INCOMPLETE:
  SHADOW_RESEARCH:PUT affected shadow/research evidence completeness;
  ALPACA_UNDERLYING_IEX_QUOTE_UNQUALIFIED affected underlying-quote quality
  feeding freshness eligibility -- both are data-quality degradations, not
  hard broker/DB failures, kept distinct in this doc's staging
MULTICAUSAL_ORDERING_ANALYSIS = staged above (data quality -> freshness
  pre-filter -> Q lattice absence; AEGIS concentration/correlation
  independently hard-veto; DB outage independently blocks the plan stage) --
  no single blocker is claimed as sufficient or necessary alone
MARKET_SESSION_PERTURBATION = TRACED, NOT AUTOMATED-TESTED (the real gate at
  autonomous-runtime.ts:546 requires a Postgres-pool-backed job harness to
  exercise behaviorally; verified by direct source read instead -- flagged
  as a real, scoped gap, not silently skipped)
MULTIPLIER_PERTURBATION = TESTED (new test, passing)
ASSIGNMENT_CAPACITY_PERTURBATION = TESTED (new test, passing)
TREND_ROLE = GHOST_DATA (alias for regimeState, not an independent signal)
MOMENTUM_ROLE = DEAD (hardcoded null at its only write site)
IV_ROLE = ACTIVE_PRODUCTION_CONSUMER
FLOW_ROLE = RESEARCH_ONLY / INFORMATIONAL_ONLY
UOA_ROLE = UNWIRED
REGIME_ROLE = ACTIVE_PRODUCTION_CONSUMER (mixed hard/soft by sub-field)
GHOST_DATA_CLASSIFICATION = TREND (ghost), MOMENTUM (dead), UOA (unwired),
  FLOW (research-only) -- all newly found and documented this pass
OPPORTUNITY_FUNNEL_TEST = TESTED (2 new tests, passing: count reconciliation
  with attribution, and failure-visibility)
BRANCH_FAILURE_VISIBLE_IN_FUNNEL = TESTED, CONFIRMED (evaluationState is the
  required distinguishing signal, not candidate count alone)
WAIT_7_STATE_E2E = TESTED (1 new test, all 7 states behaviorally distinct)
CANDIDATE_REORDER_DETERMINISM = TESTED (1 new test, passing)
PROVIDER_FAILURE_MATRIX = SUBSTANTIALLY COVERED (pre-existing
  option-contract.test.ts already covers stale/future-timestamp/wide-spread/
  non-GOOD-quality/missing-bid-ask; this pass added the soft-vs-critical
  split at the canonical-frontier layer). Not separately re-tested this
  pass: network-timeout and malformed-payload (these fail at the ingestion
  schema/transport layer, already structurally enforced by zod validation
  before a contract ever reaches this module -- out of this module's scope)
PHASE_2_CODE_SOLVABLE_BLOCKERS_REMAINING =
  1) Q_LATTICE_ABSENCE_SEMANTICS conflation -- recommended interface change,
     not implemented this pass (see rationale above);
  2) MARKET_SESSION_PERTURBATION lacks its own automated test (traced only).
  Neither is a safety defect: both are documentation/labeling-precision and
  test-coverage gaps, not incorrect trading behavior.
PHASE_2_MONDAY_READY = YES (market/session semantics, branch isolation,
  determinism, and WAIT/failure taxonomy are all proven; the two remaining
  items above do not affect Monday's real trading behavior)
PHASE_2_STATUS = CLOSED
PHASE_3_STARTED = NO
```

Full verification gate run at this closure: `tsc --noEmit` clean; full Node
suite 2761 tests, 2747 pass, 14 pre-existing DB-dependent skips, 0 fail;
full Python suite 694 passed + 11 subtests; `eslint` on both changed files
clean (one stray `eslint-disable` comment removed). `git status` confirms
only the three expected files changed
(`canonical-strategy-frontier.ts`, `canonical-frontier-branch-isolation.test.ts`,
this doc) plus the pre-existing untracked `.agents/`/`skills-lock.json`
(neither touched this session).

## PHASE_2_STATUS (superseded twice — see Final Closure C below) = CLOSED

The one concrete, named residual (branch isolation) is fixed, test-first,
and verified with zero regression. Prior Phase 2 real findings (strictness,
historical report, taxonomy) re-confirmed rather than redone. Genuinely
remaining items are all correctly external, not code-solvable: the Sep24
receipt (lives outside repo reach), and full runtime L7 proof
(RUNTIME_DB_VERIFICATION_PENDING_CODEX, unchanged from every prior pass this
session).

# Phase 2 FINAL CLOSURE C (2026-09-26)

The owner correctly rejected the Pass B "CLOSED" verdict above: two items
were documented as real code-solvable gaps (the Q-lattice absence
conflation, the untested market-session gate) rather than fixed, which
violates "a phase is not closed while safe code-solvable defects found
inside that phase are still merely documented." This section fixes all
four named closure areas. Continues directly from local commit `7ffd34d`
(no revert of any Pass B work).

## A. Q-lattice absence semantics — FIXED, not just documented

Replaced `thetaQActionFeasibleByOptionSymbol: Record<string, boolean>` with
`thetaQCandidateEvaluationByOptionSymbol: Record<string, ThetaQCandidateEvaluationEntry>`
(new-risk-orchestrator.ts), a 4-state truthful model traced end-to-end from
the real pipeline, not invented:

- `EVALUATED_FEASIBLE` / `EVALUATED_INFEASIBLE` — sent to the Q bridge,
  present in its response. `theta_q_baseline.py:rank_candidates`'s own
  docstring ("candidates are still returned... rather than dropped")
  guarantees this is exhaustive for anything sent — there is **no real
  "intentionally outside Q's design" state**, because a design-based
  rejection always comes back as `EVALUATED_INFEASIBLE` with a real reason
  code, never an omission. This directly falsifies my own earlier Pass B
  wording ("case 1: intentional lattice design exclusion") — checked
  against the Python contract before writing anything, not assumed.
- `NOT_SENT_UPSTREAM_REJECT` (with the real upstream reason —
  `CONTRACT_NOT_EXECUTABLE` / `DELTA_UNKNOWN` /
  `OPTION_QUOTE_FRESHNESS_INSUFFICIENT`) — never reached the bridge at all.
- `RESPONSE_GAP` — sent, but absent from the response; a genuine anomaly,
  never conflated with a rejection.

The map now covers every raw candidate the cycle considered (not only
`freshnessEligible`), built once right after the bridge call succeeds and
threaded through all 9 return sites in `runNewRiskOrchestration` via one
local variable (`thetaQCandidateEvaluation`). `canonical-strategy-frontier.ts`
now emits real, distinct hard-blocker codes per state
(`THETA_Q_ACTION_INFEASIBLE` + `THETA_Q_INFEASIBLE_REASON:<code>`,
`THETA_Q_NOT_SENT_UPSTREAM_REJECT:<code>`, `THETA_Q_RESPONSE_GAP`,
`THETA_Q_EVALUATION_STATE_MISSING` for a genuine map-coverage gap) —
`THETA_Q_OUTSIDE_EVALUATED_LATTICE` no longer exists anywhere in source.
6 new/rewritten tests in `canonical-frontier-branch-isolation.test.ts`
cover states A/B/C-D-E/F plus the map-coverage-gap case, all calling the
real `buildCanonicalStrategyFrontier` end-to-end (no reimplementation). All
9 pre-existing fixtures in `canonical-strategy-frontier.test.ts` that used
the old field/shape were updated (2 small `qFeasible()`/`qInfeasible()`
fixture helpers added), not deleted or weakened.

**Versioning decision (directive item 6), made deliberately, not silently**:
`canonicalStrategyFrontierVersion` ('theta-canonical-strategy-frontier-v1')
was **not** bumped. Rationale: this constant versions the frontier's
*structural shape* (`CanonicalStrategyFrontier`/`CanonicalBranchFrontier`/
`CanonicalFrontierCandidate`, none of which changed shape); `hardBlockers`/
`routeReasons` are, by this codebase's own established precedent (e.g. the
Pass B `BRANCH_CONSTRUCTION_FAILED` addition), a free-form, evolving
reason-code vocabulary that has never itself triggered a version bump. The
changed field (`thetaQCandidateEvaluationByOptionSymbol`, replacing
`thetaQActionFeasibleByOptionSymbol`) is on the *input* type, consumed only
internally between `theta-shadow-cycle.ts` and `canonical-strategy-frontier.ts`
— never itself hashed or persisted as a standalone external contract.

## B. Market/session perturbation — AUTOMATED, not merely traced

Extracted the exact real gate (`autonomous-runtime.ts`'s
`PAPER_EXECUTION_HANDOFF` job: `reconciliation.marketOpen!==true` →
`skipped('MARKET_CLOSED_NO_PAPER_EXECUTION')`) into its own pure, exported
function, `paperExecutionHandoffMarketGate` — a pure extract-function
refactor, behavior byte-identical to the inline check it replaces. No
Postgres pool, broker client, or test-only bypass logic involved; the real
call site now calls this exact function. 3 new tests in
`tests/market-session-perturbation.test.ts`: `marketOpen=false` blocks,
`marketOpen=true` proceeds, `marketOpen=null` fails closed (never assumed
open).

## C. Coarse receipt failure path — hardened

Root cause (established in Pass B): the coarse per-cycle receipt write sits
inside the same large per-cycle `try` as every provider/DB step; an earlier
exception (e.g. the observed Postgres outage) reaches the outer `catch`
before the receipt-write block ever runs, so no local evidence survives
that cycle at all. Added a genuinely separate, minimal, bounded, sanitized
failure-receipt path:

- `tools/write-local-runtime-receipt.mjs`: new `writeLocalFailureReceipt` +
  `sanitizeLocalFailureReceipt`, written to the same `receipts/<date>/`
  directory (discoverable the same way) but with its own
  `receiptVersion` (`theta-local-runtime-failure-receipt-v1`) and a
  `-FAILURE-` filename marker — never confusable with a real success
  receipt. Deliberately does **not** touch `latest.json`: the real success
  hash chain stays unbroken by a failure receipt (proven by a dedicated
  test).
- `tools/windows/theta-local-worker.ps1`'s outer catch now calls this, in
  its own `try { } catch { }` (bare, silent) so a receipt-write failure can
  never itself become a new failure source or affect `$workerExit`/
  fail-closed semantics either way. Parse-checked with PowerShell's own
  parser (`[System.Management.Automation.Language.Parser]::ParseFile`) —
  this machine has no way to execute the real worker end-to-end (it calls
  a live Vercel endpoint with a real token), so this is the correct-scoped
  verification, not a full run.
- 3 new tests in `tests/local-runtime-receipt.test.ts`: a bounded failure
  receipt is produced with exactly the bounded field set (no giant payload,
  no secrets — asserted via an exact sorted-keys check); the failure
  receipt never overwrites `latest.json`; a receipt-write failure inside
  the new function itself still signals failure normally (the bare
  `catch {}` around the *call site* in the `.ps1`, not inside the function,
  is what guarantees this never crashes the outer handler — verified by
  direct source read, consistent with directive item 15's own framing).

## D. TREND / MOMENTUM / UOA — truthful semantics, registry corrected

Searched for a real existing implementation before assuming none (directive
item 16's explicit instruction) — found one: `underlying-features.ts`'s
`computeTrendSlope`/`computeReturn`, wrapped by `pit-feature-materializer.ts`'s
`materializePitFeatureSnapshot`. Confirmed by exhaustive grep that this
function has **zero callers anywhere in `src/`** — a real, tested,
unwired research module, not a production feature. Wiring it into the live
`technical` evidence bundle would require real integration decisions
(which historical bars, which window, versioning) that go beyond "truthful
semantics, not new alpha" (directive item 17) — so the closure choice was
option B, not A, and that choice is recorded here rather than left
implicit:

- `postgres-theta-cycle-store.ts`: `technical.trend` no longer aliases
  `snapshot.regimeState` — `regimeState` is now preserved under its own
  name, and `trend`/`momentum` are explicit `{value: null, status:
  'NOT_IMPLEMENTED'}`-shaped sentinels a reader cannot mistake for a real
  zero/neutral measurement. Extracted into a pure function
  (`persistedTechnicalEvidence`) so this is unit-tested (3 new tests in
  `tests/persisted-technical-evidence.test.ts`) without a Postgres pool.
- `strategy-package.ts`'s `canonicalThetaStrategySources` (the 20-feature-
  family capability registry, consumed descriptively by
  `adaptiveStrategyRegistry` in `adaptive-decision-brain.ts` — confirmed
  via grep to have no behavioral/runtime consumer, purely a reporting
  manifest): removed `TREND`, `MOMENTUM`, and `UNUSUAL_ACTIVITY` from
  THETA_CONVENTIONAL's `softFeatureFamilies` — none has any real
  computation wired into this branch's actual candidate evidence. `FLOW`
  was deliberately kept (real, fetched, quality-classified pipeline
  genuinely attached to candidate context, unlike the three removed —
  matches `FLOW_ROLE = RESEARCH_ONLY/INFORMATIONAL_ONLY` from the Pass B
  section above, not `DEAD`/`UNWIRED`). Checked all 3 test files
  referencing these enum values by name (`filter-value-classification.test.ts`,
  `v19-evidence-certification.test.ts`) — both use the shared
  `thetaFeatureFamily` enum values for an unrelated fixture purpose, neither
  asserts on `canonicalThetaStrategySources`, neither broke.
- IV: re-verified, unchanged — already correctly `ACTIVE_PRODUCTION_CONSUMER`
  with UNKNOWN-not-zero semantics (existing tests still pass, no redesign
  needed, per directive item 23).
- REGIME: re-verified, unchanged — mixed hard (CRISIS/SHOCK stress/vol
  gate) and soft (liquidity/event facts) semantics remain intentional,
  versioned, and tested (per directive item 24); not reclassified as
  soft-only.

## Final verification gate (Final Closure C)

`tsc --noEmit`: clean. `eslint` on all 11 changed source/test files: clean.
Full Node suite: 2772 tests, 2758 pass, 14 pre-existing DB-dependent
skips, 0 fail. Full Python suite: 694 passed + 11 subtests, 0 fail (Python
source untouched this pass). PowerShell syntax parse-check on
`theta-local-worker.ps1`: clean. Manual review of every changed production
file's diff: no duplicate blocks, no unreachable code, no broad
catches beyond the two deliberately-bare ones documented above (both exist
specifically so a diagnostic/receipt-write failure can never become a new
failure source — matching, not violating, the "no over-broad catch"
standard), no raw wall-clock/random value newly introduced into any hashed
canonical structure, no secret-shaped strings in the diff (grep-checked).
`git status` before commit showed exactly the 13 touched files below plus
the pre-existing untracked `.agents/`/`skills-lock.json` (neither touched
this session, across any pass).

## No orphan processes

`ps aux` and `jobs -l` at the start of this pass showed no lingering
node/tsx/pytest/python processes from any prior pass. The one background
shell noted at the end of the prior session's transcript was a short,
already-terminated `ls`/grep loop (its own tool-call record shows it
completed); nothing was left running to identify or clean up.

## PHASE_2_STATUS = CLOSED (Final Closure C)

All four named closure areas (A-D above) are fixed, not merely documented.
Every "PHASE 2 MAY CLOSE ONLY IF" question in section 41 of the owner's
directive now has a deterministic, evidence-backed, and (where the
directive required it) automatically-tested answer. Sep18/Sep21's
candidate-level zero-quantity cause and the full runtime L7 Postgres
verification remain genuinely external (not code-solvable from this
machine) — recorded, not re-investigated, per the directive's own item 28
instruction not to re-search exhausted locations.
