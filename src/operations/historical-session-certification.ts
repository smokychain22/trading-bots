export const historicalSessionCertificationVersion = 'theta-historical-session-certification-v1' as const;

export interface DailySourceEvidence {
  readonly date: string;
  readonly gitCommits: number;
  readonly changedAreas: Readonly<Record<string, number>>;
  readonly receiptCount: number;
  readonly receiptBuildShas: readonly string[];
  readonly receiptScopeStates: Readonly<Record<string, number>>;
  readonly reconciliationGoodCount: number;
  readonly maxPositions: number | null;
  readonly maxOpenOrders: number | null;
  readonly orderSubmissions: number;
  readonly replayCandidateCount: number;
  readonly replayExecutableCount: number;
  readonly replayPositiveQuantityCount: number;
  readonly replayRejectionCounts: Readonly<Record<string, number>>;
  readonly databaseCounts: Readonly<Record<string, number>>;
  readonly databaseErrorCounts: Readonly<Record<string, number>>;
}

export type HistoricalCoverage = 'MULTI_SOURCE' | 'RUNTIME_ONLY' | 'REPLAY_ONLY'
  | 'SOURCE_ONLY' | 'NO_RETAINED_EVIDENCE';

export interface HistoricalDayCertification extends DailySourceEvidence {
  readonly coverage: HistoricalCoverage;
  readonly progressState: 'ENGINEERING_AND_RUNTIME' | 'ENGINEERING_ONLY' | 'RUNTIME_OBSERVED'
    | 'HISTORICAL_REPLAY_ONLY' | 'EVIDENCE_GAP';
  readonly exactStops: readonly string[];
  readonly unknowns: readonly string[];
  readonly actualTradeCount: number;
  readonly lockedOrShadowPlanCount: number;
}

export interface HistoricalCertification {
  readonly contractVersion: typeof historicalSessionCertificationVersion;
  readonly generatedAt: string;
  readonly canonicalSourceSha: string;
  readonly range: { readonly start: string; readonly end: string };
  readonly days: readonly HistoricalDayCertification[];
  readonly totals: {
    readonly days: number;
    readonly evidenceGapDays: number;
    readonly gitCommits: number;
    readonly runtimeReceipts: number;
    readonly replayCandidates: number;
    readonly actualTrades: number;
    readonly orderSubmissions: number;
    readonly brokerMutations: number;
  };
  readonly unclassifiedWaitCount: number;
  readonly historicalRegressions: number;
  readonly unexplainedBehavior: number;
  readonly codeSolvableBlockers: readonly string[];
  readonly remainingClasses: readonly string[];
  readonly certification: 'PASS' | 'PARTIAL_EVIDENCE';
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function coverageFor(row: DailySourceEvidence): HistoricalCoverage {
  const runtime = row.receiptCount > 0 || sum(Object.values(row.databaseCounts)) > 0;
  const replay = row.replayCandidateCount > 0;
  const source = row.gitCommits > 0;
  if ([runtime, replay, source].filter(Boolean).length >= 2) return 'MULTI_SOURCE';
  if (runtime) return 'RUNTIME_ONLY';
  if (replay) return 'REPLAY_ONLY';
  if (source) return 'SOURCE_ONLY';
  return 'NO_RETAINED_EVIDENCE';
}

function stopsFor(row: DailySourceEvidence): readonly string[] {
  const stops = new Set<string>();
  for (const [code, count] of Object.entries(row.databaseErrorCounts)) if (count > 0) stops.add(code);
  for (const [reason, count] of Object.entries(row.replayRejectionCounts)) if (count > 0) stops.add(reason);
  for (const [state, count] of Object.entries(row.receiptScopeStates)) {
    if (count > 0 && /FAILED|DEGRADED|QUARANTINED/.test(state)) stops.add(`RUNTIME_${state}`);
  }
  if (row.replayCandidateCount > 0 && row.replayPositiveQuantityCount === 0) {
    stops.add('NO_POSITIVE_QUANTITY_IN_RETAINED_REPLAY');
  }
  return [...stops].sort();
}

export function buildHistoricalCertification(input: {
  readonly generatedAt: string;
  readonly canonicalSourceSha: string;
  readonly start: string;
  readonly end: string;
  readonly rows: readonly DailySourceEvidence[];
  readonly brokerFillCount: number;
  readonly brokerOrderSubmissionCount: number;
  readonly lockedOrShadowPlanCount: number;
  readonly unclassifiedWaitCount: number;
  readonly historicalRegressions: number;
  readonly unexplainedBehavior: number;
  readonly codeSolvableBlockers: readonly string[];
}): HistoricalCertification {
  const days = input.rows.map((row): HistoricalDayCertification => {
    const coverage = coverageFor(row);
    const runtime = row.receiptCount > 0 || sum(Object.values(row.databaseCounts)) > 0;
    return {
      ...row,
      coverage,
      progressState: row.gitCommits > 0 && runtime ? 'ENGINEERING_AND_RUNTIME'
        : row.gitCommits > 0 ? 'ENGINEERING_ONLY'
          : runtime ? 'RUNTIME_OBSERVED'
            : row.replayCandidateCount > 0 ? 'HISTORICAL_REPLAY_ONLY' : 'EVIDENCE_GAP',
      exactStops: stopsFor(row),
      unknowns: coverage === 'SOURCE_ONLY' || coverage === 'NO_RETAINED_EVIDENCE'
        ? ['DAY_LEVEL_RUNTIME_OUTCOME_NOT_RETAINED'] : [],
      actualTradeCount: row.databaseCounts.fills ?? 0,
      lockedOrShadowPlanCount: row.databaseCounts.actionPlans ?? 0,
    };
  });
  // Broker facts are deliberately attached to the aggregate unless an immutable timestamped
  // link can assign them to one day without inference.
  const actualTrades = input.brokerFillCount;
  const orderSubmissions = input.brokerOrderSubmissionCount;
  const partial = days.some((day) => day.coverage === 'SOURCE_ONLY'
    || day.coverage === 'NO_RETAINED_EVIDENCE');
  return {
    contractVersion: historicalSessionCertificationVersion,
    generatedAt: input.generatedAt,
    canonicalSourceSha: input.canonicalSourceSha,
    range: { start: input.start, end: input.end },
    days,
    totals: {
      days: days.length,
      evidenceGapDays: days.filter((day) => day.unknowns.length > 0).length,
      gitCommits: sum(days.map((day) => day.gitCommits)),
      runtimeReceipts: sum(days.map((day) => day.receiptCount)),
      replayCandidates: sum(days.map((day) => day.replayCandidateCount)),
      actualTrades,
      orderSubmissions,
      brokerMutations: orderSubmissions + actualTrades,
    },
    unclassifiedWaitCount: input.unclassifiedWaitCount,
    historicalRegressions: input.historicalRegressions,
    unexplainedBehavior: input.unexplainedBehavior,
    codeSolvableBlockers: [...input.codeSolvableBlockers],
    remainingClasses: partial
      ? ['FORWARD_DATA_REQUIRED', 'EMPIRICALLY_UNPROVEN', 'PROVIDER_LIMITED', 'HISTORICAL_EVIDENCE_GAP']
      : ['FORWARD_DATA_REQUIRED', 'EMPIRICALLY_UNPROVEN', 'PROVIDER_LIMITED'],
    certification: partial ? 'PARTIAL_EVIDENCE' : 'PASS',
  };
}
