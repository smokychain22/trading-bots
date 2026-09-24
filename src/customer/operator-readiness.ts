import type { Environment } from "../config/environment.js";
import { missingProviderVariables } from "../config/environment.js";
import { checkOptionomics, type CheckResult } from "../providers/readiness.js";
import { Pool } from "pg";
import type { RuntimeFirstPaperEvidence } from "../theta/runtime-behavior-diagnostic.js";

export type OptionomicsReadiness = {
  readonly provider: "OPTIONOMICS";
  readonly state: "CONNECTED" | "INVALID" | "MISSING" | "DEGRADED";
  readonly checked_at: string;
  readonly latency_ms: number | null;
  readonly capabilities: ReadonlyArray<{
    capability: string;
    operation_alias: string;
    state: string;
    http_status: number | null;
    observed_at: string;
  }>;
};

export function summarizeOptionomicsReadiness(
  results: readonly CheckResult[],
): OptionomicsReadiness {
  const states = results.map((result) => result.state);
  const state = states.length > 1 && states.every((item) => item === "GOOD")
    ? "CONNECTED"
    : states.some((item) => item === "INVALID")
      ? "INVALID"
      : "DEGRADED";
  return {
    provider: "OPTIONOMICS",
    state,
    checked_at: results.at(-1)?.observedAt ?? new Date().toISOString(),
    latency_ms: results.reduce<number | null>(
      (total, item) => item.latencyMs === null ? total : (total ?? 0) + item.latencyMs,
      null,
    ),
    capabilities: results.map((result) => ({
      capability: result.capability,
      operation_alias: result.operationAlias,
      state: result.state,
      http_status: result.httpStatus,
      observed_at: result.observedAt,
    })),
  };
}

export async function verifyOptionomicsConnection(
  environment: Environment,
): Promise<OptionomicsReadiness> {
  if (missingProviderVariables(environment, "OPTIONOMICS").length > 0) {
    return {
      provider: "OPTIONOMICS",
      state: "MISSING",
      checked_at: new Date().toISOString(),
      latency_ms: null,
      capabilities: [],
    };
  }
  return summarizeOptionomicsReadiness(await checkOptionomics(environment));
}

export const privatePaperBetaReadiness = (followerCount: number | null) => ({
  state: "IMPLEMENTED_CONFIGURATION_GATED" as const,
  policy_status: "PRIVATE_TEAM_PAPER_ONLY" as const,
  reason: "Private team credentials are encrypted server-side. Order submission remains locked.",
  follower_count: followerCount,
  raw_key_endpoint_available: true,
});

export interface LocalWorkerReadiness {
  readonly configured: boolean;
  readonly online: boolean;
  readonly state: string;
  readonly host_type: string|null;
  readonly runtime_mode: string|null;
  readonly build_sha: string|null;
  readonly last_heartbeat: string|null;
  readonly last_cycle_started: string|null;
  readonly last_cycle_completed: string|null;
  readonly last_reconciliation: string|null;
  readonly last_candidate_scan: string|null;
  readonly market_session: string;
  readonly alpaca_health: string;
  readonly optionomics_health: string;
  readonly database_health: string;
  readonly execution_gate: "LOCKED"|"EXTERNAL_QUOTE_BLOCKER"|"ACTIVE";
  readonly failure_reason: string|null;
}

export async function readLocalWorkerReadiness(databaseUrl?:string):Promise<LocalWorkerReadiness>{
  const unknown:LocalWorkerReadiness={configured:false,online:false,state:'NOT_INSTALLED',host_type:null,runtime_mode:null,
    build_sha:null,last_heartbeat:null,last_cycle_started:null,last_cycle_completed:null,last_reconciliation:null,
    last_candidate_scan:null,market_session:'UNKNOWN',alpaca_health:'UNKNOWN',optionomics_health:'UNKNOWN',
    database_health:databaseUrl?'UNKNOWN':'NOT_CONFIGURED',execution_gate:'EXTERNAL_QUOTE_BLOCKER',failure_reason:null};
  if(!databaseUrl)return unknown;
  const pool=new Pool({connectionString:databaseUrl,max:1,connectionTimeoutMillis:5_000});
  try{
    const exists=await pool.query(`SELECT to_regclass('ops.runtime_worker_status') IS NOT NULL AS ready`);
    if(exists.rows[0]?.ready!==true)return unknown;
    const result=await pool.query(`SELECT s.*,l.expires_at,l.worker_id AS lease_worker_id,
      (l.worker_id=s.worker_id AND l.expires_at>now() AND s.last_heartbeat>now()-interval '45 seconds') AS online
      FROM ops.runtime_worker_status s LEFT JOIN ops.runtime_worker_lease l ON l.lease_key=s.lease_key
      ORDER BY s.last_heartbeat DESC LIMIT 1`);
    const row=result.rows[0];
    if(!row)return {...unknown,configured:true,state:'OFFLINE',database_health:'GOOD'};
    const iso=(value:unknown)=>value instanceof Date?value.toISOString():value==null?null:String(value);
    return {configured:true,online:row.online===true,state:String(row.state),host_type:String(row.host_type),
      runtime_mode:String(row.runtime_mode),build_sha:String(row.build_sha),last_heartbeat:iso(row.last_heartbeat),
      last_cycle_started:iso(row.last_cycle_started),last_cycle_completed:iso(row.last_cycle_completed),
      last_reconciliation:iso(row.last_reconciliation),last_candidate_scan:iso(row.last_candidate_scan),
      market_session:String(row.market_session),alpaca_health:String(row.alpaca_health),
      optionomics_health:String(row.optionomics_health),database_health:String(row.database_health),
      execution_gate:row.execution_gate==='ACTIVE'?'ACTIVE':row.execution_gate==='EXTERNAL_QUOTE_BLOCKER'?'EXTERNAL_QUOTE_BLOCKER':'LOCKED',
      failure_reason:row.failure_reason==null?null:String(row.failure_reason)};
  }catch{return {...unknown,state:'UNAVAILABLE',database_health:'DEGRADED'};}finally{await pool.end();}
}

export interface MasterRuntimeEvidence {
  readonly last_decision: string|null;
  readonly last_decision_at: string|null;
  readonly strategy_branch: string|null;
  readonly last_snapshot: string|null;
  readonly candidates_evaluated: number|null;
  readonly open_positions: number|null;
  readonly pending_orders: number|null;
  readonly external_or_unknown_count: number|null;
  readonly entry_blocking_fact_count: number|null;
  readonly local_only_intent_count: number|null;
  readonly broker_orders: number|null;
  readonly broker_fills: number|null;
  readonly open_chains: number|null;
  readonly option_realized_pnl: number|null;
  readonly stock_realized_pnl: number|null;
  readonly whole_chain_pnl: number|null;
}

export async function readMasterRuntimeEvidence(databaseUrl?:string):Promise<MasterRuntimeEvidence>{
  const empty:MasterRuntimeEvidence={last_decision:null,last_decision_at:null,strategy_branch:null,last_snapshot:null,
    candidates_evaluated:null,open_positions:null,pending_orders:null,external_or_unknown_count:null,
    entry_blocking_fact_count:null,
    local_only_intent_count:null,broker_orders:null,broker_fills:null,open_chains:null,
    option_realized_pnl:null,stock_realized_pnl:null,whole_chain_pnl:null};
  if(!databaseUrl)return empty;
  const pool=new Pool({connectionString:databaseUrl,max:1,connectionTimeoutMillis:5_000});
  try{
    const result=await pool.query(`WITH latest_decision AS (
        SELECT action_code,decided_at,strategy_branch,fusion_snapshot_id
        FROM trade.decision ORDER BY decided_at DESC LIMIT 1
      ), latest_set AS (
        SELECT candidate_count FROM trade.candidate_set ORDER BY generated_at DESC LIMIT 1
      ), latest_reconciliation AS (
        SELECT position_count,open_order_count,external_or_unknown_count,detail_json
        FROM trade.broker_reconciliation_snapshot ORDER BY observed_at DESC LIMIT 1
      ), economics AS (
        SELECT
          (SELECT sum(realized_pnl) FROM trade.option_leg WHERE realized_pnl IS NOT NULL) AS option_realized,
          (SELECT sum(realized_pnl) FROM trade.stock_lot WHERE realized_pnl IS NOT NULL) AS stock_realized,
          (SELECT sum(amount) FROM trade.fee_event) AS fees
      ) SELECT
        (SELECT action_code FROM latest_decision) AS last_decision,
        (SELECT decided_at FROM latest_decision) AS last_decision_at,
        (SELECT strategy_branch FROM latest_decision) AS strategy_branch,
        (SELECT fusion_snapshot_id FROM latest_decision) AS last_snapshot,
        (SELECT candidate_count FROM latest_set) AS candidates_evaluated,
        (SELECT position_count FROM latest_reconciliation) AS open_positions,
        (SELECT open_order_count FROM latest_reconciliation) AS pending_orders,
        (SELECT external_or_unknown_count FROM latest_reconciliation) AS external_or_unknown_count,
        (SELECT CASE
          WHEN detail_json #>> '{brokerFactImpactSummary,entryBlockingFactCount}' ~ '^[0-9]+$'
          THEN (detail_json #>> '{brokerFactImpactSummary,entryBlockingFactCount}')::int
          ELSE NULL END FROM latest_reconciliation) AS entry_blocking_fact_count,
        (SELECT detail_json->>'localOnlyIntentCount' FROM latest_reconciliation) AS local_only_intent_count,
        (SELECT count(*)::int FROM trade.broker_order) AS broker_orders,
        (SELECT count(*)::int FROM trade.fill) AS broker_fills,
        (SELECT count(*)::int FROM trade.economic_chain WHERE closed_at IS NULL) AS open_chains,
        economics.option_realized,economics.stock_realized,economics.fees
      FROM economics`);
    const row=result.rows[0]??{};
    const iso=(value:unknown)=>value instanceof Date?value.toISOString():value==null?null:String(value);
    const number=(value:unknown):number|null=>value==null?null:Number(value);
    const optionPnl=number(row.option_realized);const stockPnl=number(row.stock_realized);const fees=number(row.fees);
    const openChains=Number(row.open_chains??0);
    const hasResolvedEconomics=optionPnl!==null||stockPnl!==null||fees!==null;
    return {last_decision:row.last_decision==null?null:String(row.last_decision),last_decision_at:iso(row.last_decision_at),
      strategy_branch:row.strategy_branch==null?null:String(row.strategy_branch),last_snapshot:row.last_snapshot==null?null:String(row.last_snapshot),
      candidates_evaluated:number(row.candidates_evaluated),open_positions:number(row.open_positions),pending_orders:number(row.pending_orders),
      external_or_unknown_count:number(row.external_or_unknown_count),
      entry_blocking_fact_count:number(row.entry_blocking_fact_count),
      local_only_intent_count:number(row.local_only_intent_count),
      broker_orders:Number(row.broker_orders??0),broker_fills:Number(row.broker_fills??0),open_chains:openChains,
      option_realized_pnl:optionPnl,stock_realized_pnl:stockPnl,
      whole_chain_pnl:hasResolvedEconomics&&openChains===0?(optionPnl??0)+(stockPnl??0)-(fees??0):null};
  }catch{return empty;}finally{await pool.end();}
}

export interface OutcomeResearchVisibility {
  readonly pending_labels:number|null;readonly resolved_labels:number|null;readonly unresolved_receipts:number|null;
  readonly invalid_receipts:number|null;readonly whole_chains_resolved:number|null;readonly management_labels:number|null;
  readonly wait_labels:number|null;readonly counterfactual_labels:number|null;readonly modeled_labels:number|null;
  readonly broker_actual_labels:number|null;readonly policy_evaluation_readiness:'NOT_EVALUABLE'|'INSUFFICIENT_SAMPLE'|'EVALUABLE'|'UNKNOWN';
}
export async function readOutcomeResearchVisibility(databaseUrl?:string):Promise<OutcomeResearchVisibility>{
  const empty:OutcomeResearchVisibility={pending_labels:null,resolved_labels:null,unresolved_receipts:null,invalid_receipts:null,
    whole_chains_resolved:null,management_labels:null,wait_labels:null,counterfactual_labels:null,modeled_labels:null,
    broker_actual_labels:null,policy_evaluation_readiness:'UNKNOWN'};
  if(!databaseUrl)return empty;
  const pool=new Pool({connectionString:databaseUrl,max:1,connectionTimeoutMillis:5_000});
  try{
    const exists=await pool.query(`SELECT to_regclass('research.theta_resolved_outcome_label') IS NOT NULL AS ready`);
    if(exists.rows[0]?.ready!==true)return empty;
    const result=await pool.query(`SELECT
      (SELECT count(*)::int FROM research.theta_outcome_subject s WHERE NOT EXISTS(
        SELECT 1 FROM research.theta_resolved_outcome_label l WHERE l.outcome_subject_id=s.outcome_subject_id)) AS pending_labels,
      (SELECT count(*)::int FROM research.theta_resolved_outcome_label) AS resolved_labels,
      (SELECT count(*)::int FROM research.theta_outcome_resolution_receipt WHERE resolution_state='UNRESOLVED') AS unresolved_receipts,
      (SELECT count(*)::int FROM research.theta_outcome_resolution_receipt WHERE resolution_state='INVALID') AS invalid_receipts,
      (SELECT count(*)::int FROM research.theta_outcome_label WHERE subject_type='WHOLE_CHAIN' AND censoring_state='RESOLVED') AS whole_chains_resolved,
      (SELECT count(*)::int FROM research.theta_resolved_outcome_label WHERE label_type IN
        ('MANAGEMENT_ACTION_OUTCOME','MANAGEMENT_ALTERNATIVE_OUTCOME')) AS management_labels,
      (SELECT count(*)::int FROM research.theta_resolved_outcome_label WHERE label_type='WAIT_OUTCOME') AS wait_labels,
      (SELECT count(*)::int FROM research.theta_resolved_outcome_label WHERE label_type IN
        ('NEIGHBOR_STRIKE_OUTCOME','OTHER_EXPIRATION_OUTCOME','OTHER_STRUCTURE_OUTCOME')) AS counterfactual_labels,
      (SELECT count(*)::int FROM research.theta_resolved_outcome_label WHERE provenance_class='MODELED_RESEARCH') AS modeled_labels,
      (SELECT count(*)::int FROM research.theta_resolved_outcome_label WHERE provenance_class='BROKER_ACTUAL') AS broker_actual_labels,
      (SELECT state FROM research.theta_policy_challenger_evaluation ORDER BY created_at DESC LIMIT 1) AS policy_state`);
    const row=result.rows[0]??{},number=(value:unknown)=>Number(value??0);
    return {pending_labels:number(row.pending_labels),resolved_labels:number(row.resolved_labels),
      unresolved_receipts:number(row.unresolved_receipts),invalid_receipts:number(row.invalid_receipts),
      whole_chains_resolved:number(row.whole_chains_resolved),management_labels:number(row.management_labels),
      wait_labels:number(row.wait_labels),counterfactual_labels:number(row.counterfactual_labels),modeled_labels:number(row.modeled_labels),
      broker_actual_labels:number(row.broker_actual_labels),policy_evaluation_readiness:row.policy_state==='EVALUABLE'?'EVALUABLE':
        row.policy_state==='INSUFFICIENT_SAMPLE'?'INSUFFICIENT_SAMPLE':row.policy_state==='NOT_EVALUABLE'?'NOT_EVALUABLE':'NOT_EVALUABLE'};
  }catch{return empty;}finally{await pool.end();}
}

export interface RuntimeBehaviorEvidence {
  readonly scan_id:string|null;
  readonly decision_ids:readonly string[];
  readonly observed_at:string|null;
  readonly session:string;
  readonly universe_size:number|null;
  readonly strategies_considered:number|null;
  readonly strategies_applicable:number|null;
  readonly strategies_rejected:number|null;
  readonly strategy_diagnostics:readonly unknown[];
  readonly wait_classification:string;
  readonly overtrading_state:string;
  readonly consecutive_wait_cycles:number|null;
  readonly seconds_since_last_broker_action:number|null;
  readonly candidate_count:number|null;
  readonly feasible_candidate_count:number|null;
  readonly selected_candidate_count:number|null;
  readonly hard_rejected_count:number|null;
  readonly soft_ranked_count:number|null;
  readonly data_insufficient_count:number|null;
  readonly quantity_zero_count:number|null;
  readonly aegis_veto_count:number|null;
  readonly near_miss_count:number|null;
  readonly action_plans_ready:number|null;
  readonly soft_economic_rejection_count:number|null;
  readonly data_unknown_rejection_count:number|null;
  readonly quote_rejection_count:number|null;
  readonly liquidity_rejection_count:number|null;
  readonly final_action:string;
  readonly wait_reasons:readonly string[];
  readonly best_rejected_candidates:readonly unknown[];
  readonly anti_paralysis_findings:readonly string[];
  readonly threshold_policy_state:string;
  readonly first_paper_evidence:RuntimeFirstPaperEvidence|null;
}

export async function readLatestRuntimeBehavior(databaseUrl?:string):Promise<RuntimeBehaviorEvidence>{
  const empty:RuntimeBehaviorEvidence={scan_id:null,decision_ids:[],observed_at:null,session:'UNKNOWN',universe_size:null,
    strategies_considered:null,strategies_applicable:null,strategies_rejected:null,strategy_diagnostics:[],
    wait_classification:'UNKNOWN',overtrading_state:'UNKNOWN',
    consecutive_wait_cycles:null,seconds_since_last_broker_action:null,candidate_count:null,feasible_candidate_count:null,
    selected_candidate_count:null,hard_rejected_count:null,soft_ranked_count:null,data_insufficient_count:null,
    quantity_zero_count:null,aegis_veto_count:null,near_miss_count:null,action_plans_ready:null,
    soft_economic_rejection_count:null,data_unknown_rejection_count:null,quote_rejection_count:null,
    liquidity_rejection_count:null,final_action:'UNKNOWN',wait_reasons:[],best_rejected_candidates:[],anti_paralysis_findings:[],
    threshold_policy_state:'UNKNOWN',first_paper_evidence:null};
  if(!databaseUrl)return empty;
  const pool=new Pool({connectionString:databaseUrl,max:1,connectionTimeoutMillis:5_000});
  try{
    const relation=await pool.query(`SELECT to_regclass('research.theta_runtime_behavior_diagnostic') IS NOT NULL AS ready`);
    if(relation.rows[0]?.ready!==true)return empty;
    const result=await pool.query(`SELECT scan_id,observed_at,wait_classification,overtrading_state,consecutive_wait_cycles,
      seconds_since_last_broker_action,candidate_count,feasible_candidate_count,selected_candidate_count,
      hard_rejected_count,soft_ranked_count,data_insufficient_count,quantity_zero_count,aegis_veto_count,
      near_miss_count,action_plans_ready,threshold_policy_state,diagnostic_json
      FROM research.theta_runtime_behavior_diagnostic ORDER BY observed_at DESC,created_at DESC LIMIT 1`);
    const row=result.rows[0];
    if(!row)return empty;
    const number=(value:unknown):number|null=>value==null?null:Number(value);
    const diagnostic=row.diagnostic_json!==null&&typeof row.diagnostic_json==='object'?row.diagnostic_json as Record<string,unknown>:{};
    const strings=(value:unknown):readonly string[]=>Array.isArray(value)?value.filter((item):item is string=>typeof item==='string'):[];
    const array=(value:unknown):readonly unknown[]=>Array.isArray(value)?value:[];
    return {scan_id:String(row.scan_id),decision_ids:strings(diagnostic.decisionIds),
      observed_at:row.observed_at instanceof Date?row.observed_at.toISOString():String(row.observed_at),
      session:typeof diagnostic.session==='string'?diagnostic.session:'UNKNOWN',universe_size:number(diagnostic.universeSize),
      strategies_considered:number(diagnostic.strategiesConsidered),strategies_applicable:number(diagnostic.strategiesApplicable),
      strategies_rejected:number(diagnostic.strategiesRejected),strategy_diagnostics:array(diagnostic.strategyDiagnostics),
      wait_classification:String(row.wait_classification),overtrading_state:String(row.overtrading_state),
      consecutive_wait_cycles:number(row.consecutive_wait_cycles),seconds_since_last_broker_action:number(row.seconds_since_last_broker_action),
      candidate_count:number(row.candidate_count),feasible_candidate_count:number(row.feasible_candidate_count),
      selected_candidate_count:number(row.selected_candidate_count),hard_rejected_count:number(row.hard_rejected_count),
      soft_ranked_count:number(row.soft_ranked_count),data_insufficient_count:number(row.data_insufficient_count),
      quantity_zero_count:number(row.quantity_zero_count),aegis_veto_count:number(row.aegis_veto_count),
      near_miss_count:number(row.near_miss_count),action_plans_ready:number(row.action_plans_ready),
      soft_economic_rejection_count:number(diagnostic.softEconomicRejectionCount),
      data_unknown_rejection_count:number(diagnostic.dataUnknownRejectionCount),
      quote_rejection_count:number(diagnostic.quoteRejectionCount),liquidity_rejection_count:number(diagnostic.liquidityRejectionCount),
      final_action:typeof diagnostic.finalAction==='string'?diagnostic.finalAction:'UNKNOWN',wait_reasons:strings(diagnostic.waitReasons),
      best_rejected_candidates:array(diagnostic.bestRejectedCandidates),anti_paralysis_findings:strings(diagnostic.antiParalysisFindings),
      threshold_policy_state:String(row.threshold_policy_state),
      first_paper_evidence:parseRuntimeFirstPaperEvidence(diagnostic.firstPaperEvidence)};
  }catch{return empty;}finally{await pool.end();}
}

function parseRuntimeFirstPaperEvidence(value:unknown):RuntimeFirstPaperEvidence|null {
  if(value===null||typeof value!=='object'||Array.isArray(value))return null;
  const evidence=value as Record<string,unknown>;
  if(evidence.version!=='theta-first-paper-runtime-evidence-v1'||evidence.brokerMutationSurface!==false
    ||!Array.isArray(evidence.symbols))return null;
  const record=(item:unknown):item is Record<string,unknown>=>item!==null&&typeof item==='object'&&!Array.isArray(item);
  const strings=(item:unknown):boolean=>Array.isArray(item)&&item.every((entry)=>typeof entry==='string');
  const nullableString=(item:unknown):boolean=>item===null||typeof item==='string';
  const nullableBoolean=(item:unknown):boolean=>item===null||typeof item==='boolean';
  const valid=evidence.symbols.every((item)=>{
    if(!record(item)||typeof item.symbol!=='string'||!['COMPLETED','FAILED'].includes(String(item.cycleState))
      ||!nullableString(item.cycleErrorCode)||!nullableBoolean(item.optionChainComplete)
      ||!nullableBoolean(item.optionContractsComplete)||!Number.isSafeInteger(item.qLatticeTotal)
      ||!nullableString(item.qDecision)||!strings(item.qReasonCodes)||!nullableString(item.selectedCandidateId)
      ||!nullableString(item.selectedOptionSymbol)||!nullableString(item.canonicalAction)
      ||!Number.isSafeInteger(item.selectedQuantity)||!nullableString(item.aegisState)
      ||!strings(item.cycleBlockers))return false;
    if(item.entrySafetyPolicy!==null&&(!record(item.entrySafetyPolicy)
      ||!['BLOCK','CLEAR'].includes(String(item.entrySafetyPolicy.action))
      ||typeof item.entrySafetyPolicy.companyEventState!=='string'
      ||typeof item.entrySafetyPolicy.corporateActionState!=='string'
      ||typeof item.entrySafetyPolicy.decisionAsOf!=='string'))return false;
    if(item.runtimeTelemetry!==null&&(!record(item.runtimeTelemetry)
      ||item.runtimeTelemetry.version!=='theta-first-paper-runtime-telemetry-v1'
      ||!Number.isSafeInteger(item.runtimeTelemetry.positiveSizeCandidateCount)
      ||!record(item.runtimeTelemetry.bindingConstraintCounts)
      ||!record(item.runtimeTelemetry.finalistRefresh)))return false;
    if(item.preSubmit!==null&&(!record(item.preSubmit)||!['BLOCKED','READY'].includes(String(item.preSubmit.planState))
      ||!strings(item.preSubmit.planBlockers)||typeof item.preSubmit.preSubmitState!=='string'
      ||!strings(item.preSubmit.preSubmitBlockers)||item.preSubmit.brokerMutationSurface!==false))return false;
    return true;
  });
  if(!valid)return null;
  return value as RuntimeFirstPaperEvidence;
}

export interface P2FOperatorStatus {readonly optionomics:{readonly secret_state:string;readonly last_check:string|null;
  readonly qualified_capabilities:number|null;readonly blocked_capabilities:number|null;readonly real_payload_count:number|null;
  readonly stale_capability_count:number|null;readonly latest_receipt_hash:string|null};readonly alerts:readonly {type:string;severity:string;
  first_seen:string;last_seen:string;count:number;state:string;source:string;related_ref:string|null}[];}
export async function readP2FOperatorStatus(databaseUrl?:string):Promise<P2FOperatorStatus>{
  const empty:P2FOperatorStatus={optionomics:{secret_state:'NOT_CONFIGURED',last_check:null,qualified_capabilities:null,
    blocked_capabilities:null,real_payload_count:null,stale_capability_count:null,latest_receipt_hash:null},alerts:[]};
  if(!databaseUrl)return empty;const pool=new Pool({connectionString:databaseUrl,max:1,connectionTimeoutMillis:5_000});
  try{const relation=await pool.query(`SELECT to_regclass('research.optionomics_provider_qualification_receipt') IS NOT NULL AS ready`);
    if(relation.rows[0]?.ready!==true)return empty;
    const [q,a]=await Promise.all([pool.query(`SELECT secret_state,attempted_at,real_payload_count,stale_capability_count,evidence_hash,
      (SELECT count(*) FROM jsonb_array_elements(families_json) f WHERE f->>'state'='QUALIFIED') AS qualified,
      (SELECT count(*) FROM jsonb_array_elements(families_json) f WHERE f->>'state' IN ('BLOCKED','INVALID','UNKNOWN')) AS blocked
      FROM research.optionomics_provider_qualification_receipt ORDER BY attempted_at DESC LIMIT 1`),
      pool.query(`SELECT event_type,severity,first_seen_at,last_seen_at,occurrence_count,state,source,related_ref
        FROM ops.theta_alert_event WHERE state='ACTIVE' ORDER BY CASE severity WHEN 'CRITICAL' THEN 1 WHEN 'WARNING' THEN 2 ELSE 3 END,last_seen_at DESC LIMIT 50`)]);
    const row=q.rows[0];const iso=(v:unknown)=>v instanceof Date?v.toISOString():v==null?null:String(v);
    return {optionomics:row?{secret_state:String(row.secret_state),last_check:iso(row.attempted_at),qualified_capabilities:Number(row.qualified),
      blocked_capabilities:Number(row.blocked),real_payload_count:Number(row.real_payload_count),stale_capability_count:Number(row.stale_capability_count),
      latest_receipt_hash:String(row.evidence_hash)}:empty.optionomics,alerts:a.rows.map((x)=>({type:String(x.event_type),severity:String(x.severity),
        first_seen:iso(x.first_seen_at)??'UNKNOWN',last_seen:iso(x.last_seen_at)??'UNKNOWN',count:Number(x.occurrence_count),state:String(x.state),source:String(x.source),
        related_ref:x.related_ref==null?null:String(x.related_ref)}))};
  }catch{return empty;}finally{await pool.end();}
}

export interface P2GOperatorStatus {readonly simulation:{state:'COMPLETE'|'MISSING';scenario_id:string|null;terminal_state:string|null;
  whole_chain_net_pnl:number|null;capital_days:number|null;receipt_hash:string|null};readonly dry_run:{state:'DRY_RUN_READY'|'DRY_RUN_BLOCKED'|'MISSING';
  blocker_codes:readonly string[];previewed_at:string|null;receipt_hash:string|null};readonly provider_families:readonly {family:string;status:string;
  qualified:boolean;sample_count:number;missing_field_count:number;stale_count:number;last_observed:string}[];
  readonly hold:{state:string;observed_at:string|null};readonly alert_history:readonly {type:string;severity:string;state:string;
  transition:string;first_seen:string;last_seen:string;count:number;source:string;related_ref:string|null}[];}
export async function readP2GOperatorStatus(databaseUrl?:string):Promise<P2GOperatorStatus>{
  const empty:P2GOperatorStatus={simulation:{state:'MISSING',scenario_id:null,terminal_state:null,whole_chain_net_pnl:null,
    capital_days:null,receipt_hash:null},dry_run:{state:'MISSING',blocker_codes:[],previewed_at:null,receipt_hash:null},
    provider_families:[],hold:{state:'HOLD_UNKNOWN',observed_at:null},alert_history:[]};
  if(!databaseUrl)return empty;const pool=new Pool({connectionString:databaseUrl,max:1,connectionTimeoutMillis:5_000});
  try{const relation=await pool.query(`SELECT to_regclass('research.theta_synthetic_lifecycle_receipt') IS NOT NULL AS ready`);
    if(relation.rows[0]?.ready!==true)return empty;
    const [simulation,preview,families,hold,alerts]=await Promise.all([
      pool.query(`SELECT scenario_id,terminal_state,whole_chain_net_pnl,capital_days,content_hash FROM research.theta_synthetic_lifecycle_receipt ORDER BY simulated_at DESC LIMIT 1`),
      pool.query(`SELECT result,blocker_codes,previewed_at,receipt_hash FROM research.theta_paper_order_preview_receipt ORDER BY previewed_at DESC LIMIT 1`),
      pool.query(`SELECT DISTINCT ON(family) family,status,qualified,sample_count,missing_field_count,stale_count,observed_at
        FROM research.optionomics_family_health_observation ORDER BY family,observed_at DESC`),
      pool.query(`SELECT hold_evidence_state,observed_at FROM research.theta_action_inaction_frontier ORDER BY observed_at DESC LIMIT 1`),
      pool.query(`SELECT event_type,severity,state,COALESCE(evidence_json->>'lifecycleTransition','UNKNOWN') AS transition,
        first_seen_at,last_seen_at,occurrence_count,source,related_ref FROM ops.theta_alert_event ORDER BY last_seen_at DESC LIMIT 50`)]);
    const iso=(value:unknown)=>value instanceof Date?value.toISOString():value==null?null:String(value),s=simulation.rows[0],p=preview.rows[0],h=hold.rows[0];
    return {simulation:s?{state:'COMPLETE',scenario_id:String(s.scenario_id),terminal_state:String(s.terminal_state),
      whole_chain_net_pnl:Number(s.whole_chain_net_pnl),capital_days:Number(s.capital_days),receipt_hash:String(s.content_hash)}:empty.simulation,
    dry_run:p?{state:p.result,blocker_codes:Array.isArray(p.blocker_codes)?p.blocker_codes.map(String):[],previewed_at:iso(p.previewed_at),receipt_hash:String(p.receipt_hash)}:empty.dry_run,
    provider_families:families.rows.map((row)=>({family:String(row.family),status:String(row.status),qualified:row.qualified===true,
      sample_count:Number(row.sample_count),missing_field_count:Number(row.missing_field_count),stale_count:Number(row.stale_count),last_observed:iso(row.observed_at)??'UNKNOWN'})),
    hold:h?{state:String(h.hold_evidence_state),observed_at:iso(h.observed_at)}:empty.hold,
    alert_history:alerts.rows.map((row)=>({type:String(row.event_type),severity:String(row.severity),state:String(row.state),
      transition:String(row.transition),first_seen:iso(row.first_seen_at)??'UNKNOWN',last_seen:iso(row.last_seen_at)??'UNKNOWN',
      count:Number(row.occurrence_count),source:String(row.source),related_ref:row.related_ref==null?null:String(row.related_ref)}))};
  }catch{return empty;}finally{await pool.end();}
}
