# THETA P2D real label accumulation

P2D turns the P2B decision frontier and P2C outcome contracts into immutable research subjects. It does not promote a policy or authorize execution.

## Online path

The reconciliation job invokes `PostgresOutcomeResolver`. Each pass:

1. Materializes eligible whole-chain, strategy, action-regret, contract-regret, strategy-regret, WAIT, management, and contract subjects.
2. Captures broker, quote, management, and closed-chain observations that were available only after the decision timestamp.
3. Resolves horizons with explicit provenance and completeness states.
4. Creates a policy-learning row only for a causal resolved label.

All insert identities are deterministic or content-addressed. Replaying the same source evidence is a no-op. Unresolved receipts are unique per subject, state, and execution-model version, so a restart cannot create an unbounded receipt stream. A later resolved state remains possible when defensible evidence arrives.

## Feature and label firewall

Point-in-time context is frozen in `research.theta_outcome_subject`. Future observations and labels live in separate immutable tables. Dataset schema `theta-r6-dataset-v6` exports both sides separately and rejects:

- future outcome fields inside feature payloads
- a label timestamp at or before its decision timestamp
- missing subject or label references
- any subject, label, or policy-learning row with execution authority

The export includes strategy, risk, feature, cost, regime, and execution-model lineage. Ordering is deterministic and the dataset hash excludes the export timestamp.

## Economic truth

Whole-chain labels require a closed chain, resolved option legs and stock lots, known execution fees, and at least one economic fact. Net P&L is:

`option realized P&L + stock realized P&L + dividends - fees`

Roll legs remain distinct ledger facts. A loss on the old leg cannot be offset by rewriting its realized value. Transaction-cost analysis keeps entry, exit, roll-close, and roll-open legs separate and retains partial-fill and cancel/replace evidence.

## WAIT and regret

WAIT subjects bind to immutable global WAIT evidence. `FALSE_REJECT` requires a point-in-time feasible, research-executable alternative with adequate risk, liquidity, event, portfolio, and blocker evidence, plus material after-cost dominance. Missing evidence cannot produce `FALSE_REJECT`.

Regret subjects are created only when the frozen decision set contains at least two point-in-time feasible alternatives. Counterfactual outcomes remain unavailable until the execution and outcome model can defend them.

## Profit philosophy

Returns and win rates are cohorts for analysis, not targets or gates. P2D preserves small through very large return cohorts and 40 percent through 80 percent-plus win-rate cohorts without turning them into fixed take-profit or entry rules. Dynamic profit preservation, whole-chain economics, drawdown, Expected Shortfall, execution cost, and capital-days remain separate evidence families.

`TRAINING_READY` stays `NO` until complete resolved labels and sufficient independent samples exist. No dataset or challenger evaluation can activate a broker order.
