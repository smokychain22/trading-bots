import { createHash } from 'node:crypto';
import { Pool } from 'pg';

export interface SanitizedOptionomicsEventRevision {
  readonly observationId: string;
  readonly sourceRawObservationId: string;
  readonly sourceFusionSnapshotId: string;
  readonly provider: 'OPTIONOMICS';
  readonly providerEventIdHash: string;
  readonly revisionOrdinal: number;
  readonly payloadHash: string;
  readonly eventKind: string | null;
  readonly ticker: string | null;
  readonly eventDate: string | null;
  readonly scheduledAt: string | null;
  readonly providerKnownAt: string | null;
  readonly thetaFirstObservedAt: string;
  readonly providerResponseAt: string | null;
  readonly ingestionAt: string;
  readonly decisionTime: string;
  readonly sourceOperation: string;
  readonly sourceQuality: string;
  readonly sourceResponseHash: string;
  readonly pitTimingState: string;
  readonly forwardEvidence: 'THETA_OBSERVED_BEFORE_DECISION' | 'NOT_FORWARD_OR_TIMING_UNPROVEN';
}

interface EventRevisionRow {
  readonly observation_id: string;
  readonly source_raw_observation_id: string;
  readonly fusion_snapshot_id: string;
  readonly provider_event_id: string;
  readonly payload_hash: string;
  readonly event_kind: string | null;
  readonly ticker: string | null;
  readonly event_date: Date | string | null;
  readonly scheduled_at: Date | string | null;
  readonly provider_known_at: Date | string | null;
  readonly first_observed_at: Date | string;
  readonly provider_timestamp: Date | string | null;
  readonly ingestion_timestamp: Date | string;
  readonly decision_time: Date | string;
  readonly operation_alias: string;
  readonly data_quality: string;
  readonly response_hash: string;
  readonly pit_timing_state: string;
}

function iso(value: Date | string | null): string | null {
  if (value === null) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

/** No raw event payload, provider ID, credential reference, or account field leaves this mapper. */
export function sanitizeOptionomicsEventRows(rows: readonly EventRevisionRow[]): readonly SanitizedOptionomicsEventRevision[] {
  const ordinals = new Map<string, number>();
  return rows.map((row) => {
    const ordinal = (ordinals.get(row.provider_event_id) ?? 0) + 1;
    ordinals.set(row.provider_event_id, ordinal);
    const firstObserved = iso(row.first_observed_at);
    const ingestedAt = iso(row.ingestion_timestamp);
    const providerKnownAt = iso(row.provider_known_at);
    const decisionTime = iso(row.decision_time);
    const scheduledAt = iso(row.scheduled_at);
    if (firstObserved === null || ingestedAt === null || decisionTime === null) throw new Error('EVENT_INSPECTION_TIME_INVALID');
    const forwardEvidence = row.operation_alias === 'optionomics.list_events'
      && row.pit_timing_state === 'TIMING_VALID'
      && row.data_quality === 'GOOD'
      && providerKnownAt !== null && providerKnownAt <= firstObserved
      && firstObserved <= decisionTime
      && scheduledAt !== null && scheduledAt > decisionTime
      ? 'THETA_OBSERVED_BEFORE_DECISION' : 'NOT_FORWARD_OR_TIMING_UNPROVEN';
    return {
      observationId: row.observation_id, sourceRawObservationId: row.source_raw_observation_id,
      sourceFusionSnapshotId: row.fusion_snapshot_id, provider: 'OPTIONOMICS',
      providerEventIdHash: createHash('sha256').update(row.provider_event_id).digest('hex'),
      revisionOrdinal: ordinal, payloadHash: row.payload_hash,
      eventKind: typeof row.event_kind === 'string' ? row.event_kind.slice(0, 64) : null,
      ticker: typeof row.ticker === 'string' && /^[A-Z.]{1,12}$/.test(row.ticker) ? row.ticker : null,
      eventDate: iso(row.event_date)?.slice(0, 10) ?? null,
      scheduledAt, providerKnownAt,
      thetaFirstObservedAt: firstObserved, providerResponseAt: iso(row.provider_timestamp),
      ingestionAt: ingestedAt, decisionTime,
      sourceOperation: row.operation_alias, sourceQuality: row.data_quality,
      sourceResponseHash: row.response_hash, pitTimingState: row.pit_timing_state,
      forwardEvidence,
    };
  });
}

export async function inspectOptionomicsEventRevisions(connectionString: string): Promise<{
  readonly state: 'COMPLETE' | 'TRUNCATED';
  readonly rows: readonly SanitizedOptionomicsEventRevision[];
  readonly forwardObservedCount: number;
}> {
  const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 8_000,
    application_name: 'theta-event-revision-inspection' });
  try {
    const result = await pool.query<EventRevisionRow>(`SELECT e.observation_id::text,e.source_raw_observation_id::text,
      r.fusion_snapshot_id::text,e.provider_event_id,e.payload_hash,e.event_kind,e.ticker,e.event_date,
      e.scheduled_at,e.provider_known_at,e.first_observed_at,e.pit_timing_state,
      r.provider_timestamp,r.ingestion_timestamp,r.operation_alias,r.data_quality,r.response_hash,
      f.decision_time
      FROM market.optionomics_event_first_observation e
      JOIN market.optionomics_raw_observation r ON r.observation_id=e.source_raw_observation_id
      JOIN trade.fusion_snapshot f ON f.fusion_snapshot_id=r.fusion_snapshot_id
      ORDER BY e.provider_event_id,e.first_observed_at,e.payload_hash LIMIT 101`);
    const rows = sanitizeOptionomicsEventRows(result.rows.slice(0, 100));
    return { state: result.rows.length > 100 ? 'TRUNCATED' : 'COMPLETE', rows,
      forwardObservedCount: rows.filter((row) => row.forwardEvidence === 'THETA_OBSERVED_BEFORE_DECISION').length };
  } finally {
    await pool.end();
  }
}
