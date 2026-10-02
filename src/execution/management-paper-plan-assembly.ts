import { z } from 'zod';
import type { ManagementActionFrontier, ManagementFrontierAction } from '../theta/management-action-frontier.js';
import type { ManagementInputState } from '../theta/management-input-state.js';
import { deterministicRuntimeUuid } from '../theta/postgres-theta-cycle-store.js';
import { coveredCallContractCapacity } from '../theta/secured-contract-capacity.js';
import { freeSellableShares, reconcileStockShares } from '../theta/stock-share-reconciliation.js';
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

export type ManagementExecutionLegCompilation =
  | { readonly state: 'NO_BROKER_ACTION'; readonly legs: readonly []; readonly blockers: readonly string[] }
  | { readonly state: 'BLOCKED'; readonly legs: readonly []; readonly blockers: readonly string[] }
  | { readonly state: 'READY'; readonly legs: readonly ManagementExecutionLegDirective[]; readonly blockers: readonly [] };

/** One non-terminal management action plan or order intent already existing for the chain. */
export interface ManagementChainInFlightEntry {
  readonly source: 'ACTION_PLAN' | 'ORDER_INTENT';
  readonly id: string;
  /** The decision that created it. An entry of THIS assembly's own decision is an idempotent replay, not a conflict. */
  readonly decisionId: string | null;
}

/**
 * MGMT-CROSS-CYCLE-DUP. Plan and order-intent unique keys are per frontier / decision, so a later cycle (new frontier ->
 * new decision) re-selecting the same close or roll while the first order is still READY / working / unknown would emit a
 * second equivalent order for the same chain. This explicit input names what already exists for the chain. It has no
 * default: absent or UNKNOWN blocks.
 */
export type ManagementChainInFlightState =
  | { readonly state: 'KNOWN'; readonly entries: readonly ManagementChainInFlightEntry[] }
  | { readonly state: 'UNKNOWN' };

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
  /** Absent === UNKNOWN === blocked (see ManagementChainInFlightState). */
  readonly chainInFlight?: ManagementChainInFlightState;
  /**
   * HDAC-05. Whole short-call contracts already committed on this underlying across the ACCOUNT (open short calls of any
   * chain plus pending sell-to-open call orders; see deriveCommittedShortCallContracts). It INCLUDES the call a ROLL_CC is
   * closing, which is netted out here. null / absent is UNKNOWN and blocks any covered-call open.
   */
  readonly committedShortCallContracts?: number | null;
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
  readonly managementPolicyVersion: string;
  readonly managementPolicyEvidenceHash: string;
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

const validPositive = (value: number | null): value is number => value !== null && Number.isFinite(value) && value > 0;

/**
 * Compiles broker legs from the selected immutable frontier. Current-leg
 * identity and quantity always come from reconciled management state. A
 * replacement/opening contract may only come from the selected action's
 * persisted policy evidence. No caller may substitute a different close
 * contract or quantity at this boundary.
 */
export function compileManagementExecutionLegDirectives(state: ManagementInputState,
  frontier: ManagementActionFrontier): ManagementExecutionLegCompilation {
  const selected = frontier.selectedAction;
  if (selected === null) return { state:'NO_BROKER_ACTION',legs:[],blockers:['NO_MANAGEMENT_ACTION_SELECTED'] };
  if (passiveActions.has(selected) || selected === 'REDEPLOY') {
    return { state:'NO_BROKER_ACTION',legs:[],blockers:[`MANAGEMENT_ACTION_${selected}`] };
  }
  const action = frontier.actions.find((candidate) => candidate.action === selected);
  if (frontier.chainId !== state.chainId || frontier.decisionState !== 'ACTION_SELECTED' || action === undefined
    || action.feasibility !== 'FEASIBLE') {
    return { state:'BLOCKED',legs:[],blockers:['MANAGEMENT_SELECTION_AUTHORITY_INVALID'] };
  }
  const execution = action.executionEvidence;
  if (execution === null || !execution.economicsRemainPositive) {
    return { state:'BLOCKED',legs:[],blockers:['MANAGEMENT_EXECUTION_EVIDENCE_MISSING'] };
  }
  const currentOption = (): {symbol:string;optionContractId:string;optionType:'PUT'|'CALL';multiplier:number;quantity:number}|null =>
    state.contract.symbol !== null && state.contract.optionContractId !== null && state.contract.optionType !== null
      && state.contract.multiplier !== null && state.contract.contracts !== null && Number.isInteger(state.contract.contracts)
      && state.contract.contracts > 0
      ? {symbol:state.contract.symbol,optionContractId:state.contract.optionContractId,optionType:state.contract.optionType,
          multiplier:state.contract.multiplier,quantity:state.contract.contracts}:null;
  const close = currentOption();
  const common = { economicsRemainPositive:execution.economicsRemainPositive,
    expectedAfterCostEv:execution.expectedAfterCostEv,empiricalEconomicsReady:execution.empiricalEconomicsReady };
  if (selected === 'CLOSE_FULL' || selected === 'CLOSE_CC') {
    if (close === null || !validPositive(execution.closeEconomicBoundary)) {
      return { state:'BLOCKED',legs:[],blockers:['MANAGEMENT_CLOSE_DIRECTIVE_INCOMPLETE'] };
    }
    const expectedType=selected==='CLOSE_FULL'?'PUT':'CALL';
    if(close.optionType!==expectedType)return {state:'BLOCKED',legs:[],blockers:['MANAGEMENT_CLOSE_LIFECYCLE_MISMATCH']};
    return {state:'READY',blockers:[],legs:[{action:selected==='CLOSE_FULL'?'CLOSE_CSP':'CLOSE_CC',
      symbol:close.symbol,optionContractId:close.optionContractId,optionType:close.optionType,multiplier:close.multiplier,
      canonicalQuantity:close.quantity,economicBoundary:execution.closeEconomicBoundary,...common}]};
  }
  if (selected === 'SELL_STOCK') {
    if (!Number.isInteger(state.economics.openStockShares) || state.economics.openStockShares <= 0
      || !validPositive(execution.stockEconomicBoundary)) {
      return { state:'BLOCKED',legs:[],blockers:['MANAGEMENT_STOCK_EXIT_DIRECTIVE_INCOMPLETE'] };
    }
    // Two share truths: the ledger count alone never authorizes a stock sale. Mismatch/unknown broker evidence fails closed
    // here (management keeps evaluating; only broker mutation is withheld).
    const reconciliation = reconcileStockShares({ ledgerShares: state.economics.openStockShares, broker: state.brokerStockInventory,
      reconciliationQuality: state.context.assignmentCapacityEvidence.reconciliationQuality, now: state.observedAt });
    if (reconciliation.state === 'MISMATCH') return { state:'BLOCKED',legs:[],blockers:[`STOCK_SHARES_LEDGER_BROKER_MISMATCH:${reconciliation.reason}`] };
    if (reconciliation.state !== 'RECONCILED') return { state:'BLOCKED',legs:[],blockers:[`STOCK_SHARES_BROKER_EVIDENCE_UNKNOWN:${reconciliation.reason}`] };
    return {state:'READY',blockers:[],legs:[{action:'SELL_STOCK',symbol:state.underlying,optionContractId:null,
      optionType:null,multiplier:1,canonicalQuantity:state.economics.openStockShares,
      economicBoundary:execution.stockEconomicBoundary,...common}]};
  }
  const target=execution.targetContract;
  if(target===null||!Number.isInteger(target.quantity)||target.quantity<=0||!Number.isInteger(target.multiplier)
    ||target.multiplier<=0||!validPositive(execution.openEconomicBoundary)){
    return {state:'BLOCKED',legs:[],blockers:['MANAGEMENT_NEW_RISK_TARGET_INCOMPLETE']};
  }
  const openLeg=(actionCode:'ROLL_CSP_OPEN'|'OPEN_CC'|'ROLL_CC_OPEN'):ManagementExecutionLegDirective=>({
    action:actionCode,symbol:target.symbol,optionContractId:target.optionContractId,optionType:target.optionType,
    multiplier:target.multiplier,canonicalQuantity:target.quantity,economicBoundary:execution.openEconomicBoundary as number,
    ...common,...(target.optionType==='CALL'?{confirmedCoveredShares:state.economics.openStockShares}:{})});
  if((selected==='SELL_CC'||selected==='ROLL_CC')&&
    (target.optionType!=='CALL'||state.economics.openStockShares<target.quantity*target.multiplier)){
    return {state:'BLOCKED',legs:[],blockers:['COVERED_CALL_COVERAGE_NOT_CONFIRMED']};
  }
  if(selected==='SELL_CC')return {state:'READY',blockers:[],legs:[openLeg('OPEN_CC')]};
  if(close===null||!validPositive(execution.closeEconomicBoundary)){
    return {state:'BLOCKED',legs:[],blockers:['MANAGEMENT_ROLL_CLOSE_DIRECTIVE_INCOMPLETE']};
  }
  if(selected==='ROLL'&&close.optionType==='PUT'&&target.optionType==='PUT')return {state:'READY',blockers:[],legs:[
    {action:'ROLL_CSP_CLOSE',symbol:close.symbol,optionContractId:close.optionContractId,optionType:'PUT',multiplier:close.multiplier,
      canonicalQuantity:close.quantity,economicBoundary:execution.closeEconomicBoundary,...common},openLeg('ROLL_CSP_OPEN')]};
  if(selected==='ROLL_CC'&&close.optionType==='CALL'&&target.optionType==='CALL')return {state:'READY',blockers:[],legs:[
    {action:'ROLL_CC_CLOSE',symbol:close.symbol,optionContractId:close.optionContractId,optionType:'CALL',multiplier:close.multiplier,
      canonicalQuantity:close.quantity,economicBoundary:execution.closeEconomicBoundary,...common},openLeg('ROLL_CC_OPEN')]};
  return {state:'BLOCKED',legs:[],blockers:['MANAGEMENT_ACTION_LEG_COMPILATION_UNSUPPORTED']};
}

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
  if (input.frontier.policyVersion === null || input.frontier.policyEvidenceHash === null) {
    blockers.push('MANAGEMENT_POLICY_LINEAGE_MISSING');
  }
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

  const authorityRef = `management:${input.managementActionFrontierId}:${selected}`;
  const decisionId = deterministicRuntimeUuid(`management-decision:${authorityRef}`);
  // MGMT-CROSS-CYCLE-DUP: any other non-terminal plan/order for this chain blocks a new management order.
  const inFlight = input.chainInFlight;
  let noEquivalentExposureConflict = false;
  if (inFlight === undefined || inFlight.state !== 'KNOWN') blockers.push('MANAGEMENT_CHAIN_IN_FLIGHT_STATE_UNKNOWN');
  else {
    const conflicts = inFlight.entries.filter((entry) => entry.decisionId !== decisionId);
    if (conflicts.length > 0) blockers.push('MANAGEMENT_EQUIVALENT_ORDER_IN_FLIGHT');
    else noEquivalentExposureConflict = true;
  }

  const required = managementOrderActions[selected] ?? [];
  if (required.length === 0) blockers.push(`MANAGEMENT_ACTION_NOT_CONNECTED:${selected}`);
  if (input.executionLegs.length !== required.length
    || input.executionLegs.some((leg, index) => leg.action !== required[index])) blockers.push('MANAGEMENT_EXECUTION_LEG_SEQUENCE_INVALID');
  const netCommitted = new Map<number, number>();
  for (const [index, leg] of input.executionLegs.entries()) {
    validateLegIdentity(input.state, leg, blockers);
    if (leg.action === 'OPEN_CC' || leg.action === 'ROLL_CC_OPEN') {
      // HDAC-05: coverage is ACCOUNT-NET. Shares already backing another short call (sibling chain, pending sell-to-open)
      // are not free. A roll's own close frees the contracts it is closing.
      const previous = input.executionLegs[index - 1];
      const ownClosing = leg.action === 'OPEN_CC' ? 0
        : previous?.action === 'ROLL_CC_CLOSE' ? previous.canonicalQuantity : null;
      const committed = input.committedShortCallContracts ?? null;
      const net = committed === null || ownClosing === null ? null : committed - ownClosing;
      if (net === null || !Number.isSafeInteger(net) || net < 0) blockers.push(`COMMITTED_SHORT_CALLS_UNKNOWN:${leg.action}`);
      else {
        const capacity = coveredCallContractCapacity(leg.confirmedCoveredShares ?? null, net, 0, leg.multiplier);
        if (capacity === null || capacity < leg.canonicalQuantity) blockers.push(`COVERED_CALL_ACCOUNT_NET_COVERAGE_INSUFFICIENT:${leg.action}`);
        netCommitted.set(index, net);
      }
    }
    if (leg.action === 'SELL_STOCK') {
      // Selling the underlying must never leave a short call uncovered. Chain coverage is account-net and the stock leg only
      // knows this chain's shares, so the account must be PROVEN to carry no short calls (or pending sell-to-open) on this
      // underlying. Unknown blocks; any committed call blocks (close or let it resolve first).
      const free = freeSellableShares(leg.canonicalQuantity, input.committedShortCallContracts, 100);
      if (free.state === 'UNKNOWN') blockers.push(free.reason === 'OVERCOMMITTED_INVALID_STATE'
        ? 'STOCK_SALE_WITH_SHORT_CALLS_COMMITTED:SELL_STOCK' : 'COMMITTED_SHORT_CALLS_UNKNOWN:SELL_STOCK');
      else if ((free.freeShares as number) < leg.canonicalQuantity) blockers.push('STOCK_SALE_WITH_SHORT_CALLS_COMMITTED:SELL_STOCK');
      else netCommitted.set(index, 0);
    }
    if (leg.action !== 'SELL_STOCK' && !input.optionsCapabilityVerified) blockers.push(`OPTIONS_CAPABILITY_NOT_VERIFIED:${leg.action}`);
    if (opensRisk.has(leg.action) && !['ALLOW_FULL', 'ALLOW_REDUCED'].includes(input.aegisState ?? '')) {
      blockers.push(`AEGIS_NOT_APPROVED_FOR_NEW_RISK:${leg.action}`);
    }
    // Bootstrap management must be able to manage the first bounded Paper
    // episode. A structurally positive, policy-selected roll-open or covered
    // call remains PAPER_EVIDENCE when empirical EV is unknown. The promoted
    // tier is reserved for evidence that genuinely carries a positive,
    // empirical after-cost EV. Both tiers still pass AEGIS, quote, coverage,
    // quantity, idempotency, and broker reconciliation gates downstream.
    if (opensRisk.has(leg.action) && leg.empiricalEconomicsReady
      && (leg.expectedAfterCostEv === null || leg.expectedAfterCostEv <= 0)) {
      blockers.push(`EMPIRICAL_ACTION_EV_INVALID:${leg.action}`);
    }
  }
  if (required.length === 2) {
    const close = input.executionLegs[0], open = input.executionLegs[1];
    if (close !== undefined && open !== undefined && open.canonicalQuantity > close.canonicalQuantity) {
      blockers.push('ROLL_OPEN_QUANTITY_EXCEEDS_CLOSE');
    }
  }
  if (blockers.length > 0 || input.executionAccountId === null || input.strategyVersion === null || input.aegisState === null
    || input.frontier.policyVersion === null || input.frontier.policyEvidenceHash === null) {
    return { state: 'BLOCKED', decision: null, plans: [], blockers: [...new Set(blockers)] };
  }

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
      executionTier: opensRisk.has(leg.action) && leg.empiricalEconomicsReady
        ? 'EMPIRICALLY_PROMOTED_PAPER' : 'PAPER_EVIDENCE',
      multiplier: leg.multiplier,
      ...(leg.confirmedCoveredShares === undefined ? {} : { confirmedCoveredShares: leg.confirmedCoveredShares }),
      ...(netCommitted.has(index) ? { committedShortCallContracts: netCommitted.get(index) as number } : {}),
      // SELL_STOCK: both share truths agreed (compile) and the free-sellable shares cover the whole position (checked above).
      ...(leg.action === 'SELL_STOCK' ? { brokerConfirmedShares: input.state.brokerStockInventory?.quantity as number,
        freeSellableShares: leg.canonicalQuantity } : {}),
      action: leg.action,
      economicBoundary: leg.economicBoundary,
      economicsRemainPositive: leg.economicsRemainPositive,
      expectedAfterCostEv: leg.expectedAfterCostEv,
      empiricalEconomicsReady: leg.empiricalEconomicsReady,
      selectedByCanonicalAuthority: true,
      hardValidityPassed: true,
      accountVerified: true,
      optionsCapabilityVerified: input.optionsCapabilityVerified,
      noEquivalentExposureConflict,
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
      managementPolicyVersion: input.frontier.policyVersion,
      managementPolicyEvidenceHash: input.frontier.policyEvidenceHash,
      authorityRef, decidedAt: input.now,
      reasonCodes: input.frontier.reasonCodes,
    },
  };
}
