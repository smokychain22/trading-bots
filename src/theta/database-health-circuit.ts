import type { PostgresRuntimeErrorClassification } from './postgres-runtime-error.js';

export const databaseHealthStates=[
  'DB_HEALTHY','DB_TRANSIENT_FAILURE','DB_CIRCUIT_OPEN','DB_RECOVERY_PROBING','DB_RECOVERED',
] as const;
export type DatabaseHealthState=typeof databaseHealthStates[number];

export interface DatabaseCircuitReceipt {
  readonly state:DatabaseHealthState;
  readonly consecutiveFailures:number;
  readonly recoverySuccesses:number;
  readonly decisionAuthority:'AVAILABLE'|'INFRASTRUCTURE_DEFERRED';
  readonly carryForwardCandidateAllowed:false;
}

/** Pure policy used by supervisors and tests. It never authorizes a decision or mutation. */
export class DatabaseHealthCircuit {
  private stateValue:DatabaseHealthState='DB_HEALTHY';
  private consecutiveFailures=0;
  private recoverySuccesses=0;
  constructor(private readonly failuresToOpen=2,private readonly successesToRecover=4) {}

  failure(classification:PostgresRuntimeErrorClassification):DatabaseCircuitReceipt {
    if(!classification.retryableRead){
      this.stateValue='DB_CIRCUIT_OPEN';
      this.consecutiveFailures=Math.max(this.failuresToOpen,this.consecutiveFailures+1);
    }else{
      this.consecutiveFailures++;
      this.recoverySuccesses=0;
      this.stateValue=this.consecutiveFailures>=this.failuresToOpen?'DB_CIRCUIT_OPEN':'DB_TRANSIENT_FAILURE';
    }
    return this.receipt();
  }

  beginRecoveryProbe():DatabaseCircuitReceipt {
    if(this.stateValue!=='DB_HEALTHY')this.stateValue='DB_RECOVERY_PROBING';
    return this.receipt();
  }

  recoveryProbeSucceeded():DatabaseCircuitReceipt {
    if(this.stateValue==='DB_HEALTHY')return this.receipt();
    this.stateValue='DB_RECOVERY_PROBING';
    this.recoverySuccesses++;
    if(this.recoverySuccesses>=this.successesToRecover){
      this.stateValue='DB_RECOVERED';
      this.consecutiveFailures=0;
    }
    return this.receipt();
  }

  recoveryProbeFailed(classification:PostgresRuntimeErrorClassification):DatabaseCircuitReceipt {
    this.stateValue='DB_CIRCUIT_OPEN';
    this.recoverySuccesses=0;
    this.consecutiveFailures=Math.max(this.failuresToOpen,this.consecutiveFailures+1);
    void classification;
    return this.receipt();
  }

  startFreshCycleAfterRecovery():DatabaseCircuitReceipt {
    if(this.stateValue!=='DB_RECOVERED')throw new Error('DATABASE_RECOVERY_NOT_PROVEN');
    this.stateValue='DB_HEALTHY';
    return this.receipt();
  }

  receipt():DatabaseCircuitReceipt {
    return {state:this.stateValue,consecutiveFailures:this.consecutiveFailures,
      recoverySuccesses:this.recoverySuccesses,
      decisionAuthority:this.stateValue==='DB_HEALTHY'?'AVAILABLE':'INFRASTRUCTURE_DEFERRED',
      carryForwardCandidateAllowed:false};
  }
}
