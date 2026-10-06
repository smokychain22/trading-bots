import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import { withRuntimePostgresReadRetry, withRuntimePostgresTransaction } from '../theta/runtime-postgres-client.js';
import { definedRiskManagementVersion, type DefinedRiskManagementDecision } from './defined-risk-management.js';
import type { DefinedRiskPositionSnapshot } from './postgres-defined-risk-position-store.js';

const uuidFrom = (seed: string): string => {
  const hex = createHash('sha256').update(seed).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};

/**
 * Persists a D management decision as an immutable trade.decision row (kind MANAGEMENT) so the close order intent has a real, auditable decision to reference.
 * A spread has no management_input_snapshot (that contract is single-leg), so the evidence snapshot is the ENTRY decision's fusion snapshot and the receipt says so
 * explicitly: nothing here pretends to be a fresh fusion observation. The decision id is derived from the decision's own content hash, so a replay dedupes.
 */
export class PostgresDefinedRiskDecisionRecorder {
  constructor(private readonly pool: Pool) {}

  async record(decision: DefinedRiskManagementDecision, position: DefinedRiskPositionSnapshot): Promise<string> {
    if (decision.orderIntentId !== position.orderIntentId) throw new Error('DEFINED_RISK_DECISION_POSITION_MISMATCH');
    const decisionId = uuidFrom(`theta-defined-risk-management-decision-v1:${decision.contentHash}`);
    return withRuntimePostgresTransaction(this.pool, async (client) => {
      const entry = (await client.query(`SELECT d.fusion_snapshot_id::text AS fusion_snapshot_id FROM trade.order_intent oi
        JOIN trade.decision d ON d.decision_id=oi.decision_id WHERE oi.order_intent_id=$1`, [position.orderIntentId])).rows[0] as { fusion_snapshot_id: string } | undefined;
      if (entry === undefined) throw new Error('DEFINED_RISK_ENTRY_DECISION_NOT_FOUND');
      const inserted = await client.query(`INSERT INTO trade.decision(decision_id,fusion_snapshot_id,candidate_set_id,selected_candidate_id,decision_kind,action_code,quantity,aegis_action,
          strategy_branch,decided_at,status,policy_version,model_versions_json,receipt_json,decision_authority_version)
        VALUES($1,$2,NULL,NULL,'MANAGEMENT',$3,$4,NULL,NULL,$5,$6,$7,'{}'::jsonb,$8::jsonb,$9) ON CONFLICT(decision_id) DO NOTHING RETURNING decision_id`,
      [decisionId, entry.fusion_snapshot_id, decision.action === 'CLOSE_FULL' ? 'CLOSE_DEFINED_RISK' : decision.action, decision.closeQuantity, decision.observedAt,
        decision.action === 'CLOSE_FULL' ? 'READY' : 'RECORDED', definedRiskManagementVersion, JSON.stringify({ definedRiskManagement: decision, chainId: position.chainId,
          orderIntentId: position.orderIntentId, evidenceSnapshotSource: 'ENTRY_DECISION_FUSION_SNAPSHOT', managementInputSnapshot: null }), definedRiskManagementVersion]);
      if ((inserted.rowCount ?? 0) > 0) {
        for (const [index, reason] of decision.reasons.entries()) {
          await client.query(`INSERT INTO trade.decision_reason(decision_id,reason_family,reason_code,polarity,importance_rank,evidence_state) VALUES($1,'MANAGEMENT',$2,0,$3,'KNOWN')`, [decisionId, reason, index + 1]);
        }
      }
      return decisionId;
    });
  }

  /**
   * Attempt number of the next close package. Close orders are one at a time and the attempt advances ONLY past a TERMINAL close intent, so a never-submitted (READY) or
   * in-flight intent keeps its attempt: a restart after a crash resumes that same deterministic intent instead of minting a second economically identical close order.
   */
  async nextCloseAttempt(openIntentId: string): Promise<number> {
    const rows = await withRuntimePostgresReadRetry(this.pool, (client) => client.query(`SELECT count(*)::int AS n FROM trade.order_intent c
      WHERE c.theta_action='CLOSE_DEFINED_RISK' AND c.status::text IN ('FILLED','CANCELED','REJECTED','EXPIRED')
        AND c.chain_id=(SELECT chain_id FROM trade.order_intent WHERE order_intent_id=$1)`, [openIntentId]));
    return Number((rows.value.rows[0] as { n: number }).n) + 1;
  }
}
