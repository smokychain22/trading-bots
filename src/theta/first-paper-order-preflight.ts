import { createHash } from 'node:crypto';
import { buildAlpacaLimitOrder, type ThetaOrderInstruction } from '../execution/order-construction.js';
import type { BrokerOrderRequest } from '../execution/broker.js';
import {
  buildFirstPaperOrderReadinessReceipt,
  type FirstPaperOrderReadinessInput,
  type FirstPaperOrderReadinessReceipt,
} from './first-paper-order-readiness.js';

export interface FirstPaperOrderDryRun {
  readonly preflightVersion:'theta-first-paper-order-dry-run-v1';
  readonly receipt:FirstPaperOrderReadinessReceipt;
  readonly brokerEndpoint:'/v2/orders';
  readonly request:BrokerOrderRequest|null;
  readonly requestPayloadHash:string|null;
  readonly networkSubmission:'NOT_ATTEMPTED';
  readonly executionAuthorized:false;
  readonly mechanicalBlockers:readonly string[];
}

const goodValue=<T>(evidence:{state:string;value:T|null},code:string,blockers:string[]):T|null=>{
  if(evidence.state!=='GOOD'||evidence.value===null){blockers.push(`${code}_${evidence.state}`);return null;}
  return evidence.value;
};

export function buildFirstPaperOrderDryRun(input:FirstPaperOrderReadinessInput):FirstPaperOrderDryRun {
  const receipt=buildFirstPaperOrderReadinessReceipt(input),blockers:string[]=[];
  const symbol=goodValue(input.selection.occContract,'OCC_CONTRACT',blockers);
  const quantity=goodValue(input.selection.quantity,'QUANTITY',blockers);
  const limit=goodValue(input.quote.proposedLimit,'PROPOSED_LIMIT',blockers);
  const clientOrderId=goodValue(input.identity.clientOrderId,'CLIENT_ORDER_ID',blockers);
  const intent=goodValue(input.selection.positionIntent,'POSITION_INTENT',blockers);
  if(intent!==null&&intent!=='SELL_TO_OPEN') blockers.push('FIRST_THETA_INTENT_NOT_SELL_TO_OPEN');
  let request:BrokerOrderRequest|null=null;
  if(symbol!==null&&quantity!==null&&limit!==null&&clientOrderId!==null&&blockers.length===0){
    try {
      const instruction:ThetaOrderInstruction={action:'OPEN_CSP',symbol,quantity,limitPrice:limit,clientOrderId};
      request=buildAlpacaLimitOrder(instruction);
    } catch(error){blockers.push(error instanceof Error?`ORDER_CONSTRUCTION:${error.message}`:'ORDER_CONSTRUCTION_FAILED');}
  }
  const requestPayloadHash=request===null?null:createHash('sha256').update(JSON.stringify(request)).digest('hex');
  return {preflightVersion:'theta-first-paper-order-dry-run-v1',receipt,brokerEndpoint:'/v2/orders',request,
    requestPayloadHash,networkSubmission:'NOT_ATTEMPTED',executionAuthorized:false,
    mechanicalBlockers:[...new Set(blockers)].sort()};
}
