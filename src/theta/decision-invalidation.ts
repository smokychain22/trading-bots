import { createHash,randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { canonicalJson } from '../research/point-in-time-evidence.js';

export type InvalidationFact = 'SPOT_MOVE'|'GREEKS_CHANGE'|'IV_SHOCK'|'EVENT_APPROACH'|'EX_DIVIDEND_APPROACH'|
  'BBO_DETERIORATION'|'OWNERSHIP_DETERIORATION'|'PORTFOLIO_BREACH'|'ASSIGNMENT_STATE_TRANSITION'|
  'SUPERIOR_REDEPLOYMENT_CANDIDATE';
export interface InvalidationTrigger {
  readonly fact:InvalidationFact; readonly state:'CONFIGURED'|'UNKNOWN'; readonly strategyVersion:string;
  readonly rule:Readonly<Record<string,unknown>>|null;
}

export function buildInvalidationSnapshot(strategyVersion:string,
  versionedRules:Readonly<Partial<Record<InvalidationFact,Readonly<Record<string,unknown>>>>>) : readonly InvalidationTrigger[] {
  const facts:readonly InvalidationFact[]=['SPOT_MOVE','GREEKS_CHANGE','IV_SHOCK','EVENT_APPROACH','EX_DIVIDEND_APPROACH',
    'BBO_DETERIORATION','OWNERSHIP_DETERIORATION','PORTFOLIO_BREACH','ASSIGNMENT_STATE_TRANSITION','SUPERIOR_REDEPLOYMENT_CANDIDATE'];
  return facts.map((fact) => ({ fact,state:versionedRules[fact]===undefined?'UNKNOWN':'CONFIGURED',
    strategyVersion,rule:versionedRules[fact] ?? null }));
}

export class PostgresDecisionInvalidationStore {
  constructor(private readonly pool:Pool) {}
  async save(input:{decisionId:string|null;managementInputSnapshotId:string|null;strategyVersion:string;
    observedAt:string;triggers:readonly InvalidationTrigger[]}):Promise<void> {
    if (input.decisionId===null&&input.managementInputSnapshotId===null) throw new Error('INVALIDATION_SUBJECT_REQUIRED');
    const hash=createHash('sha256').update(canonicalJson(input)).digest('hex');
    await this.pool.query(`INSERT INTO trade.decision_invalidation_snapshot(decision_invalidation_snapshot_id,decision_id,
      management_input_snapshot_id,strategy_version,observed_at,triggers_json,content_hash)
      VALUES($1,$2,$3,$4,$5,$6::jsonb,$7) ON CONFLICT(content_hash) DO NOTHING`,[randomUUID(),input.decisionId,
      input.managementInputSnapshotId,input.strategyVersion,input.observedAt,JSON.stringify(input.triggers),hash]);
  }
}
