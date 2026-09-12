import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { buildDatasetExport, type DatasetExportArtifact } from './point-in-time-evidence.js';

export interface DatasetExportRequest {
  readonly start:string; readonly end:string; readonly exportedAt:string; readonly featureSetVersion:string;
}

export interface DatasetEvidenceWindow { readonly start:string; readonly end:string; readonly rows:number; }

export class PostgresDatasetExporter {
  constructor(private readonly pool:Pool) {}

  async newestEvidenceWindow():Promise<DatasetEvidenceWindow|null> {
    const result=await this.pool.query(`SELECT min(decision_time)::text AS start,
      (max(decision_time) + interval '1 millisecond')::text AS "end",count(*)::int AS rows
      FROM (SELECT decision_time FROM trade.candidate_set_evidence
        UNION ALL SELECT decision_time FROM trade.candidate_point_in_time_evidence) evidence_window`);
    const row=result.rows[0];
    return row?.start&&row?.end&&Number(row.rows)>0
      ? {start:String(row.start),end:String(row.end),rows:Number(row.rows)} : null;
  }

  async export(request:DatasetExportRequest):Promise<DatasetExportArtifact> {
    if (Date.parse(request.end)<Date.parse(request.start)) throw new Error('DATASET_WINDOW_INVALID');
    const parameters = [request.start,request.end];
    const [sets,candidates,shadow,management,lifecycle,chains,quotes] = await Promise.all([
      this.pool.query(`SELECT cse.* FROM trade.candidate_set_evidence cse WHERE decision_time >= $1 AND decision_time < $2 ORDER BY decision_time,candidate_set_id`,parameters),
      this.pool.query(`SELECT cp.* FROM trade.candidate_point_in_time_evidence cp WHERE decision_time >= $1 AND decision_time < $2 ORDER BY decision_time,candidate_id`,parameters),
      this.pool.query(`SELECT so.opportunity_id,so.fusion_snapshot_id,so.observed_at,so.underlying,so.contract_symbol,
        so.strategy_branch,so.ev_net,so.tail_adjusted_ev,so.return_per_capital_day,so.capital_required,so.uncertainty,
        so.aegis_state,so.recommended_quantity,so.execution_quality_acceptable,so.outcome,so.wait_reason,
        so.rejection_category,so.reasons_json,so.policy_version,so.model_versions_json
        FROM trade.shadow_opportunity so WHERE observed_at >= $1 AND observed_at < $2 ORDER BY observed_at,opportunity_id`,parameters),
      this.pool.query(`SELECT mis.management_input_snapshot_id,mis.fusion_snapshot_id,mis.chain_id,mis.observed_at,
        mis.lifecycle_state,mis.input_json,mis.unknown_fields_json,mis.change_json,mis.content_hash,maf.actions_json,
        maf.selected_action,maf.second_best_action,maf.decision_state,maf.reason_codes_json
        FROM trade.management_input_snapshot mis LEFT JOIN trade.management_action_frontier maf USING(management_input_snapshot_id)
        WHERE mis.observed_at >= $1 AND mis.observed_at < $2 ORDER BY mis.observed_at,mis.management_input_snapshot_id`,parameters),
      this.pool.query(`SELECT lifecycle_application_id,evidence_key,chain_id,event_kind,provider_activity_ref_hash,
        transition_path_json,applied_at,result_hash,detail_json FROM trade.lifecycle_application
        WHERE applied_at >= $1 AND applied_at < $2 ORDER BY applied_at,lifecycle_application_id`,parameters),
      this.pool.query(`SELECT tol.* FROM research.theta_outcome_label tol WHERE label_available_at >= $1 AND label_available_at < $2
        AND subject_type IN ('WHOLE_CHAIN','MANAGED_EPISODE') ORDER BY label_available_at,outcome_label_id`,parameters),
      this.pool.query(`SELECT * FROM market.execution_quote_observation WHERE observed_at >= $1 AND observed_at < $2
        ORDER BY observed_at,quote_observation_id`,parameters),
    ]);
    const versions = [...new Set(candidates.rows.map((row) => String(row.strategy_version)))];
    const artifact = buildDatasetExport({ sourceWindow:{start:request.start,end:request.end},exportedAt:request.exportedAt,
      featureSetVersion:request.featureSetVersion,strategyVersions:versions,rows:{candidateSets:sets.rows,candidates:candidates.rows,
        shadowCandidates:shadow.rows,managementSnapshots:management.rows,lifecycleOutcomes:lifecycle.rows,
        wholeChainOutcomes:chains.rows,executionEvidence:quotes.rows} });
    await this.pool.query(`INSERT INTO research.theta_dataset_export(dataset_export_id,source_window_start,source_window_end,
      exported_at,schema_version,feature_set_version,strategy_versions_json,row_counts_json,dataset_hash)
      VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9) ON CONFLICT(dataset_hash) DO NOTHING`,[
      randomUUID(),request.start,request.end,request.exportedAt,artifact.schemaVersion,artifact.featureSetVersion,
      JSON.stringify(artifact.strategyVersions),JSON.stringify(artifact.rowCounts),artifact.datasetHash]);
    return artifact;
  }
}
