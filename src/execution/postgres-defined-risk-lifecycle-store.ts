import type { Pool } from 'pg';
import { withRuntimePostgresTransaction } from '../theta/runtime-postgres-client.js';
import type { DefinedRiskWholeChainAccounting } from './defined-risk-lifecycle.js';

export type DefinedRiskLifecycleEventType='EXPIRATION'|'ASSIGNMENT'|'EXERCISE'|'PIN_REVIEW'|'UNEXPECTED_ONE_LEG_STATE';

/** Durable, idempotent lifecycle sink for one native spread. Provider event
 * identity prevents duplicate stock consequences when late events are
 * replayed after restart. */
export class PostgresDefinedRiskLifecycleStore{
  constructor(private readonly pool:Pool){}

  async recordLifecycleEvent(input:{orderIntentId:string;chainId:string;providerEventId:string;
    eventType:DefinedRiskLifecycleEventType;legIndex:number|null;sharesDelta:number|null;cashFlow:number|null;
    occurredAt:string;detail:Record<string,unknown>}):Promise<void>{
    if(!input.providerEventId.trim()||!Number.isFinite(Date.parse(input.occurredAt)))throw new Error('DEFINED_RISK_LIFECYCLE_EVENT_INVALID');
    await withRuntimePostgresTransaction(this.pool,client=>client.query(
      `INSERT INTO trade.multi_leg_lifecycle_event(order_intent_id,chain_id,provider_event_id,event_type,leg_index,
         shares_delta,cash_flow,occurred_at,detail_json)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
       ON CONFLICT(order_intent_id,provider_event_id,(COALESCE(leg_index,0))) DO NOTHING`,
      [input.orderIntentId,input.chainId,input.providerEventId,input.eventType,input.legIndex,input.sharesDelta,
        input.cashFlow,input.occurredAt,JSON.stringify(input.detail)]).then(()=>undefined));
  }

  async recordAccounting(orderIntentId:string,chainId:string,value:DefinedRiskWholeChainAccounting):Promise<void>{
    await withRuntimePostgresTransaction(this.pool,client=>client.query(
      `INSERT INTO trade.multi_leg_chain_accounting(order_intent_id,chain_id,opening_net_credit,opening_fees,
         closing_net_debit,closing_fees,assignment_exercise_cash_flow,realized_pnl,remaining_exposure)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT(order_intent_id) DO UPDATE SET closing_net_debit=EXCLUDED.closing_net_debit,
         closing_fees=EXCLUDED.closing_fees,assignment_exercise_cash_flow=EXCLUDED.assignment_exercise_cash_flow,
         realized_pnl=EXCLUDED.realized_pnl,remaining_exposure=EXCLUDED.remaining_exposure,updated_at=now()
       WHERE trade.multi_leg_chain_accounting.chain_id=EXCLUDED.chain_id
         AND trade.multi_leg_chain_accounting.opening_net_credit=EXCLUDED.opening_net_credit
         AND trade.multi_leg_chain_accounting.opening_fees=EXCLUDED.opening_fees`,
      [orderIntentId,chainId,value.openingNetCredit,value.openingFees,value.closingNetDebit,value.closingFees,
        value.assignmentExerciseCashFlow,value.realizedPnl,value.remainingUnrealizedExposure]).then(()=>undefined));
  }
}
