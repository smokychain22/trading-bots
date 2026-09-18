# THETA Orchestration Research — Claude's Scoped Contribution

**Status:** This is Claude's assigned slice of the required
`THETA_ORCHESTRATION_ARCHITECTURE.md` artifact (per the "GitHub
Orchestration / Infrastructure Research" directive), covering the five
repositories assigned to Claude: XState, Temporal TypeScript Samples,
Bitloops DDD/Hexagonal/CQRS/ES/EDA, fast-check, and OpenTelemetry
semantics. It does **not** attempt Codex's assigned sections (Temporal
core SDK durability decision, transactional outbox implementation,
execution/broker restart recovery, Testcontainers, Cockatiel) — those
require visibility into Codex's current execution-layer code that this
session does not have, and duplicating that analysis without it would
itself violate the "verify, don't invent" instruction. Sections below are
labeled `[CLAUDE]` or `[CODEX SCOPE — NOT AUTHORED HERE]` accordingly.

No code was changed to produce this document. Per the directive's own
Step 10 ("implement only after proving value"), nothing here is
implemented yet -- it is a research/mapping deliverable for review.

---

## 0. Verification method

All five repositories were verified via `gh api` (GitHub REST API, real
network calls, authenticated as the connected account) on 2026-09-17.
`default_branch`, `license`, and the latest commit SHA on that branch were
read directly from the API, not guessed. For the highest-value extraction
target in each repo, the actual source file (not just README marketing
copy) was fetched and read in full. Directory listings were fetched live
to confirm named topics (mutex, signals-queries, worker-versioning, etc.)
genuinely exist in the repo rather than being assumed from the directive's
own wording.

---

## 1. Per-repo receipts

### REPO: statelyai/xstate
- **VERIFIED_URL:** https://github.com/statelyai/xstate
- **VERIFIED_DEFAULT_BRANCH:** main
- **VERIFIED_COMMIT_SHA:** `fbee62e7c1586315ed478c2fedf530d7e0ff5a3e` (latest on `main` at verification time, pushed 2026-09-15)
- **VERIFIED_LICENSE:** MIT
- **FILES_READ:** `packages/core/src/guards.ts` (full file, real content)
- **FEATURES_VERIFIED:** Guards are pure predicates of shape
  `(args: {context, event}, params) => boolean`, composable via
  `NoRequiredParams`/`WithDynamicParams`/`GuardPredicate` types. A
  transition only fires when its guard predicate returns true. This
  confirms (not just documents) that XState's guard model has **no
  side-effecting or alpha-decision logic inside a guard** — guards are
  boolean gates over already-known context/event, exactly the shape a
  lifecycle-legality check should have.
- **USEFUL_METHODS:** hierarchical/parallel state definition, guarded
  transitions as pure predicates, `setup()`/`createMachine()` typed-actor
  model, model-based testing tooling (not read in depth this pass).
- **THETA_CURRENT_EQUIVALENT:** THETA's canonical lifecycle
  (`ThetaLifecycleState` in `runtime-state.ts`, consumed by
  `management-input-state.ts`/`management-action-frontier.ts`) is
  currently an **implicit** state machine — lifecycle values are a string
  union and the applicable-action set per state is a hand-written map
  (`actionSets` in `management-action-frontier.ts`), not a formally
  defined machine with guarded transitions. It works, and every transition
  I've audited this engagement is broker-truth-driven and fail-closed,
  but the legality of a transition (e.g. "CSP_OPEN -> ASSIGNED_STOCK is
  legal only when brokerReconciled AND quoteFresh AND assignmentCapacity>0")
  is scattered across `evaluateAction()`'s blocker logic rather than
  declared once.
- **GAPS_FOUND:** No single, inspectable state-transition table exists
  today. A reviewer must read `management-action-frontier.ts` procedurally
  to learn "what transitions are legal from CSP_OPEN," rather than reading
  a declared machine.
- **PROPOSED_THETA_MAPPING:** `LIFECYCLE_STATE_MACHINE` layer. **Do NOT**
  adopt XState as a runtime dependency for this. Adopt the **concept**:
  express THETA's lifecycle legality as an explicit table of
  `{from, to, guards: PureBooleanPredicate[]}` -- guards named exactly
  like the directive's own list (`brokerReconciled`, `quoteFresh`,
  `AEGISAllows`, `rollCloseConfirmed`, `sharesSufficientForCC`,
  `assignmentCapacityAvailable`, `decisionVersionValid`,
  `executionLeaseOwned`) -- as a plain data structure the existing
  `evaluateAction()`/`structuralExpirationSelection()` logic can validate
  against, or eventually be rewritten in terms of. This makes the lifecycle
  legality declarative and testable in isolation from the economics, which
  is exactly XState's separation of concerns (statechart = legality,
  actions = side effects elsewhere) -- without adding a runtime dependency
  or an actor-model execution engine THETA does not need.
- **DECISION: REFERENCE_ONLY.** The pattern (guards as pure predicates,
  declared transition table) is worth adopting conceptually; the library
  itself is not worth installing for a system whose lifecycle already has
  a working, tested, fail-closed implementation. Installing XState would
  add an actor-model runtime for a state space that's currently ~13 states
  with well-understood transitions -- real cost, no proven gap it closes
  that Postgres-recorded lifecycle_state + guard functions don't already
  close.
- **CODE_CHANGED:** none. **TESTS_ADDED:** none.
- **RISKS:** If adopted as a literal dependency, XState would give the
  statechart library authority over transition *legality* -- explicitly
  fine per the directive ("It may govern legal lifecycle state
  transitions") -- but the real risk is scope creep: XState actors can
  also run side effects (`invoke`, actions), which would make it easy to
  accidentally let the statechart start making economic decisions.
  If the concept is adopted without the library, this risk doesn't exist
  at all, which is a point in favor of REFERENCE_ONLY over ADOPT here.

---

### REPO: temporalio/samples-typescript
- **VERIFIED_URL:** https://github.com/temporalio/samples-typescript
- **VERIFIED_DEFAULT_BRANCH:** main
- **VERIFIED_COMMIT_SHA:** `8907f2950c1d12936306667fca933c600a61cf7b` (pushed 2026-09-16)
- **VERIFIED_LICENSE:** `NOASSERTION` (GitHub could not classify a license
  file automatically at the API level -- the repo does contain a `LICENSE`
  file per the root directory listing, but its SPDX identifier was not
  machine-classifiable via this API call; the file itself was not read in
  full this pass, so I report this honestly as unresolved rather than
  guessing MIT).
- **FILES_READ:** root directory listing (confirmed real: `mutex`,
  `signals-queries`, `worker-versioning`, `continue-as-new`,
  `activities-dependency-injection`, `activities-cancellation-heartbeating`,
  `patching-api`, `saga`, `schedules`, `child-workflows` all genuinely
  exist as top-level sample directories); `mutex/README.md` (full);
  `worker-versioning/README.md` (full); `signals-queries/README.md` (full).
- **FEATURES_VERIFIED:**
  - **Mutex sample**: a dedicated `lockWorkflow` serializes
    `lock-requested` → `lock-acquired` → (caller does work) →
    release-signal, guaranteeing exactly one Workflow Execution holds a
    named lock at a time.
  - **Worker Versioning sample**: demonstrates auto-upgrading vs. pinned
    workflows and the `patched()` API for compatible-vs-incompatible code
    changes while workflows are already running -- i.e., Temporal's
    answer to "upgrade code while long-lived executions are open."
  - **Signals/Queries sample**: external callers send Signals (mutating,
    async, no return value) and Queries (read-only, synchronous) into a
    running Workflow via `Client.workflow`, and the Workflow handles them
    in `workflows.ts`.
- **USEFUL_METHODS:** the mutex handshake protocol; the
  pinned-vs-auto-upgrade worker versioning model; Signal/Query as the
  external-interaction primitive for a long-running process.
- **THETA_CURRENT_EQUIVALENT:**
  - **Mutex** → THETA already has this, differently but soundly:
    `management-input-state.ts`'s
    `PostgresManagementInputStore.assembleAndPersistOpenChains()` calls
    `pg_advisory_xact_lock(hashtext(chain_id))` before reading/writing a
    chain's state, and `operator-control.ts` (read in an earlier P2F audit
    this engagement) uses `pg_advisory_xact_lock` plus a monotonic
    state-version CAS for the emergency-lock/clear mechanism. This is a
    real, working, already-tested "one lifecycle/action owner per chain"
    guarantee -- it does not require a running Temporal server or a
    dedicated lock-broker workflow to get the same one-owner property
    Temporal's mutex sample demonstrates.
  - **Worker Versioning / upgrade-while-running** → THETA does NOT have
    an equivalent today. The P2D-era `strategy-version-store.ts` /
    strategy-hash-mismatch-rejection mechanism (audited this engagement)
    rejects a MISMATCHED strategy version, but there is no `patched()`-
    style mechanism for evolving a policy's code while a chain that
    entered under the old version is still open and being managed. This
    is a genuine, real gap Temporal's sample names precisely, matching
    directives from earlier in this engagement (item 11, "open position
    ownership survives version changes" / `entry_policy_version` +
    `current_management_policy_version` + `policy_transition_history`).
  - **Signals/Queries** → THETA doesn't need this as a runtime primitive;
    operator interaction already goes through Postgres-recorded operator
    commands (`operator-control.ts`'s `PAUSE`/`EMERGENCY_LOCK`/
    `CLEAR_EMERGENCY_LOCK`), which are read by the next cycle rather than
    delivered to a live in-memory process. This is a reasonable
    architectural difference given THETA is a poll-based cycle worker, not
    a long-lived in-process workflow -- there is no "running workflow" to
    signal into between cycles.
- **GAPS_FOUND:** The genuine, real gap is the upgrade-while-open-position
  concept -- versioned management-policy transition history is *specified*
  in earlier directives but I have not verified it is *implemented* this
  session (it would live in Codex's execution/lifecycle-application
  domain, which I have not re-read this pass).
- **PROPOSED_THETA_MAPPING:** `THETA_DECISION_ORCHESTRATOR` /
  `LIFECYCLE_STATE_MACHINE` boundary. Adopt the **concept** of
  pinned-vs-auto-upgrade: when a chain is deployed under
  `entry_policy_version=A` and a new `management_policy_version=B` is
  released, THETA should decide per-chain (not per-fleet) whether that
  chain is "pinned" (keeps being managed by A's rules until closed) or
  "auto-upgraded" (moves to B at the next safe transition point), and
  record which choice applied and why.
- **DECISION: REFERENCE_ONLY** for the mutex pattern (already correctly
  solved via Postgres advisory locks -- no gap to close).
  **TEST_ONLY / not yet adoptable** for the versioning concept: worth a
  small design spike (does the existing strategy-version-store already
  cover this, or is it a real gap?) before proposing any code, since I
  have not verified Codex's current state on this.
- **CODE_CHANGED:** none. **TESTS_ADDED:** none.
- **RISKS:** None from reference-only adoption. If the versioning concept
  is eventually built, the risk is exactly what item 11 of an earlier
  directive already named: orphaning an open chain's management authority
  during a code deploy. Any implementation needs a test proving a chain
  that opened under version A is never silently handed to version B's
  rules without an explicit, recorded transition decision.

---

### REPO: bitloops/ddd-hexagonal-cqrs-es-eda
- **VERIFIED_URL:** https://github.com/bitloops/ddd-hexagonal-cqrs-es-eda
- **VERIFIED_DEFAULT_BRANCH:** main
- **VERIFIED_COMMIT_SHA:** `c05b2dee2ea5d74c8ad2e39d658317fd67aff988` (pushed 2026-08-02)
- **VERIFIED_LICENSE:** MIT
- **FILES_READ:**
  `backend/src/bounded-contexts/todo/todo/repository/todo-outbox.relay.ts`
  (full, real content, reproduced below in condensed form for evidence).
- **FEATURES_VERIFIED:** A real, working transactional-outbox relay:
  - Poll loop (`setInterval`, unref'd so it doesn't block process exit)
    plus a `flushing` boolean guard preventing overlapping flush runs
    (single-flight, in-process).
  - `claimNext()` uses `SELECT ... FOR UPDATE SKIP LOCKED` inside an
    `UPDATE ... FROM candidate ... RETURNING` to atomically claim exactly
    one unpublished, not-currently-locked row, stamping `locked_until` and
    incrementing `attempts` in the same statement -- this is the concrete
    mechanism that lets **multiple relay instances** run concurrently
    without double-processing the same outbox row (real horizontal
    scaling safety, not just single-process safety).
  - On successful publish: `published_at = NOW()`, lock cleared, error
    cleared.
  - On failure: `available_at` pushed forward by an **exponential backoff
    capped at 60s** (`Math.min(60_000, 1_000 * 2 ** min(attempts-1, 6))`),
    lock released, error message recorded -- and this UPDATE is
    conditioned on `published_at IS NULL`, so a message that somehow got
    published between the claim and the failure branch can never be
    silently reset back to retryable.
- **USEFUL_METHODS:** the exact `FOR UPDATE SKIP LOCKED` claim-and-lock
  SQL pattern; the `locked_until`/`available_at`/`attempts`/`last_error`
  column schema; the capped-exponential-backoff formula; the
  single-flight in-process guard combined with DB-level row locking for
  cross-process safety.
- **THETA_CURRENT_EQUIVALENT:** This is squarely **Codex's execution/
  broker domain** (the exact ambiguous-state problem the directive names:
  "broker received order but DB did not record state" / "DB says
  submitted but broker never received it"), not mine. I have not reviewed
  Codex's current order-submission code this session, so I cannot say
  whether an equivalent outbox/claim mechanism already exists there. I am
  recording this as a **verified, concrete, adoptable pattern for Codex's
  review**, not proposing to build it myself.
- **GAPS_FOUND:** N/A -- deferred to Codex, since evaluating "does THETA
  already implement this correctly" requires reading Codex's current
  order-submission/reconciliation code, which is out of my scope this
  session.
- **PROPOSED_THETA_MAPPING:** `EXECUTION_COORDINATOR` / `BROKER_ADAPTER`
  boundary -- **CODEX SCOPE**. I am not proposing to implement this.
- **DECISION: REFERENCE_ONLY** (from my side of the boundary) --
  **flagged to Codex as a concretely useful, verified pattern** worth
  their own ADOPT/ADAPT evaluation against their current broker-order
  submission code.
- **CODE_CHANGED:** none. **TESTS_ADDED:** none.
- **RISKS:** None from documenting this; the risk would be in
  implementation (idempotent client order IDs, exactly-once broker
  submission semantics), which is explicitly Codex's call to make against
  their own current code, not something I should design blind.

---

### REPO: dubzzz/fast-check
- **VERIFIED_URL:** https://github.com/dubzzz/fast-check
- **VERIFIED_DEFAULT_BRANCH:** main
- **VERIFIED_COMMIT_SHA:** `5de217105a5011e14295d6bdfcf6fe002d613877` (pushed 2026-09-17, actively maintained)
- **VERIFIED_LICENSE:** MIT
- **FILES_READ:** `packages/fast-check/src/arbitrary` directory listing
  (confirmed real: `integer.ts`, `record.ts`, `tuple.ts`,
  `constantFrom.ts`, `string.ts`, `base64String.ts`,
  `stringMatching.ts`, `mapToConstant.ts`, `maxSafeInteger.ts` all exist).
- **FEATURES_VERIFIED:** Composable arbitrary generators
  (`fc.record({...})`, `fc.integer()`, `fc.tuple()`,
  `fc.constantFrom(...)`) that build structured random-but-constrained
  inputs, run under `fc.assert(fc.property(arbitrary, predicate))`, with
  automatic shrinking on failure (not verified in this pass at the
  implementation-detail level, but this is fast-check's documented core
  mechanism and matches its actual `arbitrary/` module structure).
- **USEFUL_METHODS:** `fc.record()` to build a constrained
  `ManagementInputState`-shaped fixture (spot/strike/dte/bid/ask/Greeks/
  positions all drawn from bounded arbitraries respecting real invariants
  like `ask >= bid` by construction); `fc.property()` to state an
  invariant as a predicate over arbitrary inputs rather than one hand-
  picked example.
- **THETA_CURRENT_EQUIVALENT:** THETA's test suite (1030+ Node tests as of
  the last management-lane commit) is currently 100% example-based --
  every test in `paper-bootstrap-management-policy.test.ts`,
  `management-action-frontier.test.ts`, etc. hand-picks specific
  spot/strike/bid/ask values. This is honest and effective for proving
  *specific* scenarios (which this engagement has done extensively), but
  it cannot prove a *general* invariant like "for every valid quote, ask
  >= bid implies X" the way property-based testing can -- an adversarial
  combination outside the hand-picked examples could still break an
  invariant undetected.
- **GAPS_FOUND:** No property-based tests exist anywhere in the
  management-economics modules I've built this engagement
  (`common-horizon-economics.ts`, `roll-incremental-utility.ts`,
  `covered-call-lattice.ts`, `whole-chain-economics.ts`,
  `thesis-invalidation.ts`, `loss-state-vector.ts`,
  `paper-bootstrap-management-policy.ts`). Several of the directive's
  named invariants are things these modules already claim to guarantee by
  construction (e.g. "same immutable snapshot + same versions => same
  decision" is true by these modules being pure functions of their input)
  but this has never been *adversarially tested* -- only asserted by
  example.
- **PROPOSED_THETA_MAPPING:** `TESTING` layer. **ADOPT** fast-check as a
  dev dependency scoped to the management-economics modules I own, and
  add property tests for the invariants most directly under my authority:
  - `quantity/multiplier/contracts >= 0` is never violated by any
    `ManagementActionEconomics`/`RollCandidateAssessment` this policy
    produces, for arbitrary (bounded) inputs.
  - `forwardContinuationCashFlow`/`computeCoveredCallUtility`/
    `evaluateRollCandidates` are **deterministic**: calling them twice
    with the same (arbitrary) inputs always returns the same result
    (a real, adversarial version of the "same snapshot => same decision"
    invariant, restricted to the pure functions I actually control).
  - `computeWholeChainPnl`'s "an unknown leg makes the total null, but
    every known leg is still reported" behavior holds for arbitrary
    combinations of null/known legs, not just the hand-picked combination
    in the existing example tests.
  - `computeEffectiveStockBasis` never returns a basis that, when
    fees/slippage are both held at 0 and rollCredits=rollCloseCosts=0,
    differs from `assignmentStrike - initialPutPremium/shares` (an
    algebraic identity that should hold for arbitrary numeric inputs, not
    just the one worked example in the existing test file).

  I have **not** written this adoption yet -- per Step 10, this is
  proposed for the next implementation pass, not done in this research
  turn.
- **DECISION: ADOPT** (proposed, not yet implemented).
- **CODE_CHANGED:** none this turn. **TESTS_ADDED:** none this turn.
- **RISKS:** Property tests can be slow or flaky if arbitraries are
  unbounded (e.g. `fc.integer()` without bounds could generate
  economically nonsensical values like a $1e300 strike) -- every arbitrary
  must be bounded to realistic ranges, or the "invariant failure" it finds
  will be a fixture-construction artifact, not a real bug. This needs
  care in the implementation pass, not a reason to avoid adopting it.

---

### REPO: open-telemetry/opentelemetry-js
- **VERIFIED_URL:** https://github.com/open-telemetry/opentelemetry-js
- **VERIFIED_DEFAULT_BRANCH:** main
- **VERIFIED_COMMIT_SHA:** `7fae1b4e7ff6ddefff37105c3b83d29c4d572f43` (pushed 2026-09-17, actively maintained)
- **VERIFIED_LICENSE:** Apache-2.0
- **FILES_READ:** `api/` and `packages/` directory listings (confirmed
  real: `opentelemetry-context-async-hooks`, `opentelemetry-sdk-trace-base`,
  `sdk-metrics`, `opentelemetry-propagator-b3` all genuinely exist,
  matching the directive's named topics of context propagation and
  correlation).
- **FEATURES_VERIFIED (at the directory-structure/package-existence
  level, not full implementation-detail level given time budget):**
  dedicated packages for context propagation via async hooks (Node's
  native `AsyncLocalStorage`-based mechanism), trace SDK base, metrics
  SDK, and standard propagators (B3) -- confirms the repo genuinely
  implements the trace/span/context-propagation model the directive
  describes, not just documents it.
- **USEFUL_METHODS:** the trace/span/context-propagation *concept* (a
  span per named unit of work, nested to form one trace per top-level
  operation, correlation ID threaded through via context, not manually
  passed as a function parameter everywhere).
- **THETA_CURRENT_EQUIVALENT:** THETA does not currently have a unified
  trace per cycle. What exists instead (verified across this engagement's
  own audits) is **structured reason codes** -- every `ManagementPolicyEvidence`/
  `ManagementActionFrontier`/`ThesisInvalidationAssessment` I've built
  carries an explicit `reasons`/`reasonCodes` array explaining its own
  output, and these already answer "why did THETA HOLD/CLOSE/ROLL" at the
  level of a single decision. What's missing is the **cross-stage
  correlation** the directive's example trace shows -- linking
  `broker.reconcile` → `snapshot.build` → `strategy.route` →
  `action.frontier` → `theta.decide` → `decision.persist` →
  `execution.prepare` → `alpaca.submit` under one trace/correlation ID, so
  a reviewer can follow one cycle end-to-end rather than reading each
  stage's own isolated evidence separately.
- **GAPS_FOUND:** No unified `theta.cycle` trace/correlation ID exists
  today spanning both my management-decision evidence and Codex's
  broker/execution evidence. This is a real, joint gap -- neither agent's
  code alone can create the missing correlation across both domains'
  outputs.
- **PROPOSED_THETA_MAPPING:** `OBSERVABILITY` layer. **ADAPT** the
  *concept*, not necessarily the OpenTelemetry SDK itself: every
  `ManagementPolicyEvidence` I produce already carries
  `inputContentHash`/`decidedAt`/`policyVersion` -- these already function
  as a natural correlation key (the snapshot's content hash). The gap is
  that this key isn't threaded through to Codex's execution-side records
  (order intents, fills, broker reconciliation) in a way that lets someone
  reconstruct the directive's example trace today. Adopting the full
  OpenTelemetry SDK (spans, exporters, collectors) would be a heavier
  infrastructure decision spanning both agents' domains -- **I am not
  proposing that unilaterally.** The smaller, immediately actionable
  version: ensure my `inputContentHash`/`decisionId`-equivalent fields are
  the join key Codex's execution-side persistence already uses (or should
  use) for its own records, so the two sides of one decision are
  reconstructible without adopting a new tracing framework.
- **DECISION: TEST_ONLY / REFERENCE_ONLY** for the SDK itself (a real
  infrastructure adoption decision requiring Codex's input on the
  execution side); **ADAPT** the correlation-ID concept using what
  already exists (`inputContentHash`) rather than introducing a new ID
  scheme.
- **CODE_CHANGED:** none. **TESTS_ADDED:** none.
- **RISKS:** None from the conceptual adoption. If the full OpenTelemetry
  SDK is later adopted, the standing rule applies without exception:
  "Never include secrets in telemetry" -- span attributes must never carry
  credential values, and this is exactly the kind of surface where a
  well-meaning "log everything for debuggability" instinct could
  accidentally violate the project's credential-handling rule.

---

## 2. Claude-scoped architecture sections

### Lifecycle state machine (Section 11 of the required artifact)
Covered above under the XState receipt: THETA's lifecycle is currently an
implicit machine (string-union state + hand-written applicable-action
maps). The concrete, low-risk improvement is a declared
`{from, to, guards}` transition table using the directive's own named
guard predicates, checked by a test that walks every declared transition
and asserts the current `evaluateAction()`/`structuralExpirationSelection()`
behavior agrees with it -- not a rewrite, a **cross-check** that would
catch silent drift between the declared legal-transition table and the
actual code.

### Shadow challenger architecture (Section 16)
Not newly designed this pass -- see the standing
`management-policy-promotion-ladder.ts` (BOOTSTRAP_PAPER →
SHADOW_CHALLENGER → PAPER_CANDIDATE → PAPER_CHAMPION, `liveEligible`
hardcoded false) from an earlier milestone this engagement. Per this
directive's own item 21 ("Champion/challenger does not mean multiple live
brains"), that ladder already satisfies the invariant
`SHADOW_CHALLENGERS_HAVE_BROKER_AUTHORITY = NO` by construction --
`ManagementPolicyPromotionAssessment` has no field that could authorize a
broker action, only a promotion *state*. The still-missing piece (the
actual harness persisting champion-vs-challenger-vs-outcome triples) is
unchanged from my last two receipts: not built yet, correctly sequenced
behind the assignment/recovery/CC work per this same directive's item 19
("do not start large ML yet... shadow challenger exists" as a
prerequisite, not yet met).

### Whole-chain accounting ownership (Section 15)
`whole-chain-economics.ts` (`computeEffectiveStockBasis`,
`computeWholeChainPnl`) is the canonical accounting module on my side,
already tested to preserve `LEG_LEVEL_PNL` alongside `WHOLE_CHAIN_PNL`
(a losing option leg inside an eventually-profitable chain is never
hidden -- proven by an explicit test from an earlier milestone this
session). It is NOT yet the single system-wide accounting authority the
directive requires, because it is not yet consumed by every action
(`CLOSE_FULL`/`ROLL`/`ACCEPT_ASSIGNMENT` still use local, per-action P&L
math rather than this shared module) and it has no visibility into
Codex's broker-side fill/fee records. Making it the true canonical
authority requires both (a) finishing the wiring on my side (an honest,
already-flagged gap from my last receipt) and (b) Codex's execution layer
feeding real fill/fee data into the same component shapes
(`WholeChainComponents`) rather than a separate accounting
representation.

### Testing/invariant architecture (Section 18)
Covered under the fast-check receipt above: proposed, not yet
implemented. The concrete next step is adding `fast-check` as a dev
dependency and writing 3-5 property tests against the pure functions I
already own, scoped narrowly enough to avoid becoming its own multi-day
project.

### [CODEX SCOPE — NOT AUTHORED HERE]
Sections 8 (execution boundary), 9 (broker adapter), 10 (lifecycle state
machine's broker-reconciliation half), 12 (transactional outbox design),
13 (broker reconciliation model), 14 (restart/deployment recovery) all
require reading Codex's current execution/broker code, which this session
did not do. I have flagged the one concrete, verified, adoptable pattern
relevant to that domain (Bitloops' outbox relay) above, but I am not
proposing an implementation for it -- that decision belongs to whoever
owns and can verify the current broker-submission code against it.

---

## 3. What I am explicitly NOT doing this pass

- Not installing any of these five packages as runtime dependencies.
- Not writing the fast-check property tests yet (proposed, staged for a
  follow-up implementation pass once reviewed).
- Not designing or building an outbox/transactional-order mechanism
  (Codex's domain; flagged for their review instead).
- Not building a formal XState-based lifecycle machine (reference-only
  concept extraction; the existing implementation is not broken).
- Not touching `execution/`, `broker/`, `quote/`, or any Codex-owned file.
- Not writing the full joint `THETA_ORCHESTRATION_ARCHITECTURE.md` --
  that requires Codex's sections, which are not mine to fabricate.
