import { createHash } from 'node:crypto';
import type { CanonicalFrontierCandidate } from '../theta/canonical-strategy-frontier.js';

export const definedRiskLockedPlanVersion = 'theta-defined-risk-locked-plan-v1' as const;
export const alpacaMultiLegCapabilityVersion = 'alpaca-options-level-3-mleg-docs-2026-09-25' as const;

export type MultiLegBrokerSupport =
  | 'ATOMIC_MULTI_LEG_SUPPORTED'
  | 'LEG_BY_LEG_ONLY'
  | 'PROVIDER_LIMITED'
  | 'UNKNOWN';

/** Classify read-only account evidence. This never grants broker authority. */
export function classifyAlpacaMultiLegSupport(input: {
  readonly optionsTradingLevel: number | null;
  readonly optionsApprovedLevel: number | null;
}): MultiLegBrokerSupport {
  const effectiveLevel = input.optionsTradingLevel ?? input.optionsApprovedLevel;
  if (effectiveLevel === null || !Number.isInteger(effectiveLevel) || effectiveLevel < 0) return 'UNKNOWN';
  return effectiveLevel >= 3 ? 'ATOMIC_MULTI_LEG_SUPPORTED' : 'PROVIDER_LIMITED';
}

export interface DefinedRiskLockedPlanLeg {
  readonly sequence: 1 | 2;
  readonly occSymbol: string;
  readonly side: 'SELL_TO_OPEN' | 'BUY_TO_OPEN';
  readonly optionType: 'PUT';
  readonly quantity: number;
  readonly strike: number;
  readonly expiration: string;
  readonly multiplier: number;
  readonly bid: number;
  readonly ask: number;
  readonly quoteTimestamp: string;
}

/**
 * Research-only representation of one exact two-leg D finalist.
 *
 * This type intentionally has no overlap with ApprovedMasterPaperActionPlan:
 * it has no broker account, client order id, submit command, or execution
 * authorization. The canonical Paper handoff therefore cannot accept it by
 * structural typing or by its runtime schema.
 */
export interface DefinedRiskLockedPlan {
  readonly contractVersion: typeof definedRiskLockedPlanVersion;
  readonly planId: string;
  readonly strategy: 'THETA_DEFINED_RISK';
  readonly action: 'OPEN_DEFINED_RISK';
  readonly planState: 'READY_LOCKED';
  readonly underlying: string;
  readonly candidateId: string;
  readonly snapshotId: string;
  readonly decisionCycleId: string;
  readonly decisionAsOf: string;
  readonly strategyVersion: string;
  readonly sourceEvidenceIds: readonly string[];
  readonly legs: readonly [DefinedRiskLockedPlanLeg, DefinedRiskLockedPlanLeg];
  readonly quantity: number;
  readonly netLimitCreditPerShare: number;
  readonly netLimitCreditTotal: number;
  readonly maxProfit: number;
  readonly maxLoss: number;
  readonly breakEven: number;
  readonly capitalRequirement: number;
  readonly aegisReceipt: {
    readonly state: CanonicalFrontierCandidate['aegisState'];
    readonly bindingReasons: readonly string[];
  };
  readonly sizingReceipt: CanonicalFrontierCandidate['sizing'];
  readonly brokerMultiLegSupport: MultiLegBrokerSupport;
  readonly brokerMultiLegCapabilityVersion: typeof alpacaMultiLegCapabilityVersion;
  readonly runtimeMutationAdapter: 'NOT_IMPLEMENTED_RESEARCH_ONLY';
  readonly brokerAuthority: false;
  readonly submissionAllowed: false;
  readonly contentHash: string;
}

export interface DefinedRiskLockedPlanResult {
  readonly state: 'READY_LOCKED' | 'BLOCKED_INVALID_FINALIST';
  readonly plan: DefinedRiskLockedPlan | null;
  readonly reasons: readonly string[];
}

export interface BuildDefinedRiskLockedPlanInput {
  readonly candidate: CanonicalFrontierCandidate;
  readonly snapshotId: string;
  readonly decisionCycleId: string;
  readonly decisionAsOf: string;
  readonly strategyVersion: string;
  readonly sourceEvidenceIds: readonly string[];
  readonly brokerMultiLegSupport: MultiLegBrokerSupport;
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => `${JSON.stringify(key)}:${stable(child)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function digest(value: unknown): string {
  return createHash('sha256').update(stable(value)).digest('hex');
}

function finitePositive(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value > 0;
}

function legReasons(
  candidateLeg: CanonicalFrontierCandidate['legs'][number] | undefined,
  expectedSide: DefinedRiskLockedPlanLeg['side'],
  decisionMs: number,
): readonly string[] {
  if (candidateLeg === undefined) return ['LEG_MISSING'];
  const reasons: string[] = [];
  if (candidateLeg.positionIntent !== expectedSide) reasons.push(`LEG_SIDE_INVALID:${expectedSide}`);
  if (candidateLeg.optionType !== 'PUT') reasons.push('LEG_OPTION_TYPE_NOT_PUT');
  if (candidateLeg.occSymbol === null || candidateLeg.occSymbol === undefined || candidateLeg.occSymbol.trim() === '') {
    reasons.push('LEG_OCC_IDENTITY_MISSING');
  }
  if (!finitePositive(candidateLeg.strike)) reasons.push('LEG_STRIKE_INVALID');
  if (!finitePositive(candidateLeg.multiplier)) reasons.push('LEG_MULTIPLIER_INVALID');
  if (!finitePositive(candidateLeg.bid) || !finitePositive(candidateLeg.ask)) reasons.push('LEG_TWO_SIDED_BBO_MISSING');
  else if (candidateLeg.bid > candidateLeg.ask) reasons.push('LEG_QUOTE_CROSSED');
  const quoteMs = candidateLeg.quoteTimestamp === null ? Number.NaN : Date.parse(candidateLeg.quoteTimestamp);
  if (!Number.isFinite(quoteMs)) reasons.push('LEG_QUOTE_TIMESTAMP_INVALID');
  else if (quoteMs > decisionMs) reasons.push('LEG_QUOTE_AFTER_DECISION');
  return reasons;
}

export function buildDefinedRiskLockedPlan(input: BuildDefinedRiskLockedPlanInput): DefinedRiskLockedPlanResult {
  const { candidate } = input;
  const reasons: string[] = [];
  const decisionMs = Date.parse(input.decisionAsOf);
  if (!Number.isFinite(decisionMs)) reasons.push('DECISION_TIMESTAMP_INVALID');
  if (candidate.branch !== 'THETA_DEFINED_RISK') reasons.push('BRANCH_NOT_DEFINED_RISK');
  if (candidate.action !== 'OPEN_DEFINED_RISK') reasons.push('ACTION_NOT_OPEN_DEFINED_RISK');
  if (candidate.executionAuthorized !== false) reasons.push('EXECUTION_AUTHORITY_MUST_BE_FALSE');
  if (candidate.legs.length !== 2) reasons.push('EXACTLY_TWO_LEGS_REQUIRED');
  if (!Number.isInteger(candidate.sizing.quantity) || candidate.sizing.quantity <= 0) reasons.push('POSITIVE_INTEGER_QUANTITY_REQUIRED');
  if (input.snapshotId.trim() === '') reasons.push('SNAPSHOT_ID_MISSING');
  if (input.decisionCycleId.trim() === '') reasons.push('DECISION_CYCLE_ID_MISSING');
  if (input.strategyVersion.trim() === '') reasons.push('STRATEGY_VERSION_MISSING');
  if (input.sourceEvidenceIds.length === 0 || input.sourceEvidenceIds.some((id) => id.trim() === '')) {
    reasons.push('SOURCE_EVIDENCE_ID_MISSING');
  }

  const shortLeg = candidate.legs[0];
  const longLeg = candidate.legs[1];
  reasons.push(...legReasons(shortLeg, 'SELL_TO_OPEN', decisionMs));
  reasons.push(...legReasons(longLeg, 'BUY_TO_OPEN', decisionMs));
  if (shortLeg !== undefined && longLeg !== undefined) {
    if (shortLeg.expiration !== longLeg.expiration) reasons.push('LEG_EXPIRATION_MISMATCH');
    if (shortLeg.multiplier !== longLeg.multiplier) reasons.push('LEG_MULTIPLIER_MISMATCH');
    if (!(shortLeg.strike > longLeg.strike)) reasons.push('PUT_SPREAD_STRIKE_GEOMETRY_INVALID');
  }

  const economics = candidate.economics;
  if (!finitePositive(economics.premiumPerShare)) reasons.push('NET_CREDIT_INVALID');
  if (!finitePositive(economics.maxProfit)) reasons.push('MAX_PROFIT_INVALID');
  if (!finitePositive(economics.maxLoss)) reasons.push('MAX_LOSS_INVALID');
  if (!finitePositive(economics.breakEven)) reasons.push('BREAKEVEN_INVALID');
  if (!finitePositive(economics.collateral)) reasons.push('CAPITAL_REQUIREMENT_INVALID');
  if (!candidate.structurallyFeasible) reasons.push('CANDIDATE_NOT_STRUCTURALLY_FEASIBLE');
  if (!candidate.riskFeasible) reasons.push('CANDIDATE_NOT_RISK_FEASIBLE');

  const uniqueReasons = [...new Set(reasons)];
  if (uniqueReasons.length > 0 || shortLeg === undefined || longLeg === undefined ||
      shortLeg.occSymbol === null || shortLeg.occSymbol === undefined || longLeg.occSymbol === null ||
      longLeg.occSymbol === undefined || shortLeg.bid === null || shortLeg.ask === null || longLeg.bid === null ||
      longLeg.ask === null || shortLeg.quoteTimestamp === null || longLeg.quoteTimestamp === null ||
      economics.premiumPerShare === null || economics.maxProfit === null || economics.maxLoss === null ||
      economics.breakEven === null || economics.collateral === null) {
    return { state: 'BLOCKED_INVALID_FINALIST', plan: null, reasons: uniqueReasons };
  }

  const quantity = candidate.sizing.quantity;
  const core = {
    contractVersion: definedRiskLockedPlanVersion,
    strategy: 'THETA_DEFINED_RISK' as const,
    action: 'OPEN_DEFINED_RISK' as const,
    planState: 'READY_LOCKED' as const,
    underlying: candidate.underlying,
    candidateId: candidate.candidateId,
    snapshotId: input.snapshotId,
    decisionCycleId: input.decisionCycleId,
    decisionAsOf: input.decisionAsOf,
    strategyVersion: input.strategyVersion,
    sourceEvidenceIds: [...new Set(input.sourceEvidenceIds)].toSorted(),
    legs: [
      { sequence: 1 as const, occSymbol: shortLeg.occSymbol, side: 'SELL_TO_OPEN' as const,
        optionType: 'PUT' as const, quantity, strike: shortLeg.strike, expiration: shortLeg.expiration,
        multiplier: shortLeg.multiplier, bid: shortLeg.bid, ask: shortLeg.ask,
        quoteTimestamp: shortLeg.quoteTimestamp },
      { sequence: 2 as const, occSymbol: longLeg.occSymbol, side: 'BUY_TO_OPEN' as const,
        optionType: 'PUT' as const, quantity, strike: longLeg.strike, expiration: longLeg.expiration,
        multiplier: longLeg.multiplier, bid: longLeg.bid, ask: longLeg.ask,
        quoteTimestamp: longLeg.quoteTimestamp },
    ] as const,
    quantity,
    netLimitCreditPerShare: economics.premiumPerShare,
    netLimitCreditTotal: economics.premiumPerShare * shortLeg.multiplier * quantity,
    maxProfit: economics.maxProfit * quantity,
    maxLoss: economics.maxLoss * quantity,
    breakEven: economics.breakEven,
    capitalRequirement: economics.collateral * quantity,
    aegisReceipt: { state: candidate.aegisState, bindingReasons: candidate.hardBlockers },
    sizingReceipt: candidate.sizing,
    brokerMultiLegSupport: input.brokerMultiLegSupport,
    brokerMultiLegCapabilityVersion: alpacaMultiLegCapabilityVersion,
    runtimeMutationAdapter: 'NOT_IMPLEMENTED_RESEARCH_ONLY' as const,
    brokerAuthority: false as const,
    submissionAllowed: false as const,
  };
  const contentHash = digest(core);
  return {
    state: 'READY_LOCKED', reasons: [],
    plan: { ...core, planId: digest({ kind: 'DEFINED_RISK_LOCKED_PLAN', contentHash }), contentHash },
  };
}
