/** System-level operational evidence. Candidate-specific preflight remains a separate gate. */
import type { RuntimeFirstPaperEvidence } from './runtime-behavior-diagnostic.js';

export type FirstPaperBlockerClass = 'EXTERNAL' | 'IMPLEMENTATION' | 'PROVIDER' | 'POLICY';
export type FirstPaperCheck =
  | { readonly state: 'PASS'; readonly source: string }
  | { readonly state: 'FAIL' | 'UNKNOWN'; readonly source: string; readonly blocker: string; readonly blockerClass: FirstPaperBlockerClass };

export const firstPaperCheckNames = [
  'databaseWritable', 'brokerHealthy', 'providerHealthy', 'eventEvidenceReady',
  'quotePipelineReady', 'aegisReady', 'positiveSizingReachable',
  'canonicalDecisionReachable', 'paperPlanReachable',
  'managementCandidateSourceReady', 'reconciliationReady', 'workerReleaseReady',
] as const;
export type FirstPaperCheckName = typeof firstPaperCheckNames[number];
export type FirstPaperChecks = Readonly<Record<FirstPaperCheckName, FirstPaperCheck>>;
export type FirstPaperStatus = 'READY' | 'BLOCKED_EXTERNAL' | 'BLOCKED_IMPLEMENTATION' | 'BLOCKED_PROVIDER' | 'BLOCKED_POLICY';
export type FirstPaperBlockerField = FirstPaperCheckName | 'unknownAuditCoverage' | 'avoidableUnknownCount'
  | 'implementationBlockerCount' | 'unresolvedSafetyCriticalCount' | 'unresolvedPaperEntryCount';

type RuntimeDerivedCheckName = 'eventEvidenceReady' | 'quotePipelineReady' | 'aegisReady'
  | 'positiveSizingReachable' | 'canonicalDecisionReachable' | 'paperPlanReachable'
  | 'managementCandidateSourceReady';

const observed = (source:string):FirstPaperCheck => ({state:'PASS',source});
const unresolved = (blocker:string,source:string,blockerClass:FirstPaperBlockerClass):FirstPaperCheck =>
  ({state:'UNKNOWN',blocker,source,blockerClass});
const blocked = (blocker:string,source:string,blockerClass:FirstPaperBlockerClass):FirstPaperCheck =>
  ({state:'FAIL',blocker,source,blockerClass});

/** Derives readiness from one immutable real-provider scan. It never turns a stage that was not reached into PASS. */
export function assessRuntimeFirstPaperReadiness(input:{
  readonly evidence:RuntimeFirstPaperEvidence|null;
  readonly approvedSymbol:string;
  readonly currentOpenPositions:number|null;
  readonly reconciliationReady:boolean;
}):Pick<FirstPaperChecks,RuntimeDerivedCheckName>{
  const source='latest-runtime-first-paper-evidence';
  const missing=unresolved('CURRENT_RELEASE_FIRST_PAPER_EVIDENCE_NOT_OBSERVED',source,'EXTERNAL');
  const symbols=input.evidence?.symbols??[];
  const symbol=symbols.find((item)=>item.symbol===input.approvedSymbol)??null;
  const managementCandidateSourceReady=input.currentOpenPositions===0&&input.reconciliationReady
    ? observed('broker-reconciliation:no-management-lifecycle-applicable')
    : input.currentOpenPositions===null
      ? unresolved('CURRENT_POSITION_COUNT_UNKNOWN','latest-broker-reconciliation-snapshot','EXTERNAL')
      : unresolved('CURRENT_POSITION_MANAGEMENT_DISCOVERY_NOT_OBSERVED','runtime-management','EXTERNAL');
  if(symbol===null)return {eventEvidenceReady:missing,quotePipelineReady:missing,aegisReady:missing,
    positiveSizingReachable:missing,canonicalDecisionReachable:missing,paperPlanReachable:missing,
    managementCandidateSourceReady};
  if(symbol.cycleState==='FAILED'){
    const failure=unresolved(symbol.cycleErrorCode??'FIRST_PAPER_SYMBOL_CYCLE_FAILED',source,'PROVIDER');
    return {eventEvidenceReady:failure,quotePipelineReady:failure,aegisReady:failure,
      positiveSizingReachable:failure,canonicalDecisionReachable:failure,paperPlanReachable:failure,
      managementCandidateSourceReady};
  }
  const eventEvidenceReady=symbol.entrySafetyPolicy===null
    ? unresolved('ENTRY_SAFETY_POLICY_NOT_OBSERVED',source,'PROVIDER')
    : observed(`${source}:entry-safety-policy`);
  const refresh=symbol.runtimeTelemetry?.finalistRefresh;
  let quotePipelineReady:FirstPaperCheck;
  if(refresh?.state!=='OBSERVED')quotePipelineReady=unresolved('FINALIST_REFRESH_NOT_OBSERVED',source,'EXTERNAL');
  else if(symbol.preSubmit===null)quotePipelineReady=unresolved('PRE_SUBMIT_REFRESH_NOT_REACHED',source,'EXTERNAL');
  else if(symbol.preSubmit.preSubmitState==='READY_TO_SUBMIT_BUT_DISABLED')quotePipelineReady=observed(`${source}:alpaca-finalist-and-pre-submit`);
  else if(symbol.preSubmit.preSubmitState==='PROVIDER_ERROR')quotePipelineReady=blocked(
    symbol.preSubmit.preSubmitBlockers[0]??'PRE_SUBMIT_PROVIDER_ERROR',source,'PROVIDER');
  else quotePipelineReady=blocked(symbol.preSubmit.preSubmitBlockers[0]??symbol.preSubmit.planBlockers[0]
    ??`PRE_SUBMIT_${symbol.preSubmit.preSubmitState}`,source,'POLICY');
  const aegisReady=['ALLOW_FULL','ALLOW_REDUCED'].includes(symbol.aegisState??'')
    ? observed(`${source}:aegis`)
    : symbol.aegisState===null||symbol.aegisState==='UNKNOWN'
      ? unresolved('CURRENT_AEGIS_STATE_NOT_OBSERVED',source,'EXTERNAL')
      : blocked(`CURRENT_AEGIS_${symbol.aegisState}`,source,'POLICY');
  let positiveSizingReachable:FirstPaperCheck;
  if(symbol.selectedQuantity>0||((symbol.runtimeTelemetry?.positiveSizeCandidateCount??0)>0)){
    positiveSizingReachable=observed(`${source}:sizing`);
  }else if(symbol.qLatticeTotal===0){
    positiveSizingReachable=unresolved('Q_LATTICE_NOT_OBSERVED_FOR_SIZING',source,'EXTERNAL');
  }else if(symbol.runtimeTelemetry===null){
    positiveSizingReachable=unresolved('RUNTIME_SIZING_TELEMETRY_NOT_OBSERVED',source,'EXTERNAL');
  }else{
    positiveSizingReachable=blocked(`NO_POSITIVE_SIZE:${Object.keys(symbol.runtimeTelemetry.bindingConstraintCounts)
      .toSorted().join(',')||'UNKNOWN_BINDING_CONSTRAINT'}`,source,'POLICY');
  }
  const canonicalDecisionReachable=symbol.qDecision!==null&&symbol.canonicalAction!==null
    ? observed(`${source}:canonical-decision`)
    : unresolved('CANONICAL_DECISION_NOT_OBSERVED',source,'EXTERNAL');
  const paperPlanReachable=symbol.preSubmit?.planState==='READY'
    ? observed(`${source}:paper-plan`)
    : symbol.preSubmit?.planState==='BLOCKED'
      ? blocked(symbol.preSubmit.planBlockers[0]??'PAPER_PLAN_BLOCKED',source,'POLICY')
      : unresolved('PAPER_PLAN_NOT_REACHED',source,'EXTERNAL');
  return {eventEvidenceReady,quotePipelineReady,aegisReady,positiveSizingReachable,
    canonicalDecisionReachable,paperPlanReachable,managementCandidateSourceReady};
}

export function assessReconciliationReadiness(input: {
  readonly workerCycleHealthy: boolean;
  readonly lastReconciliation: string | null;
  readonly entryBlockingFactCount: number | null;
  readonly localOnlyIntentCount: number | null;
}): FirstPaperCheck {
  const source = 'latest-broker-reconciliation-snapshot';
  if (!input.workerCycleHealthy || input.lastReconciliation === null) return {
    state: 'UNKNOWN', source, blocker: 'CURRENT_RECONCILIATION_NOT_PROVEN', blockerClass: 'EXTERNAL',
  };
  if (input.entryBlockingFactCount === null || input.localOnlyIntentCount === null) return {
    state: 'UNKNOWN', source, blocker: 'RECONCILIATION_COUNTS_UNKNOWN', blockerClass: 'EXTERNAL',
  };
  if (!Number.isSafeInteger(input.entryBlockingFactCount) || input.entryBlockingFactCount < 0
    || !Number.isSafeInteger(input.localOnlyIntentCount) || input.localOnlyIntentCount < 0) return {
    state: 'UNKNOWN', source, blocker: 'RECONCILIATION_COUNTS_INVALID', blockerClass: 'EXTERNAL',
  };
  if (input.entryBlockingFactCount > 0) return {
    state: 'FAIL', source, blocker: 'CURRENT_OR_UNKNOWN_BROKER_IMPACT_PRESENT', blockerClass: 'POLICY',
  };
  if (input.localOnlyIntentCount > 0) return {
    state: 'FAIL', source, blocker: 'LOCAL_ONLY_ORDER_INTENTS_PRESENT', blockerClass: 'EXTERNAL',
  };
  return { state: 'PASS', source };
}

export interface ThetaFirstPaperReadiness {
  readonly version: 'theta-first-paper-blocker-budget-v1';
  readonly authority: 'READ_ONLY_OPERATOR_DIAGNOSTIC';
  readonly observedAt: string;
  readonly status: FirstPaperStatus;
  readonly checks: FirstPaperChecks;
  readonly unknownAuditCoverage: 'PARTIAL' | 'COMPLETE';
  /** Null means the corresponding audit has not covered the entire required path. */
  readonly avoidableUnknownCount: number | null;
  readonly implementationBlockerCount: number | null;
  readonly unresolvedSafetyCriticalCount: number | null;
  readonly unresolvedPaperEntryCount: number | null;
  readonly blockers: readonly { field: FirstPaperBlockerField; code: string; class: FirstPaperBlockerClass; evidenceState: 'FAIL' | 'UNKNOWN' }[];
}

export function buildThetaFirstPaperReadiness(input: {
  readonly observedAt: string;
  readonly checks: FirstPaperChecks;
  readonly unknownAuditCoverage: 'PARTIAL' | 'COMPLETE';
  readonly avoidableUnknownCount: number | null;
  readonly implementationBlockerCount: number | null;
  readonly unresolvedSafetyCriticalCount: number | null;
  readonly unresolvedPaperEntryCount: number | null;
}): ThetaFirstPaperReadiness {
  if (!Number.isFinite(Date.parse(input.observedAt))) throw new Error('INVALID_READINESS_OBSERVED_AT');
  for (const [name, count] of [
    ['avoidableUnknownCount', input.avoidableUnknownCount],
    ['implementationBlockerCount', input.implementationBlockerCount],
    ['unresolvedSafetyCriticalCount', input.unresolvedSafetyCriticalCount],
    ['unresolvedPaperEntryCount', input.unresolvedPaperEntryCount],
  ] as const) {
    if (count !== null && (!Number.isInteger(count) || count < 0)) throw new Error(`INVALID_${name}`);
  }
  const checkBlockers = firstPaperCheckNames.flatMap((field) => {
    const check = input.checks[field];
    if (check.state === 'PASS') return [];
    if (!check.blocker.trim() || !check.source.trim()) throw new Error(`INCOMPLETE_READINESS_CHECK_${field}`);
    return [{ field, code: check.blocker, class: check.blockerClass, evidenceState: check.state }] as const;
  });
  const auditBlockers: ThetaFirstPaperReadiness['blockers'][number][] = [];
  if (input.unknownAuditCoverage !== 'COMPLETE') auditBlockers.push({
    field: 'unknownAuditCoverage', code: 'UNKNOWN_AUDIT_PARTIAL', class: 'IMPLEMENTATION', evidenceState: 'UNKNOWN',
  });
  for (const [field, count, blockerClass] of [
    ['avoidableUnknownCount', input.avoidableUnknownCount, 'IMPLEMENTATION'],
    ['implementationBlockerCount', input.implementationBlockerCount, 'IMPLEMENTATION'],
    ['unresolvedSafetyCriticalCount', input.unresolvedSafetyCriticalCount, 'POLICY'],
    ['unresolvedPaperEntryCount', input.unresolvedPaperEntryCount, 'POLICY'],
  ] as const) {
    if (count === null || count > 0) auditBlockers.push({
      field, code: count === null ? `${field.toUpperCase()}_NOT_AUDITED` : `${field.toUpperCase()}_OPEN`,
      class: blockerClass, evidenceState: count === null ? 'UNKNOWN' : 'FAIL',
    });
  }
  const blockers = [...checkBlockers, ...auditBlockers];
  const classes = new Set(blockers.map((blocker) => blocker.class));
  const status: FirstPaperStatus = blockers.length === 0
    ? 'READY'
    : classes.has('EXTERNAL') ? 'BLOCKED_EXTERNAL'
      : classes.has('IMPLEMENTATION')
        ? 'BLOCKED_IMPLEMENTATION'
        : classes.has('PROVIDER') ? 'BLOCKED_PROVIDER' : 'BLOCKED_POLICY';
  return {
    version: 'theta-first-paper-blocker-budget-v1', authority: 'READ_ONLY_OPERATOR_DIAGNOSTIC',
    observedAt: input.observedAt, status, checks: input.checks,
    unknownAuditCoverage: input.unknownAuditCoverage,
    avoidableUnknownCount: input.avoidableUnknownCount,
    implementationBlockerCount: input.implementationBlockerCount,
    unresolvedSafetyCriticalCount: input.unresolvedSafetyCriticalCount,
    unresolvedPaperEntryCount: input.unresolvedPaperEntryCount, blockers,
  };
}
