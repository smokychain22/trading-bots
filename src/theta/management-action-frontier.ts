import { hashJson, type JsonValue } from '../market/fusion-snapshot.js';
import type { ManagementInputState } from './management-input-state.js';
import { assessHoldStrikeLifecycle } from './hold-strike-lifecycle.js';

export const managementActionFrontierVersion = 'theta-management-action-frontier-v2' as const;
/**
 * Versioned management-authority revision v3 (docs/architecture/THETA_MANAGEMENT_FRONTIER_V3_DEFINED_RISK.md): adds the DEFINED_RISK_OPEN
 * lifecycle state and the EMERGENCY_RISK_REDUCTION action so a native spread is decided by THIS authority, not by a parallel one. Wheel
 * frontiers (CSP_OPEN / STOCK_HELD / RECOVERY_WAIT / CC_OPEN) are unchanged and keep the v2 contract byte for byte.
 */
export const managementActionFrontierVersionV3 = 'theta-management-action-frontier-v3' as const;
export const managementPolicyEvidenceVersion = 'theta-management-policy-evidence-v1' as const;

export type ManagementFrontierAction =
  | 'HOLD' | 'CLOSE_FULL' | 'ROLL' | 'LET_EXPIRE' | 'ACCEPT_ASSIGNMENT' | 'REDEPLOY'
  | 'RECOVERY_WAIT' | 'SELL_STOCK' | 'SELL_CC'
  | 'HOLD_CC' | 'CLOSE_CC' | 'ROLL_CC' | 'ALLOW_CALL_AWAY'
  /** v3, DEFINED_RISK_OPEN only: risk must come down because the approved structure no longer exists (unhedged short, contradictory legs) */
  | 'EMERGENCY_RISK_REDUCTION';

export interface ManagementActionEconomics {
  readonly action: ManagementFrontierAction;
  readonly requiredOptionPositionIntents: readonly ('SELL_TO_OPEN' | 'BUY_TO_CLOSE' | 'SELL_TO_CLOSE' | 'BUY_TO_OPEN')[];
  readonly feasibility: 'FEASIBLE' | 'INFEASIBLE' | 'UNKNOWN';
  readonly expectedFutureValue: number | null;
  readonly certainEconomicPnl: number | null;
  readonly downsideTailEstimate: number | null;
  /** USD-calendar-days relative to closing now, or the compared old leg for rolls. */
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
  /** UNIT: USD PER SHARE option price (never a USD total). Buy-to-close: the maximum ask-side price we will pay. */
  readonly closeEconomicBoundary: number | null;
  /** UNIT: USD PER SHARE option price. Sell-to-open: the minimum bid-side price we will accept. */
  readonly openEconomicBoundary: number | null;
  /** UNIT: USD per share of stock. A FLOOR: the minimum acceptable sale price, set <= the current executable bid (never above it). */
  readonly stockEconomicBoundary: number | null;
  /**
   * For new-risk legs (roll-open / covered call) and rolls: the deterministic forward economics clear the HOLD baseline.
   * For a risk-REDUCING close (CLOSE_FULL / CLOSE_CC / SELL_STOCK) the meaning is deliberately narrower: "closing is the action whose
   * forward utility beats HOLD" -- it is NOT a claim of positive after-cost EV (`expectedAfterCostEv` stays null and
   * `empiricalEconomicsReady` false).
   */
  /**
   * READ AS: INCREMENTAL_UTILITY_VS_BASELINE_IS_POSITIVE. For CLOSE_FULL / CLOSE_CC it compares the close against HOLD; for
   * SELL_STOCK it compares the sale against RECOVERY_WAIT on common forward economics. It is NOT "expected profit > 0", NOT a
   * realized-P&L test, and there is no sell-only-above-basis rule. A tie (utility 0) is false, so a stock sale is never forced.
   */
  readonly economicsRemainPositive: boolean;
  readonly expectedAfterCostEv: number | null;
  readonly empiricalEconomicsReady: boolean;
  /**
   * A DIFFERENT, narrower claim than `empiricalEconomicsReady`. This asserts
   * only that the action's net cash-flow effect (e.g. a roll's close-cost
   * plus open-credit, a covered call's premium net of known assignment
   * consequence) has been computed COMPLETELY from known, current,
   * non-statistical inputs -- arithmetic on real quotes/fees, never a
   * forecasted or modeled edge. It exists so a deterministic bootstrap
   * policy (no learned EV model, no promotion) can still open new risk with
   * honest, complete economics, without requiring the empirical readiness
   * bar that only an empirically-validated policy can ever satisfy. It
   * NEVER substitutes for empirical validation when a policy claims a
   * statistical edge -- `expectedAfterCostEv`/`empiricalEconomicsReady`
   * remain the only path for that claim.
   */
  readonly deterministicEconomicsValidated: boolean;
  readonly deterministicNetCredit: number | null;
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
  /** USD-calendar-days. Elapsed calendar days alone are not this measure. */
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
  readonly contractVersion: typeof managementActionFrontierVersion | typeof managementActionFrontierVersionV3;
  readonly chainId: string;
  readonly lifecycleState: ManagementInputState['lifecycleState'] | 'DEFINED_RISK_OPEN';
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
  // MGMT-STOCKHELD-ACTION-EDGE: the lifecycle table (runtime-state.ts) allows only STOCK_HELD -> RECOVERY_WAIT, and the
  // fill applier (postgres-lifecycle-application-store.ts) applies COVERED_CALL_OPEN / STOCK_DISPOSAL only from
  // RECOVERY_WAIT. Offering SELL_STOCK / SELL_CC here could submit a broker order whose fill can never be applied to the
  // ledger. STOCK_HELD therefore offers only the passive wait that advances it; exits begin at RECOVERY_WAIT.
  STOCK_HELD: ['RECOVERY_WAIT'],
  RECOVERY_WAIT: ['RECOVERY_WAIT', 'SELL_STOCK', 'SELL_CC'],
  CC_OPEN: ['HOLD_CC', 'CLOSE_CC', 'ROLL_CC', 'ALLOW_CALL_AWAY'],
};

const needsExecutableOptionQuote = new Set<ManagementFrontierAction>(['CLOSE_FULL', 'ROLL', 'CLOSE_CC', 'ROLL_CC']);
const opensNewRisk = new Set<ManagementFrontierAction>(['ROLL', 'SELL_CC', 'ROLL_CC', 'REDEPLOY']);

function evaluateAction(input: ManagementInputState, action: ManagementFrontierAction): ManagementActionEconomics {
  const blockers: string[] = [];
  if (input.evidenceBundle.timingState === 'FUTURE_EVIDENCE'
    && action !== 'HOLD' && action !== 'RECOVERY_WAIT' && action !== 'HOLD_CC') {
    blockers.push('EVIDENCE_OBSERVED_AFTER_DECISION');
  }
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
  // Selling the shares under a short call on this chain would leave an uncovered short call.
  if (action === 'SELL_STOCK' && input.contract.optionType === 'CALL' && (input.contract.contracts === null || input.contract.contracts > 0)) {
    blockers.push('SHORT_CALL_OPEN_AGAINST_SHARES');
  }
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
  if (action === 'ACCEPT_ASSIGNMENT' && input.hardBlockers.includes('BROKER_SHORT_PUT_POSITION_UNCONFIRMED')) {
    blockers.push('BROKER_SHORT_PUT_POSITION_UNCONFIRMED');
  }
  if (action === 'ACCEPT_ASSIGNMENT' && input.context.assignmentCapacity !== null
    && (input.contract.contracts === null || input.context.assignmentCapacity < input.contract.contracts)) {
    blockers.push(input.contract.contracts === null ? 'ASSIGNMENT_QUANTITY_UNKNOWN' : 'NO_ASSIGNMENT_CAPACITY');
  }
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
  const definitiveBlockers = new Set([
    'OPTION_NOT_ITM_FOR_ASSIGNMENT','OPTION_NOT_OTM_AT_EXPIRATION','OPTION_NOT_ITM_FOR_CALL_AWAY',
    'NO_ASSIGNMENT_CAPACITY','BROKER_SHORT_PUT_POSITION_UNCONFIRMED','EVIDENCE_OBSERVED_AFTER_DECISION',
  ]);
  const feasibility = blockers.length === 0 ? 'FEASIBLE'
    : blockers.some((blocker) => definitiveBlockers.has(blocker)) ? 'INFEASIBLE'
      : blockers.some((blocker) => blocker.endsWith('_UNKNOWN')) ? 'UNKNOWN' : 'INFEASIBLE';
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

/**
 * A new-risk action (ROLL/SELL_CC/ROLL_CC/REDEPLOY) may open only when its
 * economics are genuinely KNOWN, via EITHER of two structurally distinct
 * evidence classes -- never fabricated, never merely absent-and-assumed-fine:
 *   - EMPIRICAL: a statistically validated EV model claims a positive edge
 *     (`empiricalEconomicsReady` + a positive `expectedAfterCostEv`) --
 *     reserved for an empirically-promoted policy.
 *   - DETERMINISTIC: a bootstrap (non-empirical) policy has computed the
 *     action's complete, honest, non-statistical net cash-flow effect
 *     (`deterministicEconomicsValidated` + a real, finite
 *     `deterministicNetCredit`) -- this makes no claim of a validated edge,
 *     only that the arithmetic is complete and not fabricated. The policy's
 *     own utility ranking (unchanged elsewhere in this file) still decides
 *     whether opening the risk is actually the best available action.
 */
function newRiskEconomicsAreKnown(execution: ManagementActionExecutionEvidence | null): boolean {
  if (execution === null) return false;
  const empirical = execution.empiricalEconomicsReady === true
    && execution.expectedAfterCostEv !== null && execution.expectedAfterCostEv > 0;
  const deterministic = execution.deterministicEconomicsValidated === true
    && execution.deterministicNetCredit !== null && Number.isFinite(execution.deterministicNetCredit);
  return empirical || deterministic;
}

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
    const newRiskEconomicsResolved = opensNewRisk.has(action.action) && newRiskEconomicsAreKnown(value.executionEvidence);
    const blockers = newRiskEconomicsResolved
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
  if (opensNewRisk.has(evidence.selectedAction) && !newRiskEconomicsAreKnown(selected?.executionEvidence ?? null)) {
    evidenceErrors.push('MANAGEMENT_NEW_RISK_NOT_EMPIRICALLY_SUPPORTED');
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
 * What the D producer (src/execution/defined-risk-management.ts) proposes for ONE native spread. It is evidence, not a decision: the
 * frontier below selects. Every field comes from durable parent + leg truth and fresh quotes of BOTH exact legs.
 */
export interface DefinedRiskManagementProposal {
  readonly producerVersion: string;
  readonly chainId: string;
  readonly orderIntentId: string;
  readonly positionState: string;
  readonly proposedAction: 'HOLD' | 'CLOSE_FULL' | 'EMERGENCY_RISK_REDUCTION' | 'WAIT_FOR_BROKER_TRUTH' | 'NO_ACTION_TERMINAL';
  /** a safety trigger demands a close of the whole package */
  readonly closeRequired: boolean;
  /** both exact legs freshly and executably quoted */
  readonly quotesExecutable: boolean;
  /** hedged spreads a package close would cover */
  readonly closeQuantity: number;
  /** contracts of short put with no long behind them (broker truth) */
  readonly nakedShortContracts: number;
  readonly reasons: readonly string[];
  readonly proposalHash: string;
}

const DEFINED_RISK_ACTIONS: readonly ManagementFrontierAction[] = ['HOLD', 'CLOSE_FULL', 'EMERGENCY_RISK_REDUCTION'];

/**
 * v3 frontier for a DEFINED_RISK_OPEN spread. The same sovereign authority as the Wheel frontier: the producer proposes, this function
 * enumerates HOLD / CLOSE_FULL / EMERGENCY_RISK_REDUCTION with their feasibility and selects exactly one (or none, loudly), and only the
 * selected action may reach PaperOrderCoordinator. Rules, in order:
 *  - a terminal spread has no frontier action; unknown broker truth is a SYSTEM_HOLD (never a pass, never an order);
 *  - an emergency (unhedged short / contradictory legs) selects EMERGENCY_RISK_REDUCTION, which is ESCALATION-ONLY in this revision: no
 *    improvised single-leg order is generated, new risk is blocked, and the emergency is persisted for the operator;
 *  - a required close selects CLOSE_FULL only when BOTH legs are executably quoted and there is a hedged package to close (one native
 *    two-leg order, never one leg); otherwise HOLD with the mandatory close recorded as not feasible;
 *  - otherwise HOLD.
 * No profit target or stop number is invented: those are owner policy needing empirical evidence (TRD section 40).
 */
export function buildDefinedRiskManagementActionFrontier(proposal: DefinedRiskManagementProposal): ManagementActionFrontier {
  const emergency = proposal.proposedAction === 'EMERGENCY_RISK_REDUCTION';
  const terminal = proposal.proposedAction === 'NO_ACTION_TERMINAL';
  const unknownTruth = proposal.proposedAction === 'WAIT_FOR_BROKER_TRUTH';
  const closeFeasible = !emergency && !unknownTruth && proposal.closeRequired && proposal.quotesExecutable && proposal.closeQuantity > 0;
  const economics = (action: ManagementFrontierAction): ManagementActionEconomics => {
    const blockers: string[] = [];
    if (terminal) blockers.push('DEFINED_RISK_TERMINAL');
    if (action === 'CLOSE_FULL') {
      if (emergency) blockers.push('APPROVED_STRUCTURE_ABSENT_PACKAGE_CLOSE_INVALID');
      if (unknownTruth) blockers.push('BROKER_LEG_TRUTH_UNKNOWN');
      if (!proposal.quotesExecutable) blockers.push('BOTH_LEG_QUOTES_NOT_EXECUTABLE');
      if (proposal.closeQuantity <= 0) blockers.push('NO_HEDGED_PACKAGE_TO_CLOSE');
      if (!proposal.closeRequired) blockers.push('NO_CLOSE_TRIGGER');
    }
    if (action === 'EMERGENCY_RISK_REDUCTION' && !emergency) blockers.push('NO_DEFINED_RISK_EMERGENCY');
    const feasibility = terminal ? 'INFEASIBLE' : action === 'HOLD' ? (emergency ? 'INFEASIBLE' : 'FEASIBLE')
      : action === 'CLOSE_FULL' ? (closeFeasible ? 'FEASIBLE' : 'INFEASIBLE') : (emergency ? 'FEASIBLE' : 'INFEASIBLE');
    return { action, requiredOptionPositionIntents: action === 'CLOSE_FULL' ? ['BUY_TO_CLOSE', 'SELL_TO_CLOSE'] : action === 'EMERGENCY_RISK_REDUCTION' ? ['BUY_TO_CLOSE'] : [],
      feasibility, expectedFutureValue: null, certainEconomicPnl: null, downsideTailEstimate: null, incrementalCapitalDays: null, executionCostRisk: null,
      opportunityCost: null, assignmentInventoryConsequence: null, uncertainty: null, utility: null, executionEvidence: null,
      reasons: action === 'EMERGENCY_RISK_REDUCTION' && emergency ? ['ESCALATION_ONLY_NO_AUTOMATED_ORDER', ...proposal.reasons]
        : action === 'HOLD' && emergency ? ['HOLD_IS_NOT_A_VALID_ANSWER_TO_AN_UNHEDGED_SHORT'] : [],
      blockers: feasibility === 'FEASIBLE' ? [] : blockers };
  };
  const actions = DEFINED_RISK_ACTIONS.map(economics);
  const selectedAction: ManagementFrontierAction | null = terminal ? null : emergency ? 'EMERGENCY_RISK_REDUCTION' : closeFeasible ? 'CLOSE_FULL' : 'HOLD';
  const reasonCodes = terminal ? ['DEFINED_RISK_TERMINAL_NO_FRONTIER_ACTION']
    : unknownTruth ? ['SYSTEM_HOLD_BROKER_LEG_TRUTH_UNKNOWN', ...proposal.reasons]
      : [`SELECT_${selectedAction}`, ...proposal.reasons,
        ...(proposal.closeRequired && !closeFeasible && !emergency ? ['D_MANDATORY_CLOSE_FULL_NOT_FEASIBLE'] : [])];
  return { contractVersion: managementActionFrontierVersionV3, chainId: proposal.chainId, lifecycleState: 'DEFINED_RISK_OPEN',
    policyVersion: proposal.producerVersion, policyEvidenceHash: hashJson(proposal as unknown as JsonValue),
    economicModelState: 'EV_MODEL_NOT_EMPIRICALLY_READY', actions, selectedAction,
    secondBestAction: selectedAction === 'HOLD' ? null : terminal ? null : 'HOLD',
    decisionState: terminal || unknownTruth ? 'SYSTEM_HOLD_MISSING_EVIDENCE' : 'ACTION_SELECTED', reasonCodes };
}

/**
 * Enumerates the complete state-appropriate frontier. It does not invent a
 * winner while empirical continuation economics are unavailable.
 */
export function buildManagementActionFrontier(input: ManagementInputState,
  evidence: ManagementPolicyEvidence | null = null): ManagementActionFrontier {
  // Hold-Strike deliberately has no roll action in its registered policy.
  // Preserve that identity after entry instead of silently inheriting Q's
  // wider-DTE roll permission. Missing lineage also cannot enable a roll.
  const applicableActions = input.lifecycleState === 'CSP_OPEN'
    && input.strategyOrigin === 'THETA_HOLD_STRIKE'
    ? (actionSets[input.lifecycleState] ?? []).filter((action) => action !== 'ROLL')
    : actionSets[input.lifecycleState] ?? [];
  const baseActions = applicableActions.map((action) => evaluateAction(input, action));
  const policy = applyPolicyEvidence(baseActions, input, evidence);
  const passive = policy.actions.find((action) => passiveActions.has(action.action));
  const hLifecycle=assessHoldStrikeLifecycle(input);
  const hSelection=hLifecycle?.mandatory===true
    ? policy.actions.find(action=>action.action===hLifecycle.action&&action.feasibility==='FEASIBLE')?.action??null:null;
  const structuralSelection = hSelection??(evidence === null ? structuralExpirationSelection(input, policy.actions) : null);
  const selectedAction = policy.selectedAction ?? structuralSelection ?? (passive?.feasibility === 'FEASIBLE' ? passive.action : null);
  const policySelected = policy.selectedAction !== null || structuralSelection !== null;
  // H's management deadline is PERSISTED with the frontier (reason codes are stored), never memory-only: a restarted worker reads the last deadline and, because management
  // runs first in every cycle, evaluates the chain immediately. A mandatory H action that is not feasible (for example no executable quote) is recorded as such, loudly.
  const holdStrikeReasons: readonly string[] = hLifecycle===null?[]:[`H_REVIEW_DEADLINE:${hLifecycle.reviewDeadline}`,
    ...(hLifecycle.mandatory&&hSelection===null?[`H_MANDATORY_${hLifecycle.action}_NOT_FEASIBLE`]:[])];
  return {
    contractVersion: managementActionFrontierVersion, chainId: input.chainId, lifecycleState: input.lifecycleState,
    policyVersion: hSelection!==null?hLifecycle?.policyVersion??null:structuralSelection !== null ? 'theta-structural-expiration-v1' : policy.policyVersion,
    policyEvidenceHash: hSelection!==null?hashJson({inputContentHash:input.contentHash,hLifecycle} as unknown as JsonValue):structuralSelection !== null ? hashJson({ inputContentHash: input.contentHash,
      action: structuralSelection, policyVersion: 'theta-structural-expiration-v1' }) : policy.policyEvidenceHash,
    economicModelState: 'EV_MODEL_NOT_EMPIRICALLY_READY', actions:policy.actions, selectedAction,
    secondBestAction: policy.secondBestAction,
    decisionState: policySelected ? 'ACTION_SELECTED' : 'SYSTEM_HOLD_MISSING_EVIDENCE',
    reasonCodes: [...(baseActions.length === 0 ? ['LIFECYCLE_STATE_HAS_NO_MANAGEMENT_FRONTIER']
      : hSelection!==null?[...(hLifecycle?.reasons??[]),`SELECT_${hSelection}`]
      : structuralSelection !== null ? ['STRUCTURAL_EXPIRATION_NO_ORDER', `SELECT_${structuralSelection}`]
        : policySelected ? policy.reasonCodes : ['EV_MODEL_NOT_EMPIRICALLY_READY',...policy.reasonCodes]), ...holdStrikeReasons],
  };
}
