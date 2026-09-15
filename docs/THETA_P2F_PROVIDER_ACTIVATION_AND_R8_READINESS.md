# THETA P2F provider activation and R8 readiness

P2F completes the buildable provider and operator-safety architecture without authorizing an order. Alpaca remains broker truth. Optionomics remains independently qualified options intelligence. A provider credential, successful authentication, or documented capability cannot authorize execution.

## Provider architecture

`OptionomicsProviderConfig` supplies credentials to the server-only bounded HTTP transport. The transport enforces cancellation, JSON content type, bounded 429 and 5xx retry, `Retry-After`, correlation IDs, response request IDs, latency, rate-limit metadata, and redacted payload retention. It never returns credentials.

The executable `npm run optionomics:qualify -- --mode=SYNTHETIC|REPLAY|REAL_AUTHENTICATED` emits a sanitized, deterministic receipt. Capability families have independent `QUALIFIED`, `PARTIAL`, `BLOCKED`, `UNSUPPORTED`, `INVALID`, or `UNKNOWN` states. Endpoint slots whose public route is not verified remain `ENDPOINT_UNVERIFIED`. Real payload evidence is required for qualification.

Optionomics chain observations keep `SESSION_RECORDED_RESEARCH` semantics. They cannot clear the execution gate. Real authentication, schema, freshness, unit, and sign-convention status remain separate facts.

## Execution quote authority

The provider-neutral quote contract distinguishes consolidated NBBO, trusted two-sided order pricing, indicative, session-recorded research, and unknown evidence. Exact contract identity, positive uncrossed BBO, timestamp order, freshness, session, connection, subscription, entitlement, and provenance all fail closed. Multi-source aggregation accepts only individually qualified quotes for the same exact contract and identical trusted semantics. It never labels an aggregate NBBO without that provenance.

`EXTERNAL_QUOTE_BLOCKER` remains active until one source passes the full qualification contract.

## Operator safety

Operator state now has a monotonic `state_version`. Commands include the observed version and stale commands return a conflict. Idempotent replays return the original result. Concurrent commands serialize through a PostgreSQL advisory transaction lock.

The emergency lock cannot be cleared by ordinary resume. `CLEAR_EMERGENCY_LOCK` requires a fresh version and a reason, clears only the lock, and leaves new entries paused and broker submission blocked. Reconciliation and mandatory management remain enabled.

## Evidence quality

Management cycles remain immutable raw snapshots. Path rows now distinguish `RAW_CYCLE_SNAPSHOT` from `SEMANTIC_PATH_CHECKPOINT`. Initial observations, classification changes, new peaks, new troughs, DTE changes, and event-state changes are semantic checkpoints. The policy is versioned in code and avoids a second path architecture.

The naive positive outcome among rejected candidates is named `REJECTED_CANDIDATE_POSITIVE_OUTCOME_RATE`. It is not the formal risk-adjusted false-reject metric.

## Explainability and alerts

The deterministic explanation assembler exposes selected action, feasible and infeasible alternatives, reason codes, required and optional missing fields, session and time state, position path, strategy applicability, provider evidence, action and inaction risk, quote authority, and policy state. WAIT and HOLD have distinct classifications.

Immutable alerts support worker, broker, provider, quote, decision, expiry, assignment, call-away, unexpected position, paralysis, overtrading, emergency lock, execution-gate, and strategy-version events. Repeated active evidence increments occurrence state before a new immutable event is persisted. No notification channel or trading action is implied.

## Strategy versions and phase gates

The persisted strategy registry rejects the same semantic version with a changed configuration hash. A new semantic version can register and the old row remains unchanged. Operator status exposes provider qualification and active alert state. The R8 receipt separates engineering entry, Paper activation, and empirical evidence.

R8 Paper activation requires both first-order readiness and a qualified execution quote. It cannot be forced by a provider-auth result. P2F submits zero orders.

## Migration and verification

Migration `048_p2f_provider_activation_readiness` adds immutable Optionomics and quote qualification receipts, operator state versions, semantic path classification, and immutable alert events. CI uses synthetic or replay provider evidence. Real provider tests are optional and never required for the normal test suite.

External blockers remain provider authentication/entitlement and trusted execution-quote qualification. Empirical blockers remain resolved independent outcomes, calibration, walk-forward/OOS evidence, and a promoted management policy. Live money and follower submission remain disabled.
