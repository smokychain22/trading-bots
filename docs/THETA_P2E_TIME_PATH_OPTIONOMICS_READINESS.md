# THETA P2E time, path, and Optionomics readiness

## Scope

P2E adds point-in-time evidence needed to learn when action or inaction was economically justified. It does not add an executable policy. The Production policy boundary, AEGIS, Paper-only host check, order intent persistence, fresh quote gate, idempotency, and broker reconciliation remain independent controls.

## Time-aware state

`time-aware-state.ts` derives descriptive session context from Alpaca clock and calendar facts. It supports closed, premarket, opening, regular, mid, late, closing, post-close, weekend, early-close, expiration-day, expiration-final-window, and event-window labels. New York exchange-local dates use `Intl` time-zone conversion, which handles DST. Clock and calendar disagreement produces degraded evidence. Missing calendar or clock facts stay explicit.

Option time is a separate object with DTE, descriptive DTE cohort, expiration-day state, time to close, and near-expiry context. These labels do not select a trade.

Decision freshness has three states: `FRESH`, `INVALIDATED`, and `UNKNOWN`. Invalid timestamps, expiry, changed facts, and missing required facts cannot be converted into a fresh decision.

## Position path

Every new management input can create one immutable, content-addressed path checkpoint. It records current and historical whole-chain P&L, peaks, troughs, giveback, drawdown from peak, causal velocities, DTE, capital-days observed, mark quality, spot, strike, breakeven, BBO, Greeks, IV, event, recovery, and regime context. Missing values remain null.

Path classifications are descriptive research labels. They include winner-to-loser, winner giveback, accelerating loss, late-expiry loss, recovery improvement or deterioration, and unknown. A stale broker mark produces `UNKNOWN` rather than a management order.

## Action versus inaction

The action frontier compares WAIT, HOLD, close, roll, expiry, assignment, redeployment, recovery, stock, covered-call, and call-away alternatives across separate dimensions. The comparator uses partial Pareto dominance only when at least two dimensions are jointly known. It does not collapse uncertain economics into a universal score.

HOLD now has an explicit evidence state. Unknown empirical continuation value produces `HOLD_UNKNOWN`. WAIT, HOLD, action, opportunity capture, false reject, correct reject, and unresolved rates can be computed from resolved cohorts without turning any single episode into a win-rate claim.

## Strategy timing router

The research router evaluates Conventional, Hold Strike, Recovery, Covered Call, Defined Risk, and WAIT on every timing snapshot. Outputs are `APPLICABLE`, `NOT_APPLICABLE`, or `UNKNOWN`, with quality and blockers. 0DTE is marked specialist research only. Timing evidence cannot authorize execution.

## Optionomics provider-ready boundary

The capability contract enumerates documented families without guessing routes. It supports authentication states, entitlement states, schema keys, units, provider timestamps, nullable fields, rate limits, historical scope, runtime or research destination, redacted raw payload identity, normalized nullable facts, and explicit provenance.

An empty capability array is never healthy. Chain intelligence can become ready from observed authenticated evidence. Execution quote status remains `NOT_QUALIFIED` until the existing qualification harness proves exact contract identity, fresh provider timestamp, two-sided bid and ask, size semantics where required, and acceptable provenance. Optionomics intelligence readiness and execution quote readiness remain separate.

## Operator controls

The owner-only API supports viewing control state and three audited commands: pause new entries, resume new entries, and emergency execution lock. A mutation requires the signed operator session, same-origin request, explicit confirmation, and an idempotency key. The event is immutable and stores only an actor hash. None of these commands can enable execution, promote a policy, authorize live money, or bypass environment locks.

Pause blocks new risk and leaves reconciliation and management enabled. Emergency lock blocks broker submission and also keeps read and reconciliation work active. Resume cannot clear an environment-level pause or the external quote blocker.

## Dataset and empirical boundary

The deterministic export is version 6. It adds position-path checkpoints, action/inaction frontiers, and strategy-timing snapshots. The feature-label firewall remains active. Return cohorts now carry a definition version. Win-rate cohort is reserved for aggregate analysis and remains null on an individual policy-learning row.

Submitted-limit slippage and total cancel/replace count are now explicit TCA outputs. Missing fills, fees, limits, or attempts remain null.

## Acceptance state

- Time-state contract: implemented and unit tested.
- Position-path contract: implemented and unit tested.
- Action/inaction frontier: implemented and unit tested.
- Timing router: implemented and unit tested.
- Optionomics provider-ready contract: implemented and unit tested.
- Runtime persistence: connected to the management-first cycle.
- Migration: 047 prepared, Production application pending.
- Dataset: v6 implemented and deterministic.
- Policy promotion: unavailable.
- Execution quote: blocked.
- Paper orders: not authorized by P2E.
- Live orders: forbidden.
