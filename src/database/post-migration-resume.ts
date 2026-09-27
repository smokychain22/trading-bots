export const requiredPostMigrationVersions = [
  '065_aegis_iv_stress_evidence',
  '066_local_observation_evidence',
  '067_postgres_cycle_evidence_compaction',
] as const;

export interface MigrationLedgerRow {
  readonly version: string;
  readonly count: number;
}

export interface PostMigrationDatabaseState {
  readonly activeLeases: number;
  readonly paused: boolean;
  readonly masterEnabled: boolean;
  readonly followerEnabled: boolean;
  readonly riskAssessment: boolean;
  readonly localObservation: boolean;
  readonly compressedArchive: boolean;
}

export function assertPostMigrationResumeState(
  ledger: readonly MigrationLedgerRow[],
  state: PostMigrationDatabaseState,
): void {
  const schemaHead = ledger.at(-1)?.version;
  if (schemaHead !== requiredPostMigrationVersions[2]) {
    throw new Error('POST_MIGRATION_SCHEMA_HEAD_NOT_067');
  }
  for (const version of requiredPostMigrationVersions) {
    const row = ledger.find((candidate) => candidate.version === version);
    if (row?.count !== 1) {
      throw new Error(`POST_MIGRATION_LEDGER_CARDINALITY_INVALID:${version}`);
    }
  }
  if (state.activeLeases !== 0) throw new Error('POST_MIGRATION_ACTIVE_LEASE_PRESENT');
  if (!state.paused || state.masterEnabled || state.followerEnabled) {
    throw new Error('POST_MIGRATION_DATABASE_EXECUTION_CONTROL_NOT_LOCKED');
  }
  if (!state.riskAssessment || !state.localObservation || !state.compressedArchive) {
    throw new Error('POST_MIGRATION_SCHEMA_INVARIANT_MISSING');
  }
}
