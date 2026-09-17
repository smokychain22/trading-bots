import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { BrokerOrderSnapshot } from '../execution/broker.js';
import { qualifyExecutionOptionQuote, type ExecutionOptionQuote } from '../execution/execution-option-quote.js';
import type { FollowerCopyPlan, MasterCopyEvent } from './copy-engine-contract.js';

export const followerPaperActionPlanVersion = 'theta-follower-paper-action-plan-v1' as const;

const orderActionSchema = z.enum([
  'OPEN_CSP','REDUCE_CSP','CLOSE_CSP','ROLL_CSP_CLOSE','ROLL_CSP_OPEN','SELL_STOCK',
  'OPEN_CC','REDUCE_CC','CLOSE_CC','ROLL_CC_CLOSE','ROLL_CC_OPEN',
]);
const aegisSchema = z.enum(['ALLOW_FULL','ALLOW_REDUCED','HOLD_ONLY','HARD_VETO']);

export interface FollowerPaperActionPlan {
  readonly contractVersion:typeof followerPaperActionPlanVersion;
  readonly actionPlanId:string;
  readonly followerCopyEventId:string;
  readonly followerOrderIntentId:string;
  readonly workspaceId:string;
  readonly followerAccountId:string;
  readonly action:z.infer<typeof orderActionSchema>;
  readonly symbol:string;
  readonly quantity:number;
  readonly side:'BUY'|'SELL';
  readonly positionIntent:'BUY_TO_CLOSE'|'SELL_TO_OPEN'|null;
  readonly limitPrice:number;
  readonly quote:ExecutionOptionQuote;
  readonly quoteAgeMs:number;
  readonly aegisState:z.infer<typeof aegisSchema>;
  readonly aegisPolicyVersion:string;
  readonly clientOrderId:string;
  readonly decisionExpiresAt:string;
  readonly executionGate:'FOLLOWER_EXECUTION_DISABLED';
  readonly executionAuthorized:false;
}

export interface AssembleFollowerPaperActionPlanInput {
  readonly copyPlan:FollowerCopyPlan;
  readonly workspaceId:string;
  readonly followerAccountId:string;
  readonly symbol:string;
  readonly quote:ExecutionOptionQuote;
  readonly proposedLimit:number;
  readonly aegisState:z.infer<typeof aegisSchema>;
  readonly aegisPolicyVersion:string;
  readonly now:string;
  readonly decisionExpiresAt:string;
  readonly maximumQuoteAgeMs:number;
  readonly marketOpen:boolean;
}

const actionShape=(action:z.infer<typeof orderActionSchema>)=>{
  if(['OPEN_CSP','ROLL_CSP_OPEN','OPEN_CC','ROLL_CC_OPEN'].includes(action))
    return {side:'SELL' as const,positionIntent:'SELL_TO_OPEN' as const};
  if(['REDUCE_CSP','CLOSE_CSP','ROLL_CSP_CLOSE','REDUCE_CC','CLOSE_CC','ROLL_CC_CLOSE'].includes(action))
    return {side:'BUY' as const,positionIntent:'BUY_TO_CLOSE' as const};
  return {side:'SELL' as const,positionIntent:null};
};

export function assembleLockedFollowerPaperActionPlan(input:AssembleFollowerPaperActionPlanInput):FollowerPaperActionPlan{
  const parsed=z.object({
    workspaceId:z.string().uuid(),followerAccountId:z.string().uuid(),symbol:z.string().min(1).max(64),
    proposedLimit:z.number().positive().finite(),aegisState:aegisSchema,aegisPolicyVersion:z.string().min(1),
    now:z.string().datetime({offset:true}),decisionExpiresAt:z.string().datetime({offset:true}),
    maximumQuoteAgeMs:z.number().int().positive(),marketOpen:z.boolean(),
  }).parse(input);
  const action=orderActionSchema.parse(input.copyPlan.action);
  if(input.copyPlan.executionAuthorized!==false)throw new Error('FOLLOWER_COPY_PLAN_MUST_BE_LOCKED');
  if(input.copyPlan.nextAction!=='PERSIST_PLAN'||input.copyPlan.intendedQuantity<=0)
    throw new Error('FOLLOWER_COPY_PLAN_NOT_ORDERABLE');
  if(!['ALLOW_FULL','ALLOW_REDUCED'].includes(parsed.aegisState))throw new Error('FOLLOWER_AEGIS_NOT_APPROVED');
  if(Date.parse(parsed.decisionExpiresAt)<=Date.parse(parsed.now))throw new Error('FOLLOWER_DECISION_EXPIRED');
  assertNoSecretShapedKeys(input.quote);
  const decisionWindowMs=Date.parse(parsed.decisionExpiresAt)-Date.parse(parsed.now);
  const qualification=qualifyExecutionOptionQuote({quote:input.quote,expectedContractId:parsed.symbol,
    nowUtc:parsed.now,maximumAgeMs:Math.min(parsed.maximumQuoteAgeMs,decisionWindowMs),marketOpen:parsed.marketOpen,usage:'MASTER_PAPER'});
  if(!qualification.qualified||qualification.quoteAgeMs===null)
    throw new Error(`FOLLOWER_QUOTE_NOT_QUALIFIED:${qualification.blockers.join(',')}`);
  if(!['ALPACA','OPTIONOMICS'].includes(input.quote.provider))throw new Error('FOLLOWER_QUOTE_PROVIDER_NOT_APPROVED');
  const approvedSemantics=input.quote.provider==='ALPACA'&&input.quote.sourceSemantics==='CONSOLIDATED_NBBO'
    ||input.quote.provider==='ALPACA'&&input.quote.sourceSemantics==='PAPER_INDICATIVE_REFERENCE'
    ||input.quote.provider==='OPTIONOMICS'&&input.quote.sourceSemantics==='TRUSTED_TWO_SIDED_ORDER_PRICING';
  if(action!=='SELL_STOCK'&&!approvedSemantics)throw new Error('FOLLOWER_ORDER_PRICING_SEMANTICS_NOT_PROVEN');
  if(parsed.proposedLimit<input.quote.bid||parsed.proposedLimit>input.quote.ask)
    throw new Error('FOLLOWER_LIMIT_OUTSIDE_CURRENT_BBO');
  const identity=[input.copyPlan.copyEventId,input.copyPlan.followerOrderIntentId,parsed.followerAccountId,
    action,parsed.symbol,String(input.copyPlan.intendedQuantity),parsed.aegisPolicyVersion].join('\u001f');
  return {contractVersion:followerPaperActionPlanVersion,
    actionPlanId:`follower_plan_${createHash('sha256').update(identity).digest('hex').slice(0,32)}`,
    followerCopyEventId:input.copyPlan.copyEventId,followerOrderIntentId:input.copyPlan.followerOrderIntentId,
    workspaceId:parsed.workspaceId,followerAccountId:parsed.followerAccountId,action,symbol:parsed.symbol,
    quantity:input.copyPlan.intendedQuantity,...actionShape(action),limitPrice:parsed.proposedLimit,quote:input.quote,
    quoteAgeMs:qualification.quoteAgeMs,aegisState:parsed.aegisState,aegisPolicyVersion:parsed.aegisPolicyVersion,
    clientOrderId:input.copyPlan.clientOrderId,decisionExpiresAt:parsed.decisionExpiresAt,
    executionGate:'FOLLOWER_EXECUTION_DISABLED',executionAuthorized:false};
}

export function assertNoSecretShapedKeys(value:unknown):void{
  if(Array.isArray(value)){value.forEach(assertNoSecretShapedKeys);return;}
  if(value===null||typeof value!=='object')return;
  for(const [key,nested] of Object.entries(value as Record<string,unknown>)){
    const normalized=key.toLowerCase().replace(/[^a-z0-9]/g,'');
    if(/(secret|token|authorization|apikey|credential)/.test(normalized))
      throw new Error('SECRET_FIELD_IN_FOLLOWER_ACTION_PLAN');
    assertNoSecretShapedKeys(nested);
  }
}

export type FollowerOrderReconciliationState=
  'PLANNED_LOCKED'|'BROKER_ABSENT'|'SUBMITTED_EXTERNALLY'|'PARTIAL_FILL'|'FILLED'|'CANCELED'|'REJECTED'|'UNKNOWN_SUBMISSION';

export function classifyFollowerOrderReconciliation(input:{
  readonly plan:FollowerPaperActionPlan; readonly brokerOrder:BrokerOrderSnapshot|null;
}):{state:FollowerOrderReconciliationState;filledQuantity:number;requiresReconciliation:boolean}{
  if(input.plan.executionAuthorized!==false)throw new Error('FOLLOWER_ACTION_PLAN_MUST_BE_LOCKED');
  const order=input.brokerOrder;
  if(order===null)return {state:'BROKER_ABSENT',filledQuantity:0,requiresReconciliation:false};
  if(order.clientOrderId!==input.plan.clientOrderId||order.symbol!==input.plan.symbol)
    return {state:'UNKNOWN_SUBMISSION',filledQuantity:order.filledQty,requiresReconciliation:true};
  if(order.qty!==input.plan.quantity||order.filledQty<0||order.filledQty>order.qty)
    return {state:'UNKNOWN_SUBMISSION',filledQuantity:order.filledQty,requiresReconciliation:true};
  const status=order.status.toLowerCase();
  if(status==='filled'&&order.filledQty!==order.qty)
    return {state:'UNKNOWN_SUBMISSION',filledQuantity:order.filledQty,requiresReconciliation:true};
  if(order.filledQty===order.qty&&order.qty>0)
    return {state:'FILLED',filledQuantity:order.filledQty,requiresReconciliation:false};
  if(order.filledQty>0||status.includes('partial'))
    return {state:'PARTIAL_FILL',filledQuantity:order.filledQty,requiresReconciliation:true};
  if(['canceled','cancelled','expired','replaced'].includes(status))
    return {state:'CANCELED',filledQuantity:0,requiresReconciliation:false};
  if(['rejected','suspended'].includes(status))
    return {state:'REJECTED',filledQuantity:0,requiresReconciliation:true};
  return {state:'SUBMITTED_EXTERNALLY',filledQuantity:0,requiresReconciliation:true};
}

export const followerDivergenceKindSchema=z.enum([
  'MISSED_MASTER_ENTRY','PARTIAL_FILL','CSP_CLOSE_DIVERGED','CSP_ROLL_DIVERGED','ASSIGNMENT_DIVERGED',
  'STOCK_RECOVERY_DIVERGED','COVERED_CALL_DIVERGED','CALL_AWAY_DIVERGED','PAUSED_MANAGING_EXISTING',
  'RESTART_RECONCILIATION_REQUIRED','BROKER_POSITION_DIVERGED','NONE',
]);
export type FollowerDivergenceKind=z.infer<typeof followerDivergenceKindSchema>;

export function classifyFollowerLifecycleDivergence(input:{
  readonly action:MasterCopyEvent['action']; readonly entryParticipated:boolean; readonly intendedQuantity:number;
  readonly filledQuantity:number; readonly expectedBrokerQuantity:number; readonly actualBrokerQuantity:number;
  readonly followerAssigned:boolean|null; readonly followerCalledAway:boolean|null;
  readonly participation:'COPY_NEW_AND_MANAGE'|'STOP_NEW_TRADES_MANAGE_EXISTING'|'DISCONNECTED';
  readonly recoveringStock:boolean; readonly coveredCallOpen:boolean; readonly restarting:boolean;
}):FollowerDivergenceKind{
  const value=z.object({action:z.string(),entryParticipated:z.boolean(),intendedQuantity:z.number().int().nonnegative(),
    filledQuantity:z.number().int().nonnegative(),expectedBrokerQuantity:z.number().int().nonnegative(),
    actualBrokerQuantity:z.number().int().nonnegative(),followerAssigned:z.boolean().nullable(),
    followerCalledAway:z.boolean().nullable(),participation:z.enum(['COPY_NEW_AND_MANAGE','STOP_NEW_TRADES_MANAGE_EXISTING','DISCONNECTED']),
    recoveringStock:z.boolean(),coveredCallOpen:z.boolean(),restarting:z.boolean()}).parse(input);
  const action=copyActionForDivergence(value.action);
  if(value.restarting)return 'RESTART_RECONCILIATION_REQUIRED';
  if(value.participation==='STOP_NEW_TRADES_MANAGE_EXISTING')return 'PAUSED_MANAGING_EXISTING';
  if(action!=='OPEN_CSP'&&!value.entryParticipated)return 'MISSED_MASTER_ENTRY';
  if(value.filledQuantity>0&&value.filledQuantity<value.intendedQuantity)return 'PARTIAL_FILL';
  if(action==='ASSIGN_STOCK'&&value.followerAssigned!==true)return 'ASSIGNMENT_DIVERGED';
  if(['CLOSE_CSP','REDUCE_CSP'].includes(action)&&value.filledQuantity<value.intendedQuantity)return 'CSP_CLOSE_DIVERGED';
  if(['ROLL_CSP_CLOSE','ROLL_CSP_OPEN'].includes(action)&&value.filledQuantity<value.intendedQuantity)return 'CSP_ROLL_DIVERGED';
  if(['HOLD_STOCK','SELL_STOCK'].includes(action)&&!value.recoveringStock)return 'STOCK_RECOVERY_DIVERGED';
  if(['OPEN_CC','REDUCE_CC','CLOSE_CC','ROLL_CC_CLOSE','ROLL_CC_OPEN','EXPIRE_CC'].includes(action)&&!value.coveredCallOpen)
    return 'COVERED_CALL_DIVERGED';
  if(action==='CALL_AWAY'&&value.followerCalledAway!==true)return 'CALL_AWAY_DIVERGED';
  if(value.expectedBrokerQuantity!==value.actualBrokerQuantity)return 'BROKER_POSITION_DIVERGED';
  return 'NONE';
}

function copyActionForDivergence(value:string):MasterCopyEvent['action']{
  return z.enum(['OPEN_CSP','REDUCE_CSP','CLOSE_CSP','ROLL_CSP_CLOSE','ROLL_CSP_OPEN','EXPIRE_CSP','ASSIGN_STOCK',
    'HOLD_STOCK','SELL_STOCK','OPEN_CC','REDUCE_CC','CLOSE_CC','ROLL_CC_CLOSE','ROLL_CC_OPEN','EXPIRE_CC','CALL_AWAY']).parse(value);
}
