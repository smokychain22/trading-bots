import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { JsonValue } from '../market/fusion-snapshot.js';
import type { CanonicalFrontierCandidate, CanonicalStrategyFrontier } from './canonical-strategy-frontier.js';
import type { NormalizedOptionContract } from './option-contract.js';

export const optionsChainDecisionVersion = 'theta-options-chain-decision-v1' as const;
export const optionsChainCounterfactualVersion = 'theta-options-chain-counterfactual-label-v1' as const;

export type ChainValueState = 'KNOWN' | 'UNKNOWN' | 'INVALID';
export interface ChainValue<T> { readonly value:T|null; readonly state:ChainValueState; readonly reason:string|null }

export interface OptionLiquidityResearchPolicy {
  readonly policyVersion:string;
  readonly maximumQuoteAgeSeconds:number|null;
  readonly maximumRelativeSpread:number|null;
  readonly minimumOpenInterest:{readonly value:number;readonly role:'HARD'|'SOFT'}|null;
  readonly minimumVolume:{readonly value:number;readonly role:'HARD'|'SOFT'}|null;
  readonly minimumBidSize:{readonly value:number;readonly role:'HARD'|'SOFT'}|null;
  readonly minimumAskSize:{readonly value:number;readonly role:'HARD'|'SOFT'}|null;
}

export interface ChainScopedAttachment {
  readonly family:'IV'|'IV_HISTORY'|'IV_RANK'|'IV_PERCENTILE'|'EXPECTED_MOVE'|'SKEW'|'TERM'|'SURFACE'|'FLOW'|'UOA'|'GEX'|'DEX'|'VANNA'|'CHARM'|'GAMMA_FLIP'|'WALLS'|'EVENTS'|'EARNINGS';
  readonly scope:'CONTRACT'|'STRIKE'|'EXPIRATION'|'CHAIN';
  readonly scopeKey:string;
  readonly classification:'PROVIDER_FACT'|'THETA_DERIVED'|'THETA_INFERENCE';
  readonly state:ChainValueState;
  readonly value:JsonValue;
  readonly providerTimestamp:string|null;
  readonly reason:string|null;
}

export interface ChainContractEvidence {
  readonly optionSymbol:string;
  readonly underlying:string;
  readonly expiration:string;
  readonly dte:number;
  readonly optionType:'CALL'|'PUT';
  readonly strike:number;
  readonly multiplier:number;
  readonly spot:number|null;
  readonly moneyness:number|null;
  readonly bid:number|null;
  readonly ask:number|null;
  readonly midpointReference:number|null;
  readonly spread:number|null;
  readonly relativeSpread:number|null;
  readonly bidSize:number|null;
  readonly askSize:number|null;
  readonly quoteTimestamp:string|null;
  readonly receivedAt:string;
  readonly dataAgeSeconds:number|null;
  readonly quoteAgeSeconds:number|null;
  readonly iv:number|null;
  readonly delta:number|null;
  readonly gamma:number|null;
  readonly theta:number|null;
  readonly vega:number|null;
  readonly rho:number|null;
  readonly volume:number|null;
  readonly openInterest:number|null;
  readonly volumeToOpenInterest:number|null;
  readonly intrinsicAtSpot:number|null;
  readonly extrinsicAtMidReference:number|null;
  readonly theoreticalModelValue:ChainValue<number>;
  readonly breakeven:number|null;
  readonly distanceToStrikePct:number|null;
  readonly distanceToBreakevenPct:number|null;
  readonly expectedMoveDistance:number|null;
  readonly expectedMoveNormalizedDistance:number|null;
  readonly quoteSource:string;
  readonly feed:string|null;
  readonly dataQuality:string;
  readonly researchUsable:boolean;
  readonly executionUsable:boolean;
  readonly hardLiquidityBlockers:readonly string[];
  readonly softLiquidityEvidence:readonly string[];
  readonly unknownReasons:readonly string[];
  readonly deltaGridDistances:Readonly<Record<string,number|null>>;
}

export interface ExpirationResearchFrontier {
  readonly expiration:string;
  readonly dte:number;
  readonly availableContracts:number;
  readonly usableContracts:number;
  readonly availableStrikes:number;
  readonly representativeRelativeSpread:number|null;
  readonly representativeIv:number|null;
  readonly expectedMove:number|null;
  readonly eventCrossing:ChainValue<boolean>;
  readonly earningsCrossing:ChainValue<boolean>;
  readonly exDividendCrossing:ChainValue<boolean>;
  readonly maximumPutBidPremium:number|null;
  readonly minimumCspCollateral:number|null;
  readonly strategyApplicability:readonly string[];
  readonly paretoDominatedBy:readonly string[];
  readonly unknownReasons:readonly string[];
}

export interface StrikeDeltaFrontier {
  readonly expiration:string;
  readonly optionType:'CALL'|'PUT';
  readonly contractIds:readonly string[];
  readonly strikeOrder:readonly number[];
  readonly deltaOrder:readonly string[];
  readonly ivOrder:readonly string[];
  readonly openInterestOrder:readonly string[];
  readonly volumeOrder:readonly string[];
  readonly liquidityOrder:readonly string[];
  readonly breakevenOrder:readonly string[];
  readonly selectedContractId:string|null;
}

export interface StructureResearchComparison {
  readonly structure:'CSP'|'DEFINED_RISK'|'HOLD_STRIKE'|'RECOVERY'|'CC'|'WAIT';
  readonly candidateId:string;
  readonly branch:string;
  readonly legIds:readonly string[];
  readonly snapshotId:string;
  readonly afterCostValue:null;
  readonly tailRisk:number|null;
  readonly capitalRequired:number|null;
  readonly capitalDays:number|null;
  readonly liquidity:number|null;
  readonly assignmentExposure:number|null;
  readonly executionComplexity:number;
  readonly portfolioImpact:null;
  readonly knownStructuralEconomics:CanonicalFrontierCandidate['economics']|null;
  readonly paretoRank:number|null;
  readonly selected:boolean;
  readonly hardBlockers:readonly string[];
  readonly unknownEvidence:readonly string[];
  readonly executionAuthorized:false;
}

export interface OptionsChainDecisionEvidence {
  readonly contractVersion:typeof optionsChainDecisionVersion;
  readonly fusionSnapshotId:string;
  readonly snapshotContentHash:string;
  readonly observedAt:string;
  readonly underlying:string;
  readonly spot:ChainValue<number>;
  readonly underlyingTimestamp:string|null;
  readonly liquidityPolicy:OptionLiquidityResearchPolicy;
  readonly contracts:readonly ChainContractEvidence[];
  readonly expirationFrontier:readonly ExpirationResearchFrontier[];
  readonly strikeDeltaFrontiers:readonly StrikeDeltaFrontier[];
  readonly structureComparisons:readonly StructureResearchComparison[];
  readonly optionomicsAttachments:readonly ChainScopedAttachment[];
  readonly contractSelectionReceipt:{
    readonly selectedContractId:string|null;
    readonly selectedCandidateId:string|null;
    readonly selectionState:'STRUCTURAL_RESEARCH_ONLY'|'WAIT'|'SYSTEM_HOLD';
    readonly whyThisExpiration:readonly string[];
    readonly whyThisStrike:readonly string[];
    readonly whyThisDelta:readonly string[];
    readonly whyThisStructure:readonly string[];
    readonly whyThisLiquidity:readonly string[];
    readonly whyNow:readonly string[];
    readonly whyNotNeighboringStrike:readonly string[];
    readonly whyNotOtherExpiration:readonly string[];
    readonly whyNotOtherStrategy:readonly string[];
    readonly whyNotWait:readonly string[];
  };
  readonly counterfactualLabelContract:{
    readonly contractVersion:typeof optionsChainCounterfactualVersion;
    readonly featureCutoff:string;
    readonly subjects:readonly {readonly subjectType:'SELECTED_STRIKE'|'NEIGHBOR_STRIKE'|'OTHER_EXPIRATION'|'OTHER_STRUCTURE'|'WAIT';readonly subjectId:string;readonly outcome:null;readonly labelAvailableAt:null;readonly state:'BLOCKED_ON_FUTURE_OUTCOME'}[];
  };
  readonly empiricalEconomicsReady:false;
  readonly executionAuthorized:false;
  readonly contentHash:string;
}

const deltaGrid=[0.10,0.15,0.20,0.25,0.30,0.35,0.40] as const;
const finite=(value:number|null):value is number=>value!==null&&Number.isFinite(value);
const known=<T>(value:T):ChainValue<T>=>({value,state:'KNOWN',reason:null});
const unknown=<T>(reason:string):ChainValue<T>=>({value:null,state:'UNKNOWN',reason});
const median=(values:readonly number[]):number|null=>{
  if(values.length===0)return null;
  const sorted=[...values].sort((a,b)=>a-b),middle=Math.floor(sorted.length/2);
  return sorted.length%2===0?((sorted[middle-1] as number)+(sorted[middle] as number))/2:sorted[middle]??null;
};
const stable=(value:unknown):string=>{
  if(Array.isArray(value))return `[${value.map(stable).join(',')}]`;
  if(value!==null&&typeof value==='object')return `{${Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b)).map(([key,child])=>`${JSON.stringify(key)}:${stable(child)}`).join(',')}}`;
  return JSON.stringify(value);
};
const digest=(value:unknown):string=>createHash('sha256').update(stable(value)).digest('hex');
const record=(value:unknown):Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};

/** Maps only fields already normalized by optionomics-feature-engine.ts. */
export function optionomicsChainAttachmentsFromFeatureState(value:JsonValue):readonly ChainScopedAttachment[]{
  const root=record(value),attachments:ChainScopedAttachment[]=[];
  const add=(family:ChainScopedAttachment['family'],scope:ChainScopedAttachment['scope'],scopeKey:string,
    classification:ChainScopedAttachment['classification'],feature:unknown,providerTimestamp:string|null=null):void=>{
    const wrapped=record(feature),state=wrapped.state;
    if(state!=='KNOWN'&&state!=='UNKNOWN'&&state!=='INVALID')return;
    attachments.push({family,scope,scopeKey,classification,state,value:(wrapped.value??null) as JsonValue,
      providerTimestamp,reason:typeof wrapped.reason==='string'?wrapped.reason:null});
  };
  for(const item of Array.isArray(root.contracts)?root.contracts:[]){
    const contract=record(item),symbol=typeof contract.contractSymbol==='string'?contract.contractSymbol:null;
    if(symbol===null)continue;
    const volatility=record(contract.volatility),greeks=record(contract.greeks),structure=record(contract.marketStructure);
    const identity=record(contract.identity),economics=record(contract.structuralEconomics);
    add('IV','CONTRACT',symbol,'PROVIDER_FACT',volatility.impliedVolatility);
    if(typeof identity.expiration==='string')add('EXPECTED_MOVE','EXPIRATION',identity.expiration,'THETA_DERIVED',economics.expectedMoveApprox);
    add('GEX','CONTRACT',symbol,'PROVIDER_FACT',structure.gammaExposure);
    add('DEX','CONTRACT',symbol,'PROVIDER_FACT',structure.deltaExposure);
    for(const greek of ['delta','gamma','theta','vega','rho']){
      const candidate=record(greeks[greek]);
      if(candidate.state==='INVALID')attachments.push({family:'IV',scope:'CONTRACT',scopeKey:`${symbol}:${greek}`,
        classification:'PROVIDER_FACT',state:'INVALID',value:null,providerTimestamp:null,reason:typeof candidate.reason==='string'?candidate.reason:null});
    }
  }
  add('SKEW','CHAIN','CHAIN','THETA_DERIVED',root.skew);
  add('TERM','CHAIN','CHAIN','THETA_DERIVED',root.termStructure);
  add('SURFACE','CHAIN','CHAIN','THETA_DERIVED',root.volatilitySurface);
  const providerContext=record(root.providerContext),metrics=record(providerContext.metrics);
  add('IV_RANK','CHAIN','CHAIN','PROVIDER_FACT',metrics.ivRank);
  add('IV_PERCENTILE','CHAIN','CHAIN','PROVIDER_FACT',metrics.ivPercentile);
  add('GEX','CHAIN','CHAIN','PROVIDER_FACT',metrics.totalGex);
  add('GAMMA_FLIP','CHAIN','CHAIN','PROVIDER_FACT',metrics.gammaFlipStrike);
  if(metrics.putWall!==undefined||metrics.callWall!==undefined){
    const putWall=record(metrics.putWall),callWall=record(metrics.callWall);
    const state=putWall.state==='INVALID'||callWall.state==='INVALID'?'INVALID':putWall.state==='KNOWN'||callWall.state==='KNOWN'?'KNOWN':'UNKNOWN';
    attachments.push({family:'WALLS',scope:'CHAIN',scopeKey:'CHAIN',classification:'PROVIDER_FACT',state,
      value:{putWall:(putWall.value??null) as JsonValue,callWall:(callWall.value??null) as JsonValue},providerTimestamp:null,
      reason:state==='KNOWN'?null:'PUT_CALL_WALLS_UNKNOWN'});
  }
  for(const [field,family] of [['vannaExposureHeatmap','VANNA'],['charmExposureHeatmap','CHARM'],['flowAggregates','FLOW'],
    ['events','EVENTS'],['earningsFilings','EARNINGS']] as const){
    const context=providerContext[field];
    attachments.push({family,scope:'CHAIN',scopeKey:'CHAIN',classification:'PROVIDER_FACT',
      state:context===null||context===undefined?'UNKNOWN':'KNOWN',value:(context??null) as JsonValue,providerTimestamp:null,
      reason:context===null||context===undefined?`${family}_PROVIDER_SCHEMA_OR_VALUE_UNAVAILABLE`:null});
  }
  return attachments.toSorted((a,b)=>a.family.localeCompare(b.family)||a.scope.localeCompare(b.scope)||a.scopeKey.localeCompare(b.scopeKey));
}

function validatePolicy(policy:OptionLiquidityResearchPolicy):void{
  const optional=[policy.maximumQuoteAgeSeconds,policy.maximumRelativeSpread];
  if(optional.some((value)=>value!==null&&(!Number.isFinite(value)||value<0)))throw new Error('LIQUIDITY_POLICY_INVALID');
  for(const threshold of [policy.minimumOpenInterest,policy.minimumVolume,policy.minimumBidSize,policy.minimumAskSize]){
    if(threshold!==null&&(!Number.isFinite(threshold.value)||threshold.value<0))throw new Error('LIQUIDITY_POLICY_INVALID');
  }
}

function expectedMoveFor(expiration:string,attachments:readonly ChainScopedAttachment[]):number|null{
  const values=attachments.filter((candidate)=>candidate.family==='EXPECTED_MOVE'&&candidate.scope==='EXPIRATION'
    &&candidate.scopeKey===expiration&&candidate.classification==='THETA_DERIVED'&&candidate.state==='KNOWN')
    .flatMap((item)=>typeof item.value==='number'&&Number.isFinite(item.value)&&item.value>=0?[item.value]:[]);
  return median(values);
}

function thresholdEvidence(value:number|null,threshold:{readonly value:number;readonly role:'HARD'|'SOFT'}|null,
  missing:string,below:string,hard:string[],soft:string[],unknownReasons:string[]):void{
  if(threshold===null)return;
  if(value===null){unknownReasons.push(missing);return;}
  if(value<threshold.value)(threshold.role==='HARD'?hard:soft).push(below);
}

function contractEvidence(contract:NormalizedOptionContract,observedAt:string,policy:OptionLiquidityResearchPolicy,
  attachments:readonly ChainScopedAttachment[]):ChainContractEvidence{
  const hard:string[]=[],soft:string[]=[],unknownReasons:string[]=[];
  if(contract.bid===null||contract.ask===null)hard.push('TWO_SIDED_QUOTE_MISSING');
  else if(contract.bid<0||contract.ask<=0||contract.bid>contract.ask)hard.push('QUOTE_INVALID_OR_CROSSED');
  else if(contract.bid===0)hard.push('ZERO_BID_UNUSABLE_FOR_SELLER');
  const quoteAge=contract.quoteTimestamp===null?null:(Date.parse(observedAt)-Date.parse(contract.quoteTimestamp))/1000;
  if(quoteAge===null||!Number.isFinite(quoteAge)||quoteAge<0)hard.push('QUOTE_AGE_UNKNOWN_OR_INVALID');
  else if(policy.maximumQuoteAgeSeconds!==null&&quoteAge>policy.maximumQuoteAgeSeconds)hard.push('QUOTE_STALE_BY_POLICY');
  if(policy.maximumRelativeSpread!==null){
    if(contract.spreadPct===null)unknownReasons.push('RELATIVE_SPREAD_UNKNOWN');
    else if(contract.spreadPct>policy.maximumRelativeSpread)hard.push('RELATIVE_SPREAD_TOO_WIDE');
  }
  thresholdEvidence(contract.openInterest,policy.minimumOpenInterest,'OPEN_INTEREST_UNKNOWN','OPEN_INTEREST_BELOW_POLICY',hard,soft,unknownReasons);
  thresholdEvidence(contract.volume,policy.minimumVolume,'VOLUME_UNKNOWN','VOLUME_BELOW_POLICY',hard,soft,unknownReasons);
  thresholdEvidence(contract.bidSize,policy.minimumBidSize,'BID_SIZE_UNKNOWN','BID_SIZE_BELOW_POLICY',hard,soft,unknownReasons);
  thresholdEvidence(contract.askSize,policy.minimumAskSize,'ASK_SIZE_UNKNOWN','ASK_SIZE_BELOW_POLICY',hard,soft,unknownReasons);
  const spot=contract.underlyingReferencePrice;
  const intrinsic=finite(spot)?(contract.optionType==='PUT'?Math.max(contract.strike-spot,0):Math.max(spot-contract.strike,0)):null;
  const validMid=contract.bid!==null&&contract.ask!==null&&contract.bid>=0&&contract.ask>=contract.bid
    ?(contract.bid+contract.ask)/2:null;
  const extrinsic=finite(validMid)&&finite(intrinsic)?validMid-intrinsic:null;
  const expectedMove=expectedMoveFor(contract.expiration,attachments);
  const distance=finite(spot)?Math.abs(spot-contract.strike):null;
  if(contract.iv===null)unknownReasons.push('IV_UNKNOWN');
  if(contract.delta===null)unknownReasons.push('DELTA_UNKNOWN');
  if(contract.openInterest===null)unknownReasons.push('OPEN_INTEREST_UNKNOWN');
  if(contract.volume===null)unknownReasons.push('VOLUME_UNKNOWN');
  return {
    optionSymbol:contract.optionSymbol,underlying:contract.underlying,expiration:contract.expiration,dte:contract.dte,
    optionType:contract.optionType,strike:contract.strike,multiplier:contract.multiplier,spot,
    moneyness:contract.moneyness,bid:contract.bid,ask:contract.ask,midpointReference:validMid,spread:contract.spread,
    relativeSpread:contract.spreadPct,bidSize:contract.bidSize,askSize:contract.askSize,quoteTimestamp:contract.quoteTimestamp,
    receivedAt:contract.receivedAt,dataAgeSeconds:contract.dataAgeSeconds,
    quoteAgeSeconds:quoteAge,iv:contract.iv,delta:contract.delta,gamma:contract.gamma,theta:contract.theta,vega:contract.vega,rho:contract.rho,
    volume:contract.volume,openInterest:contract.openInterest,
    volumeToOpenInterest:finite(contract.volume)&&finite(contract.openInterest)&&contract.openInterest>0?contract.volume/contract.openInterest:null,
    intrinsicAtSpot:intrinsic,extrinsicAtMidReference:extrinsic,theoreticalModelValue:unknown<number>('THEORETICAL_MODEL_VALUE_NOT_COMPUTED'),
    breakeven:contract.breakEven,distanceToStrikePct:contract.distanceToStrikePct,
    distanceToBreakevenPct:finite(spot)&&finite(contract.breakEven)&&spot>0?Math.abs(spot-contract.breakEven)/spot:null,
    expectedMoveDistance:distance,expectedMoveNormalizedDistance:finite(distance)&&finite(expectedMove)&&expectedMove>0?distance/expectedMove:null,
    quoteSource:contract.source,feed:contract.feed,dataQuality:contract.dataQuality,researchUsable:hard.length===0,
    executionUsable:contract.executable,hardLiquidityBlockers:[...new Set(hard)].sort(),softLiquidityEvidence:[...new Set(soft)].sort(),
    unknownReasons:[...new Set(unknownReasons)].sort(),
    deltaGridDistances:Object.fromEntries(deltaGrid.map((target)=>[target.toFixed(2),finite(contract.delta)?Math.abs(Math.abs(contract.delta)-target):null])),
  };
}

function dominatesExpiration(left:ExpirationResearchFrontier,right:ExpirationResearchFrontier):boolean{
  const pairs:[number,number,'MAX'|'MIN'][]=[];
  if(finite(left.maximumPutBidPremium)&&finite(right.maximumPutBidPremium))pairs.push([left.maximumPutBidPremium,right.maximumPutBidPremium,'MAX']);
  if(finite(left.representativeRelativeSpread)&&finite(right.representativeRelativeSpread))pairs.push([left.representativeRelativeSpread,right.representativeRelativeSpread,'MIN']);
  if(left.usableContracts>=0&&right.usableContracts>=0)pairs.push([left.usableContracts,right.usableContracts,'MAX']);
  return pairs.length>0&&pairs.every(([a,b,d])=>d==='MAX'?a>=b:a<=b)&&pairs.some(([a,b,d])=>d==='MAX'?a>b:a<b);
}

function expirationFrontiers(contracts:readonly ChainContractEvidence[],frontier:CanonicalStrategyFrontier,
  attachments:readonly ChainScopedAttachment[]):readonly ExpirationResearchFrontier[]{
  const expirations=[...new Set(contracts.map((contract)=>contract.expiration))].sort();
  const rows=expirations.map((expiration):ExpirationResearchFrontier=>{
    const group=contracts.filter((contract)=>contract.expiration===expiration),puts=group.filter((contract)=>contract.optionType==='PUT');
    const scoped=(family:ChainScopedAttachment['family']):ChainValue<boolean>=>{
      const item=attachments.find((candidate)=>candidate.family===family&&candidate.scope==='EXPIRATION'&&candidate.scopeKey===expiration);
      return item?.state==='KNOWN'&&typeof item.value==='boolean'?known(item.value):unknown(item?.reason??`${family}_CROSSING_UNKNOWN`);
    };
    const applicable=[...new Set(frontier.branches.flatMap((branch)=>branch.candidates.filter((candidate)=>candidate.legs.some((leg)=>leg.expiration===expiration)).map((candidate)=>candidate.branch)))].sort();
    const unknownReasons:string[]=[];
    if(group.every((contract)=>contract.iv===null))unknownReasons.push('EXPIRATION_IV_UNKNOWN');
    if(group.every((contract)=>contract.relativeSpread===null))unknownReasons.push('EXPIRATION_SPREAD_UNKNOWN');
    const partial={expiration,dte:group[0]?.dte??0,availableContracts:group.length,usableContracts:group.filter((contract)=>contract.researchUsable).length,
      availableStrikes:new Set(group.map((contract)=>contract.strike)).size,
      representativeRelativeSpread:median(group.flatMap((contract)=>finite(contract.relativeSpread)?[contract.relativeSpread]:[])),
      representativeIv:median(group.flatMap((contract)=>finite(contract.iv)?[contract.iv]:[])),expectedMove:expectedMoveFor(expiration,attachments),
      eventCrossing:scoped('EVENTS'),earningsCrossing:scoped('EARNINGS'),exDividendCrossing:unknown<boolean>('EX_DIVIDEND_CROSSING_UNKNOWN'),
      maximumPutBidPremium:puts.length===0?null:Math.max(...puts.flatMap((contract)=>finite(contract.bid)?[contract.bid]:[]),Number.NEGATIVE_INFINITY),
      minimumCspCollateral:puts.length===0?null:Math.min(...puts.map((contract)=>contract.strike*contract.multiplier)),strategyApplicability:applicable,
      paretoDominatedBy:[] as string[],unknownReasons:[...new Set(unknownReasons)].sort()};
    return {...partial,maximumPutBidPremium:partial.maximumPutBidPremium===Number.NEGATIVE_INFINITY?null:partial.maximumPutBidPremium};
  });
  return rows.map((row)=>({...row,paretoDominatedBy:rows.filter((other)=>other.expiration!==row.expiration&&dominatesExpiration(other,row)).map((other)=>other.expiration)}));
}

function structureFor(candidate:CanonicalFrontierCandidate):StructureResearchComparison['structure']{
  if(candidate.branch==='THETA_DEFINED_RISK')return 'DEFINED_RISK';
  if(candidate.branch==='THETA_HOLD_STRIKE')return 'HOLD_STRIKE';
  if(candidate.branch==='THETA_CC')return 'CC';
  if(candidate.branch==='THETA_RECOVERY')return 'RECOVERY';
  return 'CSP';
}

function selectionReceipt(frontier:CanonicalStrategyFrontier,contracts:readonly ChainContractEvidence[],
  structures:readonly StructureResearchComparison[]):OptionsChainDecisionEvidence['contractSelectionReceipt']{
  const candidate=frontier.branches.flatMap((branch)=>branch.candidates).find((item)=>item.candidateId===frontier.selectedCandidateId)??null;
  const contractId=candidate?.legs[0]?.optionSymbol??null;
  const contract=contracts.find((item)=>item.optionSymbol===contractId)??null;
  const neighbours=contract===null?[]:contracts.filter((item)=>item.expiration===contract.expiration&&item.optionType===contract.optionType&&item.optionSymbol!==contract.optionSymbol)
    .toSorted((a,b)=>Math.abs(a.strike-contract.strike)-Math.abs(b.strike-contract.strike)).slice(0,2);
  const otherExpirations=contract===null?[]:contracts.filter((item)=>item.optionType===contract.optionType&&item.expiration!==contract.expiration).map((item)=>item.expiration);
  const otherStructures=structures.filter((item)=>!item.selected&&item.structure!=='WAIT').map((item)=>item.candidateId);
  const wait=frontier.primaryAction==='GLOBAL_WAIT';
  return {
    selectedContractId:contractId,selectedCandidateId:frontier.selectedCandidateId,
    selectionState:wait?'WAIT':candidate===null?'SYSTEM_HOLD':'STRUCTURAL_RESEARCH_ONLY',
    whyThisExpiration:candidate===null?frontier.globalWaitReasons:[`DTE:${candidate.dte??'UNKNOWN'}`,'COMPARED_AGAINST_OTHER_EXPIRATIONS','NO_HEURISTIC_PRODUCTION_AUTHORITY'],
    whyThisStrike:contract===null?['NO_RESEARCH_CONTRACT_SELECTED']:[`STRIKE:${contract.strike}`,'PARETO_STRUCTURAL_COMPARISON_ONLY'],
    whyThisDelta:contract===null?['NO_RESEARCH_CONTRACT_SELECTED']:[`DELTA:${contract.delta??'UNKNOWN'}`,'DELTA_IS_NOT_WIN_PROBABILITY','NO_FIXED_DELTA_AUTHORITY'],
    whyThisStructure:candidate===null?['NO_RESEARCH_STRUCTURE_SELECTED']:[`BRANCH:${candidate.branch}`,`ACTION:${candidate.action}`,'CROSS_STRUCTURE_EMPIRICAL_UTILITY_UNKNOWN'],
    whyThisLiquidity:contract===null?['NO_RESEARCH_CONTRACT_SELECTED']:[...contract.hardLiquidityBlockers,...contract.softLiquidityEvidence,...contract.unknownReasons.filter((reason)=>reason.includes('VOLUME')||reason.includes('INTEREST')||reason.includes('SPREAD'))],
    whyNow:['POINT_IN_TIME_SNAPSHOT_ONLY','EMPIRICAL_AFTER_COST_VALUE_UNKNOWN'],
    whyNotNeighboringStrike:neighbours.length===0?['NO_COMPARABLE_NEIGHBOR']:neighbours.map((item)=>`${item.optionSymbol}:${item.hardLiquidityBlockers.join('|')||'STRUCTURAL_ALTERNATIVE'}`),
    whyNotOtherExpiration:otherExpirations.length===0?['NO_OTHER_EXPIRATION_IN_SNAPSHOT']:[...new Set(otherExpirations)].sort().map((expiration)=>`${expiration}:STRUCTURAL_ALTERNATIVE_NOT_SELECTED`),
    whyNotOtherStrategy:otherStructures.length===0?['NO_OTHER_APPLICABLE_STRUCTURE']:otherStructures.slice(0,20).map((id)=>`${id}:PARETO_OR_BLOCKER_EVIDENCE_RETAINED`),
    whyNotWait:candidate===null?['WAIT_OR_SYSTEM_HOLD_SELECTED']:['WAIT_REMAINS_LIVE_COMPARATOR','EMPIRICAL_UTILITY_UNKNOWN'],
  };
}

export function buildOptionsChainDecisionEvidence(input:{
  readonly fusionSnapshotId:string;readonly snapshotContentHash:string;readonly observedAt:string;readonly underlying:string;
  readonly contracts:readonly NormalizedOptionContract[];readonly frontier:CanonicalStrategyFrontier;
  readonly liquidityPolicy:OptionLiquidityResearchPolicy;readonly optionomicsAttachments?:readonly ChainScopedAttachment[];
}):OptionsChainDecisionEvidence{
  validatePolicy(input.liquidityPolicy);
  if(input.frontier.snapshotId!==input.snapshotContentHash)throw new Error('CHAIN_FRONTIER_SNAPSHOT_MISMATCH');
  const attachments=input.optionomicsAttachments??[];
  const contracts=input.contracts.map((contract)=>contractEvidence(contract,input.observedAt,input.liquidityPolicy,attachments))
    .toSorted((a,b)=>a.expiration.localeCompare(b.expiration)||a.optionType.localeCompare(b.optionType)||a.strike-b.strike||a.optionSymbol.localeCompare(b.optionSymbol));
  if(input.underlying.trim().length===0)throw new Error('CHAIN_UNDERLYING_REQUIRED');
  const underlyings=[...new Set(contracts.map((contract)=>contract.underlying))];
  if(underlyings.some((underlying)=>underlying!==input.underlying))throw new Error('CHAIN_UNDERLYING_MISMATCH');
  const spotValues=[...new Set(contracts.flatMap((contract)=>finite(contract.spot)?[contract.spot]:[]))];
  const spot=spotValues.length===1?known(spotValues[0] as number):spotValues.length===0?unknown<number>('UNDERLYING_SPOT_UNKNOWN'):{value:null,state:'INVALID' as const,reason:'INCONSISTENT_UNDERLYING_SPOT'};
  const structureComparisons:StructureResearchComparison[] = input.frontier.branches.flatMap((branch)=>branch.candidates.map((candidate)=>({
    structure:structureFor(candidate),candidateId:candidate.candidateId,branch:candidate.branch,legIds:candidate.legs.map((leg)=>leg.optionSymbol),
    snapshotId:input.snapshotContentHash,afterCostValue:null,tailRisk:candidate.economics.maxLoss,
    capitalRequired:candidate.economics.collateral,capitalDays:finite(candidate.economics.collateral)&&finite(candidate.dte)&&candidate.dte>0?candidate.economics.collateral*candidate.dte:null,
    liquidity:candidate.spreadPct,assignmentExposure:candidate.assignmentCapacityQty,executionComplexity:candidate.legs.length,
    portfolioImpact:null,knownStructuralEconomics:candidate.economics,paretoRank:candidate.paretoRank,selected:candidate.candidateId===input.frontier.selectedCandidateId,
    hardBlockers:candidate.hardBlockers,unknownEvidence:[...new Set([...candidate.unknownEvidence,'EXPECTED_AFTER_COST_VALUE_UNKNOWN','PORTFOLIO_IMPACT_UNKNOWN'])].sort(),executionAuthorized:false as const,
  })));
  structureComparisons.push({structure:'WAIT',candidateId:`WAIT:${input.snapshotContentHash}`,branch:'WAIT',legIds:[],snapshotId:input.snapshotContentHash,
    afterCostValue:null,tailRisk:0,capitalRequired:0,capitalDays:0,liquidity:null,assignmentExposure:0,executionComplexity:0,portfolioImpact:null,
    knownStructuralEconomics:null,paretoRank:null,selected:input.frontier.primaryAction==='GLOBAL_WAIT',hardBlockers:[],unknownEvidence:['OPPORTUNITY_COST_UNKNOWN'],executionAuthorized:false});
  const strikeDeltaFrontiers=[...new Set(contracts.map((contract)=>`${contract.expiration}:${contract.optionType}`))].sort().map((key):StrikeDeltaFrontier=>{
    const [expiration,optionType]=key.split(':') as [string,'CALL'|'PUT'];
    const group=contracts.filter((contract)=>contract.expiration===expiration&&contract.optionType===optionType);
    return {expiration,optionType,contractIds:group.map((contract)=>contract.optionSymbol),strikeOrder:group.map((contract)=>contract.strike),
      deltaOrder:group.filter((contract)=>finite(contract.delta)).toSorted((a,b)=>Math.abs(a.delta as number)-Math.abs(b.delta as number)).map((contract)=>contract.optionSymbol),
      ivOrder:group.filter((contract)=>finite(contract.iv)).toSorted((a,b)=>(a.iv as number)-(b.iv as number)).map((contract)=>contract.optionSymbol),
      openInterestOrder:group.filter((contract)=>finite(contract.openInterest)).toSorted((a,b)=>(b.openInterest as number)-(a.openInterest as number)).map((contract)=>contract.optionSymbol),
      volumeOrder:group.filter((contract)=>finite(contract.volume)).toSorted((a,b)=>(b.volume as number)-(a.volume as number)).map((contract)=>contract.optionSymbol),
      liquidityOrder:group.filter((contract)=>finite(contract.relativeSpread)).toSorted((a,b)=>(a.relativeSpread as number)-(b.relativeSpread as number)).map((contract)=>contract.optionSymbol),
      breakevenOrder:group.filter((contract)=>finite(contract.breakeven)).toSorted((a,b)=>(a.breakeven as number)-(b.breakeven as number)).map((contract)=>contract.optionSymbol),
      selectedContractId:group.find((contract)=>structureComparisons.some((candidate)=>candidate.selected&&candidate.legIds.includes(contract.optionSymbol)))?.optionSymbol??null};
  });
  const receipt=selectionReceipt(input.frontier,contracts,structureComparisons);
  const selected=receipt.selectedContractId;
  const selectedContract=selected===null?null:contracts.find((contract)=>contract.optionSymbol===selected)??null;
  const neighbours=selectedContract===null?[]:contracts.filter((contract)=>contract.expiration===selectedContract.expiration&&contract.optionType===selectedContract.optionType&&contract.optionSymbol!==selected)
    .toSorted((a,b)=>Math.abs(a.strike-selectedContract.strike)-Math.abs(b.strike-selectedContract.strike)).slice(0,2);
  const subjects=[
    ...(selected===null?[]:[{subjectType:'SELECTED_STRIKE' as const,subjectId:selected}]),
    ...neighbours.map((contract)=>({subjectType:'NEIGHBOR_STRIKE' as const,subjectId:contract.optionSymbol})),
    ...[...new Set(contracts.filter((contract)=>selectedContract!==null&&contract.expiration!==selectedContract.expiration).map((contract)=>contract.expiration))].map((expiration)=>({subjectType:'OTHER_EXPIRATION' as const,subjectId:expiration})),
    ...structureComparisons.filter((item)=>!item.selected&&item.structure!=='WAIT').slice(0,50).map((item)=>({subjectType:'OTHER_STRUCTURE' as const,subjectId:item.candidateId})),
    {subjectType:'WAIT' as const,subjectId:`WAIT:${input.snapshotContentHash}`},
  ].map((subject)=>({...subject,outcome:null,labelAvailableAt:null,state:'BLOCKED_ON_FUTURE_OUTCOME' as const}));
  const unsigned={contractVersion:optionsChainDecisionVersion,fusionSnapshotId:input.fusionSnapshotId,snapshotContentHash:input.snapshotContentHash,
    observedAt:input.observedAt,underlying:input.underlying,spot,underlyingTimestamp:input.contracts.find((contract)=>contract.underlyingTimestamp!==null)?.underlyingTimestamp??null,
    liquidityPolicy:input.liquidityPolicy,contracts,expirationFrontier:expirationFrontiers(contracts,input.frontier,attachments),strikeDeltaFrontiers,
    structureComparisons,optionomicsAttachments:attachments,contractSelectionReceipt:receipt,
    counterfactualLabelContract:{contractVersion:optionsChainCounterfactualVersion,featureCutoff:input.observedAt,subjects},
    empiricalEconomicsReady:false as const,executionAuthorized:false as const};
  return {...unsigned,contentHash:digest(unsigned)};
}

export async function persistOptionsChainDecisionEvidence(client:PoolClient,evidence:OptionsChainDecisionEvidence):Promise<void>{
  await client.query(`INSERT INTO research.theta_option_chain_decision_evidence(
    chain_decision_evidence_id,fusion_snapshot_id,observed_at,underlying,contract_version,liquidity_policy_version,
    chain_snapshot_json,expiration_frontier_json,strike_delta_frontier_json,structure_comparator_json,
    optionomics_attachments_json,contract_selection_receipt_json,counterfactual_label_contract_json,
    empirical_economics_ready,execution_authorized,content_hash)
    VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb,$11::jsonb,$12::jsonb,$13::jsonb,false,false,$14)
    ON CONFLICT(fusion_snapshot_id) DO NOTHING`,[randomUUID(),evidence.fusionSnapshotId,evidence.observedAt,evidence.underlying,
    evidence.contractVersion,evidence.liquidityPolicy.policyVersion,JSON.stringify({snapshotContentHash:evidence.snapshotContentHash,spot:evidence.spot,
      underlyingTimestamp:evidence.underlyingTimestamp,contracts:evidence.contracts,liquidityPolicy:evidence.liquidityPolicy}),
    JSON.stringify(evidence.expirationFrontier),JSON.stringify(evidence.strikeDeltaFrontiers),JSON.stringify(evidence.structureComparisons),
    JSON.stringify(evidence.optionomicsAttachments),JSON.stringify(evidence.contractSelectionReceipt),JSON.stringify(evidence.counterfactualLabelContract),evidence.contentHash]);
}
