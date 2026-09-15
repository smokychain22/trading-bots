# THETA P2C Resolved Outcome Engine

## Boundary

P2C adds immutable outcome-side evidence. It does not modify point-in-time feature snapshots, promote a policy, qualify an execution quote, or authorize an order.

```text
immutable decision feature snapshot
  -> immutable outcome subject
  -> immutable future observation
  -> immutable resolution receipt
  -> immutable resolved label
```

The feature-side P2B placeholder remains `BLOCKED_ON_FUTURE_OUTCOME`. Resolution writes only to the P2C tables introduced by migration 044.

## Provenance and causality

Every resolution distinguishes `BROKER_ACTUAL`, `MARKET_OBSERVED`, `REPLAY_OBSERVED`, `MODELED_RESEARCH`, `UNRESOLVED`, and `INVALID`. Market midpoint is a mark, not an executable fill. Modeled fills carry an explicit version and cannot claim broker provenance.

- Every horizon closes after its decision timestamp.
- Every future observation is later than the decision and no later than the subject horizon.
- Every resolved label becomes available after the decision.
- Exact OCC identity is required for option-contract subjects.
- Original feature hashes and candidate-universe hashes remain on the outcome subject.
- Duplicate materialization and duplicate resolution are content-addressed no-ops.
- Every outcome artifact has `execution_authorized=false`.

## Resolution scope

The pure resolver supports selected contracts, neighboring strikes, alternate expirations, alternate structures, WAIT, management actions, management alternatives, strategy outcomes, whole chains, and regret labels. The online PostgreSQL resolver materializes P2B contract subjects and management-frontier actions, imports already persisted future quote and management observations, and resolves only closed horizons with sufficient data.

Whole-chain actual economics remain grounded in the canonical economic ledger. Option legs, stock lots, dividends, fees, assignments, rolls, covered calls, and terminal chain state are not flattened into option-leg win rate.

## Research horizons

The first versioned horizon policy contains next decision cycle, one day, three days, five days, and exact expiration when an exact contract expiration exists. These are research observation horizons, not trading thresholds.

## WAIT and challenger evaluation

WAIT is evaluated only after its window closes and a complete, risk-aware alternative set exists. A missed profitable option alone does not make WAIT wrong. Policy challengers report `EVALUABLE`, `NOT_EVALUABLE`, or `INSUFFICIENT_SAMPLE`, raw N, and clustered effective N. They cannot self-promote or authorize execution.

## Dataset and current evidence

`theta-r6-dataset-v4` adds outcome subjects, observations, resolution receipts, and resolved labels. Feature rows remain separately validated by the future-label firewall. The Python intake rejects non-causal labels, missing subject lineage, execution authority, and broker-provenance mismatches.

Engineering readiness does not imply evidence sufficiency. Until enough closed horizons and economic episodes exist, resolved whole-chain, management, WAIT, and counterfactual samples remain insufficient. The Production management policy provider remains unavailable. A 70 to 80 percent win rate remains an unproven research target. A 40 percent or greater return remains an aspiration, not a take-profit rule.
