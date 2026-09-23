/** System-level operational evidence. Candidate-specific preflight remains a separate gate. */
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
