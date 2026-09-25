import type { Pool } from 'pg';

export const runtimeSchemaCompatibilityVersion = 'theta-runtime-schema-compatibility-v1' as const;
export const runtimeSchemaMinimum = '067_postgres_cycle_evidence_compaction' as const;
export const runtimeSchemaMaximum = '067_postgres_cycle_evidence_compaction' as const;

export const runtimeRequiredMigrations = [
  '020_local_worker_runtime',
  '064_alpaca_corporate_action_observation',
  '065_aegis_iv_stress_evidence',
  '066_local_observation_evidence',
  '067_postgres_cycle_evidence_compaction',
] as const;

export type RuntimeSchemaCompatibilityState =
  | 'COMPATIBLE'
  | 'MIGRATION_REQUIRED'
  | 'SCHEMA_AHEAD_UNSUPPORTED'
  | 'SCHEMA_METADATA_UNAVAILABLE'
  | 'SOURCE_WORKER_SHA_MISMATCH';

export interface RuntimeSchemaCompatibilityReceipt {
  readonly contractVersion: typeof runtimeSchemaCompatibilityVersion;
  readonly state: RuntimeSchemaCompatibilityState;
  readonly compatible: boolean;
  readonly expectedMinimum: typeof runtimeSchemaMinimum;
  readonly expectedMaximum: typeof runtimeSchemaMaximum;
  readonly observedHead: string | null;
  readonly missingRequiredMigrations: readonly string[];
  readonly sourceSha: string | null;
  readonly workerSha: string | null;
  readonly executionGate: 'LOCKED';
  readonly brokerAuthority: false;
}

const migrationOrdinal = (version: string): number | null => {
  const match = /^(\d{3})_/.exec(version);
  return match === null ? null : Number(match[1]);
};

const validFullSha = (value: string | null | undefined): value is string =>
  typeof value === 'string' && /^[0-9a-f]{40}$/.test(value);

export function assessRuntimeSchemaCompatibility(input: {
  readonly appliedVersions: readonly string[] | null;
  readonly sourceSha?: string | null;
  readonly workerSha?: string | null;
}): RuntimeSchemaCompatibilityReceipt {
  const sourceSha = validFullSha(input.sourceSha) ? input.sourceSha : null;
  const workerSha = validFullSha(input.workerSha) ? input.workerSha : null;
  const base = {
    contractVersion: runtimeSchemaCompatibilityVersion,
    expectedMinimum: runtimeSchemaMinimum,
    expectedMaximum: runtimeSchemaMaximum,
    sourceSha,
    workerSha,
    executionGate: 'LOCKED' as const,
    brokerAuthority: false as const,
  };
  if (input.appliedVersions === null) {
    return { ...base, state: 'SCHEMA_METADATA_UNAVAILABLE', compatible: false,
      observedHead: null, missingRequiredMigrations: [...runtimeRequiredMigrations] };
  }
  const applied = new Set(input.appliedVersions);
  const ordered = [...applied].sort((left, right) => {
    const leftOrdinal = migrationOrdinal(left) ?? -1;
    const rightOrdinal = migrationOrdinal(right) ?? -1;
    return leftOrdinal - rightOrdinal || left.localeCompare(right);
  });
  const observedHead = ordered.at(-1) ?? null;
  const missingRequiredMigrations = runtimeRequiredMigrations.filter((version) => !applied.has(version));
  if (sourceSha !== null && workerSha !== null && sourceSha !== workerSha) {
    return { ...base, state: 'SOURCE_WORKER_SHA_MISMATCH', compatible: false,
      observedHead, missingRequiredMigrations };
  }
  const observedOrdinal = observedHead === null ? null : migrationOrdinal(observedHead);
  const maximumOrdinal = migrationOrdinal(runtimeSchemaMaximum) ?? 67;
  if (observedOrdinal !== null && observedOrdinal > maximumOrdinal) {
    return { ...base, state: 'SCHEMA_AHEAD_UNSUPPORTED', compatible: false,
      observedHead, missingRequiredMigrations };
  }
  if (observedHead !== runtimeSchemaMaximum || missingRequiredMigrations.length > 0) {
    return { ...base, state: 'MIGRATION_REQUIRED', compatible: false,
      observedHead, missingRequiredMigrations };
  }
  return { ...base, state: 'COMPATIBLE', compatible: true, observedHead, missingRequiredMigrations: [] };
}

export async function inspectRuntimeSchemaCompatibility(pool: Pool, input: {
  readonly sourceSha?: string | null;
  readonly workerSha?: string | null;
}): Promise<RuntimeSchemaCompatibilityReceipt> {
  try {
    const result = await pool.query<{ version: string }>(
      `SELECT version FROM core.schema_migration ORDER BY version ASC`,
    );
    return assessRuntimeSchemaCompatibility({
      appliedVersions: result.rows.map((row) => String(row.version)),
      sourceSha: input.sourceSha,
      workerSha: input.workerSha,
    });
  } catch {
    return assessRuntimeSchemaCompatibility({ appliedVersions: null,
      sourceSha: input.sourceSha, workerSha: input.workerSha });
  }
}

