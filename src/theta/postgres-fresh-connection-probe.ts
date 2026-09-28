import { Socket } from 'node:net';
import type { TLSSocket } from 'node:tls';
import pg from 'pg';
import { buildFreshPostgresAttemptReceipt, executeFreshPostgresLifecycle,
  type FreshPostgresAttemptReceipt, type FreshPostgresLifecycleBoundaries } from './postgres-connection-characterization.js';
import { classifyPostgresRuntimeError } from './postgres-runtime-error.js';

type StatsRow={postmaster_start?:unknown;database_connections?:unknown;active_connections?:unknown;
  idle_connections?:unknown;idle_in_transaction_connections?:unknown;lock_waiting_connections?:unknown;
  long_transaction_connections?:unknown;backend_pid?:unknown};

const numberOrNull=(value:unknown):number|null=>{
  const parsed=Number(value);return Number.isFinite(parsed)?parsed:null;
};

export interface InstrumentedFreshPostgresAttemptOptions {
  readonly connectionString:string;
  readonly connectionTimeoutMillis:number;
  readonly applicationName:string;
  readonly attemptId:number;
}

export async function runInstrumentedFreshPostgresAttempt(
  options:InstrumentedFreshPostgresAttemptOptions):Promise<FreshPostgresAttemptReceipt>{
  const observedAt=new Date().toISOString();
  const connectStartedAtMs=performance.now();
  let dnsEndedAtMs:number|null=null;
  let tcpConnectedAtMs:number|null=null;
  let tlsStartedAtMs:number|null=null;
  let tlsSecureAtMs:number|null=null;
  let postgresReadyAtMs:number|null=null;
  let firstQueryStartedAtMs:number|null=null;
  let firstQueryEndedAtMs:number|null=null;
  let closeStartedAtMs:number|null=null;
  let closeEndedAtMs:number|null=null;
  let dnsFailed=false;
  let tlsFailed=false;
  let stats:StatsRow|undefined;
  const connectionUrl=new URL(options.connectionString);
  const sslExpected=!['disable','false','0'].includes(
    connectionUrl.searchParams.get('sslmode')?.toLowerCase()??'require');
  const socket=new Socket();
  socket.once('lookup',(error)=>{dnsEndedAtMs=performance.now();dnsFailed=error!==null;});
  socket.once('connect',()=>{tcpConnectedAtMs=performance.now();});
  const client=new pg.Client({connectionString:options.connectionString,
    connectionTimeoutMillis:options.connectionTimeoutMillis,application_name:options.applicationName,
    stream:()=>socket});
  client.connection.once('sslconnect',()=>{
    tlsStartedAtMs=performance.now();
    const secureStream=client.connection.stream as TLSSocket;
    secureStream.once('secureConnect',()=>{tlsSecureAtMs=performance.now();});
    secureStream.once('tlsClientError',()=>{tlsFailed=true;});
  });
  const lifecycle=await executeFreshPostgresLifecycle({
    connect:async()=>{await client.connect();postgresReadyAtMs=performance.now();},
    firstQuery:async()=>{
      firstQueryStartedAtMs=performance.now();
      const result=await client.query<StatsRow>(`SELECT pg_postmaster_start_time()::text AS postmaster_start,
        pg_backend_pid()::int AS backend_pid,
        count(*) FILTER (WHERE datname=current_database())::int AS database_connections,
        count(*) FILTER (WHERE datname=current_database() AND state='active')::int AS active_connections,
        count(*) FILTER (WHERE datname=current_database() AND state='idle')::int AS idle_connections,
        count(*) FILTER (WHERE datname=current_database() AND state='idle in transaction')::int
          AS idle_in_transaction_connections,
        count(*) FILTER (WHERE datname=current_database() AND wait_event_type='Lock')::int AS lock_waiting_connections,
        count(*) FILTER (WHERE datname=current_database() AND xact_start IS NOT NULL
          AND clock_timestamp()-xact_start > interval '30 seconds')::int AS long_transaction_connections
        FROM pg_stat_activity`);
      firstQueryEndedAtMs=performance.now();stats=result.rows[0];return stats;
    },
    close:async()=>{closeStartedAtMs=performance.now();await client.end();closeEndedAtMs=performance.now();},
  });
  const error=lifecycle.error??lifecycle.closeError;
  const boundaries:FreshPostgresLifecycleBoundaries={connectStartedAtMs,dnsEndedAtMs,tcpConnectedAtMs,tlsStartedAtMs,
    tlsSecureAtMs,postgresReadyAtMs,firstQueryStartedAtMs,firstQueryEndedAtMs,closeStartedAtMs,closeEndedAtMs,sslExpected};
  return buildFreshPostgresAttemptReceipt({attemptId:options.attemptId,observedAt,boundaries,dnsFailed,tlsFailed,
    errorCode:error===null?null:classifyPostgresRuntimeError(error).safeCode,
    postmasterStart:typeof stats?.postmaster_start==='string'?stats.postmaster_start:null,
    databaseConnections:numberOrNull(stats?.database_connections),activeConnections:numberOrNull(stats?.active_connections),
    idleConnections:numberOrNull(stats?.idle_connections),
    idleInTransactionConnections:numberOrNull(stats?.idle_in_transaction_connections),
    lockWaitingConnections:numberOrNull(stats?.lock_waiting_connections),
    longTransactionConnections:numberOrNull(stats?.long_transaction_connections),backendPid:numberOrNull(stats?.backend_pid)});
}
