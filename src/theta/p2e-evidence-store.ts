import { createHash,randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { ManagementInputState } from './management-input-state.js';
import type { ManagementActionFrontier,ManagementActionEconomics } from './management-action-frontier.js';
import { buildPositionPathCheckpoint,type PositionPathCheckpoint } from './position-path-state.js';
import { buildActionInactionFrontier,type ActionEconomics,type ResearchAction } from './action-inaction-frontier.js';
import { deriveMarketSessionState,deriveOptionTimeState } from './time-aware-state.js';
import { routeStrategyTiming } from './strategy-timing-router.js';

const canonical=(value:unknown):string=>JSON.stringify(value,(_key,item)=>item!==null&&typeof item==='object'&&!Array.isArray(item)
  ?Object.fromEntries(Object.entries(item as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b))):item);
const hash=(value:unknown):string=>createHash('sha256').update(canonical(value)).digest('hex');
const ACTIONS:readonly ResearchAction[]=['WAIT','HOLD','CLOSE_FULL','ROLL','LET_EXPIRE','ACCEPT_ASSIGNMENT','REDEPLOY',
  'RECOVERY_WAIT','SELL_STOCK','SELL_CC','HOLD_CC','CLOSE_CC','ROLL_CC','ALLOW_CALL_AWAY'];

export function mapManagementFrontierActions(managementFrontier:ManagementActionFrontier):readonly ActionEconomics[]{
  const byAction=new Map<ResearchAction,ManagementActionEconomics>(managementFrontier.actions.map((action)=>[action.action,action]));
  return ACTIONS.map((action)=>{
    const source=byAction.get(action);
    if(source===undefined)return {action,feasible:false,infeasibleReason:'NOT_APPLICABLE_TO_LIFECYCLE',afterCostEv:null,
      tailBurden:null,capitalDays:null,executionCost:null,assignmentBurden:null,opportunityCost:null,
      empiricalState:'BLOCKED_ON_DATA'};
    const afterCostEv=source.executionEvidence?.expectedAfterCostEv??source.expectedFutureValue;
    const empiricalKnown=source.executionEvidence?.empiricalEconomicsReady===true&&afterCostEv!==null;
    return {action,feasible:source.feasibility==='FEASIBLE'?true:source.feasibility==='INFEASIBLE'?false:null,
      infeasibleReason:source.blockers.length>0?source.blockers.join('|'):null,afterCostEv,
      tailBurden:source.downsideTailEstimate,capitalDays:source.incrementalCapitalDays,
      executionCost:source.executionCostRisk,assignmentBurden:null,opportunityCost:source.opportunityCost,
      empiricalState:empiricalKnown?'KNOWN':source.feasibility==='UNKNOWN'?'UNKNOWN':'BLOCKED_ON_DATA'};
  });
}

export class PostgresP2EEvidenceStore{
  constructor(private readonly pool:Pool){}
  async persistManagementEvidence(states:readonly ManagementInputState[],frontiers:readonly ManagementActionFrontier[]):Promise<void>{
    if(states.length!==frontiers.length)throw new Error('P2E_FRONTIER_ALIGNMENT_FAILED');
    for(let index=0;index<states.length;index+=1){
      const state=states[index],managementFrontier=frontiers[index];
      if(state===undefined||managementFrontier===undefined||state.chainId!==managementFrontier.chainId){
        throw new Error('P2E_FRONTIER_ALIGNMENT_FAILED');
      }
      const prior=await this.pool.query(`SELECT checkpoint_json FROM research.theta_position_path_checkpoint
        WHERE chain_id=$1 ORDER BY observed_at,position_path_checkpoint_id`,[state.chainId]);
      const path=buildPositionPathCheckpoint(state,prior.rows.map((row)=>row.checkpoint_json as PositionPathCheckpoint));
      const actions=mapManagementFrontierActions(managementFrontier);
      const frontier=buildActionInactionFrontier({subjectId:state.managementInputSnapshotId,observedAt:state.observedAt,actions});
      const session=deriveMarketSessionState({observedAt:state.observedAt,clock:state.market.marketOpen===null?null:{
        timestamp:state.market.clockTimestamp??state.observedAt,isOpen:state.market.marketOpen,
        nextOpen:state.market.nextOpen,nextClose:state.market.nextClose},calendar:(state.market.calendarSessions??[])
          .filter((item):item is {date:string;open:string;close:string}=>item.open!==null&&item.close!==null),
        expirationDate:state.contract.expiration,eventWindowActive:null});
      const optionTime=deriveOptionTimeState(state.market.dte,session);
      const timing=routeStrategyTiming({observedAt:state.observedAt,sessionStates:session.states,optionTime,
        lifecycleState:state.lifecycleState,requiredUnknowns:state.unknownFields,eventStateKnown:state.context.eventState!==null,
        quoteFresh:state.hardBlockers.includes('BROKER_DATA_STALE')?false:state.market.quoteTimestamp===null?null:true});
      const client=await this.pool.connect();
      try{
        await client.query('BEGIN');
        await client.query(`INSERT INTO research.theta_position_path_checkpoint(position_path_checkpoint_id,chain_id,
          management_input_snapshot_id,observed_at,path_classification,checkpoint_json,content_hash)
          VALUES($1,$2,$3,$4,$5,$6::jsonb,$7) ON CONFLICT(content_hash) DO NOTHING`,[randomUUID(),state.chainId,
          state.managementInputSnapshotId,state.observedAt,path.classification,JSON.stringify(path),path.checkpointIdentity]);
        await client.query(`INSERT INTO research.theta_action_inaction_frontier(action_inaction_frontier_id,
          management_input_snapshot_id,chain_id,observed_at,hold_evidence_state,frontier_json,content_hash)
          VALUES($1,$2,$3,$4,$5,$6::jsonb,$7) ON CONFLICT(content_hash) DO NOTHING`,[randomUUID(),
          state.managementInputSnapshotId,state.chainId,state.observedAt,frontier.holdEvidence,JSON.stringify(frontier),hash(frontier)]);
        const timePayload={session,optionTime,timing};
        await client.query(`INSERT INTO research.theta_strategy_timing_snapshot(strategy_timing_snapshot_id,
          management_input_snapshot_id,chain_id,observed_at,session_state,option_time_json,timing_router_json,content_hash)
          VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8) ON CONFLICT(content_hash) DO NOTHING`,[randomUUID(),
          state.managementInputSnapshotId,state.chainId,state.observedAt,session.primary,JSON.stringify(optionTime),JSON.stringify(timing),hash(timePayload)]);
        await client.query('COMMIT');
      }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
    }
  }
}
