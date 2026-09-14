import type { Environment } from "../config/environment.js";
import { missingProviderVariables } from "../config/environment.js";
import { checkOptionomics, type CheckResult } from "../providers/readiness.js";
import { Pool } from "pg";

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
  readonly broker_orders: number|null;
  readonly broker_fills: number|null;
  readonly open_chains: number|null;
  readonly option_realized_pnl: number|null;
  readonly stock_realized_pnl: number|null;
  readonly whole_chain_pnl: number|null;
}

export async function readMasterRuntimeEvidence(databaseUrl?:string):Promise<MasterRuntimeEvidence>{
  const empty:MasterRuntimeEvidence={last_decision:null,last_decision_at:null,strategy_branch:null,last_snapshot:null,
    candidates_evaluated:null,open_positions:null,pending_orders:null,broker_orders:null,broker_fills:null,open_chains:null,
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
        SELECT position_count,open_order_count FROM trade.broker_reconciliation_snapshot ORDER BY observed_at DESC LIMIT 1
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
      broker_orders:Number(row.broker_orders??0),broker_fills:Number(row.broker_fills??0),open_chains:openChains,
      option_realized_pnl:optionPnl,stock_realized_pnl:stockPnl,
      whole_chain_pnl:hasResolvedEconomics&&openChains===0?(optionPnl??0)+(stockPnl??0)-(fees??0):null};
  }catch{return empty;}finally{await pool.end();}
}

export interface RuntimeBehaviorEvidence {
  readonly observed_at:string|null;
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
  readonly threshold_policy_state:string;
}

export async function readLatestRuntimeBehavior(databaseUrl?:string):Promise<RuntimeBehaviorEvidence>{
  const empty:RuntimeBehaviorEvidence={observed_at:null,wait_classification:'UNKNOWN',overtrading_state:'UNKNOWN',
    consecutive_wait_cycles:null,seconds_since_last_broker_action:null,candidate_count:null,feasible_candidate_count:null,
    selected_candidate_count:null,hard_rejected_count:null,soft_ranked_count:null,data_insufficient_count:null,
    quantity_zero_count:null,aegis_veto_count:null,near_miss_count:null,action_plans_ready:null,threshold_policy_state:'UNKNOWN'};
  if(!databaseUrl)return empty;
  const pool=new Pool({connectionString:databaseUrl,max:1,connectionTimeoutMillis:5_000});
  try{
    const relation=await pool.query(`SELECT to_regclass('research.theta_runtime_behavior_diagnostic') IS NOT NULL AS ready`);
    if(relation.rows[0]?.ready!==true)return empty;
    const result=await pool.query(`SELECT observed_at,wait_classification,overtrading_state,consecutive_wait_cycles,
      seconds_since_last_broker_action,candidate_count,feasible_candidate_count,selected_candidate_count,
      hard_rejected_count,soft_ranked_count,data_insufficient_count,quantity_zero_count,aegis_veto_count,
      near_miss_count,action_plans_ready,threshold_policy_state
      FROM research.theta_runtime_behavior_diagnostic ORDER BY observed_at DESC,created_at DESC LIMIT 1`);
    const row=result.rows[0];
    if(!row)return empty;
    const number=(value:unknown):number|null=>value==null?null:Number(value);
    return {observed_at:row.observed_at instanceof Date?row.observed_at.toISOString():String(row.observed_at),
      wait_classification:String(row.wait_classification),overtrading_state:String(row.overtrading_state),
      consecutive_wait_cycles:number(row.consecutive_wait_cycles),seconds_since_last_broker_action:number(row.seconds_since_last_broker_action),
      candidate_count:number(row.candidate_count),feasible_candidate_count:number(row.feasible_candidate_count),
      selected_candidate_count:number(row.selected_candidate_count),hard_rejected_count:number(row.hard_rejected_count),
      soft_ranked_count:number(row.soft_ranked_count),data_insufficient_count:number(row.data_insufficient_count),
      quantity_zero_count:number(row.quantity_zero_count),aegis_veto_count:number(row.aegis_veto_count),
      near_miss_count:number(row.near_miss_count),action_plans_ready:number(row.action_plans_ready),
      threshold_policy_state:String(row.threshold_policy_state)};
  }catch{return empty;}finally{await pool.end();}
}
