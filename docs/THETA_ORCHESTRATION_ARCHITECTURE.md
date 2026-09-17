# THETA orchestration architecture

Status: canonical Production architecture as of 2026-09-18.

## One economic authority

THETA has one final economic decision path. Providers, strategy branches, management policies, research models, and execution adapters contribute typed evidence. They do not submit orders or independently select a competing action.

The canonical new-risk path is:

```text
Alpaca broker state + normalized point-in-time market evidence
  -> reconcile current account, orders, fills, positions, and lifecycle facts
  -> canonical five-branch strategy frontier
  -> one selected action, candidate, quantity, and AEGIS result
  -> immutable decision and lineage
  -> ApprovedMasterPaperActionPlan
  -> durable PostgreSQL claim
  -> current exact-contract quote qualification
  -> adaptive limit price
  -> MasterPaperExecutionOrchestrator
  -> PaperOrderCoordinator
  -> Alpaca Paper broker evidence
  -> reconciliation, lifecycle classification, and atomic economic writer
```

The canonical management path is:

```text
broker-confirmed open exposure
  -> immutable ManagementInputState
  -> complete state-appropriate action frontier
  -> one policy-evidence provider
  -> structural and policy-evidence validation
  -> persisted management frontier and selected action
  -> explicit management order legs
  -> the same durable action-plan and execution boundary
```

`src/research/production-shadow-runtime.ts` owns point-in-time candidate enumeration and calls the canonical strategy-frontier contract. `src/theta/decision-assembly.ts` combines validated candidate, AEGIS, sizing, and execution-quality results into one decision receipt. `src/execution/master-paper-plan-assembly.ts` translates an already selected decision into a bounded Paper evidence plan and explicitly does not decide what to trade.

`src/execution/master-paper-action-handoff.ts` validates the immutable plan and current quote. `src/execution/master-paper-execution-orchestrator.ts` reconciles unresolved prior submissions before mutation. `src/execution/paper-order-coordinator.ts` is the only broker order mutation owner. It persists intent before submission, uses deterministic client order IDs, and reconciles ambiguous submissions before any retry.

## Authority boundaries

| Component | May do | Must not do |
| --- | --- | --- |
| Alpaca adapter | Return Paper account, order, fill, position, activity, assignment, expiration, and quote evidence | Choose strategy, size, or management action |
| Optionomics adapter | Return typed options intelligence and provenance | Submit orders or silently become broker truth |
| Strategy branches | Produce branch-local candidates and evidence | Submit orders or bypass the common frontier |
| Canonical strategy frontier | Compare applicable branches and select one new-risk action or WAIT | Mutate broker state |
| Management policy provider | Supply versioned evidence for the common management frontier | Create a second order path or overwrite broker facts |
| AEGIS | Allow full, reduce, hold, or veto risk | Force quantity above zero |
| Plan assembler | Translate a selected action into a typed, capped plan | Re-rank candidates or invent missing evidence |
| Execution handoff | Validate plan, quote, expiry, and authorization | Change contract, strategy, or quantity |
| Paper order coordinator | Persist, submit, cancel, replace, and reconcile authorized Paper intents | Trade live, retry ambiguous orders blindly, or alter economics |
| Lifecycle and accounting writers | Apply broker-confirmed transitions and immutable economic events | Invent fills, assignments, expirations, or erase roll losses |

## Lifecycle and restart safety

`src/theta/runtime-state.ts` contains an explicit, tested Wheel lifecycle transition table. It covers CSP proposal and opening, close, expiration, roll, assignment, stock, recovery wait, covered calls, call-away, stock close, redeployment, and terminal closure. Invalid transitions throw.

`src/theta/order-intent-state.ts` and `src/theta/scheduler.ts` also use explicit transition tables. PostgreSQL stores the durable action plan, order intent, attempt, broker evidence, lifecycle lineage, and economic events. Worker leases and checkpoints prevent two active owners from dispatching the same work. Deterministic IDs and reconcile-before-retry handle restarts and ambiguous broker responses.

## Management provider policy

The runtime accepts one `ManagementPolicyEvidenceProvider` for an active cycle. The current first-canary provider is `src/theta/paper-bootstrap-management-policy.ts`. Its purpose is bounded lifecycle safety for initial Paper evidence. It does not claim empirical profitability.

`src/theta/promoted-management-policy-provider.ts` requires an explicit promotion artifact before an empirical provider can exist. Shadow policy evidence remains non-executable. When a reviewed empirical provider is ready, it replaces the bootstrap provider at the single interface. Both providers must never run as competing economic authorities in the same Production cycle.

The current Claude management branch cannot be merged wholesale. It predates canonical migrations 055 and 056 and would reverse newer quote and runtime-gate semantics. Its pure quantitative modules require independent semantic review and adaptation behind the existing provider interface. Until then, the tested bootstrap provider remains the only Production management provider.

## Data and durability

Aiven is the sole live transactional database. Alpaca Paper is current broker truth. Optionomics is options-intelligence evidence subject to capability, timestamp, and freshness qualification.

The Windows host maintains two ignored recovery artifacts:

- deterministic research exports under `research_exports` and `research_outputs`
- sanitized, hash-chained runtime receipts under `.theta-local-worker/receipts`

These artifacts improve recovery and auditability without forming a second live database. Local receipts contain no credentials, account identifiers, symbols, positions, or raw provider payloads. They never drive a trade and never override Aiven or Alpaca.

## Execution boundaries

- Master execution is Paper only.
- Live-money authorization is absent.
- Follower submission remains locked.
- Quantity zero and WAIT remain valid.
- Current price must satisfy the provider-neutral exact-contract quote contract before mutation.
- The Paper indicative semantic class must remain explicit and cannot be relabeled as OPRA.
- Existing risk is reconciled and managed before new risk is evaluated.
- A first canary must pass the machine-checkable readiness receipt and must arise from a naturally valid candidate.

## External orchestration references

External projects are references, not replacement runtimes:

- XState supports the value of explicit transition tables. THETA already has them, so adding XState would duplicate the current state-machine authority.
- Temporal demonstrates durable workflow history, retries, signals, and versioning. THETA currently implements the needed bounded workflow through PostgreSQL leases, checkpoints, immutable plans, and reconciliation. Temporal remains a future reference if one-host PostgreSQL orchestration becomes insufficient.
- Bitloops demonstrates domain boundaries and transactional outbox patterns. THETA's persisted intent-before-submit and reconciliation path already covers the critical broker mutation boundary. A second outbox is not justified without a measured gap.
- OpenTelemetry supports end-to-end correlation and span semantics. THETA already carries correlation IDs, but full trace propagation remains a useful observability improvement.
- Testcontainers can make PostgreSQL integration tests reproducible in CI and is the strongest near-term adoption candidate.
- fast-check can strengthen transition and idempotency property tests. It is useful when adopted narrowly around current canonical state machines.
- BullMQ would add Redis queue authority and duplicate the current PostgreSQL scheduler for the trading path. It is deferred for optional non-critical research work.
- Cockatiel supplies provider-read resilience patterns. Any adaptation is limited to safe reads. Broker mutations must retain explicit reconcile-before-retry semantics.

No external framework is allowed to create another decision brain, state machine, order lifecycle, or retry authority.
