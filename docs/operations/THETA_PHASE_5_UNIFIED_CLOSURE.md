# THETA Phase 5 Unified Closure Receipt

Receipt date: 2026-09-29

START_SHA = ef23e32d97db20b8955a486ad294855151b8d6b7

SOURCE_SHA = 07adb99458fba12a2fd363d926c1d58d03e8ab61

STATE = SOURCE_COMPLETE_RUNTIME_PENDING

This receipt covers deterministic risk, sizing and execution authority. It does
not claim current-worker real-market evidence, empirical policy optimality,
Paper-order permission or live-money authorization.

## Hard-rule authority

`thetaHardRule` defines exactly 11 hard-rule families and every registered
strategy package carries the same complete set:

1. `SUPPORTED_SESSION`
2. `STANDARD_CONTRACT`
3. `KNOWN_MULTIPLIER`
4. `FRESH_BROKER_STATE`
5. `FRESH_EXECUTABLE_BBO`
6. `COLLATERAL_CAPACITY`
7. `ASSIGNMENT_CAPACITY`
8. `PORTFOLIO_RISK_WITHIN_LIMITS`
9. `RECONCILED_LIFECYCLE`
10. `AEGIS_NOT_VETOED`
11. `VALID_NONZERO_QUANTITY`

The Phase-5 authority test verifies that list and all five canonical strategy
packages. Soft feature families remain evidence and ranking inputs. They do not
silently become hard gates. Missing research-only context cannot create a
Production veto.

## AEGIS authority and policy truth

`bots/theta/quant/models/aegis.py` remains the sole 12-family risk authority.
The TypeScript runtime bridge validates its contract before the canonical
frontier consumes the result. The families are `PER_TRADE`, `UNDERLYING`,
`SECTOR`, `CORRELATION`, `PORTFOLIO`, `INVENTORY`, `ASSIGNMENT`, `RECOVERY`,
`LIQUIDITY`, `EXECUTION`, `PROVIDER` and `SYSTEM`. The strictest applicable
family controls new risk. Risk-reducing actions retain exit supremacy.

Applicable UNKNOWN evidence remains restrictive. Current quote and per-trade
liquidity checks are always required. Historical IV and spread detector
cold-start can be not applicable only through the explicit versioned Paper
policy, never by converting UNKNOWN to false.

The consumed risk-policy registry records the current policy state:

| Policy | State | Truth |
| --- | --- | --- |
| IV shock | `PAPER_BOOTSTRAP_ACTIVE` | Versioned detector and maturity policy exist. Empirical optimality is unproven. |
| Spread widening | `PAPER_BOOTSTRAP_ACTIVE` | Versioned quote-ledger detector exists. Empirical optimality is unproven. |
| Correlation clustering | `PAPER_BOOTSTRAP_ACTIVE` | One centralized policy supplies lookback, overlap, freshness and held-symbol bounds. |
| Severe drawdown | `RESEARCH_CANDIDATE` | Empirical promotion is required. |
| Sector mapping | `MISSING` | No authoritative sector source has been selected. It remains typed missing evidence. |

The registry is included in the profitability-brain reality receipt, so these
states are visible to the operator instead of remaining an orphan declaration.

## Portfolio exposure and Greeks

Broker positions, buying power, collateral, assignment capacity, ticker
concentration, correlation exposure and capital-at-risk inputs have real typed
paths where the broker supplies the required facts. Correlation evidence now
persists the exact policy version used to derive it.

Alpaca position snapshots do not supply portfolio Greeks. Provider contract
Greeks can be retained as candidate evidence when present, but they do not
prove aggregate position delta, gamma, theta or vega. Portfolio Greeks remain
`PROVIDER_LIMITED` or `FUTURE_DATA_REQUIRED`; no zero or false fallback is used.
The missing authoritative sector map remains visible for the same reason.

## Sizing authority

`structuralSizing()` in `canonical-strategy-frontier.ts` is the system-wide
final sizing authority. It takes the minimum of known broker, collateral,
assignment, concentration, AEGIS and strategy capacities and records the
binding constraint. Zero is valid and remains explained. No path applies
`max(1, qty)`.

The Python Q sizing output is a subordinate branch calculator. It can cap the
canonical result through the Q decision receipt but cannot override the final
frontier. Missing sizing policy is distinguished from malformed policy.
Malformed caps now return `SIZING_POLICY_INVALID`. An out-of-range reduced-risk
multiplier is rejected instead of silently clamped, and invalid sizing policy
prevents an earned `GLOBAL_WAIT` receipt.

## Execution state machine

`PaperOrderCoordinator` remains the only master broker-mutation state machine
and the only source file that calls broker `submitOrder`, `cancelOrder` or
`replaceOrder`. Tests cover durable intent, deterministic client-order IDs,
unknown-submit reconciliation, partial fills, cancel/replace, restart recovery,
lost-commit reconciliation, exact quote provenance, TCA and execution locks.

Those tests prove deterministic failure handling and idempotency. They do not
authorize a broker mutation. Master Paper execution, followers, new orders and
live money remain locked.

## False-paralysis and strictness

The canonical WAIT receipt retains exact blockers, soft evidence, blocked
branches, near misses and unclassified reasons. Invalid sizing configuration
cannot masquerade as a valid economic or risk WAIT. Existing strictness,
threshold-ablation and WAIT-regret research can measure false rejection once
future outcomes exist. Current false-reject and false-accept rates remain
empirically unavailable and are not invented.

## Validation

FOCUSED_PHASE_5_NODE_TESTS = PASS, 132 passed

FOCUSED_PHASE_5_PYTHON_TESTS = PASS, 50 passed

NODE_SUITE = PASS, 3007 passed, 15 skipped, 0 failed, 3022 total

PYTHON_QUANT_SUITE = PASS, 1225 tests and 11 subtests

BROWSER_SUITE = PASS, 23 tests

TYPECHECK_LINT_BUILD = PASS

SECURITY_SCAN = PASS, 0 findings

GIT_STORAGE_POLICY = PASS

EXACT_SHA_CI = PASS, run 36552617374 at c9d61d5a3a803b1e7f0be8aa726fddf7cde2eed1

## Reality and remaining dependencies

SOURCE = COMPLETE for deterministic Phase-5 risk, sizing and execution scope

PRODUCER = REAL where broker/provider evidence exists, typed UNKNOWN otherwise

PERSISTENCE = risk policy version, correlation evidence, sizing waterfall and execution receipts wired

CONSUMER = canonical frontier and sole execution state machine wired

CURRENT_WORKER = unchanged locked Production release, this integration branch is not deployed

CURRENT_SESSION_REAL_DATA = FORWARD_DATA_REQUIRED

SECTOR_SOURCE = PROVIDER_LIMITED

PORTFOLIO_GREEKS = PROVIDER_LIMITED_OR_FUTURE_DATA_REQUIRED

RISK_POLICY_OPTIMALITY = EMPIRICALLY_UNPROVEN

PAPER_AND_BROKER_AUTHORITY = false

CODE_SOLVABLE_PHASE_5_BLOCKERS = 0 known after source validation

AVOIDABLE_UNKNOWN = 0 known in the deterministic Phase-5 scope

FALSE_VALUES = 0 known

UNWIRED_DETERMINISTIC_PHASE_5_PATHS = 0 known

ORDER_SUBMISSIONS = 0

BROKER_MUTATIONS = 0

FOLLOWER_SUBMISSIONS = 0

LIVE_AUTHORIZATION = NOT_GRANTED

FINAL_STATUS = SOURCE_COMPLETE_RUNTIME_PENDING
