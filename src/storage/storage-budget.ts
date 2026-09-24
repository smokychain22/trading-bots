export interface StorageTelemetry {
  readonly postgresTotalGb: number;
  readonly postgresDailyGrowthMb: number | null;
  readonly canonicalStateMb: number;
  readonly observationsMb: number;
  readonly researchMb: number;
  readonly indexesMb: number;
  readonly toastMb: number;
}

export interface StorageBudgetPolicy {
  readonly policyVersion: string;
  readonly authority: 'BOOTSTRAP_INFRASTRUCTURE_GUARD_NOT_TRADING_POLICY';
  readonly effectiveAt: string;
  readonly reviewCondition: string;
  readonly maximumPostgresTotalGb: number;
  readonly maximumDailyGrowthMb: number;
  readonly maximumCanonicalStateMb: number;
  readonly maximumObservationsMb: number;
  readonly maximumResearchMb: number;
  readonly maximumIndexesMb: number;
  readonly maximumToastMb: number;
}

export interface StorageBudgetAssessment {
  readonly state: 'WITHIN_BUDGET' | 'WARNING' | 'BREACHED' | 'GROWTH_UNKNOWN';
  readonly breached: readonly string[];
  readonly warning: readonly string[];
  readonly policyVersion: string;
}

export const aivenDeveloper1BootstrapStorageBudget: StorageBudgetPolicy = {
  policyVersion: 'theta-aiven-developer1-storage-budget-v1',
  authority: 'BOOTSTRAP_INFRASTRUCTURE_GUARD_NOT_TRADING_POLICY',
  effectiveAt: '2026-09-25T00:00:00.000Z',
  reviewCondition: 'Review after any Aiven plan change, archive retention activation, or 25 percent data-volume change.',
  maximumPostgresTotalGb: 4,
  maximumDailyGrowthMb: 128,
  maximumCanonicalStateMb: 1_024,
  maximumObservationsMb: 768,
  maximumResearchMb: 512,
  maximumIndexesMb: 768,
  maximumToastMb: 2_048,
};

export function assessStorageBudget(telemetry: StorageTelemetry, policy: StorageBudgetPolicy): StorageBudgetAssessment {
  const metrics: ReadonlyArray<[string, number | null, number]> = [
    ['POSTGRES_TOTAL_GB', telemetry.postgresTotalGb, policy.maximumPostgresTotalGb],
    ['POSTGRES_DAILY_GROWTH_MB', telemetry.postgresDailyGrowthMb, policy.maximumDailyGrowthMb],
    ['CANONICAL_STATE_MB', telemetry.canonicalStateMb, policy.maximumCanonicalStateMb],
    ['OBSERVATIONS_MB', telemetry.observationsMb, policy.maximumObservationsMb],
    ['RESEARCH_MB', telemetry.researchMb, policy.maximumResearchMb],
    ['INDEXES_MB', telemetry.indexesMb, policy.maximumIndexesMb],
    ['TOAST_MB', telemetry.toastMb, policy.maximumToastMb],
  ];
  const breached = metrics.flatMap(([name, value, maximum]) => value !== null && value > maximum ? [name] : []);
  const warning = metrics.flatMap(([name, value, maximum]) =>
    value !== null && value <= maximum && value >= maximum * 0.8 ? [name] : []);
  return {
    state: breached.length > 0 ? 'BREACHED' : warning.length > 0 ? 'WARNING'
      : telemetry.postgresDailyGrowthMb === null ? 'GROWTH_UNKNOWN' : 'WITHIN_BUDGET',
    breached, warning, policyVersion: policy.policyVersion,
  };
}
