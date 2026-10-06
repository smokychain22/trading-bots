import { createHash } from 'node:crypto';
import type { BrokerOrderLegSnapshot, BrokerOrderRequest, BrokerOrderSnapshot } from './broker.js';
import { multiLegPackageIdentity } from './broker.js';
import type { PaperOrderGate, PrepareIntentInput } from './paper-order-coordinator.js';
import { economicIdentitySeed, generateClientOrderId } from '../theta/order-intent-state.js';
import type { DefinedRiskLockedPlan } from '../research/defined-risk-locked-plan.js';
import { assertStrategyPaperOrderAllowed, type StrategyPaperAuthorityReceipt } from '../theta/strategy-paper-authority.js';

export const definedRiskPaperOrderVersion = 'theta-defined-risk-paper-order-v1' as const;

export type DefinedRiskParentState = 'PARENT_PENDING' | 'PARENT_WORKING' | 'PARTIALLY_FILLED'
  | 'FULLY_FILLED' | 'CANCEL_PENDING' | 'CANCELLED' | 'REJECTED' | 'UNKNOWN_RECONCILING';

export interface DefinedRiskLegState {
  readonly brokerLegId: string;
  readonly symbol: string;
  readonly requestedQty: number;
  readonly filledQty: number;
  readonly remainingQty: number;
  readonly averageFillPrice: number | null;
  readonly status: string;
}

export interface DefinedRiskExecutionState {
  readonly contractVersion: typeof definedRiskPaperOrderVersion;
  readonly parentOrderId: string;
  readonly parentState: DefinedRiskParentState;
  readonly parentRequestedQty: number;
  readonly parentFilledQty: number;
  readonly legs: readonly DefinedRiskLegState[];
  readonly asymmetricLegRisk: boolean;
  readonly requiresReconciliation: boolean;
}

export interface BuildDefinedRiskPaperCommandInput {
  readonly plan: DefinedRiskLockedPlan;
  readonly authorization: StrategyPaperAuthorityReceipt;
  readonly executionAccountId: string;
  readonly decisionId: string;
  readonly chainId: string;
  readonly underlyingId: string;
  readonly canonicalQuantity: number;
  readonly paperEvidenceQuantity: number;
  readonly paperEvidenceRiskCap: number;
  readonly limitCreditPerShare: number;
  readonly decisionExpiresAt: string;
  readonly now: string;
  readonly maximumQuoteAgeSeconds: number;
  readonly attempt: number;
  readonly legContractEvidence: readonly [{
    readonly optionContractId:string; readonly providerContractId:string; readonly deliverableIdentity:string;
  },{
    readonly optionContractId:string; readonly providerContractId:string; readonly deliverableIdentity:string;
  }];
}

export interface DefinedRiskPaperCommand extends PrepareIntentInput {
  readonly action: 'OPEN_DEFINED_RISK';
  readonly gate: PaperOrderGate;
}

const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const deterministicUuid = (value: string): string => {
  const bytes = Buffer.from(hash(value).slice(0, 32), 'hex');
  const version = bytes.at(6), variant = bytes.at(8);
  if (version === undefined || variant === undefined) throw new Error('DEFINED_RISK_ID_INVALID');
  bytes[6] = (version & 0x0f) | 0x40;
  bytes[8] = (variant & 0x3f) | 0x80;
  const encoded = bytes.toString('hex');
  return `${encoded.slice(0,8)}-${encoded.slice(8,12)}-${encoded.slice(12,16)}-${encoded.slice(16,20)}-${encoded.slice(20)}`;
};

/**
 * Builds one native Alpaca mleg parent. No naked-leg fallback exists. Each
 * leg uses the exact finalist OCC identity and ratio one. Quote evidence is
 * checked again at command creation, immediately before the coordinator.
 */
export function buildDefinedRiskPaperCommand(input: BuildDefinedRiskPaperCommandInput): DefinedRiskPaperCommand {
  const { plan, authorization } = input;
  try {
    assertStrategyPaperOrderAllowed(authorization, 'THETA_DEFINED_RISK');
  } catch {
    throw new Error('DEFINED_RISK_AUTHORITY_INCOMPLETE');
  }
  if (plan.brokerMultiLegSupport !== 'ATOMIC_MULTI_LEG_SUPPORTED') throw new Error('DEFINED_RISK_BROKER_CAPABILITY_UNPROVEN');
  if (plan.aegisReceipt.state !== 'ALLOW_FULL' && plan.aegisReceipt.state !== 'ALLOW_REDUCED') {
    throw new Error('DEFINED_RISK_AEGIS_NOT_EXECUTION_AUTHORIZED');
  }
  if (!Number.isSafeInteger(input.canonicalQuantity) || !Number.isSafeInteger(input.paperEvidenceQuantity)
    || input.paperEvidenceQuantity <= 0 || input.paperEvidenceQuantity > input.canonicalQuantity
    || input.paperEvidenceQuantity > input.paperEvidenceRiskCap || input.paperEvidenceQuantity !== plan.quantity) {
    throw new Error('DEFINED_RISK_QUANTITY_INVALID');
  }
  const [shortLeg, longLeg] = plan.legs;
  if (shortLeg.expiration !== longLeg.expiration || shortLeg.multiplier !== longLeg.multiplier
    || shortLeg.quantity !== longLeg.quantity || shortLeg.quantity !== input.paperEvidenceQuantity
    || shortLeg.strike <= longLeg.strike || shortLeg.side !== 'SELL_TO_OPEN' || longLeg.side !== 'BUY_TO_OPEN') {
    throw new Error('DEFINED_RISK_STRUCTURE_INVALID');
  }
  const nowMs = Date.parse(input.now), expiryMs = Date.parse(input.decisionExpiresAt);
  if (!Number.isFinite(nowMs) || !Number.isFinite(expiryMs) || expiryMs <= nowMs) throw new Error('DEFINED_RISK_DECISION_EXPIRED');
  for (const leg of plan.legs) {
    const quoteMs = Date.parse(leg.quoteTimestamp);
    const age = (nowMs - quoteMs) / 1000;
    if (!Number.isFinite(age) || age < 0 || age > input.maximumQuoteAgeSeconds || leg.bid <= 0 || leg.ask < leg.bid) {
      throw new Error('DEFINED_RISK_LEG_QUOTE_NOT_EXECUTABLE');
    }
  }
  const executableCredit = shortLeg.bid - longLeg.ask;
  const width = shortLeg.strike - longLeg.strike;
  if (!Number.isFinite(input.limitCreditPerShare) || input.limitCreditPerShare <= 0
    || input.limitCreditPerShare > executableCredit || input.limitCreditPerShare >= width
    || Number(input.limitCreditPerShare.toFixed(2)) !== input.limitCreditPerShare) {
    throw new Error('DEFINED_RISK_LIMIT_CREDIT_INVALID');
  }
  const legs = [
    { symbol: shortLeg.occSymbol, side: 'sell' as const, ratio_qty: 1, position_intent: 'sell_to_open' as const },
    { symbol: longLeg.occSymbol, side: 'buy' as const, ratio_qty: 1, position_intent: 'buy_to_open' as const },
  ] as const;
  const packageIdentity = multiLegPackageIdentity(legs);
  if(input.legContractEvidence.some(item=>!item.optionContractId.trim()||!item.providerContractId.trim()
    ||!item.deliverableIdentity.trim()))throw new Error('DEFINED_RISK_CONTRACT_EVIDENCE_INVALID');
  const identitySeed = economicIdentitySeed({ candidateId: plan.candidateId, strategyVersion: plan.strategyVersion,
    action: 'OPEN_DEFINED_RISK', chainId: input.chainId });
  const clientOrderId = generateClientOrderId(input.decisionId, identitySeed, input.attempt);
  const request: BrokerOrderRequest = { symbol: packageIdentity, side: 'sell', qty: input.paperEvidenceQuantity,
    // Alpaca mleg signs the parent price from the account's perspective:
    // a credit is negative and a debit is positive.
    type: 'limit', time_in_force: 'day', limit_price: (-input.limitCreditPerShare).toFixed(2), client_order_id: clientOrderId,
    order_class: 'mleg', legs };
  const orderIntentId = deterministicUuid(JSON.stringify(['theta-defined-risk-order-intent-v1', input.executionAccountId,
    input.decisionId, identitySeed, input.attempt]));
  return {
    orderIntentId, executionAccountId: input.executionAccountId, request, action: 'OPEN_DEFINED_RISK',
    decisionId: input.decisionId, persistedAt: input.now,
    chainId: input.chainId, optionContractId: null, underlyingId: input.underlyingId,
    multiLegEvidence:{orderClass:'mleg',creditDebitDirection:'CREDIT',packageIdentity,legs:plan.legs.map((leg,index)=>({
      legIndex:index+1,optionContractId:input.legContractEvidence[index]?.optionContractId??'',
      providerContractId:input.legContractEvidence[index]?.providerContractId??'',occSymbol:leg.occSymbol,
      optionType:leg.optionType,positionIntent:index===0?'sell_to_open' as const:'buy_to_open' as const,
      ratioQuantity:1,expiration:leg.expiration,strike:leg.strike,multiplier:leg.multiplier,
      deliverableIdentity:input.legContractEvidence[index]?.deliverableIdentity??'',
    }))},
    executionEvidence: { quoteSource: 'ALPACA', quoteFeed: 'OPRA', quoteSemantics: 'CONSOLIDATED_NBBO',
      quoteAsOf: new Date(Math.max(...plan.legs.map((leg) => Date.parse(leg.quoteTimestamp)))).toISOString(),
      decisionExpiresAt: input.decisionExpiresAt, quoteContentHash: hash(plan.legs), aegisState: plan.aegisReceipt.state === 'ALLOW_REDUCED'
        ? 'ALLOW_REDUCED' : 'ALLOW_FULL' },
    authorizationEvidence: { executionTier: 'PAPER_EVIDENCE', canonicalQuantity: input.canonicalQuantity,
      paperEvidenceQuantity: input.paperEvidenceQuantity, empiricalEconomicsReady: false, expectedAfterCostEv: null },
    gate: { baseHostname: 'paper-api.alpaca.markets', accountVerified: true, optionsCapabilityVerified: true,
      aegisState: plan.aegisReceipt.state === 'ALLOW_REDUCED' ? 'ALLOW_REDUCED' : 'ALLOW_FULL', quoteFresh: true,
      priceEvidence: 'QUALIFIED_OPTION_BBO', decisionExpiresAt: input.decisionExpiresAt, now: input.now, isNewEntry: true },
  } as DefinedRiskPaperCommand;
}

const stateForStatus = (status: string): DefinedRiskParentState => {
  const normalized = status.toLowerCase();
  if (normalized === 'filled') return 'FULLY_FILLED';
  if (['partially_filled','partial_fill'].includes(normalized)) return 'PARTIALLY_FILLED';
  if (['pending_cancel'].includes(normalized)) return 'CANCEL_PENDING';
  if (['canceled','cancelled','expired'].includes(normalized)) return 'CANCELLED';
  if (['rejected'].includes(normalized)) return 'REJECTED';
  if (['accepted','new','pending_new','accepted_for_bidding'].includes(normalized)) return 'PARENT_WORKING';
  return 'UNKNOWN_RECONCILING';
};

/** Preserve parent and per-leg truth. A parent fill with incomplete leg truth
 * is an unresolved broker inconsistency, never a fabricated atomic fill. */
export function reconcileDefinedRiskParent(order: BrokerOrderSnapshot): DefinedRiskExecutionState {
  if (order.orderClass !== 'mleg' || order.legs === undefined || order.legs.length < 2) {
    throw new Error('DEFINED_RISK_PARENT_SNAPSHOT_REQUIRED');
  }
  const legs = order.legs.map((leg: BrokerOrderLegSnapshot): DefinedRiskLegState => {
    const requestedQty = order.qty * leg.ratioQty;
    return { brokerLegId: leg.id, symbol: leg.symbol, requestedQty, filledQty: leg.filledQty,
      remainingQty: requestedQty - leg.filledQty, averageFillPrice: leg.filledAvgPrice, status: leg.status };
  });
  const filledRatios = legs.map((leg, index) => leg.filledQty / (order.legs?.[index]?.ratioQty ?? 1));
  const asymmetricLegRisk = filledRatios.some((filled) => filled !== filledRatios[0]);
  let parentState = stateForStatus(order.status);
  if (order.filledQty > 0 && order.filledQty < order.qty) parentState = 'PARTIALLY_FILLED';
  if (parentState === 'FULLY_FILLED' && (asymmetricLegRisk || legs.some((leg) => leg.remainingQty !== 0))) {
    parentState = 'UNKNOWN_RECONCILING';
  }
  return { contractVersion: definedRiskPaperOrderVersion, parentOrderId: order.id, parentState,
    parentRequestedQty: order.qty, parentFilledQty: order.filledQty, legs, asymmetricLegRisk,
    requiresReconciliation: asymmetricLegRisk || parentState === 'UNKNOWN_RECONCILING' };
}
