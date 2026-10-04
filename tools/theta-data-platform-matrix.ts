// Generates docs/operations/THETA_DATA_PLATFORM_RETENTION_MATRIX_20261003.json from the dataset registry (the registry is the single source; the JSON is derived and a test pins it).
import { writeFileSync } from 'node:fs';
import { datasetRegistry, hotPartitionsFor, validateRegistry, valueBytesRatio } from '../src/storage/data-platform/dataset-registry.js';
import { perDecisionModel } from '../tests/helpers/data-platform-sim.js';

export function retentionMatrix(): Record<string, unknown> {
  return {
    matrixVersion: 'theta-data-platform-retention-matrix-v1',
    registryProblems: validateRegistry(),
    memoryTypes: { WORKING: 'PostgreSQL (operational truth plus bounded hot evidence)', LONG_TERM: 'immutable compressed columnar archive (Parquet ZSTD, date partitioned)', REPRODUCIBILITY: 'GitHub (code, schema, migrations, policy, manifests, receipts, fixtures)', DISASTER_RECOVERY: 'verified backup storage' },
    datasets: datasetRegistry.map((policy) => {
      const model = perDecisionModel[policy.id];
      return {
        id: policy.id, class: policy.datasetClass, writePriority: policy.writePriority, tables: policy.tables, partition: policy.partition, HOT_WINDOW: policy.hotSessions === 'PERMANENT' ? 'PERMANENT' : `${policy.hotSessions} sessions (${hotPartitionsFor(policy)} closed ${policy.partition.granularity} partitions)`,
        WARM_WINDOW: `${policy.warmSessions} sessions (local verified-archive cache)`, COLD_POLICY: policy.coldPolicy, compactHotForm: policy.compactHotForm, WHY_HOT: policy.whyHot, WHY_WARM: policy.whyWarm, ARCHIVED_WHEN: policy.archiveWhen,
        REMOVED_FROM_POSTGRES_WHEN: policy.removeFromPostgresWhen, RESTORED_HOW: policy.restoredHow, value: policy.value,
        measuredMedianBytesPerDecision: model === undefined ? null : Math.round(model.medianBytes),
        VALUE_BYTES_RATIO: model === undefined ? null : +(valueBytesRatio(policy.value, model.medianBytes) ?? 0).toFixed(2),
      };
    }),
  };
}

if (process.argv[1]?.endsWith('theta-data-platform-matrix.ts')) {
  writeFileSync(new URL('../docs/operations/THETA_DATA_PLATFORM_RETENTION_MATRIX_20261003.json', import.meta.url), `${JSON.stringify(retentionMatrix(), null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ datasets: datasetRegistry.length, problems: validateRegistry() })}\n`);
}
