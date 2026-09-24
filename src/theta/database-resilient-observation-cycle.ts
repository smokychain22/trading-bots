import { classifyPostgresRuntimeError } from './postgres-runtime-error.js';
import { LocalEvidenceSpool, type DecisionCheckpointStage, type LocalEvidenceEnvelope } from './local-evidence-spool.js';

export const databaseResilientObservationVersion='theta-database-resilient-observation-v1' as const;

export interface DecisionSnapshotIdentity {
  readonly decisionCycleId:string;
  readonly snapshotId:string;
  readonly decisionAsOf:string;
  readonly sourceSha:string;
  readonly workerId:string;
}

export interface ObservationStageResult {
  readonly identity:DecisionSnapshotIdentity;
  readonly payload:unknown;
  readonly providerObservedAt:Readonly<Record<string,string|null>>;
}

export interface ObservationStage {
  readonly stage:DecisionCheckpointStage;
  readonly criticality:'REQUIRED'|'OPTIONAL_RESEARCH';
  run(identity:DecisionSnapshotIdentity,prior:ReadonlyMap<DecisionCheckpointStage,ObservationStageResult>):Promise<ObservationStageResult>;
  persist?(result:ObservationStageResult):Promise<void>;
}

export interface DatabaseResilientObservationReport {
  readonly contractVersion:typeof databaseResilientObservationVersion;
  readonly identity:DecisionSnapshotIdentity;
  readonly observationComputationCapability:'COMPLETE'|'DEGRADED'|'BLOCKED';
  readonly brokerMutationCapability:'BLOCKED'|'ELIGIBLE_AFTER_SEPARATE_EXECUTION_GATE';
  readonly completedStages:readonly DecisionCheckpointStage[];
  readonly locallySpooledStages:readonly DecisionCheckpointStage[];
  readonly postgresPersistedStages:readonly DecisionCheckpointStage[];
  readonly optionalFailures:readonly string[];
  readonly blockingFailure:string|null;
  readonly envelopes:readonly LocalEvidenceEnvelope[];
}

function assertIdentity(expected:DecisionSnapshotIdentity,actual:DecisionSnapshotIdentity):void{
  if(actual.decisionCycleId!==expected.decisionCycleId||actual.snapshotId!==expected.snapshotId
    ||actual.decisionAsOf!==expected.decisionAsOf||actual.sourceSha!==expected.sourceSha
    ||actual.workerId!==expected.workerId)throw new Error('EVIDENCE_IDENTITY_MISMATCH');
}

const safeFailure=(error:unknown):string=>{
  const database=classifyPostgresRuntimeError(error);
  if(database.retryableRead)return database.safeCode;
  return error instanceof Error&&/^[A-Z0-9_:-]+$/.test(error.message)?error.message:'OBSERVATION_STAGE_FAILED';
};

/**
 * Runs immutable read-only decision stages while canonical persistence is
 * healthy or temporarily unavailable. This module has no broker dependency
 * and no mutation callback. A separate execution authority must still prove
 * canonical PostgreSQL persistence before an order is eligible.
 */
export async function runDatabaseResilientObservationCycle(input:{
  readonly identity:DecisionSnapshotIdentity;
  readonly stages:readonly ObservationStage[];
  readonly spool:LocalEvidenceSpool;
  readonly allowBrokerMutationAfterCanonicalPersistence:boolean;
}):Promise<DatabaseResilientObservationReport>{
  const prior=new Map<DecisionCheckpointStage,ObservationStageResult>();
  const envelopes:LocalEvidenceEnvelope[]=[];
  const completedStages:DecisionCheckpointStage[]=[];
  const locallySpooledStages:DecisionCheckpointStage[]=[];
  const postgresPersistedStages:DecisionCheckpointStage[]=[];
  const optionalFailures:string[]=[];
  let blockingFailure:string|null=null;
  let sequenceNumber=0;
  for(const stage of input.stages){
    let result:ObservationStageResult;
    try{
      result=await stage.run(input.identity,prior);
      assertIdentity(input.identity,result.identity);
    }catch(error){
      const code=safeFailure(error);
      if(stage.criticality==='OPTIONAL_RESEARCH'){
        optionalFailures.push(`${stage.stage}:${code}`);
        continue;
      }
      blockingFailure=`${stage.stage}:${code}`;
      envelopes.push(input.spool.append({...input.identity,sequenceNumber:sequenceNumber++,payloadType:'CYCLE_FAILED',
        payload:{failedStage:stage.stage,failureCode:code,brokerMutationAllowed:false},providerObservedAt:{},
        receivedAt:new Date().toISOString(),computedAt:new Date().toISOString()}));
      break;
    }
    let persisted=false;
    if(stage.persist!==undefined){
      try{
        await stage.persist(result);
        input.spool.recordDatabaseProbeSuccess(new Date().toISOString());
        persisted=true;
      }catch(error){
        const database=classifyPostgresRuntimeError(error);
        if(!database.retryableRead)throw error;
        input.spool.recordDatabaseFailure(new Date().toISOString(),false);
      }
    }
    const envelope=input.spool.append({...input.identity,sequenceNumber:sequenceNumber++,payloadType:stage.stage,
      payload:result.payload,providerObservedAt:result.providerObservedAt,
      receivedAt:new Date().toISOString(),computedAt:new Date().toISOString(),
      postgresPersistenceState:persisted?'PERSISTED_POSTGRES':'SPOOLED_LOCAL_PENDING_DB'});
    envelopes.push(envelope);
    prior.set(stage.stage,result);
    completedStages.push(stage.stage);
    if(persisted)postgresPersistedStages.push(stage.stage);else locallySpooledStages.push(stage.stage);
  }
  const requiredStages=input.stages.filter((stage)=>stage.criticality==='REQUIRED').map((stage)=>stage.stage);
  const allRequiredComputed=requiredStages.every((stage)=>completedStages.includes(stage));
  const allRequiredPersisted=requiredStages.every((stage)=>postgresPersistedStages.includes(stage));
  const observationComputationCapability=blockingFailure!==null?'BLOCKED'
    :optionalFailures.length>0||locallySpooledStages.length>0?'DEGRADED':'COMPLETE';
  const brokerMutationCapability=input.allowBrokerMutationAfterCanonicalPersistence&&allRequiredComputed&&allRequiredPersisted
    ?'ELIGIBLE_AFTER_SEPARATE_EXECUTION_GATE':'BLOCKED';
  return {contractVersion:databaseResilientObservationVersion,identity:input.identity,
    observationComputationCapability,brokerMutationCapability,completedStages,locallySpooledStages,
    postgresPersistedStages,optionalFailures,blockingFailure,envelopes};
}
