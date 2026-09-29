# THETA Phase 4 Unified Closure Receipt

Receipt date: 2026-09-29

START_SHA = a7ad45c97b87eec0f61e0f2b20e5047a89f50c58

SOURCE_SHA = 0ace712abe2e64fcd4e26751dc247dfc044e5319

STATE = SOURCE_COMPLETE_EMPIRICAL_PENDING

This receipt covers deterministic strategy mechanics, economics, management,
whole-chain accounting and replay. It does not claim current-worker real-market
evidence, calibrated probabilities, profitability, Paper authority or broker
authorization.

## Five-strategy evidence

| Strategy | Construction and economics | Integration, persistence and replay | Honest remaining limit |
| --- | --- | --- | --- |
| Q, THETA_CONVENTIONAL | Exact normalized put identity, executable BBO, DTE, delta lattice, premium, collateral, assignment capacity, break-even, contractual maximum gain/loss, downside cushion, capital-days and versioned modeled opening costs. | Canonical frontier, position scaling, Postgres candidate projection and T0 replay use the same typed cost policy. | Expected after-cost EV, win probability and optimal strike/DTE remain empirically unproven. |
| H, THETA_HOLD_STRIKE | The 2-5 DTE candidate retains gamma, theta, assignment consequence, strike distance, pin distance, adverse-gap, event, liquidity and modeled-cost evidence. | The canonical frontier and T0 carry this evidence. The branch stays visible to research persistence and replay. | `RESEARCH_ONLY`, with no broker authority or empirical promotion. |
| D, THETA_DEFINED_RISK | Both exact legs, expiry, multiplier, net credit, width, maximum gain/loss, break-even, two-leg fees/slippage, capital-day efficiency, per-leg BBO state, synchronization limitation and pin distances are represented. Impossible credit at or above width fails structurally. | Multi-leg identity survives the canonical frontier, locked plan, position economics, persistence and replay. | Simultaneous fill risk is explicitly uncalibrated. The mutation adapter remains absent by design and the branch is `RESEARCH_ONLY`. |
| A, THETA_RECOVERY | Broker-confirmed stock is required. Recovery wait, stock sale and covered-call alternatives preserve stock basis, whole-chain basis, realized option PnL, unrealized stock PnL and capital lock-up. | Existing lifecycle, management frontier, candidate source, plan compiler, ledger and replay tests cover the route. | Current flat broker inventory makes live applicability `INAPPLICABLE`. Recovery probability and time remain empirically unproven. |
| C, THETA_CC | Broker-confirmed covered shares are required. Sell, hold, close, roll and call-away actions preserve premium, strike, expiry, upside cap, basis, proceeds, event state and roll economics. | Existing covered-call lattice, management frontier, plan compiler, lifecycle ledger and replay tests cover the route. | Current flat broker inventory makes live applicability `INAPPLICABLE`. Continuation value remains empirically unproven. |

WAIT remains a first-class competitor. No Phase 4 function forces quantity one,
converts a missing cost to zero, converts assignment into profit, or grants H/D
broker authority.

## Entry costs and expected value

`CanonicalOpeningCostPolicy` is an explicit, versioned input with commission,
fees and estimated adverse slippage per option leg. Q, H and C use one opening
option leg. D uses two. Position economics scale all known dollar values by
quantity, while per-share break-even and dimensionless rates remain unscaled.

Modeled costs are `DERIVED_DETERMINISTIC`. They are not `BROKER_ACTUAL` fills or
fees. Missing policy produces `UNKNOWN`, never zero. The persisted Q projection
retains known modeled inputs and retains `ev_net=null` with
`EV_MODEL_NOT_EMPIRICALLY_READY`.

The canonical expected-after-cost EV remains null for every strategy. Delta is
never substituted for probability. There is no fabricated POP, recovery
probability, assignment probability, fill probability or confidence.

## Management and whole-chain accounting

The management system compares applicable HOLD, CLOSE, ROLL, LET_EXPIRE,
ACCEPT_ASSIGNMENT, RECOVERY_WAIT, SELL_STOCK, SELL_CC, HOLD_CC, CLOSE_CC,
ROLL_CC and ALLOW_CALL_AWAY alternatives. Passive actions remain valid when an
active alternative lacks evidence. Entering new risk through a roll still
requires its separate risk and economic gates.

Whole-chain accounting keeps realized option PnL, unrealized stock PnL,
premium, basis, dividends, fees, slippage, capital and capital-days separate.
Unknown fees or dividends keep the aggregate unknown. A roll is close-old plus
open-new, and its new credit cannot erase an old realized loss. Assignment is
inventory and cash-flow evidence, never an automatic win.

## Profit-taking challengers

All 17 canonical challengers execute in deterministic replay:

`FIXED_05`, `FIXED_10`, `FIXED_15`, `FIXED_20`, `FIXED_25`, `FIXED_30`,
`FIXED_40`, `FIXED_50`, `FIXED_60`, `FIXED_75`, `FIXED_90`, `TIME_EXIT`,
`DTE_EXIT`, `DYNAMIC_REMAINING_EV`, `DYNAMIC_EV_PLUS_HARD_RISK`,
`DYNAMIC_EV_PLUS_EVENT` and `DYNAMIC_EV_PLUS_CAPITAL_EFFICIENCY`.

Fixed thresholds are benchmark challengers, not privileged Production policy.
Dynamic policies return `UNRESOLVED` when PIT-valid forecasts, tail risk, event
evidence or redeployment value are missing. Replay uses an observed executable
close ask plus explicit modeled fees and adverse slippage, and reports
`actualFill=false`.

## Property and adversarial evidence

Executed tests prove:

- higher fees and slippage cannot improve cost-adjusted economics
- higher collateral cannot improve capital-day efficiency with unchanged net premium
- unknown multiplier blocks executable economics
- negative or fractional quantity is invalid, while zero quantity is valid
- quantity scaling is linear for Q, H and D
- a spread credit at or above width is rejected
- both defined-risk legs and their quote states remain distinct
- covered calls cannot claim unowned shares
- recovery cannot claim nonexistent inventory
- unknown whole-chain legs never become zero
- roll losses survive later credits
- T0 rejects unknown cost-policy keys, invalid values and tampering
- candidate persistence keeps known modeled costs while empirical EV remains null

## Validation

FOCUSED_PHASE_4_TESTS = PASS, 102 passed, 1 PostgreSQL integration test skipped

NODE_SUITE = PASS, 3001 passed, 15 skipped, 0 failed

PYTHON_QUANT_SUITE = PASS, 1222 tests

BROWSER_SUITE = PASS, 23 tests

TYPECHECK_LINT_BUILD = PASS

SECURITY_SCAN = PASS, 0 findings

GIT_STORAGE_POLICY = PASS

EXACT_SHA_CI = PENDING_FOR_RECEIPT_COMMIT

## Reality and remaining dependencies

SOURCE = COMPLETE for the deterministic Phase 4 scope

PRODUCER = REAL broker/provider inputs where available, explicit UNKNOWN otherwise

PERSISTENCE = canonical frontier, candidate projection, lifecycle ledger and T0 paths wired

CONSUMER = canonical selection and management authorities wired

REPLAY = deterministic and provider-free for the canonical frontier, plus offline management challengers

CURRENT_WORKER = unchanged locked Production release, this integration branch is not deployed

CURRENT_SESSION_REAL_DATA = FORWARD_DATA_REQUIRED

EMPIRICAL_EV_POP_CONTINUATION = EMPIRICALLY_UNPROVEN

PAPER_AND_BROKER_AUTHORITY = false

CODE_SOLVABLE_PHASE_4_BLOCKERS = 0 known after source validation

AVOIDABLE_UNKNOWN = 0 known in the deterministic Phase 4 scope

FALSE_VALUES = 0 known

UNWIRED_DETERMINISTIC_PHASE_4_PATHS = 0 known

ORDER_SUBMISSIONS = 0

BROKER_MUTATIONS = 0

FOLLOWER_SUBMISSIONS = 0

LIVE_AUTHORIZATION = NOT_GRANTED

FINAL_STATUS = SOURCE_COMPLETE_EMPIRICAL_PENDING
