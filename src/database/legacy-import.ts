import { z } from 'zod';
import { Pool } from 'pg';

const hash = z.string().regex(/^[0-9a-f]{64}$/);
const evidenceClass = z.enum([
  'REAL_PRODUCTION_EVIDENCE', 'REAL_PROVIDER_EVIDENCE', 'SYNTHETIC', 'TEST_FIXTURE', 'REPLAY', 'UNKNOWN',
]);
const timestamp = z.string().datetime({ offset: true });

const startSchema = z.object({
  kind: z.literal('START'),
  importBatchId: z.string().uuid(),
  sourceProjectHash: hash,
  sourceBranch: z.string().min(1).max(200),
  artifactType: z.string().min(1).max(100),
  datasetHash: hash,
  schemaVersion: z.string().min(1).max(100),
  sourceWindowStart: timestamp,
  sourceWindowEnd: timestamp,
  originalExportedAt: timestamp,
  declaredRowCount: z.number().int().nonnegative(),
  metadata: z.record(z.string(), z.unknown()),
  files: z.array(z.object({
    artifactFileId: z.string().uuid(), fileName: z.string().regex(/^[^\\/]{1,255}$/),
    byteLength: z.number().int().nonnegative(), fileSha256: hash, classification: evidenceClass,
  })).max(20),
}).strict();

const recordsSchema = z.object({
  kind: z.literal('RECORDS'),
  importBatchId: z.string().uuid(),
  sourceFamily: z.string().min(1).max(100),
  records: z.array(z.object({
    artifactRecordId: z.string().uuid(), sourceRecordKey: z.string().min(1).max(500), sourceChecksum: hash,
    originalCreatedAt: timestamp.nullable(), originalUpdatedAt: timestamp.nullable(), classification: evidenceClass,
    pitEligibility: z.enum(['ELIGIBLE','INELIGIBLE','UNKNOWN']), payload: z.unknown(),
  })).min(1).max(500),
}).strict();

const completeSchema = z.object({
  kind: z.literal('COMPLETE'), importBatchId: z.string().uuid(), expectedRowCount: z.number().int().nonnegative(),
}).strict();

export const legacyImportRequestSchema = z.discriminatedUnion('kind', [startSchema, recordsSchema, completeSchema]);
export type LegacyImportRequest = z.infer<typeof legacyImportRequestSchema>;

export async function applyLegacyImportRequest(connectionString: string, input: unknown): Promise<unknown> {
  const request = legacyImportRequestSchema.parse(input);
  const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 8_000, idleTimeoutMillis: 1_000,
    application_name: 'theta-aiven-legacy-staging-import' });
  const client = await pool.connect();
  try {
    if (request.kind === 'START') {
      await client.query('BEGIN');
      try {
        await client.query(`INSERT INTO legacy_neon.import_batch(
          import_batch_id,source_system,source_project_hash,source_branch,artifact_type,dataset_hash,schema_version,
          source_window_start,source_window_end,original_exported_at,status,declared_row_count,metadata)
          VALUES($1,'NEON_LEGACY',$2,$3,$4,$5,$6,$7,$8,$9,'STAGED',$10,$11::jsonb)
          ON CONFLICT(source_system,artifact_type,dataset_hash,schema_version) DO NOTHING`, [
          request.importBatchId, request.sourceProjectHash, request.sourceBranch, request.artifactType,
          request.datasetHash, request.schemaVersion, request.sourceWindowStart, request.sourceWindowEnd,
          request.originalExportedAt, request.declaredRowCount, JSON.stringify(request.metadata),
        ]);
        const batch = await client.query(`SELECT import_batch_id,declared_row_count,imported_row_count,status
          FROM legacy_neon.import_batch WHERE source_system='NEON_LEGACY' AND artifact_type=$1
            AND dataset_hash=$2 AND schema_version=$3`, [request.artifactType, request.datasetHash, request.schemaVersion]);
        if (batch.rowCount !== 1 || Number(batch.rows[0].declared_row_count) !== request.declaredRowCount)
          throw Object.assign(new Error('LEGACY_IMPORT_BATCH_CONFLICT'), { code: 'IMPORT_BATCH_CONFLICT' });
        const batchId = String(batch.rows[0].import_batch_id);
        for (const file of request.files) {
          await client.query(`INSERT INTO legacy_neon.artifact_file(
            artifact_file_id,import_batch_id,file_name,byte_length,file_sha256,classification)
            VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(file_sha256) DO NOTHING`, [
            file.artifactFileId, batchId, file.fileName, file.byteLength, file.fileSha256, file.classification,
          ]);
        }
        await client.query('COMMIT');
        return { state: 'STAGED', importBatchId: batchId, declaredRowCount: request.declaredRowCount,
          importedRowCount: Number(batch.rows[0].imported_row_count), executionAuthorized: false };
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }

    if (request.kind === 'RECORDS') {
      await client.query('BEGIN');
      try {
        const batch = await client.query(`SELECT status FROM legacy_neon.import_batch
          WHERE import_batch_id=$1 FOR UPDATE`, [request.importBatchId]);
        if (batch.rowCount !== 1 || !['STAGED','VALIDATING'].includes(String(batch.rows[0].status)))
          throw Object.assign(new Error('LEGACY_IMPORT_BATCH_NOT_WRITABLE'), { code: 'IMPORT_NOT_WRITABLE' });
        const inserted = await client.query(`INSERT INTO legacy_neon.artifact_record(
          artifact_record_id,import_batch_id,source_family,source_record_key,source_checksum,
          original_created_at,original_updated_at,classification,pit_eligibility,payload)
          SELECT (item->>'artifactRecordId')::uuid,$1,$2,item->>'sourceRecordKey',item->>'sourceChecksum',
            NULLIF(item->>'originalCreatedAt','')::timestamptz,NULLIF(item->>'originalUpdatedAt','')::timestamptz,
            item->>'classification',item->>'pitEligibility',item->'payload'
          FROM jsonb_array_elements($3::jsonb) AS item
          ON CONFLICT DO NOTHING RETURNING artifact_record_id`, [
          request.importBatchId, request.sourceFamily, JSON.stringify(request.records),
        ]);
        const count = await client.query(`UPDATE legacy_neon.import_batch SET imported_row_count=(
          SELECT count(*) FROM legacy_neon.artifact_record WHERE import_batch_id=$1)
          WHERE import_batch_id=$1 RETURNING imported_row_count`, [request.importBatchId]);
        await client.query('COMMIT');
        return { state: 'STAGED', importBatchId: request.importBatchId, acceptedNow: inserted.rowCount,
          importedRowCount: Number(count.rows[0].imported_row_count), executionAuthorized: false };
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }

    const completed = await client.query(`UPDATE legacy_neon.import_batch
      SET status='VALIDATING',import_completed_at=now()
      WHERE import_batch_id=$1 AND declared_row_count=$2 AND imported_row_count=$2 AND status IN ('STAGED','VALIDATING')
      RETURNING imported_row_count`, [request.importBatchId, request.expectedRowCount]);
    if (completed.rowCount !== 1)
      throw Object.assign(new Error('LEGACY_IMPORT_COUNT_MISMATCH'), { code: 'IMPORT_COUNT_MISMATCH' });
    return { state: 'VALIDATING', importBatchId: request.importBatchId,
      importedRowCount: Number(completed.rows[0].imported_row_count), executionAuthorized: false };
  } finally {
    client.release();
    await pool.end();
  }
}
