import type { Pool } from 'pg';
import { PostgresExecutionEvidenceStore } from './postgres-execution-evidence-store.js';
import { buildTransactionCostAnalysis } from './transaction-cost-analysis.js';

const iso=(value:unknown):string=>value instanceof Date?value.toISOString():String(value);
const numeric=(value:unknown):number|null=>value==null||!Number.isFinite(Number(value))?null:Number(value);

/** Evidence-only retry. Runs AFTER broker/lifecycle commits and has no broker mutation capability. */
export async function persistConfirmedFillTca(pool:Pool,connectionId:string,asOf:string):Promise<{
  persisted:number; missing:number; failed:number;
}> {
  const report={persisted:0,missing:0,failed:0};
  try {
    const intents=await pool.query(`SELECT oi.order_intent_id,oi.quantity,oi.side,oi.instrument_type,oc.multiplier,oi.order_class
      FROM trade.order_intent oi JOIN trade.execution_account ea USING(execution_account_id)
      JOIN copy.follower_account fa ON encode(digest(fa.provider_account_ref,'sha256'),'hex')=ea.provider_account_ref_hash
      LEFT JOIN market.option_contract oc ON oc.option_contract_id=oi.option_contract_id
      WHERE fa.follower_account_id=$1 AND fa.account_role='MASTER_THETA_PAPER'
        AND fa.environment='PAPER' AND fa.disconnected_at IS NULL AND ea.environment='PAPER'
        AND ea.account_kind='MASTER_API_KEY' AND oi.status='FILLED'
        AND NOT EXISTS(SELECT 1 FROM trade.transaction_cost_analysis t WHERE t.order_intent_id=oi.order_intent_id)
      ORDER BY oi.order_intent_id`,[connectionId]);
    for(const intent of intents.rows){
      try {
        if(intent.order_class==='mleg'){
          if(await persistDefinedRiskPackageTca(pool,String(intent.order_intent_id),Number(intent.quantity),asOf))report.persisted++;
          else report.missing++;
          continue;
        }
        const fills=await pool.query(`SELECT f.quantity,f.price_per_share,f.fees,f.filled_at
          FROM trade.fill f JOIN trade.broker_order bo USING(broker_order_id)
          WHERE bo.order_intent_id=$1 AND f.filled_at <= $2 ORDER BY f.filled_at,f.fill_id`,[intent.order_intent_id,asOf]);
        const quantity=fills.rows.reduce((sum,row)=>sum+Number(row.quantity),0);
        const multiplier=intent.instrument_type==='STOCK'?1:numeric(intent.multiplier);
        const first=fills.rows[0],last=fills.rows.at(-1);
        if(!first||!last||quantity!==Number(intent.quantity)||quantity<=0||multiplier===null){report.missing++;continue;}
        const fillPrice=fills.rows.reduce((sum,row)=>sum+Number(row.quantity)*Number(row.price_per_share),0)/quantity;
        if(!Number.isFinite(fillPrice)||fillPrice<=0){report.missing++;continue;}
        const quotes=await pool.query(`SELECT * FROM trade.execution_price_event
          WHERE order_intent_id=$1 AND event_type IN ('INITIAL_LIMIT','ARRIVAL','REPLACEMENT')
            AND event_time <= $2 AND received_at <= $2 AND provider_timestamp <= $2
            AND provider_timestamp <= received_at AND bid>0 AND ask>=bid
          ORDER BY event_time,execution_price_event_id`,[intent.order_intent_id,first.filled_at]);
        const reference=quotes.rows[0],arrival=quotes.rows.at(-1);
        if(!reference||!arrival){report.missing++;continue;}
        const fees=fills.rows.every(row=>numeric(row.fees)!==null)
          ?fills.rows.reduce((sum,row)=>sum+Number(row.fees),0):null;
        const tca=buildTransactionCostAnalysis({side:String(intent.side).toUpperCase().startsWith('BUY')?'BUY':'SELL',
          quantity,multiplier,decision:{bid:Number(reference.bid),ask:Number(reference.ask),at:iso(reference.event_time)},
          arrival:{bid:Number(arrival.bid),ask:Number(arrival.ask),at:iso(arrival.event_time)},
          fill:{price:fillPrice,
            bid:null,ask:null,at:iso(last.filled_at)},
          limitAttempts:Math.max(1,...quotes.rows.map(row=>Number(row.attempt_no??1))),fees,
          estimatedMarketImpact:null,postFillMove:{},quoteProvider:String(reference.provider),
          quoteSemantics:String(reference.source_semantics),providerTimestamp:iso(reference.provider_timestamp),
          receivedAt:iso(reference.received_at),quoteAgeMs:numeric(reference.quote_age_ms)});
        await new PostgresExecutionEvidenceStore(pool).recordTca(String(intent.order_intent_id),asOf,tca);
        report.persisted++;
      }catch{report.failed++;}
    }
  }catch{report.failed++;}
  return report;
}

/** Signed per-leg contribution to a package's net price: selling a leg receives premium, buying pays it. */
export function packageNetPrice(legs:readonly {positionIntent:string;ratio:number;averageFillPrice:number}[]):number{
  return legs.reduce((sum,leg)=>sum+(leg.positionIntent.startsWith('sell')?1:-1)*leg.ratio*leg.averageFillPrice,0);
}

/**
 * A native mleg (D) fill is reported by the broker per LEG order, so it never lands in trade.fill against the parent. Its package fill is
 * the broker leg state: every leg completely filled, one package quantity across legs, net price = signed sum of leg averages. Without all
 * of that the TCA stays MISSING (never priced from a partial or a guessed leg). The decision/arrival quotes are the package quotes the D
 * handoff recorded for this intent. Fees are not reported per leg, so they stay null (unknown), never zero.
 */
async function persistDefinedRiskPackageTca(pool:Pool,orderIntentId:string,quantity:number,asOf:string):Promise<boolean>{
  const legs=await pool.query(`SELECT s.filled_quantity,s.requested_quantity,s.average_fill_price,s.observed_at,
      l.ratio_quantity,l.position_intent,l.multiplier
    FROM trade.order_intent_leg l LEFT JOIN trade.broker_order_leg_state s USING(order_intent_id,leg_index)
    WHERE l.order_intent_id=$1 AND (s.observed_at IS NULL OR s.observed_at<=$2) ORDER BY l.leg_index`,[orderIntentId,asOf]);
  const rows=legs.rows;
  if(rows.length<2)return false;
  const multipliers=new Set(rows.map((row)=>Number(row.multiplier)));
  const complete=rows.every((row)=>row.average_fill_price!==null&&row.filled_quantity!==null
    &&Number(row.filled_quantity)===Number(row.requested_quantity)&&Number(row.filled_quantity)===quantity*Number(row.ratio_quantity));
  if(!complete||multipliers.size!==1||!Number.isInteger(quantity)||quantity<=0)return false;
  const net=packageNetPrice(rows.map((row)=>({positionIntent:String(row.position_intent),ratio:Number(row.ratio_quantity),
    averageFillPrice:Number(row.average_fill_price)})));
  if(!Number.isFinite(net)||net===0)return false;
  const filledAt=rows.map((row)=>iso(row.observed_at)).sort().at(-1) as string;
  const quotes=await pool.query(`SELECT * FROM trade.execution_price_event
    WHERE order_intent_id=$1 AND event_type IN ('INITIAL_LIMIT','ARRIVAL','REPLACEMENT')
      AND event_time <= $2 AND received_at <= $2 AND provider_timestamp <= $2
      AND provider_timestamp <= received_at AND bid>0 AND ask>=bid
    ORDER BY event_time,execution_price_event_id`,[orderIntentId,filledAt]);
  const reference=quotes.rows[0],arrival=quotes.rows.at(-1);
  if(!reference||!arrival)return false;
  const tca=buildTransactionCostAnalysis({side:net>0?'SELL':'BUY',quantity,multiplier:[...multipliers][0] as number,
    decision:{bid:Number(reference.bid),ask:Number(reference.ask),at:iso(reference.event_time)},
    arrival:{bid:Number(arrival.bid),ask:Number(arrival.ask),at:iso(arrival.event_time)},
    fill:{price:Math.abs(net),bid:null,ask:null,at:filledAt},
    limitAttempts:Math.max(1,...quotes.rows.map(row=>Number(row.attempt_no??1))),fees:null,
    estimatedMarketImpact:null,postFillMove:{},quoteProvider:String(reference.provider),
    quoteSemantics:String(reference.source_semantics),providerTimestamp:iso(reference.provider_timestamp),
    receivedAt:iso(reference.received_at),quoteAgeMs:numeric(reference.quote_age_ms)});
  await new PostgresExecutionEvidenceStore(pool).recordTca(orderIntentId,asOf,tca);
  return true;
}
