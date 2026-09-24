import { classifyPostgresRelation, type RelationClassification } from './storage-authority-registry.js';

export interface PostgresRelationStatRow {
  readonly schema_name: string;
  readonly relation_name: string;
  readonly table_data_bytes: string | number;
  readonly index_bytes: string | number;
  readonly toast_bytes: string | number;
  readonly total_relation_bytes: string | number;
  readonly row_count_estimate: string | number;
  readonly live_tuple_estimate: string | number;
  readonly dead_tuple_estimate: string | number;
  readonly inserted_since_stats_reset: string | number;
  readonly updated_since_stats_reset: string | number;
  readonly deleted_since_stats_reset: string | number;
  readonly last_vacuum: string | Date | null;
  readonly last_autovacuum: string | Date | null;
  readonly last_analyze: string | Date | null;
  readonly last_autoanalyze: string | Date | null;
}

export interface AuditedRelation {
  readonly schema: string;
  readonly relation: string;
  readonly qualifiedName: string;
  readonly tableDataBytes: number;
  readonly indexBytes: number;
  readonly toastBytes: number;
  readonly totalRelationBytes: number;
  readonly percentOfDatabase: number | null;
  readonly rowCountEstimate: number;
  readonly liveTupleEstimate: number;
  readonly deadTupleEstimate: number;
  readonly deadTupleRatio: number | null;
  readonly indexToTableRatio: number | null;
  readonly insertedSinceStatsReset: number;
  readonly updatedSinceStatsReset: number;
  readonly deletedSinceStatsReset: number;
  readonly lastVacuum: string | null;
  readonly lastAutovacuum: string | null;
  readonly lastAnalyze: string | null;
  readonly lastAutoanalyze: string | null;
  readonly classification: RelationClassification;
  readonly classificationRationale: string;
}

const finiteNonnegative = (value: string | number, name: string): number => {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`INVALID_POSTGRES_STAT:${name}`);
  return parsed;
};

const timestamp = (value: string | Date | null): string | null => {
  if (value === null) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
};

export function normalizeRelationStat(row: PostgresRelationStatRow): AuditedRelation {
  const tableDataBytes = finiteNonnegative(row.table_data_bytes, 'table_data_bytes');
  const indexBytes = finiteNonnegative(row.index_bytes, 'index_bytes');
  const liveTupleEstimate = finiteNonnegative(row.live_tuple_estimate, 'live_tuple_estimate');
  const deadTupleEstimate = finiteNonnegative(row.dead_tuple_estimate, 'dead_tuple_estimate');
  const classified = classifyPostgresRelation(row.schema_name, row.relation_name);
  return {
    schema: row.schema_name, relation: row.relation_name,
    qualifiedName: `${row.schema_name}.${row.relation_name}`,
    tableDataBytes, indexBytes,
    toastBytes: finiteNonnegative(row.toast_bytes, 'toast_bytes'),
    totalRelationBytes: finiteNonnegative(row.total_relation_bytes, 'total_relation_bytes'),
    percentOfDatabase: null,
    rowCountEstimate: finiteNonnegative(row.row_count_estimate, 'row_count_estimate'),
    liveTupleEstimate, deadTupleEstimate,
    deadTupleRatio: liveTupleEstimate + deadTupleEstimate === 0 ? null : deadTupleEstimate / (liveTupleEstimate + deadTupleEstimate),
    indexToTableRatio: tableDataBytes === 0 ? null : indexBytes / tableDataBytes,
    insertedSinceStatsReset: finiteNonnegative(row.inserted_since_stats_reset, 'inserted_since_stats_reset'),
    updatedSinceStatsReset: finiteNonnegative(row.updated_since_stats_reset, 'updated_since_stats_reset'),
    deletedSinceStatsReset: finiteNonnegative(row.deleted_since_stats_reset, 'deleted_since_stats_reset'),
    lastVacuum: timestamp(row.last_vacuum), lastAutovacuum: timestamp(row.last_autovacuum),
    lastAnalyze: timestamp(row.last_analyze), lastAutoanalyze: timestamp(row.last_autoanalyze),
    classification: classified.classification, classificationRationale: classified.rationale,
  };
}

export interface PriorRelationCounter {
  readonly qualifiedName: string;
  readonly insertedSinceStatsReset: number;
}

export function measuredAppendRates(
  current: readonly AuditedRelation[], currentAt: string,
  prior: readonly PriorRelationCounter[] | null, priorAt: string | null,
): Readonly<Record<string, number>> | null {
  if (prior === null || priorAt === null) return null;
  const elapsedHours = (Date.parse(currentAt) - Date.parse(priorAt)) / 3_600_000;
  if (!Number.isFinite(elapsedHours) || elapsedHours < (5 / 60)) return null;
  const priorByName = new Map(prior.map((row) => [row.qualifiedName, row.insertedSinceStatsReset]));
  return Object.fromEntries(current.flatMap((row) => {
    const earlier = priorByName.get(row.qualifiedName);
    if (earlier === undefined || row.insertedSinceStatsReset < earlier) return [];
    return [[row.qualifiedName, (row.insertedSinceStatsReset - earlier) / elapsedHours] as const];
  }));
}

export function categoryBytes(relations: readonly AuditedRelation[]): Readonly<Record<RelationClassification, number>> {
  const totals: Record<RelationClassification, number> = {
    CANONICAL_TRADING_STATE: 0, CANONICAL_AUDIT: 0, SHORT_RETENTION_OBSERVATION: 0,
    RESEARCH_HISTORY: 0, DERIVABLE_CACHE: 0, REDUNDANT: 0, UNKNOWN_REQUIRES_REVIEW: 0,
  };
  for (const relation of relations) totals[relation.classification] += relation.totalRelationBytes;
  return totals;
}
