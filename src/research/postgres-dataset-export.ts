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
    const [sets,candidates,shadow,frontiers,management,lifecycle,chains,quotes] = await Promise.all([
      this.pool.query(`SELECT candidate_set_id AS "candidateSetId",decision_time AS "decisionTime",
        universe_evaluated_json AS "universeEvaluated",branches_considered_json AS "branchesConsidered",counts_json AS counts,
        best_candidate_id AS "bestCandidateId",second_best_candidate_id AS "secondBestCandidateId",
        best_rejected_candidate_id AS "bestRejectedCandidateId",completeness_state AS "completenessState",
        missing_scope_json AS "missingScope",content_hash AS "contentHash"
        FROM trade.candidate_set_evidence WHERE decision_time >= $1 AND decision_time < $2 ORDER BY decision_time,candidate_set_id`,parameters),
      this.pool.query(`SELECT candidate_id AS "candidateId",decision_id AS "decisionId",fusion_snapshot_id AS "fusionSnapshotId",
        decision_time AS "decisionTime",branch,rank_at_decision AS "rankAtDecision",selected,hard_status AS "hardStatus",
        soft_status AS "softStatus",rejection_reason AS "rejectionReason",contract_json AS contract,market_json AS market,
        volatility_json AS volatility,technical_json AS technical,event_json AS event,flow_json AS flow,ownership_json AS ownership,
        account_json AS account,portfolio_json AS portfolio,aegis_json AS aegis,execution_json AS execution,
        known_economics_json AS "knownEconomics",unknown_economics_json AS "unknownEconomics",hard_blockers_json AS "hardBlockers",
        soft_evidence_json AS "softEvidence",provider_provenance_json AS "providerProvenance",
        jsonb_build_object('strategyVersion',strategy_version,'riskVersion',risk_version,'featureVersion',feature_version,
          'costModelVersion',cost_model_version,'regimeVersion',regime_version,'executionModelVersion',execution_model_version) AS lineage,
        content_hash AS "contentHash"
        FROM trade.candidate_point_in_time_evidence WHERE decision_time >= $1 AND decision_time < $2 ORDER BY decision_time,candidate_id`,parameters),
      this.pool.query(`SELECT so.opportunity_id AS "opportunityId",so.fusion_snapshot_id AS "fusionSnapshotId",
        so.observed_at AS "observedAt",so.underlying,so.contract_symbol AS "contractSymbol",
        so.strategy_branch AS "strategyBranch",so.ev_net AS "evNet",so.tail_adjusted_ev AS "tailAdjustedEv",
        so.return_per_capital_day AS "returnPerCapitalDay",so.capital_required AS "capitalRequired",so.uncertainty,
        so.aegis_state AS "aegisState",so.recommended_quantity AS "recommendedQuantity",
        so.execution_quality_acceptable AS "executionQualityAcceptable",so.outcome AS "decisionDisposition",
        so.wait_reason AS "waitReason",
        so.rejection_category AS "rejectionCategory",so.reasons_json AS reasons,so.policy_version AS "policyVersion",
        so.model_versions_json AS "modelVersions"
        FROM trade.shadow_opportunity so WHERE observed_at >= $1 AND observed_at < $2 ORDER BY observed_at,opportunity_id`,parameters),
      this.pool.query(`SELECT frontier_id AS "frontierId",fusion_snapshot_id AS "fusionSnapshotId",observed_at AS "observedAt",
        contract_version AS "contractVersion",strategy_version AS "strategyVersion",
        decision_authority_version AS "decisionAuthorityVersion",branches_considered_json AS "branchesConsidered",
        branches_evaluated_json AS "branchesEvaluated",selected_branch AS "selectedBranch",
        selected_candidate_ref AS "selectedCandidateId",best_rejected_candidate_ref AS "bestRejectedCandidateId",
        primary_action AS "primaryAction",selected_quantity AS "selectedQuantity",global_wait_earned AS "globalWaitEarned",
        empirical_utility_state AS "empiricalUtilityState",empirical_economics_ready AS "empiricalEconomicsReady",
        execution_authorized AS "executionAuthorized",frontier_json AS frontier,content_hash AS "contentHash",
        COALESCE((SELECT jsonb_agg(to_jsonb(branch_evidence)-'created_at' ORDER BY branch_evidence.branch)
          FROM trade.canonical_strategy_branch_evidence branch_evidence
          WHERE branch_evidence.frontier_id=canonical_strategy_frontier.frontier_id),'[]'::jsonb) AS "branchEvidence",
        COALESCE((SELECT jsonb_agg(to_jsonb(candidate_evidence)-'created_at' ORDER BY candidate_evidence.branch,candidate_evidence.candidate_ref)
          FROM trade.canonical_strategy_candidate_evidence candidate_evidence
          WHERE candidate_evidence.frontier_id=canonical_strategy_frontier.frontier_id),'[]'::jsonb) AS "candidateEvidence"
        FROM trade.canonical_strategy_frontier
        WHERE observed_at >= $1 AND observed_at < $2 ORDER BY observed_at,frontier_id`,parameters),
      this.pool.query(`SELECT mis.management_input_snapshot_id AS "managementInputSnapshotId",
        mis.fusion_snapshot_id AS "fusionSnapshotId",mis.chain_id AS "chainId",mis.observed_at AS "observedAt",
        mis.lifecycle_state AS "lifecycleState",mis.input_json AS "inputFields",mis.unknown_fields_json AS "unknownFields",
        mis.change_json AS "changeFields",mis.content_hash AS "contentHash",COALESCE(maf.actions_json,'[]'::jsonb) AS actions,
        maf.selected_action AS "selectedAction",maf.second_best_action AS "secondBestAction",
        maf.decision_state AS "decisionState",maf.policy_version AS "managementPolicyVersion",
        maf.policy_evidence_hash AS "managementPolicyEvidenceHash",
        COALESCE(maf.reason_codes_json,'[]'::jsonb) AS "reasonCodes"
        FROM trade.management_input_snapshot mis LEFT JOIN trade.management_action_frontier maf USING(management_input_snapshot_id)
        WHERE mis.observed_at >= $1 AND mis.observed_at < $2 ORDER BY mis.observed_at,mis.management_input_snapshot_id`,parameters),
      this.pool.query(`SELECT lifecycle_application_id AS "lifecycleApplicationId",evidence_key AS "evidenceKey",
        chain_id AS "chainId",event_kind AS "eventKind",provider_activity_ref_hash AS "providerActivityRefHash",
        transition_path_json AS "transitionPath",applied_at AS "appliedAt",result_hash AS "resultHash",detail_json AS detail
        FROM trade.lifecycle_application
        WHERE applied_at >= $1 AND applied_at < $2 ORDER BY applied_at,lifecycle_application_id`,parameters),
      this.pool.query(`SELECT outcome_label_id AS "outcomeLabelId",subject_type AS "subjectType",subject_id AS "subjectId",
        label_available_at AS "labelAvailableAt",label_version AS "labelVersion",censoring_state AS "censoringState",
        whole_chain_net_pnl AS "wholeChainNetPnl",managed_episode_pnl AS "managedEpisodePnl",
        return_on_secured_capital AS "returnOnSecuredCapital",return_per_capital_day AS "returnPerCapitalDay",
        max_adverse_excursion AS "maxAdverseExcursion",max_favorable_excursion AS "maxFavorableExcursion",
        recovery_duration_days AS "recoveryDurationDays",realized_execution_cost AS "realizedExecutionCost",
        outcomes_json AS outcomes,provenance_json AS provenance,content_hash AS "contentHash"
        FROM research.theta_outcome_label WHERE label_available_at >= $1 AND label_available_at < $2
        AND subject_type IN ('WHOLE_CHAIN','MANAGED_EPISODE') ORDER BY label_available_at,outcome_label_id`,parameters),
      this.pool.query(`SELECT quote_observation_id AS "quoteObservationId",candidate_id AS "candidateId",
        management_input_snapshot_id AS "managementInputSnapshotId",observation_role AS "observationRole",
        observed_at AS "observedAt",provider_timestamp AS "providerTimestamp",ingestion_timestamp AS "ingestionTimestamp",
        source,operation_alias AS "operationAlias",feed,contract_version AS "contractVersion",bid,ask,bid_size AS "bidSize",
        ask_size AS "askSize",proposed_limit AS "proposedLimit",data_quality AS "dataQuality",content_hash AS "contentHash"
        FROM market.execution_quote_observation WHERE observed_at >= $1 AND observed_at < $2
        ORDER BY observed_at,quote_observation_id`,parameters),
    ]);
    const versions = [...new Set(candidates.rows.flatMap((row) => {
      const lineage = row.lineage as Record<string, unknown> | undefined;
      return typeof lineage?.strategyVersion === 'string' ? [lineage.strategyVersion] : [];
    }))];
    const artifact = buildDatasetExport({ sourceWindow:{start:request.start,end:request.end},exportedAt:request.exportedAt,
      featureSetVersion:request.featureSetVersion,strategyVersions:versions,rows:{candidateSets:sets.rows,candidates:candidates.rows,
        shadowCandidates:shadow.rows,strategyFrontiers:frontiers.rows,managementSnapshots:management.rows,lifecycleOutcomes:lifecycle.rows,
        wholeChainOutcomes:chains.rows,executionEvidence:quotes.rows} });
    await this.pool.query(`INSERT INTO research.theta_dataset_export(dataset_export_id,source_window_start,source_window_end,
      exported_at,schema_version,feature_set_version,strategy_versions_json,row_counts_json,dataset_hash)
      VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9) ON CONFLICT(dataset_hash) DO NOTHING`,[
      randomUUID(),request.start,request.end,request.exportedAt,artifact.schemaVersion,artifact.featureSetVersion,
      JSON.stringify(artifact.strategyVersions),JSON.stringify(artifact.rowCounts),artifact.datasetHash]);
    return artifact;
  }
}
