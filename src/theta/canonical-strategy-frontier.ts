import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { JsonValue } from '../market/fusion-snapshot.js';
import type { NormalizedOptionContract } from './option-contract.js';
import type { StrategyFamily, StrategyRoutingResponse } from './strategy-router-contract.js';
import { canonicalThetaStrategySources, type ThetaStrategyBranch } from './strategy-package.js';
import { buildAdaptiveShadowDecisionReceipt, type AdaptiveShadowDecisionReceipt } from './adaptive-decision-brain.js';
import { accountPolicyIncompatibilityBlocker } from './account-capacity-zero.js';
import { coveredCallContractCapacity, securedContractCapacity, wholeContractsAffordable } from './secured-contract-capacity.js';
import { buildCapitalBudgetEvidence, type CapitalBudgetAccountEvidence, type CapitalBudgetEvidence } from './capital-budget-evidence.js';
import type { NewRiskDecisionReceipt } from './decision-assembly.js';
import type { ThetaQCandidateEvaluationEntry } from './new-risk-orchestrator.js';
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
  /** Phase 3 Final Closure B: two distinct, previously-conflated concepts.
   * `grossReturnOnCollateral` = grossPremium / collateral -- dimensionless,
   * NO time dimension (the same concept as Python's
   * `credit_collateral_ratio` / `defined-risk-vs-csp-economics.ts`'s
   * `creditToCollateralRatio`, reused in spirit, not re-derived
   * differently). `capitalDayYield` = grossPremium / (collateral * dte) --
   * a RATE per unit collateral PER DAY. Neither is Return On Capital in
   * the account-equity sense, and neither is annualized. Both are GROSS
   * (pre-cost); an after-cost version does not exist because no candidate
   * has after-cost economics yet (see `expectedAfterCostEv`). */
  readonly grossReturnOnCollateral: number | null;
  readonly capitalDayYield: number | null;
  /** Deterministic opening-cost arithmetic. These values describe the
   * configured cost model for one strategy unit, one option contract for
   * Q/H/C and one two-leg spread for D. They are not actual broker fees,
   * fill slippage, expected value, or evidence of profitability. */
  readonly modeledOpeningCosts: {
    readonly state: 'KNOWN_MODELED' | 'UNKNOWN' | 'NOT_APPLICABLE';
    readonly reason: string | null;
    readonly costModelVersion: string | null;
    readonly optionLegCount: number;
    readonly commission: number | null;
    readonly fees: number | null;
    readonly slippage: number | null;
    readonly total: number | null;
    readonly netPremiumAfterOpeningCost: number | null;
    readonly maxProfitAfterOpeningCost: number | null;
    readonly maxLossAfterOpeningCost: number | null;
    readonly returnOnCollateralAfterOpeningCost: number | null;
    readonly capitalDayYieldAfterOpeningCost: number | null;
  };
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
  readonly shortDteRiskEvidence: {
    readonly state: 'READY' | 'PARTIAL';
    readonly dte: number;
    readonly gamma: number | null;
    readonly theta: number | null;
    readonly distanceToStrikePct: number | null;
    readonly pinDistancePct: number | null;
    readonly maxAdverseGap60d: number | null;
    readonly assignmentConsequence: 'SHORT_PUT_MAY_ASSIGN_STOCK';
    readonly eventState: string | null;
    readonly spreadPct: number | null;
    readonly openInterest: number | null;
    readonly volume: number | null;
    readonly modeledOpeningCost: number | null;
    readonly unknownReasons: readonly string[];
    readonly authority: 'RESEARCH_ONLY';
  } | null;
  readonly multiLegRiskEvidence: {
    readonly state: 'STRUCTURAL_READY_FILL_UNCALIBRATED' | 'PARTIAL';
    readonly expiration: string | null;
    readonly shortLegQuoteState: 'TWO_SIDED' | 'INCOMPLETE';
    readonly longLegQuoteState: 'TWO_SIDED' | 'INCOMPLETE';
    readonly simultaneousFillState: 'NOT_OBSERVED_RESEARCH_ONLY';
    readonly fillRiskState: 'UNCALIBRATED';
    readonly shortStrikePinDistancePct: number | null;
    readonly longStrikePinDistancePct: number | null;
    readonly combinedSpreadPct: number | null;
    readonly modeledOpeningCost: number | null;
    readonly unknownReasons: readonly string[];
    readonly authority: 'RESEARCH_ONLY';
  } | null;
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
    readonly waterfall?: {
      readonly version: 'theta-canonical-sizing-waterfall-v1';
      readonly candidateId: string;
      readonly snapshotId: string;
      readonly asOf: string;
      readonly policyVersion: string | null;
      readonly quantityUnit: 'CONTRACTS' | 'SHARES';
      readonly caps: readonly { name: string; value: number | null; state: 'KNOWN' | 'MISSING' | 'INVALID' }[];
      readonly preAegisQuantity: number | null;
      readonly aegisState: CanonicalStrategyFrontierInput['aegisNewRiskState'];
      readonly reducedMultiplier: number | null;
      readonly capitalBudget: CapitalBudgetEvidence;
    };
  };
  readonly paretoRank: number | null;
  readonly dominatedBy: readonly string[];
  /** Only present when the complete dominance count exceeds the bounded
   * witness list. `paretoRank` still uses the exact count, so this cannot
   * promote a dominated candidate into the nondominated set. */
  readonly dominatedByOmittedCount?: number;
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
  readonly evaluationState: 'EVALUATED' | 'NOT_APPLICABLE' | 'BLOCKED_MISSING_INPUT' | 'BRANCH_CONSTRUCTION_FAILED';
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
  /**
   * Records why the selected entry candidate occupies the frontier. Structural
   * ordering is useful research evidence, but only a snapshot-bound THETA Q
   * decision may cross the Master Paper plan boundary. Optional solely for
   * historical archive compatibility. New frontier receipts always set it.
   */
  readonly entrySelectionBasis?: 'THETA_Q_DECISION_BOUND' | 'STRUCTURAL_RESEARCH_ONLY' | 'NO_SELECTION';
  readonly primaryAction: CanonicalFrontierAction | 'GLOBAL_WAIT' | 'MANAGEMENT_AUTHORITY' | 'SYSTEM_HOLD';
  readonly selectedQuantity: number;
  readonly empiricalUtilityState: 'UNKNOWN_NOT_YET_CALIBRATED';
  readonly secondBestCandidateId: string | null;
  readonly structuralTopTwo: StructuralTopTwoDiagnostic;
  readonly nearMissCandidateId: string | null;
  readonly bestRejectedCandidateId: string | null;
  readonly globalWaitEarned: boolean;
  readonly globalWaitReasons: readonly string[];
  /** Optional only for old archives. New receipts always retain bounded
   * search coverage separately from genuine economic rejection. */
  readonly paperEvaluationCoverage?: {
    readonly state: 'COMPLETE' | 'INCOMPLETE' | 'STRUCTURAL_ONLY';
    readonly candidateCount: number;
    readonly evaluatedCount: number;
    readonly notEvaluatedCount: number;
    readonly incompleteReasonCounts: Readonly<Record<string, number>>;
  };
  readonly empiricalEconomicsReady: false;
  readonly executionAuthorized: false;
  readonly optionomicsContext: JsonValue;
  readonly adaptiveShadowDecision?: AdaptiveShadowDecisionReceipt;
  /** One bounded D finalist receipt. It is research-only and structurally
   * impossible to submit through the single-leg Master Paper handoff. */
  readonly definedRiskLockedPlan: DefinedRiskLockedPlanResult;
  readonly contentHash: string;
}

export interface CanonicalSizingPolicy {
  readonly policyVersion?: string;
  readonly riskBudgetQtyCap?: number | null;
  readonly collateralQtyCap?: number | null;
  readonly concentrationQtyCap?: number | null;
  readonly assignmentCapacityQtyCap?: number | null;
  readonly tailRiskQtyCap?: number | null;
  readonly correlationQtyCap?: number | null;
  readonly liquidityQtyCap?: number | null;
  readonly reducedStateMultiplier?: number | null;
}

export interface CanonicalOpeningCostPolicy {
  readonly commissionPerContract: number;
  readonly feesPerContract: number;
  readonly estimatedSlippagePerContract: number;
  readonly costModelVersion: string;
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
    /** Open short-call contracts plus pending sell-to-open call contracts on this underlying. `undefined`
     * keeps the legacy gross-share capacity; `null` is UNKNOWN and blocks covered-call sizing. */
    readonly committedShortCallContracts?: number | null;
  } | null;
  readonly assignmentCapacityQty: number | null;
  readonly buyingPower?: number | null;
  readonly capitalBudgetAccountEvidence?: CapitalBudgetAccountEvidence | null;
  readonly brokerAllowedQty?: number;
  readonly brokerAllowedQtyByCandidateId?: Readonly<Record<string, number>>;
  /**
   * RISK-CAP-01: the whole-contract quantity at which candidate-inclusive AEGIS was evaluated
   * (deriveCandidateCapacityAssessment().quantityCap). Final OPEN_CSP quantity may never exceed it.
   * `undefined` (field absent, archived/legacy bundle) means "not supplied" and adds no cap. Once the map is supplied,
   * a Conventional candidate with a missing or null entry is UNKNOWN capacity and sizes to zero (fail closed).
   * Other branches are capped only when they carry an explicit entry.
   */
  readonly riskCapacityQtyByCandidateId?: Readonly<Record<string, number | null>>;
  readonly sizingPolicy?: CanonicalSizingPolicy;
  readonly openingCostPolicy?: CanonicalOpeningCostPolicy | null;
  readonly maxAdverseGap60d?: number | null;
  readonly aegisNewRiskState: 'ALLOW_FULL' | 'ALLOW_REDUCED' | 'HOLD_ONLY' | 'HARD_VETO' | 'DEFINED_RISK_ONLY' | 'EMERGENCY_EXIT_ONLY' | null;
  readonly aegisNewRiskStateByCandidateId?: Readonly<Record<string, CanonicalStrategyFrontierInput['aegisNewRiskState']>>;
  readonly aegisBindingReasonsByCandidateId?: Readonly<Record<string, readonly string[]>>;
  readonly eventState: string | null;
  readonly unmanagedBrokerPositionCount: number;
  readonly unevaluatedUnderlyingCount: number;
  readonly optionomicsContext: JsonValue;
  readonly entryEligibilityByOptionSymbol?: Readonly<Record<string, NonNullable<CanonicalFrontierCandidate['entryEligibility']>>>;
  readonly thetaQCandidateEvaluationByOptionSymbol?: Readonly<Record<string, ThetaQCandidateEvaluationEntry>>;
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
/** P-B typed blocker / binding constraint: a covered call is all contracts covering the whole open position, or zero. */
const coveredCallWholePositionRequiredBlocker = 'COVERED_CALL_WHOLE_POSITION_REQUIRED' as const;
const stable = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => `${JSON.stringify(key)}:${stable(child)}`).join(',')}}`;
  return JSON.stringify(value);
};
const digest = (value: unknown): string => createHash('sha256').update(stable(value)).digest('hex');

export function canonicalOpeningCostPolicyFromUnknown(value: unknown): CanonicalOpeningCostPolicy | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const commissionPerContract = record.commissionPerContract;
  const feesPerContract = record.feesPerContract;
  const estimatedSlippagePerContract = record.estimatedSlippagePerContract;
  const costModelVersion = record.costModelVersion;
  if (typeof commissionPerContract !== 'number' || !Number.isFinite(commissionPerContract) || commissionPerContract < 0
    || typeof feesPerContract !== 'number' || !Number.isFinite(feesPerContract) || feesPerContract < 0
    || typeof estimatedSlippagePerContract !== 'number' || !Number.isFinite(estimatedSlippagePerContract)
    || estimatedSlippagePerContract < 0 || typeof costModelVersion !== 'string' || costModelVersion.trim() === '') {
    return null;
  }
  return { commissionPerContract, feesPerContract, estimatedSlippagePerContract, costModelVersion };
}

function modeledOpeningCosts(input: {
  readonly policy: CanonicalOpeningCostPolicy | null | undefined;
  readonly optionLegCount: number;
  readonly grossPremium: number | null;
  readonly maxProfit: number | null;
  readonly maxLoss: number | null;
  readonly collateral: number | null;
  readonly dte: number | null;
  readonly applicable?: boolean;
}): CanonicalFrontierEconomics['modeledOpeningCosts'] {
  if (input.applicable === false) return {
    state: 'NOT_APPLICABLE', reason: 'NO_OPTION_OPENING_ACTION', costModelVersion: null,
    optionLegCount: 0, commission: null, fees: null, slippage: null, total: null,
    netPremiumAfterOpeningCost: null, maxProfitAfterOpeningCost: null,
    maxLossAfterOpeningCost: null, returnOnCollateralAfterOpeningCost: null,
    capitalDayYieldAfterOpeningCost: null,
  };
  const policy = input.policy;
  if (policy === null || policy === undefined) return {
    state: 'UNKNOWN', reason: 'OPENING_COST_POLICY_UNKNOWN', costModelVersion: null,
    optionLegCount: input.optionLegCount, commission: null, fees: null, slippage: null, total: null,
    netPremiumAfterOpeningCost: null, maxProfitAfterOpeningCost: null,
    maxLossAfterOpeningCost: null, returnOnCollateralAfterOpeningCost: null,
    capitalDayYieldAfterOpeningCost: null,
  };
  const commission = policy.commissionPerContract * input.optionLegCount;
  const fees = policy.feesPerContract * input.optionLegCount;
  const slippage = policy.estimatedSlippagePerContract * input.optionLegCount;
  const total = commission + fees + slippage;
  const netPremiumAfterOpeningCost = input.grossPremium === null ? null : input.grossPremium - total;
  const maxProfitAfterOpeningCost = input.maxProfit === null ? null : input.maxProfit - total;
  const maxLossAfterOpeningCost = input.maxLoss === null ? null : input.maxLoss + total;
  const returnOnCollateralAfterOpeningCost = maxProfitAfterOpeningCost === null || input.collateral === null
    || input.collateral <= 0 ? null : maxProfitAfterOpeningCost / input.collateral;
  const capitalDayYieldAfterOpeningCost = returnOnCollateralAfterOpeningCost === null || input.dte === null
    || input.dte <= 0 ? null : returnOnCollateralAfterOpeningCost / input.dte;
  return {
    state: 'KNOWN_MODELED', reason: null, costModelVersion: policy.costModelVersion,
    optionLegCount: input.optionLegCount, commission, fees, slippage, total,
    netPremiumAfterOpeningCost, maxProfitAfterOpeningCost, maxLossAfterOpeningCost,
    returnOnCollateralAfterOpeningCost, capitalDayYieldAfterOpeningCost,
  };
}

export function canonicalStrategyFrontierContentHash(
  frontier: Omit<CanonicalStrategyFrontier, 'contentHash'>,
): string {
  // Hash the exact JSON-compatible shape that PostgreSQL JSONB retains.
  // Earlier v1 receipts hashed in-memory `undefined` properties that JSONB
  // later omitted, which made historical hashes non-reproducible after load.
  return digest(JSON.parse(JSON.stringify(frontier)) as unknown);
}

const nonnegativeInteger = (value: unknown): number | null =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;

type SizingCapState =
  | { readonly state: 'KNOWN'; readonly value: number }
  | { readonly state: 'MISSING' }
  | { readonly state: 'INVALID' };

const sizingCapState = (value: unknown): SizingCapState => {
  if (value === null || value === undefined) return { state: 'MISSING' };
  const parsed = nonnegativeInteger(value);
  return parsed === null ? { state: 'INVALID' } : { state: 'KNOWN', value: parsed };
};

function structuralSizing(
  action: CanonicalFrontierAction,
  collateral: number | null,
  actionCapacityQty: number | null,
  input: CanonicalStrategyFrontierInput,
  candidateId: string,
  candidateAegisState: CanonicalStrategyFrontierInput['aegisNewRiskState'],
  /** SELL_CC only (P-B): the single contract count covering the whole open position, or null when none exists. */
  wholePositionContracts?: number | null,
): CanonicalFrontierCandidate['sizing'] {
  const caps: { name: string; value: number | null; state: 'KNOWN' | 'MISSING' | 'INVALID' }[] = [];
  let preAegisQuantity: number | null = null;
  const recordedReducedMultiplier = input.sizingPolicy?.reducedStateMultiplier ?? null;
  const recordCap = (name: string, value: unknown) => {
    const parsed = sizingCapState(value);
    caps.push({ name, value: parsed.state === 'KNOWN' ? parsed.value : null, state: parsed.state });
  };
  const result = (quantity: number, bindingConstraint: string, reasons: readonly string[]): CanonicalFrontierCandidate['sizing'] => ({
    quantity, bindingConstraint, reasons,
    waterfall: { version: 'theta-canonical-sizing-waterfall-v1', candidateId, snapshotId: input.snapshotId,
      asOf: input.timestamp, policyVersion: input.sizingPolicy?.policyVersion ?? null,
      quantityUnit: action === 'SELL_STOCK' ? 'SHARES' : 'CONTRACTS', caps: [...caps], preAegisQuantity,
      aegisState: candidateAegisState,
      reducedMultiplier: finite(recordedReducedMultiplier) ? recordedReducedMultiplier : null,
      capitalBudget: buildCapitalBudgetEvidence({ candidateId, snapshotId: input.snapshotId, asOf: input.timestamp,
        buyingPower: input.buyingPower ?? null, collateralPerUnit: collateral, quantity, preAegisQuantity, caps,
        account: input.capitalBudgetAccountEvidence ?? null, policyVersion: input.sizingPolicy?.policyVersion ?? null }),
    },
  });
  if (action === 'RECOVERY_WAIT') return result(0, 'WAIT_ACTION', ['NO_ORDER_REQUIRED']);
  if (action === 'SELL_STOCK') {
    recordCap('CONFIRMED_STOCK_SHARES', actionCapacityQty);
    if (actionCapacityQty !== null && nonnegativeInteger(actionCapacityQty) === null)
      return result(0, 'STOCK_CAPACITY_INVALID', ['STOCK_CAPACITY_INVALID']);
    return actionCapacityQty === null
      ? result(0, 'UNKNOWN_STOCK_CAPACITY', ['STOCK_CAPACITY_UNKNOWN'])
      : result(Math.max(0, Math.floor(actionCapacityQty)), 'CONFIRMED_STOCK_SHARES', ['BROKER_STOCK_CAPACITY']);
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
  namedCaps.forEach(([name, value]) => recordCap(name, value));
  if (brokerAllowedQty === undefined) recordCap('BROKER_ALLOWED', undefined);
  const riskCapacityMap = action === 'OPEN_CSP' ? input.riskCapacityQtyByCandidateId : undefined;
  let riskCapacityState: SizingCapState | null = null;
  if (riskCapacityMap !== undefined && (Object.hasOwn(riskCapacityMap, candidateId) || candidateId.startsWith('THETA_CONVENTIONAL:'))) {
    riskCapacityState = sizingCapState(Object.hasOwn(riskCapacityMap, candidateId) ? riskCapacityMap[candidateId] : undefined);
    recordCap('AEGIS_RISK_CAPACITY', riskCapacityState.state === 'KNOWN' ? riskCapacityState.value : null);
  }
  const capStates = namedCaps.map(([name, value]) => [name, sizingCapState(value)] as const);
  const invalidCaps = capStates.filter(([, state]) => state.state === 'INVALID').map(([name]) => name);
  if (invalidCaps.length > 0) {
    return result(0, 'SIZING_POLICY_INVALID', invalidCaps.map((name) => `${name}_INVALID`));
  }
  if (capStates.some(([, state]) => state.state === 'MISSING')) {
    return result(0, 'SIZING_POLICY_INCOMPLETE', ['REQUIRED_SIZING_CAP_UNKNOWN']);
  }
  const parsed = capStates.map(([name, state]) => [name, (state as Extract<SizingCapState, { state: 'KNOWN' }>).value] as [string, number]);
  if (action === 'SELL_CC') {
    recordCap('COVERED_SHARE_CAPACITY', actionCapacityQty);
    if (actionCapacityQty === null) return result(0, 'COVERED_SHARES_UNKNOWN', ['COVERED_SHARE_CAPACITY_UNKNOWN']);
    parsed.push(['COVERED_SHARE_CAPACITY', Math.max(0, Math.floor(actionCapacityQty))]);
  } else {
    const buyingPower = input.buyingPower ?? null;
    if (!finite(collateral) || collateral <= 0 || !finite(buyingPower) || buyingPower < 0) {
      recordCap('BUYING_POWER_AFFORDABLE', null);
      return result(0, 'COLLATERAL_INPUT_UNKNOWN', ['BUYING_POWER_OR_COLLATERAL_UNKNOWN']);
    }
    const affordableQty = wholeContractsAffordable(buyingPower, collateral);
    if (affordableQty === null) {
      recordCap('BUYING_POWER_AFFORDABLE', null);
      return result(0, 'COLLATERAL_INPUT_UNKNOWN', ['BUYING_POWER_OR_COLLATERAL_UNKNOWN']);
    }
    parsed.push(['BUYING_POWER_AFFORDABLE', affordableQty]);
    recordCap('BUYING_POWER_AFFORDABLE', affordableQty);
    if (action === 'OPEN_CSP' && actionCapacityQty !== null) {
      parsed.push(['REAL_ASSIGNMENT_CAPACITY', Math.max(0, Math.floor(actionCapacityQty))]);
      recordCap('REAL_ASSIGNMENT_CAPACITY', actionCapacityQty);
    }
  }
  if (parsed.some(([, value]) => nonnegativeInteger(value) === null))
    return result(0, 'SIZING_CAPACITY_INVALID', ['DERIVED_CAPACITY_NOT_SAFE_INTEGER']);
  let [bindingConstraint, quantity] = parsed[0] as [string, number];
  for (const [name, value] of parsed.slice(1) as Array<[string, number]>) {
    if (value < quantity) [bindingConstraint, quantity] = [name, value];
  }
  if (riskCapacityState?.state === 'KNOWN' && riskCapacityState.value < quantity)
    [bindingConstraint, quantity] = ['AEGIS_RISK_CAPACITY', riskCapacityState.value];
  preAegisQuantity = quantity;
  const reducedMultiplierInput = policy?.reducedStateMultiplier;
  const reducedMultiplier = typeof reducedMultiplierInput === 'number' && Number.isFinite(reducedMultiplierInput)
    && reducedMultiplierInput >= 0 && reducedMultiplierInput <= 1 ? reducedMultiplierInput : null;
  if (reducedMultiplierInput !== null && reducedMultiplierInput !== undefined && reducedMultiplier === null) {
    return result(0, 'SIZING_POLICY_INVALID', ['REDUCED_MULTIPLIER_INVALID']);
  }
  if (candidateAegisState === null || ['HOLD_ONLY', 'HARD_VETO', 'EMERGENCY_EXIT_ONLY'].includes(candidateAegisState)) {
    const exactReasons=input.aegisBindingReasonsByCandidateId?.[candidateId]?.filter((reason)=>reason.trim().length>0)??[];
    // Per-candidate AEGIS assessments exist but not for this candidate: AEGIS was never asked (upstream Q/shortlist
    // did not forward it). That is NOT_REACHED, distinct from AEGIS being asked and returning UNKNOWN. Both keep
    // quantity 0 and the same fail-closed wait semantics.
    const aegisNotReached = candidateAegisState === null && input.aegisNewRiskStateByCandidateId !== undefined
      && !Object.hasOwn(input.aegisNewRiskStateByCandidateId, candidateId);
    return result(0, exactReasons[0] ?? (candidateAegisState === null
      ? (aegisNotReached ? 'AEGIS_NOT_REACHED_UPSTREAM' : 'AEGIS_UNKNOWN') : `AEGIS_${candidateAegisState}`),
      exactReasons.length>0?exactReasons:['AEGIS_DOES_NOT_PERMIT_NEW_RISK']);
  }
  if (riskCapacityState !== null && riskCapacityState.state !== 'KNOWN') {
    return result(0, riskCapacityState.state === 'INVALID' ? 'AEGIS_RISK_CAPACITY_INVALID' : 'AEGIS_RISK_CAPACITY_UNKNOWN',
      ['AEGIS_RISK_CAPACITY_UNKNOWN']);
  }
  if (candidateAegisState === 'ALLOW_REDUCED') {
    if (reducedMultiplier === null) return result(0, 'REDUCED_MULTIPLIER_UNKNOWN', ['REDUCED_MULTIPLIER_UNKNOWN']);
    quantity = Math.floor(quantity * reducedMultiplier);
    bindingConstraint = 'AEGIS_ALLOW_REDUCED';
  }
  // P-B: a covered call is all contracts covering the whole open position or zero; never a partial-coverage quantity.
  if (action === 'SELL_CC' && wholePositionContracts !== undefined && quantity > 0 && quantity !== wholePositionContracts) {
    return result(0, coveredCallWholePositionRequiredBlocker, [coveredCallWholePositionRequiredBlocker]);
  }
  return result(quantity, bindingConstraint, quantity === 0 ? ['QUANTITY_ZERO_VALID'] : ['STRUCTURAL_SIZING_COMPUTED']);
}

const unknownCodedReason = /(^|:)[A-Z0-9_]*_UNKNOWN$/;
/** True when AEGIS held the candidate only because required inputs were UNKNOWN (every exact binding reason is *_UNKNOWN). */
function aegisHoldIsMissingEvidence(input: CanonicalStrategyFrontierInput, candidateId: string): boolean {
  const reasons = input.aegisBindingReasonsByCandidateId?.[candidateId]?.filter((reason) => reason.trim().length > 0) ?? [];
  return reasons.length > 0 && reasons.every((reason) => unknownCodedReason.test(reason));
}

function aegisStateFor(input: CanonicalStrategyFrontierInput, candidateId: string): CanonicalStrategyFrontierInput['aegisNewRiskState'] {
  if (input.aegisNewRiskStateByCandidateId !== undefined &&
    Object.hasOwn(input.aegisNewRiskStateByCandidateId, candidateId)) {
    return input.aegisNewRiskStateByCandidateId[candidateId] ?? null;
  }
  // Once exact Conventional assessments exist, the representative state is
  // not evidence that every other chain contract was assessed by AEGIS.
  if (input.aegisNewRiskStateByCandidateId !== undefined && candidateId.startsWith('THETA_CONVENTIONAL:'))
    return null;
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
  // A HOLD_ONLY whose every binding reason is an UNKNOWN required input is missing evidence, not a risk finding.
  else if (candidateAegisState === 'HOLD_ONLY' && aegisHoldIsMissingEvidence(input, candidateId)) {
    unknownEvidence.push('AEGIS_REQUIRED_INPUT_UNKNOWN');
  } else if (['HOLD_ONLY', 'HARD_VETO', 'EMERGENCY_EXIT_ONLY'].includes(candidateAegisState)) hardBlockers.push(`AEGIS_${candidateAegisState}`);
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
  // RISK-CAP-01: an explicit null means the cycle could not derive the quantity AEGIS was evaluated at (UNKNOWN, never zero).
  if (input.riskCapacityQtyByCandidateId !== undefined && Object.hasOwn(input.riskCapacityQtyByCandidateId, candidateId)
    && input.riskCapacityQtyByCandidateId[candidateId] === null) evidence.unknownEvidence.push('AEGIS_RISK_CAPACITY_UNKNOWN');
  if (branch === 'THETA_CONVENTIONAL' && input.thetaQCandidateEvaluationByOptionSymbol !== undefined) {
    const qEvaluation = input.thetaQCandidateEvaluationByOptionSymbol[contract.optionSymbol];
    // Truthful per-state hard blockers -- see ThetaQCandidateEvaluationEntry's
    // doc comment (new-risk-orchestrator.ts) for why there is no separate
    // "outside Q's design" state: the real pipeline never silently omits a
    // sent candidate from Q's response (theta_q_baseline.py:rank_candidates
    // guarantees every sent candidate is returned), so a design-based
    // rejection always arrives as EVALUATED_INFEASIBLE with a real reason,
    // never as an absence. An absence here is either a candidate that never
    // reached the bridge (NOT_SENT_UPSTREAM_REJECT, with the real upstream
    // reason preserved) or a genuine response anomaly (RESPONSE_GAP) -- both
    // must still hard-block Paper-facing execution, but now with an honest
    // reason code, never the old "outside lattice design" implication.
    if (qEvaluation === undefined) {
      // Bridge ran successfully this cycle but has no entry at all for this
      // exact option symbol -- a genuine anomaly given the map is meant to
      // cover every raw candidate the cycle considered, not just those sent
      // to Q. Never conflated with a real rejection reason.
      evidence.hardBlockers.push('THETA_Q_EVALUATION_STATE_MISSING');
    } else if (qEvaluation.state === 'EVALUATED_INFEASIBLE') {
      evidence.hardBlockers.push('THETA_Q_ACTION_INFEASIBLE', `THETA_Q_INFEASIBLE_REASON:${qEvaluation.reasonCode}`);
    } else if (qEvaluation.state === 'NOT_SENT_UPSTREAM_REJECT') {
      evidence.hardBlockers.push(`THETA_Q_NOT_SENT_UPSTREAM_REJECT:${qEvaluation.reasonCode}`);
    } else if (qEvaluation.state === 'NOT_EVALUATED_SHORTLIST_BOUND') {
      // SIZE-ZERO-LABEL-01: when the cycle PROVED the minimum executable unit exceeds the account/risk policy (or broker
      // capacity) without needing AEGIS, the candidate is an account-policy incompatibility, not an incomplete evaluation.
      // Protection is unchanged: quantity stays 0 and the candidate is still not evaluated by Q/AEGIS.
      evidence.hardBlockers.push(qEvaluation.accountPolicyIncompatibility === undefined
        ? 'THETA_Q_NOT_EVALUATED_SHORTLIST_BOUND' : accountPolicyIncompatibilityBlocker);
    } else if (qEvaluation.state === 'RESPONSE_GAP') {
      evidence.hardBlockers.push('THETA_Q_RESPONSE_GAP');
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
  const grossPremium = premium === null ? null : premium * contract.multiplier;
  const maxProfit = grossPremium;
  const maxLoss = premium === null ? null : (contract.strike - premium) * contract.multiplier;
  const openingCosts = modeledOpeningCosts({ policy: input.openingCostPolicy, optionLegCount: 1,
    grossPremium, maxProfit, maxLoss, collateral, dte: contract.dte });
  const shortDteUnknownReasons = branch === 'THETA_HOLD_STRIKE' ? [
    ...(contract.gamma === null ? ['GAMMA_UNKNOWN'] : []),
    ...(contract.theta === null ? ['THETA_UNKNOWN'] : []),
    ...(contract.underlyingReferencePrice === null ? ['UNDERLYING_REFERENCE_UNKNOWN'] : []),
    ...(input.maxAdverseGap60d === null || input.maxAdverseGap60d === undefined ? ['MAX_ADVERSE_GAP_60D_UNKNOWN'] : []),
    ...(input.eventState === null ? ['EVENT_STATE_UNKNOWN'] : []),
    ...(contract.spreadPct === null ? ['SPREAD_UNKNOWN'] : []),
    ...(contract.openInterest === null ? ['OPEN_INTEREST_UNKNOWN'] : []),
    ...(contract.volume === null ? ['VOLUME_UNKNOWN'] : []),
    ...(openingCosts.total === null ? ['OPENING_COST_UNKNOWN'] : []),
  ] : [];
  const spot = contract.underlyingReferencePrice;
  return {
    candidateId, branch, action: 'OPEN_CSP', underlying: contract.underlying,
    legs: [leg(contract, 'SELL_TO_OPEN')], dte: contract.dte, delta: contract.delta, moneyness: contract.moneyness,
    spreadPct: contract.spreadPct, liquidity: { volume: contract.volume, openInterest: contract.openInterest },
    shortDteRiskEvidence: branch === 'THETA_HOLD_STRIKE' ? {
      state: shortDteUnknownReasons.length === 0 ? 'READY' : 'PARTIAL', dte: contract.dte,
      gamma: contract.gamma, theta: contract.theta,
      distanceToStrikePct: spot === null || contract.strike <= 0 ? null : (spot - contract.strike) / contract.strike,
      pinDistancePct: spot === null || spot <= 0 ? null : Math.abs(spot - contract.strike) / spot,
      maxAdverseGap60d: input.maxAdverseGap60d ?? null,
      assignmentConsequence: 'SHORT_PUT_MAY_ASSIGN_STOCK', eventState: input.eventState,
      spreadPct: contract.spreadPct, openInterest: contract.openInterest, volume: contract.volume,
      modeledOpeningCost: openingCosts.total, unknownReasons: shortDteUnknownReasons,
      authority: 'RESEARCH_ONLY',
    } : null,
    multiLegRiskEvidence: null,
    economics: {
      premiumPerShare: premium, grossPremium,
      // Phase 3 (THETA-Q-CSP-MAXLOSS-NOT-POPULATED, reproduced test-first):
      // a cash-secured short put's contractual worst case (underlying -> 0)
      // is fully determined by strike, entry credit, and multiplier -- all
      // three are already known whenever `premium` is known (strike and
      // multiplier are non-nullable on a NormalizedOptionContract). This
      // was previously hardcoded null even when every input existed. Gross
      // (before transaction cost), matching `maxProfit`'s existing gross
      // treatment immediately above and D's identical `(width - netCredit)
      // * multiplier` pattern below -- same convention, same sign (a
      // positive magnitude, never a signed PnL).
      collateral, maxProfit, maxLoss,
      breakEven: contract.breakEven, downsideCushion: cushion, retainedUpside: null, callAwayProceeds: null,
      wholeChainPnlAtCallAway: null,
      grossReturnOnCollateral: premium === null || collateral <= 0 ? null : (premium * contract.multiplier) / collateral,
      capitalDayYield: premium === null || contract.dte <= 0 ? null : premium * contract.multiplier / (collateral * contract.dte),
      modeledOpeningCosts: openingCosts,
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
  else if (width > 0 && netCredit >= width) hardBlockers.push('NET_CREDIT_NOT_BELOW_SPREAD_WIDTH');
  // A research-recorded (non-executable) quote may still support structural comparison, but a stale,
  // crossed, or missing-quote leg makes the whole spread unusable: both legs must be usable together.
  const unusableQuote = /quote stale|crossed BBO|quote unavailable|timestamp invalid/;
  for (const [label, legContract] of [['SHORT', shortPut], ['LONG', longPut]] as const) {
    if (!legContract.executable && unusableQuote.test(legContract.nonExecutableReason ?? '')) {
      hardBlockers.push(`DEFINED_RISK_LEG_QUOTE_UNUSABLE:${label}`);
    }
  }
  const multiplier = shortPut.multiplier;
  const maxProfit = netCredit === null ? null : netCredit * multiplier;
  const maxLoss = netCredit === null ? null : (width - netCredit) * multiplier;
  const openingCosts = modeledOpeningCosts({ policy: input.openingCostPolicy, optionLegCount: 2,
    grossPremium: maxProfit, maxProfit, maxLoss, collateral: maxLoss, dte: shortPut.dte });
  const spot = shortPut.underlyingReferencePrice;
  const shortTwoSided = finite(shortPut.bid) && finite(shortPut.ask) && shortPut.bid <= shortPut.ask;
  const longTwoSided = finite(longPut.bid) && finite(longPut.ask) && longPut.bid <= longPut.ask;
  const multiLegUnknownReasons = [
    ...(!shortTwoSided ? ['SHORT_LEG_BBO_INCOMPLETE'] : []),
    ...(!longTwoSided ? ['LONG_LEG_BBO_INCOMPLETE'] : []),
    ...(spot === null ? ['UNDERLYING_REFERENCE_UNKNOWN'] : []),
    ...(openingCosts.total === null ? ['OPENING_COST_UNKNOWN'] : []),
    'SIMULTANEOUS_FILL_NOT_OBSERVED', 'FILL_RISK_UNCALIBRATED',
  ];
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
    shortDteRiskEvidence: null,
    multiLegRiskEvidence: {
      state: multiLegUnknownReasons.length === 2 ? 'STRUCTURAL_READY_FILL_UNCALIBRATED' : 'PARTIAL',
      expiration: shortPut.expiration === longPut.expiration ? shortPut.expiration : null,
      shortLegQuoteState: shortTwoSided ? 'TWO_SIDED' : 'INCOMPLETE',
      longLegQuoteState: longTwoSided ? 'TWO_SIDED' : 'INCOMPLETE',
      simultaneousFillState: 'NOT_OBSERVED_RESEARCH_ONLY', fillRiskState: 'UNCALIBRATED',
      shortStrikePinDistancePct: spot === null || spot <= 0 ? null : Math.abs(spot - shortPut.strike) / spot,
      longStrikePinDistancePct: spot === null || spot <= 0 ? null : Math.abs(spot - longPut.strike) / spot,
      combinedSpreadPct: finite(shortPut.spreadPct) && finite(longPut.spreadPct)
        ? shortPut.spreadPct + longPut.spreadPct : null,
      modeledOpeningCost: openingCosts.total, unknownReasons: multiLegUnknownReasons,
      authority: 'RESEARCH_ONLY',
    },
    economics: {
      premiumPerShare: netCredit, grossPremium: maxProfit, collateral: maxLoss, maxProfit, maxLoss,
      breakEven: netCredit === null ? null : shortPut.strike - netCredit, downsideCushion: null,
      retainedUpside: null, callAwayProceeds: null, wholeChainPnlAtCallAway: null,
      grossReturnOnCollateral: maxProfit === null || maxLoss === null || maxLoss <= 0 ? null : maxProfit / maxLoss,
      capitalDayYield: maxProfit === null || maxLoss === null || maxLoss <= 0 || shortPut.dte <= 0 ? null : maxProfit / (maxLoss * shortPut.dte),
      modeledOpeningCosts: openingCosts,
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
    shortDteRiskEvidence: null,
    multiLegRiskEvidence: null,
    economics: {
      premiumPerShare: null, grossPremium: null, collateral: null, maxProfit: null, maxLoss: null, breakEven: null,
      downsideCushion: null, retainedUpside: null, callAwayProceeds: null, wholeChainPnlAtCallAway: null,
      grossReturnOnCollateral: null, capitalDayYield: null,
      modeledOpeningCosts: modeledOpeningCosts({ policy: input.openingCostPolicy, optionLegCount: 0,
        grossPremium: null, maxProfit: null, maxLoss: null, collateral: null, dte: null, applicable: false }),
      expectedAfterCostEv: null,
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
  const grossCoveredQty = stock.shares === null ? null : Math.floor(stock.shares / contract.multiplier);
  const committedUnknown = stock.committedShortCallContracts === null;
  const coveredQty = stock.committedShortCallContracts === undefined ? grossCoveredQty
    : coveredCallContractCapacity(stock.shares, stock.committedShortCallContracts, 0, contract.multiplier);
  if (stock.shares === null) evidence.hardBlockers.push('STOCK_QUANTITY_UNKNOWN');
  else if (committedUnknown) evidence.hardBlockers.push('COVERED_CALL_COMMITMENT_UNKNOWN');
  else if (coveredQty === null) evidence.hardBlockers.push('COVERED_CALL_CAPACITY_INVALID');
  else if (coveredQty <= 0) evidence.hardBlockers.push(grossCoveredQty !== null && grossCoveredQty > 0
    ? 'COVERED_SHARES_ALREADY_COMMITTED' : 'INSUFFICIENT_COVERED_SHARES');
  // P-B WHOLE-POSITION LOT ACCOUNTING (owner Paper policy). The ledger cannot record a partial call-away, so the covered-call
  // quantity is either EXACTLY the contracts covering the entire open position (shares % multiplier === 0 and no share is
  // committed elsewhere) or ZERO with a typed blocker. Unknown shares stay UNKNOWN (their own blocker above), never zero.
  const wholePositionContracts = stock.shares !== null && stock.shares > 0 && Number.isSafeInteger(stock.shares)
    && stock.shares % contract.multiplier === 0 ? stock.shares / contract.multiplier : null;
  const wholePositionViolated = stock.shares !== null && stock.shares > 0 && !committedUnknown && (wholePositionContracts === null
    || (coveredQty !== null && coveredQty !== wholePositionContracts));
  if (wholePositionViolated) evidence.hardBlockers.push(coveredCallWholePositionRequiredBlocker);
  const sizing = structuralSizing('SELL_CC', 0, coveredQty, input, candidateId, candidateAegisState, wholePositionContracts);
  if (sizing.bindingConstraint === coveredCallWholePositionRequiredBlocker
    && !evidence.hardBlockers.includes(coveredCallWholePositionRequiredBlocker)) {
    evidence.hardBlockers.push(coveredCallWholePositionRequiredBlocker);
  }
  const premium = finite(contract.bid) ? contract.bid : null;
  const retainedUpside = stock.currentPrice === null ? null : (contract.strike - stock.currentPrice) * contract.multiplier;
  const callAwayProceeds = contract.strike * contract.multiplier;
  const chainPnlAtCallAway = stock.wholeChainEconomicBasisPerShare === null || premium === null ? null
    : (contract.strike - stock.wholeChainEconomicBasisPerShare + premium) * contract.multiplier;
  const grossPremium = premium === null ? null : premium * contract.multiplier;
  return {
    candidateId, branch: 'THETA_CC', action: 'SELL_CC', underlying: contract.underlying,
    legs: [leg(contract, 'SELL_TO_OPEN')], dte: contract.dte, delta: contract.delta, moneyness: contract.moneyness,
    spreadPct: contract.spreadPct, liquidity: { volume: contract.volume, openInterest: contract.openInterest },
    shortDteRiskEvidence: null,
    multiLegRiskEvidence: null,
    economics: {
      premiumPerShare: premium, grossPremium,
      collateral: 0, maxProfit: null, maxLoss: null, breakEven: null, downsideCushion: null,
      retainedUpside, callAwayProceeds, wholeChainPnlAtCallAway: chainPnlAtCallAway,
      grossReturnOnCollateral: null, capitalDayYield: null,
      modeledOpeningCosts: modeledOpeningCosts({ policy: input.openingCostPolicy, optionLegCount: 1,
        grossPremium, maxProfit: grossPremium, maxLoss: null, collateral: null, dte: contract.dte }),
      expectedAfterCostEv: null,
    },
    assignmentCapacityQty: coveredQty, aegisState: candidateAegisState, ...evidence,
    structurallyFeasible: evidence.hardBlockers.length === 0, riskFeasible: evidence.hardBlockers.length === 0,
    sizing,
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

// This is an evidence-payload bound, not an economic or risk threshold.
// Exact domination count still determines the rank. Unbounded witness arrays
// used O(n^2) memory on a 2,601-contract offline probe (3.38m strings).
const maxDominanceWitnessesPerCandidate = 32;
type ParetoVector = readonly (number | null)[];
const paretoVector = (candidate: CanonicalFrontierCandidate): ParetoVector => objectives(candidate).map((objective) =>
  finite(objective.value) ? objective.value * (objective.direction === 'MAX' ? 1 : -1) : null);

function dominatesVector(left: ParetoVector, right: ParetoVector): boolean {
  if (left.length === 0 || left.length !== right.length) return false;
  let better = false;
  for (let index = 0; index < left.length; index++) {
    const a = left[index];
    const b = right[index];
    if (a === null || a === undefined || b === null || b === undefined || a < b) return false;
    if (a > b) better = true;
  }
  return better;
}

export const candidateRankOrder = (a: Pick<CanonicalFrontierCandidate, 'paretoRank' | 'unknownEvidence' | 'candidateId'>,
  b: Pick<CanonicalFrontierCandidate, 'paretoRank' | 'unknownEvidence' | 'candidateId'>): number =>
  (a.paretoRank ?? Number.MAX_SAFE_INTEGER) - (b.paretoRank ?? Number.MAX_SAFE_INTEGER)
    || a.unknownEvidence.length - b.unknownEvidence.length || a.candidateId.localeCompare(b.candidateId);

export interface StructuralTopTwoDiagnostic {
  readonly state: 'NO_COMPARISON' | 'CLEAR_WINNER' | 'NEAR_TIE' | 'EXACT_TIE';
  readonly firstCandidateId: string | null;
  readonly secondCandidateId: string | null;
  readonly paretoRankDifference: number | null;
  readonly unknownCountDifference: number | null;
  readonly objectiveMargins: readonly { readonly name: string; readonly first: number | null;
    readonly second: number | null; readonly difference: number | null }[];
  readonly selectionAuthority: false;
}

// Equal rank and equal unknown count means the final ordering fell to the
// canonical candidate ID. Distinct objectives in that class are a Pareto
// trade-off, not a calibrated probability or percentage-defined near tie.
export function describeStructuralTopTwo(candidates: readonly CanonicalFrontierCandidate[]): StructuralTopTwoDiagnostic {
  const [first, second] = candidates.filter((candidate) => candidate.riskFeasible
    && candidate.sizing.quantity > 0).toSorted(candidateRankOrder);
  if (!first || !second) return { state:'NO_COMPARISON',firstCandidateId:first?.candidateId ?? null,
    secondCandidateId:null,paretoRankDifference:null,unknownCountDifference:null,
    objectiveMargins:[],selectionAuthority:false };
  const firstObjectives = objectives(first);
  const secondObjectives = objectives(second);
  const names = first.action === 'OPEN_CSP'
    ? ['grossPremium','collateral','spreadPct','downsideCushion']
    : first.action === 'OPEN_DEFINED_RISK' ? ['maxProfit','maxLoss','spreadPct']
      : first.action === 'SELL_CC' ? ['grossPremium','spreadPct','retainedUpside'] : [];
  const objectiveMargins = firstObjectives.map((objective, index) => {
    const other = secondObjectives[index]?.value ?? null;
    return { name:names[index] ?? `objective_${index}`, first:objective.value,second:other,
      difference:objective.value === null || other === null ? null : objective.value - other };
  });
  const paretoRankDifference = (second.paretoRank ?? Number.MAX_SAFE_INTEGER)
    - (first.paretoRank ?? Number.MAX_SAFE_INTEGER);
  const unknownCountDifference = second.unknownEvidence.length - first.unknownEvidence.length;
  const identityOnly = paretoRankDifference === 0 && unknownCountDifference === 0;
  const exactObjectives = firstObjectives.length === secondObjectives.length
    && objectiveMargins.every((margin) => margin.difference === 0);
  return { state:identityOnly ? exactObjectives ? 'EXACT_TIE' : 'NEAR_TIE' : 'CLEAR_WINNER',
    firstCandidateId:first.candidateId,secondCandidateId:second.candidateId,
    paretoRankDifference,unknownCountDifference,objectiveMargins,selectionAuthority:false };
}

function rankCandidates(candidates: readonly CanonicalFrontierCandidate[]): readonly CanonicalFrontierCandidate[] {
  type Entry = { readonly candidate: CanonicalFrontierCandidate; readonly vector: ParetoVector };
  const groups = new Map<string, Entry[]>();
  const vectors = new Map<CanonicalFrontierCandidate, ParetoVector>();
  for (const candidate of candidates) {
    if (!candidate.riskFeasible) continue;
    const key = `${candidate.branch}:${candidate.action}`;
    const group = groups.get(key) ?? [];
    const vector = paretoVector(candidate);
    group.push({ candidate, vector });
    vectors.set(candidate, vector);
    groups.set(key, group);
  }
  for (const group of groups.values()) group.sort((a, b) => a.candidate.candidateId.localeCompare(b.candidate.candidateId));
  return candidates.map((candidate) => {
    if (!candidate.riskFeasible) return candidate;
    const group = groups.get(`${candidate.branch}:${candidate.action}`) ?? [];
    const vector = vectors.get(candidate) ?? [];
    const dominatedBy: string[] = [];
    let dominatedByCount = 0;
    for (const other of group) {
      if (other.candidate.candidateId === candidate.candidateId || !dominatesVector(other.vector, vector)) continue;
      dominatedByCount++;
      if (dominatedBy.length < maxDominanceWitnessesPerCandidate) dominatedBy.push(other.candidate.candidateId);
    }
    const omitted = dominatedByCount - dominatedBy.length;
    return { ...candidate, paretoRank: dominatedByCount + 1, dominatedBy,
      ...(omitted > 0 ? { dominatedByOmittedCount: omitted } : {}) };
  }).toSorted(candidateRankOrder);
}

// Stable, deterministic, secret-safe failure identity for a branch-local
// construction exception. Never includes wall-clock time (the canonical
// frontier is hashed via canonicalStrategyFrontierContentHash and must be
// deterministic for the same immutable input) and never persists the raw
// `error.message` into canonical output (an arbitrary exception message
// could contain a provider payload fragment, filesystem path, or other
// diagnostic detail not vetted for a canonical decision receipt). The raw
// message must also stay out of operational logs. Log the same bounded
// identity so a provider exception cannot disclose credentials there.
function stableBranchFailureReasonCode(error: unknown): string {
  if (error instanceof Error && error.message === 'CONFLICTING_CONTRACT_OBSERVATIONS')
    return error.message;
  const standardClasses = new Set(['Error','TypeError','RangeError','SyntaxError','ReferenceError','URIError','AggregateError']);
  const errorClassName = error instanceof Error
    ? standardClasses.has(error.constructor.name) ? error.constructor.name : 'Error'
    : 'UnknownThrowValue';
  return `BRANCH_CONSTRUCTION_ERROR_TYPE:${errorClassName}`;
}

/** Provider pagination and joined feeds can repeat an exact contract. One
 * OCC symbol must produce at most one alternative. A conflicting duplicate
 * needs an upstream revision decision, so fail this branch closed instead of
 * choosing by provider order or counting two different quotes as two ideas. */
function uniqueContractObservations(contracts: readonly NormalizedOptionContract[]): readonly NormalizedOptionContract[] {
  const bySymbol = new Map<string, NormalizedOptionContract>();
  for (const contract of contracts) {
    const prior = bySymbol.get(contract.optionSymbol);
    if (prior === undefined) bySymbol.set(contract.optionSymbol, contract);
    else if (!isDeepStrictEqual(prior, contract)) throw new Error('CONFLICTING_CONTRACT_OBSERVATIONS');
  }
  return [...bySymbol.values()];
}

function buildBranch(
  branch: ThetaStrategyBranch, input: CanonicalStrategyFrontierInput,
  sharedRoutingResults: readonly StrategyRoutingResponse['results'][number][] | null,
  sharedStockShares: number | null | 'ABSENT',
): CanonicalBranchFrontier {
  const source = sourceByBranch.get(branch);
  if (source === undefined) throw new Error(`CANONICAL_STRATEGY_SOURCE_MISSING:${branch}`);
  const route = sharedRoutingResults?.find((result) => result.strategyFamily === familyByBranch[branch]) ?? null;
  const stockApplicable = (branch === 'THETA_RECOVERY' || branch === 'THETA_CC') && sharedStockShares !== 'ABSENT'
    && (sharedStockShares === null || sharedStockShares > 0);
  const applicable = stockApplicable || route?.eligible === true;
  const routeReasons = route?.reasons.map((reason) => reason.code) ?? (sharedRoutingResults === null ? ['ROUTER_RESULT_UNKNOWN'] : ['ROUTER_FAMILY_MISSING']);
  const enumerateInapplicableResearch = branch === 'THETA_HOLD_STRIKE' || branch === 'THETA_DEFINED_RISK';
  if (!applicable && !enumerateInapplicableResearch) return {
    branch, strategyVersion: source.strategyVersion, status: source.status as 'RESEARCH_ONLY' | 'SHADOW', applicable: false,
    evaluated: true, routeReasons, evaluationState: 'NOT_APPLICABLE', candidateCount: 0, mechanicallyRejected: 0, enumerationTruncated: false,
    hardVetoed: 0, softRanked: 0, dataInsufficient: 0, candidates: [], bestCandidateId: null,
    secondBestCandidateId: null, bestRejectedCandidateId: null, empiricalEconomicsReady: false, executionAuthorized: false,
  };

  // Only the branch-specific candidate-construction/ranking work below is
  // fault-isolated. `applicable`/`route`/`routeReasons`/`source` above are
  // already computed from the caller's pre-hoisted shared reads and are
  // known-safe by this point -- so a failure inside this block is
  // genuinely branch-local, and the failure receipt below can truthfully
  // report the REAL `applicable` value already established above (e.g. a
  // THETA_RECOVERY branch that WAS genuinely applicable because real stock
  // exists, but whose candidate construction then failed, must not be
  // misreported as inapplicable -- that would silently corrupt
  // `managementAuthorityRequired` at the caller).
  try {
    let raw: CanonicalFrontierCandidate[] = [];
    let enumerationTruncated = false;
    if (branch === 'THETA_CONVENTIONAL' || branch === 'THETA_HOLD_STRIKE') {
      raw = uniqueContractObservations(input.contracts.filter((contract) => contract.optionType === 'PUT'
        && contract.dte >= source.lattice.dteMin && contract.dte <= source.lattice.dteMax))
        .map((contract) => singleLegPutCandidate(branch, contract, input));
    } else if (branch === 'THETA_DEFINED_RISK') {
      // The bounded research enumeration must not depend on provider page
      // order. A provider reorder must retain the same 1,000 structures and
      // the same incomplete-enumeration receipt.
      const puts = uniqueContractObservations(input.contracts.filter((contract) => contract.optionType === 'PUT'
        && contract.dte >= source.lattice.dteMin && contract.dte <= source.lattice.dteMax))
        .toSorted((a, b) => a.expiration.localeCompare(b.expiration) || a.strike - b.strike
          || a.optionSymbol.localeCompare(b.optionSymbol));
      outer: for (const shortPut of puts) for (const longPut of puts) {
        if (shortPut.expiration === longPut.expiration && longPut.strike < shortPut.strike) {
          if (raw.length >= maxDefinedRiskStructuresPerCycle) { enumerationTruncated = true; break outer; }
          raw.push(definedRiskCandidate(shortPut, longPut, input));
        }
      }
    } else if (branch === 'THETA_RECOVERY' && input.stock !== null) {
      const ccAlternatives = uniqueContractObservations(input.contracts.filter((contract) => contract.optionType === 'CALL'
        && contract.dte >= 1 && contract.dte <= 60))
        .map((contract) => {
          const candidate = coveredCallCandidate(contract, input);
          return { ...candidate, candidateId: `THETA_RECOVERY:${contract.optionSymbol}:SELL_CC`,
            branch: 'THETA_RECOVERY' as const, action: 'SELL_CC' as const };
        });
      raw = [stockActionCandidate('RECOVERY_WAIT', input), stockActionCandidate('SELL_STOCK', input), ...ccAlternatives];
    } else if (branch === 'THETA_CC' && input.stock !== null) {
      raw = uniqueContractObservations(input.contracts.filter((contract) => contract.optionType === 'CALL'
        && contract.dte >= source.lattice.dteMin && contract.dte <= source.lattice.dteMax))
        .map((contract) => coveredCallCandidate(contract, input));
    }
    // Counterfactual research records retain the contract and economics even
    // when the router says this branch is not applicable. The router verdict
    // remains a hard blocker, so such rows cannot become Paper actions.
    const candidates = rankCandidates(applicable ? raw : raw.map((candidate) => ({
      ...candidate, hardBlockers: [...candidate.hardBlockers, 'ROUTER_NOT_APPLICABLE'],
      riskFeasible: false, executionAuthorized: false,
      sizing: { ...candidate.sizing, quantity: 0, bindingConstraint: 'ROUTER_NOT_APPLICABLE', reasons: [...candidate.sizing.reasons, 'ROUTER_NOT_APPLICABLE'],
        ...(candidate.sizing.waterfall === undefined ? {} : { waterfall: {
          ...candidate.sizing.waterfall, capitalBudget: { ...candidate.sizing.waterfall.capitalBudget,
            finalCapitalBudget: { value: 0, state: 'KNOWN' as const, reason: 'ROUTER_NOT_APPLICABLE' } },
        } }),
      },
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
  } catch (error) {
    // Real operational visibility, out-of-band from the deterministic
    // canonical receipt -- never a silent catch{}. Console output is not
    // hashed and does not need to be deterministic across replays.
    console.error(`[canonical-strategy-frontier] branch construction failed`, {
      branch, errorCode: stableBranchFailureReasonCode(error),
      failedAt: new Date().toISOString(),
    });
    return {
      branch, strategyVersion: source.strategyVersion, status: source.status as 'RESEARCH_ONLY' | 'SHADOW',
      // Truthful: this branch WAS applicable (or not) per the same
      // already-computed value used by every other path above -- a failed
      // construction attempt for a genuinely applicable branch must not be
      // silently reported as inapplicable.
      applicable, evaluated: true,
      routeReasons: [...routeReasons, 'BRANCH_CONSTRUCTION_EXCEPTION', stableBranchFailureReasonCode(error)],
      evaluationState: 'BRANCH_CONSTRUCTION_FAILED', candidateCount: 0, mechanicallyRejected: 0, enumerationTruncated: false,
      hardVetoed: 0, softRanked: 0, dataInsufficient: 0, candidates: [], bestCandidateId: null,
      secondBestCandidateId: null, bestRejectedCandidateId: null, empiricalEconomicsReady: false, executionAuthorized: false,
    };
  }
}

export function buildCanonicalStrategyFrontier(input: CanonicalStrategyFrontierInput): CanonicalStrategyFrontier {
  // Read the shared routing-result array exactly once, outside any
  // per-branch fault boundary: every branch reads the identical underlying
  // object, so a failure here is a genuinely global/shared-state fault
  // (per Phase 2's fault-domain rule) and must remain a hard, visible
  // failure rather than being isolated away as if it were branch-specific.
  const sharedRoutingResults = input.routing?.results ?? null;
  // Whether stock exists (and how many shares) is safety-relevant shared
  // account state -- every branch that checks stock applicability reads the
  // identical underlying field, and getting this wrong would silently make
  // `managementAuthorityRequired` (below) incorrect. Read it once, outside
  // any per-branch fault boundary, same as the routing read above.
  const sharedStockShares: number | null | 'ABSENT' = input.stock === null ? 'ABSENT' : input.stock.shares;
  // Every branch-LOCAL construction failure (candidate enumeration,
  // ranking, deeper economics) is now caught and truthfully reported
  // inside buildBranch itself (THETA-CANONICAL-FRONTIER-NO-PER-BRANCH-
  // ISOLATION). `CANONICAL_STRATEGY_SOURCE_MISSING` deliberately still
  // propagates as a hard, uncaught failure here: it represents a genuine
  // source/deployment-config integrity gap (a branch present in
  // `branchOrder` with no matching entry in `canonicalThetaStrategySources`
  // at all) -- a systemic misconfiguration, not a transient per-cycle
  // branch fault, and correctly invalidates the whole frontier rather than
  // being silently isolated away.
  const branches = branchOrder.map((branch) => buildBranch(branch, input, sharedRoutingResults, sharedStockShares));
  const applicable = branches.filter((branch) => branch.applicable);
  // A branch that was applicable but whose construction failed was
  // genuinely CONSIDERED (it remains in `applicable` above, truthfully) but
  // was not genuinely EVALUATED -- no real candidates/economics exist for
  // it this cycle. Treat it the same as BLOCKED_MISSING_INPUT for this
  // purpose: visible as considered, excluded from "successfully evaluated."
  const evaluated = applicable.filter((branch) => branch.evaluated
    && branch.evaluationState !== 'BLOCKED_MISSING_INPUT' && branch.evaluationState !== 'BRANCH_CONSTRUCTION_FAILED');
  // Each branch already computed exact same-branch/action dominance. Cross-
  // branch dominance is deliberately undefined, so a second full Pareto pass
  // here can only repeat the work and previously doubled large-chain cost.
  const globallyRanked = branches.flatMap((branch) => branch.candidates).toSorted(candidateRankOrder);
  const feasible = globallyRanked.filter((candidate) => candidate.riskFeasible);
  // Shadow/research incompleteness stays visible in its branch receipt. It
  // cannot veto or relabel the bounded Conventional Paper decision.
  // If Q's OWN construction failed (not merely a shadow/research branch),
  // that must never be silently treated as "Q was fully evaluated, WAIT is
  // earned" -- a genuine Q construction failure is exactly as blocking as
  // BLOCKED_MISSING_INPUT for this specific safety check.
  const blockedApplicable = applicable.filter((branch) => branch.branch === 'THETA_CONVENTIONAL'
    && (branch.evaluationState === 'BLOCKED_MISSING_INPUT' || branch.evaluationState === 'BRANCH_CONSTRUCTION_FAILED'));
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
  const entrySelectionBasis = structuralSelection === null ? 'NO_SELECTION' as const
    : decision === undefined ? 'STRUCTURAL_RESEARCH_ONLY' as const : 'THETA_Q_DECISION_BOUND' as const;
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
    candidate.sizing.quantity === 0 && (['AEGIS_UNKNOWN', 'AEGIS_NOT_REACHED_UPSTREAM', 'SIZING_POLICY_INCOMPLETE', 'SIZING_POLICY_INVALID',
      'COLLATERAL_INPUT_UNKNOWN', 'REDUCED_MULTIPLIER_UNKNOWN', 'UNKNOWN_STOCK_CAPACITY',
      'COVERED_SHARES_UNKNOWN', 'SIZING_CAPACITY_INVALID', 'STOCK_CAPACITY_INVALID']
      .includes(candidate.sizing.bindingConstraint)
      // An AEGIS family reason such as LIQUIDITY:SPREAD_WIDENING_UNKNOWN means a required input was unknown, so the
      // zero is missing evidence, not an economic or risk finding: it must not be able to earn a GLOBAL_WAIT.
      || unknownCodedReason.test(candidate.sizing.bindingConstraint)));
  const paperBranch = branches.find((branch) => branch.branch === 'THETA_CONVENTIONAL');
  const paperBranchEvaluated = paperBranch?.applicable === true && paperBranch.evaluationState === 'EVALUATED';
  const qEvaluationRequired = input.thetaQCandidateEvaluationByOptionSymbol !== undefined || decision !== undefined;
  const incompleteReasonCounts: Record<string, number> = {};
  for (const candidate of paperCandidates) {
    if (!qEvaluationRequired) continue;
    const symbol = candidate.legs[0]?.optionSymbol;
    const evaluation = symbol === undefined ? undefined : input.thetaQCandidateEvaluationByOptionSymbol?.[symbol];
    if (evaluation?.state === 'EVALUATED_FEASIBLE' || evaluation?.state === 'EVALUATED_INFEASIBLE') continue;
    // An upstream safety/data rejection blocks this candidate's execution,
    // but does not prove its economic inferiority. In particular, the
    // refresh budget and a missing Q response cannot earn GLOBAL_WAIT.
    const reason = evaluation === undefined ? 'EVALUATION_STATE_MISSING'
      : evaluation.reasonCode === 'NOT_SELECTED_FOR_FINALIST_REFRESH'
        ? (evaluation.accountPolicyIncompatibility === undefined ? 'NOT_EVALUATED_SHORTLIST_BOUND' : accountPolicyIncompatibilityBlocker)
      : `${evaluation.state}:${evaluation.reasonCode ?? 'NO_RESPONSE'}`;
    incompleteReasonCounts[reason] = (incompleteReasonCounts[reason] ?? 0) + 1;
  }
  const notEvaluatedCount = Object.values(incompleteReasonCounts).reduce((sum, count) => sum + count, 0);
  const paperEvaluationCoverage = {
    state: !qEvaluationRequired ? 'STRUCTURAL_ONLY' as const : notEvaluatedCount > 0 ? 'INCOMPLETE' as const : 'COMPLETE' as const,
    candidateCount: paperCandidates.length,
    evaluatedCount: qEvaluationRequired ? paperCandidates.length - notEvaluatedCount : 0,
    notEvaluatedCount,
    incompleteReasonCounts: Object.fromEntries(Object.entries(incompleteReasonCounts).sort(([a], [b]) => a.localeCompare(b))),
  };
  const globalWaitEarned = !managementAuthorityRequired && paperBranchEvaluated && blockedApplicable.length === 0
    && !managementIncomplete && !universeIncomplete && sizingEvidenceUnknown.length === 0
    && notEvaluatedCount === 0 && !decisionInvalid && structuralSelection === null;
  const partial = {
    contractVersion: canonicalStrategyFrontierVersion, snapshotId: input.snapshotId, timestamp: input.timestamp,
    strategyVersion: input.strategyVersion, decisionAuthorityVersion: canonicalDecisionAuthorityVersion,
    branches, branchesConsidered: applicable.map((branch) => branch.branch),
    branchesEvaluated: evaluated.map((branch) => branch.branch), selectedBranch: structuralSelection?.branch ?? null,
    selectedCandidateId: structuralSelection?.candidateId ?? null,
    entrySelectionBasis,
    primaryAction: managementAuthorityRequired ? 'MANAGEMENT_AUTHORITY' as const
      : structuralSelection?.action ?? (globalWaitEarned ? 'GLOBAL_WAIT' as const : 'SYSTEM_HOLD' as const),
    selectedQuantity,
    empiricalUtilityState: 'UNKNOWN_NOT_YET_CALIBRATED' as const,
    secondBestCandidateId: secondBest?.candidateId ?? null,
    structuralTopTwo: describeStructuralTopTwo(sizedNewRisk),
    nearMissCandidateId: nearMiss?.candidateId ?? null,
    bestRejectedCandidateId: rejected[0]?.candidateId ?? null,
    paperEvaluationCoverage,
    globalWaitEarned, globalWaitReasons: globalWaitEarned ? ['PAPER_AUTHORIZED_BRANCH_EVALUATED',
      decision !== undefined ? `THETA_Q_ECONOMIC_${decision.winningAction}` : 'NO_RISK_FEASIBLE_ACTION']
      : [...blockedApplicable.map((branch) => `BRANCH_NOT_FULLY_EVALUATED:${branch.branch}`),
          ...Object.entries(paperEvaluationCoverage.incompleteReasonCounts)
            .map(([reason, count]) => `PAPER_CANDIDATE_EVALUATION_INCOMPLETE:${reason}:${count}`),
          ...(!paperBranch?.applicable ? ['PAPER_BRANCH_NOT_APPLICABLE'] : []),
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
