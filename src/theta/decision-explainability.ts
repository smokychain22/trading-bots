export const decisionExplanationVersion='theta-decision-explanation-v1' as const;
export interface DecisionExplanationInput {readonly action:string;readonly feasibleAlternatives:readonly string[];
  readonly infeasibleAlternatives:readonly {action:string;reason:string}[];readonly reasonCodes:readonly string[];
  readonly requiredMissingFields:readonly string[];readonly optionalMissingFields:readonly string[];readonly sessionState:string;
  readonly timeState:string;readonly positionPath:string|null;readonly strategyApplicability:string;readonly providerEvidence:string;
  readonly riskOfAction:string;readonly riskOfInaction:string;readonly quoteAuthorityStatus:string;readonly policyStatus:string;}
export function assembleDecisionExplanation(input:DecisionExplanationInput){
  const classification=input.action==='WAIT'?'WHY_WAIT':input.action==='HOLD'||input.action==='HOLD_CC'?'WHY_HOLD':'WHY_ACTION';
  return {version:decisionExplanationVersion,classification,selectedAction:input.action,
    feasibleAlternatives:[...new Set(input.feasibleAlternatives)].sort(),infeasibleAlternatives:[...input.infeasibleAlternatives]
      .sort((a,b)=>a.action.localeCompare(b.action)),reasonCodes:[...new Set(input.reasonCodes)].sort(),
    requiredMissingFields:[...new Set(input.requiredMissingFields)].sort(),optionalMissingFields:[...new Set(input.optionalMissingFields)].sort(),
    sessionState:input.sessionState,timeState:input.timeState,positionPath:input.positionPath,
    strategyApplicability:input.strategyApplicability,providerEvidence:input.providerEvidence,riskOfAction:input.riskOfAction,
    riskOfInaction:input.riskOfInaction,quoteAuthorityStatus:input.quoteAuthorityStatus,policyStatus:input.policyStatus,
    executionAuthorized:false as const};
}
