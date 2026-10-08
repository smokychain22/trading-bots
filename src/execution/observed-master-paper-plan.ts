import type { Pool } from 'pg';
import type { AlpacaProviderConfig } from '../theta/alpaca-provider.js';
import type { BrokerReconciliationResult } from './broker-reconciliation-worker.js';
import type { ApprovedMasterPaperActionPlan } from './master-paper-action-handoff.js';
import { capitalReservationRequired, CapitalPlanAdmissionError } from './plan-capital-binding.js';
import { PostgresMasterPaperActionPlanStore } from './postgres-master-paper-action-plan-store.js';
import { produceRuntimePlanCapitalObservation } from './runtime-plan-capital-observation.js';

const dependencies={required:capitalReservationRequired,produce:produceRuntimePlanCapitalObservation,
  enqueue:(pool:Pool,...args:Parameters<PostgresMasterPaperActionPlanStore['enqueueWithDisposition']>)=>
    new PostgresMasterPaperActionPlanStore(pool).enqueueWithDisposition(...args)};

/** The real cycle uses this boundary. Schema 070 remains unchanged. Schema
 * 071 requires fresh, scoped evidence and the EXISTING atomic reservation /
 * plan store. This function has no coordinator or broker mutation surface. */
export async function enqueueObservedMasterPaperPlan(input: {
  pool:Pool; alpaca:AlpacaProviderConfig; reconciliation:BrokerReconciliationResult;
  plan:ApprovedMasterPaperActionPlan; createdAt:string; now:()=>string;
  chain:{botInstanceId:string;underlyingId:string};
}, deps=dependencies) {
  const required=await deps.required(input.pool);
  const result=required?await deps.produce(input):null;
  if(result?.state==='BLOCKED')return {inserted:false as const,disposition:'CAPITAL_BLOCKED' as const,
    conflictingIds:[],reasons:result.reasons};
  try {
    return {...await deps.enqueue(input.pool,input.plan,input.createdAt,input.chain,
      result?.state==='READY'?result.observation:undefined),reasons:[]};
  } catch(error) {
    if(!(error instanceof CapitalPlanAdmissionError))throw error;
    return {inserted:false as const,disposition:'CAPITAL_BLOCKED' as const,conflictingIds:[],reasons:error.reasons};
  }
}
