import { createHash } from 'node:crypto';
import type { DerivedAccountExposure } from './account-exposure.js';

/**
 * PORTFOLIO BUDGET ALLOCATOR (additive capital-management layer).
 *
 * Answers ONE question: how much new risk may a strategy CONSIDER right now. It never answers which strategy wins (the sovereign entry
 * frontier does), whether a risk may be taken (AEGIS does), or what quantity to trade (the strategy does, inside its envelope). It never
 * resizes a finished proposal: a proposal that no longer fits is REEVALUATE, never shrunk under the same decision.
 *
 * Money is integer US cents throughout (no floating-point ambiguity). The limits are the EXISTING capital policy (the same
 * pct x hardCapMultiplier, strictly-below boundary as deriveCandidateCapacityAssessment) so PARITY mode can prove the allocator reproduces
 * today's capacity before it is ever enforced. Reserves (assignment / management / opportunity) and per-strategy ceilings are policy inputs;
 * when no policy is configured they are reported as *_POLICY_NOT_CONFIGURED and contribute nothing, never an invented percentage.
 */
export const portfolioBudgetCalculationVersion = 'theta-portfolio-budget-v1' as const;
export const portfolioAllocatorModes = ['OFF', 'SHADOW', 'PARITY', 'ENFORCED'] as const;
export type PortfolioAllocatorMode = typeof portfolioAllocatorModes[number];

export type AllocatorStrategy = 'THETA_Q' | 'THETA_H' | 'THETA_D' | 'THETA_A' | 'THETA_C';
export type AllocationClass = 'NEW_RISK' | 'INVENTORY_MANAGEMENT';
export const allocationClassOf = (strategy: AllocatorStrategy): AllocationClass =>
  strategy === 'THETA_A' || strategy === 'THETA_C' ? 'INVENTORY_MANAGEMENT' : 'NEW_RISK';

/** Typed failures. There is deliberately no ALLOCATOR_UNKNOWN. */
export type PortfolioBudgetFailure = 'PORTFOLIO_SNAPSHOT_UNAVAILABLE' | 'PORTFOLIO_EXPOSURE_RECONCILING' | 'BUDGET_POLICY_MISSING'
  | 'BUDGET_SNAPSHOT_STALE' | 'ATOMIC_RESERVATION_CONFLICT' | 'CAPACITY_EXHAUSTED';

export interface PortfolioBudgetPolicy {
  readonly policyVersion: string;
  /** existing capital policy (paperBootstrapRuntimePolicy.aegis): fractions of equity, hard boundary = pct x hardCapMultiplier, strict */
  readonly hardCapMultiplier: number;
  readonly maximumTickerConcentrationPct: number;
  readonly maximumSectorConcentrationPct: number;
  readonly maximumCorrelationClusterPct: number;
  readonly maximumPortfolioCapitalAtRiskPct: number;
  readonly maximumAssignmentCapacityPct: number;
  readonly maximumInventoryCapacityPct: number;
  readonly maximumRecoveryCapacityPct: number;
  /** explicit reserves in cents; null = not configured (reported, contributes 0) */
  readonly assignmentReserveCents: number | null;
  readonly managementReserveCents: number | null;
  readonly opportunityReserveCents: number | null;
  /** optional per-strategy incremental CEILINGS in cents (never guaranteed allocations); absent = no strategy ceiling */
  readonly strategyCeilingCents?: Partial<Record<AllocatorStrategy, number>>;
}

export interface PortfolioBudgetInputs {
  readonly accountId: string;
  readonly observedAt: string;
  readonly exposure: DerivedAccountExposure;
  readonly activePositions: number;
  readonly pendingOpeningOrders: number;
  /** recovery (assigned-stock) inventory value in dollars, as the existing capacity assessment receives it; null = not known */
  readonly recoveryInventoryValue: number | null;
  /** a broker/local state that is not yet reconciled (ambiguous order, local-only intent): capacity may not be handed out */
  readonly reconciling: boolean;
}

export interface PortfolioBudgetSnapshot {
  readonly snapshotId: string;
  readonly accountId: string;
  readonly observedAt: string;
  readonly calculationVersion: typeof portfolioBudgetCalculationVersion;
  readonly policyVersion: string;
  readonly accountEquityCents: number;
  readonly cashCents: number | null;
  readonly brokerBuyingPowerCents: number;
  readonly committedCapitalCents: number;
  readonly pendingOpeningCapitalCents: number;
  readonly pendingAssignmentCollateralCents: number;
  readonly openShortPutCollateralCents: number;
  readonly assignmentReserveCents: number;
  readonly managementReserveCents: number;
  readonly opportunityReserveCents: number;
  /** strict hard limits (exclusive): a candidate fits only while the post-trade value stays strictly below */
  readonly portfolioRiskLimitCents: number;
  readonly tickerLimitCents: number;
  readonly sectorLimitCents: number;
  readonly correlationLimitCents: number;
  readonly assignmentLimitCents: number;
  /** candidate-independent capacities: when already at/over their hard limit, no new risk fits (same as today's capacity check) */
  readonly inventoryCapacityExhausted: boolean;
  readonly recoveryCapacityExhausted: boolean;
  /** capital not committed, not pending, not reserved (inclusive): the most any new risk may deploy, before strict policy limits */
  readonly remainingNewRiskCapitalCents: number;
  readonly remainingPortfolioRiskCapacityCents: number;
  readonly exposureByUnderlyingCents: Readonly<Record<string, number>>;
  readonly riskyUnderlyings: readonly string[];
  readonly activePositions: number;
  readonly pendingOpeningOrders: number;
  readonly policyNotes: readonly string[];
}

export type PortfolioBudgetSnapshotResult =
  | { readonly state: 'READY'; readonly snapshot: PortfolioBudgetSnapshot }
  | { readonly state: 'UNAVAILABLE'; readonly failure: PortfolioBudgetFailure; readonly reasons: readonly string[] };

const cents = (dollars: number): number => Math.round(dollars * 100);
const finite = (value: number | null | undefined): value is number => typeof value === 'number' && Number.isFinite(value);
const canonical = (value: unknown): string => JSON.stringify(value, (_key, item) =>
  item !== null && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))) : item);

function validPolicy(policy: PortfolioBudgetPolicy | null | undefined): policy is PortfolioBudgetPolicy {
  if (policy === null || policy === undefined || policy.policyVersion.trim() === '') return false;
  const fractions = [policy.maximumTickerConcentrationPct, policy.maximumSectorConcentrationPct, policy.maximumCorrelationClusterPct,
    policy.maximumPortfolioCapitalAtRiskPct, policy.maximumAssignmentCapacityPct, policy.maximumInventoryCapacityPct, policy.maximumRecoveryCapacityPct];
  const reserves = [policy.assignmentReserveCents, policy.managementReserveCents, policy.opportunityReserveCents];
  return finite(policy.hardCapMultiplier) && policy.hardCapMultiplier > 0 && fractions.every((value) => finite(value) && value > 0)
    && reserves.every((value) => value === null || (Number.isSafeInteger(value) && value >= 0))
    && Object.values(policy.strategyCeilingCents ?? {}).every((value) => Number.isSafeInteger(value) && (value as number) >= 0);
}

/** One immutable snapshot per decision cycle: every competing new-risk strategy reads the SAME snapshotId. */
export function buildPortfolioBudgetSnapshot(inputs: PortfolioBudgetInputs, policy: PortfolioBudgetPolicy | null | undefined): PortfolioBudgetSnapshotResult {
  if (!validPolicy(policy)) return { state: 'UNAVAILABLE', failure: 'BUDGET_POLICY_MISSING', reasons: ['BUDGET_POLICY_MISSING_OR_INVALID'] };
  const exposure = inputs.exposure;
  const reasons: string[] = [];
  if (!finite(exposure.equity) || exposure.equity <= 0) reasons.push('ACCOUNT_EQUITY_UNAVAILABLE');
  if (!finite(exposure.optionsBuyingPower)) reasons.push('BROKER_BUYING_POWER_UNAVAILABLE');
  if (reasons.length > 0) return { state: 'UNAVAILABLE', failure: 'PORTFOLIO_SNAPSHOT_UNAVAILABLE', reasons };
  const longValue = exposure.longOptionValue === undefined
    ? (exposure.longPutCount + exposure.longCallCount === 0 ? 0 : null) : exposure.longOptionValue;
  if (inputs.reconciling) reasons.push('BROKER_LOCAL_STATE_RECONCILING');
  if (!finite(exposure.cspCollateralRequired) || !finite(exposure.stockInventoryValue) || !finite(longValue)) reasons.push('CURRENT_EXPOSURE_INCOMPLETE');
  if (!finite(exposure.pendingOpeningCapitalAtRisk) || !finite(exposure.pendingAssignmentCollateral)) reasons.push('PENDING_OPENING_CAPITAL_INCOMPLETE');
  if (exposure.unclassifiedOpenOrderIds.length > 0) reasons.push('PENDING_ORDER_INTENT_NOT_CLASSIFIED');
  if (exposure.unparsedOptionSymbols.length > 0 || (exposure.unclassifiedPositionSymbols ?? []).length > 0) reasons.push('POSITION_NOT_CLASSIFIED');
  if (!finite(inputs.recoveryInventoryValue) || inputs.recoveryInventoryValue < 0) reasons.push('RECOVERY_INVENTORY_VALUE_UNAVAILABLE');
  if (reasons.length > 0) return { state: 'UNAVAILABLE', failure: 'PORTFOLIO_EXPOSURE_RECONCILING', reasons };

  const equity = cents(exposure.equity as number);
  const committed = cents((exposure.cspCollateralRequired as number) + (exposure.stockInventoryValue as number) + (longValue as number));
  const pending = cents(exposure.pendingOpeningCapitalAtRisk as number);
  const notes: string[] = [];
  const reserve = (value: number | null, note: string): number => { if (value === null) { notes.push(note); return 0; } return value; };
  const assignmentReserve = reserve(policy.assignmentReserveCents, 'ASSIGNMENT_RESERVE_POLICY_NOT_CONFIGURED');
  const managementReserve = reserve(policy.managementReserveCents, 'MANAGEMENT_RESERVE_POLICY_NOT_CONFIGURED');
  const opportunityReserve = reserve(policy.opportunityReserveCents, 'OPPORTUNITY_RESERVE_POLICY_NOT_CONFIGURED');
  // Exact integer-cent equivalent of today's strict float boundary (value / equity < pct x multiplier): an integer x is strictly below a
  // real limit L iff x <= ceil(L) - 1. L is rounded to 1e-6 cents first so float noise (2250000.0000000005) can not move the ceiling.
  const limit = (pct: number): number => Math.ceil(Number((equity * pct * policy.hardCapMultiplier).toFixed(6)));
  const portfolioRiskLimit = limit(policy.maximumPortfolioCapitalAtRiskPct);
  const exposureByUnderlying = Object.fromEntries(Object.entries(exposure.exposureByUnderlying).map(([underlying, value]) => [underlying, cents(value)]));
  const unreserved = equity - committed - pending - assignmentReserve - managementReserve - opportunityReserve;
  const body = {
    accountId: inputs.accountId, observedAt: inputs.observedAt, calculationVersion: portfolioBudgetCalculationVersion, policyVersion: policy.policyVersion,
    accountEquityCents: equity, cashCents: finite(exposure.cash) ? cents(exposure.cash) : null, brokerBuyingPowerCents: cents(exposure.optionsBuyingPower as number),
    committedCapitalCents: committed, pendingOpeningCapitalCents: pending, pendingAssignmentCollateralCents: cents(exposure.pendingAssignmentCollateral as number),
    openShortPutCollateralCents: cents(exposure.cspCollateralRequired as number),
    assignmentReserveCents: assignmentReserve, managementReserveCents: managementReserve, opportunityReserveCents: opportunityReserve,
    portfolioRiskLimitCents: portfolioRiskLimit, tickerLimitCents: limit(policy.maximumTickerConcentrationPct),
    sectorLimitCents: limit(policy.maximumSectorConcentrationPct), correlationLimitCents: limit(policy.maximumCorrelationClusterPct),
    assignmentLimitCents: limit(policy.maximumAssignmentCapacityPct),
    inventoryCapacityExhausted: cents(exposure.stockInventoryValue as number) >= limit(policy.maximumInventoryCapacityPct),
    recoveryCapacityExhausted: cents(inputs.recoveryInventoryValue as number) >= limit(policy.maximumRecoveryCapacityPct),
    remainingNewRiskCapitalCents: Math.max(0, unreserved),
    remainingPortfolioRiskCapacityCents: Math.max(0, portfolioRiskLimit - committed - pending),
    exposureByUnderlyingCents: exposureByUnderlying, riskyUnderlyings: [...exposure.riskyUnderlyings].sort(),
    activePositions: inputs.activePositions, pendingOpeningOrders: inputs.pendingOpeningOrders, policyNotes: notes,
  };
  const snapshotId = createHash('sha256').update(canonical(body)).digest('hex');
  return { state: 'READY', snapshot: { snapshotId, ...body } };
}

/** One constraint a proposal must satisfy. Exclusive = existing hard-veto boundary (post-trade strictly below); inclusive = reserve math. */
export interface BudgetConstraint {
  readonly code: 'BROKER_BUYING_POWER' | 'UNRESERVED_NEW_RISK_CAPITAL' | 'PORTFOLIO_CAPITAL_AT_RISK' | 'TICKER_CONCENTRATION'
    | 'SECTOR_CONCENTRATION' | 'CORRELATION_CLUSTER' | 'ASSIGNMENT_CAPACITY' | 'INVENTORY_CAPACITY' | 'RECOVERY_CAPACITY' | 'STRATEGY_CEILING';
  readonly remainingCents: number;
  readonly exclusive: boolean;
}

/** The constraints a strategy optimizes inside. It never carries an approved contract count: the STRATEGY calculates contracts. */
export interface StrategyBudgetEnvelope {
  readonly envelopeId: string;
  readonly snapshotId: string;
  readonly strategy: AllocatorStrategy;
  readonly allocationClass: AllocationClass;
  readonly calculationVersion: typeof portfolioBudgetCalculationVersion;
  readonly policyVersion: string;
  readonly underlying: string;
  readonly maxIncrementalCapitalCents: number;
  readonly constraints: readonly BudgetConstraint[];
  readonly protectedOpportunityReserveCents: number;
  readonly protectedManagementReserveCents: number;
  readonly expiresAt: string;
  readonly notes: readonly string[];
}

/**
 * Envelope for one strategy on one underlying. Q/H consume CSP collateral against every new-risk dimension (Q and H on the SAME underlying
 * read the SAME remaining ticker capacity, because both are charged against the one exposureByUnderlying). D consumes its defined maximum
 * loss (no CSP strike x 100 collateral) and no assignment capacity. A/C are INVENTORY_MANAGEMENT: they are never charged against new-risk
 * capacity, so new entries can not starve them; their binding resource is shares/free covered shares, enforced by their own sizing.
 */
export function buildStrategyBudgetEnvelope(snapshot: PortfolioBudgetSnapshot, input: {
  readonly strategy: AllocatorStrategy; readonly underlying: string; readonly policy: PortfolioBudgetPolicy; readonly expiresAt: string;
}): StrategyBudgetEnvelope {
  const allocationClass = allocationClassOf(input.strategy);
  const notes: string[] = [...snapshot.policyNotes];
  const constraints: BudgetConstraint[] = [];
  if (allocationClass === 'NEW_RISK') {
    const underlyingExposure = snapshot.exposureByUnderlyingCents[input.underlying] ?? 0;
    const largestOther = Math.max(0, ...Object.entries(snapshot.exposureByUnderlyingCents)
      .filter(([underlying]) => underlying !== input.underlying).map(([, value]) => value));
    const postTradeUnderlyings = new Set([...snapshot.riskyUnderlyings, input.underlying]);
    constraints.push({ code: 'BROKER_BUYING_POWER', remainingCents: Math.max(0, snapshot.brokerBuyingPowerCents), exclusive: false });
    constraints.push({ code: 'UNRESERVED_NEW_RISK_CAPITAL', remainingCents: snapshot.remainingNewRiskCapitalCents, exclusive: false });
    constraints.push({ code: 'PORTFOLIO_CAPITAL_AT_RISK', remainingCents: snapshot.portfolioRiskLimitCents - snapshot.committedCapitalCents - snapshot.pendingOpeningCapitalCents, exclusive: true });
    // the existing ticker check is the LARGEST underlying exposure after the trade: another underlying already at the limit binds too
    constraints.push({ code: 'TICKER_CONCENTRATION', remainingCents: largestOther >= snapshot.tickerLimitCents ? 0 : snapshot.tickerLimitCents - underlyingExposure, exclusive: true });
    if (postTradeUnderlyings.size === 1) {
      constraints.push({ code: 'SECTOR_CONCENTRATION', remainingCents: snapshot.sectorLimitCents - underlyingExposure, exclusive: true });
      constraints.push({ code: 'CORRELATION_CLUSTER', remainingCents: snapshot.correlationLimitCents - underlyingExposure, exclusive: true });
    } else {
      notes.push('SECTOR_CLASSIFICATION_REQUIRED_FOR_MULTI_UNDERLYING_PORTFOLIO', 'CORRELATION_CLUSTER_REQUIRED_FOR_MULTI_UNDERLYING_PORTFOLIO');
    }
    if (input.strategy !== 'THETA_D') {
      constraints.push({ code: 'ASSIGNMENT_CAPACITY', remainingCents: snapshot.assignmentLimitCents - snapshot.openShortPutCollateralCents
        - snapshot.pendingAssignmentCollateralCents, exclusive: true });
    }
    if (snapshot.inventoryCapacityExhausted) constraints.push({ code: 'INVENTORY_CAPACITY', remainingCents: 0, exclusive: false });
    if (snapshot.recoveryCapacityExhausted) constraints.push({ code: 'RECOVERY_CAPACITY', remainingCents: 0, exclusive: false });
    const ceiling = input.policy.strategyCeilingCents?.[input.strategy];
    if (ceiling !== undefined) constraints.push({ code: 'STRATEGY_CEILING', remainingCents: ceiling, exclusive: false });
    else notes.push(`STRATEGY_CEILING_POLICY_NOT_CONFIGURED:${input.strategy}`);
  } else {
    notes.push('INVENTORY_MANAGEMENT_NOT_CHARGED_AGAINST_NEW_RISK_CAPACITY');
  }
  const maxIncrementalCapitalCents = constraints.length === 0 ? 0
    : Math.max(0, Math.min(...constraints.map((constraint) => constraint.exclusive ? constraint.remainingCents - 1 : constraint.remainingCents)));
  const body = { snapshotId: snapshot.snapshotId, strategy: input.strategy, allocationClass, calculationVersion: portfolioBudgetCalculationVersion,
    policyVersion: snapshot.policyVersion, underlying: input.underlying, maxIncrementalCapitalCents, constraints,
    protectedOpportunityReserveCents: snapshot.opportunityReserveCents, protectedManagementReserveCents: snapshot.managementReserveCents,
    expiresAt: input.expiresAt, notes };
  return { envelopeId: createHash('sha256').update(canonical(body)).digest('hex'), ...body };
}

export type EnvelopeFeasibility =
  | { readonly state: 'FEASIBLE'; readonly maximumQuantity: number; readonly bindingConstraint: BudgetConstraint['code'] | 'BROKER_ALLOWED_QUANTITY' }
  | { readonly state: 'NOT_FEASIBLE_WITHIN_PORTFOLIO_ENVELOPE'; readonly maximumQuantity: 0; readonly bindingConstraint: BudgetConstraint['code'] | 'BROKER_ALLOWED_QUANTITY' };

/**
 * The largest WHOLE quantity a strategy may consider inside the envelope (the strategy still decides its own quantity, which must be <= this).
 * Never fractional; one contract that does not fit is quantity 0 with the exact binding constraint. capitalPerContractCents is the strategy's
 * own capital semantics (CSP collateral for Q/H, defined maximum loss for D).
 */
export function maximumQuantityWithinEnvelope(envelope: StrategyBudgetEnvelope, input: {
  readonly capitalPerContractCents: number; readonly brokerAllowedQuantity: number;
}): EnvelopeFeasibility {
  if (envelope.allocationClass !== 'NEW_RISK') throw new Error('INVENTORY_MANAGEMENT_STRATEGY_SIZED_BY_INVENTORY_NOT_ENVELOPE');
  if (!Number.isSafeInteger(input.capitalPerContractCents) || input.capitalPerContractCents <= 0) throw new Error('CAPITAL_PER_CONTRACT_INVALID');
  let best = Number.isInteger(input.brokerAllowedQuantity) && input.brokerAllowedQuantity > 0 ? input.brokerAllowedQuantity : 0;
  let binding: BudgetConstraint['code'] | 'BROKER_ALLOWED_QUANTITY' = 'BROKER_ALLOWED_QUANTITY';
  for (const constraint of envelope.constraints) {
    const usable = constraint.exclusive ? constraint.remainingCents - 1 : constraint.remainingCents;
    const quantity = usable <= 0 ? 0 : Math.floor(usable / input.capitalPerContractCents);
    if (quantity < best) { best = quantity; binding = constraint.code; }
  }
  return best > 0 ? { state: 'FEASIBLE', maximumQuantity: best, bindingConstraint: binding }
    : { state: 'NOT_FEASIBLE_WITHIN_PORTFOLIO_ENVELOPE', maximumQuantity: 0, bindingConstraint: binding };
}

export type ParityDivergenceClass = 'EXPECTED_NEW_POLICY' | 'CURRENT_SYSTEM_DEFECT' | 'ALLOCATOR_DEFECT' | 'UNIT_MISMATCH'
  | 'STALE_PORTFOLIO_STATE' | 'STRATEGY_SEMANTICS_DIFFERENCE';

export interface ParityComparison {
  readonly strategy: AllocatorStrategy;
  readonly snapshotId: string;
  readonly currentQuantityCap: number;
  readonly allocatorMaximumQuantity: number;
  readonly currentCapitalCents: number;
  readonly allocatorEnvelopeCents: number;
  readonly divergence: null | { readonly code: 'PORTFOLIO_ALLOCATOR_PARITY_DIVERGENCE'; readonly classification: ParityDivergenceClass;
    readonly allocatorBinding: string };
}

/**
 * PARITY: does the envelope reproduce today's effective capacity? Compared against the existing capacity cap (before AEGIS reduction and
 * canary caps, which are separate authorities). A divergence is classified, never silently called a bug and never applied to execution.
 */
export function compareEnvelopeParity(input: {
  readonly envelope: StrategyBudgetEnvelope; readonly capitalPerContractCents: number; readonly brokerAllowedQuantity: number;
  readonly currentQuantityCap: number; readonly reservesConfigured: boolean;
}): ParityComparison {
  const feasibility = maximumQuantityWithinEnvelope(input.envelope, input);
  const divergent = feasibility.maximumQuantity !== input.currentQuantityCap;
  const nearBoundary = Math.abs(feasibility.maximumQuantity - input.currentQuantityCap) === 1
    && input.envelope.constraints.some((constraint) => {
      const usable = constraint.exclusive ? constraint.remainingCents - 1 : constraint.remainingCents;
      return Math.abs(usable - Math.max(feasibility.maximumQuantity, input.currentQuantityCap) * input.capitalPerContractCents) <= 100;
    });
  const classification: ParityDivergenceClass = input.reservesConfigured && feasibility.maximumQuantity < input.currentQuantityCap ? 'EXPECTED_NEW_POLICY'
    : input.envelope.strategy === 'THETA_D' ? 'STRATEGY_SEMANTICS_DIFFERENCE' : nearBoundary ? 'UNIT_MISMATCH' : 'ALLOCATOR_DEFECT';
  return { strategy: input.envelope.strategy, snapshotId: input.envelope.snapshotId, currentQuantityCap: input.currentQuantityCap,
    allocatorMaximumQuantity: feasibility.maximumQuantity, currentCapitalCents: input.currentQuantityCap * input.capitalPerContractCents,
    allocatorEnvelopeCents: input.envelope.maxIncrementalCapitalCents,
    divergence: divergent ? { code: 'PORTFOLIO_ALLOCATOR_PARITY_DIVERGENCE', classification, allocatorBinding: feasibility.bindingConstraint } : null };
}

/**
 * NO POST-HOC QUANTITY MUTATION. A strategy proposal, its plan and the coordinator request carry ONE quantity under ONE decision. If capacity
 * changed after the strategy sized, the answer is REEVALUATE (new decision cycle), never a smaller number under the same decisionId.
 */
export function assertProposalQuantityImmutable(input: {
  readonly decisionId: string; readonly proposalQuantity: number; readonly planDecisionId: string; readonly planQuantity: number;
  readonly requestQuantity?: number;
}): void {
  if (input.planDecisionId === input.decisionId && (input.planQuantity !== input.proposalQuantity
    || (input.requestQuantity !== undefined && input.requestQuantity !== input.proposalQuantity))) {
    throw new Error('PORTFOLIO_QUANTITY_MUTATED_UNDER_SAME_DECISION');
  }
}

/** Capital a proposal needs under its strategy's own semantics, in cents: CSP collateral (Q/H) or defined maximum loss (D). */
export function proposalCapitalPerContractCents(input:
  | { readonly strategy: 'THETA_Q' | 'THETA_H'; readonly strike: number; readonly multiplier: number }
  | { readonly strategy: 'THETA_D'; readonly shortStrike: number; readonly longStrike: number; readonly netCreditPerShare: number; readonly multiplier: number }): number {
  if (input.strategy === 'THETA_D') {
    const maxLossPerShare = input.shortStrike - input.longStrike - input.netCreditPerShare;
    if (!(input.shortStrike > input.longStrike) || !(maxLossPerShare > 0)) throw new Error('DEFINED_RISK_MAXIMUM_LOSS_INVALID');
    return Math.round(maxLossPerShare * input.multiplier * 100);
  }
  if (!(input.strike > 0) || !Number.isInteger(input.multiplier) || input.multiplier <= 0) throw new Error('CSP_COLLATERAL_INPUT_INVALID');
  return Math.round(input.strike * input.multiplier * 100);
}

/** Parses the allocator mode flag. Anything unrecognised is OFF (today's exact behaviour), never a stronger mode. */
export function parsePortfolioAllocatorMode(value: string | undefined): PortfolioAllocatorMode {
  return (portfolioAllocatorModes as readonly string[]).includes(String(value)) ? value as PortfolioAllocatorMode : 'OFF';
}

/** The EXISTING capital policy as the allocator's policy (no new percentage); reserves and ceilings stay not configured until policy says so. */
export function portfolioBudgetPolicyFromRuntimePolicy(aegis: {
  readonly hardCapMultiplier: number; readonly maximumTickerConcentrationPct: number; readonly maximumSectorConcentrationPct: number;
  readonly maximumCorrelationClusterPct: number; readonly maximumPortfolioCapitalAtRiskPct: number; readonly maximumAssignmentCapacityPct: number;
  readonly maximumInventoryCapacityPct: number; readonly maximumRecoveryCapacityPct: number;
}, policyVersion: string): PortfolioBudgetPolicy {
  return { policyVersion, hardCapMultiplier: aegis.hardCapMultiplier, maximumTickerConcentrationPct: aegis.maximumTickerConcentrationPct,
    maximumSectorConcentrationPct: aegis.maximumSectorConcentrationPct, maximumCorrelationClusterPct: aegis.maximumCorrelationClusterPct,
    maximumPortfolioCapitalAtRiskPct: aegis.maximumPortfolioCapitalAtRiskPct, maximumAssignmentCapacityPct: aegis.maximumAssignmentCapacityPct,
    maximumInventoryCapacityPct: aegis.maximumInventoryCapacityPct, maximumRecoveryCapacityPct: aegis.maximumRecoveryCapacityPct,
    assignmentReserveCents: null, managementReserveCents: null, opportunityReserveCents: null };
}

/**
 * Observation-only parity row for one candidate (SHADOW / PARITY). Returns null in OFF (nothing computed). ENFORCED is NOT certified in this
 * revision: it observes exactly like PARITY and the summary reports PORTFOLIO_ALLOCATOR_ENFORCEMENT_NOT_CERTIFIED. Never changes a quantity.
 */
export function observeAllocatorParity(input: {
  readonly mode: PortfolioAllocatorMode; readonly policy: PortfolioBudgetPolicy; readonly accountId: string; readonly observedAt: string;
  readonly exposure: DerivedAccountExposure; readonly recoveryInventoryValue: number | null; readonly underlying: string;
  readonly strike: number; readonly multiplier: number; readonly brokerAllowedQuantity: number; readonly currentQuantityCap: number;
}): ParityComparison | PortfolioBudgetFailure | null {
  if (input.mode === 'OFF') return null;
  const snapshot = buildPortfolioBudgetSnapshot({ accountId: input.accountId, observedAt: input.observedAt, exposure: input.exposure,
    activePositions: 0, pendingOpeningOrders: input.exposure.openOrderCount, recoveryInventoryValue: input.recoveryInventoryValue, reconciling: false }, input.policy);
  if (snapshot.state !== 'READY') return snapshot.failure;
  const envelope = buildStrategyBudgetEnvelope(snapshot.snapshot, { strategy: 'THETA_Q', underlying: input.underlying, policy: input.policy, expiresAt: input.observedAt });
  return compareEnvelopeParity({ envelope, capitalPerContractCents: proposalCapitalPerContractCents({ strategy: 'THETA_Q', strike: input.strike, multiplier: input.multiplier }),
    brokerAllowedQuantity: input.brokerAllowedQuantity, currentQuantityCap: input.currentQuantityCap, reservesConfigured: false });
}

/** Compact aggregate for one cycle: counts only (no per-candidate dataset is stored). */
export function summarizeAllocatorObservations(mode: PortfolioAllocatorMode, rows: readonly (ParityComparison | PortfolioBudgetFailure)[]):
  Readonly<Record<string, string | number | boolean>> {
  const comparisons = rows.filter((row): row is ParityComparison => typeof row !== 'string');
  const divergent = comparisons.filter((row) => row.divergence !== null);
  const summary: Record<string, string | number | boolean> = { mode, compared: comparisons.length, divergences: divergent.length,
    snapshotUnavailable: rows.length - comparisons.length, enforcementCertified: false, executionEffect: 'NONE' };
  for (const row of divergent) {
    const key = 'divergence_' + (row.divergence === null ? 'UNCLASSIFIED' : row.divergence.classification);
    summary[key] = Number(summary[key] ?? 0) + 1;
  }
  for (const row of rows) {
    if (typeof row !== 'string') continue;
    const key = 'failure_' + row;
    summary[key] = Number(summary[key] ?? 0) + 1;
  }
  if (mode === 'ENFORCED') summary.notice = 'PORTFOLIO_ALLOCATOR_ENFORCEMENT_NOT_CERTIFIED';
  return summary;
}
