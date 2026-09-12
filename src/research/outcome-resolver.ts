import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import { canonicalJson } from './point-in-time-evidence.js';

export const wholeChainOutcomeResolverVersion = 'theta-whole-chain-outcome-resolver-v1' as const;

export interface WholeChainResolutionInput {
  readonly chainId:string; readonly closedAt:string|null; readonly allOptionLegsResolved:boolean;
  readonly allStockLotsResolved:boolean; readonly executionFeesKnown:boolean;
  readonly economicFactCount:number;
  readonly optionRealizedPnl:number|null; readonly stockRealizedPnl:number|null;
  readonly dividends:number|null; readonly fees:number|null;
}
export type WholeChainResolution =
  | {readonly state:'RESOLVED';readonly wholeChainNetPnl:number;readonly labelAvailableAt:string}
  | {readonly state:'BLOCKED';readonly reasons:readonly string[]};

export function resolveWholeChainOutcome(input:WholeChainResolutionInput):WholeChainResolution {
  const reasons:string[]=[];
  if(input.economicFactCount===0) reasons.push('NO_ECONOMIC_FACTS');
  if(input.closedAt===null) reasons.push('CHAIN_OPEN');
  if(!input.allOptionLegsResolved) reasons.push('OPTION_LEGS_UNRESOLVED');
  if(!input.allStockLotsResolved) reasons.push('STOCK_LOTS_UNRESOLVED');
  if(!input.executionFeesKnown) reasons.push('EXECUTION_FEES_UNKNOWN');
  if(input.optionRealizedPnl===null) reasons.push('OPTION_PNL_UNKNOWN');
  if(input.stockRealizedPnl===null) reasons.push('STOCK_PNL_UNKNOWN');
  if(input.dividends===null) reasons.push('DIVIDENDS_UNKNOWN');
  if(input.fees===null) reasons.push('FEES_UNKNOWN');
  if(reasons.length>0) return {state:'BLOCKED',reasons};
  return {state:'RESOLVED',wholeChainNetPnl:(input.optionRealizedPnl as number)+(input.stockRealizedPnl as number)
    +(input.dividends as number)-(input.fees as number),labelAvailableAt:input.closedAt as string};
}

export interface OutcomeResolutionReport {readonly inspected:number;readonly resolved:number;readonly blocked:number;}
export class PostgresOutcomeResolver {
  constructor(private readonly pool:Pool){}
  async resolveClosedChains(asOf:string):Promise<OutcomeResolutionReport>{
    const rows=await this.pool.query(`SELECT ec.chain_id,ec.closed_at,
      NOT EXISTS(SELECT 1 FROM trade.option_leg ol WHERE ol.chain_id=ec.chain_id AND (ol.closed_at IS NULL OR ol.realized_pnl IS NULL)) AS option_resolved,
      NOT EXISTS(SELECT 1 FROM trade.stock_lot sl WHERE sl.chain_id=ec.chain_id AND (sl.disposed_at IS NULL OR sl.realized_pnl IS NULL)) AS stock_resolved,
      ((SELECT count(*) FROM trade.option_leg ol WHERE ol.chain_id=ec.chain_id)
        +(SELECT count(*) FROM trade.stock_lot sl WHERE sl.chain_id=ec.chain_id)
        +(SELECT count(*) FROM trade.fee_event fe WHERE fe.chain_id=ec.chain_id))::int AS economic_fact_count,
      NOT EXISTS(SELECT 1 FROM trade.fill f JOIN trade.broker_order bo ON bo.broker_order_id=f.broker_order_id
        JOIN trade.order_intent oi ON oi.order_intent_id=bo.order_intent_id WHERE oi.chain_id=ec.chain_id AND f.fees IS NULL) AS fees_known,
      COALESCE((SELECT sum(ol.realized_pnl) FROM trade.option_leg ol WHERE ol.chain_id=ec.chain_id),0)::text AS option_pnl,
      COALESCE((SELECT sum(sl.realized_pnl) FROM trade.stock_lot sl WHERE sl.chain_id=ec.chain_id),0)::text AS stock_pnl,
      COALESCE((SELECT sum(de.amount_per_share*sl.shares) FROM trade.dividend_event de JOIN trade.stock_lot sl USING(stock_lot_id) WHERE sl.chain_id=ec.chain_id),0)::text AS dividends,
      COALESCE((SELECT sum(fe.amount) FROM trade.fee_event fe WHERE fe.chain_id=ec.chain_id),0)::text AS fees
      FROM trade.economic_chain ec WHERE ec.closed_at IS NOT NULL AND ec.closed_at <= $1
      AND NOT EXISTS(SELECT 1 FROM research.theta_outcome_label l WHERE l.subject_type='WHOLE_CHAIN' AND l.subject_id=ec.chain_id AND l.censoring_state='RESOLVED')
      ORDER BY ec.closed_at,ec.chain_id`,[asOf]);
    let resolved=0,blocked=0;
    for(const row of rows.rows){
      const input:WholeChainResolutionInput={chainId:String(row.chain_id),closedAt:String(row.closed_at),
        allOptionLegsResolved:Boolean(row.option_resolved),allStockLotsResolved:Boolean(row.stock_resolved),executionFeesKnown:Boolean(row.fees_known),
        economicFactCount:Number(row.economic_fact_count),
        optionRealizedPnl:Number(row.option_pnl),stockRealizedPnl:Number(row.stock_pnl),dividends:Number(row.dividends),fees:Number(row.fees)};
      const outcome=resolveWholeChainOutcome(input);
      if(outcome.state==='BLOCKED'){blocked++;continue;}
      const payload={input,outcome,resolverVersion:wholeChainOutcomeResolverVersion};
      const contentHash=createHash('sha256').update(canonicalJson(payload)).digest('hex');
      const outcomeLabelId=deterministicUuid(`whole-chain:${input.chainId}:${wholeChainOutcomeResolverVersion}`);
      const result=await this.pool.query(`INSERT INTO research.theta_outcome_label(outcome_label_id,subject_type,subject_id,
        label_available_at,label_version,censoring_state,whole_chain_net_pnl,outcomes_json,provenance_json,content_hash)
        VALUES($1,'WHOLE_CHAIN',$2,$3,$4,'RESOLVED',$5,$6::jsonb,$7::jsonb,$8) ON CONFLICT(content_hash) DO NOTHING`,
      [outcomeLabelId,input.chainId,outcome.labelAvailableAt,wholeChainOutcomeResolverVersion,outcome.wholeChainNetPnl,
        JSON.stringify({resolution:'BROKER_CONFIRMED_CLOSED_CHAIN'}),JSON.stringify({source:'THETA_ECONOMIC_LEDGER',asOf}),contentHash]);
      resolved+=result.rowCount??0;
    }
    return {inspected:rows.rowCount??0,resolved,blocked};
  }
}

function deterministicUuid(value:string):string{
  const bytes=Buffer.from(createHash('sha256').update(value).digest('hex').slice(0,32),'hex');
  bytes[6]=((bytes[6]??0)&0x0f)|0x40; bytes[8]=((bytes[8]??0)&0x3f)|0x80;
  const hex=bytes.toString('hex'); return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
