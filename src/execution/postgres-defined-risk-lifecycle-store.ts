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
    eventType:DefinedRiskLifecycleEventType;legIndex:number|null;contracts:number|null;sharesDelta:number|null;cashFlow:number|null;
    occurredAt:string;detail:Record<string,unknown>}):Promise<void>{
    if(!input.providerEventId.trim()||!Number.isFinite(Date.parse(input.occurredAt)))throw new Error('DEFINED_RISK_LIFECYCLE_EVENT_INVALID');
    // assignment/exercise change inventory and must say exactly how many contracts of WHICH leg: assignment is the short leg, exercise is the long leg
    if(input.eventType==='ASSIGNMENT'&&(input.legIndex!==1||input.contracts===null))throw new Error('DEFINED_RISK_ASSIGNMENT_EVENT_REQUIRES_SHORT_LEG_CONTRACTS');
    if(input.eventType==='EXERCISE'&&(input.legIndex!==2||input.contracts===null))throw new Error('DEFINED_RISK_EXERCISE_EVENT_REQUIRES_LONG_LEG_CONTRACTS');
    if(input.contracts!==null&&(!Number.isSafeInteger(input.contracts)||input.contracts<=0))throw new Error('DEFINED_RISK_LIFECYCLE_EVENT_INVALID');
    await withRuntimePostgresTransaction(this.pool,client=>client.query(
      `INSERT INTO trade.multi_leg_lifecycle_event(order_intent_id,chain_id,provider_event_id,event_type,leg_index,
         contracts,shares_delta,cash_flow,occurred_at,detail_json)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
       ON CONFLICT(order_intent_id,provider_event_id,(COALESCE(leg_index,0))) DO NOTHING`,
      [input.orderIntentId,input.chainId,input.providerEventId,input.eventType,input.legIndex,input.contracts,input.sharesDelta,
        input.cashFlow,input.occurredAt,JSON.stringify(input.detail)]).then(()=>undefined));
  }

  async recordAccounting(orderIntentId:string,chainId:string,value:DefinedRiskWholeChainAccounting):Promise<void>{
    await withRuntimePostgresTransaction(this.pool,client=>client.query(
      `INSERT INTO trade.multi_leg_chain_accounting(order_intent_id,chain_id,opening_net_credit,opening_fees,
         closing_net_debit,closing_fees,assignment_exercise_cash_flow,realized_pnl,realized_pnl_before_fees,pnl_state,remaining_exposure)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT(order_intent_id) DO UPDATE SET closing_net_debit=EXCLUDED.closing_net_debit,
         closing_fees=EXCLUDED.closing_fees,assignment_exercise_cash_flow=EXCLUDED.assignment_exercise_cash_flow,
         realized_pnl=EXCLUDED.realized_pnl,realized_pnl_before_fees=EXCLUDED.realized_pnl_before_fees,pnl_state=EXCLUDED.pnl_state,remaining_exposure=EXCLUDED.remaining_exposure,updated_at=now(),
         -- opening economics are immutable once known; a still-unknown opening may be filled in exactly once, never rewritten
         opening_net_credit=COALESCE(trade.multi_leg_chain_accounting.opening_net_credit,EXCLUDED.opening_net_credit),
         opening_fees=COALESCE(trade.multi_leg_chain_accounting.opening_fees,EXCLUDED.opening_fees)
       WHERE trade.multi_leg_chain_accounting.chain_id=EXCLUDED.chain_id
         AND (trade.multi_leg_chain_accounting.opening_net_credit IS NULL OR trade.multi_leg_chain_accounting.opening_net_credit=EXCLUDED.opening_net_credit)
         AND (trade.multi_leg_chain_accounting.opening_fees IS NULL OR trade.multi_leg_chain_accounting.opening_fees=EXCLUDED.opening_fees)`,
      [orderIntentId,chainId,value.openingNetCredit,value.openingFees,value.closingNetDebit,value.closingFees,
        value.assignmentExerciseCashFlow,value.realizedPnl,value.realizedPnlBeforeFees,value.pnlState,value.remainingUnrealizedExposure]).then(()=>undefined));
  }
}
