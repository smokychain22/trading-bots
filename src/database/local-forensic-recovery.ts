import { createHash } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import { z } from 'zod';
import { canonicalJson } from '../research/point-in-time-evidence.js';

export const LOCAL_FORENSIC_METHOD_VERSION = 'theta-local-forensic-recovery-v1' as const;
export const localForensicConfirmation = 'AIVEN_LOCAL_FORENSIC_RECOVERY_053' as const;

const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const timestamp = z.string().datetime({ offset: true });
const safeLocator = z.string().min(1).max(1_500).refine((value) =>
  !/(?:password|secret|token|api[_-]?key)\s*[=:]/i.test(value)
  && !/:\/\/[^/\s]+:[^@/\s]+@/.test(value),
{ message:'source locator contains credential material' });

const sourceSchema = z.object({
  sourceId:z.string().uuid(), sourceScope:z.enum([
    'RESEARCH_EXPORT','RESEARCH_OUTPUT','AGENT_WORKSPACE','GIT_UNREACHABLE','CI_ARTIFACT',
    'WORKTREE','EDITOR_HISTORY','SHELL_HISTORY','TEMPORARY_STORAGE','DOWNLOADS','WSL','DOCKER','OTHER',
  ]),
  sourceLocator:safeLocator, contentHash:sha256, byteSize:z.number().int().nonnegative(),
  modifiedAt:timestamp.nullable(), exactMissingKeyMatches:z.number().int().nonnegative(),
  thetaFingerprintMatches:z.number().int().nonnegative(),
  evidenceClass:z.enum(['EXACT_EXPORT','DERIVED_RESEARCH','REFERENCE_ONLY','METADATA_ONLY','UNKNOWN']),
  disposition:z.enum(['IMPORT_PAYLOAD','CATALOG_ONLY','REJECT_SECRET_BEARING','NO_RELEVANT_DATA']),
  metadata:z.record(z.string(),z.unknown()),
}).strict();

const variantSchema = z.object({
  variantId:z.string().uuid(), family:z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,119}$/),
  recordIdentity:z.string().min(1).max(500), payloadHash:sha256, payload:z.unknown(),
  firstDatasetHash:sha256, lastDatasetHash:sha256, firstExportedAt:timestamp, lastExportedAt:timestamp,
  occurrenceCount:z.number().int().positive(), isLatestVariant:z.boolean(),
  variantClass:z.enum(['CONFLICT_CURRENT','CONFLICT_HISTORICAL','OLDER_ONLY']),
  pitEligibility:z.enum(['ELIGIBLE','INELIGIBLE','UNKNOWN']),
}).strict();

const missingSearchSchema = z.object({
  searchId:z.string().uuid(), targetTable:z.string().regex(/^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/),
  missingRecordKey:z.string().min(1).max(500), referenceMatchCount:z.number().int().nonnegative(),
  completeRecordMatchCount:z.number().int().nonnegative(), matchedSourceCount:z.number().int().nonnegative(),
  searchedScopes:z.array(z.string().min(1).max(100)).max(30),
  recoveryState:z.enum(['RECOVERED_EXACT','AMBIGUOUS','REFERENCE_ONLY','NOT_YET_RECOVERED','NOT_A_PARENT_REFERENCE']),
  evidence:z.record(z.string(),z.unknown()),
}).strict();

export const localForensicChunkSchema = z.object({
  schemaVersion:z.literal('theta-local-forensic-chunk-v1'), forensicSweepId:z.string().uuid(),
  generatedAt:timestamp, sourceCodeSha:z.string().regex(/^[0-9a-f]{7,40}$/),
  methodVersion:z.literal(LOCAL_FORENSIC_METHOD_VERSION), rootManifestHash:sha256,
  chunkIndex:z.number().int().nonnegative(), chunkCount:z.number().int().positive(),
  expectedSourceCount:z.number().int().nonnegative(), expectedVariantCount:z.number().int().nonnegative(),
  expectedMissingSearchCount:z.number().int().nonnegative(), summary:z.record(z.string(),z.unknown()),
  sources:z.array(sourceSchema).max(500), variants:z.array(variantSchema).max(500),
  missingSearches:z.array(missingSearchSchema).max(500), chunkHash:sha256,
}).strict();
export type LocalForensicChunk=z.infer<typeof localForensicChunkSchema>;

export function matchesLocalForensicConfirmation(value:string|readonly string[]|undefined):boolean{
  return typeof value==='string'&&value===localForensicConfirmation;
}

export function computeLocalForensicChunkHash(input:Omit<LocalForensicChunk,'chunkHash'>):string{
  return createHash('sha256').update(canonicalJson(input)).digest('hex');
}

export interface LocalForensicImportReceipt{
  readonly state:'IMPORTED'|'PARTIAL';readonly forensicSweepId:string;readonly rootManifestHash:string;
  readonly chunksImported:number;readonly chunkCount:number;readonly sourcesImported:number;
  readonly variantsImported:number;readonly missingSearchesImported:number;
  readonly expectedSourceCount:number;readonly expectedVariantCount:number;readonly expectedMissingSearchCount:number;
  readonly complete:boolean;readonly canonicalRowsChanged:0;readonly executionAuthorized:false;
}

export async function importLocalForensicChunk(connectionString:string,input:unknown):Promise<LocalForensicImportReceipt>{
  const chunk=localForensicChunkSchema.parse(input);
  const {chunkHash,...unsigned}=chunk;
  if(computeLocalForensicChunkHash(unsigned)!==chunkHash)throw codedError('LOCAL_FORENSIC_CHUNK_HASH_MISMATCH');
  const pool=new Pool({connectionString,max:1,connectionTimeoutMillis:8_000,idleTimeoutMillis:1_000,
    application_name:'theta-aiven-local-forensic-import'});
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    try{
      await client.query(`SELECT pg_advisory_xact_lock(hashtext('theta-local-forensic:'||$1))`,[chunk.rootManifestHash]);
      await client.query(`INSERT INTO legacy_neon.local_forensic_sweep(forensic_sweep_id,generated_at,source_code_sha,
        method_version,root_manifest_hash,chunk_count,expected_source_count,expected_variant_count,
        expected_missing_search_count,summary_json) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
        ON CONFLICT(root_manifest_hash) DO NOTHING`,[chunk.forensicSweepId,chunk.generatedAt,chunk.sourceCodeSha,
        chunk.methodVersion,chunk.rootManifestHash,chunk.chunkCount,chunk.expectedSourceCount,chunk.expectedVariantCount,
        chunk.expectedMissingSearchCount,JSON.stringify(chunk.summary)]);
      const sweep=await client.query(`SELECT forensic_sweep_id,chunk_count,expected_source_count,expected_variant_count,
        expected_missing_search_count FROM legacy_neon.local_forensic_sweep WHERE root_manifest_hash=$1`,[chunk.rootManifestHash]);
      if(sweep.rowCount!==1||String(sweep.rows[0].forensic_sweep_id)!==chunk.forensicSweepId
        ||Number(sweep.rows[0].chunk_count)!==chunk.chunkCount
        ||Number(sweep.rows[0].expected_source_count)!==chunk.expectedSourceCount
        ||Number(sweep.rows[0].expected_variant_count)!==chunk.expectedVariantCount
        ||Number(sweep.rows[0].expected_missing_search_count)!==chunk.expectedMissingSearchCount)
        throw codedError('LOCAL_FORENSIC_SWEEP_IDENTITY_MISMATCH');
      await insertSources(client,chunk);await insertVariants(client,chunk);await insertMissingSearches(client,chunk);
      await client.query(`INSERT INTO legacy_neon.local_forensic_import_chunk(forensic_sweep_id,chunk_index,chunk_hash)
        VALUES($1,$2,$3) ON CONFLICT(forensic_sweep_id,chunk_index) DO NOTHING`,
      [chunk.forensicSweepId,chunk.chunkIndex,chunk.chunkHash]);
      const stored=await client.query(`SELECT chunk_hash FROM legacy_neon.local_forensic_import_chunk
        WHERE forensic_sweep_id=$1 AND chunk_index=$2`,[chunk.forensicSweepId,chunk.chunkIndex]);
      if(stored.rowCount!==1||stored.rows[0].chunk_hash!==chunk.chunkHash)
        throw codedError('LOCAL_FORENSIC_CHUNK_REPLAY_CONFLICT');
      await client.query('COMMIT');
    }catch(error){await client.query('ROLLBACK');throw error;}
    return await loadReceipt(client,chunk.rootManifestHash);
  }finally{client.release();await pool.end();}
}

async function insertSources(client:PoolClient,chunk:LocalForensicChunk):Promise<void>{
  if(chunk.sources.length===0)return;
  await client.query(`INSERT INTO legacy_neon.local_forensic_source(source_id,forensic_sweep_id,source_scope,
    source_locator,content_hash,byte_size,modified_at,exact_missing_key_matches,theta_fingerprint_matches,
    evidence_class,disposition,metadata_json)
    SELECT (item->>'sourceId')::uuid,$1,item->>'sourceScope',item->>'sourceLocator',item->>'contentHash',
      (item->>'byteSize')::bigint,NULLIF(item->>'modifiedAt','')::timestamptz,
      (item->>'exactMissingKeyMatches')::integer,(item->>'thetaFingerprintMatches')::integer,
      item->>'evidenceClass',item->>'disposition',item->'metadata'
    FROM jsonb_array_elements($2::jsonb) item ON CONFLICT(source_id) DO NOTHING`,
  [chunk.forensicSweepId,JSON.stringify(chunk.sources)]);
}

async function insertVariants(client:PoolClient,chunk:LocalForensicChunk):Promise<void>{
  if(chunk.variants.length===0)return;
  await client.query(`INSERT INTO legacy_neon.research_export_variant(variant_id,forensic_sweep_id,family,
    record_identity,payload_hash,payload_json,first_dataset_hash,last_dataset_hash,first_exported_at,last_exported_at,
    occurrence_count,is_latest_variant,variant_class,pit_eligibility)
    SELECT (item->>'variantId')::uuid,$1,item->>'family',item->>'recordIdentity',item->>'payloadHash',item->'payload',
      item->>'firstDatasetHash',item->>'lastDatasetHash',(item->>'firstExportedAt')::timestamptz,
      (item->>'lastExportedAt')::timestamptz,(item->>'occurrenceCount')::integer,
      (item->>'isLatestVariant')::boolean,item->>'variantClass',item->>'pitEligibility'
    FROM jsonb_array_elements($2::jsonb) item ON CONFLICT(variant_id) DO NOTHING`,
  [chunk.forensicSweepId,JSON.stringify(chunk.variants)]);
}

async function insertMissingSearches(client:PoolClient,chunk:LocalForensicChunk):Promise<void>{
  if(chunk.missingSearches.length===0)return;
  await client.query(`INSERT INTO legacy_neon.missing_record_forensic_search(search_id,forensic_sweep_id,target_table,
    missing_record_key,reference_match_count,complete_record_match_count,matched_source_count,searched_scopes_json,
    recovery_state,evidence_json)
    SELECT (item->>'searchId')::uuid,$1,item->>'targetTable',item->>'missingRecordKey',
      (item->>'referenceMatchCount')::integer,(item->>'completeRecordMatchCount')::integer,
      (item->>'matchedSourceCount')::integer,item->'searchedScopes',item->>'recoveryState',item->'evidence'
    FROM jsonb_array_elements($2::jsonb) item ON CONFLICT(search_id) DO NOTHING`,
  [chunk.forensicSweepId,JSON.stringify(chunk.missingSearches)]);
}

async function loadReceipt(client:PoolClient,rootManifestHash:string):Promise<LocalForensicImportReceipt>{
  const result=await client.query(`SELECT s.forensic_sweep_id,s.root_manifest_hash,s.chunk_count,
    s.expected_source_count,s.expected_variant_count,s.expected_missing_search_count,
    (SELECT count(*)::integer FROM legacy_neon.local_forensic_import_chunk c WHERE c.forensic_sweep_id=s.forensic_sweep_id) AS chunks_imported,
    (SELECT count(*)::integer FROM legacy_neon.local_forensic_source f WHERE f.forensic_sweep_id=s.forensic_sweep_id) AS sources_imported,
    (SELECT count(*)::integer FROM legacy_neon.research_export_variant v WHERE v.forensic_sweep_id=s.forensic_sweep_id) AS variants_imported,
    (SELECT count(*)::integer FROM legacy_neon.missing_record_forensic_search m WHERE m.forensic_sweep_id=s.forensic_sweep_id) AS searches_imported
    FROM legacy_neon.local_forensic_sweep s WHERE s.root_manifest_hash=$1`,[rootManifestHash]);
  if(result.rowCount!==1)throw codedError('LOCAL_FORENSIC_RECEIPT_NOT_FOUND');
  const row=result.rows[0];
  const complete=Number(row.chunks_imported)===Number(row.chunk_count)
    &&Number(row.sources_imported)===Number(row.expected_source_count)
    &&Number(row.variants_imported)===Number(row.expected_variant_count)
    &&Number(row.searches_imported)===Number(row.expected_missing_search_count);
  return{state:complete?'IMPORTED':'PARTIAL',forensicSweepId:String(row.forensic_sweep_id),
    rootManifestHash:String(row.root_manifest_hash),chunksImported:Number(row.chunks_imported),chunkCount:Number(row.chunk_count),
    sourcesImported:Number(row.sources_imported),variantsImported:Number(row.variants_imported),
    missingSearchesImported:Number(row.searches_imported),expectedSourceCount:Number(row.expected_source_count),
    expectedVariantCount:Number(row.expected_variant_count),expectedMissingSearchCount:Number(row.expected_missing_search_count),
    complete,canonicalRowsChanged:0,executionAuthorized:false};
}

function codedError(code:string):Error&{code:string}{return Object.assign(new Error(code),{code});}
