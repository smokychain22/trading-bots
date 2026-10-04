// HOT BYTES PER DECISION, read back from PostgreSQL: the stored (compressed / TOAST) size of every column of every decision-keyed hot table, plus 28 bytes of tuple overhead per row.
// Index bytes are the average index bytes per heap row of each relation times the rows the decision owns. Used by the writer measurement tool and by the production SLO task, so the
// number the acceptance report quotes and the number the platform alarms on are the same measurement. Relations that do not exist yet (pre-cutover) contribute zero.
import type { Pool } from 'pg';

export type Bucket = 'BLOB' | 'DECISION_CONTEXT' | 'CANDIDATE' | 'AUDIT_AND_FRONTIER' | 'FUSION_PROJECTION' | 'RAW_AND_RESEARCH';
export interface HotSpec { readonly relation: string; readonly where: string; readonly bucket: Bucket; readonly blobColumns?: readonly string[] }

export const HOT_SPECS: readonly HotSpec[] = [
  { relation: 'trade.fusion_snapshot', where: 'fusion_snapshot_id = $1', bucket: 'FUSION_PROJECTION', blobColumns: ['evidence_archive_gzip'] },
  { relation: 'dp.cycle_evidence_blob', where: 'fusion_snapshot_id = $1', bucket: 'BLOB', blobColumns: ['blob'] },
  { relation: 'dp.decision_context', where: 'fusion_snapshot_id = $1', bucket: 'DECISION_CONTEXT' },
  { relation: 'dp.pit_candidate', where: 'fusion_snapshot_id = $1', bucket: 'CANDIDATE' },
  { relation: 'dp.rejection_histogram', where: 'decision_id = $2', bucket: 'AUDIT_AND_FRONTIER' },
  { relation: 'trade.candidate_point_in_time_evidence', where: 'fusion_snapshot_id = $1', bucket: 'CANDIDATE' },
  { relation: 'trade.candidate', where: 'candidate_set_id = $3', bucket: 'CANDIDATE' },
  { relation: 'trade.candidate_reason', where: 'candidate_id IN (SELECT candidate_id FROM trade.candidate WHERE candidate_set_id = $3)', bucket: 'CANDIDATE' },
  { relation: 'trade.canonical_strategy_frontier', where: 'fusion_snapshot_id = $1', bucket: 'AUDIT_AND_FRONTIER' },
  { relation: 'trade.canonical_strategy_branch_evidence', where: 'fusion_snapshot_id = $1', bucket: 'AUDIT_AND_FRONTIER' },
  { relation: 'trade.canonical_strategy_candidate_evidence', where: 'branch_evidence_id IN (SELECT branch_evidence_id FROM trade.canonical_strategy_branch_evidence WHERE fusion_snapshot_id = $1)', bucket: 'RAW_AND_RESEARCH' },
  { relation: 'trade.candidate_set', where: 'fusion_snapshot_id = $1', bucket: 'AUDIT_AND_FRONTIER' },
  { relation: 'trade.candidate_set_evidence', where: 'candidate_set_id = $3', bucket: 'AUDIT_AND_FRONTIER' },
  { relation: 'trade.decision', where: 'fusion_snapshot_id = $1', bucket: 'AUDIT_AND_FRONTIER' },
  { relation: 'trade.strategy_route', where: 'fusion_snapshot_id = $1', bucket: 'AUDIT_AND_FRONTIER' },
  { relation: 'trade.global_wait_evidence', where: 'decision_id = $2', bucket: 'AUDIT_AND_FRONTIER' },
  { relation: 'trade.shadow_opportunity', where: 'fusion_snapshot_id = $1', bucket: 'RAW_AND_RESEARCH' },
  { relation: 'market.optionomics_raw_observation', where: 'fusion_snapshot_id = $1', bucket: 'RAW_AND_RESEARCH' },
  { relation: 'market.optionomics_feature_snapshot', where: 'fusion_snapshot_id = $1', bucket: 'RAW_AND_RESEARCH' },
  { relation: 'research.theta_option_chain_decision_evidence', where: 'fusion_snapshot_id = $1', bucket: 'RAW_AND_RESEARCH' },
];
export const HOT_RELATIONS = HOT_SPECS.map((spec) => spec.relation);

export interface DecisionIds { readonly fusion: string; readonly decision: string | null; readonly candidateSet: string | null }
export interface DecisionBytes { readonly buckets: Record<Bucket, number>; readonly rows: Record<string, number>; readonly candidateRows: number; /** stored bytes (columns plus tuple overhead) per relation */ readonly relationBytes: Record<string, number> }

const columnCache = new WeakMap<Pool, Map<string, string[] | null>>();
async function columnsOf(pool: Pool, relation: string): Promise<string[] | null> {
  let cache = columnCache.get(pool); if (cache === undefined) { cache = new Map(); columnCache.set(pool, cache); }
  const cached = cache.get(relation); if (cached !== undefined) return cached;
  const present = (await pool.query('SELECT to_regclass($1) IS NOT NULL AS ok', [relation])).rows[0].ok as boolean;
  if (!present) { cache.set(relation, null); return null; }
  const result = await pool.query('SELECT attname FROM pg_attribute WHERE attrelid = $1::regclass AND attnum > 0 AND NOT attisdropped ORDER BY attnum', [relation]);
  const columns = result.rows.map((row) => row.attname as string); cache.set(relation, columns); return columns;
}

export async function decisionBytes(pool: Pool, ids: DecisionIds): Promise<DecisionBytes> {
  const buckets: Record<Bucket, number> = { BLOB: 0, DECISION_CONTEXT: 0, CANDIDATE: 0, AUDIT_AND_FRONTIER: 0, FUSION_PROJECTION: 0, RAW_AND_RESEARCH: 0 };
  const rows: Record<string, number> = {}; const relationBytes: Record<string, number> = {}; let candidateRows = 0;
  for (const spec of HOT_SPECS) {
    const columns = await columnsOf(pool, spec.relation);
    if (columns === null) continue;
    const blob = spec.blobColumns ?? [];
    const sizeOf = (list: readonly string[]): string => (list.length === 0 ? '0' : list.map((column) => `coalesce(pg_column_size(t.${column}), 0)`).join(' + '));
    const rest = columns.filter((column) => !blob.includes(column));
    const parameter = Number(/\$(\d)/.exec(spec.where)?.[1] ?? '1');
    const value = [ids.fusion, ids.decision, ids.candidateSet][parameter - 1];
    if (value === null) continue;
    const where = spec.where.replaceAll(`$${parameter}`, '$1');
    const sql = `SELECT count(*)::int AS n, coalesce(sum(${sizeOf(rest)}), 0)::bigint AS rest_bytes, coalesce(sum(${sizeOf(blob)}), 0)::bigint AS blob_bytes FROM ${spec.relation} t WHERE ${where}`;
    const result = (await pool.query(sql, [value])).rows[0] as { n: number; rest_bytes: string; blob_bytes: string };
    const n = Number(result.n);
    buckets[spec.bucket] += Number(result.rest_bytes) + n * 28; buckets.BLOB += Number(result.blob_bytes);
    rows[spec.relation] = n; relationBytes[spec.relation] = Number(result.rest_bytes) + Number(result.blob_bytes) + n * 28;
    if (spec.relation === 'dp.pit_candidate' || spec.relation === 'trade.candidate_point_in_time_evidence') candidateRows += n;
  }
  return { buckets, rows, candidateRows, relationBytes };
}

/** average index bytes per heap row of each relation over its whole content; partitions are summed under their parent */
export async function indexBytesPerRow(pool: Pool): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const relation of HOT_RELATIONS) {
    try {
      if ((await columnsOf(pool, relation)) === null) { out[relation] = 0; continue; }
      const parts = (await pool.query(`SELECT c.oid::regclass::text AS part FROM pg_class c WHERE c.relkind = 'r' AND (c.oid = $1::regclass OR c.oid IN (SELECT inhrelid FROM pg_inherits WHERE inhparent = $1::regclass))`, [relation])).rows.map((row) => row.part as string);
      let rows = 0; let bytes = 0;
      for (const part of parts) { rows += Number((await pool.query(`SELECT count(*)::bigint AS n FROM ${part}`)).rows[0].n); bytes += Number((await pool.query('SELECT pg_indexes_size($1::regclass)::bigint AS n', [part])).rows[0].n); }
      out[relation] = rows === 0 ? 0 : bytes / rows;
    } catch { out[relation] = 0; }
  }
  return out;
}

export const indexBytesFor = (rows: Readonly<Record<string, number>>, perRow: Readonly<Record<string, number>>): number => Object.entries(rows).reduce((sum, [relation, n]) => sum + n * (perRow[relation] ?? 0), 0);
export const totalBytes = (measured: DecisionBytes, perRow: Readonly<Record<string, number>>): number => Object.values(measured.buckets).reduce((a, b) => a + b, 0) + indexBytesFor(measured.rows, perRow);

export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)] ?? 0;
}

/** hot bytes of the most recent `limit` decisions (the production SLO sample) */
export async function recentDecisionHotBytes(pool: Pool, limit = 60): Promise<{ readonly decisions: number; readonly p50: number; readonly p95: number; readonly max: number; readonly withoutBlobP95: number }> {
  const recent = (await pool.query(`SELECT d.fusion_snapshot_id::text AS fusion, d.decision_id::text AS decision, d.candidate_set_id::text AS candidate_set FROM trade.decision d JOIN trade.fusion_snapshot s ON s.fusion_snapshot_id = d.fusion_snapshot_id ORDER BY s.decision_time DESC LIMIT $1`, [limit])).rows as Array<{ fusion: string; decision: string; candidate_set: string | null }>;
  const perRow = await indexBytesPerRow(pool);
  const totals: number[] = []; const noBlob: number[] = [];
  for (const row of recent) {
    const measured = await decisionBytes(pool, { fusion: row.fusion, decision: row.decision, candidateSet: row.candidate_set });
    const total = totalBytes(measured, perRow); totals.push(total); noBlob.push(total - measured.buckets.BLOB);
  }
  return { decisions: totals.length, p50: percentile(totals, 0.5), p95: percentile(totals, 0.95), max: totals.length === 0 ? 0 : Math.max(...totals), withoutBlobP95: percentile(noBlob, 0.95) };
}
