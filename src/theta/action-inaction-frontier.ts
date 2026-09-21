export const actionInactionFrontierVersion='theta-action-inaction-frontier-v1' as const;
export type ResearchAction='WAIT'|'HOLD'|'CLOSE_FULL'|'ROLL'|'LET_EXPIRE'|'ACCEPT_ASSIGNMENT'|'REDEPLOY'|
  'RECOVERY_WAIT'|'SELL_STOCK'|'SELL_CC'|'HOLD_CC'|'CLOSE_CC'|'ROLL_CC'|'ALLOW_CALL_AWAY';
export type HoldEvidenceState='HOLD_SUPPORTED'|'HOLD_WEAK'|'HOLD_OPPORTUNITY_COST_HIGH'|
  'HOLD_DERISK_RECOMMENDED_RESEARCH'|'HOLD_UNKNOWN';
export interface ActionEconomics {
  readonly action:ResearchAction; readonly feasible:boolean|null; readonly infeasibleReason:string|null;
  readonly afterCostEv:number|null; readonly tailBurden:number|null; readonly capitalDays:number|null;
  readonly executionCost:number|null; readonly assignmentBurden:number|null; readonly opportunityCost:number|null;
  readonly empiricalState:'KNOWN'|'UNKNOWN'|'BLOCKED_ON_DATA';
}
export interface ActionInactionFrontier {
  readonly version:typeof actionInactionFrontierVersion; readonly subjectId:string; readonly observedAt:string;
  readonly actions:readonly (ActionEconomics&{readonly dominatedBy:readonly ResearchAction[]})[];
  readonly paretoActions:readonly ResearchAction[]; readonly holdEvidence:HoldEvidenceState;
  readonly selectionState:'RESEARCH_FRONTIER_ONLY'; readonly executionAuthorized:false;
}

const dimensions=(value:ActionEconomics):readonly (number|null)[]=>[
  value.afterCostEv,value.tailBurden===null?null:-value.tailBurden,value.capitalDays===null?null:-value.capitalDays,
  value.executionCost===null?null:-value.executionCost,value.assignmentBurden===null?null:-value.assignmentBurden,
  value.opportunityCost===null?null:-value.opportunityCost];
export function paretoDominates(a:ActionEconomics,b:ActionEconomics):boolean{
  if(a.feasible!==true||b.feasible!==true)return false;
  const pairs=dimensions(a).map((value,index)=>[value,dimensions(b)[index]] as const);
  // Missing adverse objectives cannot make either action look dominant.
  return pairs.every(([x,y])=>x!==null&&y!==null)
    &&pairs.every(([x,y])=>(x as number)>=(y as number))
    &&pairs.some(([x,y])=>(x as number)>(y as number));
}
export function buildActionInactionFrontier(input:{subjectId:string;observedAt:string;actions:readonly ActionEconomics[]}):ActionInactionFrontier{
  const actions=input.actions.map((action)=>({...action,dominatedBy:input.actions.filter((other)=>other.action!==action.action&&paretoDominates(other,action)).map((other)=>other.action).sort()}));
  const paretoActions=actions.filter((action)=>action.feasible===true&&action.dominatedBy.length===0).map((action)=>action.action).sort();
  const hold=actions.find((action)=>action.action==='HOLD');
  const holdEvidence:HoldEvidenceState=hold===undefined||hold.feasible===null||hold.empiricalState!=='KNOWN'?'HOLD_UNKNOWN'
    :hold.feasible===false?'HOLD_WEAK':hold.dominatedBy.length>0&&hold.opportunityCost!==null&&hold.opportunityCost>0?'HOLD_OPPORTUNITY_COST_HIGH'
      :hold.dominatedBy.length>0?'HOLD_DERISK_RECOMMENDED_RESEARCH':'HOLD_SUPPORTED';
  return {version:actionInactionFrontierVersion,subjectId:input.subjectId,observedAt:input.observedAt,actions,
    paretoActions,holdEvidence,selectionState:'RESEARCH_FRONTIER_ONLY',executionAuthorized:false};
}

export interface InactionDiagnostics {
  readonly totalDecisions:number; readonly waitRate:number|null; readonly holdRate:number|null;
  readonly actionRate:number|null; readonly opportunityCaptureRate:number|null; readonly rejectedCandidatePositiveOutcomeRate:number|null;
  readonly correctRejectRate:number|null; readonly unresolvedRate:number|null;
}
export function calculateInactionDiagnostics(rows:readonly {action:ResearchAction;resolvedOutcome:'POSITIVE'|'NEGATIVE'|'UNRESOLVED';selected:boolean}[]):InactionDiagnostics{
  const total=rows.length,wait=rows.filter((row)=>row.action==='WAIT').length,hold=rows.filter((row)=>row.action==='HOLD'||row.action==='HOLD_CC').length;
  const rejected=rows.filter((row)=>!row.selected),resolvedRejected=rejected.filter((row)=>row.resolvedOutcome!=='UNRESOLVED');
  const opportunities=rows.filter((row)=>row.resolvedOutcome==='POSITIVE');
  const ratio=(n:number,d:number):number|null=>d===0?null:n/d;
  return {totalDecisions:total,waitRate:ratio(wait,total),holdRate:ratio(hold,total),actionRate:ratio(total-wait-hold,total),
    opportunityCaptureRate:ratio(opportunities.filter((row)=>row.selected).length,opportunities.length),
    rejectedCandidatePositiveOutcomeRate:ratio(resolvedRejected.filter((row)=>row.resolvedOutcome==='POSITIVE').length,resolvedRejected.length),
    correctRejectRate:ratio(resolvedRejected.filter((row)=>row.resolvedOutcome==='NEGATIVE').length,resolvedRejected.length),
    unresolvedRate:ratio(rows.filter((row)=>row.resolvedOutcome==='UNRESOLVED').length,total)};
}
