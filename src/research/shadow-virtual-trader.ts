import { createHash } from 'node:crypto';
import { canonicalJson } from './point-in-time-evidence.js';

export const shadowSelectionPolicyVersion = 'theta-paper-active-baseline-v2' as const;
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
  readonly candidateAssessments: readonly ShadowCandidateAssessment[];
  readonly paretoFrontierCandidateIds: readonly string[];
  readonly whyNotWait: Readonly<Record<string, unknown>>;
  readonly empiricalEvReady: false;
  readonly executionAuthorized: false;
}

export interface ShadowCandidateAssessment {
  readonly candidateId: string;
  readonly eligible: boolean;
  readonly hardBlockers: readonly string[];
  readonly structuralPremiumReturnPerCapitalDay: number | null;
  readonly spreadPct: number | null;
  readonly ownershipScore: number | null;
  readonly dominatedBy: readonly string[];
}

function assess(candidate: ShadowOpeningCandidate): Omit<ShadowCandidateAssessment, 'dominatedBy'> {
  const blockers: string[] = [];
  if (candidate.optionType !== 'PUT') blockers.push('BASELINE_REQUIRES_CSP_PUT');
  if (!Number.isInteger(candidate.quantity) || candidate.quantity <= 0) blockers.push('QUANTITY_ZERO_OR_INVALID');
  if (!Number.isFinite(candidate.strike) || candidate.strike <= 0) blockers.push('STRIKE_INVALID');
  if (!Number.isFinite(candidate.multiplier) || candidate.multiplier <= 0) blockers.push('MULTIPLIER_INVALID');
  if (candidate.bid === null || candidate.ask === null || candidate.bid <= 0 || candidate.ask < candidate.bid) blockers.push('TWO_SIDED_BBO_INVALID');
  if (candidate.quoteQuality !== 'GOOD') blockers.push('QUOTE_QUALITY_NOT_GOOD');
  if (candidate.quoteTimestamp === null) blockers.push('QUOTE_TIMESTAMP_UNKNOWN');
  if (candidate.ownershipScore === null) blockers.push('OWNERSHIP_SCORE_UNKNOWN');
  const decisionMs=Date.parse(candidate.decisionTime),expirationMs=Date.parse(`${candidate.expiration}T20:00:00.000Z`);
  const dte=Number.isFinite(decisionMs)&&Number.isFinite(expirationMs)?Math.max(1,Math.ceil((expirationMs-decisionMs)/86_400_000)):null;
  const collateral=candidate.strike*candidate.multiplier;
  const premium=candidate.bid===null?null:candidate.bid*candidate.multiplier;
  const structuralReturn=premium!==null&&collateral>0&&dte!==null?premium/collateral/dte:null;
  const spread=candidate.bid!==null&&candidate.ask!==null&&candidate.ask+candidate.bid>0
    ? (candidate.ask-candidate.bid)/((candidate.ask+candidate.bid)/2):null;
  if (structuralReturn===null||!Number.isFinite(structuralReturn)||structuralReturn<=0) blockers.push('STRUCTURAL_PREMIUM_RETURN_INVALID');
  if (spread===null||!Number.isFinite(spread)||spread<0) blockers.push('SPREAD_INVALID');
  return {candidateId:candidate.candidateId,eligible:blockers.length===0,hardBlockers:blockers,
    structuralPremiumReturnPerCapitalDay:structuralReturn,spreadPct:spread,ownershipScore:candidate.ownershipScore};
}

function dominates(left:Omit<ShadowCandidateAssessment,'dominatedBy'>,right:Omit<ShadowCandidateAssessment,'dominatedBy'>):boolean{
  if(!left.eligible||!right.eligible||left.structuralPremiumReturnPerCapitalDay===null||right.structuralPremiumReturnPerCapitalDay===null
    ||left.spreadPct===null||right.spreadPct===null||left.ownershipScore===null||right.ownershipScore===null)return false;
  const noWorse=left.structuralPremiumReturnPerCapitalDay>=right.structuralPremiumReturnPerCapitalDay
    &&left.spreadPct<=right.spreadPct&&left.ownershipScore>=right.ownershipScore;
  const better=left.structuralPremiumReturnPerCapitalDay>right.structuralPremiumReturnPerCapitalDay
    ||left.spreadPct<right.spreadPct||left.ownershipScore>right.ownershipScore;
  return noWorse&&better;
}

/**
 * Picks one research-only CSP candidate across the complete scan. Ranking is
 * structural and deterministic. It never claims empirical EV or execution
 * authorization. The executable strategy remains blocked until R6 evidence.
 */
export function selectShadowOpeningCandidate(candidates: readonly ShadowOpeningCandidate[]): ShadowOpeningSelection {
  const initial=candidates.map(assess);
  const assessments:ShadowCandidateAssessment[]=initial.map((candidate)=>({...candidate,
    dominatedBy:initial.filter((other)=>dominates(other,candidate)).map((other)=>other.candidateId).sort()}));
  const frontierIds=new Set(assessments.filter((candidate)=>candidate.eligible&&candidate.dominatedBy.length===0).map((candidate)=>candidate.candidateId));
  const eligible = candidates.filter((candidate)=>frontierIds.has(candidate.candidateId)).toSorted((left, right) => {
    const la=assessments.find((item)=>item.candidateId===left.candidateId);
    const ra=assessments.find((item)=>item.candidateId===right.candidateId);
    const structural=(ra?.structuralPremiumReturnPerCapitalDay??-1)-(la?.structuralPremiumReturnPerCapitalDay??-1);
    if(structural!==0)return structural;
    const spread=(la?.spreadPct??Number.MAX_SAFE_INTEGER)-(ra?.spreadPct??Number.MAX_SAFE_INTEGER);
    if(spread!==0)return spread;
    const ownership=(ra?.ownershipScore??-1)-(la?.ownershipScore??-1);
    if(ownership!==0)return ownership;
    const rank=(left.rank??Number.MAX_SAFE_INTEGER)-(right.rank??Number.MAX_SAFE_INTEGER);
    return rank!==0?rank:left.contractSymbol.localeCompare(right.contractSymbol);
  });
  const selected = eligible[0] ?? null;
  const hardBlocked=assessments.filter((candidate)=>!candidate.eligible).map((candidate)=>candidate.candidateId);
  return {
    candidate: selected,
    reasonCodes: selected === null
      ? ['PAPER_BASELINE_WAIT_NO_STRUCTURALLY_FEASIBLE_CANDIDATE']
      : ['PAPER_ACTIVE_BASELINE_PARETO_FRONTIER', 'EMPIRICAL_EV_UNKNOWN', 'BROKER_EXECUTION_LOCKED'],
    candidateAssessments:assessments,
    paretoFrontierCandidateIds:[...frontierIds].sort(),
    whyNotWait:{policyVersion:shadowSelectionPolicyVersion,candidatesEvaluated:candidates.length,
      structurallyEligible:assessments.filter((candidate)=>candidate.eligible).length,hardBlockedCandidateIds:hardBlocked,
      selectedCandidateId:selected?.candidateId??null,selectionBasis:'STRUCTURAL_PARETO_NO_EMPIRICAL_EV',
      empiricalEvReady:false,brokerExecutionLocked:true},
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
