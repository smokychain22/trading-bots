import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { canonicalJson } from '../research/point-in-time-evidence.js';

export const localEvidenceSpoolVersion = 'theta-local-evidence-spool-v1' as const;

export type LocalEvidencePostgresState =
  | 'PERSISTED_POSTGRES'
  | 'SPOOLED_LOCAL_PENDING_DB'
  | 'BACKFILLED_POSTGRES'
  | 'REJECTED_IDENTITY_CONFLICT'
  | 'CORRUPT';

export type DecisionCheckpointStage =
  | 'ACCOUNT_READY' | 'CONTRACTS_READY' | 'QUOTES_READY' | 'Q_READY'
  | 'SHADOW_READY' | 'EVENT_READY' | 'RISK_OBSERVATIONS_READY' | 'AEGIS_READY' | 'SIZING_READY'
  | 'DECISION_READY' | 'PLAN_READY' | 'CYCLE_FAILED';

export interface LocalEvidenceEnvelopeInput {
  readonly envelopeId?: string;
  readonly decisionCycleId: string;
  readonly snapshotId: string;
  readonly decisionAsOf: string;
  readonly sourceSha: string;
  readonly workerId: string;
  readonly sequenceNumber: number;
  readonly payloadType: DecisionCheckpointStage | string;
  readonly payload: unknown;
  readonly providerObservedAt: Readonly<Record<string, string | null>>;
  readonly receivedAt: string;
  readonly computedAt: string;
  readonly postgresPersistenceState?: Extract<LocalEvidencePostgresState,
    'PERSISTED_POSTGRES' | 'SPOOLED_LOCAL_PENDING_DB'>;
}

export interface LocalEvidenceEnvelope extends Omit<LocalEvidenceEnvelopeInput, 'envelopeId' | 'postgresPersistenceState'> {
  readonly envelopeId: string;
  readonly payloadHash: string;
  readonly previousEnvelopeHash: string | null;
  readonly envelopeHash: string;
  readonly postgresPersistenceState: LocalEvidencePostgresState;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly conflictReason: string | null;
}

export interface LocalEvidenceBackfillTarget {
  hasEnvelope(envelopeId: string, envelopeHash: string): Promise<boolean>;
  insertEnvelope(envelope: LocalEvidenceEnvelope): Promise<void>;
}

export interface LocalEvidenceBackfillReceipt {
  readonly attempted: number;
  readonly inserted: number;
  readonly alreadyPresent: number;
  readonly conflicts: number;
  readonly remaining: number;
}

export type DatabaseCircuitState = 'HEALTHY' | 'DEGRADED_READABLE' | 'SPOOL_MODE' | 'RECOVERING';

const SHA_1 = /^[0-9a-f]{40}$/;
const SAFE_ID = /^[A-Za-z0-9_.:@/-]{1,256}$/;
const SECRET_KEY = /^(authorization|cookie|set-cookie|password|api[-_]?key|api[-_]?secret|secret|token|access[-_]?token|refresh[-_]?token|credential|connection[-_]?string|database[-_]?url)$/i;
const SECRET_VALUE = [
  /postgres(?:ql)?:\/\/[^\s"']+:[^\s"']+@/i,
  /\bBearer\s+[A-Za-z0-9._~+/-]+=*/i,
  /APCA-API-(?:KEY-ID|SECRET-KEY)/i,
];
const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

function validTimestamp(value: string, name: string): string {
  if (!Number.isFinite(Date.parse(value))) throw new Error(`LOCAL_EVIDENCE_${name}_INVALID`);
  return new Date(value).toISOString();
}

function assertSafePayload(value: unknown, path = '$'): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSafePayload(item, `${path}[${index}]`));
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (SECRET_KEY.test(key)) throw new Error(`LOCAL_EVIDENCE_SECRET_KEY_REJECTED:${path}.${key}`);
      assertSafePayload(item, `${path}.${key}`);
    }
    return;
  }
  if (typeof value === 'string' && SECRET_VALUE.some((pattern) => pattern.test(value))) {
    throw new Error(`LOCAL_EVIDENCE_SECRET_VALUE_REJECTED:${path}`);
  }
}

function envelopeIdentity(input: Omit<LocalEvidenceEnvelope, 'envelopeHash' | 'createdAt' | 'updatedAt' | 'conflictReason'>): unknown {
  return {
    contractVersion: localEvidenceSpoolVersion,
    envelopeId: input.envelopeId,
    decisionCycleId: input.decisionCycleId,
    snapshotId: input.snapshotId,
    decisionAsOf: input.decisionAsOf,
    sourceSha: input.sourceSha,
    workerId: input.workerId,
    sequenceNumber: input.sequenceNumber,
    payloadType: input.payloadType,
    payloadHash: input.payloadHash,
    previousEnvelopeHash: input.previousEnvelopeHash,
    providerObservedAt: input.providerObservedAt,
    receivedAt: input.receivedAt,
    computedAt: input.computedAt,
  };
}

type EnvelopeRow = {
  envelope_id: string; decision_cycle_id: string; snapshot_id: string; decision_as_of: string;
  source_sha: string; worker_id: string; sequence_number: number; payload_type: string;
  payload_json: string; payload_hash: string; previous_envelope_hash: string | null; envelope_hash: string;
  provider_observed_at_json: string; received_at: string; computed_at: string; postgres_state: LocalEvidencePostgresState;
  created_at: string; updated_at: string; conflict_reason: string | null;
};

function fromRow(row: EnvelopeRow): LocalEvidenceEnvelope {
  return {
    envelopeId: row.envelope_id, decisionCycleId: row.decision_cycle_id, snapshotId: row.snapshot_id,
    decisionAsOf: row.decision_as_of, sourceSha: row.source_sha, workerId: row.worker_id,
    sequenceNumber: row.sequence_number, payloadType: row.payload_type, payload: JSON.parse(row.payload_json),
    payloadHash: row.payload_hash, previousEnvelopeHash: row.previous_envelope_hash, envelopeHash: row.envelope_hash,
    providerObservedAt: JSON.parse(row.provider_observed_at_json), receivedAt: row.received_at,
    computedAt: row.computed_at, postgresPersistenceState: row.postgres_state,
    createdAt: row.created_at, updatedAt: row.updated_at, conflictReason: row.conflict_reason,
  };
}

export function brokerMutationAllowedForEvidence(envelope: LocalEvidenceEnvelope): boolean {
  return envelope.postgresPersistenceState === 'PERSISTED_POSTGRES'
    || envelope.postgresPersistenceState === 'BACKFILLED_POSTGRES';
}

export class LocalEvidenceSpool {
  private readonly database: DatabaseSync;

  constructor(path = '.theta-local-worker/evidence-spool/theta-evidence.sqlite') {
    const databasePath = resolve(path);
    mkdirSync(dirname(databasePath), { recursive: true });
    this.database = new DatabaseSync(databasePath);
    this.database.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    this.database.exec(`CREATE TABLE IF NOT EXISTS envelope(
      envelope_id TEXT PRIMARY KEY,
      decision_cycle_id TEXT NOT NULL,
      snapshot_id TEXT NOT NULL,
      decision_as_of TEXT NOT NULL,
      source_sha TEXT NOT NULL,
      worker_id TEXT NOT NULL,
      sequence_number INTEGER NOT NULL CHECK(sequence_number >= 0),
      payload_type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      payload_hash TEXT NOT NULL,
      previous_envelope_hash TEXT,
      envelope_hash TEXT NOT NULL UNIQUE,
      provider_observed_at_json TEXT NOT NULL,
      received_at TEXT NOT NULL,
      computed_at TEXT NOT NULL,
      postgres_state TEXT NOT NULL CHECK(postgres_state IN (
        'PERSISTED_POSTGRES','SPOOLED_LOCAL_PENDING_DB','BACKFILLED_POSTGRES','REJECTED_IDENTITY_CONFLICT','CORRUPT')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      conflict_reason TEXT,
      UNIQUE(decision_cycle_id,sequence_number));
      CREATE INDEX IF NOT EXISTS ix_theta_evidence_pending ON envelope(postgres_state,created_at);
      CREATE TABLE IF NOT EXISTS circuit(
        service TEXT PRIMARY KEY,
        state TEXT NOT NULL CHECK(state IN ('HEALTHY','DEGRADED_READABLE','SPOOL_MODE','RECOVERING')),
        failure_count INTEGER NOT NULL DEFAULT 0,
        recovery_count INTEGER NOT NULL DEFAULT 0,
        consecutive_successes INTEGER NOT NULL DEFAULT 0,
        last_failure_at TEXT,
        next_probe_at TEXT,
        updated_at TEXT NOT NULL);`);
  }

  close(): void { this.database.close(); }

  append(input: LocalEvidenceEnvelopeInput): LocalEvidenceEnvelope {
    for (const [name, value] of [['decisionCycleId', input.decisionCycleId], ['snapshotId', input.snapshotId],
      ['workerId', input.workerId], ['payloadType', input.payloadType]] as const) {
      if (!SAFE_ID.test(value)) throw new Error(`LOCAL_EVIDENCE_${name.toUpperCase()}_INVALID`);
    }
    if (!SHA_1.test(input.sourceSha)) throw new Error('LOCAL_EVIDENCE_SOURCE_SHA_INVALID');
    if (!Number.isInteger(input.sequenceNumber) || input.sequenceNumber < 0) throw new Error('LOCAL_EVIDENCE_SEQUENCE_INVALID');
    const decisionAsOf = validTimestamp(input.decisionAsOf, 'DECISION_AS_OF');
    const receivedAt = validTimestamp(input.receivedAt, 'RECEIVED_AT');
    const computedAt = validTimestamp(input.computedAt, 'COMPUTED_AT');
    if (Date.parse(computedAt) < Date.parse(decisionAsOf)) throw new Error('LOCAL_EVIDENCE_COMPUTED_BEFORE_DECISION');
    assertSafePayload(input.payload);
    assertSafePayload(input.providerObservedAt);
    const payloadJson = canonicalJson(input.payload);
    const payloadHash = sha256(payloadJson);
    const existing = this.getByCycleSequence(input.decisionCycleId,input.sequenceNumber);
    if (existing !== null) {
      const same = (input.envelopeId === undefined || input.envelopeId === existing.envelopeId)
        && existing.snapshotId === input.snapshotId && existing.decisionAsOf === decisionAsOf
        && existing.sourceSha === input.sourceSha && existing.workerId === input.workerId
        && existing.payloadType === input.payloadType && existing.payloadHash === payloadHash
        && canonicalJson(existing.providerObservedAt) === canonicalJson(input.providerObservedAt)
        && existing.receivedAt === receivedAt && existing.computedAt === computedAt;
      if (same) return existing;
      throw new Error('LOCAL_EVIDENCE_IDENTITY_CONFLICT');
    }
    const prior = this.database.prepare(`SELECT envelope_hash FROM envelope WHERE decision_cycle_id=?
      ORDER BY sequence_number DESC LIMIT 1`).get(input.decisionCycleId) as { envelope_hash: string } | undefined;
    const previousEnvelopeHash = prior?.envelope_hash ?? null;
    const state = input.postgresPersistenceState ?? 'SPOOLED_LOCAL_PENDING_DB';
    const now = new Date().toISOString();
    const unsigned = {
      envelopeId: input.envelopeId ?? randomUUID(), decisionCycleId: input.decisionCycleId,
      snapshotId: input.snapshotId, decisionAsOf, sourceSha: input.sourceSha, workerId: input.workerId,
      sequenceNumber: input.sequenceNumber, payloadType: input.payloadType, payload: input.payload,
      payloadHash, previousEnvelopeHash, providerObservedAt: input.providerObservedAt,
      receivedAt, computedAt, postgresPersistenceState: state,
    } as const;
    const envelopeHash = sha256(canonicalJson(envelopeIdentity(unsigned)));
    try {
      this.database.prepare(`INSERT INTO envelope(envelope_id,decision_cycle_id,snapshot_id,decision_as_of,source_sha,
        worker_id,sequence_number,payload_type,payload_json,payload_hash,previous_envelope_hash,envelope_hash,
        provider_observed_at_json,received_at,computed_at,postgres_state,created_at,updated_at,conflict_reason)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL)`).run(unsigned.envelopeId,unsigned.decisionCycleId,unsigned.snapshotId,
        unsigned.decisionAsOf,unsigned.sourceSha,unsigned.workerId,unsigned.sequenceNumber,unsigned.payloadType,payloadJson,
        payloadHash,previousEnvelopeHash,envelopeHash,canonicalJson(unsigned.providerObservedAt),receivedAt,computedAt,state,now,now);
    } catch (error) {
      throw new Error('LOCAL_EVIDENCE_IDENTITY_CONFLICT',{cause:error});
    }
    return { ...unsigned, envelopeHash, createdAt: now, updatedAt: now, conflictReason: null };
  }

  getByCycleSequence(decisionCycleId: string, sequenceNumber: number): LocalEvidenceEnvelope | null {
    const row = this.database.prepare('SELECT * FROM envelope WHERE decision_cycle_id=? AND sequence_number=?')
      .get(decisionCycleId,sequenceNumber) as EnvelopeRow | undefined;
    return row === undefined ? null : fromRow(row);
  }

  pending(limit = 100): readonly LocalEvidenceEnvelope[] {
    const bounded = Math.max(1,Math.min(1_000,Math.floor(limit)));
    return (this.database.prepare(`SELECT * FROM envelope WHERE postgres_state='SPOOLED_LOCAL_PENDING_DB'
      ORDER BY created_at,envelope_id LIMIT ?`).all(bounded) as unknown as EnvelopeRow[]).map(fromRow);
  }

  listByPayloadType(payloadType: string, limit = 5_000): readonly LocalEvidenceEnvelope[] {
    if (!SAFE_ID.test(payloadType)) throw new Error('LOCAL_EVIDENCE_PAYLOADTYPE_INVALID');
    const bounded = Math.max(1,Math.min(10_000,Math.floor(limit)));
    return (this.database.prepare(`SELECT * FROM envelope WHERE payload_type=? AND postgres_state!='CORRUPT'
      ORDER BY decision_as_of DESC,envelope_id DESC LIMIT ?`).all(payloadType,bounded) as unknown as EnvelopeRow[])
      .map(fromRow);
  }

  verify(): { readonly valid: boolean; readonly checked: number; readonly corruptEnvelopeIds: readonly string[] } {
    const rows = this.database.prepare('SELECT * FROM envelope ORDER BY decision_cycle_id,sequence_number').all() as unknown as EnvelopeRow[];
    const prior = new Map<string,string|null>();
    const corrupt: string[] = [];
    for (const row of rows) {
      const envelope = fromRow(row);
      const payloadHash = sha256(canonicalJson(envelope.payload));
      const expectedPrior = prior.get(envelope.decisionCycleId) ?? null;
      const envelopeHash = sha256(canonicalJson(envelopeIdentity({
        ...envelope, payloadHash, previousEnvelopeHash: expectedPrior,
      })));
      if (payloadHash !== envelope.payloadHash || envelope.previousEnvelopeHash !== expectedPrior
        || envelopeHash !== envelope.envelopeHash) corrupt.push(envelope.envelopeId);
      prior.set(envelope.decisionCycleId,envelope.envelopeHash);
    }
    return { valid: corrupt.length === 0, checked: rows.length, corruptEnvelopeIds: corrupt };
  }

  async backfill(target: LocalEvidenceBackfillTarget, expectedSourceSha: string): Promise<LocalEvidenceBackfillReceipt> {
    if (!SHA_1.test(expectedSourceSha)) throw new Error('LOCAL_EVIDENCE_BACKFILL_SOURCE_SHA_INVALID');
    const integrity = this.verify();
    if (!integrity.valid) {
      for (const envelopeId of integrity.corruptEnvelopeIds) this.updateState(envelopeId,'CORRUPT','HASH_CHAIN_INVALID');
      throw new Error('LOCAL_EVIDENCE_HASH_CHAIN_INVALID');
    }
    const pending = this.pending(1_000);
    let inserted=0,alreadyPresent=0,conflicts=0;
    for (const envelope of pending) {
      if (envelope.sourceSha !== expectedSourceSha) {
        this.updateState(envelope.envelopeId,'REJECTED_IDENTITY_CONFLICT','SOURCE_SHA_MISMATCH');
        conflicts+=1;
        continue;
      }
      if (await target.hasEnvelope(envelope.envelopeId,envelope.envelopeHash)) {
        this.updateState(envelope.envelopeId,'BACKFILLED_POSTGRES',null);
        alreadyPresent+=1;
        continue;
      }
      try {
        await target.insertEnvelope(envelope);
      } catch (error) {
        if (!await target.hasEnvelope(envelope.envelopeId,envelope.envelopeHash)) throw error;
      }
      if (!await target.hasEnvelope(envelope.envelopeId,envelope.envelopeHash)) throw new Error('LOCAL_EVIDENCE_BACKFILL_VERIFY_FAILED');
      this.updateState(envelope.envelopeId,'BACKFILLED_POSTGRES',null);
      inserted+=1;
    }
    return {attempted:pending.length,inserted,alreadyPresent,conflicts,remaining:this.pending(1_000).length};
  }

  circuitState(service='POSTGRES'): { readonly state: DatabaseCircuitState; readonly failureCount: number;
    readonly recoveryCount: number; readonly consecutiveSuccesses: number; readonly nextProbeAt: string | null } {
    const row=this.database.prepare('SELECT * FROM circuit WHERE service=?').get(service) as {
      state:DatabaseCircuitState;failure_count:number;recovery_count:number;consecutive_successes:number;next_probe_at:string|null}|undefined;
    return row===undefined?{state:'HEALTHY',failureCount:0,recoveryCount:0,consecutiveSuccesses:0,nextProbeAt:null}
      :{state:row.state,failureCount:row.failure_count,recoveryCount:row.recovery_count,
        consecutiveSuccesses:row.consecutive_successes,nextProbeAt:row.next_probe_at};
  }

  recordDatabaseFailure(at: string, readable: boolean, probeDelayMs=30_000): DatabaseCircuitState {
    const observedAt=validTimestamp(at,'CIRCUIT_FAILURE_AT');
    const current=this.circuitState();
    const state:DatabaseCircuitState=readable?'DEGRADED_READABLE':'SPOOL_MODE';
    const nextProbeAt=new Date(Date.parse(observedAt)+Math.max(1_000,probeDelayMs)).toISOString();
    this.database.prepare(`INSERT INTO circuit(service,state,failure_count,recovery_count,consecutive_successes,last_failure_at,
      next_probe_at,updated_at) VALUES('POSTGRES',?,1,0,0,?,?,?) ON CONFLICT(service) DO UPDATE SET
      state=excluded.state,failure_count=circuit.failure_count+1,consecutive_successes=0,last_failure_at=excluded.last_failure_at,
      next_probe_at=excluded.next_probe_at,updated_at=excluded.updated_at`).run(state,observedAt,nextProbeAt,observedAt);
    return current.state===state?current.state:state;
  }

  recordDatabaseProbeSuccess(at: string): DatabaseCircuitState {
    const observedAt=validTimestamp(at,'CIRCUIT_PROBE_AT');
    const current=this.circuitState();
    const successes=current.consecutiveSuccesses+1;
    const healthy=successes>=2;
    const state:DatabaseCircuitState=healthy?'HEALTHY':'RECOVERING';
    this.database.prepare(`INSERT INTO circuit(service,state,failure_count,recovery_count,consecutive_successes,last_failure_at,
      next_probe_at,updated_at) VALUES('POSTGRES',?,0,?, ?,NULL,NULL,?) ON CONFLICT(service) DO UPDATE SET
      state=excluded.state,recovery_count=CASE WHEN excluded.state='HEALTHY' AND circuit.state!='HEALTHY'
        THEN circuit.recovery_count+1 ELSE circuit.recovery_count END,
      consecutive_successes=excluded.consecutive_successes,next_probe_at=NULL,updated_at=excluded.updated_at`)
      .run(state,healthy?current.recoveryCount+1:current.recoveryCount,successes,observedAt);
    return state;
  }

  private updateState(envelopeId:string,state:LocalEvidencePostgresState,reason:string|null):void{
    this.database.prepare('UPDATE envelope SET postgres_state=?,conflict_reason=?,updated_at=? WHERE envelope_id=?')
      .run(state,reason,new Date().toISOString(),envelopeId);
  }
}
