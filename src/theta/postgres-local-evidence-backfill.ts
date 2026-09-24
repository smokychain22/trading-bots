import type { Pool } from 'pg';
import type { LocalEvidenceBackfillTarget, LocalEvidenceEnvelope } from './local-evidence-spool.js';
import { withRuntimePostgresTransaction } from './runtime-postgres-client.js';

export class PostgresLocalEvidenceBackfillTarget implements LocalEvidenceBackfillTarget {
  constructor(private readonly pool:Pool) {}

  async hasEnvelope(envelopeId:string,envelopeHash:string):Promise<boolean>{
    const result=await this.pool.query(`SELECT envelope_hash FROM ops.local_observation_evidence
      WHERE envelope_id=$1`,[envelopeId]);
    if(result.rowCount===0)return false;
    if(String(result.rows[0]?.envelope_hash)!==envelopeHash)throw new Error('LOCAL_EVIDENCE_POSTGRES_IDENTITY_CONFLICT');
    return true;
  }

  async insertEnvelope(envelope:LocalEvidenceEnvelope):Promise<void>{
    await withRuntimePostgresTransaction(this.pool,async(client)=>{
      await client.query(`INSERT INTO ops.local_observation_evidence(
        envelope_id,decision_cycle_id,snapshot_id,decision_as_of,source_sha,worker_id,sequence_number,payload_type,
        payload_json,payload_hash,previous_envelope_hash,envelope_hash,provider_observed_at_json,received_at,computed_at,
        local_persistence_state)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13::jsonb,$14,$15,'BACKFILLED_POSTGRES')
        ON CONFLICT(envelope_id) DO NOTHING`,[envelope.envelopeId,envelope.decisionCycleId,envelope.snapshotId,
        envelope.decisionAsOf,envelope.sourceSha,envelope.workerId,envelope.sequenceNumber,envelope.payloadType,
        JSON.stringify(envelope.payload),envelope.payloadHash,envelope.previousEnvelopeHash,envelope.envelopeHash,
        JSON.stringify(envelope.providerObservedAt),envelope.receivedAt,envelope.computedAt]);
    });
  }
}
