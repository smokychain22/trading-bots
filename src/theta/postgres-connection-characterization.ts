export type FreshPostgresFailurePhase =
  | 'DNS' | 'TCP' | 'TLS' | 'POSTGRES_STARTUP' | 'FIRST_QUERY' | 'CLIENT_CLOSE' | 'UNKNOWN';

export const thetaSoakPoolWaitTimeoutMillis=5_000;
export const thetaSoakFreshPhysicalConnectionTimeoutMillis=8_000;

export interface FreshPostgresLifecycleBoundaries {
  readonly connectStartedAtMs: number;
  readonly dnsEndedAtMs: number | null;
  readonly tcpConnectedAtMs: number | null;
  readonly tlsStartedAtMs: number | null;
  readonly tlsSecureAtMs: number | null;
  readonly postgresReadyAtMs: number | null;
  readonly firstQueryStartedAtMs: number | null;
  readonly firstQueryEndedAtMs: number | null;
  readonly closeStartedAtMs: number | null;
  readonly closeEndedAtMs: number | null;
  readonly sslExpected: boolean;
}

export interface FreshPostgresAttemptReceipt {
  readonly attemptId: number;
  readonly observedAt: string;
  readonly success: boolean;
  readonly dnsState: 'MEASURED' | 'UNAVAILABLE' | 'FAILED';
  readonly dnsMs: number | null;
  readonly tcpMs: number | null;
  readonly tcpIncludesDns: boolean;
  readonly tlsState: 'MEASURED' | 'NOT_APPLICABLE' | 'UNAVAILABLE' | 'FAILED';
  readonly tlsMs: number | null;
  readonly postgresStartupMs: number | null;
  readonly totalConnectionMs: number | null;
  readonly firstQueryMs: number | null;
  readonly closeMs: number | null;
  readonly failurePhase: FreshPostgresFailurePhase | null;
  readonly errorCode: string | null;
  readonly postmasterStart: string | null;
  readonly databaseConnections: number | null;
  readonly activeConnections: number | null;
  readonly idleConnections: number | null;
  readonly idleInTransactionConnections: number | null;
  readonly lockWaitingConnections: number | null;
  readonly longTransactionConnections: number | null;
  readonly backendPid: number | null;
}

export interface FreshPostgresCampaignSummary {
  readonly sampleN: number;
  readonly successN: number;
  readonly failureN: number;
  readonly minMs: number | null;
  readonly p50Ms: number | null;
  readonly p90Ms: number | null;
  readonly p95Ms: number | null;
  readonly p99Ms: number | null;
  readonly maxMs: number | null;
  readonly countOver5000Ms: number;
  readonly failureClasses: Readonly<Record<string, number>>;
  readonly postmasterStable: boolean | null;
  readonly maxDatabaseConnections: number | null;
  readonly maxIdleInTransactionConnections: number | null;
  readonly maxLockWaitingConnections: number | null;
  readonly maxLongTransactionConnections: number | null;
}

const elapsed = (end: number | null, start: number | null): number | null =>
  end === null || start === null ? null : Math.max(0, Number((end - start).toFixed(3)));

export function classifyFreshPostgresFailurePhase(boundaries:FreshPostgresLifecycleBoundaries):FreshPostgresFailurePhase{
  if(boundaries.dnsEndedAtMs===null&&boundaries.tcpConnectedAtMs===null)return 'DNS';
  if(boundaries.tcpConnectedAtMs===null)return 'TCP';
  if(boundaries.sslExpected&&boundaries.tlsSecureAtMs===null)return 'TLS';
  if(boundaries.postgresReadyAtMs===null)return 'POSTGRES_STARTUP';
  if(boundaries.firstQueryEndedAtMs===null)return 'FIRST_QUERY';
  if(boundaries.closeStartedAtMs!==null&&boundaries.closeEndedAtMs===null)return 'CLIENT_CLOSE';
  return 'UNKNOWN';
}

export function buildFreshPostgresAttemptReceipt(input:{
  readonly attemptId:number;
  readonly observedAt:string;
  readonly boundaries:FreshPostgresLifecycleBoundaries;
  readonly dnsFailed:boolean;
  readonly tlsFailed:boolean;
  readonly errorCode:string|null;
  readonly postmasterStart:string|null;
  readonly databaseConnections:number|null;
  readonly activeConnections:number|null;
  readonly idleConnections:number|null;
  readonly idleInTransactionConnections:number|null;
  readonly lockWaitingConnections:number|null;
  readonly longTransactionConnections:number|null;
  readonly backendPid:number|null;
}):FreshPostgresAttemptReceipt{
  const {boundaries}=input;
  const connected=boundaries.postgresReadyAtMs!==null;
  const queryCompleted=boundaries.firstQueryEndedAtMs!==null;
  const closed=boundaries.closeEndedAtMs!==null;
  const success=connected&&queryCompleted&&closed&&input.errorCode===null;
  const dnsMeasured=boundaries.dnsEndedAtMs!==null;
  const tcpStart=dnsMeasured?boundaries.dnsEndedAtMs:boundaries.connectStartedAtMs;
  const tlsApplicable=boundaries.sslExpected;
  return {
    attemptId:input.attemptId,observedAt:input.observedAt,success,
    dnsState:input.dnsFailed?'FAILED':dnsMeasured?'MEASURED':'UNAVAILABLE',
    dnsMs:dnsMeasured?elapsed(boundaries.dnsEndedAtMs,boundaries.connectStartedAtMs):null,
    tcpMs:elapsed(boundaries.tcpConnectedAtMs,tcpStart),tcpIncludesDns:!dnsMeasured,
    tlsState:!tlsApplicable?'NOT_APPLICABLE':input.tlsFailed?'FAILED':
      boundaries.tlsSecureAtMs!==null?'MEASURED':'UNAVAILABLE',
    tlsMs:elapsed(boundaries.tlsSecureAtMs,boundaries.tlsStartedAtMs),
    postgresStartupMs:elapsed(boundaries.postgresReadyAtMs,
      tlsApplicable?boundaries.tlsSecureAtMs:boundaries.tcpConnectedAtMs),
    totalConnectionMs:elapsed(boundaries.postgresReadyAtMs,boundaries.connectStartedAtMs),
    firstQueryMs:elapsed(boundaries.firstQueryEndedAtMs,boundaries.firstQueryStartedAtMs),
    closeMs:elapsed(boundaries.closeEndedAtMs,boundaries.closeStartedAtMs),
    failurePhase:success?null:classifyFreshPostgresFailurePhase(boundaries),errorCode:input.errorCode,
    postmasterStart:input.postmasterStart,databaseConnections:input.databaseConnections,
    activeConnections:input.activeConnections,idleConnections:input.idleConnections,
    idleInTransactionConnections:input.idleInTransactionConnections,
    lockWaitingConnections:input.lockWaitingConnections,longTransactionConnections:input.longTransactionConnections,
    backendPid:input.backendPid,
  };
}

function percentile(values:readonly number[],fraction:number,minimumN=1):number|null{
  if(values.length<minimumN)return null;
  const sorted=[...values].sort((a,b)=>a-b);
  const rank=Math.ceil(fraction*sorted.length)-1;
  const value=sorted[Math.max(0,Math.min(sorted.length-1,rank))];
  return value===undefined?null:Number(value.toFixed(3));
}

const maxNullable=(values:readonly (number|null)[]):number|null=>{
  const known=values.filter((value):value is number=>value!==null);
  return known.length===0?null:Math.max(...known);
};

export function summarizeFreshPostgresCampaign(attempts:readonly FreshPostgresAttemptReceipt[]):FreshPostgresCampaignSummary{
  const successful=attempts.filter((attempt)=>attempt.success&&attempt.totalConnectionMs!==null);
  const durations=successful.map((attempt)=>attempt.totalConnectionMs as number);
  const failureClasses:Record<string,number>={};
  for(const attempt of attempts.filter((value)=>!value.success)){
    const key=`${attempt.failurePhase??'UNKNOWN'}:${attempt.errorCode??'UNKNOWN'}`;
    failureClasses[key]=(failureClasses[key]??0)+1;
  }
  const postmasters=new Set(attempts.map((attempt)=>attempt.postmasterStart).filter((value):value is string=>value!==null));
  return {sampleN:attempts.length,successN:successful.length,failureN:attempts.length-successful.length,
    minMs:durations.length===0?null:Number(Math.min(...durations).toFixed(3)),
    p50Ms:percentile(durations,0.50),p90Ms:percentile(durations,0.90,10),p95Ms:percentile(durations,0.95,20),
    p99Ms:percentile(durations,0.99,100),maxMs:durations.length===0?null:Number(Math.max(...durations).toFixed(3)),
    countOver5000Ms:durations.filter((value)=>value>5_000).length,failureClasses,
    postmasterStable:postmasters.size===0?null:postmasters.size===1,
    maxDatabaseConnections:maxNullable(attempts.map((value)=>value.databaseConnections)),
    maxIdleInTransactionConnections:maxNullable(attempts.map((value)=>value.idleInTransactionConnections)),
    maxLockWaitingConnections:maxNullable(attempts.map((value)=>value.lockWaitingConnections)),
    maxLongTransactionConnections:maxNullable(attempts.map((value)=>value.longTransactionConnections))};
}

export async function executeFreshPostgresLifecycle<T>(stages:{
  readonly connect:()=>Promise<void>;
  readonly firstQuery:()=>Promise<T>;
  readonly close:()=>Promise<void>;
}):Promise<{readonly queryResult:T|null;readonly error:unknown;readonly closeError:unknown}>{
  let queryResult:T|null=null;
  let error:unknown=null;
  let closeError:unknown=null;
  try{
    await stages.connect();
    queryResult=await stages.firstQuery();
  }catch(caught){error=caught;}
  finally{
    try{await stages.close();}catch(caught){closeError=caught;if(error===null)error=caught;}
  }
  return {queryResult,error,closeError};
}
