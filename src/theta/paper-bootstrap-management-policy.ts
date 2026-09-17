import type { ManagementPolicyEvidenceProvider } from './autonomous-runtime.js';
import {
  buildManagementActionFrontier,
  managementPolicyEvidenceVersion,
  type ManagementFrontierAction,
  type ManagementPolicyActionValue,
  type ManagementPolicyEvidence,
} from './management-action-frontier.js';
import type { ManagementInputState } from './management-input-state.js';

export const paperBootstrapManagementPolicyVersion = 'theta-paper-bootstrap-management-policy-v1' as const;

const passiveActionByState: Readonly<Partial<Record<ManagementInputState['lifecycleState'], ManagementFrontierAction>>> = {
  CSP_OPEN: 'HOLD',
  STOCK_HELD: 'RECOVERY_WAIT',
  RECOVERY_WAIT: 'RECOVERY_WAIT',
  CC_OPEN: 'HOLD_CC',
};

const executableOptionQuoteReady = (state: ManagementInputState): boolean =>
  state.market.optionBid !== null && state.market.optionAsk !== null && state.market.quoteTimestamp !== null
  && state.market.optionBid > 0 && state.market.optionAsk >= state.market.optionBid
  && state.market.quoteQuality === 'GOOD'
  && !state.hardBlockers.some((blocker) => [
    'EXECUTABLE_QUOTE_UNAVAILABLE', 'BROKER_DATA_INVALID', 'BROKER_DATA_STALE',
  ].includes(blocker));

function selectBootstrapAction(state: ManagementInputState): ManagementFrontierAction | null {
  // The canonical structural-expiration path owns expiry, assignment, and
  // call-away transitions. Returning null preserves that independently tested
  // broker-truth path rather than replacing it with a policy estimate.
  if (state.market.dte === 0 && state.market.marketOpen === false) return null;
  const aegisState = typeof state.context.aegisState === 'string' ? state.context.aegisState : null;
  if (aegisState === 'HARD_VETO') {
    if (state.lifecycleState === 'CSP_OPEN' && executableOptionQuoteReady(state)) return 'CLOSE_FULL';
    if ((state.lifecycleState === 'STOCK_HELD' || state.lifecycleState === 'RECOVERY_WAIT')
      && state.economics.openStockShares > 0 && state.economics.stockMarkPerShare !== null
      && state.economics.stockMarkPerShare > 0) return 'SELL_STOCK';
  }
  return passiveActionByState[state.lifecycleState] ?? null;
}

function executionEvidence(state: ManagementInputState, action: ManagementFrontierAction) {
  if (action === 'CLOSE_FULL' || action === 'CLOSE_CC') {
    return {
      closeEconomicBoundary: state.market.optionAsk,
      openEconomicBoundary: null,
      stockEconomicBoundary: null,
      economicsRemainPositive: state.market.optionAsk !== null && state.market.optionAsk > 0,
      expectedAfterCostEv: null,
      empiricalEconomicsReady: false,
      targetContract: null,
    } as const;
  }
  if (action === 'SELL_STOCK') {
    return {
      closeEconomicBoundary: null,
      openEconomicBoundary: null,
      stockEconomicBoundary: state.economics.stockMarkPerShare,
      economicsRemainPositive: state.economics.stockMarkPerShare !== null && state.economics.stockMarkPerShare > 0,
      expectedAfterCostEv: null,
      empiricalEconomicsReady: false,
      targetContract: null,
    } as const;
  }
  return null;
}

/**
 * Provides the bounded operational policy needed to manage the first Paper
 * canary without claiming empirical profitability. The policy may preserve
 * exposure, perform a risk-authority-directed full exit, or defer to the
 * structural expiration path. It never rolls, redeploys, opens a covered call,
 * or increases risk.
 */
export function createPaperBootstrapManagementPolicyProvider(): ManagementPolicyEvidenceProvider {
  return {
    authority: 'PAPER_BOOTSTRAP_MANAGEMENT_POLICY',
    evaluate: async (state): Promise<ManagementPolicyEvidence | null> => {
      const selectedAction = selectBootstrapAction(state);
      if (selectedAction === null) return null;
      const base = buildManagementActionFrontier(state);
      const selectedBase = base.actions.find((action) => action.action === selectedAction);
      if (selectedBase === undefined || selectedBase.feasibility !== 'FEASIBLE') return null;
      const actionValues = base.actions.map((action): ManagementPolicyActionValue => {
        const comparable = action.feasibility === 'FEASIBLE';
        return {
          action: action.action,
          expectedFutureValue: null,
          downsideTailEstimate: null,
          incrementalCapitalDays: null,
          executionCostRisk: null,
          opportunityCost: null,
          uncertainty: null,
          utility: comparable ? (action.action === selectedAction ? 0 : -1) : null,
          executionEvidence: action.action === selectedAction ? executionEvidence(state, action.action) : null,
          reasons: action.action === selectedAction
            ? ['PAPER_BOOTSTRAP_OPERATIONAL_POLICY', 'EMPIRICAL_PROFITABILITY_NOT_CLAIMED']
            : ['PAPER_BOOTSTRAP_ACTION_NOT_SELECTED'],
        };
      });
      return {
        contractVersion: managementPolicyEvidenceVersion,
        inputContentHash: state.contentHash,
        decidedAt: state.observedAt,
        policyVersion: paperBootstrapManagementPolicyVersion,
        comparisonComplete: true,
        selectedAction,
        actionValues,
        reasonCodes: [
          'PAPER_BOOTSTRAP_MANAGEMENT_POLICY',
          'EMPIRICALLY_PROMOTED_MANAGEMENT_POLICY_UNAVAILABLE',
          'NO_NEW_RISK_MANAGEMENT_ACTIONS',
        ],
      };
    },
  };
}
