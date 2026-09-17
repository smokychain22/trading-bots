import {createHash} from 'node:crypto';
import type {ExecutionQuoteSemantics} from './execution-option-quote.js';

export const paperOrderPreviewVersion='theta-paper-order-preview-v1' as const;
export interface PaperOrderPreviewLeg {readonly occContract:string;readonly positionIntent:'SELL_TO_OPEN'|'BUY_TO_CLOSE'|'SELL_TO_CLOSE'|'BUY_TO_OPEN';
  readonly ratio:number;readonly quantity:number;readonly optionType:'PUT'|'CALL';readonly strike:number;readonly expiration:string;readonly dte:number;}
export interface PaperOrderPreviewInput {readonly previewId:string;readonly asOf:string;readonly strategyBranch:string;readonly strategyVersion:string;
  readonly legs:readonly PaperOrderPreviewLeg[];readonly orderType:'LIMIT';readonly limitPrice:number|null;readonly quoteProvider:string|null;
  readonly quoteSemantics:ExecutionQuoteSemantics;readonly quoteObservedAt:string|null;readonly quoteAgeMs:number|null;readonly maximumQuoteAgeMs:number;
  readonly bid:number|null;readonly ask:number|null;readonly creditDebit:number|null;readonly maximumRisk:number|null;
  readonly buyingPowerEffect:number|null;readonly capitalRequired:number|null;readonly aegisResult:string;
  readonly portfolioEffects:Readonly<Record<string,number|null>>;readonly operatorPaused:boolean;readonly emergencyLocked:boolean;
  readonly executionQuoteQualified:boolean;readonly persistenceReady:boolean;readonly idempotencyReady:boolean;readonly clientOrderId:string|null;}
export interface PaperOrderPreviewReceipt extends PaperOrderPreviewInput {readonly version:typeof paperOrderPreviewVersion;
  readonly result:'DRY_RUN_READY'|'DRY_RUN_BLOCKED';readonly blockers:readonly string[];readonly receiptHash:string;
  readonly executionAuthorized:false;readonly submitToBroker:false;readonly paperOrderCreated:false;}
const canonical=(value:unknown):string=>JSON.stringify(value,(_key,item)=>item!==null&&typeof item==='object'&&!Array.isArray(item)
  ?Object.fromEntries(Object.entries(item as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b))):item);
export function buildPaperOrderPreview(input:PaperOrderPreviewInput):PaperOrderPreviewReceipt{
  const blockers:string[]=[];
  if(input.legs.length===0)blockers.push('ORDER_LEGS_EMPTY');
  for(const leg of input.legs){
    if(!leg.occContract.trim())blockers.push('CONTRACT_IDENTITY_MISSING');
    if(!Number.isInteger(leg.ratio)||leg.ratio<=0||!Number.isInteger(leg.quantity)||leg.quantity<=0)blockers.push('LEG_QUANTITY_INVALID');
    if(!Number.isFinite(leg.strike)||leg.strike<=0||!Number.isInteger(leg.dte)||leg.dte<0)blockers.push('LEG_TERMS_INVALID');
  }
  if(input.limitPrice===null||!Number.isFinite(input.limitPrice)||input.limitPrice<=0)blockers.push('LIMIT_PRICE_INVALID');
  if(input.bid===null||input.ask===null||input.bid<=0||input.ask<=0||input.bid>input.ask)blockers.push('TWO_SIDED_QUOTE_INVALID');
  if(input.quoteAgeMs===null||input.quoteAgeMs<0||input.quoteAgeMs>input.maximumQuoteAgeMs)blockers.push('QUOTE_STALE_OR_UNKNOWN');
  if(!['CONSOLIDATED_NBBO','TRUSTED_TWO_SIDED_ORDER_PRICING','PAPER_INDICATIVE_REFERENCE'].includes(input.quoteSemantics))blockers.push('ORDER_PRICING_SEMANTICS_NOT_PROVEN');
  if(!input.executionQuoteQualified)blockers.push('EXECUTION_QUOTE_NOT_QUALIFIED');
  if(input.operatorPaused)blockers.push('OPERATOR_PAUSED');
  if(input.emergencyLocked)blockers.push('EMERGENCY_EXECUTION_LOCKED');
  if(!input.persistenceReady)blockers.push('PERSISTENCE_NOT_READY');
  if(!input.idempotencyReady||input.clientOrderId===null||!input.clientOrderId.trim())blockers.push('IDEMPOTENCY_NOT_READY');
  if(!['ALLOW_FULL','ALLOW_REDUCED'].includes(input.aegisResult))blockers.push('AEGIS_BLOCKED');
  if(input.legs.length>1&&(input.maximumRisk===null||!Number.isFinite(input.maximumRisk)||input.maximumRisk<=0))blockers.push('MULTI_LEG_MAX_RISK_UNKNOWN');
  const unique=[...new Set(blockers)].sort();
  const base={version:paperOrderPreviewVersion,...input,result:unique.length===0?'DRY_RUN_READY' as const:'DRY_RUN_BLOCKED' as const,
    blockers:unique,executionAuthorized:false as const,submitToBroker:false as const,paperOrderCreated:false as const};
  return {...base,receiptHash:createHash('sha256').update(canonical(base)).digest('hex')};
}
