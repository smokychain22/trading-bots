export const r8ReadinessVersion='theta-r8-entry-readiness-v1' as const;
export interface R8ReadinessInput {readonly r7EngineeringComplete:boolean;readonly brokerTruthReady:boolean;
  readonly sessionStateReady:boolean;readonly positionLifecycleReady:boolean;readonly strategyRouterReady:boolean;
  readonly actionFrontierReady:boolean;readonly operatorSafetyReady:boolean;readonly optionomicsTransportReady:boolean;
  readonly optionomicsRealAuthReady:boolean;readonly executionQuoteProviderReady:boolean;readonly firstPaperOrderReady:boolean;
  readonly labelPipelineReady:boolean;readonly wholeChainAccountingReady:boolean;readonly trainingReady:boolean;}
export function buildR8Readiness(input:R8ReadinessInput){
  const dimensions={R7_ENGINEERING_COMPLETE:input.r7EngineeringComplete,BROKER_TRUTH_READY:input.brokerTruthReady,
    SESSION_STATE_READY:input.sessionStateReady,POSITION_LIFECYCLE_READY:input.positionLifecycleReady,
    STRATEGY_ROUTER_READY:input.strategyRouterReady,ACTION_FRONTIER_READY:input.actionFrontierReady,
    OPERATOR_SAFETY_READY:input.operatorSafetyReady,OPTIONOMICS_TRANSPORT_READY:input.optionomicsTransportReady,
    OPTIONOMICS_REAL_AUTH_READY:input.optionomicsRealAuthReady,EXECUTION_QUOTE_PROVIDER_READY:input.executionQuoteProviderReady,
    FIRST_PAPER_ORDER_READY:input.firstPaperOrderReady,LABEL_PIPELINE_READY:input.labelPipelineReady,
    WHOLE_CHAIN_ACCOUNTING_READY:input.wholeChainAccountingReady,TRAINING_READY:input.trainingReady};
  const blockers=Object.entries(dimensions).filter(([,ready])=>!ready).map(([name])=>name);
  return {version:r8ReadinessVersion,dimensions,engineeringEntryGate:input.r7EngineeringComplete&&input.brokerTruthReady&&
    input.positionLifecycleReady&&input.strategyRouterReady&&input.operatorSafetyReady?'READY':'BLOCKED',
    paperActivationGate:input.firstPaperOrderReady&&input.executionQuoteProviderReady?'READY':'BLOCKED',
    empiricalStatus:input.trainingReady?'EVALUABLE':'INSUFFICIENT_EVIDENCE',blockers,executionAuthorized:false as const};
}
