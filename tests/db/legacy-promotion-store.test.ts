import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';
import { promoteLegacyRecovery } from '../../src/database/legacy-promotion.js';

const sha = (value:string) => createHash('sha256').update(value).digest('hex');

test('legacy promotion exposes validated PIT history without changing canonical rows', {
  skip:!process.env.TEST_DATABASE_URL,
}, async()=>{
  const connectionString=process.env.TEST_DATABASE_URL; assert.ok(connectionString); const url=new URL(connectionString);
  assert.ok(['localhost','127.0.0.1'].includes(url.hostname),'Disposable local database only');
  const pool=new Pool({connectionString,max:1});
  const importBatchId=randomUUID(), artifactRecordId=randomUUID(), candidateSetId=randomUUID();
  const contentHash=sha(candidateSetId); const now='2026-09-15T15:00:00.000Z';
  const payload={candidateSetId,decisionTime:now,universeEvaluated:[],branchesConsidered:[],counts:{evaluated:0},
    bestCandidateId:null,secondBestCandidateId:null,bestRejectedCandidateId:null,completenessState:'COMPLETE',missingScope:[],contentHash};
  try{
    await pool.query(`INSERT INTO legacy_neon.import_batch(import_batch_id,source_system,source_project_hash,source_branch,
      artifact_type,dataset_hash,schema_version,source_window_start,source_window_end,original_exported_at,status,
      declared_row_count,imported_row_count,import_completed_at,metadata)
      VALUES($1,'NEON_LEGACY',$2,'main','R6_DATASET',$3,'test-v1',$4,$4,$4,'VALIDATING',1,1,$4,'{}')`,
    [importBatchId,sha('project'),sha(importBatchId),now]);
    await pool.query(`INSERT INTO legacy_neon.artifact_record(artifact_record_id,import_batch_id,source_family,
      source_record_key,source_checksum,original_created_at,classification,pit_eligibility,payload)
      VALUES($1,$2,'candidateSets',$3,$4,$5,'REAL_PRODUCTION_EVIDENCE','ELIGIBLE',$6::jsonb)`,
    [artifactRecordId,importBatchId,candidateSetId,sha(JSON.stringify(payload)),now,JSON.stringify(payload)]);
    const receipt=await promoteLegacyRecovery(connectionString,importBatchId);
    assert.equal(receipt.state,'COMPLETE');
    assert.equal(receipt.researchHistoryRows,1);
    assert.equal(receipt.canonicalRowsChanged,0);
    const promoted=await pool.query(`SELECT source_record_key,payload->>'candidateSetId' AS candidate_set_id
      FROM research.legacy_neon_recovered_evidence WHERE import_batch_id=$1`,[importBatchId]);
    assert.equal(promoted.rowCount,1);
    assert.equal(promoted.rows[0].candidate_set_id,candidateSetId);
    const canonical=await pool.query(`SELECT count(*)::integer AS count FROM trade.candidate_set_evidence
      WHERE candidate_set_id=$1`,[candidateSetId]);
    assert.equal(Number(canonical.rows[0].count),0);
  }finally{await pool.end();}
});
