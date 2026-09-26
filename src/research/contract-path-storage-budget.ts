export const contractPathStorageBudgetVersion = 'theta-contract-path-storage-budget-v1' as const;

export interface ContractPathStorageBudgetPolicy {
  readonly version: typeof contractPathStorageBudgetVersion;
  readonly maxSubjectsPerSession: number;
  readonly maxJobsPerDay: number;
  readonly maxSqliteGrowthBytesPerMonth: number;
  readonly maxParquetGrowthBytesPerMonth: number;
  readonly postgresResearchRowsPerObservation: 0;
}

export const defaultContractPathStorageBudgetPolicy: ContractPathStorageBudgetPolicy = {
  version: contractPathStorageBudgetVersion,
  maxSubjectsPerSession: 12,
  maxJobsPerDay: 96,
  maxSqliteGrowthBytesPerMonth: 5 * 1024 ** 3,
  maxParquetGrowthBytesPerMonth: 1024 ** 3,
  postgresResearchRowsPerObservation: 0,
};

export interface ContractPathStorageBudgetReceipt {
  readonly policyVersion: typeof contractPathStorageBudgetVersion;
  readonly measuredRowBytesAverage: number;
  readonly measuredRowBytesP95: number;
  readonly measuredRowBytesMax: number;
  readonly subjectsPerSession: number;
  readonly jobsPerDay: number;
  readonly observationsPerDay: number;
  readonly sqliteGrowthBytesPerMonth: number;
  readonly parquetGrowthBytesPerMonth: number;
  readonly postgresGrowthBytesPerMonth: 0;
  readonly sqliteWithinBudget: boolean;
  readonly parquetWithinBudget: boolean;
  readonly subjectBoundWithinPolicy: boolean;
  readonly jobBoundWithinPolicy: boolean;
  readonly state: 'PASS' | 'BUDGET_EXCEEDED';
}

function boundedInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 0) throw new Error(`CONTRACT_PATH_STORAGE_${name}_INVALID`);
  return value;
}

export function estimateContractPathStorage(input: {
  readonly measuredRowBytes: readonly number[];
  readonly subjectsPerSession: number;
  readonly sessionsPerMonth: number;
  readonly observationsPerSubject: number;
  readonly sqliteOverheadMultiplier: number;
  readonly parquetCompressionRatio: number;
  readonly policy?: ContractPathStorageBudgetPolicy;
}): ContractPathStorageBudgetReceipt {
  const policy = input.policy ?? defaultContractPathStorageBudgetPolicy;
  if (policy.version !== contractPathStorageBudgetVersion || policy.postgresResearchRowsPerObservation !== 0) {
    throw new Error('CONTRACT_PATH_STORAGE_POLICY_INVALID');
  }
  if (input.measuredRowBytes.length === 0 || input.measuredRowBytes.some((value) => !Number.isInteger(value) || value <= 0)) {
    throw new Error('CONTRACT_PATH_STORAGE_MEASUREMENT_REQUIRED');
  }
  const subjects = boundedInteger(input.subjectsPerSession, 'SUBJECTS');
  const sessions = boundedInteger(input.sessionsPerMonth, 'SESSIONS');
  const observationsPerSubject = boundedInteger(input.observationsPerSubject, 'OBSERVATIONS');
  if (!Number.isFinite(input.sqliteOverheadMultiplier) || input.sqliteOverheadMultiplier < 1
    || !Number.isFinite(input.parquetCompressionRatio) || input.parquetCompressionRatio <= 0
    || input.parquetCompressionRatio > 1) throw new Error('CONTRACT_PATH_STORAGE_RATIO_INVALID');
  const sorted = [...input.measuredRowBytes].sort((a, b) => a - b);
  const average = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
  const p95 = sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)];
  const max = sorted[sorted.length - 1];
  if (p95 === undefined || max === undefined) throw new Error('CONTRACT_PATH_STORAGE_MEASUREMENT_REQUIRED');
  const observationsPerSession = subjects * observationsPerSubject;
  const observationsPerMonth = observationsPerSession * sessions;
  const observationsPerDay = observationsPerSession;
  const jobsPerDay = observationsPerSession;
  const sqliteGrowthBytesPerMonth = Math.ceil(average * observationsPerMonth * input.sqliteOverheadMultiplier);
  const parquetGrowthBytesPerMonth = Math.ceil(average * observationsPerMonth * input.parquetCompressionRatio);
  const sqliteWithinBudget = sqliteGrowthBytesPerMonth <= policy.maxSqliteGrowthBytesPerMonth;
  const parquetWithinBudget = parquetGrowthBytesPerMonth <= policy.maxParquetGrowthBytesPerMonth;
  const subjectBoundWithinPolicy = subjects <= policy.maxSubjectsPerSession;
  const jobBoundWithinPolicy = jobsPerDay <= policy.maxJobsPerDay;
  return {
    policyVersion: policy.version,
    measuredRowBytesAverage: average,
    measuredRowBytesP95: p95,
    measuredRowBytesMax: max,
    subjectsPerSession: subjects,
    jobsPerDay,
    observationsPerDay,
    sqliteGrowthBytesPerMonth,
    parquetGrowthBytesPerMonth,
    postgresGrowthBytesPerMonth: 0,
    sqliteWithinBudget,
    parquetWithinBudget,
    subjectBoundWithinPolicy,
    jobBoundWithinPolicy,
    state: sqliteWithinBudget && parquetWithinBudget && subjectBoundWithinPolicy && jobBoundWithinPolicy
      ? 'PASS' : 'BUDGET_EXCEEDED',
  };
}
