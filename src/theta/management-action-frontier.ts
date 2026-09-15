import { hashJson, type JsonValue } from '../market/fusion-snapshot.js';
import type { ManagementInputState } from './management-input-state.js';

export const managementActionFrontierVersion = 'theta-management-action-frontier-v2' as const;
export const managementPolicyEvidenceVersion = 'theta-management-policy-evidence-v1' as const;

export type ManagementFrontierAction =
  | 'HOLD' | 'CLOSE_FULL' | 'ROLL' | 'LET_EXPIRE' | 'ACCEPT_ASSIGNMENT' | 'REDEPLOY'
  | 'RECOVERY_WAIT' | 'SELL_STOCK' | 'SELL_CC'
  | 'HOLD_CC' | 'CLOSE_CC' | 'ROLL_CC' | 'ALLOW_CALL_AWAY';

export interface ManagementActionEconomics {
  readonly action: ManagementFrontierAction;
  readonly requiredOptionPositionIntents: readonly ('SELL_TO_OPEN' | 'BUY_TO_CLOSE' | 'SELL_TO_CLOSE' | 'BUY_TO_OPEN')[];
  readonly feasibility: 'FEASIBLE' | 'INFEASIBLE' | 'UNKNOWN';
  readonly expectedFutureValue: number | null;
  readonly certainEconomicPnl: number | null;
  readonly downsideTailEstimate: number | null;
  readonly incrementalCapitalDays: number | null;
  readonly executionCostRisk: number | null;
  readonly opportunityCost: number | null;
  readonly assignmentInventoryConsequence: string | null;
  readonly uncertainty: number | null;
  readonly utility: number | null;
  readonly executionEvidence: ManagementActionExecutionEvidence | null;
  readonly reasons: readonly string[];
  readonly blockers: readonly string[];
}

export interface ManagementActionExecutionEvidence {
  readonly closeEconomicBoundary: number | null;
  readonly openEconomicBoundary: number | null;
  readonly stockEconomicBoundary: number | null;
  readonly economicsRemainPositive: boolean;
  readonly expectedAfterCostEv: number | null;
  readonly empiricalEconomicsReady: boolean;
  readonly targetContract: {
    readonly symbol: string;
    readonly optionContractId: string;
    readonly optionType: 'PUT' | 'CALL';
    readonly multiplier: number;
    readonly quantity: number;
  } | null;
}

export interface ManagementPolicyActionValue {
  readonly action: ManagementFrontierAction;
  readonly expectedFutureValue: number | null;
  readonly downsideTailEstimate: number | null;
  readonly incrementalCapitalDays: number | null;
  readonly executionCostRisk: number | null;
  readonly opportunityCost: number | null;
  readonly uncertainty: number | null;
  readonly utility: number | null;
  readonly executionEvidence: ManagementActionExecutionEvidence | null;
  readonly reasons: readonly string[];
}

export interface ManagementPolicyEvidence {
  readonly contractVersion: typeof managementPolicyEvidenceVersion;
  readonly inputContentHash: string;
  readonly decidedAt: string;
  readonly policyVersion: string;
  readonly comparisonComplete: boolean;
  readonly selectedAction: ManagementFrontierAction;
  readonly actionValues: readonly ManagementPolicyActionValue[];
  readonly reasonCodes: readonly string[];
}

export interface ManagementActionFrontier {
  readonly contractVersion: typeof managementActionFrontierVersion;
  readonly chainId: string;
  readonly lifecycleState: ManagementInputState['lifecycleState'];
  readonly policyVersion: string | null;
  readonly policyEvidenceHash: string | null;
  readonly economicModelState: 'EV_MODEL_NOT_EMPIRICALLY_READY';
  readonly actions: readonly ManagementActionEconomics[];
  readonly selectedAction: ManagementFrontierAction | null;
  readonly secondBestAction: ManagementFrontierAction | null;
  readonly decisionState: 'ACTION_SELECTED' | 'SYSTEM_HOLD_MISSING_EVIDENCE';
  readonly reasonCodes: readonly string[];
}

const actionSets: Readonly<Partial<Record<ManagementInputState['lifecycleState'], readonly ManagementFrontierAction[]>>> = {
  CSP_OPEN: ['HOLD', 'CLOSE_FULL', 'ROLL', 'LET_EXPIRE', 'ACCEPT_ASSIGNMENT', 'REDEPLOY'],
  STOCK_HELD: ['RECOVERY_WAIT', 'SELL_STOCK', 'SELL_CC'],
  RECOVERY_WAIT: ['RECOVERY_WAIT', 'SELL_STOCK', 'SELL_CC'],
  CC_OPEN: ['HOLD_CC', 'CLOSE_CC', 'ROLL_CC', 'ALLOW_CALL_AWAY'],
};

const needsExecutableOptionQuote = new Set<ManagementFrontierAction>(['CLOSE_FULL', 'ROLL', 'CLOSE_CC', 'ROLL_CC']);
const opensNewRisk = new Set<ManagementFrontierAction>(['ROLL', 'SELL_CC', 'ROLL_CC', 'REDEPLOY']);

function evaluateAction(input: ManagementInputState, action: ManagementFrontierAction): ManagementActionEconomics {
  const blockers: string[] = [];
  if (needsExecutableOptionQuote.has(action) &&
      (input.market.optionBid === null || input.market.optionAsk === null || input.market.quoteTimestamp === null)) {
    blockers.push('EXECUTABLE_OPTION_QUOTE_UNKNOWN');
  }
  if (needsExecutableOptionQuote.has(action) && input.hardBlockers.some((value) =>
    ['EXECUTABLE_QUOTE_UNAVAILABLE','BROKER_DATA_INVALID','BROKER_DATA_STALE'].includes(value))) {
    blockers.push('EXECUTION_MARKET_NOT_QUALIFIED');
  }
  if ((action === 'SELL_STOCK' || action === 'SELL_CC') && input.economics.openStockShares <= 0) {
    blockers.push('NO_OPEN_STOCK_INVENTORY');
  }
  if (action === 'SELL_STOCK' && input.economics.stockMarkPerShare === null) blockers.push('EXECUTABLE_STOCK_PRICE_UNKNOWN');
  const optionOtm = input.market.spot !== null && input.contract.strike !== null && input.contract.optionType !== null
    ? input.contract.optionType === 'PUT' ? input.market.spot > input.contract.strike : input.market.spot < input.contract.strike
    : null;
  const optionItm = optionOtm === null ? null : !optionOtm;
  if (action === 'LET_EXPIRE' && (input.market.dte === null || input.market.dte > 0)) blockers.push('NOT_AT_EXPIRATION');
  if (action === 'LET_EXPIRE' && optionOtm === null) blockers.push('EXPIRATION_MONEYNESS_UNKNOWN');
  if (action === 'LET_EXPIRE' && optionOtm === false) blockers.push('OPTION_NOT_OTM_AT_EXPIRATION');
  if (action === 'ACCEPT_ASSIGNMENT' && (input.market.dte === null || input.market.dte > 0)) blockers.push('NOT_AT_ASSIGNMENT_WINDOW');
  if (action === 'ACCEPT_ASSIGNMENT' && optionItm === null) blockers.push('ASSIGNMENT_MONEYNESS_UNKNOWN');
  if (action === 'ACCEPT_ASSIGNMENT' && optionItm === false) blockers.push('OPTION_NOT_ITM_FOR_ASSIGNMENT');
  if (action === 'ACCEPT_ASSIGNMENT' && input.context.assignmentCapacity === null) blockers.push('ASSIGNMENT_CAPACITY_UNKNOWN');
  if (action === 'ACCEPT_ASSIGNMENT' && typeof input.context.assignmentCapacity === 'number'
    && input.context.assignmentCapacity <= 0) blockers.push('NO_ASSIGNMENT_CAPACITY');
  if (action === 'REDEPLOY') blockers.push('CURRENT_EXPOSURE_NOT_RESOLVED');
  if (action === 'ALLOW_CALL_AWAY') {
    if (input.market.dte === null || input.market.dte > 0) blockers.push('NOT_AT_CALL_AWAY_WINDOW');
    if (optionItm === null) blockers.push('CALL_AWAY_MONEYNESS_UNKNOWN');
    if (optionItm === false) blockers.push('OPTION_NOT_ITM_FOR_CALL_AWAY');
    if (input.economics.openStockShares <= 0 || input.contract.multiplier === null || input.contract.contracts === null
      || input.economics.openStockShares < input.contract.multiplier * input.contract.contracts) blockers.push('CALL_AWAY_SHARES_NOT_CONFIRMED');
  }
  if (opensNewRisk.has(action)) {
    if (input.context.aegisState === null) blockers.push('AEGIS_STATE_UNKNOWN');
    else if (!['ALLOW_FULL','ALLOW_REDUCED'].includes(String(input.context.aegisState))) blockers.push('AEGIS_NOT_APPROVED');
    if (input.economicModelState === 'EV_MODEL_NOT_EMPIRICALLY_READY') blockers.push('EMPIRICAL_ACTION_EV_UNKNOWN');
  }

  const noOrderAction = action === 'HOLD' || action === 'RECOVERY_WAIT' || action === 'HOLD_CC';
  const feasibility = blockers.length === 0 ? 'FEASIBLE'
    : blockers.some((blocker) => blocker.endsWith('_UNKNOWN') || blocker === 'EMPIRICAL_ACTION_EV_UNKNOWN') ? 'UNKNOWN' : 'INFEASIBLE';
  // A pre-trade mark is not a confirmed liquidation result. Broker fills and
  // final costs belong to the economic ledger, not this prospective frontier.
  const certainEconomicPnl = null;
  const requiredOptionPositionIntents: ManagementActionEconomics['requiredOptionPositionIntents'] =
    action === 'ROLL' || action === 'ROLL_CC' ? ['BUY_TO_CLOSE', 'SELL_TO_OPEN']
      : action === 'CLOSE_FULL' || action === 'CLOSE_CC' ? ['BUY_TO_CLOSE']
        : action === 'SELL_CC' ? ['SELL_TO_OPEN'] : [];
  return {
    action, requiredOptionPositionIntents, feasibility, expectedFutureValue: null, certainEconomicPnl,
    downsideTailEstimate: null, incrementalCapitalDays: null, executionCostRisk: null,
    opportunityCost: null,
    assignmentInventoryConsequence: action === 'ACCEPT_ASSIGNMENT' ? 'ADD_FUNDED_STOCK_INVENTORY'
      : action === 'SELL_CC' ? 'CAP_UPSIDE_AND_ACCEPT_CALL_AWAY_RISK'
        : action === 'ALLOW_CALL_AWAY' ? 'REMOVE_COVERED_STOCK_AT_STRIKE' : null,
    uncertainty: null, utility: null, executionEvidence: null,
    reasons: noOrderAction ? ['CURRENT_EXPOSURE_REMAINS_OPEN', 'EMPIRICAL_CONTINUATION_EV_UNKNOWN'] : [],
    blockers,
  };
}

const passiveActions = new Set<ManagementFrontierAction>(['HOLD', 'RECOVERY_WAIT', 'HOLD_CC']);

function applyPolicyEvidence(actions: readonly ManagementActionEconomics[], input: ManagementInputState,
  evidence: ManagementPolicyEvidence | null): {
    readonly actions: readonly ManagementActionEconomics[];
    readonly selectedAction: ManagementFrontierAction | null;
    readonly secondBestAction: ManagementFrontierAction | null;
    readonly reasonCodes: readonly string[];
    readonly policyVersion: string | null;
    readonly policyEvidenceHash: string | null;
  } {
  if (evidence === null) {
    return {
      actions, selectedAction: null, secondBestAction: null,
      reasonCodes: ['MANAGEMENT_POLICY_EVIDENCE_MISSING'], policyVersion: null, policyEvidenceHash: null,
    };
  }
  const evidenceErrors: string[] = [];
  if (evidence.contractVersion !== managementPolicyEvidenceVersion) evidenceErrors.push('MANAGEMENT_POLICY_VERSION_INVALID');
  if (evidence.inputContentHash !== input.contentHash) evidenceErrors.push('MANAGEMENT_POLICY_INPUT_HASH_MISMATCH');
  if (evidence.decidedAt !== input.observedAt) evidenceErrors.push('MANAGEMENT_POLICY_TIMESTAMP_MISMATCH');
  if (!evidence.policyVersion.trim()) evidenceErrors.push('MANAGEMENT_POLICY_ID_MISSING');
  if (!evidence.comparisonComplete) evidenceErrors.push('MANAGEMENT_POLICY_COMPARISON_INCOMPLETE');
  const values = new Map<ManagementFrontierAction, ManagementPolicyActionValue>();
  for (const value of evidence.actionValues) {
    if (values.has(value.action)) evidenceErrors.push(`MANAGEMENT_POLICY_DUPLICATE_ACTION:${value.action}`);
    if (!actions.some((action) => action.action === value.action)) evidenceErrors.push(`MANAGEMENT_POLICY_EXTRA_ACTION:${value.action}`);
    values.set(value.action, value);
    for (const candidate of [value.expectedFutureValue, value.downsideTailEstimate, value.incrementalCapitalDays,
      value.executionCostRisk, value.opportunityCost, value.uncertainty, value.utility]) {
      if (candidate !== null && !Number.isFinite(candidate)) evidenceErrors.push(`MANAGEMENT_POLICY_NONFINITE_VALUE:${value.action}`);
    }
    const execution = value.executionEvidence;
    if (execution !== null) {
      for (const candidate of [execution.closeEconomicBoundary, execution.openEconomicBoundary, execution.stockEconomicBoundary,
        execution.expectedAfterCostEv]) {
        if (candidate !== null && !Number.isFinite(candidate)) {
          evidenceErrors.push(`MANAGEMENT_POLICY_NONFINITE_EXECUTION_VALUE:${value.action}`);
        }
      }
    }
  }
  if (!actions.some((action) => action.action === evidence.selectedAction)) evidenceErrors.push('MANAGEMENT_POLICY_ACTION_NOT_APPLICABLE');
  const merged = actions.map((action): ManagementActionEconomics => {
    const value = values.get(action.action);
    if (value === undefined) return action;
    const empiricalResolved = opensNewRisk.has(action.action) && value.executionEvidence?.empiricalEconomicsReady === true
      && value.executionEvidence.expectedAfterCostEv !== null && value.executionEvidence.expectedAfterCostEv > 0;
    const blockers = empiricalResolved
      ? action.blockers.filter((blocker) => blocker !== 'EMPIRICAL_ACTION_EV_UNKNOWN') : action.blockers;
    const feasibility = blockers.length === 0 ? 'FEASIBLE' : blockers.some((blocker) => blocker.endsWith('_UNKNOWN')
      || blocker === 'EMPIRICAL_ACTION_EV_UNKNOWN') ? 'UNKNOWN' : 'INFEASIBLE';
    return { ...action, feasibility, blockers, expectedFutureValue:value.expectedFutureValue, downsideTailEstimate:value.downsideTailEstimate,
      incrementalCapitalDays:value.incrementalCapitalDays, executionCostRisk:value.executionCostRisk,
      opportunityCost:value.opportunityCost, uncertainty:value.uncertainty, utility:value.utility,
      executionEvidence:value.executionEvidence, reasons:[...action.reasons,...value.reasons] };
  });
  const comparable = merged.filter((action) => action.feasibility === 'FEASIBLE');
  for (const action of comparable) if (action.utility === null) evidenceErrors.push(`MANAGEMENT_POLICY_UTILITY_UNKNOWN:${action.action}`);
  const ranked = comparable.filter((action): action is ManagementActionEconomics & { utility: number } => action.utility !== null)
    .sort((left, right) => right.utility - left.utility
      || Number(passiveActions.has(right.action)) - Number(passiveActions.has(left.action))
      || left.action.localeCompare(right.action));
  if (ranked[0]?.action !== evidence.selectedAction) evidenceErrors.push('MANAGEMENT_POLICY_SELECTION_NOT_ARGMAX');
  const selected = merged.find((action) => action.action === evidence.selectedAction);
  if (selected === undefined || selected.feasibility !== 'FEASIBLE') evidenceErrors.push('MANAGEMENT_POLICY_SELECTED_ACTION_NOT_FEASIBLE');
  if (opensNewRisk.has(evidence.selectedAction)) {
    const execution = selected?.executionEvidence;
    if (execution === null || execution === undefined || !execution.empiricalEconomicsReady
      || execution.expectedAfterCostEv === null || execution.expectedAfterCostEv <= 0) {
      evidenceErrors.push('MANAGEMENT_NEW_RISK_NOT_EMPIRICALLY_SUPPORTED');
    }
  }
  if (evidenceErrors.length > 0) {
    return {
      actions: merged, selectedAction: null, secondBestAction: null,
      reasonCodes: [...new Set(['MANAGEMENT_POLICY_EVIDENCE_REJECTED', ...evidenceErrors])].sort(),
      policyVersion: null, policyEvidenceHash: null,
    };
  }
  return {
    actions: merged, selectedAction: evidence.selectedAction, secondBestAction: ranked[1]?.action ?? null,
    reasonCodes: [...new Set(['MANAGEMENT_POLICY_EVIDENCE_ACCEPTED', ...evidence.reasonCodes])].sort(),
    policyVersion: evidence.policyVersion, policyEvidenceHash: hashJson(evidence as unknown as JsonValue),
  };
}

function structuralExpirationSelection(input: ManagementInputState,
  actions: readonly ManagementActionEconomics[]): ManagementFrontierAction | null {
  if (input.market.dte !== 0 || input.market.marketOpen !== false || input.market.spot === null
    || input.contract.strike === null || input.contract.optionType === null) return null;
  const itm = input.contract.optionType === 'PUT'
    ? input.market.spot < input.contract.strike : input.market.spot > input.contract.strike;
  const desired: ManagementFrontierAction = input.lifecycleState === 'CSP_OPEN'
    ? (itm ? 'ACCEPT_ASSIGNMENT' : 'LET_EXPIRE')
    : input.lifecycleState === 'CC_OPEN' && itm ? 'ALLOW_CALL_AWAY' : 'HOLD_CC';
  return actions.find((action) => action.action === desired && action.feasibility === 'FEASIBLE')?.action ?? null;
}

/**
 * Enumerates the complete state-appropriate frontier. It does not invent a
 * winner while empirical continuation economics are unavailable.
 */
export function buildManagementActionFrontier(input: ManagementInputState,
  evidence: ManagementPolicyEvidence | null = null): ManagementActionFrontier {
  const baseActions = (actionSets[input.lifecycleState] ?? []).map((action) => evaluateAction(input, action));
  const policy = applyPolicyEvidence(baseActions, input, evidence);
  const passive = policy.actions.find((action) => passiveActions.has(action.action));
  const structuralSelection = evidence === null ? structuralExpirationSelection(input, policy.actions) : null;
  const selectedAction = policy.selectedAction ?? structuralSelection ?? (passive?.feasibility === 'FEASIBLE' ? passive.action : null);
  const policySelected = policy.selectedAction !== null || structuralSelection !== null;
  return {
    contractVersion: managementActionFrontierVersion, chainId: input.chainId, lifecycleState: input.lifecycleState,
    policyVersion: structuralSelection !== null ? 'theta-structural-expiration-v1' : policy.policyVersion,
    policyEvidenceHash: structuralSelection !== null ? hashJson({ inputContentHash: input.contentHash,
      action: structuralSelection, policyVersion: 'theta-structural-expiration-v1' }) : policy.policyEvidenceHash,
    economicModelState: 'EV_MODEL_NOT_EMPIRICALLY_READY', actions:policy.actions, selectedAction,
    secondBestAction: policy.secondBestAction,
    decisionState: policySelected ? 'ACTION_SELECTED' : 'SYSTEM_HOLD_MISSING_EVIDENCE',
    reasonCodes: baseActions.length === 0 ? ['LIFECYCLE_STATE_HAS_NO_MANAGEMENT_FRONTIER']
      : structuralSelection !== null ? ['STRUCTURAL_EXPIRATION_NO_ORDER', `SELECT_${structuralSelection}`]
        : policySelected ? policy.reasonCodes : ['EV_MODEL_NOT_EMPIRICALLY_READY',...policy.reasonCodes],
  };
}
