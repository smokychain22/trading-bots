import { createHash, randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';

export const LEGACY_PROMOTION_VALIDATOR_VERSION = 'theta-legacy-promotion-v1';

export interface LegacyPromotionReceipt {
  readonly state: 'COMPLETE' | 'PARTIAL';
  readonly promotionBatchId: string;
  readonly importBatchId: string;
  readonly validatorVersion: string;
  readonly stagingFingerprint: string;
  readonly sourceRecordCount: number;
  readonly classifiedRecordCount: number;
  readonly dispositionCounts: Readonly<Record<string, number>>;
  readonly familyCounts: Readonly<Record<string, Readonly<Record<string, number>>>>;
  readonly researchHistoryRows: number;
  readonly engineeringHistoryRows: number;
  readonly canonicalRowsChanged: 0;
  readonly executionAuthorized: false;
}

export interface LegacyPromotionSweepReceipt {
  readonly state: 'COMPLETE' | 'PARTIAL';
  readonly batches: readonly LegacyPromotionReceipt[];
  readonly sourceRecordCount: number;
  readonly classifiedRecordCount: number;
  readonly researchHistoryRows: number;
  readonly engineeringHistoryRows: number;
  readonly canonicalRowsChanged: 0;
  readonly executionAuthorized: false;
}

interface FamilyPolicy {
  readonly family: string;
  readonly targetRelation: string;
  readonly idKey?: string;
  readonly timestampKey: string;
  readonly contentHashKey?: string;
  readonly nativeTable?: string;
  readonly nativeIdColumn?: string;
  readonly nativeHashColumn?: string;
  readonly classification: 'RESEARCH' | 'ENGINEERING';
  readonly requiredKeys: readonly string[];
}

const uuidPattern = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$';
const shaPattern = '^[0-9a-f]{64}$';

const policies: readonly FamilyPolicy[] = [
  { family:'candidateSets', targetRelation:'trade.candidate_set_evidence', idKey:'candidateSetId', timestampKey:'decisionTime',
    contentHashKey:'contentHash', nativeTable:'trade.candidate_set_evidence', nativeIdColumn:'candidate_set_id', nativeHashColumn:'content_hash',
    classification:'RESEARCH', requiredKeys:['candidateSetId','decisionTime','universeEvaluated','branchesConsidered','counts','contentHash'] },
  { family:'candidates', targetRelation:'trade.candidate_point_in_time_evidence', idKey:'candidateId', timestampKey:'decisionTime',
    contentHashKey:'contentHash', nativeTable:'trade.candidate_point_in_time_evidence', nativeIdColumn:'candidate_id', nativeHashColumn:'content_hash',
    classification:'RESEARCH', requiredKeys:['candidateId','fusionSnapshotId','decisionTime','branch','contract','market','lineage','contentHash'] },
  { family:'shadowCandidates', targetRelation:'trade.shadow_opportunity', idKey:'opportunityId', timestampKey:'observedAt',
    nativeTable:'trade.shadow_opportunity', nativeIdColumn:'opportunity_id', classification:'RESEARCH',
    requiredKeys:['opportunityId','fusionSnapshotId','observedAt','underlying','strategyBranch','decisionDisposition'] },
  { family:'strategyFrontiers', targetRelation:'trade.canonical_strategy_frontier', idKey:'frontierId', timestampKey:'observedAt',
    contentHashKey:'contentHash', nativeTable:'trade.canonical_strategy_frontier', nativeIdColumn:'frontier_id', nativeHashColumn:'content_hash',
    classification:'RESEARCH', requiredKeys:['frontierId','fusionSnapshotId','observedAt','branchesConsidered','branchesEvaluated','frontier','contentHash'] },
  { family:'optionChainDecisions', targetRelation:'research.theta_option_chain_decision_evidence', idKey:'chainDecisionEvidenceId', timestampKey:'observedAt',
    contentHashKey:'contentHash', nativeTable:'research.theta_option_chain_decision_evidence', nativeIdColumn:'chain_decision_evidence_id', nativeHashColumn:'content_hash',
    classification:'RESEARCH', requiredKeys:['chainDecisionEvidenceId','fusionSnapshotId','observedAt','underlying','chainSnapshot','contentHash'] },
  { family:'executionEvidence', targetRelation:'market.execution_quote_observation', idKey:'quoteObservationId', timestampKey:'observedAt',
    contentHashKey:'contentHash', nativeTable:'market.execution_quote_observation', nativeIdColumn:'quote_observation_id', nativeHashColumn:'content_hash',
    classification:'RESEARCH', requiredKeys:['quoteObservationId','observationRole','observedAt','ingestionTimestamp','source','dataQuality','contentHash'] },
  { family:'outcomeSubjects', targetRelation:'research.theta_outcome_subject', idKey:'outcomeSubjectId', timestampKey:'decisionTimestamp',
    contentHashKey:'contentHash', nativeTable:'research.theta_outcome_subject', nativeIdColumn:'outcome_subject_id', nativeHashColumn:'content_hash',
    classification:'RESEARCH', requiredKeys:['outcomeSubjectId','subjectId','labelType','decisionTimestamp','horizonId','contentHash'] },
  { family:'outcomeResolutionReceipts', targetRelation:'research.theta_outcome_resolution_receipt', idKey:'outcomeResolutionReceiptId', timestampKey:'resolutionTimestamp',
    contentHashKey:'contentHash', nativeTable:'research.theta_outcome_resolution_receipt', nativeIdColumn:'outcome_resolution_receipt_id', nativeHashColumn:'content_hash',
    classification:'RESEARCH', requiredKeys:['outcomeResolutionReceiptId','outcomeSubjectId','resolutionState','resolutionTimestamp','receipt','contentHash'] },
  { family:'controlPlaneManifest', targetRelation:'ops.legacy_neon_recovered_engineering_history', timestampKey:'capturedAt',
    classification:'ENGINEERING', requiredKeys:['schemaVersion','capturedAt','project','branches','quota'] },
] as const;

export function matchesLegacyPromotionConfirmation(value: string | readonly string[] | undefined): boolean {
  return typeof value === 'string' && value === 'AIVEN_LEGACY_PROMOTE_051';
}

export function validateLegacyPayload(policy: FamilyPolicy, payload: unknown, pitEligibility: string, classification: string): readonly string[] {
  const errors: string[] = [];
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return ['PAYLOAD_NOT_OBJECT'];
  const record = payload as Record<string, unknown>;
  for (const key of policy.requiredKeys) if (!(key in record)) errors.push(`MISSING_${key}`);
  if (policy.idKey !== undefined &&
    (typeof record[policy.idKey] !== 'string' || !new RegExp(uuidPattern).test(String(record[policy.idKey])))) errors.push('INVALID_RECORD_ID');
  if (typeof record[policy.timestampKey] !== 'string' || Number.isNaN(Date.parse(String(record[policy.timestampKey])))) errors.push('INVALID_OBSERVED_AT');
  if (policy.contentHashKey !== undefined &&
    (typeof record[policy.contentHashKey] !== 'string' || !new RegExp(shaPattern).test(String(record[policy.contentHashKey])))) errors.push('INVALID_CONTENT_HASH');
  if (policy.classification === 'RESEARCH') {
    if (pitEligibility !== 'ELIGIBLE') errors.push('PIT_NOT_ELIGIBLE');
    if (!['REAL_PRODUCTION_EVIDENCE','REAL_PROVIDER_EVIDENCE'].includes(classification)) errors.push('NON_REAL_EVIDENCE_CLASS');
  }
  if ('executionAuthorized' in record && record.executionAuthorized !== false) errors.push('EXECUTION_AUTHORIZED_NOT_FALSE');
  return errors;
}

export function validateLegacyFamilyPayload(family: string, payload: unknown, pitEligibility: string,
  classification: string): readonly string[] {
  const policy = policies.find((candidate) => candidate.family === family);
  return policy === undefined ? ['UNSUPPORTED_SOURCE_FAMILY']
    : validateLegacyPayload(policy, payload, pitEligibility, classification);
}

export async function promoteLegacyRecovery(connectionString: string, requestedImportBatchId?: string): Promise<LegacyPromotionSweepReceipt> {
  const pool = new Pool({ connectionString, max: 2, connectionTimeoutMillis: 8_000, idleTimeoutMillis: 1_000,
    application_name: 'theta-aiven-legacy-promotion' });
  try {
    const batchResult = await pool.query(`SELECT import_batch_id,status,declared_row_count,imported_row_count
      FROM legacy_neon.import_batch
      WHERE ($1::uuid IS NULL OR import_batch_id=$1::uuid)
        AND status IN ('VALIDATING','APPROVED','BACKFILLED') AND declared_row_count=imported_row_count
      ORDER BY original_exported_at,import_started_at,import_batch_id`, [requestedImportBatchId ?? null]);
    if (batchResult.rowCount === 0) throw Object.assign(new Error('LEGACY_IMPORT_BATCH_NOT_FOUND'), { code:'IMPORT_BATCH_NOT_FOUND' });
    const receipts: LegacyPromotionReceipt[] = [];
    for (const batch of batchResult.rows) {
      const importBatchId = String(batch.import_batch_id);
      const sourceRecordCount = Number(batch.imported_row_count);
      const checksumRows = await pool.query(`SELECT source_family,source_record_key,source_checksum
        FROM legacy_neon.artifact_record WHERE import_batch_id=$1 ORDER BY source_family,source_record_key,source_checksum`, [importBatchId]);
      const fingerprint = createHash('sha256');
      for (const row of checksumRows.rows) fingerprint.update(`${row.source_family}\0${row.source_record_key}\0${row.source_checksum}\n`);
      const client = await pool.connect();
      try {
        receipts.push(await classifyAndPromote(client, importBatchId, sourceRecordCount, fingerprint.digest('hex')));
      } finally {
        client.release();
      }
    }
    return { state:receipts.every((receipt) => receipt.state === 'COMPLETE') ? 'COMPLETE' : 'PARTIAL', batches:receipts,
      sourceRecordCount:receipts.reduce((sum,receipt) => sum+receipt.sourceRecordCount,0),
      classifiedRecordCount:receipts.reduce((sum,receipt) => sum+receipt.classifiedRecordCount,0),
      researchHistoryRows:receipts.reduce((sum,receipt) => sum+receipt.researchHistoryRows,0),
      engineeringHistoryRows:receipts.reduce((sum,receipt) => sum+receipt.engineeringHistoryRows,0),
      canonicalRowsChanged:0, executionAuthorized:false };
  } finally {
    await pool.end();
  }
}

async function classifyAndPromote(client: PoolClient, importBatchId: string, sourceRecordCount: number,
  stagingFingerprint: string): Promise<LegacyPromotionReceipt> {
  await client.query('BEGIN');
  try {
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('theta-legacy-promotion:'||$1))`, [importBatchId]);
    const existing = await client.query(`SELECT promotion_batch_id,state FROM legacy_neon.promotion_batch
      WHERE import_batch_id=$1 AND validator_version=$2`, [importBatchId, LEGACY_PROMOTION_VALIDATOR_VERSION]);
    const promotionBatchId = existing.rowCount === 1 ? String(existing.rows[0].promotion_batch_id) : randomUUID();
    if (existing.rowCount === 0) {
      await client.query(`INSERT INTO legacy_neon.promotion_batch(promotion_batch_id,import_batch_id,validator_version,
        staging_fingerprint,state,source_record_count) VALUES($1,$2,$3,$4,'VALIDATING',$5)`,
      [promotionBatchId, importBatchId, LEGACY_PROMOTION_VALIDATOR_VERSION, stagingFingerprint, sourceRecordCount]);
    } else if (String(existing.rows[0].state) === 'COMPLETE') {
      await client.query('COMMIT');
      return loadReceipt(client, promotionBatchId, importBatchId, stagingFingerprint, sourceRecordCount);
    }

    for (const policy of policies) await promoteFamily(client, promotionBatchId, importBatchId, policy);
    const unsupported = await client.query(`SELECT count(*)::integer AS count FROM legacy_neon.artifact_record ar
      WHERE ar.import_batch_id=$1 AND NOT(ar.source_family=ANY($2::text[]))`, [importBatchId, policies.map((policy) => policy.family)]);
    if (Number(unsupported.rows[0]?.count ?? 0) > 0) throw Object.assign(new Error('UNSUPPORTED_LEGACY_SOURCE_FAMILY'), { code:'UNSUPPORTED_SOURCE_FAMILY' });

    const countsResult = await client.query(`SELECT disposition,count(*)::integer AS count
      FROM legacy_neon.promotion_record WHERE promotion_batch_id=$1 GROUP BY disposition ORDER BY disposition`, [promotionBatchId]);
    const dispositionCounts = Object.fromEntries(countsResult.rows.map((row) => [String(row.disposition), Number(row.count)]));
    const classifiedRecordCount = Object.values(dispositionCounts).reduce((sum, count) => sum + count, 0);
    const rejected = Number(dispositionCounts.REJECTED_INVALID ?? 0) + Number(dispositionCounts.CONFLICT_QUARANTINED ?? 0)
      + Number(dispositionCounts.CANONICAL_MATCH_QUARANTINED ?? 0);
    const state = classifiedRecordCount === sourceRecordCount && rejected === 0 ? 'COMPLETE' : 'PARTIAL';
    await client.query(`UPDATE legacy_neon.promotion_batch SET state=$2,completed_at=now(),classified_record_count=$3,
      disposition_counts_json=$4::jsonb WHERE promotion_batch_id=$1`,
    [promotionBatchId, state, classifiedRecordCount, JSON.stringify(dispositionCounts)]);
    await client.query(`UPDATE legacy_neon.import_batch SET status='APPROVED'
      WHERE import_batch_id=$1 AND status='VALIDATING'`, [importBatchId]);
    await client.query('COMMIT');
    return loadReceipt(client, promotionBatchId, importBatchId, stagingFingerprint, sourceRecordCount);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function promoteFamily(client: PoolClient, promotionBatchId: string, importBatchId: string, policy: FamilyPolicy): Promise<void> {
  const result = await client.query(`SELECT artifact_record_id,source_record_key,source_checksum,classification,pit_eligibility,payload
    FROM legacy_neon.artifact_record WHERE import_batch_id=$1 AND source_family=$2 ORDER BY source_record_key`,
  [importBatchId, policy.family]);
  if (result.rowCount === 0) return;
  const native = policy.nativeTable === undefined ? new Map<string, string | null>()
    : await loadNativeIdentities(client, policy, result.rows.map((row) => policy.idKey === undefined ? ''
      : String((row.payload as Record<string, unknown>)[policy.idKey] ?? '')));
  const pending: Record<string, unknown>[] = [];
  for (const row of result.rows) {
    const payload = row.payload as Record<string, unknown>;
    const errors = validateLegacyPayload(policy, payload, String(row.pit_eligibility), String(row.classification));
    const targetKey = policy.idKey === undefined ? String(row.source_record_key)
      : typeof payload?.[policy.idKey] === 'string' ? String(payload[policy.idKey]) : null;
    const observedAt = typeof payload?.[policy.timestampKey] === 'string' && !Number.isNaN(Date.parse(String(payload[policy.timestampKey])))
      ? new Date(String(payload[policy.timestampKey])).toISOString() : null;
    const nativeHash = targetKey === null ? undefined : native.get(targetKey);
    const payloadHash = policy.contentHashKey === undefined ? undefined : payload?.[policy.contentHashKey];
    let disposition: string;
    let reasonCode: string;
    if (errors.length > 0) { disposition='REJECTED_INVALID'; reasonCode='SCHEMA_OR_PROVENANCE_VALIDATION_FAILED'; }
    else if (nativeHash !== undefined && policy.nativeHashColumn === undefined) {
      disposition='CANONICAL_MATCH_QUARANTINED'; reasonCode='CANONICAL_ID_PRESENT_CONTENT_EQUIVALENCE_UNPROVEN';
    } else if (nativeHash !== undefined && nativeHash === payloadHash) {
      disposition='DUPLICATE_CANONICAL'; reasonCode='CANONICAL_ID_AND_CONTENT_HASH_MATCH';
    } else if (nativeHash !== undefined) {
      disposition='CONFLICT_QUARANTINED'; reasonCode='CANONICAL_ID_PRESENT_CONTENT_HASH_DIFFERS';
    } else if (policy.classification === 'ENGINEERING') {
      disposition='PROMOTED_ENGINEERING_HISTORY'; reasonCode='VALIDATED_NON_RUNTIME_ENGINEERING_HISTORY';
    } else {
      disposition='PROMOTED_RESEARCH_HISTORY'; reasonCode='VALIDATED_PIT_HISTORY_NATIVE_PARENT_SET_INCOMPLETE';
    }
    pending.push({ promotionRecordId:randomUUID(), artifactRecordId:row.artifact_record_id,
      sourceFamily:policy.family, sourceRecordKey:row.source_record_key, sourceChecksum:row.source_checksum,
      targetRelation:policy.targetRelation, targetRecordKey:targetKey, observedAt, disposition, reasonCode,
      validation:{ validatorVersion:LEGACY_PROMOTION_VALIDATOR_VERSION, errors, nativeIdentityChecked:policy.nativeTable !== undefined,
        nativeContentHashComparable:policy.nativeHashColumn !== undefined, canonicalRowsChanged:0 } });
  }
  for (let index=0; index<pending.length; index+=500) {
    await client.query(`INSERT INTO legacy_neon.promotion_record(promotion_record_id,promotion_batch_id,artifact_record_id,
      source_family,source_record_key,source_checksum,target_relation,target_record_key,observed_at,disposition,reason_code,validation_json)
      SELECT (item->>'promotionRecordId')::uuid,$1,(item->>'artifactRecordId')::uuid,item->>'sourceFamily',
        item->>'sourceRecordKey',item->>'sourceChecksum',item->>'targetRelation',NULLIF(item->>'targetRecordKey',''),
        NULLIF(item->>'observedAt','')::timestamptz,item->>'disposition',item->>'reasonCode',item->'validation'
      FROM jsonb_array_elements($2::jsonb) item ON CONFLICT(promotion_batch_id,artifact_record_id) DO NOTHING`,
    [promotionBatchId, JSON.stringify(pending.slice(index,index+500))]);
  }
}

async function loadNativeIdentities(client: PoolClient, policy: FamilyPolicy, ids: readonly string[]): Promise<Map<string, string | null>> {
  const validIds = ids.filter((id) => new RegExp(uuidPattern).test(id));
  if (validIds.length === 0 || policy.nativeTable === undefined || policy.nativeIdColumn === undefined) return new Map();
  const hashSelect = policy.nativeHashColumn === undefined ? 'NULL::text' : `${policy.nativeHashColumn}::text`;
  // Canonical evidence identifiers are not uniform. Most are UUID columns, while
  // shadow_opportunity.opportunity_id is text even when its value is UUID-shaped.
  // Compare the normalized textual representation so the same bounded query works
  // for both physical types without relying on an implicit PostgreSQL operator.
  const result = await client.query(`SELECT ${policy.nativeIdColumn}::text AS id,${hashSelect} AS content_hash
    FROM ${policy.nativeTable} WHERE ${policy.nativeIdColumn}::text=ANY($1::text[])`, [validIds]);
  return new Map(result.rows.map((row) => [String(row.id), row.content_hash === null ? null : String(row.content_hash)]));
}

async function loadReceipt(client: PoolClient, promotionBatchId: string, importBatchId: string,
  stagingFingerprint: string, sourceRecordCount: number): Promise<LegacyPromotionReceipt> {
  const batch = await client.query(`SELECT state,classified_record_count,disposition_counts_json
    FROM legacy_neon.promotion_batch WHERE promotion_batch_id=$1`, [promotionBatchId]);
  const families = await client.query(`SELECT source_family,disposition,count(*)::integer AS count
    FROM legacy_neon.promotion_record WHERE promotion_batch_id=$1 GROUP BY source_family,disposition ORDER BY source_family,disposition`, [promotionBatchId]);
  const familyCounts: Record<string,Record<string,number>> = {};
  for (const row of families.rows) (familyCounts[String(row.source_family)] ??= {})[String(row.disposition)] = Number(row.count);
  const dispositions = batch.rows[0]?.disposition_counts_json as Record<string, number> ?? {};
  return { state:String(batch.rows[0]?.state) === 'COMPLETE' ? 'COMPLETE' : 'PARTIAL', promotionBatchId, importBatchId,
    validatorVersion:LEGACY_PROMOTION_VALIDATOR_VERSION, stagingFingerprint, sourceRecordCount,
    classifiedRecordCount:Number(batch.rows[0]?.classified_record_count ?? 0), dispositionCounts:dispositions, familyCounts,
    researchHistoryRows:Number(dispositions.PROMOTED_RESEARCH_HISTORY ?? 0),
    engineeringHistoryRows:Number(dispositions.PROMOTED_ENGINEERING_HISTORY ?? 0),
    canonicalRowsChanged:0, executionAuthorized:false };
}
