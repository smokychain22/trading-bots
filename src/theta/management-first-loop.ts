export const managementFirstSequence = [
  'RECONCILE','APPLY_BROKER_LIFECYCLE_EVENTS','REVIEW_OPEN_POSITIONS','RECOMPUTE_PORTFOLIO_RISK',
  'DISCOVER_NEW_RISK','ENUMERATE_CANDIDATES','EVALUATE_STRATEGIES','AEGIS','DECISION',
] as const;
export type ManagementFirstStage = typeof managementFirstSequence[number];

export interface PreExistingRiskState {
  readonly assignmentExposure:'OK'|'BREACH'|'UNKNOWN'; readonly concentration:'OK'|'BREACH'|'UNKNOWN';
  readonly buyingPower:'OK'|'BREACH'|'UNKNOWN'; readonly portfolioGreeks:'OK'|'BREACH'|'UNKNOWN';
  readonly drawdown:'OK'|'BREACH'|'UNKNOWN'; readonly brokerDrift:'OK'|'BREACH'|'UNKNOWN';
  readonly pendingOrders:'OK'|'BREACH'|'UNKNOWN';
}
export interface NewRiskGate { readonly state:'READY'|'MANAGEMENT_FIRST'|'SYSTEM_HOLD'; readonly reasons:readonly string[]; }

export function evaluatePreExistingRisk(input:PreExistingRiskState):NewRiskGate {
  const entries = Object.entries(input) as [keyof PreExistingRiskState,PreExistingRiskState[keyof PreExistingRiskState]][];
  const breaches = entries.filter(([,state]) => state==='BREACH').map(([field]) => `PRE_EXISTING_${String(field).toUpperCase()}_BREACH`);
  if (breaches.length>0) return { state:'MANAGEMENT_FIRST',reasons:breaches };
  const unknown = entries.filter(([,state]) => state==='UNKNOWN').map(([field]) => `PRE_EXISTING_${String(field).toUpperCase()}_UNKNOWN`);
  return unknown.length>0 ? { state:'SYSTEM_HOLD',reasons:unknown } : { state:'READY',reasons:[] };
}

export class ManagementFirstLoopGuard {
  private completed = new Set<ManagementFirstStage>();
  complete(stage:ManagementFirstStage):void {
    const index = managementFirstSequence.indexOf(stage);
    const missing = managementFirstSequence.slice(0,index).filter((required) => !this.completed.has(required));
    if (missing.length>0) throw new Error(`MANAGEMENT_FIRST_SEQUENCE_VIOLATION:${stage}:${missing.join(',')}`);
    this.completed.add(stage);
  }
  mayDiscoverNewRisk():boolean {
    return managementFirstSequence.slice(0,4).every((stage) => this.completed.has(stage));
  }
}
