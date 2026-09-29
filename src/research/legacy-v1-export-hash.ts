import { canonicalJson, sha256 } from './point-in-time-evidence.js';

// These are PostgreSQL timestamp columns selected by the v1 exporter at
// acfe2b5. Its pre-e213081 canonicalizer treated Date instances as empty
// objects, while JSON.stringify(dataset.json) serialized them as ISO text.
const timestampColumns: Readonly<Record<string, readonly string[]>> = {
  candidateSets: ['decisionTime'],
  candidates: ['decisionTime'],
  shadowCandidates: ['observedAt'],
  strategyFrontiers: ['observedAt'],
  managementSnapshots: ['observedAt'],
  lifecycleOutcomes: ['appliedAt'],
  wholeChainOutcomes: ['labelAvailableAt'],
  executionEvidence: ['observedAt', 'providerTimestamp', 'ingestionTimestamp'],
};

export interface LegacyV1HashVerdict {
  readonly state: 'PRODUCER_HASH_REPRODUCED' | 'UNRESOLVED';
  readonly producerVariant: 'DATE_ELISION_EXPORTED_AT_EXCLUDED' | 'DATE_ELISION_EXPORTED_AT_INCLUDED'
    | 'DATE_AWARE_EXPORTED_AT_EXCLUDED' | 'DATE_AWARE_EXPORTED_AT_INCLUDED' | null;
  readonly declaredHash: string;
  readonly reconstructedHashWithoutExportedAt: string;
  readonly reconstructedHashWithExportedAt: string;
  readonly timestampFieldsElided: number;
  readonly timestampIntegrityProtected: boolean;
  readonly promotionGrade: false;
}

/** Forensic compatibility only. Never pass this verdict to the promotion loader. */
export function inspectLegacyV1ExportHash(raw: unknown): LegacyV1HashVerdict {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('LEGACY_EXPORT_INVALID');
  const value = raw as Record<string, unknown>;
  if (value.schemaVersion !== 'theta-r6-dataset-v1') throw new Error('LEGACY_EXPORT_SCHEMA_UNSUPPORTED');
  if (typeof value.datasetHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.datasetHash)) {
    throw new Error('LEGACY_EXPORT_HASH_INVALID');
  }
  if (value.rows === null || typeof value.rows !== 'object' || Array.isArray(value.rows)) {
    throw new Error('LEGACY_EXPORT_ROWS_INVALID');
  }
  const sourceRows = value.rows as Record<string, unknown>;
  const reconstructedRows: Record<string, unknown> = {};
  let timestampFieldsElided = 0;
  for (const [family, rows] of Object.entries(sourceRows)) {
    if (!Array.isArray(rows)) throw new Error(`LEGACY_EXPORT_FAMILY_INVALID:${family}`);
    const fields = timestampColumns[family] ?? [];
    reconstructedRows[family] = rows.map((entry: unknown) => {
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
        throw new Error(`LEGACY_EXPORT_ROW_INVALID:${family}`);
      }
      const row = { ...(entry as Record<string, unknown>) };
      for (const field of fields) {
        const observed = row[field];
        if (observed === null || observed === undefined) continue;
        if (typeof observed !== 'string' || Number.isNaN(Date.parse(observed))) {
          throw new Error(`LEGACY_EXPORT_TIMESTAMP_INVALID:${family}.${field}`);
        }
        row[field] = {};
        timestampFieldsElided += 1;
      }
      return row;
    });
  }
  const identity = {
    schemaVersion: value.schemaVersion,
    sourceWindow: value.sourceWindow,
    featureSetVersion: value.featureSetVersion,
    strategyVersions: value.strategyVersions,
    rows: reconstructedRows,
    rowCounts: value.rowCounts,
  };
  const without = sha256(canonicalJson(identity));
  const withExportedAt = sha256(canonicalJson({ ...identity, exportedAt: value.exportedAt }));
  const dateAwareIdentity = { ...identity, rows: sourceRows };
  const dateAwareWithout = sha256(canonicalJson(dateAwareIdentity));
  const dateAwareWith = sha256(canonicalJson({ ...dateAwareIdentity, exportedAt: value.exportedAt }));
  const producerVariant = without === value.datasetHash
    ? 'DATE_ELISION_EXPORTED_AT_EXCLUDED'
    : withExportedAt === value.datasetHash ? 'DATE_ELISION_EXPORTED_AT_INCLUDED'
      : dateAwareWithout === value.datasetHash ? 'DATE_AWARE_EXPORTED_AT_EXCLUDED'
        : dateAwareWith === value.datasetHash ? 'DATE_AWARE_EXPORTED_AT_INCLUDED' : null;
  return {
    state: producerVariant === null ? 'UNRESOLVED' : 'PRODUCER_HASH_REPRODUCED',
    producerVariant,
    declaredHash: value.datasetHash,
    reconstructedHashWithoutExportedAt: without,
    reconstructedHashWithExportedAt: withExportedAt,
    timestampFieldsElided,
    timestampIntegrityProtected: producerVariant?.startsWith('DATE_AWARE') ?? false,
    promotionGrade: false,
  };
}
