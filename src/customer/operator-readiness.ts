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
  readonly execution_gate: "LOCKED";
  readonly failure_reason: string|null;
}

export async function readLocalWorkerReadiness(databaseUrl?:string):Promise<LocalWorkerReadiness>{
  const unknown:LocalWorkerReadiness={configured:false,online:false,state:'NOT_INSTALLED',host_type:null,runtime_mode:null,
    build_sha:null,last_heartbeat:null,last_cycle_started:null,last_cycle_completed:null,last_reconciliation:null,
    last_candidate_scan:null,market_session:'UNKNOWN',alpaca_health:'UNKNOWN',optionomics_health:'UNKNOWN',
    database_health:databaseUrl?'UNKNOWN':'NOT_CONFIGURED',execution_gate:'LOCKED',failure_reason:null};
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
      execution_gate:'LOCKED',failure_reason:row.failure_reason==null?null:String(row.failure_reason)};
  }catch{return {...unknown,state:'UNAVAILABLE',database_health:'DEGRADED'};}finally{await pool.end();}
}
