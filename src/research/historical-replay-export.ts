import type { Pool, PoolClient } from 'pg';
import { canonicalJson, hashJson, type JsonValue } from '../market/fusion-snapshot.js';
import {
  historicalReplayRowSchema,
  importHistoricalReplayBatch,
  type HistoricalReplayRow,
} from './historical-replay-import.js';

export const historicalReplayExportVersion = 'theta-historical-replay-export-v1' as const;

export interface HistoricalReplayDatabaseRow {
  readonly candidate_id: string;
  readonly candidate_set_id: string;
  readonly decision_id: string | null;
  readonly fusion_snapshot_id: string;
  readonly decision_time: string | Date;
  readonly branch: string;
  readonly selected: boolean;
  readonly rejection_reason: string | null;
  readonly contract_json: Record<string, unknown>;
  readonly market_json: Record<string, unknown>;
  readonly event_json: Record<string, unknown>;
  readonly aegis_json: Record<string, unknown>;
  readonly execution_json: Record<string, unknown>;
  readonly hard_blockers_json: readonly unknown[];
  readonly candidate_metrics_json: Record<string, unknown>;
  readonly quote_observation_id: string | null;
  readonly quote_provider_timestamp: string | Date | null;
  readonly quote_ingestion_timestamp: string | Date | null;
}

const absent = 'ABSENT_IN_HISTORICAL_SCHEMA' as const;

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function iso(value: string | Date): string {
  return new Date(value).toISOString();
}

function strings(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

export function historicalReplayRowFromDatabase(row: HistoricalReplayDatabaseRow): HistoricalReplayRow {
  const contract = record(row.contract_json);
  const market = record(row.market_json);
  const event = record(row.event_json);
  const aegis = record(row.aegis_json);
  const execution = record(row.execution_json);
  const candidateMetrics = record(row.candidate_metrics_json);
  const normalizedContract = record(candidateMetrics.contract);
  const decisionAlternative = record(candidateMetrics.decisionAlternative);
  const thetaQ = record(candidateMetrics.thetaQ);
  const eventState = record(event.state);
  if (typeof contract.underlying !== 'string' || contract.underlying.trim() === '') {
    throw new Error(`HISTORICAL_REPLAY_UNDERLYING_MISSING:${row.candidate_id}`);
  }

  const rejectionCodes = [...new Set([
    ...strings(row.hard_blockers_json),
    ...(row.rejection_reason === null ? [] : [row.rejection_reason]),
  ])].sort();
  const evidenceIds = [row.candidate_id, row.candidate_set_id, row.fusion_snapshot_id,
    row.decision_id, row.quote_observation_id]
    .filter((value): value is string => typeof value === 'string' && value.length > 0);

  const rawAegisState = record(aegis.state).newRiskState ?? decisionAlternative.aegisState;
  const rawQuantity = finiteNumber(decisionAlternative.quantity ?? thetaQ.quantity);
  const rawDisposition = decisionAlternative.disposition;
  const eventClassification = eventState.populated === true ? 'OBSERVED_CONTEXT'
    : eventState.populated === false ? 'EMPTY_UNQUALIFIED'
      : event.state === null || event.state === undefined ? 'UNKNOWN' : 'PARTIAL_OR_UNCLASSIFIED';

  return historicalReplayRowSchema.parse({
    candidateId: row.candidate_id,
    cycleId: row.candidate_set_id,
    asOf: iso(row.decision_time),
    symbol: contract.underlying,
    strategy: row.branch || absent,
    dte: finiteNumber(contract.dte) ?? absent,
    strike: finiteNumber(contract.strike) ?? absent,
    delta: finiteNumber(normalizedContract.delta) ?? absent,
    bid: finiteNumber(market.bid),
    ask: finiteNumber(market.ask),
    quoteProviderTimestamp: row.quote_provider_timestamp === null
      ? typeof market.quoteTimestamp === 'string' ? market.quoteTimestamp : absent
      : iso(row.quote_provider_timestamp),
    quoteReceivedAt: row.quote_ingestion_timestamp === null ? absent : iso(row.quote_ingestion_timestamp),
    executable: typeof execution.executable === 'boolean' ? execution.executable : absent,
    rejectionCodes,
    eventState: eventClassification,
    aegisState: typeof rawAegisState === 'string' ? rawAegisState : absent,
    sizingState: rawQuantity === null ? absent : rawQuantity > 0 ? 'POSITIVE_QUANTITY' : 'ZERO_QUANTITY',
    selectedQty: rawQuantity ?? absent,
    economicDisposition: typeof rawDisposition === 'string' ? rawDisposition : absent,
    persistedEvidenceIds: evidenceIds,
  });
}

export interface HistoricalReplayExportArtifact {
  readonly contractVersion: typeof historicalReplayExportVersion;
  readonly canonicalSourceSha: string;
  readonly generatedAt: string;
  readonly sourceSessions: readonly string[];
  readonly sourceWindow: { readonly timezone: 'America/New_York'; readonly sessionDates: readonly string[] };
  readonly scope: 'SYMBOL_SCOPED';
  readonly providerAuthorities: readonly ['ALPACA_EXECUTABLE_MARKET', 'THETA_PERSISTED_DECISION'];
  readonly sanitized: true;
  readonly brokerAuthority: false;
  readonly rowCount: number;
  readonly symbolCount: number;
  readonly immutableEvidenceIdCount: number;
  readonly importIssueCount: number;
  readonly rows: readonly HistoricalReplayRow[];
  readonly contentHash: string;
}

async function readSessionRows(client: PoolClient, sessionDate: string): Promise<readonly HistoricalReplayDatabaseRow[]> {
  const result = await client.query<HistoricalReplayDatabaseRow>(
    `SELECT p.candidate_id::text,c.candidate_set_id::text,p.decision_id::text,
            p.fusion_snapshot_id::text,p.decision_time,p.branch,p.selected,p.rejection_reason,
            p.contract_json,p.market_json,p.event_json,p.aegis_json,p.execution_json,p.hard_blockers_json,
            c.metrics_json AS candidate_metrics_json,q.quote_observation_id::text,
            q.provider_timestamp AS quote_provider_timestamp,q.ingestion_timestamp AS quote_ingestion_timestamp
       FROM trade.candidate_point_in_time_evidence p
       JOIN trade.candidate c ON c.candidate_id=p.candidate_id
       LEFT JOIN LATERAL (
         SELECT quote_observation_id,provider_timestamp,ingestion_timestamp
           FROM market.execution_quote_observation q
          WHERE q.candidate_id=p.candidate_id AND q.observation_role='DECISION'
          ORDER BY q.observed_at DESC,q.quote_observation_id DESC LIMIT 1
       ) q ON true
      WHERE (p.decision_time AT TIME ZONE 'America/New_York')::date=$1::date
      ORDER BY p.decision_time,p.candidate_id`,
    [sessionDate],
  );
  return result.rows;
}

export async function buildHistoricalReplayExport(input: {
  readonly pool: Pool;
  readonly sessionDates: readonly string[];
  readonly canonicalSourceSha: string;
  readonly generatedAt: string;
}): Promise<HistoricalReplayExportArtifact> {
  if (!/^[0-9a-f]{40}$/.test(input.canonicalSourceSha)) throw new Error('CANONICAL_SOURCE_SHA_INVALID');
  const sessions = [...new Set(input.sessionDates)].sort();
  if (sessions.length === 0 || sessions.some((date) => !/^\d{4}-\d{2}-\d{2}$/.test(date))) {
    throw new Error('HISTORICAL_REPLAY_SESSION_DATE_INVALID');
  }
  const client = await input.pool.connect();
  try {
    await client.query('BEGIN TRANSACTION READ ONLY');
    const databaseRows = (await Promise.all(sessions.map((date) => readSessionRows(client, date)))).flat();
    await client.query('COMMIT');
    const rows = databaseRows.map(historicalReplayRowFromDatabase);
    const imported = importHistoricalReplayBatch(`${sessions[0]}..${sessions.at(-1)}`, rows);
    if (imported.rowsAccepted.length !== rows.length) throw new Error('HISTORICAL_REPLAY_EXPORT_VALIDATION_FAILED');
    const immutableEvidenceIds = new Set(rows.flatMap((row) => Array.isArray(row.persistedEvidenceIds)
      ? row.persistedEvidenceIds : []));
    const body = {
      contractVersion: historicalReplayExportVersion,
      canonicalSourceSha: input.canonicalSourceSha,
      generatedAt: input.generatedAt,
      sourceSessions: sessions,
      sourceWindow: { timezone: 'America/New_York' as const, sessionDates: sessions },
      scope: 'SYMBOL_SCOPED' as const,
      providerAuthorities: ['ALPACA_EXECUTABLE_MARKET', 'THETA_PERSISTED_DECISION'] as const,
      sanitized: true as const,
      brokerAuthority: false as const,
      rowCount: rows.length,
      symbolCount: new Set(rows.map((row) => row.symbol)).size,
      immutableEvidenceIdCount: immutableEvidenceIds.size,
      importIssueCount: imported.issues.length,
      rows,
    };
    const contentHash = hashJson(body as unknown as JsonValue);
    // Canonical serialization is intentionally exercised here. Callers may
    // write pretty JSON, while the identity remains independent of key order.
    canonicalJson(body as unknown as JsonValue);
    return { ...body, contentHash };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
