import { createHash,randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { canonicalJson } from '../research/point-in-time-evidence.js';

export type DecisionTriggerType = 'SCHEDULED'|'BROKER_FILL'|'PARTIAL_FILL'|'ORDER_STATE_CHANGE'|'ASSIGNMENT_EXPIRY'|
  'QUOTE_CHANGE'|'PORTFOLIO_RISK_CHANGE'|'EVENT_STATE_CHANGE'|'PROVIDER_RECOVERY';
export interface DecisionTrigger {
  readonly triggerType:DecisionTriggerType; readonly correlationKey:string; readonly observedAt:string;
  readonly sourceEvent:Readonly<Record<string,unknown>>; readonly strategyVersion:string;
  readonly payload:Readonly<Record<string,unknown>>;
}

export function debounceBucket(observedAt:string,windowMs:number):string {
  if (!Number.isInteger(windowMs)||windowMs<=0) throw new Error('DEBOUNCE_WINDOW_INVALID');
  const time=Date.parse(observedAt); if (!Number.isFinite(time)) throw new Error('TRIGGER_TIME_INVALID');
  return new Date(Math.floor(time/windowMs)*windowMs).toISOString();
}

export class PostgresDecisionTriggerStore {
  constructor(private readonly pool:Pool,private readonly windowMs=5_000) {}
  async record(input:DecisionTrigger):Promise<boolean> {
    const sourceHash=createHash('sha256').update(canonicalJson(input.sourceEvent)).digest('hex');
    const result=await this.pool.query(`INSERT INTO ops.decision_trigger_evidence(decision_trigger_id,trigger_type,
      correlation_key,debounce_bucket,observed_at,source_event_hash,strategy_version,trigger_payload_json)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb) ON CONFLICT(trigger_type,correlation_key,debounce_bucket,source_event_hash)
      DO NOTHING RETURNING decision_trigger_id`,[randomUUID(),input.triggerType,input.correlationKey,
      debounceBucket(input.observedAt,this.windowMs),input.observedAt,sourceHash,input.strategyVersion,JSON.stringify(input.payload)]);
    return result.rowCount===1;
  }
}
