import { createHash } from 'node:crypto';
import type { LifecycleApplication } from '../theta/postgres-lifecycle-application-store.js';

export type FillLifecycleAction = 'OPEN_CSP'|'CLOSE_CSP'|'ROLL_CSP_CLOSE'|'ROLL_CSP_OPEN'|'OPEN_CC'|'CLOSE_CC'|'ROLL_CC_CLOSE'|'ROLL_CC_OPEN'|'SELL_STOCK';
export interface ConfirmedFillFact {
  readonly providerFillId:string; readonly providerActivityRefHash:string;
  readonly quantity:number; readonly pricePerShare:number; readonly occurredAt:string;
  readonly fees:number|null;
}
export interface FillLifecycleContext {
  readonly action:FillLifecycleAction; readonly orderStatus:string; readonly orderQuantity:number;
  readonly chainId:string; readonly decisionId:string|null; readonly optionLegId:string|null;
  readonly optionContractId:string|null; readonly stockLotId:string|null;
  readonly multiplier:number|null; readonly entryCreditDebit:number|null; readonly economicBasisPerShare:number|null;
  readonly nextState:'RECOVERY_WAIT'|'REDEPLOY'|'CLOSED'|null;
  readonly fills:readonly ConfirmedFillFact[];
}

export interface RoutedFillLifecycle {
  readonly state:'CONFIRMED'|'PARTIAL'|'UNKNOWN'|'EXTERNAL_OR_UNKNOWN';
  readonly reasonCode:string; readonly application:LifecycleApplication|null;
}

export interface ConfirmedRollPairContext {
  readonly legKind:'SHORT_PUT'|'COVERED_CALL'; readonly chainId:string; readonly decisionId:string|null;
  readonly oldOptionLegId:string; readonly newOptionLegId:string; readonly newOptionContractId:string;
  readonly multiplier:number; readonly oldEntryCreditDebit:number;
  readonly close:Pick<FillLifecycleContext,'orderStatus'|'orderQuantity'|'fills'>;
  readonly open:Pick<FillLifecycleContext,'orderStatus'|'orderQuantity'|'fills'>;
}

const total=(fills:readonly ConfirmedFillFact[])=>fills.reduce((sum,fill)=>sum+fill.quantity,0);
const weightedPrice=(fills:readonly ConfirmedFillFact[]):number|null=>{
  const quantity=total(fills); return quantity<=0?null:fills.reduce((sum,fill)=>sum+fill.quantity*fill.pricePerShare,0)/quantity;
};
const evidence=(fills:readonly ConfirmedFillFact[])=>createHash('sha256').update(
  fills.map((fill)=>fill.providerActivityRefHash).sort().join(':'),
).digest('hex');

/** Builds an atomic lifecycle application only from fully confirmed fills. */
export function routeConfirmedFillLifecycle(input:FillLifecycleContext):RoutedFillLifecycle{
  if(input.fills.length===0) return {state:'UNKNOWN',reasonCode:'NO_BROKER_FILL_EVIDENCE',application:null};
  if(input.fills.some((fill)=>fill.quantity<=0||fill.pricePerShare<0||!/^[0-9a-f]{64}$/.test(fill.providerActivityRefHash))) {
    return {state:'UNKNOWN',reasonCode:'BROKER_FILL_EVIDENCE_INVALID',application:null};
  }
  const filled=total(input.fills);
  if(filled<input.orderQuantity || input.orderStatus!=='FILLED') return {state:'PARTIAL',reasonCode:'ORDER_NOT_FULLY_FILLED',application:null};
  if(filled!==input.orderQuantity) return {state:'UNKNOWN',reasonCode:'BROKER_FILL_QUANTITY_MISMATCH',application:null};
  const price=weightedPrice(input.fills);
  if(price===null) return {state:'UNKNOWN',reasonCode:'BROKER_FILL_PRICE_UNKNOWN',application:null};
  const occurredAt=[...input.fills].sort((a,b)=>a.occurredAt.localeCompare(b.occurredAt)).at(-1)?.occurredAt;
  if(occurredAt===undefined) return {state:'UNKNOWN',reasonCode:'BROKER_FILL_TIMESTAMP_UNKNOWN',application:null};
  const common={chainId:input.chainId,decisionId:input.decisionId,occurredAt,
    providerActivityRefHash:evidence(input.fills),evidenceKey:evidence(input.fills)};
  if(input.action==='OPEN_CSP'){
    if(input.optionLegId===null||input.optionContractId===null||input.multiplier===null) return missing();
    return confirmed({...common,eventKind:'SHORT_PUT_OPEN',optionLegId:input.optionLegId,optionContractId:input.optionContractId,
      quantity:filled,entryPricePerShare:price,entryCreditDebit:price*input.multiplier*filled});
  }
  if(input.action==='OPEN_CC'){
    if(input.optionLegId===null||input.optionContractId===null||input.multiplier===null) return missing();
    return confirmed({...common,eventKind:'COVERED_CALL_OPEN',optionLegId:input.optionLegId,optionContractId:input.optionContractId,
      quantity:filled,entryPricePerShare:price,entryCreditDebit:price*input.multiplier*filled});
  }
  if(input.action==='CLOSE_CSP'||input.action==='CLOSE_CC'){
    if(input.optionLegId===null||input.entryCreditDebit===null||input.multiplier===null||input.nextState===null) return missing();
    return confirmed({...common,eventKind:'OPTION_CLOSE',optionLegId:input.optionLegId,closePricePerShare:price,
      realizedOptionPnl:input.entryCreditDebit-price*input.multiplier*filled,nextState:input.nextState});
  }
  if(input.action==='SELL_STOCK'){
    if(input.stockLotId===null||input.economicBasisPerShare===null) return missing();
    return confirmed({...common,eventKind:'STOCK_DISPOSAL',stockLotId:input.stockLotId,disposedPricePerShare:price,
      realizedStockPnl:(price-input.economicBasisPerShare)*filled});
  }
  return {state:'UNKNOWN',reasonCode:'ROLL_LEGS_REQUIRE_ATOMIC_PAIR',application:null};
}

export function routeConfirmedRollPair(input:ConfirmedRollPairContext):RoutedFillLifecycle{
  if(input.close.orderStatus!=='FILLED'||input.open.orderStatus!=='FILLED'
    ||total(input.close.fills)!==input.close.orderQuantity||total(input.open.fills)!==input.open.orderQuantity) {
    return {state:'PARTIAL',reasonCode:'ROLL_PAIR_NOT_FULLY_FILLED',application:null};
  }
  if(input.multiplier<=0||input.close.orderQuantity<=0||input.open.orderQuantity<=0) return missing();
  const closePrice=weightedPrice(input.close.fills),openPrice=weightedPrice(input.open.fills);
  if(closePrice===null||openPrice===null) return missing();
  const fills=[...input.close.fills,...input.open.fills];
  if(fills.some((fill)=>!/^[0-9a-f]{64}$/.test(fill.providerActivityRefHash))) return missing();
  const occurredAt=[...fills].sort((a,b)=>a.occurredAt.localeCompare(b.occurredAt)).at(-1)?.occurredAt;
  if(occurredAt===undefined) return missing();
  const providerActivityRefHash=evidence(fills);
  return confirmed({eventKind:'OPTION_ROLL',evidenceKey:providerActivityRefHash,providerActivityRefHash,
    chainId:input.chainId,decisionId:input.decisionId,occurredAt,oldOptionLegId:input.oldOptionLegId,
    newOptionLegId:input.newOptionLegId,newOptionContractId:input.newOptionContractId,
    newQuantity:input.open.orderQuantity,newEntryPricePerShare:openPrice,
    newEntryCreditDebit:openPrice*input.multiplier*input.open.orderQuantity,
    oldClosePricePerShare:closePrice,
    oldRealizedPnl:input.oldEntryCreditDebit-closePrice*input.multiplier*input.close.orderQuantity,
    legKind:input.legKind});
}

const missing=():RoutedFillLifecycle=>({state:'UNKNOWN',reasonCode:'LIFECYCLE_LINKAGE_INCOMPLETE',application:null});
const confirmed=(application:LifecycleApplication):RoutedFillLifecycle=>({state:'CONFIRMED',reasonCode:'BROKER_FILL_CONFIRMED',application});
