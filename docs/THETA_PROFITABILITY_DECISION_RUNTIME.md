# THETA profitability decision runtime

## What THETA can and cannot know

THETA cannot know the next market outcome with full confidence. A production-quality
options trader also cannot. The defensible target is a repeatable process that compares
the complete distribution of feasible actions, controls losses and inventory, and learns
from untouched out-of-sample episodes. Until those estimates are calibrated,
`EV_MODEL_NOT_EMPIRICALLY_READY` remains binding and new-risk readiness stays blocked.

The 70 to 80 percent Managed Episode win-rate range is a research target for selected
high-confidence cohorts. It is not a system setting and is never used to tune parameters
until a backtest displays the desired number. Profit factor, after-cost EV, average
win/loss, drawdown, Expected Shortfall, capital-days, assignment behavior, recovery time,
calibration, and execution quality remain co-equal evidence.

## Opening a position

The open decision is an exhaustive search, not one delta target. THETA evaluates the
eligible underlying universe, feasible expirations, feasible strikes, and separately
validated strategy branches. Alpaca supplies contract and executable quote truth.
Optionomics supplies research context. Mechanical impossibilities are removed, while
soft evidence changes rank, uncertainty, size, and branch preference.

Hard blockers include invalid or stale broker truth, unsupported sessions, invalid
contracts, unknown multipliers, unusable quotes, zero quantity, inadequate collateral or
assignment capacity, hard AEGIS vetoes, lifecycle conflicts, and idempotency conflicts.

Soft evidence includes RSI, trend, momentum, IV, skew, term structure, flow, volume/open
interest, event context, ownership quality, and regime. A weak RSI or flow observation
does not independently prohibit a trade.

An open requires known positive after-cost economics from an empirically eligible model,
acceptable tail and capital-day economics, a fresh BBO, feasible limit-price protection,
and sizing that is the minimum of every real capacity. Quantity zero remains valid.

## Profit taking and loss handling

There is no single canonical take-profit percentage. Fixed 25, 50, and 75 percent exits
remain baseline hypotheses. Production management compares the state-appropriate action
frontier from one timestamped snapshot.

For a CSP, THETA compares HOLD, CLOSE_FULL, ROLL, LET_EXPIRE,
ACCEPT_ASSIGNMENT, and REDEPLOY. Assigned stock compares RECOVERY_WAIT,
SELL_STOCK, and SELL_CC. An open covered call compares HOLD_CC, CLOSE_CC,
ROLL_CC, and ALLOW_CALL_AWAY.

Each action must expose expected future value, known immediate economics, downside or
tail estimate, incremental capital-days, execution cost and risk, opportunity cost,
inventory consequences, uncertainty, blockers, and utility. Unknown values stay unknown.
Execution costs are subtracted once. A positive roll credit cannot erase the old leg's
realized loss or prove that rolling is superior.

This structure answers why a 20 percent gain can sometimes be worth closing and why a 60
percent gain can sometimes be held. The answer depends on residual reward, current tail
risk, events, assignment exposure, capital burden, executable closing cost, and genuine
redeployment alternatives. The same comparison handles losses. It does not blindly
close, roll, or accept assignment merely because the current mark is negative.

## Current production truth

Migration 017 adds immutable management input snapshots, action-frontier evidence, and
idempotent lifecycle applications. The runtime now assembles open-chain inputs from the
economic ledger, latest FusionSnapshot, account snapshot, broker reconciliation, broker
position marks, and option quote snapshots. Greeks, IV, event, dividend, concentration,
ownership, AEGIS, or execution fields that are not present in those sources remain
explicitly unknown.

Assignment, expiration, option close, roll, covered-call open, covered-call assignment,
and stock disposal are applied in a database transaction. The chain, old and new option
legs, stock lot, assignment or expiration fact, and lifecycle path either commit together
or roll back together. A hashed evidence key makes replay idempotent. Broker activity is
mandatory for assignment and expiration.

The production runtime still does not have calibrated continuation EV, assignment
probability, recovery duration, fill probability, or Expected Shortfall. It therefore
persists the full frontier but selects no claimed profit-maximizing action. Passive hold
or recovery wait is recorded as a system safety state while missing evidence is resolved.
This is intentionally conservative, but it is no longer unexplained or caused by a chain
of soft-indicator vetoes.

## How we learn whether the policy works

Every candidate and management alternative must be stored before the outcome is known.
Resolved whole-chain labels are joined later using point-in-time rules. Changes are tested
as paired baseline versus baseline-plus-feature ablations with the same observations.
Promotion requires sufficient independent out-of-sample chains and improvement across
economic and risk metrics. Research-only branches cannot become executable merely because
the conventional branch found no trade.
