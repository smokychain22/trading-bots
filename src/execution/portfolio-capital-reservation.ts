import {
  buildStrategyBudgetEnvelope, maximumQuantityWithinEnvelope, proposalCapitalPerContractCents,
  type AllocatorStrategy, type PortfolioBudgetPolicy, type PortfolioBudgetSnapshot,
} from '../theta/portfolio-budget.js';
import { unfilledTerminalBrokerOrderSql } from './paper-execution-authorization.js';

/**
 * ATOMIC CAPITAL RESERVATION (allocator ENFORCED mode only).
 *
 * No new table: the durable NEW_RISK plan row IS the reservation, and its lifecycle already follows broker truth (plan -> intent -> broker
 * order -> fill / terminal). Under one account-wide capital advisory lock, the reservation re-reads the capital the budget snapshot could
 * NOT have seen: (a) active NEW_RISK plans that have not reached the broker and (b) broker orders created after the snapshot was observed
 * (zero-fill terminal ones released). An ambiguous intent (submit outcome unknown) blocks: capital is never reused while a broker order might
 * exist. A proposal that no longer fits is PORTFOLIO_CAPACITY_CHANGED_REEVALUATE: the selected quantity is NEVER reduced under the same
 * decision; a new decision cycle runs against a fresh snapshot.
 */
export const portfolioCapitalReservationVersion = 'theta-portfolio-capital-reservation-v1' as const;

export interface CapitalProposal {
  readonly decisionId: string;
  readonly strategy: Extract<AllocatorStrategy, 'THETA_Q' | 'THETA_H' | 'THETA_D'>;
  readonly candidateId: string;
  readonly underlying: string;
  readonly quantity: number;
  readonly capitalPerContractCents: number;
}

export interface InFlightNewRiskCapital {
  readonly sourceId: string;
  readonly underlying: string;
  readonly capitalCents: number;
  /** CSP collateral that would become stock on assignment (0 for a defined-risk spread) */
  readonly assignmentCollateralCents: number;
}

export type CapitalReservationDecision =
  | { readonly state: 'RESERVED'; readonly snapshotId: string; readonly capitalCents: number; readonly inFlightCapitalCents: number; readonly version: typeof portfolioCapitalReservationVersion }
  | { readonly state: 'PORTFOLIO_CAPACITY_CHANGED_REEVALUATE'; readonly snapshotId: string; readonly bindingConstraint: string; readonly maximumQuantity: number;
    readonly proposalQuantity: number; readonly inFlightCapitalCents: number }
  | { readonly state: 'BUDGET_SNAPSHOT_STALE'; readonly snapshotId: string; readonly ageMilliseconds: number }
  | { readonly state: 'CAPITAL_RESERVATION_RECONCILING'; readonly ambiguousIntentIds: readonly string[] };

/** A derived view of the snapshot that includes capital it could not have seen. Same policy, same limits; never mutates the original. */
export function withInFlightCapital(snapshot: PortfolioBudgetSnapshot, inFlight: readonly InFlightNewRiskCapital[]): PortfolioBudgetSnapshot {
  if (inFlight.length === 0) return snapshot;
  const exposure: Record<string, number> = { ...snapshot.exposureByUnderlyingCents };
  let capital = 0, assignment = 0;
  for (const item of inFlight) {
    if (!Number.isSafeInteger(item.capitalCents) || item.capitalCents < 0) throw new Error('IN_FLIGHT_CAPITAL_INVALID');
    exposure[item.underlying] = (exposure[item.underlying] ?? 0) + item.capitalCents;
    capital += item.capitalCents;
    assignment += item.assignmentCollateralCents;
  }
  return { ...snapshot, snapshotId: `${snapshot.snapshotId}+inflight:${inFlight.length}`,
    pendingOpeningCapitalCents: snapshot.pendingOpeningCapitalCents + capital,
    pendingAssignmentCollateralCents: snapshot.pendingAssignmentCollateralCents + assignment,
    remainingNewRiskCapitalCents: Math.max(0, snapshot.remainingNewRiskCapitalCents - capital),
    remainingPortfolioRiskCapacityCents: Math.max(0, snapshot.remainingPortfolioRiskCapacityCents - capital),
    brokerBuyingPowerCents: Math.max(0, snapshot.brokerBuyingPowerCents - capital),
    exposureByUnderlyingCents: exposure,
    riskyUnderlyings: [...new Set([...snapshot.riskyUnderlyings, ...inFlight.map((item) => item.underlying)])].sort() };
}

/** Pure reservation decision: fits exactly as proposed, or REEVALUATE. Never a smaller quantity. */
export function decideCapitalReservation(input: {
  readonly snapshot: PortfolioBudgetSnapshot; readonly policy: PortfolioBudgetPolicy; readonly proposal: CapitalProposal;
  readonly inFlight: readonly InFlightNewRiskCapital[]; readonly ambiguousIntentIds: readonly string[];
  readonly now: string; readonly maximumSnapshotAgeMilliseconds: number;
}): CapitalReservationDecision {
  if (input.ambiguousIntentIds.length > 0) return { state: 'CAPITAL_RESERVATION_RECONCILING', ambiguousIntentIds: [...input.ambiguousIntentIds] };
  const age = Date.parse(input.now) - Date.parse(input.snapshot.observedAt);
  if (!Number.isFinite(age) || age < 0 || age > input.maximumSnapshotAgeMilliseconds) {
    return { state: 'BUDGET_SNAPSHOT_STALE', snapshotId: input.snapshot.snapshotId, ageMilliseconds: Number.isFinite(age) ? age : -1 };
  }
  if (!Number.isInteger(input.proposal.quantity) || input.proposal.quantity <= 0) throw new Error('CAPITAL_PROPOSAL_QUANTITY_INVALID');
  const current = withInFlightCapital(input.snapshot, input.inFlight);
  const inFlightCapitalCents = input.inFlight.reduce((sum, item) => sum + item.capitalCents, 0);
  const envelope = buildStrategyBudgetEnvelope(current, { strategy: input.proposal.strategy, underlying: input.proposal.underlying, policy: input.policy,
    expiresAt: input.now });
  const feasibility = maximumQuantityWithinEnvelope(envelope, { capitalPerContractCents: input.proposal.capitalPerContractCents,
    brokerAllowedQuantity: input.proposal.quantity });
  if (feasibility.maximumQuantity < input.proposal.quantity) {
    return { state: 'PORTFOLIO_CAPACITY_CHANGED_REEVALUATE', snapshotId: input.snapshot.snapshotId, bindingConstraint: feasibility.bindingConstraint,
      maximumQuantity: feasibility.maximumQuantity, proposalQuantity: input.proposal.quantity, inFlightCapitalCents };
  }
  return { state: 'RESERVED', snapshotId: input.snapshot.snapshotId, capitalCents: input.proposal.quantity * input.proposal.capitalPerContractCents,
    inFlightCapitalCents, version: portfolioCapitalReservationVersion };
}

const OCC_STRIKE = /^[A-Z.]{1,6}\d{6}[PC](\d{8})$/;

/** Capital an already-persisted NEW_RISK plan holds, from its own durable payload (strategy semantics: CSP collateral or D max loss). */
export function inFlightCapitalFromPlan(sourceId: string, plan: Record<string, unknown>): InFlightNewRiskCapital {
  const quantity = Number(plan.quantity), multiplier = Number(plan.multiplier), underlying = String(plan.underlying ?? '');
  if (!Number.isInteger(quantity) || quantity < 0 || underlying === '') throw new Error('IN_FLIGHT_PLAN_PAYLOAD_INVALID');
  if (plan.action === 'OPEN_DEFINED_RISK') {
    const risk = plan.definedRisk as { structuralNetCreditPerShare?: unknown; legs?: Array<{ strike?: unknown; positionIntent?: unknown; multiplier?: unknown }> } | undefined;
    const shortLeg = risk?.legs?.find((leg) => leg.positionIntent === 'sell_to_open');
    const longLeg = risk?.legs?.find((leg) => leg.positionIntent === 'buy_to_open');
    const perContract = proposalCapitalPerContractCents({ strategy: 'THETA_D', shortStrike: Number(shortLeg?.strike), longStrike: Number(longLeg?.strike),
      netCreditPerShare: Number(risk?.structuralNetCreditPerShare), multiplier: Number(shortLeg?.multiplier ?? multiplier) });
    return { sourceId, underlying, capitalCents: perContract * quantity, assignmentCollateralCents: 0 };
  }
  const strike = OCC_STRIKE.exec(String(plan.symbol ?? ''));
  if (plan.action !== 'OPEN_CSP' || strike === null) throw new Error('IN_FLIGHT_PLAN_NOT_A_NEW_RISK_OPEN');
  const perContract = proposalCapitalPerContractCents({ strategy: 'THETA_Q', strike: Number(strike[1]) / 1000, multiplier });
  return { sourceId, underlying, capitalCents: perContract * quantity, assignmentCollateralCents: perContract * quantity };
}

type Queryable = { query: (text: string, values?: unknown[]) => Promise<{ rows: unknown[] }> };

/**
 * Runs INSIDE the caller's transaction (the one that will insert the plan row), so the reservation and the plan commit together or not at
 * all. The account-wide capital lock serialises concurrent decisions: the second waits, then sees the first plan as in-flight capital.
 */
export async function reservePortfolioCapitalInTransaction(client: Queryable, input: {
  readonly executionAccountId: string; readonly snapshot: PortfolioBudgetSnapshot; readonly policy: PortfolioBudgetPolicy;
  readonly proposal: CapitalProposal; readonly now: string; readonly maximumSnapshotAgeMilliseconds: number;
}): Promise<CapitalReservationDecision> {
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`capital:${input.executionAccountId}`]);
  const ambiguous = await client.query(`SELECT oi.order_intent_id::text AS id FROM trade.order_intent oi
    WHERE oi.execution_account_id=$1 AND oi.status::text IN ('SUBMITTING','UNKNOWN_SUBMISSION','RECONCILING') LIMIT 10`, [input.executionAccountId]);
  const plans = await client.query(`SELECT p.action_plan_id::text AS id, p.plan_json FROM trade.master_paper_action_plan p
    WHERE p.execution_account_id=$1 AND p.authority_kind='NEW_RISK' AND p.decision_id<>$2::uuid
      AND p.plan_json->>'action' IN ('OPEN_CSP','OPEN_DEFINED_RISK')
      AND (
        -- (a) committed to a plan but not yet visible at the broker
        (p.status IN ('READY','CLAIMED','WAITING_GATE') AND (p.plan_json->>'decisionExpiresAt')::timestamptz > $3::timestamptz
          AND NOT EXISTS(SELECT 1 FROM trade.broker_order b0 WHERE b0.order_intent_id=p.execution_order_intent_id))
        -- (b) reached the broker after the snapshot was observed (the snapshot can not contain it), unless it ended with zero fills
        OR EXISTS(SELECT 1 FROM trade.broker_order bo WHERE bo.order_intent_id=p.execution_order_intent_id
          AND bo.created_at > $4::timestamptz AND NOT ${unfilledTerminalBrokerOrderSql('bo')}))`,
  [input.executionAccountId, input.proposal.decisionId, input.now, input.snapshot.observedAt]);
  const inFlight = (plans.rows as Array<{ id: string; plan_json: Record<string, unknown> }>).map((row) => inFlightCapitalFromPlan(row.id, row.plan_json));
  return decideCapitalReservation({ snapshot: input.snapshot, policy: input.policy, proposal: input.proposal, inFlight,
    ambiguousIntentIds: (ambiguous.rows as Array<{ id: string }>).map((row) => row.id), now: input.now,
    maximumSnapshotAgeMilliseconds: input.maximumSnapshotAgeMilliseconds });
}
