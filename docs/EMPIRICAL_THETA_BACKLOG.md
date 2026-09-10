# THETA empirical program backlog

Status: SPECIFIED. No empirical run, paper order, or live order is authorized by this
backlog.

This is the next THETA stage after research durabilization:

`DATA -> REPLAY -> BASELINES -> MODEL TESTING -> WALK-FORWARD -> UNTOUCHED OOS -> PAPER EXECUTION -> RECONCILIATION`

## Data and provenance blockers

1. Historical underlying bars with point-in-time symbol, corporate-action and universe
   treatment.
2. Historical option-chain and contract metadata availability by decision timestamp.
3. Executable BBO/quote history, including feed identity, freshness and quote size.
4. Point-in-time Greeks and IV, including a documented derivation/source where raw
   values are unavailable.
5. Corporate-action, dividend, earnings and event histories with revision provenance.
6. Read-only Optionomics capability validation for documented operations, timestamps,
   null behavior, rate limits and historical coverage.
7. Read-only Alpaca entitlement/capability validation for account, contracts, market
   data feed identity, historical data and lifecycle/corporate-action truth.

## Replay and ledger prerequisites

- Persist every candidate, hard veto, rejection, WAIT, AEGIS state, sizing result,
  model/config version, cost assumption, fill assumption and management alternative.
- Reconstruct a decision only from information available at its timestamp.
- Carry the full lineage through CSP, close/expire/roll/assign, stock,
  recovery-wait, covered call, exit and call-away.
- Keep old realized roll losses immutable and report open assigned-stock MTM in
  WholeChainPnL.
- Resolve correction-audit items before the affected measure is used: corporate-action
  ambiguity label status, CapitalDays day convention, missing benchmark IDs, and
  AEGIS exit supremacy.

## Baselines before model promotion

Run and retain comparable results for:

- cash/WAIT;
- random eligible candidates;
- fixed delta;
- fixed DTE;
- mechanical premium harvesting;
- simple management;
- transparent THETA-Q baseline.

All variants must use the same point-in-time universe, costs, conservative fills and
full lifecycle accounting. A new feature is evaluated as baseline versus baseline plus
that feature, with other variables held constant.

## Empirical gates

Use purged walk-forward validation, preserve a final untouched OOS split, and never
tune against that split. Report after-cost EV, PF, Managed Episode WR, Whole-Chain WR,
average win/loss, payoff ratio, maximum/current drawdown, ES/CVaR, capital-days,
assignment frequency, recovery duration, unresolved inventory MTM, fill/slippage,
calibration, raw N and effective independent N.

The 70-80% range remains a research target for validated high-confidence cohorts. It
does not authorize parameter tuning toward a target win rate or a customer performance
claim.

## Paper execution gate

Only after the data, replay, baseline and OOS gates are met: use Alpaca PAPER mode for
reconciliation-safe execution, then validate orders, partial fills, assignment,
expiry, exercise, corporate actions, costs, inventory and provider drift. No live
trading or customer copy activation is in scope.
