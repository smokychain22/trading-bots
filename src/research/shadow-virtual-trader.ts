import { createHash } from 'node:crypto';
import { canonicalJson } from './point-in-time-evidence.js';

export const shadowSelectionPolicyVersion = 'theta-shadow-structural-baseline-v1' as const;
export const shadowFillPolicyVersion = 'theta-shadow-price-through-size-v1' as const;
export const shadowAccountingPolicyVersion = 'theta-shadow-csp-accounting-v1' as const;

export interface ShadowOpeningCandidate {
  readonly candidateId: string;
  readonly decisionId: string | null;
  readonly fusionSnapshotId: string;
  readonly optionContractId: string;
  readonly contractSymbol: string;
  readonly underlying: string;
  readonly optionType: 'PUT' | 'CALL';
  readonly strike: number;
  readonly expiration: string;
  readonly multiplier: number;
  readonly rank: number | null;
  readonly quantity: number;
  readonly ownershipScore: number | null;
  readonly bid: number | null;
  readonly ask: number | null;
  readonly bidSize: number | null;
  readonly askSize: number | null;
  readonly quoteTimestamp: string | null;
  readonly quoteQuality: string;
  readonly decisionTime: string;
  readonly strategyVersion: string;
  readonly riskVersion: string;
  readonly featureVersion: string;
  readonly costModelVersion: string;
  readonly executionModelVersion: string;
}

export interface ShadowOpeningSelection {
  readonly candidate: ShadowOpeningCandidate | null;
  readonly reasonCodes: readonly string[];
  readonly empiricalEvReady: false;
  readonly executionAuthorized: false;
}

const validOpeningCandidate = (candidate: ShadowOpeningCandidate): boolean =>
  candidate.optionType === 'PUT'
  && Number.isInteger(candidate.quantity) && candidate.quantity > 0
  && Number.isFinite(candidate.strike) && candidate.strike > 0
  && Number.isFinite(candidate.multiplier) && candidate.multiplier > 0
  && candidate.bid !== null && candidate.ask !== null
  && candidate.bid > 0 && candidate.ask >= candidate.bid
  && candidate.quoteQuality === 'GOOD';

/**
 * Picks one research-only CSP candidate across the complete scan. Ranking is
 * structural and deterministic. It never claims empirical EV or execution
 * authorization. The executable strategy remains blocked until R6 evidence.
 */
export function selectShadowOpeningCandidate(candidates: readonly ShadowOpeningCandidate[]): ShadowOpeningSelection {
  const eligible = candidates.filter(validOpeningCandidate).toSorted((left, right) => {
    const ownership = (right.ownershipScore ?? -1) - (left.ownershipScore ?? -1);
    if (ownership !== 0) return ownership;
    const rank = (left.rank ?? Number.MAX_SAFE_INTEGER) - (right.rank ?? Number.MAX_SAFE_INTEGER);
    if (rank !== 0) return rank;
    const collateral = left.strike * left.multiplier * left.quantity - right.strike * right.multiplier * right.quantity;
    return collateral !== 0 ? collateral : left.contractSymbol.localeCompare(right.contractSymbol);
  });
  const selected = eligible[0] ?? null;
  return {
    candidate: selected,
    reasonCodes: selected === null
      ? ['SHADOW_WAIT_NO_STRUCTURALLY_FEASIBLE_CANDIDATE']
      : ['RESEARCH_ONLY_STRUCTURAL_RANK', 'EMPIRICAL_EV_UNKNOWN', 'BROKER_EXECUTION_LOCKED'],
    empiricalEvReady: false,
    executionAuthorized: false,
  };
}

export type ShadowFillState = 'FILLED_SHADOW' | 'PARTIAL_SHADOW' | 'UNFILLED_SHADOW'
  | 'EXPIRED_UNFILLED' | 'UNKNOWN_EXECUTABILITY';

export interface ShadowFillAssessment {
  readonly state: ShadowFillState;
  readonly filledQuantity: number | null;
  readonly remainingQuantity: number;
  readonly fillPrice: number | null;
  readonly reasonCode: string;
}

/**
 * Conservative fill evidence. A quote equal to the limit is only a touch and
 * remains UNKNOWN because queue priority is unknown. A fill needs a later
 * price-through and displayed size. No midpoint or decision-time fill exists.
 */
export function classifyConservativeShadowFill(input: {
  side: 'BUY' | 'SELL'; requestedQuantity: number; limit: number;
  bid: number | null; ask: number | null; bidSize: number | null; askSize: number | null;
  finalObservation: boolean;
}): ShadowFillAssessment {
  if (!Number.isInteger(input.requestedQuantity) || input.requestedQuantity <= 0 || !Number.isFinite(input.limit) || input.limit <= 0) {
    throw new Error('SHADOW_FILL_INPUT_INVALID');
  }
  if (input.bid === null || input.ask === null || input.bid < 0 || input.ask <= 0 || input.bid > input.ask) {
    return { state:'UNKNOWN_EXECUTABILITY',filledQuantity:null,remainingQuantity:input.requestedQuantity,fillPrice:null,reasonCode:'VALID_SUBSEQUENT_BBO_MISSING' };
  }
  const marketPrice = input.side === 'SELL' ? input.bid : input.ask;
  const displayedSize = input.side === 'SELL' ? input.bidSize : input.askSize;
  const priceThrough = input.side === 'SELL' ? marketPrice > input.limit : marketPrice < input.limit;
  const touched = marketPrice === input.limit;
  if (!priceThrough) {
    if (touched) return { state:'UNKNOWN_EXECUTABILITY',filledQuantity:null,remainingQuantity:input.requestedQuantity,fillPrice:null,reasonCode:'LIMIT_TOUCHED_QUEUE_UNKNOWN' };
    return { state:input.finalObservation?'EXPIRED_UNFILLED':'UNFILLED_SHADOW',filledQuantity:null,
      remainingQuantity:input.requestedQuantity,fillPrice:null,reasonCode:input.finalObservation?'NO_PRICE_THROUGH_BY_FINAL_OBSERVATION':'LIMIT_NOT_REACHED' };
  }
  if (displayedSize === null || !Number.isFinite(displayedSize)) {
    return { state:'UNKNOWN_EXECUTABILITY',filledQuantity:null,remainingQuantity:input.requestedQuantity,fillPrice:null,reasonCode:'PRICE_THROUGH_SIZE_UNKNOWN' };
  }
  const fillable = Math.min(input.requestedQuantity, Math.max(0, Math.floor(displayedSize)));
  if (fillable === 0) return { state:'UNKNOWN_EXECUTABILITY',filledQuantity:null,remainingQuantity:input.requestedQuantity,fillPrice:null,reasonCode:'PRICE_THROUGH_NO_DISPLAYED_SIZE' };
  return fillable === input.requestedQuantity
    ? { state:'FILLED_SHADOW',filledQuantity:fillable,remainingQuantity:0,fillPrice:input.limit,reasonCode:'LATER_PRICE_THROUGH_WITH_DISPLAYED_SIZE' }
    : { state:'PARTIAL_SHADOW',filledQuantity:fillable,remainingQuantity:input.requestedQuantity-fillable,fillPrice:input.limit,reasonCode:'LATER_PRICE_THROUGH_PARTIAL_DISPLAYED_SIZE' };
}

export interface ShadowCspAccountState {
  readonly cash: number;
  readonly equity: number;
  readonly reservedCollateral: number;
  readonly buyingPower: number;
  readonly realizedPnl: number;
  readonly unrealizedPnl: number;
  readonly openOptionContracts: number;
}

export function applyShadowCspOpening(input: {
  prior: ShadowCspAccountState; quantity: number; strike: number; multiplier: number;
  fillPrice: number; markAsk: number; modeledCost: number;
}): ShadowCspAccountState {
  const values = [input.strike,input.multiplier,input.fillPrice,input.markAsk];
  if (!Number.isInteger(input.quantity) || input.quantity <= 0 || values.some((value)=>!Number.isFinite(value)||value<=0)) {
    throw new Error('SHADOW_CSP_ACCOUNTING_INPUT_INVALID');
  }
  const collateral = input.strike * input.multiplier * input.quantity;
  if (collateral > input.prior.buyingPower) throw new Error('SHADOW_COLLATERAL_EXCEEDS_BUYING_POWER');
  const premium = input.fillPrice * input.multiplier * input.quantity;
  if (!Number.isFinite(input.modeledCost) || input.modeledCost < 0) throw new Error('SHADOW_COST_MODEL_INVALID');
  const cost = input.modeledCost;
  const optionMtm = (input.fillPrice - input.markAsk) * input.multiplier * input.quantity;
  return {
    cash: input.prior.cash + premium - cost,
    equity: input.prior.equity + optionMtm - cost,
    reservedCollateral: input.prior.reservedCollateral + collateral,
    buyingPower: input.prior.buyingPower - collateral,
    realizedPnl: input.prior.realizedPnl - cost,
    unrealizedPnl: input.prior.unrealizedPnl + optionMtm,
    openOptionContracts: input.prior.openOptionContracts + input.quantity,
  };
}

export function shadowContentHash(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}
