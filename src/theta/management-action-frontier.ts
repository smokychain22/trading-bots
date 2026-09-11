import type { ManagementInputState } from './management-input-state.js';

export const managementActionFrontierVersion = 'theta-management-action-frontier-v1' as const;

export type ManagementFrontierAction =
  | 'HOLD' | 'CLOSE_FULL' | 'ROLL' | 'LET_EXPIRE' | 'ACCEPT_ASSIGNMENT' | 'REDEPLOY'
  | 'RECOVERY_WAIT' | 'SELL_STOCK' | 'SELL_CC'
  | 'HOLD_CC' | 'CLOSE_CC' | 'ROLL_CC' | 'ALLOW_CALL_AWAY';

export interface ManagementActionEconomics {
  readonly action: ManagementFrontierAction;
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
  readonly reasons: readonly string[];
  readonly blockers: readonly string[];
}

export interface ManagementActionFrontier {
  readonly contractVersion: typeof managementActionFrontierVersion;
  readonly chainId: string;
  readonly lifecycleState: ManagementInputState['lifecycleState'];
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
  if ((action === 'SELL_STOCK' || action === 'SELL_CC') && input.economics.openStockShares <= 0) {
    blockers.push('NO_OPEN_STOCK_INVENTORY');
  }
  if (action === 'SELL_STOCK' && input.economics.stockMarkPerShare === null) blockers.push('EXECUTABLE_STOCK_PRICE_UNKNOWN');
  if (action === 'LET_EXPIRE' && (input.market.dte === null || input.market.dte > 0)) blockers.push('NOT_AT_EXPIRATION');
  if (action === 'ACCEPT_ASSIGNMENT' && input.context.assignmentCapacity === null) blockers.push('ASSIGNMENT_CAPACITY_UNKNOWN');
  if (action === 'REDEPLOY') blockers.push('CURRENT_EXPOSURE_NOT_RESOLVED');
  if (opensNewRisk.has(action)) {
    if (input.context.aegisState === null) blockers.push('AEGIS_STATE_UNKNOWN');
    if (input.economicModelState === 'EV_MODEL_NOT_EMPIRICALLY_READY') blockers.push('EMPIRICAL_ACTION_EV_UNKNOWN');
  }

  const noOrderAction = action === 'HOLD' || action === 'RECOVERY_WAIT' || action === 'HOLD_CC';
  const feasibility = blockers.length === 0 ? 'FEASIBLE'
    : blockers.some((blocker) => blocker.endsWith('_UNKNOWN') || blocker === 'EMPIRICAL_ACTION_EV_UNKNOWN') ? 'UNKNOWN' : 'INFEASIBLE';
  const certainEconomicPnl = (action === 'CLOSE_FULL' || action === 'CLOSE_CC')
    ? input.economics.wholeChainPnl
    : action === 'SELL_STOCK' ? input.economics.wholeChainPnl : null;
  return {
    action, feasibility, expectedFutureValue: null, certainEconomicPnl,
    downsideTailEstimate: null, incrementalCapitalDays: null, executionCostRisk: null,
    opportunityCost: null,
    assignmentInventoryConsequence: action === 'ACCEPT_ASSIGNMENT' ? 'ADD_FUNDED_STOCK_INVENTORY'
      : action === 'SELL_CC' ? 'CAP_UPSIDE_AND_ACCEPT_CALL_AWAY_RISK'
        : action === 'ALLOW_CALL_AWAY' ? 'REMOVE_COVERED_STOCK_AT_STRIKE' : null,
    uncertainty: null, utility: null,
    reasons: noOrderAction ? ['CURRENT_EXPOSURE_REMAINS_OPEN', 'EMPIRICAL_CONTINUATION_EV_UNKNOWN'] : [],
    blockers,
  };
}

/**
 * Enumerates the complete state-appropriate frontier. It does not invent a
 * winner while empirical continuation economics are unavailable.
 */
export function buildManagementActionFrontier(input: ManagementInputState): ManagementActionFrontier {
  const actions = (actionSets[input.lifecycleState] ?? []).map((action) => evaluateAction(input, action));
  const passive = actions.find((action) => ['HOLD', 'RECOVERY_WAIT', 'HOLD_CC'].includes(action.action));
  const selectedAction = passive?.feasibility === 'FEASIBLE' ? passive.action : null;
  return {
    contractVersion: managementActionFrontierVersion, chainId: input.chainId, lifecycleState: input.lifecycleState,
    economicModelState: 'EV_MODEL_NOT_EMPIRICALLY_READY', actions, selectedAction, secondBestAction: null,
    decisionState: 'SYSTEM_HOLD_MISSING_EVIDENCE',
    reasonCodes: actions.length === 0 ? ['LIFECYCLE_STATE_HAS_NO_MANAGEMENT_FRONTIER']
      : ['EV_MODEL_NOT_EMPIRICALLY_READY', 'ACTION_UTILITIES_UNKNOWN'],
  };
}
