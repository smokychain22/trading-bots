import { createHash } from 'node:crypto';
import type { JsonValue } from '../market/fusion-snapshot.js';
import type { NormalizedOptionContract } from './option-contract.js';
import type { StrategyFamily, StrategyRoutingResponse } from './strategy-router-contract.js';
import { canonicalThetaStrategySources, type ThetaStrategyBranch } from './strategy-package.js';
import { buildAdaptiveShadowDecisionReceipt, type AdaptiveShadowDecisionReceipt } from './adaptive-decision-brain.js';
import { securedContractCapacity } from './secured-contract-capacity.js';
import type { NewRiskDecisionReceipt } from './decision-assembly.js';
import {
  buildDefinedRiskLockedPlan, classifyAlpacaMultiLegSupport, type DefinedRiskLockedPlanResult,
} from '../research/defined-risk-locked-plan.js';

export const canonicalStrategyFrontierVersion = 'theta-canonical-strategy-frontier-v1' as const;
export const canonicalDecisionAuthorityVersion = 'theta-canonical-decision-authority-v1' as const;

export type CanonicalFrontierAction =
  | 'OPEN_CSP' | 'OPEN_DEFINED_RISK' | 'RECOVERY_WAIT' | 'SELL_STOCK' | 'SELL_CC';

export interface CanonicalFrontierLeg {
  readonly positionIntent: 'SELL_TO_OPEN' | 'BUY_TO_OPEN';
  readonly optionSymbol: string;
  readonly optionType: 'PUT' | 'CALL';
  readonly strike: number;
  readonly expiration: string;
  readonly multiplier: number;
  readonly occSymbol?: string | null;
  readonly contractTradable?: boolean | null;
  readonly exerciseStyle?: string | null;
  readonly deliverableClassification?: 'STANDARD_EQUITY' | 'ADJUSTED' | 'UNKNOWN';
  readonly bid: number | null;
  readonly ask: number | null;
  readonly quoteTimestamp: string | null;
}

export interface CanonicalFrontierEconomics {
  readonly premiumPerShare: number | null;
  readonly grossPremium: number | null;
  readonly collateral: number | null;
  readonly maxProfit: number | null;
  readonly maxLoss: number | null;
  readonly breakEven: number | null;
  readonly downsideCushion: number | null;
  readonly retainedUpside: number | null;
  readonly callAwayProceeds: number | null;
  readonly wholeChainPnlAtCallAway: number | null;
  readonly capitalDayYield: number | null;
  readonly expectedAfterCostEv: null;
}

export interface CanonicalFrontierCandidate {
  readonly candidateId: string;
  readonly branch: ThetaStrategyBranch;
  readonly action: CanonicalFrontierAction;
  readonly underlying: string;
  readonly legs: readonly CanonicalFrontierLeg[];
  readonly dte: number | null;
  readonly delta: number | null;
  readonly moneyness: number | null;
  readonly spreadPct: number | null;
  readonly liquidity: { readonly volume: number | null; readonly openInterest: number | null };
  readonly economics: CanonicalFrontierEconomics;
  readonly assignmentCapacityQty: number | null;
  readonly aegisState: CanonicalStrategyFrontierInput['aegisNewRiskState'];
  readonly hardBlockers: readonly string[];
  readonly softEvidence: readonly string[];
  readonly unknownEvidence: readonly string[];
  readonly structurallyFeasible: boolean;
  readonly riskFeasible: boolean;
  readonly sizing: {
    readonly quantity: number;
    readonly bindingConstraint: string;
    readonly reasons: readonly string[];
  };
  readonly paretoRank: number | null;
  readonly dominatedBy: readonly string[];
  readonly executionAuthorized: false;
  readonly entryEligibility?: {
    readonly basis: 'EMPIRICAL_OWNERSHIP' | 'PAPER_ENTRY_BOOTSTRAP_UNCALIBRATED' | 'INELIGIBLE';
    readonly paperBootstrapPolicyVersion: string | null;
    readonly paperBootstrapAllowedUnknownComponents: readonly string[];
    readonly paperBootstrapReasonCodes: readonly string[];
  };
}

export interface CanonicalBranchFrontier {
  readonly branch: ThetaStrategyBranch;
  readonly strategyVersion: string;
  readonly status: 'RESEARCH_ONLY' | 'SHADOW';
  readonly applicable: boolean;
  readonly evaluated: boolean;
  readonly routeReasons: readonly string[];
  readonly evaluationState: 'EVALUATED' | 'NOT_APPLICABLE' | 'BLOCKED_MISSING_INPUT';
  readonly candidateCount: number;
  readonly mechanicallyRejected: number;
  readonly enumerationTruncated: boolean;
  readonly hardVetoed: number;
  readonly softRanked: number;
  readonly dataInsufficient: number;
  readonly candidates: readonly CanonicalFrontierCandidate[];
  readonly bestCandidateId: string | null;
  readonly secondBestCandidateId: string | null;
  readonly bestRejectedCandidateId: string | null;
  readonly empiricalEconomicsReady: false;
  readonly executionAuthorized: false;
}

export interface CanonicalStrategyFrontier {
  readonly contractVersion: typeof canonicalStrategyFrontierVersion;
  readonly snapshotId: string;
  readonly timestamp: string;
  readonly strategyVersion: string;
  readonly decisionAuthorityVersion: typeof canonicalDecisionAuthorityVersion;
  readonly branches: readonly CanonicalBranchFrontier[];
  readonly branchesConsidered: readonly ThetaStrategyBranch[];
  readonly branchesEvaluated: readonly ThetaStrategyBranch[];
  readonly selectedBranch: ThetaStrategyBranch | null;
  readonly selectedCandidateId: string | null;
  readonly primaryAction: CanonicalFrontierAction | 'GLOBAL_WAIT' | 'MANAGEMENT_AUTHORITY' | 'SYSTEM_HOLD';
  readonly selectedQuantity: number;
  readonly empiricalUtilityState: 'UNKNOWN_NOT_YET_CALIBRATED';
  readonly secondBestCandidateId: string | null;
  readonly nearMissCandidateId: string | null;
  readonly bestRejectedCandidateId: string | null;
  readonly globalWaitEarned: boolean;
  readonly globalWaitReasons: readonly string[];
  readonly empiricalEconomicsReady: false;
  readonly executionAuthorized: false;
  readonly optionomicsContext: JsonValue;
  readonly adaptiveShadowDecision?: AdaptiveShadowDecisionReceipt;
  /** One bounded D finalist receipt. It is research-only and structurally
   * impossible to submit through the single-leg Master Paper handoff. */
  readonly definedRiskLockedPlan: DefinedRiskLockedPlanResult;
  readonly contentHash: string;
}

export interface CanonicalStrategyFrontierInput {
  readonly snapshotId: string;
  readonly timestamp: string;
  readonly strategyVersion: string;
  readonly contracts: readonly NormalizedOptionContract[];
  readonly routing: StrategyRoutingResponse | null;
  readonly stock: {
    readonly underlying: string;
    readonly shares: number | null;
    readonly currentPrice: number | null;
    readonly brokerCostBasisPerShare: number | null;
    readonly wholeChainEconomicBasisPerShare: number | null;
  } | null;
  readonly assignmentCapacityQty: number | null;
  readonly buyingPower?: number | null;
  readonly brokerAllowedQty?: number;
  readonly brokerAllowedQtyByCandidateId?: Readonly<Record<string, number>>;
  readonly sizingPolicy?: Readonly<Record<string, unknown>>;
  readonly aegisNewRiskState: 'ALLOW_FULL' | 'ALLOW_REDUCED' | 'HOLD_ONLY' | 'HARD_VETO' | 'DEFINED_RISK_ONLY' | 'EMERGENCY_EXIT_ONLY' | null;
  readonly aegisNewRiskStateByCandidateId?: Readonly<Record<string, CanonicalStrategyFrontierInput['aegisNewRiskState']>>;
  readonly aegisBindingReasonsByCandidateId?: Readonly<Record<string, readonly string[]>>;
  readonly eventState: string | null;
  readonly unmanagedBrokerPositionCount: number;
  readonly unevaluatedUnderlyingCount: number;
  readonly optionomicsContext: JsonValue;
  readonly entryEligibilityByOptionSymbol?: Readonly<Record<string, NonNullable<CanonicalFrontierCandidate['entryEligibility']>>>;
  readonly thetaQActionFeasibleByOptionSymbol?: Readonly<Record<string, boolean>>;
  readonly thetaQDecision?: Pick<NewRiskDecisionReceipt,
    'snapshotId' | 'timestamp' | 'underlying' | 'winningAction' | 'selectedCandidateId' | 'quantity'>;
  readonly optionsApprovedLevel?: number | null;
  readonly optionsTradingLevel?: number | null;
}

const branchOrder: readonly ThetaStrategyBranch[] = [
  'THETA_CONVENTIONAL', 'THETA_HOLD_STRIKE', 'THETA_DEFINED_RISK', 'THETA_RECOVERY', 'THETA_CC',
];
const maxDefinedRiskStructuresPerCycle = 1_000;

const familyByBranch = {
  THETA_CONVENTIONAL: 'THETA_Q', THETA_HOLD_STRIKE: 'THETA_H', THETA_DEFINED_RISK: 'THETA_D',
  THETA_RECOVERY: 'THETA_A', THETA_CC: 'THETA_C',
} as const;

export function strategyFamilyForCanonicalBranch(branch: ThetaStrategyBranch): StrategyFamily {
  return familyByBranch[branch];
}

const sourceByBranch = new Map(canonicalThetaStrategySources.map((source) => [source.branch, source]));
const finite = (value: number | null): value is number => value !== null && Number.isFinite(value);
const stable = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => `${JSON.stringify(key)}:${stable(child)}`).join(',')}}`;
  return JSON.stringify(value);
};
const digest = (value: unknown): string => createHash('sha256').update(stable(value)).digest('hex');

export function canonicalStrategyFrontierContentHash(
  frontier: Omit<CanonicalStrategyFrontier, 'contentHash'>,
): string {
  // Hash the exact JSON-compatible shape that PostgreSQL JSONB retains.
  // Earlier v1 receipts hashed in-memory `undefined` properties that JSONB
  // later omitted, which made historical hashes non-reproducible after load.
  return digest(JSON.parse(JSON.stringify(frontier)) as unknown);
}

const nonnegativeInteger = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;

function structuralSizing(
  action: CanonicalFrontierAction,
  collateral: number | null,
  actionCapacityQty: number | null,
  input: CanonicalStrategyFrontierInput,
  candidateId: string,
  candidateAegisState: CanonicalStrategyFrontierInput['aegisNewRiskState'],
): CanonicalFrontierCandidate['sizing'] {
  if (action === 'RECOVERY_WAIT') return { quantity: 0, bindingConstraint: 'WAIT_ACTION', reasons: ['NO_ORDER_REQUIRED'] };
  if (action === 'SELL_STOCK') {
    return actionCapacityQty === null
      ? { quantity: 0, bindingConstraint: 'UNKNOWN_STOCK_CAPACITY', reasons: ['STOCK_CAPACITY_UNKNOWN'] }
      : { quantity: Math.max(0, Math.floor(actionCapacityQty)), bindingConstraint: 'CONFIRMED_STOCK_SHARES', reasons: ['BROKER_STOCK_CAPACITY'] };
  }
  const policy = input.sizingPolicy;
  const namedCaps: Array<[string, unknown]> = [
    ['RISK_BUDGET', policy?.riskBudgetQtyCap], ['COLLATERAL_CAP', policy?.collateralQtyCap],
    ['CONCENTRATION_CAP', policy?.concentrationQtyCap], ['ASSIGNMENT_CAPACITY_CAP', policy?.assignmentCapacityQtyCap],
    ['TAIL_RISK_CAP', policy?.tailRiskQtyCap], ['CORRELATION_CAP', policy?.correlationQtyCap],
    ['LIQUIDITY_CAP', policy?.liquidityQtyCap],
  ];
  const brokerAllowedQty = input.brokerAllowedQtyByCandidateId?.[candidateId] ?? input.brokerAllowedQty;
  if (brokerAllowedQty !== undefined) namedCaps.push(['BROKER_ALLOWED', brokerAllowedQty]);
  const parsed: Array<[string, number | null]> = namedCaps.map(([name, value]) => [name, nonnegativeInteger(value)]);
  if (parsed.some(([, value]) => value === null)) {
    return { quantity: 0, bindingConstraint: 'SIZING_POLICY_INCOMPLETE', reasons: ['REQUIRED_SIZING_CAP_UNKNOWN'] };
  }
  if (action === 'SELL_CC') {
    if (actionCapacityQty === null) return { quantity: 0, bindingConstraint: 'COVERED_SHARES_UNKNOWN', reasons: ['COVERED_SHARE_CAPACITY_UNKNOWN'] };
    parsed.push(['COVERED_SHARE_CAPACITY', Math.max(0, Math.floor(actionCapacityQty))]);
  } else {
    const buyingPower = input.buyingPower ?? null;
    if (!finite(collateral) || collateral <= 0 || !finite(buyingPower) || buyingPower < 0) {
      return { quantity: 0, bindingConstraint: 'COLLATERAL_INPUT_UNKNOWN', reasons: ['BUYING_POWER_OR_COLLATERAL_UNKNOWN'] };
    }
    parsed.push(['BUYING_POWER_AFFORDABLE', Math.floor(buyingPower / collateral)]);
    if (action === 'OPEN_CSP' && actionCapacityQty !== null) parsed.push(['REAL_ASSIGNMENT_CAPACITY', Math.max(0, Math.floor(actionCapacityQty))]);
  }
  let [bindingConstraint, quantity] = parsed[0] as [string, number];
  for (const [name, value] of parsed.slice(1) as Array<[string, number]>) {
    if (value < quantity) [bindingConstraint, quantity] = [name, value];
  }
  const reducedMultiplier = typeof policy?.reducedStateMultiplier === 'number' && Number.isFinite(policy.reducedStateMultiplier)
    ? Math.max(0, Math.min(1, policy.reducedStateMultiplier)) : null;
  if (candidateAegisState === null || ['HOLD_ONLY', 'HARD_VETO', 'EMERGENCY_EXIT_ONLY'].includes(candidateAegisState)) {
    const exactReasons=input.aegisBindingReasonsByCandidateId?.[candidateId]?.filter((reason)=>reason.trim().length>0)??[];
    return { quantity: 0,
      bindingConstraint: exactReasons[0] ?? (candidateAegisState === null ? 'AEGIS_UNKNOWN' : `AEGIS_${candidateAegisState}`),
      reasons: exactReasons.length>0?exactReasons:['AEGIS_DOES_NOT_PERMIT_NEW_RISK'] };
  }
  if (candidateAegisState === 'ALLOW_REDUCED') {
    if (reducedMultiplier === null) return { quantity: 0, bindingConstraint: 'REDUCED_MULTIPLIER_UNKNOWN', reasons: ['REDUCED_MULTIPLIER_UNKNOWN'] };
    quantity = Math.floor(quantity * reducedMultiplier);
    bindingConstraint = 'AEGIS_ALLOW_REDUCED';
  }
  return { quantity, bindingConstraint, reasons: quantity === 0 ? ['QUANTITY_ZERO_VALID'] : ['STRUCTURAL_SIZING_COMPUTED'] };
}

function aegisStateFor(input: CanonicalStrategyFrontierInput, candidateId: string): CanonicalStrategyFrontierInput['aegisNewRiskState'] {
  if (input.aegisNewRiskStateByCandidateId !== undefined &&
    Object.hasOwn(input.aegisNewRiskStateByCandidateId, candidateId)) {
    return input.aegisNewRiskStateByCandidateId[candidateId] ?? null;
  }
  return input.aegisNewRiskState;
}

function leg(contract: NormalizedOptionContract, positionIntent: CanonicalFrontierLeg['positionIntent']): CanonicalFrontierLeg {
  return {
    positionIntent, optionSymbol: contract.optionSymbol, optionType: contract.optionType,
    strike: contract.strike, expiration: contract.expiration, multiplier: contract.multiplier,
    occSymbol: contract.occSymbol, contractTradable: contract.contractTradable ?? null,
    exerciseStyle: contract.exerciseStyle ?? null,
    deliverableClassification: contract.deliverableClassification ?? 'UNKNOWN',
    bid: contract.bid, ask: contract.ask, quoteTimestamp: contract.quoteTimestamp,
  };
}

function commonEvidence(contract: NormalizedOptionContract, input: CanonicalStrategyFrontierInput, candidateId: string): {
  hardBlockers: string[]; softEvidence: string[]; unknownEvidence: string[];
} {
  const hardBlockers: string[] = [];
  const softEvidence: string[] = [];
  const unknownEvidence: string[] = [];
  if (contract.occSymbol === null) hardBlockers.push('OCC_IDENTITY_UNKNOWN');
  // Strategy enumeration and execution qualification are separate stages.
  // A session-recorded research quote may support transparent structural
  // comparison, but it can never authorize a broker order. The execution
  // handoff must obtain and qualify a new current quote independently.
  if (!contract.executable) unknownEvidence.push(`EXECUTION_QUOTE_REQUIRED:${contract.nonExecutableReason ?? 'UNKNOWN'}`);
  const candidateAegisState = aegisStateFor(input, candidateId);
  if (candidateAegisState === null) unknownEvidence.push('AEGIS_STATE_UNKNOWN');
  else if (['HOLD_ONLY', 'HARD_VETO', 'EMERGENCY_EXIT_ONLY'].includes(candidateAegisState)) hardBlockers.push(`AEGIS_${candidateAegisState}`);
  if (input.eventState === null) unknownEvidence.push('EVENT_STATE_UNKNOWN');
  else softEvidence.push(`EVENT_STATE:${input.eventState}`);
  if (contract.iv === null) unknownEvidence.push('IV_UNKNOWN');
  if (contract.delta === null) unknownEvidence.push('DELTA_UNKNOWN');
  if (contract.openInterest === null) unknownEvidence.push('OPEN_INTEREST_UNKNOWN');
  if (contract.volume === null) unknownEvidence.push('VOLUME_UNKNOWN');
  return { hardBlockers, softEvidence, unknownEvidence };
}

function singleLegPutCandidate(branch: 'THETA_CONVENTIONAL' | 'THETA_HOLD_STRIKE', contract: NormalizedOptionContract,
  input: CanonicalStrategyFrontierInput): CanonicalFrontierCandidate {
  const candidateId = `${branch}:${contract.optionSymbol}`;
  const candidateAegisState = aegisStateFor(input, candidateId);
  const evidence = commonEvidence(contract, input, candidateId);
  if (branch === 'THETA_CONVENTIONAL' && input.thetaQActionFeasibleByOptionSymbol !== undefined) {
    const latticeFeasible = input.thetaQActionFeasibleByOptionSymbol[contract.optionSymbol];
    if (latticeFeasible === undefined) {
      // The Q lattice evaluates a filtered subset of the broader research
      // chain. Non-members are known exclusions, not missing provider data.
      evidence.hardBlockers.push('THETA_Q_OUTSIDE_EVALUATED_LATTICE');
    } else if (!latticeFeasible) {
      evidence.hardBlockers.push('THETA_Q_ACTION_INFEASIBLE');
    }
  }
  if (candidateAegisState === 'DEFINED_RISK_ONLY') evidence.hardBlockers.push('AEGIS_DEFINED_RISK_ONLY');
  const premium = finite(contract.bid) ? contract.bid : null;
  const collateral = contract.strike * contract.multiplier;
  const assignmentCapacityQty = input.assignmentCapacityQty ?? securedContractCapacity(input.buyingPower ?? null, collateral);
  if (assignmentCapacityQty === null) evidence.unknownEvidence.push('ASSIGNMENT_CAPACITY_UNKNOWN');
  else if (assignmentCapacityQty <= 0) evidence.hardBlockers.push('NO_ASSIGNMENT_CAPACITY');
  const cushion = finite(contract.underlyingReferencePrice) && finite(contract.breakEven) && contract.underlyingReferencePrice > 0
    ? (contract.underlyingReferencePrice - contract.breakEven) / contract.underlyingReferencePrice : null;
  return {
    candidateId, branch, action: 'OPEN_CSP', underlying: contract.underlying,
    legs: [leg(contract, 'SELL_TO_OPEN')], dte: contract.dte, delta: contract.delta, moneyness: contract.moneyness,
    spreadPct: contract.spreadPct, liquidity: { volume: contract.volume, openInterest: contract.openInterest },
    economics: {
      premiumPerShare: premium, grossPremium: premium === null ? null : premium * contract.multiplier,
      collateral, maxProfit: premium === null ? null : premium * contract.multiplier, maxLoss: null,
      breakEven: contract.breakEven, downsideCushion: cushion, retainedUpside: null, callAwayProceeds: null,
      wholeChainPnlAtCallAway: null, capitalDayYield: premium === null || contract.dte <= 0 ? null : premium * contract.multiplier / (collateral * contract.dte),
      expectedAfterCostEv: null,
    },
    assignmentCapacityQty, aegisState: candidateAegisState, ...evidence,
    structurallyFeasible: evidence.hardBlockers.length === 0, riskFeasible: evidence.hardBlockers.length === 0,
    sizing: structuralSizing('OPEN_CSP', collateral, assignmentCapacityQty, input, candidateId, candidateAegisState),
    paretoRank: null, dominatedBy: [], executionAuthorized: false,
    entryEligibility: input.entryEligibilityByOptionSymbol?.[contract.optionSymbol],
  };
}

function definedRiskCandidate(shortPut: NormalizedOptionContract, longPut: NormalizedOptionContract,
  input: CanonicalStrategyFrontierInput): CanonicalFrontierCandidate {
  const candidateId = `THETA_DEFINED_RISK:${shortPut.optionSymbol}:${longPut.optionSymbol}`;
  const candidateAegisState = aegisStateFor(input, candidateId);
  const shortEvidence = commonEvidence(shortPut, input, candidateId);
  const longEvidence = commonEvidence(longPut, input, candidateId);
  const hardBlockers = [...shortEvidence.hardBlockers, ...longEvidence.hardBlockers];
  const width = shortPut.strike - longPut.strike;
  const netCredit = finite(shortPut.bid) && finite(longPut.ask) ? shortPut.bid - longPut.ask : null;
  if (!(width > 0)) hardBlockers.push('INVALID_SPREAD_WIDTH');
  if (shortPut.expiration !== longPut.expiration) hardBlockers.push('MISMATCHED_EXPIRATION');
  if (shortPut.multiplier !== longPut.multiplier) hardBlockers.push('MISMATCHED_MULTIPLIER');
  if (netCredit === null) hardBlockers.push('MULTI_LEG_PRICE_UNKNOWN');
  else if (netCredit <= 0) hardBlockers.push('NON_POSITIVE_NET_CREDIT');
  const multiplier = shortPut.multiplier;
  const maxProfit = netCredit === null ? null : netCredit * multiplier;
  const maxLoss = netCredit === null ? null : (width - netCredit) * multiplier;
  return {
    candidateId,
    branch: 'THETA_DEFINED_RISK', action: 'OPEN_DEFINED_RISK', underlying: shortPut.underlying,
    legs: [leg(shortPut, 'SELL_TO_OPEN'), leg(longPut, 'BUY_TO_OPEN')], dte: shortPut.dte,
    delta: shortPut.delta, moneyness: shortPut.moneyness,
    spreadPct: finite(shortPut.spreadPct) && finite(longPut.spreadPct) ? shortPut.spreadPct + longPut.spreadPct : null,
    liquidity: {
      volume: finite(shortPut.volume) && finite(longPut.volume) ? Math.min(shortPut.volume, longPut.volume) : null,
      openInterest: finite(shortPut.openInterest) && finite(longPut.openInterest) ? Math.min(shortPut.openInterest, longPut.openInterest) : null,
    },
    economics: {
      premiumPerShare: netCredit, grossPremium: maxProfit, collateral: maxLoss, maxProfit, maxLoss,
      breakEven: netCredit === null ? null : shortPut.strike - netCredit, downsideCushion: null,
      retainedUpside: null, callAwayProceeds: null, wholeChainPnlAtCallAway: null,
      capitalDayYield: maxProfit === null || maxLoss === null || maxLoss <= 0 || shortPut.dte <= 0 ? null : maxProfit / (maxLoss * shortPut.dte),
      expectedAfterCostEv: null,
    },
    assignmentCapacityQty: null, aegisState: candidateAegisState, hardBlockers: [...new Set(hardBlockers)],
    softEvidence: [...new Set([...shortEvidence.softEvidence, ...longEvidence.softEvidence])],
    unknownEvidence: [...new Set([...shortEvidence.unknownEvidence, ...longEvidence.unknownEvidence])],
    structurallyFeasible: hardBlockers.length === 0, riskFeasible: hardBlockers.length === 0,
    sizing: structuralSizing('OPEN_DEFINED_RISK', maxLoss, null, input, candidateId, candidateAegisState),
    paretoRank: null, dominatedBy: [], executionAuthorized: false,
  };
}

function stockActionCandidate(action: 'RECOVERY_WAIT' | 'SELL_STOCK', input: CanonicalStrategyFrontierInput): CanonicalFrontierCandidate {
  const stock = input.stock as NonNullable<CanonicalStrategyFrontierInput['stock']>;
  const hardBlockers: string[] = stock.shares === null
    ? ['STOCK_QUANTITY_UNKNOWN']
    : stock.shares <= 0 ? ['NO_CONFIRMED_STOCK_INVENTORY'] : [];
  const unknownEvidence: string[] = [];
  if (stock.currentPrice === null) unknownEvidence.push('STOCK_MARK_UNKNOWN');
  if (stock.brokerCostBasisPerShare === null) unknownEvidence.push('BROKER_COST_BASIS_UNKNOWN');
  if (stock.wholeChainEconomicBasisPerShare === null) unknownEvidence.push('WHOLE_CHAIN_ECONOMIC_BASIS_UNKNOWN');
  if (input.eventState === null) unknownEvidence.push('EVENT_STATE_UNKNOWN');
  if (action === 'SELL_STOCK' && stock.currentPrice === null) hardBlockers.push('EXECUTABLE_STOCK_PRICE_UNKNOWN');
  return {
    candidateId: `THETA_RECOVERY:${stock.underlying}:${action}`, branch: 'THETA_RECOVERY', action,
    underlying: stock.underlying, legs: [], dte: null, delta: null, moneyness: null, spreadPct: null,
    liquidity: { volume: null, openInterest: null },
    economics: {
      premiumPerShare: null, grossPremium: null, collateral: null, maxProfit: null, maxLoss: null, breakEven: null,
      downsideCushion: null, retainedUpside: null, callAwayProceeds: null, wholeChainPnlAtCallAway: null,
      capitalDayYield: null, expectedAfterCostEv: null,
    },
    assignmentCapacityQty: stock.shares, aegisState: input.aegisNewRiskState,
    hardBlockers, softEvidence: [`OWNERSHIP_STATE:STOCK_HELD`, `ACTION:${action}`], unknownEvidence,
    structurallyFeasible: hardBlockers.length === 0, riskFeasible: hardBlockers.length === 0,
    sizing: structuralSizing(action, null, stock.shares, input, `THETA_RECOVERY:${stock.underlying}:${action}`, input.aegisNewRiskState),
    paretoRank: null, dominatedBy: [], executionAuthorized: false,
  };
}

function coveredCallCandidate(contract: NormalizedOptionContract, input: CanonicalStrategyFrontierInput): CanonicalFrontierCandidate {
  const stock = input.stock as NonNullable<CanonicalStrategyFrontierInput['stock']>;
  const candidateId = `THETA_CC:${contract.optionSymbol}`;
  const candidateAegisState = aegisStateFor(input, candidateId);
  const evidence = commonEvidence(contract, input, candidateId);
  if (candidateAegisState === 'DEFINED_RISK_ONLY') evidence.hardBlockers.push('AEGIS_DEFINED_RISK_ONLY');
  const coveredQty = stock.shares === null ? null : Math.floor(stock.shares / contract.multiplier);
  if (coveredQty === null) evidence.hardBlockers.push('STOCK_QUANTITY_UNKNOWN');
  else if (coveredQty <= 0) evidence.hardBlockers.push('INSUFFICIENT_COVERED_SHARES');
  const premium = finite(contract.bid) ? contract.bid : null;
  const retainedUpside = stock.currentPrice === null ? null : (contract.strike - stock.currentPrice) * contract.multiplier;
  const callAwayProceeds = contract.strike * contract.multiplier;
  const chainPnlAtCallAway = stock.wholeChainEconomicBasisPerShare === null || premium === null ? null
    : (contract.strike - stock.wholeChainEconomicBasisPerShare + premium) * contract.multiplier;
  return {
    candidateId, branch: 'THETA_CC', action: 'SELL_CC', underlying: contract.underlying,
    legs: [leg(contract, 'SELL_TO_OPEN')], dte: contract.dte, delta: contract.delta, moneyness: contract.moneyness,
    spreadPct: contract.spreadPct, liquidity: { volume: contract.volume, openInterest: contract.openInterest },
    economics: {
      premiumPerShare: premium, grossPremium: premium === null ? null : premium * contract.multiplier,
      collateral: 0, maxProfit: null, maxLoss: null, breakEven: null, downsideCushion: null,
      retainedUpside, callAwayProceeds, wholeChainPnlAtCallAway: chainPnlAtCallAway,
      capitalDayYield: null, expectedAfterCostEv: null,
    },
    assignmentCapacityQty: coveredQty, aegisState: candidateAegisState, ...evidence,
    structurallyFeasible: evidence.hardBlockers.length === 0, riskFeasible: evidence.hardBlockers.length === 0,
    sizing: structuralSizing('SELL_CC', 0, coveredQty, input, candidateId, candidateAegisState),
    paretoRank: null, dominatedBy: [], executionAuthorized: false,
  };
}

type Objective = { readonly value: number | null; readonly direction: 'MAX' | 'MIN' };
function objectives(candidate: CanonicalFrontierCandidate): readonly Objective[] {
  if (candidate.action === 'OPEN_CSP') return [
    { value: candidate.economics.grossPremium, direction: 'MAX' },
    { value: candidate.economics.collateral, direction: 'MIN' },
    { value: candidate.spreadPct, direction: 'MIN' },
    { value: candidate.economics.downsideCushion, direction: 'MAX' },
  ];
  if (candidate.action === 'OPEN_DEFINED_RISK') return [
    { value: candidate.economics.maxProfit, direction: 'MAX' },
    { value: candidate.economics.maxLoss, direction: 'MIN' },
    { value: candidate.spreadPct, direction: 'MIN' },
  ];
  if (candidate.action === 'SELL_CC') return [
    { value: candidate.economics.grossPremium, direction: 'MAX' },
    { value: candidate.spreadPct, direction: 'MIN' },
    { value: candidate.economics.retainedUpside, direction: 'MAX' },
  ];
  return [];
}

function dominates(left: CanonicalFrontierCandidate, right: CanonicalFrontierCandidate): boolean {
  if (left.branch !== right.branch || left.action !== right.action) return false;
  const rightObjectives = objectives(right);
  const leftObjectives = objectives(left);
  if (leftObjectives.length === 0 || leftObjectives.length !== rightObjectives.length) return false;
  const pairs = leftObjectives.flatMap((item, index) => {
    const other = rightObjectives[index];
    return other === undefined || !finite(item.value) || !finite(other.value) ? [] : [[item, other] as const];
  });
  if (pairs.length !== leftObjectives.length) return false;
  const noWorse = pairs.every(([a, b]) => a.direction === 'MAX' ? (a.value as number) >= (b.value as number) : (a.value as number) <= (b.value as number));
  const better = pairs.some(([a, b]) => a.direction === 'MAX' ? (a.value as number) > (b.value as number) : (a.value as number) < (b.value as number));
  return noWorse && better;
}

function rankCandidates(candidates: readonly CanonicalFrontierCandidate[]): readonly CanonicalFrontierCandidate[] {
  const feasible = candidates.filter((candidate) => candidate.riskFeasible);
  return candidates.map((candidate) => {
    if (!candidate.riskFeasible) return candidate;
    const dominatedBy = feasible.filter((other) => other.candidateId !== candidate.candidateId && dominates(other, candidate))
      .map((other) => other.candidateId).toSorted();
    return { ...candidate, paretoRank: dominatedBy.length + 1, dominatedBy };
  }).toSorted((a, b) => (a.paretoRank ?? Number.MAX_SAFE_INTEGER) - (b.paretoRank ?? Number.MAX_SAFE_INTEGER)
    || a.unknownEvidence.length - b.unknownEvidence.length || a.candidateId.localeCompare(b.candidateId));
}

function buildBranch(branch: ThetaStrategyBranch, input: CanonicalStrategyFrontierInput): CanonicalBranchFrontier {
  const source = sourceByBranch.get(branch);
  if (source === undefined) throw new Error(`CANONICAL_STRATEGY_SOURCE_MISSING:${branch}`);
  const route = input.routing?.results.find((result) => result.strategyFamily === familyByBranch[branch]) ?? null;
  const stockApplicable = (branch === 'THETA_RECOVERY' || branch === 'THETA_CC') && input.stock !== null
    && (input.stock.shares === null || input.stock.shares > 0);
  const applicable = stockApplicable || route?.eligible === true;
  const routeReasons = route?.reasons.map((reason) => reason.code) ?? (input.routing === null ? ['ROUTER_RESULT_UNKNOWN'] : ['ROUTER_FAMILY_MISSING']);
  const enumerateInapplicableResearch = branch === 'THETA_HOLD_STRIKE' || branch === 'THETA_DEFINED_RISK';
  if (!applicable && !enumerateInapplicableResearch) return {
    branch, strategyVersion: source.strategyVersion, status: source.status as 'RESEARCH_ONLY' | 'SHADOW', applicable: false,
    evaluated: true, routeReasons, evaluationState: 'NOT_APPLICABLE', candidateCount: 0, mechanicallyRejected: 0, enumerationTruncated: false,
    hardVetoed: 0, softRanked: 0, dataInsufficient: 0, candidates: [], bestCandidateId: null,
    secondBestCandidateId: null, bestRejectedCandidateId: null, empiricalEconomicsReady: false, executionAuthorized: false,
  };

  let raw: CanonicalFrontierCandidate[] = [];
  let enumerationTruncated = false;
  if (branch === 'THETA_CONVENTIONAL' || branch === 'THETA_HOLD_STRIKE') {
    raw = input.contracts.filter((contract) => contract.optionType === 'PUT' && contract.dte >= source.lattice.dteMin && contract.dte <= source.lattice.dteMax)
      .map((contract) => singleLegPutCandidate(branch, contract, input));
  } else if (branch === 'THETA_DEFINED_RISK') {
    const puts = input.contracts.filter((contract) => contract.optionType === 'PUT' && contract.dte >= source.lattice.dteMin && contract.dte <= source.lattice.dteMax);
    outer: for (const shortPut of puts) for (const longPut of puts) {
      if (shortPut.expiration === longPut.expiration && longPut.strike < shortPut.strike) {
        if (raw.length >= maxDefinedRiskStructuresPerCycle) { enumerationTruncated = true; break outer; }
        raw.push(definedRiskCandidate(shortPut, longPut, input));
      }
    }
  } else if (branch === 'THETA_RECOVERY' && input.stock !== null) {
    const ccAlternatives = input.contracts.filter((contract) => contract.optionType === 'CALL' && contract.dte >= 1 && contract.dte <= 60)
      .map((contract) => {
        const candidate = coveredCallCandidate(contract, input);
        return { ...candidate, candidateId: `THETA_RECOVERY:${contract.optionSymbol}:SELL_CC`,
          branch: 'THETA_RECOVERY' as const, action: 'SELL_CC' as const };
      });
    raw = [stockActionCandidate('RECOVERY_WAIT', input), stockActionCandidate('SELL_STOCK', input), ...ccAlternatives];
  } else if (branch === 'THETA_CC' && input.stock !== null) {
    raw = input.contracts.filter((contract) => contract.optionType === 'CALL' && contract.dte >= source.lattice.dteMin && contract.dte <= source.lattice.dteMax)
      .map((contract) => coveredCallCandidate(contract, input));
  }
  // Counterfactual research records retain the contract and economics even
  // when the router says this branch is not applicable. The router verdict
  // remains a hard blocker, so such rows cannot become Paper actions.
  const candidates = rankCandidates(applicable ? raw : raw.map((candidate) => ({
    ...candidate, hardBlockers: [...candidate.hardBlockers, 'ROUTER_NOT_APPLICABLE'],
    riskFeasible: false, executionAuthorized: false,
    sizing: { quantity: 0, bindingConstraint: 'ROUTER_NOT_APPLICABLE', reasons: [...candidate.sizing.reasons, 'ROUTER_NOT_APPLICABLE'] },
  })));
  const feasible = candidates.filter((candidate) => candidate.riskFeasible);
  const rejected = candidates.filter((candidate) => !candidate.riskFeasible);
  return {
    branch, strategyVersion: source.strategyVersion, status: source.status as 'RESEARCH_ONLY' | 'SHADOW', applicable,
    evaluated: true, routeReasons: [...routeReasons, ...(enumerationTruncated ? ['DEFINED_RISK_ENUMERATION_BOUND_REACHED'] : [])],
    evaluationState: !applicable ? 'NOT_APPLICABLE' : candidates.length === 0 || enumerationTruncated
      ? 'BLOCKED_MISSING_INPUT' : 'EVALUATED',
    candidateCount: candidates.length, mechanicallyRejected: 0, enumerationTruncated, hardVetoed: rejected.length,
    softRanked: feasible.length, dataInsufficient: candidates.filter((candidate) => candidate.unknownEvidence.length > 0).length,
    candidates, bestCandidateId: feasible[0]?.candidateId ?? null, secondBestCandidateId: feasible[1]?.candidateId ?? null,
    bestRejectedCandidateId: rejected[0]?.candidateId ?? null, empiricalEconomicsReady: false, executionAuthorized: false,
  };
}

export function buildCanonicalStrategyFrontier(input: CanonicalStrategyFrontierInput): CanonicalStrategyFrontier {
  const branches = branchOrder.map((branch) => buildBranch(branch, input));
  const applicable = branches.filter((branch) => branch.applicable);
  const evaluated = applicable.filter((branch) => branch.evaluated && branch.evaluationState !== 'BLOCKED_MISSING_INPUT');
  const globallyRanked = rankCandidates(branches.flatMap((branch) => branch.candidates));
  const feasible = globallyRanked.filter((candidate) => candidate.riskFeasible);
  // Shadow/research incompleteness stays visible in its branch receipt. It
  // cannot veto or relabel the bounded Conventional Paper decision.
  const blockedApplicable = applicable.filter((branch) => branch.branch === 'THETA_CONVENTIONAL'
    && branch.evaluationState === 'BLOCKED_MISSING_INPUT');
  const managementAuthorityRequired = applicable.some((branch) => branch.branch === 'THETA_RECOVERY' || branch.branch === 'THETA_CC');
  // Research-only and shadow branches may have structurally positive size.
  // They are never eligible for the Paper-facing frontier selection.
  const sizedNewRisk = feasible.filter((candidate) =>
    candidate.branch === 'THETA_CONVENTIONAL' && candidate.action === 'OPEN_CSP' && candidate.sizing.quantity > 0);
  // The Python-backed Q receipt owns the economic OPEN/PASS/WAIT choice.
  // Structural Pareto order is research evidence, never a substitute for it.
  const decision = input.thetaQDecision;
  const openDecision = decision !== undefined && [
    'OPEN_FULL', 'OPEN_REDUCED', 'OPEN_ALTERNATE_CONTRACT', 'OPEN_ALTERNATE_EXPIRY', 'OPEN_ALTERNATE_STRUCTURE',
  ].includes(decision.winningAction);
  const decisionSnapshotValid = decision === undefined || (decision.snapshotId === input.snapshotId
    && decision.timestamp === input.timestamp);
  const decisionCandidate = openDecision && decisionSnapshotValid
    ? sizedNewRisk.find((candidate) => candidate.candidateId === `THETA_CONVENTIONAL:${decision.selectedCandidateId}`
      && candidate.underlying === decision.underlying) ?? null : null;
  const decisionInvalid = decision !== undefined && (!decisionSnapshotValid ||
    (openDecision && (decisionCandidate === null || !Number.isInteger(decision.quantity) || decision.quantity <= 0)) ||
    decision.winningAction === 'SYSTEM_HOLD' || decision.winningAction === 'HARD_VETO');
  const structuralSelection = managementAuthorityRequired ? null
    : decision === undefined ? sizedNewRisk[0] ?? null : decisionInvalid ? null : decisionCandidate;
  const selectedQuantity = structuralSelection === null ? 0 : decision === undefined
    ? structuralSelection.sizing.quantity : Math.min(structuralSelection.sizing.quantity, decision.quantity);
  const secondBest = managementAuthorityRequired || decision !== undefined ? null : sizedNewRisk[1] ?? null;
  const paperCandidates = globallyRanked.filter((candidate) => candidate.branch === 'THETA_CONVENTIONAL');
  const rejected = paperCandidates.filter((candidate) => !candidate.riskFeasible);
  const nearMiss = paperCandidates.find((candidate) => candidate.riskFeasible && candidate.sizing.quantity === 0)
    ?? rejected[0] ?? null;
  const managementIncomplete = input.unmanagedBrokerPositionCount > 0;
  const universeIncomplete = input.unevaluatedUnderlyingCount > 0;
  const sizingEvidenceUnknown = globallyRanked.filter((candidate) => candidate.branch === 'THETA_CONVENTIONAL'
    && candidate.riskFeasible &&
    candidate.sizing.quantity === 0 && ['AEGIS_UNKNOWN', 'SIZING_POLICY_INCOMPLETE',
      'COLLATERAL_INPUT_UNKNOWN', 'REDUCED_MULTIPLIER_UNKNOWN', 'UNKNOWN_STOCK_CAPACITY',
      'COVERED_SHARES_UNKNOWN']
      .includes(candidate.sizing.bindingConstraint));
  const globalWaitEarned = !managementAuthorityRequired && applicable.length > 0 && blockedApplicable.length === 0
    && !managementIncomplete && !universeIncomplete && sizingEvidenceUnknown.length === 0
    && !decisionInvalid && structuralSelection === null;
  const partial = {
    contractVersion: canonicalStrategyFrontierVersion, snapshotId: input.snapshotId, timestamp: input.timestamp,
    strategyVersion: input.strategyVersion, decisionAuthorityVersion: canonicalDecisionAuthorityVersion,
    branches, branchesConsidered: applicable.map((branch) => branch.branch),
    branchesEvaluated: evaluated.map((branch) => branch.branch), selectedBranch: structuralSelection?.branch ?? null,
    selectedCandidateId: structuralSelection?.candidateId ?? null,
    primaryAction: managementAuthorityRequired ? 'MANAGEMENT_AUTHORITY' as const
      : structuralSelection?.action ?? (globalWaitEarned ? 'GLOBAL_WAIT' as const : 'SYSTEM_HOLD' as const),
    selectedQuantity,
    empiricalUtilityState: 'UNKNOWN_NOT_YET_CALIBRATED' as const,
    secondBestCandidateId: secondBest?.candidateId ?? null,
    nearMissCandidateId: nearMiss?.candidateId ?? null,
    bestRejectedCandidateId: rejected[0]?.candidateId ?? null,
    globalWaitEarned, globalWaitReasons: globalWaitEarned ? ['PAPER_AUTHORIZED_BRANCH_EVALUATED',
      decision !== undefined ? `THETA_Q_ECONOMIC_${decision.winningAction}` : 'NO_RISK_FEASIBLE_ACTION']
      : [...blockedApplicable.map((branch) => `BRANCH_NOT_FULLY_EVALUATED:${branch.branch}`),
          ...(decision !== undefined && !decisionSnapshotValid ? ['THETA_Q_DECISION_SNAPSHOT_MISMATCH'] : []),
          ...(decision !== undefined && openDecision && decisionCandidate === null ? ['THETA_Q_WINNER_NOT_STRUCTURALLY_FEASIBLE'] : []),
          ...(decision !== undefined && openDecision && (!Number.isInteger(decision.quantity) || decision.quantity <= 0)
            ? ['THETA_Q_WINNER_QUANTITY_INVALID'] : []),
          ...(decision?.winningAction === 'SYSTEM_HOLD' || decision?.winningAction === 'HARD_VETO'
            ? [`THETA_Q_DECISION_${decision.winningAction}`] : []),
          ...(managementAuthorityRequired ? ['EXISTING_POSITION_DELEGATED_TO_MANAGEMENT_AUTHORITY'] : []),
          ...(managementIncomplete ? ['OPEN_POSITION_MANAGEMENT_NOT_ATTACHED'] : []),
          ...(universeIncomplete ? [`UNDERLYINGS_NOT_EVALUATED:${input.unevaluatedUnderlyingCount}`] : []),
          ...[...new Set(sizingEvidenceUnknown.map((candidate) => candidate.sizing.bindingConstraint))]
            .map((constraint) => `CANDIDATE_SIZING_EVIDENCE_UNKNOWN:${constraint}`)],
    empiricalEconomicsReady: false as const, executionAuthorized: false as const, optionomicsContext: input.optionomicsContext,
  };
  const adaptiveShadowDecision = buildAdaptiveShadowDecisionReceipt({
    frontier: partial,
    currentDecision: {
      selectedCandidateRef: partial.selectedCandidateId,
      actionCode: partial.primaryAction,
      quantity: partial.selectedQuantity,
      strategyBranch: partial.selectedBranch,
    },
  });
  const definedRiskBranch = branches.find((branch) => branch.branch === 'THETA_DEFINED_RISK');
  const definedRiskFinalist = definedRiskBranch?.candidates.find((candidate) =>
    candidate.candidateId === definedRiskBranch.bestCandidateId)
    ?? definedRiskBranch?.candidates[0]
    ?? null;
  const definedRiskLockedPlan: DefinedRiskLockedPlanResult = definedRiskFinalist === null
    ? { state: 'BLOCKED_INVALID_FINALIST', plan: null, reasons: ['NO_DEFINED_RISK_FINALIST'] }
    : buildDefinedRiskLockedPlan({
      candidate: definedRiskFinalist,
      snapshotId: input.snapshotId,
      decisionCycleId: input.snapshotId,
      decisionAsOf: input.timestamp,
      strategyVersion: definedRiskBranch?.strategyVersion ?? 'UNKNOWN',
      sourceEvidenceIds: [`fusion-snapshot:${input.snapshotId}`, `candidate:${definedRiskFinalist.candidateId}`],
      brokerMultiLegSupport: classifyAlpacaMultiLegSupport({
        optionsApprovedLevel: input.optionsApprovedLevel ?? null,
        optionsTradingLevel: input.optionsTradingLevel ?? null,
      }),
    });
  const complete = { ...partial, adaptiveShadowDecision, definedRiskLockedPlan };
  return { ...complete, contentHash: canonicalStrategyFrontierContentHash(complete) };
}
