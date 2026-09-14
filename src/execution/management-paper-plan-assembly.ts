import { z } from 'zod';
import type { ManagementActionFrontier, ManagementFrontierAction } from '../theta/management-action-frontier.js';
import type { ManagementInputState } from '../theta/management-input-state.js';
import { deterministicRuntimeUuid } from '../theta/postgres-theta-cycle-store.js';
import { applyPaperEvidenceRiskCap } from './execution-authorization-tier.js';
import { masterPaperActionPlanVersion, type ApprovedMasterPaperActionPlan } from './master-paper-action-handoff.js';
import type { ThetaOrderAction } from './order-construction.js';

export const managementPaperPlanAssemblyVersion = 'theta-management-paper-plan-assembly-v1' as const;

export interface ManagementExecutionLegDirective {
  readonly action: ThetaOrderAction;
  readonly symbol: string;
  readonly optionContractId: string | null;
  readonly optionType: 'PUT' | 'CALL' | null;
  readonly multiplier: number;
  readonly canonicalQuantity: number;
  readonly economicBoundary: number;
  readonly economicsRemainPositive: boolean;
  readonly expectedAfterCostEv: number | null;
  readonly empiricalEconomicsReady: boolean;
  readonly confirmedCoveredShares?: number;
}

export interface ManagementPaperPlanAssemblyInput {
  readonly state: ManagementInputState;
  readonly frontier: ManagementActionFrontier;
  readonly managementActionFrontierId: string;
  readonly executionAccountId: string | null;
  readonly strategyVersion: string | null;
  readonly accountStatus: string | null;
  readonly optionsCapabilityVerified: boolean;
  readonly aegisState: 'ALLOW_FULL' | 'ALLOW_REDUCED' | 'HOLD_ONLY' | 'HARD_VETO' | null;
  readonly killSwitchActive: boolean;
  readonly paperEvidenceRiskCap: number;
  readonly executionLegs: readonly ManagementExecutionLegDirective[];
  readonly now: string;
  readonly decisionExpiresAt: string;
}

export interface ManagementDecisionDraft {
  readonly decisionId: string;
  readonly decisionKind: 'MANAGEMENT';
  readonly actionCode: ManagementFrontierAction;
  readonly quantity: number;
  readonly aegisAction: 'ALLOW_FULL' | 'ALLOW_REDUCED' | 'HOLD_ONLY' | 'HARD_VETO';
  readonly strategyVersion: string;
  readonly authorityRef: string;
  readonly decidedAt: string;
  readonly reasonCodes: readonly string[];
}

export type ManagementPaperPlanAssemblyResult =
  | { readonly state: 'NO_BROKER_ACTION'; readonly decision: null; readonly plans: readonly []; readonly blockers: readonly string[] }
  | { readonly state: 'BLOCKED'; readonly decision: null; readonly plans: readonly []; readonly blockers: readonly string[] }
  | { readonly state: 'READY'; readonly decision: ManagementDecisionDraft; readonly plans: readonly ApprovedMasterPaperActionPlan[]; readonly blockers: readonly [] };

const passiveActions = new Set<ManagementFrontierAction>([
  'HOLD', 'LET_EXPIRE', 'ACCEPT_ASSIGNMENT', 'RECOVERY_WAIT', 'HOLD_CC', 'ALLOW_CALL_AWAY',
]);

export const managementOrderActions: Readonly<Partial<Record<ManagementFrontierAction, readonly ThetaOrderAction[]>>> = {
  CLOSE_FULL: ['CLOSE_CSP'],
  ROLL: ['ROLL_CSP_CLOSE', 'ROLL_CSP_OPEN'],
  SELL_STOCK: ['SELL_STOCK'],
  SELL_CC: ['OPEN_CC'],
  CLOSE_CC: ['CLOSE_CC'],
  ROLL_CC: ['ROLL_CC_CLOSE', 'ROLL_CC_OPEN'],
};

const opensRisk = new Set<ThetaOrderAction>(['OPEN_CSP', 'ROLL_CSP_OPEN', 'OPEN_CC', 'ROLL_CC_OPEN']);
const closesCurrentOption = new Set<ThetaOrderAction>(['CLOSE_CSP', 'ROLL_CSP_CLOSE', 'CLOSE_CC', 'ROLL_CC_CLOSE']);
const uuid = z.string().uuid();

const adaptivePricingPolicy = Object.freeze({
  waitIntervalMs: 5_000,
  maxAttempts: 3,
  concessionFractions: [0, 0.5, 1] as const,
  tickSize: 0.01,
});

function validateLegIdentity(state: ManagementInputState, leg: ManagementExecutionLegDirective, blockers: string[]): void {
  if (!Number.isInteger(leg.canonicalQuantity) || leg.canonicalQuantity <= 0) blockers.push(`LEG_QUANTITY_INVALID:${leg.action}`);
  if (!Number.isInteger(leg.multiplier) || leg.multiplier <= 0) blockers.push(`LEG_MULTIPLIER_INVALID:${leg.action}`);
  if (!Number.isFinite(leg.economicBoundary) || leg.economicBoundary <= 0) blockers.push(`ECONOMIC_BOUNDARY_INVALID:${leg.action}`);
  if (!leg.economicsRemainPositive) blockers.push(`FORWARD_ECONOMICS_NOT_POSITIVE:${leg.action}`);
  if (closesCurrentOption.has(leg.action)) {
    if (leg.symbol !== state.contract.symbol || leg.optionContractId !== state.contract.optionContractId) {
      blockers.push(`CLOSE_LEG_CONTRACT_MISMATCH:${leg.action}`);
    }
    if (leg.optionType !== state.contract.optionType || leg.multiplier !== state.contract.multiplier) {
      blockers.push(`CLOSE_LEG_CONTRACT_TERMS_MISMATCH:${leg.action}`);
    }
    if (leg.canonicalQuantity !== state.contract.contracts) blockers.push(`CLOSE_LEG_QUANTITY_MISMATCH:${leg.action}`);
  }
  if (leg.action === 'SELL_STOCK') {
    if (leg.symbol !== state.underlying || leg.optionContractId !== null || leg.optionType !== null || leg.multiplier !== 1) {
      blockers.push('STOCK_EXIT_IDENTITY_INVALID');
    }
    if (leg.canonicalQuantity !== state.economics.openStockShares) blockers.push('STOCK_EXIT_QUANTITY_MISMATCH');
  }
  if (leg.action === 'OPEN_CC' || leg.action === 'ROLL_CC_OPEN') {
    if (leg.optionType !== 'CALL' || leg.optionContractId === null) blockers.push(`COVERED_CALL_CONTRACT_INVALID:${leg.action}`);
    const coveredShares = leg.confirmedCoveredShares ?? 0;
    if (coveredShares !== state.economics.openStockShares || coveredShares < leg.canonicalQuantity * leg.multiplier) {
      blockers.push(`COVERED_CALL_COVERAGE_INVALID:${leg.action}`);
    }
  }
  if (leg.action === 'ROLL_CSP_OPEN' && (leg.optionType !== 'PUT' || leg.optionContractId === null)) {
    blockers.push('ROLL_CSP_TARGET_INVALID');
  }
}

/**
 * Converts a persisted, explicitly selected management frontier into one or
 * two durable Paper plans. It never selects an action, target contract,
 * quantity, or price boundary. Missing policy evidence blocks publication.
 */
export function assembleManagementPaperPlans(input: ManagementPaperPlanAssemblyInput): ManagementPaperPlanAssemblyResult {
  const selected = input.frontier.selectedAction;
  if (selected === null) return { state: 'NO_BROKER_ACTION', decision: null, plans: [], blockers: ['NO_MANAGEMENT_ACTION_SELECTED'] };
  if (passiveActions.has(selected)) {
    return { state: 'NO_BROKER_ACTION', decision: null, plans: [], blockers: [`MANAGEMENT_ACTION_${selected}`] };
  }
  if (selected === 'REDEPLOY') {
    return { state: 'BLOCKED', decision: null, plans: [], blockers: ['REDEPLOY_REQUIRES_RESOLVED_EXIT_AND_NEW_RISK_SELECTION'] };
  }
  const selectedEconomics = input.frontier.actions.find((action) => action.action === selected);
  const blockers: string[] = [];
  if (input.frontier.chainId !== input.state.chainId) blockers.push('MANAGEMENT_FRONTIER_CHAIN_MISMATCH');
  if (input.frontier.decisionState !== 'ACTION_SELECTED') blockers.push('MANAGEMENT_ACTION_NOT_SELECTED_BY_AUTHORITY');
  blockers.push(...input.state.hardBlockers.map((blocker) => `MANAGEMENT_STATE_BLOCKER:${blocker}`));
  if (selectedEconomics === undefined) blockers.push('SELECTED_MANAGEMENT_ACTION_NOT_IN_FRONTIER');
  else {
    if (selectedEconomics.feasibility !== 'FEASIBLE') blockers.push('SELECTED_MANAGEMENT_ACTION_NOT_FEASIBLE');
    blockers.push(...selectedEconomics.blockers.map((blocker) => `MANAGEMENT_ACTION_BLOCKER:${blocker}`));
  }
  if (input.state.fusionSnapshotId === null) blockers.push('MANAGEMENT_FUSION_SNAPSHOT_MISSING');
  if (input.executionAccountId === null) blockers.push('MASTER_EXECUTION_ACCOUNT_NOT_CREATED');
  if (input.strategyVersion === null || !input.strategyVersion.trim()) blockers.push('STRATEGY_VERSION_MISSING');
  if (input.accountStatus !== 'ACTIVE') blockers.push('MASTER_ACCOUNT_NOT_ACTIVE');
  if (input.aegisState === null) blockers.push('AEGIS_SELECTION_LINEAGE_MISSING');
  if (input.aegisState === 'HARD_VETO') blockers.push('AEGIS_HARD_VETO');
  if (input.killSwitchActive) blockers.push('KILL_SWITCH_ACTIVE');
  if (!Number.isFinite(Date.parse(input.now)) || !Number.isFinite(Date.parse(input.decisionExpiresAt))
    || Date.parse(input.decisionExpiresAt) <= Date.parse(input.now)) blockers.push('DECISION_EXPIRY_INVALID');
  if (!uuid.safeParse(input.managementActionFrontierId).success) blockers.push('MANAGEMENT_FRONTIER_ID_INVALID');
  if (!uuid.safeParse(input.state.managementInputSnapshotId).success) blockers.push('MANAGEMENT_INPUT_ID_INVALID');
  if (!uuid.safeParse(input.state.underlyingId).success) blockers.push('UNDERLYING_ID_INVALID');

  const required = managementOrderActions[selected] ?? [];
  if (required.length === 0) blockers.push(`MANAGEMENT_ACTION_NOT_CONNECTED:${selected}`);
  if (input.executionLegs.length !== required.length
    || input.executionLegs.some((leg, index) => leg.action !== required[index])) blockers.push('MANAGEMENT_EXECUTION_LEG_SEQUENCE_INVALID');
  for (const leg of input.executionLegs) {
    validateLegIdentity(input.state, leg, blockers);
    if (leg.action !== 'SELL_STOCK' && !input.optionsCapabilityVerified) blockers.push(`OPTIONS_CAPABILITY_NOT_VERIFIED:${leg.action}`);
    if (opensRisk.has(leg.action) && !['ALLOW_FULL', 'ALLOW_REDUCED'].includes(input.aegisState ?? '')) {
      blockers.push(`AEGIS_NOT_APPROVED_FOR_NEW_RISK:${leg.action}`);
    }
    if (opensRisk.has(leg.action) && (!leg.empiricalEconomicsReady || leg.expectedAfterCostEv === null || leg.expectedAfterCostEv <= 0)) {
      blockers.push(`EMPIRICAL_ACTION_EV_UNKNOWN:${leg.action}`);
    }
  }
  if (required.length === 2) {
    const close = input.executionLegs[0], open = input.executionLegs[1];
    if (close !== undefined && open !== undefined && open.canonicalQuantity > close.canonicalQuantity) {
      blockers.push('ROLL_OPEN_QUANTITY_EXCEEDS_CLOSE');
    }
  }
  if (blockers.length > 0 || input.executionAccountId === null || input.strategyVersion === null || input.aegisState === null) {
    return { state: 'BLOCKED', decision: null, plans: [], blockers: [...new Set(blockers)] };
  }

  const authorityRef = `management:${input.managementActionFrontierId}:${selected}`;
  const decisionId = deterministicRuntimeUuid(`management-decision:${authorityRef}`);
  const actionGroupId = deterministicRuntimeUuid(`management-action-group:${authorityRef}`);
  const planIds = input.executionLegs.map((leg, index) => deterministicRuntimeUuid(
    `management-plan:${authorityRef}:${index + 1}:${leg.action}:${leg.symbol}`,
  ));
  const plans = input.executionLegs.map((leg, index): ApprovedMasterPaperActionPlan => {
    const sizing = opensRisk.has(leg.action)
      ? applyPaperEvidenceRiskCap(leg.canonicalQuantity, input.paperEvidenceRiskCap)
      : applyPaperEvidenceRiskCap(leg.canonicalQuantity, leg.canonicalQuantity);
    return {
      contractVersion: masterPaperActionPlanVersion,
      actionPlanId: planIds[index] as string,
      decisionAuthority: 'MANAGEMENT',
      managementInputSnapshotId: input.state.managementInputSnapshotId,
      managementActionFrontierId: input.managementActionFrontierId,
      actionGroupId,
      legSequence: index + 1,
      dependsOnActionPlanId: index === 0 ? null : planIds[index - 1] as string,
      executionAccountId: input.executionAccountId as string,
      decisionId,
      candidateId: authorityRef,
      strategyVersion: input.strategyVersion as string,
      chainId: input.state.chainId,
      optionContractId: leg.optionContractId,
      underlyingId: input.state.underlyingId,
      underlying: input.state.underlying,
      optionType: leg.optionType,
      symbol: leg.symbol,
      quantity: sizing.paperEvidenceQuantity,
      ...sizing,
      executionTier: opensRisk.has(leg.action) ? 'EMPIRICALLY_PROMOTED_PAPER' : 'PAPER_EVIDENCE',
      multiplier: leg.multiplier,
      ...(leg.confirmedCoveredShares === undefined ? {} : { confirmedCoveredShares: leg.confirmedCoveredShares }),
      action: leg.action,
      economicBoundary: leg.economicBoundary,
      economicsRemainPositive: leg.economicsRemainPositive,
      expectedAfterCostEv: leg.expectedAfterCostEv,
      empiricalEconomicsReady: leg.empiricalEconomicsReady,
      selectedByCanonicalAuthority: true,
      hardValidityPassed: true,
      accountVerified: true,
      optionsCapabilityVerified: input.optionsCapabilityVerified,
      noEquivalentExposureConflict: true,
      aegisState: input.aegisState as ManagementDecisionDraft['aegisAction'],
      killSwitchActive: false,
      decisionExpiresAt: input.decisionExpiresAt,
      pricingPolicy: adaptivePricingPolicy,
      pricingAttempt: 0,
      previousLimit: null,
    };
  });
  if (plans.some((plan) => plan.quantity <= 0)) {
    return { state: 'BLOCKED', decision: null, plans: [], blockers: ['MANAGEMENT_PLAN_QUANTITY_ZERO'] };
  }
  return {
    state: 'READY', blockers: [], plans,
    decision: {
      decisionId, decisionKind: 'MANAGEMENT', actionCode: selected,
      quantity: plans[0]?.canonicalQuantity ?? 0,
      aegisAction: input.aegisState as ManagementDecisionDraft['aegisAction'],
      strategyVersion: input.strategyVersion,
      authorityRef, decidedAt: input.now,
      reasonCodes: input.frontier.reasonCodes,
    },
  };
}
