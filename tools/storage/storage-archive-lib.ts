// Archive-before-purge library (Phase 4 storage decision). Pure/local-file logic only: no database access, and NO delete capability of any kind.
// A population is archived as gzip NDJSON chunks (one lossless `to_jsonb(row)` text per line) plus a manifest that records row counts, key and time
// ranges, per-chunk and whole-population digests and the source identity. Purge eligibility is a pure function over verified evidence.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';

export const archiveManifestVersion = 'theta-storage-archive-manifest-v1' as const;
export const sha256 = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex');

export type StorageTier = 'TIER_A_OPERATIONAL_IMMUTABLE' | 'TIER_B_CURRENT_RUNTIME_EVIDENCE' | 'TIER_C_RESEARCH_ARCHIVABLE' | 'TIER_D_REGENERABLE_OR_REDUNDANT';

export interface ArchivePopulation {
  readonly id: string;
  readonly tier: 'TIER_C_RESEARCH_ARCHIVABLE' | 'TIER_D_REGENERABLE_OR_REDUNDANT';
  readonly schema: string;
  readonly table: string;
  readonly keyColumn: string;
  readonly timeColumn: string;
  /** SQL predicate over alias `t`; `$1` is the cutoff timestamptz. Must select ONLY rows older than the hot window. */
  readonly where: string;
  /** What a purge of this population would do: rows are immutable truth tables, so most populations replace a payload rather than delete a row. */
  readonly purgeAction: 'DELETE_ROWS' | 'REPLACE_PAYLOAD_WITH_ARCHIVE_POINTER';
  readonly payloadColumns: readonly string[];
  readonly pageRows: number;
  readonly rationale: string;
}

export interface ArchiveChunk {
  readonly file: string;
  readonly rows: number;
  readonly firstKey: string;
  readonly lastKey: string;
  readonly minTime: string;
  readonly maxTime: string;
  readonly uncompressedBytes: number;
  readonly fileBytes: number;
  readonly fileSha256: string;
  readonly contentSha256: string;
}

export interface ArchiveManifest {
  readonly manifestVersion: typeof archiveManifestVersion;
  readonly populationId: string;
  readonly table: string;
  readonly cutoff: string;
  readonly createdAt: string;
  readonly source: { readonly databaseIdentityHash: string; readonly releaseSha: string };
  readonly chunks: readonly ArchiveChunk[];
  readonly rows: number;
  readonly uncompressedBytes: number;
  readonly fileBytes: number;
  readonly populationDigest: string;
  readonly completed: boolean;
}

export interface ArchiveRowInput { readonly key: string; readonly time: string; readonly json: string }

export function populationDigest(chunks: readonly ArchiveChunk[]): string {
  return sha256(chunks.map((chunk) => `${chunk.file}:${chunk.rows}:${chunk.contentSha256}`).join('\n'));
}

/** Accumulates rows and flushes content-addressed gzip chunks. Chunk boundaries never split a row. */
export class ArchiveChunkWriter {
  private lines: string[] = [];
  private bytes = 0;
  private firstKey = '';
  private lastKey = '';
  private minTime = '';
  private maxTime = '';
  readonly chunks: ArchiveChunk[];

  constructor(private readonly directory: string, private readonly populationId: string, private readonly maxChunkBytes = 64 * 1024 * 1024, existing: readonly ArchiveChunk[] = []) {
    mkdirSync(directory, { recursive: true });
    this.chunks = [...existing];
  }

  add(row: ArchiveRowInput): void {
    if (row.json.includes('\n')) throw new Error('ARCHIVE_ROW_CONTAINS_NEWLINE');
    if (this.lines.length === 0) { this.firstKey = row.key; this.minTime = row.time; this.maxTime = row.time; }
    this.lines.push(row.json);
    this.bytes += Buffer.byteLength(row.json) + 1;
    this.lastKey = row.key;
    if (row.time < this.minTime) this.minTime = row.time;
    if (row.time > this.maxTime) this.maxTime = row.time;
    if (this.bytes >= this.maxChunkBytes) this.flush();
  }

  flush(): ArchiveChunk | null {
    if (this.lines.length === 0) return null;
    const content = Buffer.from(`${this.lines.join('\n')}\n`, 'utf8');
    const compressed = gzipSync(content, { level: 6 });
    const file = `${this.populationId}-${String(this.chunks.length + 1).padStart(5, '0')}.ndjson.gz`;
    const target = join(this.directory, file);
    writeFileSync(`${target}.partial`, compressed);
    renameSync(`${target}.partial`, target);
    const chunk: ArchiveChunk = { file, rows: this.lines.length, firstKey: this.firstKey, lastKey: this.lastKey, minTime: this.minTime, maxTime: this.maxTime,
      uncompressedBytes: content.length, fileBytes: compressed.length, fileSha256: sha256(compressed), contentSha256: sha256(content) };
    this.chunks.push(chunk);
    this.lines = []; this.bytes = 0;
    return chunk;
  }
}

export function buildManifest(input: { populationId: string; table: string; cutoff: string; createdAt: string; source: ArchiveManifest['source']; chunks: readonly ArchiveChunk[]; completed: boolean }): ArchiveManifest {
  return {
    manifestVersion: archiveManifestVersion, populationId: input.populationId, table: input.table, cutoff: input.cutoff, createdAt: input.createdAt, source: input.source,
    chunks: input.chunks, rows: input.chunks.reduce((sum, chunk) => sum + chunk.rows, 0),
    uncompressedBytes: input.chunks.reduce((sum, chunk) => sum + chunk.uncompressedBytes, 0), fileBytes: input.chunks.reduce((sum, chunk) => sum + chunk.fileBytes, 0),
    populationDigest: populationDigest(input.chunks), completed: input.completed,
  };
}

export function writeManifest(directory: string, manifest: ArchiveManifest): string {
  const path = join(directory, 'manifest.json');
  writeFileSync(`${path}.partial`, `${JSON.stringify(manifest, null, 2)}\n`);
  renameSync(`${path}.partial`, path);
  return path;
}

export interface ArchiveVerification {
  readonly ok: boolean;
  readonly rows: number;
  readonly problems: readonly string[];
}

/** Re-reads every chunk from disk: file digest, content digest, row count, key order and boundaries, and the population digest. */
export function verifyArchiveOnDisk(directory: string, manifest: ArchiveManifest): ArchiveVerification {
  const problems: string[] = [];
  let rows = 0;
  if (manifest.manifestVersion !== archiveManifestVersion) problems.push('MANIFEST_VERSION');
  if (manifest.populationDigest !== populationDigest(manifest.chunks)) problems.push('POPULATION_DIGEST_MISMATCH');
  for (const chunk of manifest.chunks) {
    const path = join(directory, chunk.file);
    if (!existsSync(path)) { problems.push(`CHUNK_MISSING:${chunk.file}`); continue; }
    const compressed = readFileSync(path);
    if (sha256(compressed) !== chunk.fileSha256) { problems.push(`FILE_DIGEST:${chunk.file}`); continue; }
    let content: Buffer;
    try { content = gunzipSync(compressed); } catch { problems.push(`GUNZIP:${chunk.file}`); continue; }
    if (sha256(content) !== chunk.contentSha256) { problems.push(`CONTENT_DIGEST:${chunk.file}`); continue; }
    const lines = content.toString('utf8').split('\n').filter((line) => line.length > 0);
    if (lines.length !== chunk.rows) problems.push(`ROW_COUNT:${chunk.file}:${lines.length}/${chunk.rows}`);
    for (const line of lines) { try { JSON.parse(line); } catch { problems.push(`ROW_NOT_JSON:${chunk.file}`); break; } }
    rows += lines.length;
  }
  if (rows !== manifest.rows) problems.push(`TOTAL_ROWS:${rows}/${manifest.rows}`);
  return { ok: problems.length === 0, rows, problems };
}

export function* readArchiveRows(directory: string, manifest: ArchiveManifest): Generator<string> {
  for (const chunk of manifest.chunks) {
    for (const line of gunzipSync(readFileSync(join(directory, chunk.file))).toString('utf8').split('\n')) if (line.length > 0) yield line;
  }
}

// ---- purge eligibility -------------------------------------------------------------------------------------------------------------------------

/** Operational truth is NEVER purge-eligible, whatever evidence exists. Matched on the qualified relation name. */
const OPERATIONAL_PATTERNS: readonly RegExp[] = [
  /^trade\.(order_intent|broker_order|fill|execution_attempt|master_paper_action_plan|master_paper_action_plan_event|stock_lot|wheel_chain|position|position_lot|lifecycle|cash_ledger|broker_activity_fact|broker_reconciliation_snapshot)/,
  /^trade\.(order|execution|broker|fill|position|lot|chain|lifecycle|ledger|inventory|whole_chain|management|assignment|roll)/,
  /^(ops|risk|core|copy|customer)\./,
];
export const isOperationalRelation = (schema: string, table: string): boolean => OPERATIONAL_PATTERNS.some((pattern) => pattern.test(`${schema}.${table}`));

export interface PurgeEligibilityEvidence {
  readonly population: Pick<ArchivePopulation, 'id' | 'schema' | 'table'>;
  readonly manifest: ArchiveManifest | null;
  readonly diskVerification: ArchiveVerification | null;
  readonly productionRowCount: number | null;
  /** fraction of sampled archived rows whose sha256 equals the freshly re-read Production row; null when no sample was taken */
  readonly sampleRestore: { readonly sampled: number; readonly matched: number } | null;
  readonly replayVerified: boolean | 'NOT_APPLICABLE';
  /** the archive reproduces the same per-day research aggregates as Production */
  readonly aggregateEqual: boolean;
  readonly archiveLocationOutsideDatabase: boolean;
  readonly hotWindowRespected: boolean;
}

export interface PurgeEligibility { readonly eligible: boolean; readonly blockers: readonly string[] }

export function evaluatePurgeEligibility(evidence: PurgeEligibilityEvidence): PurgeEligibility {
  const blockers: string[] = [];
  if (isOperationalRelation(evidence.population.schema, evidence.population.table)) blockers.push('OPERATIONAL_TRUTH_NEVER_PURGEABLE');
  if (evidence.manifest === null) blockers.push('NO_ARCHIVE_MANIFEST');
  else {
    if (!evidence.manifest.completed) blockers.push('ARCHIVE_NOT_COMPLETE');
    if (evidence.manifest.source.releaseSha.length !== 40) blockers.push('NO_SOURCE_RELEASE_IDENTITY');
    if (evidence.productionRowCount === null || evidence.manifest.rows !== evidence.productionRowCount) blockers.push('ROW_COUNT_PROOF_MISSING_OR_DIFFERENT');
  }
  if (evidence.diskVerification === null || !evidence.diskVerification.ok) blockers.push('ARCHIVE_NOT_VERIFIED_ON_DISK');
  if (evidence.sampleRestore === null || evidence.sampleRestore.sampled === 0 || evidence.sampleRestore.matched !== evidence.sampleRestore.sampled) blockers.push('RESTORE_SAMPLE_NOT_PROVEN');
  if (evidence.replayVerified === false) blockers.push('REPLAY_NOT_VERIFIED');
  if (!evidence.aggregateEqual) blockers.push('RESEARCH_AGGREGATE_NOT_EQUAL');
  if (!evidence.archiveLocationOutsideDatabase) blockers.push('ARCHIVE_LOCATION_NOT_OUTSIDE_DATABASE');
  if (!evidence.hotWindowRespected) blockers.push('HOT_WINDOW_NOT_RESPECTED');
  return { eligible: blockers.length === 0, blockers };
}

export function isOutsideDatabaseArchiveRoot(path: string, root: string): boolean {
  const resolved = resolve(path);
  const base = resolve(root);
  return resolved === base || resolved.startsWith(base + sep);
}

export function ensureParent(path: string): void { mkdirSync(dirname(path), { recursive: true }); }
