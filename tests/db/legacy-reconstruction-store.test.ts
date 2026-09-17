import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';
import { canonicalJson } from '../../src/research/point-in-time-evidence.js';
import {
  computeLegacyReconstructionManifestHash,
  importLegacyReconstructionManifest,
  LEGACY_RECONSTRUCTION_METHOD_VERSION,
} from '../../src/database/legacy-reconstruction-registry.js';

const sha=(value:string)=>createHash('sha256').update(value).digest('hex');

test('legacy reconstruction manifest imports once and cannot authorize execution',{
  skip:!process.env.TEST_DATABASE_URL,
},async()=>{
  const connectionString=process.env.TEST_DATABASE_URL;assert.ok(connectionString);const url=new URL(connectionString);
  assert.ok(['localhost','127.0.0.1'].includes(url.hostname),'Disposable local database only');
  const sweepId=randomUUID();const sourceId=randomUUID();const assessmentId=randomUUID();const now='2026-09-17T09:00:00.000Z';
  const assessmentUnsigned={targetRelation:'core.schema_migration',purpose:'immutable migration history',writerModules:['tools/database-migrate.mjs'],
    sourceOrigins:['GIT_SCHEMA'],primaryKeyColumns:['version'],foreignKeyParents:[],timestampSemantics:'applied_at is database application time',
    pitRequirements:'not eligible as a market feature',reconstructability:'RECONSTRUCTED_SCHEMA_ONLY' as const,exactOriginalRows:0,
    authoritativeRows:0,deterministicRows:0,partialRows:0,missingParentCount:0,usefulForResearch:false,usefulForRuntime:true,
    blocking:false,evidence:{executionAuthorized:false}};
  const unsigned={schemaVersion:'theta-legacy-reconstruction-manifest-v1' as const,reconstructionSweepId:sweepId,generatedAt:now,
    sourceCodeSha:'c9ab5aa457ce56dc8b175590e132908a02e52190',methodVersion:LEGACY_RECONSTRUCTION_METHOD_VERSION,
    sources:[{reconstructionSourceId:sourceId,sourceType:'GITHUB_DETERMINISTIC' as const,sourceSystem:'TEST_GIT',
      sourceLocator:'git:test@main',sourceProject:'test',sourceBranch:'main',sourceSha:'c9ab5aa457ce56dc8b175590e132908a02e52190',
      sourceTimestamp:now,contentHash:sha('source'),reconstructionMethod:'TEST',confidenceClass:'A' as const,
      pitEligibility:'INELIGIBLE' as const,evidenceClass:'TEST' as const,recordCount:1,metadata:{}}],
    families:[{familyRecoveryAssessmentId:assessmentId,...assessmentUnsigned,
      assessmentHash:sha(canonicalJson(assessmentUnsigned))}],summary:{executionAuthorized:false}};
  const manifest={...unsigned,manifestHash:computeLegacyReconstructionManifestHash(unsigned)};
  const [first,replay]=await Promise.all([
    importLegacyReconstructionManifest(connectionString,manifest),
    importLegacyReconstructionManifest(connectionString,manifest),
  ]);
  assert.equal(first.state,'IMPORTED');assert.deepEqual(replay,first);assert.equal(first.executionAuthorized,false);
  assert.equal(first.sourceCount,1);assert.equal(first.familyCount,1);assert.equal(first.canonicalRowsChanged,0);
  const pool=new Pool({connectionString,max:1});
  try{
    const stored=await pool.query(`SELECT rs.execution_authorized,fra.execution_authorized,
      (SELECT count(*)::integer FROM legacy_neon.reconstruction_source WHERE reconstruction_sweep_id=rs.reconstruction_sweep_id) AS source_count
      FROM legacy_neon.reconstruction_sweep rs JOIN legacy_neon.family_recovery_assessment fra USING(reconstruction_sweep_id)
      WHERE rs.manifest_hash=$1`,[manifest.manifestHash]);
    assert.equal(stored.rowCount,1);assert.equal(stored.rows[0].execution_authorized,false);
    assert.equal(stored.rows[0].source_count,1);
  }finally{await pool.end();}
});
