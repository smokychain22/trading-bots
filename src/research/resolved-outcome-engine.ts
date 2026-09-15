import { createHash } from 'node:crypto';
import { z } from 'zod';
import { canonicalJson } from './point-in-time-evidence.js';

export const outcomeResolutionContractVersion = 'theta-outcome-resolution-v1' as const;
export const outcomeHorizonPolicyVersion = 'theta-outcome-horizons-v1' as const;
export const policyChallengerEvaluationVersion = 'theta-policy-challenger-evaluation-v1' as const;
export const standardOutcomeHorizons = [
  {id:'NEXT_DECISION_CYCLE',milliseconds:15*60*1000},
  {id:'ONE_DAY',milliseconds:24*60*60*1000},
  {id:'THREE_DAYS',milliseconds:3*24*60*60*1000},
  {id:'FIVE_DAYS',milliseconds:5*24*60*60*1000},
] as const;

export const outcomeLabelTypes = [
  'SELECTED_ACTION_OUTCOME','WAIT_OUTCOME','SELECTED_CONTRACT_OUTCOME','NEIGHBOR_STRIKE_OUTCOME',
  'OTHER_EXPIRATION_OUTCOME','OTHER_STRUCTURE_OUTCOME','MANAGEMENT_ACTION_OUTCOME',
  'MANAGEMENT_ALTERNATIVE_OUTCOME','STRATEGY_OUTCOME','WHOLE_CHAIN_OUTCOME',
  'ACTION_REGRET','CONTRACT_REGRET','STRATEGY_REGRET',
] as const;
export type OutcomeLabelType = typeof outcomeLabelTypes[number];
export type OutcomeProvenance = 'BROKER_ACTUAL'|'MARKET_OBSERVED'|'REPLAY_OBSERVED'|'MODELED_RESEARCH'|'UNRESOLVED'|'INVALID';
export type OutcomeCompleteness = 'COMPLETE'|'PARTIAL'|'UNRESOLVED'|'INVALID';
export type OutcomeResolutionState = 'RESOLVED'|'PENDING'|'UNRESOLVED'|'INVALID';
export type ExecutionModelClass = 'BROKER_ACTUAL'|'MARKET_MARK'|'MODELED_RESEARCH'|'NONE';

const timestamp = z.string().datetime({ offset:true });
const finiteNullable = z.number().finite().nullable();

export const outcomeSubjectSchema = z.object({
  subjectId:z.string().min(1), labelType:z.enum(outcomeLabelTypes), decisionTimestamp:timestamp,
  featureSnapshotHash:z.string().regex(/^[0-9a-f]{64}$/), candidateUniverseHash:z.string().regex(/^[0-9a-f]{64}$/),
  exactContractId:z.string().min(1).nullable(), strategyVersion:z.string().min(1),
  horizonId:z.string().min(1), horizonClosesAt:timestamp,
}).strict().superRefine((value,context)=>{
  if(Date.parse(value.horizonClosesAt)<=Date.parse(value.decisionTimestamp))
    context.addIssue({code:'custom',message:'horizon must close after decision'});
});
export type OutcomeSubject = z.infer<typeof outcomeSubjectSchema>;

export const outcomeObservationSchema = z.object({
  observationId:z.string().min(1), subjectId:z.string().min(1), observedAt:timestamp,
  providerTimestamp:timestamp.nullable(), receivedAt:timestamp, source:z.string().min(1),
  provenance:z.enum(['BROKER_ACTUAL','MARKET_OBSERVED','REPLAY_OBSERVED','MODELED_RESEARCH']),
  completeness:z.enum(['COMPLETE','PARTIAL','INVALID']), reasonCodes:z.array(z.string().min(1)),
  exactContractId:z.string().min(1).nullable(), bid:finiteNullable, ask:finiteNullable,
  underlyingSpot:finiteNullable, economicPnl:finiteNullable, fees:finiteNullable, slippage:finiteNullable,
  capitalDays:finiteNullable, lifecycleState:z.string().min(1).nullable(), terminal:z.boolean(),
}).strict().superRefine((value,context)=>{
  if(value.providerTimestamp!==null&&Date.parse(value.providerTimestamp)>Date.parse(value.observedAt))
    context.addIssue({code:'custom',message:'provider timestamp after observation'});
  if(Date.parse(value.receivedAt)<Date.parse(value.observedAt))
    context.addIssue({code:'custom',message:'receipt precedes observation'});
  if(value.bid!==null&&value.ask!==null&&value.bid>value.ask)
    context.addIssue({code:'custom',message:'crossed quote'});
});
export type OutcomeObservation = z.infer<typeof outcomeObservationSchema>;

export interface OutcomePathStatistics {
  readonly profitAtDecision:number|null; readonly peakFutureProfit:number|null;
  readonly worstFutureProfit:number|null; readonly terminalProfit:number|null;
  readonly worstGivebackFromPeak:number|null; readonly maximumAdverseExcursion:number|null;
  readonly maximumFavorableExcursion:number|null; readonly timeToPeakSeconds:number|null;
  readonly timeFromPeakToTerminalSeconds:number|null;
}

export interface ResolvedOutcomeReceipt {
  readonly contractVersion:typeof outcomeResolutionContractVersion; readonly subject:OutcomeSubject;
  readonly state:OutcomeResolutionState; readonly provenance:OutcomeProvenance;
  readonly completeness:OutcomeCompleteness; readonly decisionTimestamp:string;
  readonly outcomeObservationStart:string|null; readonly outcomeObservationEnd:string|null;
  readonly labelAvailableAt:string|null; readonly resolutionTimestamp:string;
  readonly executionModelClass:ExecutionModelClass; readonly executionModelVersion:string;
  readonly marketMark:Readonly<{entryMid:number|null;exitMid:number|null}>;
  readonly modeledExecution:Readonly<{entryPrice:number|null;exitPrice:number|null;grossPnl:number|null;netPnl:number|null}>;
  readonly path:OutcomePathStatistics; readonly terminalState:string|null;
  readonly reasonCodes:readonly string[]; readonly observationIds:readonly string[];
  readonly featureSnapshotHash:string; readonly candidateUniverseHash:string;
  readonly executionAuthorized:false; readonly contentHash:string;
}

export interface OutcomeExecutionModel {
  readonly modelClass:ExecutionModelClass; readonly version:string;
  readonly positionSide:'SHORT'|'LONG'|null; readonly multiplier:number|null;
  readonly entryPrice:number|null; readonly entryFees:number|null; readonly exitFees:number|null;
  readonly perLegSlippage:number|null;
}

const midpoint=(observation:OutcomeObservation):number|null=>observation.bid!==null&&observation.ask!==null
  ?(observation.bid+observation.ask)/2:null;
const hash=(value:unknown):string=>createHash('sha256').update(canonicalJson(value)).digest('hex');

function pathStatistics(observations:readonly OutcomeObservation[],profitAtDecision:number|null):OutcomePathStatistics{
  const points=observations.filter((item)=>item.economicPnl!==null);
  if(points.length===0)return {profitAtDecision,peakFutureProfit:null,worstFutureProfit:null,terminalProfit:null,
    worstGivebackFromPeak:null,maximumAdverseExcursion:null,maximumFavorableExcursion:null,
    timeToPeakSeconds:null,timeFromPeakToTerminalSeconds:null};
  const values=points.map((item)=>item.economicPnl as number),peak=Math.max(...values),worst=Math.min(...values);
  const terminal=points.at(-1) as OutcomeObservation,peakPoint=points.find((item)=>item.economicPnl===peak) as OutcomeObservation;
  const baseline=profitAtDecision??values[0] as number;
  return {profitAtDecision,peakFutureProfit:peak,worstFutureProfit:worst,terminalProfit:terminal.economicPnl,
    worstGivebackFromPeak:peak-(terminal.economicPnl as number),maximumAdverseExcursion:worst-baseline,
    maximumFavorableExcursion:peak-baseline,
    timeToPeakSeconds:(Date.parse(peakPoint.observedAt)-Date.parse(points[0]?.observedAt as string))/1000,
    timeFromPeakToTerminalSeconds:(Date.parse(terminal.observedAt)-Date.parse(peakPoint.observedAt))/1000};
}

function modeledPrices(observations:readonly OutcomeObservation[],model:OutcomeExecutionModel):{
  entryMid:number|null;exitMid:number|null;entryPrice:number|null;exitPrice:number|null;grossPnl:number|null;netPnl:number|null;
}{
  const first=observations[0],last=observations.at(-1),entryMid=first===undefined?null:midpoint(first),exitMid=last===undefined?null:midpoint(last);
  if(model.modelClass==='NONE'||model.modelClass==='MARKET_MARK'||model.positionSide===null||model.multiplier===null)
    return {entryMid,exitMid,entryPrice:null,exitPrice:null,grossPnl:null,netPnl:null};
  const concession=model.perLegSlippage??0;
  const entry=model.entryPrice??(first===undefined?null:model.positionSide==='SHORT'?first.bid:first.ask);
  const exit=last===undefined?null:model.positionSide==='SHORT'?last.ask:last.bid;
  if(entry===null||exit===null)return {entryMid,exitMid,entryPrice:entry,exitPrice:exit,grossPnl:null,netPnl:null};
  const gross=(model.positionSide==='SHORT'?entry-exit:exit-entry)*model.multiplier;
  const costs=(model.entryFees??0)+(model.exitFees??0)+concession*model.multiplier*2;
  return {entryMid,exitMid,entryPrice:entry,exitPrice:exit,grossPnl:gross,netPnl:gross-costs};
}

/** Pure deterministic label-side resolver. It never mutates a PIT feature row and can never authorize execution. */
export function resolveOutcome(input:{readonly subject:OutcomeSubject;readonly observations:readonly OutcomeObservation[];
  readonly asOf:string;readonly executionModel:OutcomeExecutionModel;readonly profitAtDecision?:number|null}):ResolvedOutcomeReceipt{
  const subject=outcomeSubjectSchema.parse(input.subject),asOf=timestamp.parse(input.asOf);
  const all=input.observations.map((item)=>outcomeObservationSchema.parse(item))
    .filter((item)=>item.subjectId===subject.subjectId).toSorted((a,b)=>a.observedAt.localeCompare(b.observedAt)||a.observationId.localeCompare(b.observationId));
  const reasons:string[]=[];
  if(input.executionModel.modelClass==='BROKER_ACTUAL'&&all.some((item)=>item.provenance!=='BROKER_ACTUAL'))
    reasons.push('BROKER_ACTUAL_REQUIRES_BROKER_OBSERVATIONS');
  if(input.executionModel.modelClass==='MODELED_RESEARCH'&&input.executionModel.version==='BROKER_ACTUAL')
    reasons.push('MODELED_OUTCOME_CANNOT_MASQUERADE_AS_BROKER_ACTUAL');
  const mismatches=all.filter((item)=>subject.exactContractId!==null&&item.exactContractId!==subject.exactContractId);
  if(mismatches.length>0)reasons.push('EXACT_CONTRACT_IDENTITY_MISMATCH');
  const eligible=all.filter((item)=>Date.parse(item.observedAt)>Date.parse(subject.decisionTimestamp)
    &&Date.parse(item.observedAt)<=Date.parse(subject.horizonClosesAt)&&!mismatches.includes(item));
  const horizonClosed=Date.parse(asOf)>=Date.parse(subject.horizonClosesAt);
  if(!horizonClosed)reasons.push('HORIZON_NOT_CLOSED');
  if(eligible.length===0)reasons.push('NO_CAUSAL_FUTURE_OBSERVATIONS');
  if(eligible.some((item)=>item.completeness==='INVALID'))reasons.push('INVALID_FUTURE_OBSERVATION');
  const invalid=reasons.some((reason)=>reason.includes('MISMATCH')||reason.includes('MASQUERADE')||reason.startsWith('BROKER_ACTUAL_REQUIRES'));
  const state:OutcomeResolutionState=invalid?'INVALID':!horizonClosed?'PENDING':eligible.length===0?'UNRESOLVED':'RESOLVED';
  const completeness:OutcomeCompleteness=state==='INVALID'?'INVALID':state!=='RESOLVED'?'UNRESOLVED':eligible.every((item)=>item.completeness==='COMPLETE')?'COMPLETE':'PARTIAL';
  const provenances=[...new Set(eligible.map((item)=>item.provenance))];
  const provenance:OutcomeProvenance=state==='INVALID'?'INVALID':state!=='RESOLVED'?'UNRESOLVED':
    provenances.length===1?(provenances[0] as OutcomeProvenance):provenances.includes('MODELED_RESEARCH')?'MODELED_RESEARCH':'REPLAY_OBSERVED';
  const prices=modeledPrices(eligible,input.executionModel),path=pathStatistics(eligible,input.profitAtDecision??null);
  const labelAvailableAt=state==='RESOLVED'?subject.horizonClosesAt:null;
  if(labelAvailableAt!==null&&Date.parse(labelAvailableAt)<=Date.parse(subject.decisionTimestamp))throw new Error('LABEL_CAUSALITY_VIOLATION');
  const unsigned={contractVersion:outcomeResolutionContractVersion,subject,state,provenance,completeness,
    decisionTimestamp:subject.decisionTimestamp,outcomeObservationStart:eligible[0]?.observedAt??null,
    outcomeObservationEnd:eligible.at(-1)?.observedAt??null,labelAvailableAt,resolutionTimestamp:asOf,
    executionModelClass:input.executionModel.modelClass,executionModelVersion:input.executionModel.version,
    marketMark:{entryMid:prices.entryMid,exitMid:prices.exitMid},modeledExecution:{entryPrice:prices.entryPrice,
      exitPrice:prices.exitPrice,grossPnl:prices.grossPnl,netPnl:prices.netPnl},path,
    terminalState:eligible.findLast((item)=>item.terminal)?.lifecycleState??null,
    reasonCodes:[...new Set([...reasons,...eligible.flatMap((item)=>item.reasonCodes)])].sort(),
    observationIds:eligible.map((item)=>item.observationId),featureSnapshotHash:subject.featureSnapshotHash,
    candidateUniverseHash:subject.candidateUniverseHash,executionAuthorized:false as const};
  return {...unsigned,contentHash:hash(unsigned)};
}

export interface WaitAlternativeOutcome {readonly subjectId:string;readonly complete:boolean;readonly afterCostPnl:number|null;
  readonly maxAdverseExcursion:number|null;readonly capitalDays:number|null;readonly policyFeasibleAtDecision:boolean;}
export function classifyWaitOutcome(input:{readonly windowClosed:boolean;readonly alternatives:readonly WaitAlternativeOutcome[]}):
  'CORRECT_WAIT'|'FALSE_REJECT'|'HEALTHY_WAIT'|'OVERSTRICT_POLICY_WAIT'|'UNKNOWN'{
  if(!input.windowClosed||input.alternatives.length===0||input.alternatives.some((item)=>!item.complete||item.afterCostPnl===null))return 'UNKNOWN';
  const feasible=input.alternatives.filter((item)=>item.policyFeasibleAtDecision);
  if(feasible.length===0)return input.alternatives.some((item)=>(item.afterCostPnl as number)>0)?'HEALTHY_WAIT':'CORRECT_WAIT';
  const attractive=feasible.some((item)=>(item.afterCostPnl as number)>0&&(item.maxAdverseExcursion??Number.NEGATIVE_INFINITY)>=-(item.afterCostPnl as number));
  return attractive?'OVERSTRICT_POLICY_WAIT':'CORRECT_WAIT';
}

export interface ChallengerEpisode {readonly clusterId:string;readonly selectedAction:string;
  readonly outcomes:Readonly<Record<string,{readonly afterCostPnl:number|null;readonly capitalDays:number|null;readonly complete:boolean}>>;}
export function evaluatePolicyChallenger(policyId:string,episodes:readonly ChallengerEpisode[]):{
  readonly contractVersion:typeof policyChallengerEvaluationVersion;readonly policyId:string;
  readonly state:'EVALUABLE'|'NOT_EVALUABLE'|'INSUFFICIENT_SAMPLE';readonly rawN:number;readonly effectiveClusterN:number;
  readonly totalAfterCostPnl:number|null;readonly totalCapitalDays:number|null;readonly promoted:false;readonly executionAuthorized:false;
}{
  const matching=episodes.flatMap((episode)=>{const value=episode.outcomes[policyId];return value===undefined?[]:[{...value,clusterId:episode.clusterId}];});
  const complete=matching.filter((item)=>item.complete&&item.afterCostPnl!==null);
  const state=matching.length===0?'NOT_EVALUABLE':complete.length<30?'INSUFFICIENT_SAMPLE':'EVALUABLE';
  return {contractVersion:policyChallengerEvaluationVersion,policyId,state,rawN:complete.length,
    effectiveClusterN:new Set(complete.map((item)=>item.clusterId)).size,
    totalAfterCostPnl:complete.length===0?null:complete.reduce((sum,item)=>sum+(item.afterCostPnl as number),0),
    totalCapitalDays:complete.some((item)=>item.capitalDays===null)?null:complete.reduce((sum,item)=>sum+(item.capitalDays as number),0),
    promoted:false,executionAuthorized:false};
}
