import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { verifyFusionSnapshot, type JsonValue } from '../market/fusion-snapshot.js';
import type { ThetaShadowCycleResult } from './theta-shadow-cycle.js';

export interface ThetaCyclePersistenceContext {
  readonly botInstanceId: string;
  readonly universeVersionId: string | null;
  readonly strategyVersionId: string;
  readonly featureVersionId: string;
  readonly riskLimitVersionId: string;
  readonly executionVersionId: string;
  readonly costModelVersionId: string;
  readonly accountSnapshotId: number;
}

export interface PersistedThetaCycle {
  readonly fusionSnapshotId: string;
  readonly decisionId: string | null;
  readonly strategyRouteId: string | null;
  readonly shadowOpportunityCount: number;
}

export function deterministicRuntimeUuid(value: string): string {
  const bytes = Buffer.from(createHash('sha256').update(value).digest('hex').slice(0, 32), 'hex');
  const versionByte = bytes.at(6);
  const variantByte = bytes.at(8);
  if (versionByte === undefined || variantByte === undefined) throw new Error('RUNTIME_UUID_HASH_INVALID');
  bytes[6] = (versionByte & 0x0f) | 0x40;
  bytes[8] = (variantByte & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

function objectField(snapshot: Readonly<Record<string, JsonValue>>, key: string): JsonValue {
  return snapshot[key] ?? null;
}

export class PostgresThetaCycleStore {
  constructor(private readonly pool: Pool) {}

  async persist(context: ThetaCyclePersistenceContext, cycle: ThetaShadowCycleResult): Promise<PersistedThetaCycle> {
    if (cycle.fusionSnapshot === null) throw new Error('FUSION_SNAPSHOT_NOT_AVAILABLE');
    const fusion = cycle.fusionSnapshot;
    if (fusion.contentHash !== cycle.snapshotContentHash) throw new Error('FUSION_SNAPSHOT_HASH_MISMATCH');
    if (!verifyFusionSnapshot(fusion.snapshot as JsonValue, fusion.contentHash)) throw new Error('FUSION_SNAPSHOT_CONTENT_INVALID');
    const fusionSnapshotId = deterministicRuntimeUuid(`fusion:${context.botInstanceId}:${fusion.contentHash}`);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO trade.fusion_snapshot(
          fusion_snapshot_id,bot_instance_id,decision_time,trigger_type,universe_version_id,
          strategy_version_id,feature_version_id,risk_limit_version_id,execution_version_id,cost_model_version_id,
          account_snapshot_id,feature_snapshot_refs_json,portfolio_state_json,provider_provenance_json,
          unknown_features_json,snapshot_json,content_hash)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'[]'::jsonb,$12,$13,$14,$15,$16)
         ON CONFLICT(bot_instance_id,content_hash) DO NOTHING`,
        [fusionSnapshotId, context.botInstanceId, String(fusion.snapshot.decisionTimeUtc), String(fusion.snapshot.triggerType),
          context.universeVersionId, context.strategyVersionId, context.featureVersionId, context.riskLimitVersionId,
          context.executionVersionId, context.costModelVersionId, context.accountSnapshotId,
          JSON.stringify(objectField(fusion.snapshot, 'portfolioExposure')),
          JSON.stringify(objectField(fusion.snapshot, 'sourceProvenance')),
          JSON.stringify(objectField(fusion.snapshot, 'unknownFeatures')), JSON.stringify(fusion.snapshot), fusion.contentHash],
      );

      const strategyRouteId = await this.persistRoute(client, fusionSnapshotId, cycle);
      const decisionId = await this.persistDecision(client, fusionSnapshotId, cycle);
      let shadowOpportunityCount = 0;
      for (const entry of cycle.orchestration?.shadowOpportunities ?? []) {
        const result = await client.query(
          `INSERT INTO trade.shadow_opportunity(
            opportunity_id,fusion_snapshot_id,observed_at,underlying,contract_symbol,strategy_branch,
            ev_net,tail_adjusted_ev,return_per_capital_day,capital_required,uncertainty,ownership_snapshot_id,
            regime_snapshot_ref,aegis_state,recommended_quantity,execution_quality_acceptable,outcome,wait_reason,
            rejection_category,reasons_json,policy_version,model_versions_json,eventual_outcome_known,eventual_realized_pnl)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
           ON CONFLICT(opportunity_id) DO NOTHING RETURNING opportunity_id`,
          [entry.opportunityId, fusionSnapshotId, entry.timestamp, entry.underlying, entry.contractSymbol,
            entry.strategyBranch, entry.evNet, entry.tailAdjustedEv, entry.returnPerCapitalDay, entry.capitalRequired,
            entry.uncertainty, entry.ownershipSnapshotId, entry.regimeSnapshotId, entry.aegisState,
            entry.recommendedQuantity, entry.executionQualityAcceptable, entry.outcome, entry.waitReason,
            entry.rejectionCategory, JSON.stringify(entry.reasons), entry.policyVersion,
            JSON.stringify(entry.modelVersions), entry.eventualOutcomeKnown, entry.eventualRealizedPnl],
        );
        shadowOpportunityCount += result.rowCount ?? 0;
      }
      await client.query('COMMIT');
      return { fusionSnapshotId, decisionId, strategyRouteId, shadowOpportunityCount };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }

  private async persistRoute(client: PoolClient, fusionSnapshotId: string, cycle: ThetaShadowCycleResult): Promise<string | null> {
    const routing = cycle.orchestration?.routing;
    if (routing === null || routing === undefined) return null;
    const routeId = deterministicRuntimeUuid(`route:${fusionSnapshotId}`);
    const eligibility = routing.results.map((result) => ({
      branch: result.strategyFamily, eligible: result.eligible,
      eligibilityState: result.eligibilityState, reasonCodes: result.reasons.map((reason) => reason.code),
    }));
    await client.query(
      `INSERT INTO trade.strategy_route(strategy_route_id,fusion_snapshot_id,evaluated_at,branch_eligibility_json,selected_branch,policy_version)
       VALUES($1,$2,$3,$4,NULL,$5) ON CONFLICT(fusion_snapshot_id) DO NOTHING`,
      [routeId, fusionSnapshotId, routing.timestamp, JSON.stringify(eligibility), routing.policyVersion],
    );
    return routeId;
  }

  private async persistDecision(client: PoolClient, fusionSnapshotId: string, cycle: ThetaShadowCycleResult): Promise<string | null> {
    const receipt = cycle.orchestration?.receipt;
    if (receipt === null || receipt === undefined) return null;
    const decisionId = deterministicRuntimeUuid(`decision:${fusionSnapshotId}:${receipt.underlying}`);
    const inserted = await client.query(
      `INSERT INTO trade.decision(decision_id,fusion_snapshot_id,decision_kind,action_code,quantity,
         aegis_action,decided_at,status,explanation_text,explanation_hash,runtime_selected_candidate_ref,
         policy_version,model_versions_json,fail_closed_reason,receipt_json)
       VALUES($1,$2,'NEW_RISK',$3,$4,$5,$6,'RECORDED',$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT(decision_id) DO NOTHING RETURNING decision_id`,
      [decisionId, fusionSnapshotId, receipt.winningAction, receipt.quantity,
        cycle.orchestration?.aegis?.newRiskState ?? null, receipt.timestamp, receipt.plainEnglishExplanation,
        createHash('sha256').update(receipt.plainEnglishExplanation).digest('hex'), receipt.selectedCandidateId,
        receipt.policyVersion, JSON.stringify(receipt.modelVersions), receipt.failClosedReason, JSON.stringify(receipt)],
    );
    if ((inserted.rowCount ?? 0) > 0) {
      for (const [index, reasonCode] of receipt.reasonCodes.entries()) {
        await client.query(
          `INSERT INTO trade.decision_reason(decision_id,reason_family,reason_code,polarity,importance_rank,evidence_state)
           VALUES($1,'RUNTIME',$2,0,$3,'RECORDED')`, [decisionId, reasonCode, index + 1],
        );
      }
    }
    return decisionId;
  }
}
