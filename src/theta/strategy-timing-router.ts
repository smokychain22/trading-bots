import type { MarketSessionState, OptionTimeState } from './time-aware-state.js';

export const strategyTimingRouterVersion='theta-strategy-timing-router-v1' as const;
export type ThetaTimingBranch='THETA_CONVENTIONAL'|'THETA_HOLD_STRIKE'|'THETA_RECOVERY'|'THETA_CC'|'THETA_DEFINED_RISK'|'WAIT';
export interface TimingApplicability {
  readonly branch:ThetaTimingBranch; readonly applicability:'APPLICABLE'|'NOT_APPLICABLE'|'UNKNOWN';
  readonly reasons:readonly string[]; readonly quality:'GOOD'|'DEGRADED'|'UNKNOWN'; readonly blockers:readonly string[];
}
export interface StrategyTimingReceipt {
  readonly version:typeof strategyTimingRouterVersion; readonly observedAt:string;
  readonly branches:readonly TimingApplicability[]; readonly zeroDteState:'SPECIALIST_RESEARCH_ONLY'|'NOT_ZERO_DTE'|'UNKNOWN';
  readonly executionAuthorized:false;
}
export interface TimingRouterInput {readonly observedAt:string;readonly sessionStates:readonly MarketSessionState[];
  readonly optionTime:OptionTimeState;readonly lifecycleState:string;readonly requiredUnknowns:readonly string[];
  readonly eventStateKnown:boolean;readonly quoteFresh:boolean|null;}

export function routeStrategyTiming(input:TimingRouterInput):StrategyTimingReceipt{
  const blocked=input.sessionStates.some((state)=>['MARKET_CLOSED','WEEKEND_NON_TRADING','POST_CLOSE'].includes(state));
  const unknown=input.requiredUnknowns.length>0||input.sessionStates.includes('UNKNOWN');
  const branch=(name:ThetaTimingBranch,applicable:boolean,reasons:readonly string[]):TimingApplicability=>({branch:name,
    applicability:unknown?'UNKNOWN':applicable?'APPLICABLE':'NOT_APPLICABLE',reasons,
    quality:unknown?'UNKNOWN':input.quoteFresh===false?'DEGRADED':'GOOD',blockers:[...(blocked?['MARKET_NOT_OPEN']:[]),...input.requiredUnknowns].sort()});
  const openContext=!blocked&&input.lifecycleState==='CASH';
  const entries:TimingApplicability[]=[
    branch('THETA_CONVENTIONAL',openContext,['CASH_ENTRY_CONTEXT']),
    branch('THETA_HOLD_STRIKE',openContext&&input.optionTime.dte!==null&&input.optionTime.dte<=7,['SHORT_DTE_RESEARCH_CONTEXT']),
    branch('THETA_DEFINED_RISK',openContext,['DEFINED_RISK_RESEARCH_CONTEXT']),
    branch('THETA_RECOVERY',['STOCK_HELD','RECOVERY_WAIT'].includes(input.lifecycleState),['INVENTORY_MANAGEMENT_CONTEXT']),
    branch('THETA_CC',input.lifecycleState==='STOCK_HELD'||input.lifecycleState==='RECOVERY_WAIT'||input.lifecycleState==='CC_OPEN',['COVERED_CALL_CONTEXT']),
    branch('WAIT',true,['WAIT_ALWAYS_FEASIBLE_WHEN_EVIDENCE_IS_RECORDED']),
  ];
  return {version:strategyTimingRouterVersion,observedAt:input.observedAt,branches:entries,
    zeroDteState:input.optionTime.dte===null?'UNKNOWN':input.optionTime.dte===0?'SPECIALIST_RESEARCH_ONLY':'NOT_ZERO_DTE',executionAuthorized:false};
}
