// Content-addressed payload storage with SEPARATE payload identity and observation identity.
//   payload identity    = sha256 of the canonical bytes: the same bytes are stored once (per retention partition).
//   observation identity = who/when/what observed it: the same bytes observed at two times are ONE blob and TWO observation records, so point-in-time correctness survives.
import type { Pool } from 'pg';
import { sha256Hex } from './archive-manifest.js';

export interface PayloadObservation {
  readonly observationId: string;
  readonly observedAt: string;
  /** retention partition (trading session date) the observation belongs to */
  readonly sessionDate: string;
  readonly kind: string;
  readonly provider: string;
  readonly requestHash: string;
  readonly status: string;
  readonly latencyMs: number | null;
  readonly contentHash: string;
}

export const payloadIdentity = (bytes: Uint8Array): string => sha256Hex(bytes);

/** In-memory ledger: the reference semantics used by tests and the simulation. */
export class PayloadLedger {
  readonly blobs = new Map<string, { readonly bytes: Uint8Array; readonly sessionDate: string }>();
  readonly observations: PayloadObservation[] = [];

  record(input: Omit<PayloadObservation, 'contentHash'>, bytes: Uint8Array): { readonly contentHash: string; readonly blobStored: boolean } {
    const contentHash = payloadIdentity(bytes);
    const key = `${contentHash}\u0000${input.sessionDate}`;
    const blobStored = !this.blobs.has(key);
    if (blobStored) this.blobs.set(key, { bytes: Uint8Array.from(bytes), sessionDate: input.sessionDate });
    this.observations.push({ ...input, contentHash });
    return { contentHash, blobStored };
  }

  read(observationId: string): Uint8Array | null {
    const observation = this.observations.find((entry) => entry.observationId === observationId);
    if (observation === undefined) return null;
    return this.blobs.get(`${observation.contentHash}\u0000${observation.sessionDate}`)?.bytes ?? null;
  }

  get storedBytes(): number { let total = 0; for (const blob of this.blobs.values()) total += blob.bytes.length; return total; }
  get observedBytes(): number { return this.observations.reduce((sum, observation) => sum + (this.blobs.get(`${observation.contentHash}\u0000${observation.sessionDate}`)?.bytes.length ?? 0), 0); }
}

/** PostgreSQL implementation over dp.payload_blob and dp.payload_observation (both partitioned by session_date). One transaction: blob first, then the observation. */
export async function recordPayloadPostgres(pool: Pool, observation: Omit<PayloadObservation, 'contentHash'>, bytes: Uint8Array): Promise<{ readonly contentHash: string; readonly blobStored: boolean }> {
  const contentHash = payloadIdentity(bytes);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const inserted = await client.query(`INSERT INTO dp.payload_blob(content_hash, session_date, size_bytes, payload) VALUES ($1, $2::date, $3, $4) ON CONFLICT (content_hash, session_date) DO NOTHING`, [contentHash, observation.sessionDate, bytes.length, Buffer.from(bytes)]);
    await client.query(`INSERT INTO dp.payload_observation(observation_id, session_date, observed_at, kind, provider, request_hash, status, latency_ms, content_hash) VALUES ($1, $2::date, $3::timestamptz, $4, $5, $6, $7, $8, $9)`,
      [observation.observationId, observation.sessionDate, observation.observedAt, observation.kind, observation.provider, observation.requestHash, observation.status, observation.latencyMs, contentHash]);
    await client.query('COMMIT');
    return { contentHash, blobStored: (inserted.rowCount ?? 0) > 0 };
  } catch (error) { await client.query('ROLLBACK').catch(() => undefined); throw error; } finally { client.release(); }
}

/** The same two inserts inside a CALLER's transaction (the cycle store writes the raw observation row and the payload atomically). */
export async function recordPayloadInTransaction(client: Pick<import('pg').PoolClient, 'query'>, observation: Omit<PayloadObservation, 'contentHash'>, bytes: Uint8Array): Promise<{ readonly contentHash: string; readonly blobStored: boolean }> {
  const contentHash = payloadIdentity(bytes);
  const inserted = await client.query(`INSERT INTO dp.payload_blob(content_hash, session_date, size_bytes, payload) VALUES ($1, $2::date, $3, $4) ON CONFLICT (content_hash, session_date) DO NOTHING`, [contentHash, observation.sessionDate, bytes.length, Buffer.from(bytes)]);
  await client.query(`INSERT INTO dp.payload_observation(observation_id, session_date, observed_at, kind, provider, request_hash, status, latency_ms, content_hash) VALUES ($1, $2::date, $3::timestamptz, $4, $5, $6, $7, $8, $9)
    ON CONFLICT (observation_id, session_date) DO NOTHING`, [observation.observationId, observation.sessionDate, observation.observedAt, observation.kind, observation.provider, observation.requestHash, observation.status, observation.latencyMs, contentHash]);
  return { contentHash, blobStored: (inserted.rowCount ?? 0) > 0 };
}

/** Sink contract used by the cycle store: given the raw provider payload bytes, store them content-addressed and return the hash the legacy row keeps instead of the payload. */
export type PayloadSink = (client: Pick<import('pg').PoolClient, 'query'>, record: Omit<PayloadObservation, 'contentHash'> & { readonly bytes: Uint8Array }) => Promise<{ readonly contentHash: string }>;
export const postgresPayloadSink: PayloadSink = async (client, record) => {
  const { bytes, ...observation } = record;
  return recordPayloadInTransaction(client, observation, bytes);
};
