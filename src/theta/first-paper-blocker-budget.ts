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

export interface ThetaFirstPaperReadiness {
  readonly version: 'theta-first-paper-blocker-budget-v1';
  readonly authority: 'READ_ONLY_OPERATOR_DIAGNOSTIC';
  readonly observedAt: string;
  readonly status: FirstPaperStatus;
  readonly checks: FirstPaperChecks;
  /** Null means the corresponding audit has not covered the entire required path. */
  readonly avoidableUnknownCount: number | null;
  readonly implementationBlockerCount: number | null;
  readonly blockers: readonly { field: FirstPaperCheckName; code: string; class: FirstPaperBlockerClass; evidenceState: 'FAIL' | 'UNKNOWN' }[];
}

export function buildThetaFirstPaperReadiness(input: {
  readonly observedAt: string;
  readonly checks: FirstPaperChecks;
  readonly avoidableUnknownCount: number | null;
  readonly implementationBlockerCount: number | null;
}): ThetaFirstPaperReadiness {
  if (!Number.isFinite(Date.parse(input.observedAt))) throw new Error('INVALID_READINESS_OBSERVED_AT');
  for (const [name, count] of [
    ['avoidableUnknownCount', input.avoidableUnknownCount],
    ['implementationBlockerCount', input.implementationBlockerCount],
  ] as const) {
    if (count !== null && (!Number.isInteger(count) || count < 0)) throw new Error(`INVALID_${name}`);
  }
  const blockers = firstPaperCheckNames.flatMap((field) => {
    const check = input.checks[field];
    if (check.state === 'PASS') return [];
    if (!check.blocker.trim() || !check.source.trim()) throw new Error(`INCOMPLETE_READINESS_CHECK_${field}`);
    return [{ field, code: check.blocker, class: check.blockerClass, evidenceState: check.state }] as const;
  });
  const classes = new Set(blockers.map((blocker) => blocker.class));
  const status: FirstPaperStatus = blockers.length === 0 && input.avoidableUnknownCount === 0 && input.implementationBlockerCount === 0
    ? 'READY'
    : classes.has('EXTERNAL') ? 'BLOCKED_EXTERNAL'
      : classes.has('IMPLEMENTATION') || input.implementationBlockerCount !== 0 || input.avoidableUnknownCount !== 0
        ? 'BLOCKED_IMPLEMENTATION'
        : classes.has('PROVIDER') ? 'BLOCKED_PROVIDER' : 'BLOCKED_POLICY';
  return {
    version: 'theta-first-paper-blocker-budget-v1', authority: 'READ_ONLY_OPERATOR_DIAGNOSTIC',
    observedAt: input.observedAt,
    status, checks: input.checks, avoidableUnknownCount: input.avoidableUnknownCount,
    implementationBlockerCount: input.implementationBlockerCount, blockers,
  };
}
