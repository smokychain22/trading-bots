import type { ManagementInputState } from './management-input-state.js';

export const holdStrikeLifecyclePolicyVersion='theta-h-lifecycle-v1' as const;
export type HoldStrikeLifecycleAction='HOLD'|'CLOSE_FULL'|'LET_EXPIRE'|'ACCEPT_ASSIGNMENT';

export interface HoldStrikeLifecycleAssessment{
  readonly policyVersion:typeof holdStrikeLifecyclePolicyVersion;
  readonly action:HoldStrikeLifecycleAction|null;
  readonly mandatory:boolean;
  readonly reasons:readonly string[];
  readonly reviewDeadline:string;
  readonly rollAllowed:false;
}

/** H is a 2-5 DTE policy. It never rolls. This layer handles only safety
 * deadlines and broker-lifecycle facts. Profit and loss economics remain in
 * the sovereign management policy and are not recomputed here. */
export function assessHoldStrikeLifecycle(state:ManagementInputState):HoldStrikeLifecycleAssessment|null{
  if(state.strategyOrigin!=='THETA_HOLD_STRIKE'||state.lifecycleState!=='CSP_OPEN')return null;
  const dte=state.market.dte;
  const reviewDeadline=dte===null?state.observedAt:new Date(Date.parse(state.observedAt)+Math.min(15,Math.max(1,dte))*60_000).toISOString();
  const base={policyVersion:holdStrikeLifecyclePolicyVersion,reviewDeadline,rollAllowed:false as const};
  if(dte===0&&state.market.marketOpen===false&&state.market.spot!==null&&state.contract.strike!==null){
    const itm=state.market.spot<state.contract.strike;
    return {...base,action:itm?'ACCEPT_ASSIGNMENT':'LET_EXPIRE',mandatory:true,
      reasons:[itm?'BROKER_EXPIRY_ITM_ASSIGNMENT_RECONCILIATION_REQUIRED':'BROKER_EXPIRY_OTM_CONFIRMATION_REQUIRED']};
  }
  const deterioration:string[]=[];
  if(state.context.eventState==='PRESENT')deterioration.push('EVENT_DETERIORATION');
  if(state.context.aegisState==='HARD_VETO'||state.context.aegisState==='EMERGENCY_EXIT_ONLY')deterioration.push('AEGIS_DETERIORATION');
  if(state.context.executionState==='DEGRADED'||state.market.quoteQuality!=='GOOD')deterioration.push('LIQUIDITY_DETERIORATION');
  if(dte!==null&&dte<=1)deterioration.push('H_NEAR_EXPIRY_DEADLINE');
  if(deterioration.length>0)return {...base,action:'CLOSE_FULL',mandatory:true,reasons:deterioration};
  return {...base,action:'HOLD',mandatory:false,reasons:['NO_H_SPECIFIC_SAFETY_TRIGGER']};
}

export interface HoldStrikeAssignmentTransition{
  readonly state:'WAIT_BROKER_CONFIRMATION'|'EXPIRED_OTM'|'ASSIGNED_STOCK_CREATED'|'QUARANTINED';
  readonly chainId:string;
  readonly optionLegId:string;
  readonly stockInventoryKey:string|null;
  readonly shares:number;
  readonly reason:string;
}

/** Assignment is created only from a broker activity identity. Contract
 * disappearance and an ITM mark are never sufficient. The deterministic
 * inventory key makes late/replayed broker events idempotent across restart. */
export function reconcileHoldStrikeAssignment(input:{chainId:string;optionLegId:string;contracts:number;multiplier:number;
  brokerActivityId:string|null;brokerEvent:'ASSIGNMENT'|'EXPIRATION'|null;expiredItm:boolean|null}):HoldStrikeAssignmentTransition{
  if(input.brokerEvent===null||input.brokerActivityId===null)return{state:'WAIT_BROKER_CONFIRMATION',chainId:input.chainId,
    optionLegId:input.optionLegId,stockInventoryKey:null,shares:0,reason:'BROKER_LIFECYCLE_EVENT_NOT_CONFIRMED'};
  if(input.brokerEvent==='EXPIRATION')return input.expiredItm===false
    ?{state:'EXPIRED_OTM',chainId:input.chainId,optionLegId:input.optionLegId,stockInventoryKey:null,shares:0,reason:'BROKER_CONFIRMED_OTM_EXPIRATION'}
    :{state:'QUARANTINED',chainId:input.chainId,optionLegId:input.optionLegId,stockInventoryKey:null,shares:0,reason:'ITM_EXPIRATION_WITHOUT_ASSIGNMENT_ACTIVITY'};
  if(!Number.isSafeInteger(input.contracts)||input.contracts<=0||!Number.isSafeInteger(input.multiplier)||input.multiplier<=0)
    return{state:'QUARANTINED',chainId:input.chainId,optionLegId:input.optionLegId,stockInventoryKey:null,shares:0,reason:'ASSIGNMENT_QUANTITY_INVALID'};
  return{state:'ASSIGNED_STOCK_CREATED',chainId:input.chainId,optionLegId:input.optionLegId,
    stockInventoryKey:`${input.chainId}:${input.optionLegId}:${input.brokerActivityId}`,shares:input.contracts*input.multiplier,
    reason:'BROKER_CONFIRMED_ASSIGNMENT'};
}
