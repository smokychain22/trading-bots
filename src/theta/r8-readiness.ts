export const r8ReadinessVersion='theta-r8-entry-readiness-v2' as const;
export interface R8ReadinessInput {readonly r7EngineeringComplete:boolean;readonly brokerTruthReady:boolean;
  readonly sessionStateReady:boolean;readonly positionLifecycleReady:boolean;readonly strategyRouterReady:boolean;
  readonly actionFrontierReady:boolean;readonly operatorSafetyReady:boolean;readonly optionomicsTransportReady:boolean;
  readonly optionomicsRealAuthReady:boolean;readonly executionQuoteProviderReady:boolean;readonly operationalFirstPaperReady:boolean;
  readonly empiricalPolicyReady:boolean;readonly managementPolicyPromoted:boolean;
  readonly labelPipelineReady:boolean;readonly wholeChainAccountingReady:boolean;readonly trainingReady:boolean;}
export function buildR8Readiness(input:R8ReadinessInput){
  const dimensions={R7_ENGINEERING_COMPLETE:input.r7EngineeringComplete,BROKER_TRUTH_READY:input.brokerTruthReady,
    SESSION_STATE_READY:input.sessionStateReady,POSITION_LIFECYCLE_READY:input.positionLifecycleReady,
    STRATEGY_ROUTER_READY:input.strategyRouterReady,ACTION_FRONTIER_READY:input.actionFrontierReady,
    OPERATOR_SAFETY_READY:input.operatorSafetyReady,OPTIONOMICS_TRANSPORT_READY:input.optionomicsTransportReady,
    OPTIONOMICS_REAL_AUTH_READY:input.optionomicsRealAuthReady,EXECUTION_QUOTE_PROVIDER_READY:input.executionQuoteProviderReady,
    OPERATIONAL_FIRST_PAPER_READY:input.operationalFirstPaperReady,LABEL_PIPELINE_READY:input.labelPipelineReady,
    WHOLE_CHAIN_ACCOUNTING_READY:input.wholeChainAccountingReady,TRAINING_READY:input.trainingReady,
    EMPIRICAL_POLICY_READY:input.empiricalPolicyReady,MANAGEMENT_POLICY_PROMOTED:input.managementPolicyPromoted};
  const operationalNames=new Set(['R7_ENGINEERING_COMPLETE','BROKER_TRUTH_READY','SESSION_STATE_READY','POSITION_LIFECYCLE_READY',
    'STRATEGY_ROUTER_READY','ACTION_FRONTIER_READY','OPERATOR_SAFETY_READY','OPTIONOMICS_TRANSPORT_READY',
    'OPTIONOMICS_REAL_AUTH_READY','EXECUTION_QUOTE_PROVIDER_READY','OPERATIONAL_FIRST_PAPER_READY']);
  const operationalBlockers=Object.entries(dimensions).filter(([name,ready])=>operationalNames.has(name)&&!ready).map(([name])=>name);
  const empiricalBlockers=Object.entries(dimensions).filter(([name,ready])=>!operationalNames.has(name)&&name!=='MANAGEMENT_POLICY_PROMOTED'&&!ready).map(([name])=>name);
  return {version:r8ReadinessVersion,dimensions,engineeringEntryGate:input.r7EngineeringComplete&&input.brokerTruthReady&&
    input.positionLifecycleReady&&input.strategyRouterReady&&input.operatorSafetyReady?'READY':'BLOCKED',
    paperActivationGate:input.operationalFirstPaperReady&&input.executionQuoteProviderReady?'READY':'BLOCKED',
    empiricalValidationGate:input.empiricalPolicyReady?'READY':'BLOCKED',
    managementPolicyPromotion:input.managementPolicyPromoted?'READY':'NOT_PROMOTED_UNAVAILABLE',
    empiricalStatus:input.trainingReady?'EVALUABLE':'INSUFFICIENT_EVIDENCE',
    blockers:operationalBlockers,operationalBlockers,empiricalBlockers,executionAuthorized:false as const};
}
