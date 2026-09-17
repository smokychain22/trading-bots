import { createHash } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import { z } from 'zod';
import { canonicalJson } from '../research/point-in-time-evidence.js';

export const LEGACY_RECONSTRUCTION_METHOD_VERSION = 'theta-legacy-reconstruction-v1';
export const legacyReconstructionConfirmation = 'AIVEN_LEGACY_RECONSTRUCT_052' as const;

const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const timestamp = z.string().datetime({ offset: true });
const safeLocator = z.string().min(1).max(1_000).refine((value) =>
  !/(?:password|secret|token|api[_-]?key)\s*[=:]/i.test(value) && !/:\/\/[^/\s]+:[^@/\s]+@/.test(value),
{ message:'source locator contains credential material' });

const sourceSchema = z.object({
  reconstructionSourceId:z.string().uuid(),
  sourceType:z.enum(['LOCAL_EXPORT','RESEARCH_OUTPUT','WORKER_STATE','OPERATOR_RECEIPT','CI_ARTIFACT',
    'VERCEL_RUNTIME','GITHUB_DETERMINISTIC','ALPACA_DERIVED','OPTIONOMICS_DERIVED','AGENT_WORKSPACE','OTHER']),
  sourceSystem:z.string().min(1).max(120), sourceLocator:safeLocator,
  sourceProject:z.string().max(240).nullable(), sourceBranch:z.string().max(240).nullable(),
  sourceSha:z.string().max(80).nullable(), sourceTimestamp:timestamp.nullable(), contentHash:sha256,
  reconstructionMethod:z.string().min(1).max(200), confidenceClass:z.enum(['A','B','C','D','E']),
  pitEligibility:z.enum(['ELIGIBLE','INELIGIBLE','UNKNOWN']),
  evidenceClass:z.enum(['REAL_PRODUCTION_EVIDENCE','REAL_PROVIDER_EVIDENCE','DERIVED_RESEARCH','SIMULATION',
    'SYNTHETIC','TEST','METADATA_ONLY','UNKNOWN']),
  recordCount:z.number().int().nonnegative(), metadata:z.record(z.string(),z.unknown()),
}).strict();

const familySchema = z.object({
  familyRecoveryAssessmentId:z.string().uuid(), targetRelation:z.string().regex(/^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/),
  purpose:z.string().max(1_000), writerModules:z.array(z.string().max(500)).max(100),
  sourceOrigins:z.array(z.string().max(100)).max(30), primaryKeyColumns:z.array(z.string().max(100)).max(20),
  foreignKeyParents:z.array(z.string().max(300)).max(100), timestampSemantics:z.string().max(1_000),
  pitRequirements:z.string().max(1_000), reconstructability:z.enum([
    'FULLY_RECOVERED','PARTIALLY_RECOVERED','RECONSTRUCTED_CURRENT_STATE','RECONSTRUCTED_SCHEMA_ONLY',
    'EMPTY_BY_DESIGN','NEON_ONLY_UNRECOVERABLE_CURRENTLY','UNKNOWN']),
  exactOriginalRows:z.number().int().nonnegative(), authoritativeRows:z.number().int().nonnegative(),
  deterministicRows:z.number().int().nonnegative(), partialRows:z.number().int().nonnegative(),
  missingParentCount:z.number().int().nonnegative(), usefulForResearch:z.boolean(), usefulForRuntime:z.boolean(),
  blocking:z.boolean(), evidence:z.record(z.string(),z.unknown()), assessmentHash:sha256,
}).strict();

export const legacyReconstructionManifestSchema = z.object({
  schemaVersion:z.literal('theta-legacy-reconstruction-manifest-v1'), reconstructionSweepId:z.string().uuid(),
  generatedAt:timestamp, sourceCodeSha:z.string().regex(/^[0-9a-f]{7,40}$/),
  methodVersion:z.literal(LEGACY_RECONSTRUCTION_METHOD_VERSION), sources:z.array(sourceSchema).max(300),
  families:z.array(familySchema).max(250), summary:z.record(z.string(),z.unknown()), manifestHash:sha256,
}).strict();
export type LegacyReconstructionManifest=z.infer<typeof legacyReconstructionManifestSchema>;

export function matchesLegacyReconstructionConfirmation(value:string|readonly string[]|undefined):boolean{
  return typeof value==='string'&&value===legacyReconstructionConfirmation;
}

export function computeLegacyReconstructionManifestHash(input:Omit<LegacyReconstructionManifest,'manifestHash'>):string{
  return createHash('sha256').update(canonicalJson(input)).digest('hex');
}

export interface LegacyReconstructionImportReceipt{
  readonly state:'IMPORTED';readonly reconstructionSweepId:string;readonly manifestHash:string;
  readonly sourceCount:number;readonly familyCount:number;readonly currentAivenRowCount:number;
  readonly statusCounts:Readonly<Record<string,number>>;readonly canonicalRowsChanged:0;
  readonly executionAuthorized:false;
}

export async function importLegacyReconstructionManifest(connectionString:string,input:unknown):Promise<LegacyReconstructionImportReceipt>{
  const manifest=legacyReconstructionManifestSchema.parse(input);
  const {manifestHash,...unsigned}=manifest;
  if(computeLegacyReconstructionManifestHash(unsigned)!==manifestHash)throw codedError('LEGACY_RECONSTRUCTION_MANIFEST_HASH_MISMATCH');
  if(manifest.sources.length!==new Set(manifest.sources.map((source)=>source.reconstructionSourceId)).size)
    throw codedError('LEGACY_RECONSTRUCTION_DUPLICATE_SOURCE_ID');
  if(manifest.families.length!==new Set(manifest.families.map((family)=>family.targetRelation)).size)
    throw codedError('LEGACY_RECONSTRUCTION_DUPLICATE_TARGET_RELATION');
  const pool=new Pool({connectionString,max:1,connectionTimeoutMillis:8_000,idleTimeoutMillis:1_000,
    application_name:'theta-aiven-legacy-reconstruction-import'});
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    try{
      await client.query(`SELECT pg_advisory_xact_lock(hashtext('theta-legacy-reconstruction:'||$1))`,[manifestHash]);
      const existing=await client.query(`SELECT reconstruction_sweep_id FROM legacy_neon.reconstruction_sweep
        WHERE manifest_hash=$1`,[manifestHash]);
      if(existing.rowCount===0){
        await client.query(`INSERT INTO legacy_neon.reconstruction_sweep(reconstruction_sweep_id,generated_at,
          source_code_sha,method_version,manifest_hash,source_count,family_count,summary_json)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,[manifest.reconstructionSweepId,manifest.generatedAt,
          manifest.sourceCodeSha,manifest.methodVersion,manifestHash,manifest.sources.length,manifest.families.length,
          JSON.stringify(manifest.summary)]);
        await insertSources(client,manifest);
        await insertFamilies(client,manifest);
      }
      await client.query('COMMIT');
    }catch(error){await client.query('ROLLBACK');throw error;}
    return loadReceipt(client,manifestHash);
  }finally{client.release();await pool.end();}
}

async function insertSources(client:PoolClient,manifest:LegacyReconstructionManifest):Promise<void>{
  for(let index=0;index<manifest.sources.length;index+=100){
    await client.query(`INSERT INTO legacy_neon.reconstruction_source(reconstruction_source_id,reconstruction_sweep_id,
      source_type,source_system,source_locator,source_project,source_branch,source_sha,source_timestamp,content_hash,
      reconstruction_method,confidence_class,pit_eligibility,evidence_class,record_count,metadata_json)
      SELECT (item->>'reconstructionSourceId')::uuid,$1,item->>'sourceType',item->>'sourceSystem',item->>'sourceLocator',
        NULLIF(item->>'sourceProject',''),NULLIF(item->>'sourceBranch',''),NULLIF(item->>'sourceSha',''),
        NULLIF(item->>'sourceTimestamp','')::timestamptz,item->>'contentHash',item->>'reconstructionMethod',
        item->>'confidenceClass',item->>'pitEligibility',item->>'evidenceClass',(item->>'recordCount')::bigint,
        item->'metadata'
      FROM jsonb_array_elements($2::jsonb) item`,[manifest.reconstructionSweepId,
      JSON.stringify(manifest.sources.slice(index,index+100))]);
  }
}

async function insertFamilies(client:PoolClient,manifest:LegacyReconstructionManifest):Promise<void>{
  for(const family of manifest.families){
    const relation=await client.query(`SELECT table_schema,table_name FROM information_schema.tables
      WHERE table_type='BASE TABLE' AND table_schema||'.'||table_name=$1`,[family.targetRelation]);
    if(relation.rowCount!==1)throw codedError('LEGACY_RECONSTRUCTION_UNKNOWN_TARGET_RELATION');
    const [schema,table]=family.targetRelation.split('.');
    if(schema===undefined||table===undefined)throw codedError('LEGACY_RECONSTRUCTION_INVALID_TARGET_RELATION');
    const current=await client.query(`SELECT count(*)::bigint AS count FROM "${schema}"."${table}"`);
    await client.query(`INSERT INTO legacy_neon.family_recovery_assessment(family_recovery_assessment_id,
      reconstruction_sweep_id,target_relation,purpose,writer_modules_json,source_origins_json,primary_key_columns_json,
      foreign_key_parents_json,timestamp_semantics,pit_requirements,reconstructability,exact_original_rows,
      authoritative_rows,deterministic_rows,partial_rows,current_aiven_rows,missing_parent_count,useful_for_research,
      useful_for_runtime,blocking,evidence_json,assessment_hash)
      VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8::jsonb,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21::jsonb,$22)`,
    [family.familyRecoveryAssessmentId,manifest.reconstructionSweepId,family.targetRelation,family.purpose,
      JSON.stringify(family.writerModules),JSON.stringify(family.sourceOrigins),JSON.stringify(family.primaryKeyColumns),
      JSON.stringify(family.foreignKeyParents),family.timestampSemantics,family.pitRequirements,family.reconstructability,
      family.exactOriginalRows,family.authoritativeRows,family.deterministicRows,family.partialRows,
      Number(current.rows[0]?.count??0),family.missingParentCount,family.usefulForResearch,family.usefulForRuntime,
      family.blocking,JSON.stringify(family.evidence),family.assessmentHash]);
  }
}

async function loadReceipt(client:PoolClient,manifestHash:string):Promise<LegacyReconstructionImportReceipt>{
  const result=await client.query(`SELECT rs.reconstruction_sweep_id,rs.source_count,rs.family_count,
    COALESCE(sum(fra.current_aiven_rows),0)::bigint AS current_rows
    FROM legacy_neon.reconstruction_sweep rs LEFT JOIN legacy_neon.family_recovery_assessment fra USING(reconstruction_sweep_id)
    WHERE rs.manifest_hash=$1 GROUP BY rs.reconstruction_sweep_id,rs.source_count,rs.family_count`,[manifestHash]);
  if(result.rowCount!==1)throw codedError('LEGACY_RECONSTRUCTION_RECEIPT_NOT_FOUND');
  const statuses=await client.query(`SELECT fra.reconstructability,count(*)::integer AS count
    FROM legacy_neon.family_recovery_assessment fra JOIN legacy_neon.reconstruction_sweep rs USING(reconstruction_sweep_id)
    WHERE rs.manifest_hash=$1 GROUP BY fra.reconstructability ORDER BY fra.reconstructability`,[manifestHash]);
  return{state:'IMPORTED',reconstructionSweepId:String(result.rows[0].reconstruction_sweep_id),manifestHash,
    sourceCount:Number(result.rows[0].source_count),familyCount:Number(result.rows[0].family_count),
    currentAivenRowCount:Number(result.rows[0].current_rows),
    statusCounts:Object.fromEntries(statuses.rows.map((row)=>[String(row.reconstructability),Number(row.count)])),
    canonicalRowsChanged:0,executionAuthorized:false};
}

function codedError(code:string):Error&{code:string}{return Object.assign(new Error(code),{code});}
