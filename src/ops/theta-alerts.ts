import { createHash,randomUUID } from 'node:crypto';
import type { Pool } from 'pg';

export type ThetaAlertSeverity='INFO'|'WARNING'|'CRITICAL';
export type ThetaAlertType='WORKER_OFFLINE'|'BROKER_RECONCILIATION_MISMATCH'|'BROKER_ACCOUNT_INACTIVE'|
  'PROVIDER_AUTH_FAILURE'|'PROVIDER_RATE_LIMITED'|'PROVIDER_STALE'|'EXECUTION_QUOTE_UNAVAILABLE'|'EXECUTION_QUOTE_STALE'|
  'DECISION_STALE'|'POSITION_EXPIRY_IMMINENT'|'ASSIGNMENT_DETECTED'|'CALL_AWAY_DETECTED'|'UNEXPECTED_POSITION'|
  'WAIT_PARALYSIS_SUSPECT'|'HOLD_PARALYSIS_SUSPECT'|'OVERTRADING_SUSPECT'|'EMERGENCY_LOCK_SET'|
  'EMERGENCY_LOCK_CLEAR_ATTEMPT'|'EXECUTION_GATE_CHANGED'|'STRATEGY_VERSION_MISMATCH';
export interface ThetaAlert {readonly identity:string;readonly type:ThetaAlertType;readonly severity:ThetaAlertSeverity;
  readonly source:string;readonly firstSeenAt:string;readonly lastSeenAt:string;readonly occurrenceCount:number;
  readonly state:'ACTIVE'|'RESOLVED';readonly relatedRef:string|null;readonly evidence:Readonly<Record<string,unknown>>;}
const canonical=(value:unknown)=>JSON.stringify(value,(_key,item)=>item!==null&&typeof item==='object'&&!Array.isArray(item)
  ?Object.fromEntries(Object.entries(item as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b))):item);
export function mergeAlert(previous:ThetaAlert|null,input:Omit<ThetaAlert,'firstSeenAt'|'occurrenceCount'>):ThetaAlert{
  if(previous!==null&&previous.identity===input.identity&&previous.state==='ACTIVE'&&input.state==='ACTIVE')
    return {...input,firstSeenAt:previous.firstSeenAt,occurrenceCount:previous.occurrenceCount+1};
  return {...input,firstSeenAt:input.lastSeenAt,occurrenceCount:1};
}
export async function persistAlert(pool:Pool,alert:ThetaAlert):Promise<void>{
  const hash=createHash('sha256').update(canonical(alert)).digest('hex');
  await pool.query(`INSERT INTO ops.theta_alert_event(alert_event_id,alert_identity,event_type,severity,source,first_seen_at,
    last_seen_at,occurrence_count,state,related_ref,evidence_json,content_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12)
    ON CONFLICT(content_hash) DO NOTHING`,[randomUUID(),alert.identity,alert.type,alert.severity,alert.source,alert.firstSeenAt,
    alert.lastSeenAt,alert.occurrenceCount,alert.state,alert.relatedRef,JSON.stringify(alert.evidence),hash]);
}
