import { createHash, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import type { Environment } from '../config/environment.js';
import { AlpacaPaperBrokerAdapter, AlpacaPaperBrokerError, type PaperBrokerAdapter } from '../execution/broker.js';
import {
  PostgresBrokerReconciliationStore, runReadOnlyBrokerReconciliation,
  type BrokerReconciliationResult,
} from '../execution/broker-reconciliation-worker.js';
import { MasterEncryptedStoreBrokerCredentialProvider } from '../customer/broker-credential-provider.js';
import { customerStoreFromPool } from '../customer/customer-store.js';
import { dispatchDueJobs, type DueJob } from './scheduler-engine.js';
import type { JobRunResult, JobType } from './scheduler.js';
import { PostgresSchedulerCheckpointRepository } from './postgres-scheduler-checkpoint-repository.js';
import { PostgresManagementInputStore, type ManagementInputState } from './management-input-state.js';
import {
  buildManagementActionFrontier,
  type ManagementActionFrontier,
  type ManagementPolicyEvidence,
} from './management-action-frontier.js';
import { applyConfirmedTerminalLifecycle } from '../execution/postgres-broker-lifecycle-orchestrator.js';
import { asReadOnlyPaperBroker, assertShadowBrokerHasNoMutationSurface, type ReadOnlyPaperBroker } from '../execution/read-only-paper-broker.js';
import type { AlpacaProviderConfig } from './alpaca-provider.js';
import { processDueExecutionObservations, runProductionShadowEvidenceScan } from '../research/production-shadow-runtime.js';
import { shadowSessionDecision } from '../research/shadow-evidence-runtime.js';
import { applyConfirmedFillLifecycle } from '../execution/postgres-broker-fill-lifecycle-orchestrator.js';
import { PostgresMasterPaperActionPlanStore } from '../execution/postgres-master-paper-action-plan-store.js';
import { AlpacaExecutionQuoteSource } from '../execution/alpaca-execution-quote-source.js';
import { PostgresPaperOrderStore } from '../execution/postgres-paper-order-store.js';
import { PaperOrderCoordinator } from '../execution/paper-order-coordinator.js';
import { MasterPaperExecutionOrchestrator } from '../execution/master-paper-execution-orchestrator.js';
import {
  MasterPaperActionHandoff, classifyMasterPaperActionExecution, paperBootstrapPreSubmitQuoteAgePolicy,
} from '../execution/master-paper-action-handoff.js';
import { assembleManagementPaperPlans, compileManagementExecutionLegDirectives } from '../execution/management-paper-plan-assembly.js';
import { AlpacaProviderError } from './alpaca-provider.js';
import { OptionomicsProviderError } from './optionomics-provider.js';
import { PostgresShadowManagementPolicyStore } from './shadow-management-policy.js';
import { PostgresP2EEvidenceStore } from './p2e-evidence-store.js';
import { PostgresOperatorControlStore } from '../customer/operator-control.js';
import {
  PostgresPaperExecutionAuthorizationStore, resolveEffectivePaperExecutionControl,
} from '../execution/paper-execution-authorization.js';
import { createPaperBootstrapManagementPolicyProvider } from './paper-bootstrap-management-policy.js';
import { ProductionPaperManagementCandidateSource } from './production-paper-management-candidate-source.js';
import type { SchedulerCheckpointRecord } from './persistence-repositories.js';
import { PostgresExecutionEvidenceStore } from '../execution/postgres-execution-evidence-store.js';
import { persistConfirmedFillTca } from '../execution/confirmed-fill-tca.js';
import { classifyPostgresRuntimeError } from './postgres-runtime-error.js';

export const autonomousRuntimeVersion = 'theta-autonomous-runtime-v1' as const;
export const autonomousPolicyVersion = 'theta-scheduler-policy-v1' as const;
export const masterPaperRuntimeMode = 'MASTER_THETA_PAPER' as const;
export const executionQuoteBlocker = 'EXTERNAL_QUOTE_BLOCKER' as const;
const PAPER_HOST = 'https://paper-api.alpaca.markets' as const;

export function classifyRuntimeExecutionGate(input: {
  readonly executionQuoteAuthorityReady: boolean;
  readonly newRiskSubmissionEnabled: boolean;
  readonly managementPolicyProviderReady: boolean;
  readonly firstCanarySubmissionAvailable: boolean;
}): typeof executionQuoteBlocker | 'LOCKED' | 'ACTIVE' {
  if (!input.executionQuoteAuthorityReady) return executionQuoteBlocker;
  return input.newRiskSubmissionEnabled && input.managementPolicyProviderReady
    && input.firstCanarySubmissionAvailable ? 'ACTIVE' : 'LOCKED';
}

export interface AutonomousRuntimeReport {
  readonly correlationId: string;
  readonly status: 'DUPLICATE' | 'SUCCEEDED' | 'DEGRADED' | 'FAILED' | 'QUARANTINED';
  readonly runtimeVersion: string;
  readonly policyVersion: string;
  readonly jobsAttempted: number;
  readonly jobsCompleted: number;
  readonly jobResults: readonly {
    readonly jobType: JobType;
    readonly outcome: string;
    readonly status: string | null;
    readonly errorCode: string | null;
  }[];
  readonly reconciliation: BrokerReconciliationResult | null;
  readonly runtimeMode: typeof masterPaperRuntimeMode;
  readonly executionGate: typeof executionQuoteBlocker | 'LOCKED' | 'ACTIVE';
  readonly masterPaperOrdersSubmitted: number;
  readonly followerPaperOrdersSubmitted: 0;
  readonly liveOrdersSubmitted: 0;
}

interface MasterRuntimeContext {
  readonly connectionId: string;
  readonly providerAccountRef: string;
  readonly executionAccountId: string | null;
  readonly optionsCapabilityVerified: boolean;
  readonly broker: ReadOnlyPaperBroker;
  readonly executionBroker: PaperBrokerAdapter;
  readonly alpaca: AlpacaProviderConfig;
}

const minuteBucket = (date: Date): string => date.toISOString().slice(0, 16);
const accountHash = (value: string): string => createHash('sha256').update(value).digest('hex');

export function safeRuntimeFailure(error: unknown): { code: string; detail: string } {
  if (error instanceof AlpacaPaperBrokerError) {
    const operation = error.message.includes('/v2/account/activities') ? 'ACCOUNT_ACTIVITIES'
      : error.message.includes('/v2/positions') ? 'POSITIONS'
        : error.message.includes('/v2/orders') ? 'ORDERS'
          : error.message.includes('/v2/calendar') ? 'CALENDAR'
            : error.message.includes('/v2/clock') ? 'CLOCK'
              : error.message.includes('/v2/account') ? 'ACCOUNT' : 'UNKNOWN_OPERATION';
    const status = error.httpStatus === null ? 'NO_HTTP_STATUS' : `HTTP_${error.httpStatus}`;
    return { code: `ALPACA_${operation}_${error.category}_${status}`,
      detail: `Alpaca PAPER ${operation} failed with ${status}.` };
  }
  if (error instanceof AlpacaProviderError) {
    const status = error.httpStatus === null ? 'NO_HTTP_STATUS' : `HTTP_${error.httpStatus}`;
    return { code:`ALPACA_PROVIDER_${error.errorClass}_${status}`,
      detail:`Alpaca PAPER data operation failed with ${error.errorClass} and ${status}.` };
  }
  if (error instanceof OptionomicsProviderError) {
    const status = error.httpStatus === null ? 'NO_HTTP_STATUS' : `HTTP_${error.httpStatus}`;
    return { code:`OPTIONOMICS_PROVIDER_${error.errorClass}_${status}`,
      detail:`Optionomics operation failed with ${error.errorClass} and ${status}.` };
  }
  const databaseFailure = classifyPostgresRuntimeError(error);
  if (databaseFailure.retryableRead || databaseFailure.safeCode === 'POSTGRES_COMMIT_OUTCOME_UNKNOWN') {
    return { code: databaseFailure.safeCode,
      detail: 'PostgreSQL connection or service became unavailable; the decision cycle failed closed.' };
  }
  if (error !== null && typeof error === 'object') {
    const record=error as {code?:unknown;constraint?:unknown};
    if(typeof record.code==='string'&&/^[0-9A-Z]{5}$/.test(record.code)){
      const constraint=typeof record.constraint==='string'&&/^[a-zA-Z0-9_]{1,96}$/.test(record.constraint)
        ? record.constraint.toUpperCase():'';
      return {code:`POSTGRES_${record.code}${constraint?`_${constraint}`:''}`,
        detail:`PostgreSQL operation failed with SQLSTATE ${record.code}${constraint?` at ${constraint}`:''}.`};
    }
  }
  if (error instanceof Error && /^[A-Z0-9_:-]+$/.test(error.message)) return { code: error.message, detail: error.message };
  return { code: 'RUNTIME_OPERATION_FAILED', detail: 'The runtime operation failed without exposing sensitive error data.' };
}

export class PostgresRuntimeCycleStore {
  constructor(private readonly pool: Pool) {}

  async begin(correlationId: string, workerInstance: string, at: string): Promise<boolean> {
    // The platform request is bounded at five minutes. A row older than the
    // six-minute request lease plus margin cannot still represent a live run.
    // This runs only after DB recovery; no interrupted cycle becomes WAIT.
    await this.pool.query(
      `WITH stale AS (SELECT worker_cycle_id FROM ops.runtime_worker_cycle
         WHERE status='RUNNING' AND invoked_at < $1::timestamptz - interval '7 minutes'
         ORDER BY invoked_at LIMIT 32 FOR UPDATE SKIP LOCKED)
       UPDATE ops.runtime_worker_cycle c SET status='FAILED',completed_at=$1,heartbeat_at=$1,
         error_code='INTERRUPTED_STALE_LEASE',error_detail='INTERRUPTED_STALE_LEASE'
       FROM stale WHERE c.worker_cycle_id=stale.worker_cycle_id`, [at]);
    const result = await this.pool.query(
      `INSERT INTO ops.runtime_worker_cycle(
        correlation_id,worker_role,worker_instance,runtime_version,policy_version,invoked_at,heartbeat_at,status)
       VALUES($1,'THETA_PAPER_RUNTIME',$2,$3,$4,$5,$5,'RUNNING')
       ON CONFLICT(correlation_id) DO NOTHING RETURNING worker_cycle_id`,
      [correlationId, workerInstance, autonomousRuntimeVersion, autonomousPolicyVersion, at],
    );
    return result.rowCount === 1;
  }

  async finish(correlationId: string, report: AutonomousRuntimeReport, at: string): Promise<void> {
    const error = report.jobResults.find((result) => result.status === 'FAILED' || result.status === 'QUARANTINED');
    await this.pool.query(
      `UPDATE ops.runtime_worker_cycle SET completed_at=$2,heartbeat_at=$2,status=$3,
         jobs_attempted=$4,jobs_completed=$5,error_code=$6,error_detail=$7,result_json=$8::jsonb
       WHERE correlation_id=$1 AND status='RUNNING'`,
      [correlationId, at, report.status, report.jobsAttempted, report.jobsCompleted,
        error?.errorCode ?? null, error?.errorCode ?? null,
        JSON.stringify({ runtimeMode: report.runtimeMode, executionGate: report.executionGate,
          jobResults: report.jobResults, reconciliation: report.reconciliation })],
    );
  }

  async resolveMasterContext(environment: Environment): Promise<MasterRuntimeContext> {
    const resolved = await new MasterEncryptedStoreBrokerCredentialProvider(
      customerStoreFromPool(this.pool), environment,
    ).getAuthentication();
    if (resolved === null) throw new Error('MASTER_CREDENTIAL_NOT_FOUND');
    const connection = await this.pool.query(
      `SELECT follower_account_id FROM copy.follower_account
       WHERE customer_id=$1 AND provider_account_ref=$2 AND account_role='MASTER_THETA_PAPER'
         AND environment='PAPER' AND connection_status='CONNECTED' AND disconnected_at IS NULL`,
      [resolved.customerId, resolved.providerAccountRef],
    );
    if (connection.rowCount !== 1) throw new Error('MASTER_CONNECTION_ROLE_INVALID');
    const execution = await this.pool.query(
      `SELECT execution_account_id,account_ready,options_approved_level,options_trading_level FROM trade.execution_account
       WHERE provider_account_ref_hash=$1 AND environment='PAPER'`,
      [accountHash(resolved.providerAccountRef)],
    );
    const executionBroker=new AlpacaPaperBrokerAdapter({ baseUrl: PAPER_HOST, authentication: resolved.authentication });
    return {
      connectionId: String(connection.rows[0].follower_account_id),
      providerAccountRef: resolved.providerAccountRef,
      executionAccountId: execution.rows[0]?.execution_account_id == null ? null : String(execution.rows[0].execution_account_id),
      optionsCapabilityVerified: execution.rows[0]?.account_ready===true
        && Number(execution.rows[0]?.options_approved_level??0)>0
        && Number(execution.rows[0]?.options_trading_level??0)>0,
      broker: asReadOnlyPaperBroker(executionBroker),executionBroker,
      alpaca: { tradingApiBase:PAPER_HOST,marketDataApiBase:'https://data.alpaca.markets',
        apiKey:resolved.authentication.apiKey,apiSecret:resolved.authentication.apiSecret },
    };
  }

  async openChainCount(): Promise<number> {
    const result = await this.pool.query(`SELECT count(*)::int AS count FROM trade.economic_chain WHERE closed_at IS NULL`);
    return Number(result.rows[0]?.count ?? 0);
  }

  async pendingNearMisses(): Promise<readonly {candidateId:string;scanId:string;triggerKind:string;correlationKey:string}[]> {
    const result = await this.pool.query(
      `SELECT candidate_id,scan_id,trigger_kind,correlation_key FROM (
         SELECT DISTINCT ON (candidate_id) candidate_id,scan_id,trigger_kind,correlation_key,event_type
         FROM research.theta_near_miss_reevaluation_event
         ORDER BY candidate_id,occurred_at DESC,created_at DESC
       ) latest WHERE event_type='QUEUED' ORDER BY candidate_id`,
    );
    return result.rows.map((row)=>({candidateId:String(row.candidate_id),scanId:String(row.scan_id),
      triggerKind:String(row.trigger_kind),correlationKey:String(row.correlation_key)}));
  }

  async executionQuoteAuthorityReady(): Promise<boolean> {
    const result=await this.pool.query(`SELECT
      EXISTS(
        SELECT 1 FROM core.provider_capability pc
        JOIN core.provider_connection cn ON cn.provider_connection_id=pc.provider_connection_id
        WHERE cn.provider_code='ALPACA' AND pc.capability_code IN (
          'OPTIONS_MARKET_DATA_OPRA','OPTIONS_MARKET_DATA_INDICATIVE','CURRENT_OPTION_SNAPSHOTS_INDICATIVE'
        )
          AND pc.status='GOOD' AND pc.entitlement IN ('AVAILABLE','AVAILABLE_WITH_LIMITS')
      ) OR EXISTS(
        SELECT 1 FROM research.quote_provider_qualification_receipt
        WHERE provider='ALPACA' AND semantics='PAPER_INDICATIVE_REFERENCE' AND qualified=true
          AND entitlement_state='QUALIFIED' AND attempted_at>now()-interval '1 hour'
      ) OR EXISTS(
        SELECT 1 FROM research.optionomics_quote_qualification_run
        WHERE ready=true AND readiness_state='READY' AND semantic_authority='ORDER_PRICING_DOCUMENTED'
      ) AS ready`);
    return result.rows[0]?.ready===true;
  }

  async firstCanarySubmissionAvailable():Promise<boolean>{
    const result=await this.pool.query(`SELECT count(*)::int AS count FROM trade.broker_order`);
    return Number(result.rows[0]?.count??0)===0;
  }

  async markNearMissesTriggered(
    pending:readonly {candidateId:string;scanId:string;triggerKind:string;correlationKey:string}[],
    occurredAt:string,sourceCycle:string,
  ):Promise<number>{
    let recorded=0;
    for(const item of pending){
      const payload={candidateId:item.candidateId,sourceCycle,triggeredAt:occurredAt,triggerKind:item.triggerKind};
      const contentHash=createHash('sha256').update(JSON.stringify(payload)).digest('hex');
      const result=await this.pool.query(`INSERT INTO research.theta_near_miss_reevaluation_event(
        near_miss_event_id,scan_id,candidate_id,event_type,trigger_kind,occurred_at,correlation_key,
        reason_codes_json,trigger_payload_json,policy_version,content_hash,created_at)
        VALUES($1,$2,$3,'TRIGGERED',$4,$5,$6,'["FULL_FRONTIER_RESCAN_COMPLETED"]'::jsonb,$7::jsonb,$8,$9,$5)
        ON CONFLICT(content_hash) DO NOTHING`,[randomUUID(),item.scanId,item.candidateId,item.triggerKind,occurredAt,
          item.correlationKey,JSON.stringify(payload),autonomousPolicyVersion,contentHash]);
      recorded+=result.rowCount??0;
    }
    return recorded;
  }
}

export interface ManagementPolicyEvidenceProvider {
  readonly authority: 'PAPER_BOOTSTRAP_MANAGEMENT_POLICY' | 'EMPIRICALLY_PROMOTED_MANAGEMENT_POLICY';
  evaluate(state: ManagementInputState): Promise<ManagementPolicyEvidence | null>;
}

export interface AutonomousRuntimeDependencies {
  readonly managementPolicyEvidenceProvider?: ManagementPolicyEvidenceProvider;
  readonly scope?: 'FULL' | 'CORE' | 'BROKER' | 'LIFECYCLE' | 'MANAGEMENT' | 'OBSERVATION' | 'EVIDENCE';
  // Phase 1 Zero-Unknown Reclosure Pass 3 (item 2): the same source/worker
  // identity `inspectRuntimeSchemaCompatibility` already gates this cycle on
  // in autonomous-runtime-handler.ts, threaded through so the decision this
  // cycle persists carries the release identity that produced it. Never
  // recomputed independently here -- one identity, one source of truth.
  readonly releaseIdentity?: { readonly sourceSha: string | null; readonly workerSha: string | null };
}

/**
 * Connects an optional, validated policy service to the canonical frontier.
 * Absence, timeout handling by the provider, or a null result remains a
 * conservative passive action. The frontier independently validates the
 * input hash, timestamp, complete comparison, and selected argmax.
 */
export async function buildRuntimeManagementFrontiers(
  states: readonly ManagementInputState[],
  provider?: ManagementPolicyEvidenceProvider,
): Promise<readonly ManagementActionFrontier[]> {
  if (provider === undefined) return states.map((state) => buildManagementActionFrontier(state));
  const evidence = await Promise.all(states.map((state) => provider.evaluate(state)));
  return states.map((state, index) => buildManagementActionFrontier(state, evidence[index] ?? null));
}

function isRetryableExternalExecutionFailure(error:unknown):boolean{
  if(error instanceof AlpacaProviderError)return true;
  return error instanceof AlpacaPaperBrokerError&&error.category!=='BROKER_REJECTED';
}

export const jobTypesForScope=(scope:'FULL'|'CORE'|'BROKER'|'LIFECYCLE'|'MANAGEMENT'|'OBSERVATION'|'EVIDENCE'):readonly JobType[]=>{
  const all:readonly JobType[]=[
    'POSITION_RECONCILIATION', 'ORDER_RECONCILIATION', 'POSITION_MANAGEMENT_SCAN',
    'ASSIGNMENT_EXPIRY_RECONCILIATION', 'PENDING_ORDER_MANAGEMENT', 'WAIT_RECHECK',
    'OPPORTUNITY_SCAN', 'PAPER_EXECUTION_HANDOFF', 'ACCOUNT_STATE_REFRESH', 'MARKET_STATE_REFRESH',
    'COPY_FANOUT_PREPARATION', 'HEALTH_HEARTBEAT',
  ];
  if(scope==='FULL')return all;
  if(scope==='EVIDENCE')return ['POSITION_RECONCILIATION','WAIT_RECHECK','OPPORTUNITY_SCAN'];
  if(scope==='MANAGEMENT')return ['POSITION_RECONCILIATION','POSITION_MANAGEMENT_SCAN','PAPER_EXECUTION_HANDOFF'];
  if(scope==='LIFECYCLE')return ['POSITION_RECONCILIATION','ASSIGNMENT_EXPIRY_RECONCILIATION'];
  if(scope==='OBSERVATION')return ['POSITION_RECONCILIATION','MARKET_STATE_REFRESH'];
  if(scope==='BROKER')return ['POSITION_RECONCILIATION','ORDER_RECONCILIATION','PENDING_ORDER_MANAGEMENT',
    'ACCOUNT_STATE_REFRESH','COPY_FANOUT_PREPARATION','HEALTH_HEARTBEAT'];
  return all.filter((jobType)=>jobType!=='WAIT_RECHECK'&&jobType!=='OPPORTUNITY_SCAN');
};

const autonomousSchedulerMaxAttempts=3;
const safeToSupersedeAfterExhaustion=new Set<JobType>([
  'OPPORTUNITY_SCAN','WAIT_RECHECK','MARKET_STATE_REFRESH','ACCOUNT_STATE_REFRESH','HEALTH_HEARTBEAT',
]);

/**
 * Keep an exhausted read-only checkpoint as audit evidence without allowing
 * it to suppress every later minute bucket of the same job family. Broker
 * mutation and lifecycle checkpoints remain fail-closed for operator review.
 */
export function shouldRecoverRuntimeCheckpoint(record:Pick<SchedulerCheckpointRecord,'jobKind'|'attempt'>):boolean{
  const kind=record.jobKind as JobType;
  return record.attempt<autonomousSchedulerMaxAttempts||!safeToSupersedeAfterExhaustion.has(kind);
}

/**
 * Phase 2 Pass B Final Closure C (directive section 10-12): the exact,
 * pure decision the PAPER_EXECUTION_HANDOFF job makes from the broker
 * reconciliation's own `marketOpen` field -- extracted so it is directly
 * unit-testable without a Postgres pool, a broker client, or any part of
 * the surrounding job-scheduling machinery. Behavior is unchanged from the
 * inline check it replaces: `null` means "proceed" (the caller's own
 * `reconciliation===null` check runs first and is unaffected by this
 * function), `'MARKET_CLOSED_NO_PAPER_EXECUTION'` means the caller must
 * `skipped(...)` with that exact code, matching what the same string
 * meant before extraction.
 */
export function paperExecutionHandoffMarketGate(
  reconciliation: Pick<BrokerReconciliationResult, 'marketOpen'>,
): 'MARKET_CLOSED_NO_PAPER_EXECUTION' | null {
  return reconciliation.marketOpen !== true ? 'MARKET_CLOSED_NO_PAPER_EXECUTION' : null;
}

function scheduledJobs(bucket: string,scope:'FULL'|'CORE'|'BROKER'|'LIFECYCLE'|'MANAGEMENT'|'OBSERVATION'|'EVIDENCE'): readonly DueJob[] {
  return jobTypesForScope(scope).map((jobType) => ({ jobType, correlationKey: `${bucket}:${scope.toLowerCase()}` }));
}

const succeeded = (): JobRunResult => ({ status: 'SUCCEEDED', errorCode: null, errorDetail: null, nextRunAt: null });
const skipped = (code: string): JobRunResult => ({ status: 'SKIPPED', errorCode: code, errorDetail: code, nextRunAt: null });
const degraded = (code: string, nextRunAt: string): JobRunResult => ({ status: 'DEGRADED', errorCode: code, errorDetail: code, nextRunAt });

/**
 * Runs one bounded, restart-safe master Paper cycle. Reconciliation,
 * management, scanning, evidence, and decision work remain active regardless
 * of whether new risk is locked. The only broker mutation seam is the typed
 * Paper action handoff, which cannot bypass quote, control, or canary gates.
 */
export async function runAutonomousRuntimeCycle(
  environment: Environment,
  pool: Pool,
  now = new Date(),
  dependencies: AutonomousRuntimeDependencies = {},
): Promise<AutonomousRuntimeReport> {
  if (!environment.THETA_AUTONOMOUS_WORKER_ENABLED) throw new Error('THETA_AUTONOMOUS_WORKER_DISABLED');
  if (!environment.DATABASE_URL) throw new Error('DATABASE_CONNECTION_NOT_CONFIGURED');
  if (environment.FOLLOWER_PAPER_EXECUTION_ENABLED) throw new Error('FOLLOWER_PAPER_EXECUTION_NOT_AUTHORIZED');
  if (environment.THETA_RUNTIME_MODE !== masterPaperRuntimeMode) throw new Error('MASTER_THETA_PAPER_RUNTIME_REQUIRED');
  // The resident/serverless runtime already owns a bounded canonical pool.
  // Sharing it avoids adding a short-lived two-client pool to every cycle.
  const operatorStore=new PostgresOperatorControlStore(pool);
  const operatorControl=await operatorStore.current(environment.PAPER_PAUSE_NEW_ORDERS);
  const persistedExecutionControl=await new PostgresPaperExecutionAuthorizationStore(pool).current();
  if(persistedExecutionControl.followerExecutionEnabled||environment.FOLLOWER_PAPER_EXECUTION_ENABLED)
    throw new Error('FOLLOWER_PAPER_EXECUTION_NOT_AUTHORIZED');
  const executionControl=resolveEffectivePaperExecutionControl({
    environmentMasterEnabled:environment.MASTER_PAPER_EXECUTION_ENABLED,
    environmentFollowerEnabled:environment.FOLLOWER_PAPER_EXECUTION_ENABLED,
    environmentPauseNewOrders:environment.PAPER_PAUSE_NEW_ORDERS,
    persisted:persistedExecutionControl,operatorNewEntriesPaused:operatorControl.newEntriesPaused,
    operatorEmergencyExecutionLock:operatorControl.emergencyExecutionLock,
  });
  const pauseNewOrders=executionControl.pauseNewOrders;
  const masterExecutionEnabled=executionControl.masterEnabled;
  const managementPolicyEvidenceProvider=dependencies.managementPolicyEvidenceProvider
    ??createPaperBootstrapManagementPolicyProvider();
  const runtimeStore=new PostgresRuntimeCycleStore(pool);
  const [executionQuoteAuthorityReady,firstCanarySubmissionAvailable]=await Promise.all([
    runtimeStore.executionQuoteAuthorityReady(),runtimeStore.firstCanarySubmissionAvailable(),
  ]);
  const runtimeExecutionGate = classifyRuntimeExecutionGate({
    executionQuoteAuthorityReady,
    newRiskSubmissionEnabled: executionControl.newRiskSubmissionEnabled,
    managementPolicyProviderReady: managementPolicyEvidenceProvider !== undefined,
    firstCanarySubmissionAvailable,
  });
  const newRiskRuntimeEnabled = runtimeExecutionGate === 'ACTIVE';
  const bucket = minuteBucket(now);
  const scope=dependencies.scope??'FULL';
  const allowedJobTypes=new Set(jobTypesForScope(scope));
  const correlationId = `theta-runtime:${bucket}:${scope.toLowerCase()}`;
  const workerInstance = `${process.env.VERCEL_REGION ?? 'local'}:${randomUUID()}`;
  const cycleStore = new PostgresRuntimeCycleStore(pool);
  if (!await cycleStore.begin(correlationId, workerInstance, now.toISOString())) {
    return {
      correlationId, status: 'DUPLICATE', runtimeVersion: autonomousRuntimeVersion,
      policyVersion: autonomousPolicyVersion, jobsAttempted: 0, jobsCompleted: 0,
      jobResults: [], reconciliation: null, runtimeMode: masterPaperRuntimeMode,
      executionGate: runtimeExecutionGate,
      masterPaperOrdersSubmitted: 0, followerPaperOrdersSubmitted: 0, liveOrdersSubmitted: 0,
    };
  }
  try {
  const master = await cycleStore.resolveMasterContext(environment);
  assertShadowBrokerHasNoMutationSurface(master.broker);
  const checkpointStore = new PostgresSchedulerCheckpointRepository(pool, autonomousSchedulerMaxAttempts);
  const [expired, retryable] = await Promise.all([
    checkpointStore.findExpiredLeases(now.toISOString()),
    checkpointStore.findRetryableFailures(now.toISOString()),
  ]);
  const recoveredJobs: DueJob[] = [...expired, ...retryable].filter(shouldRecoverRuntimeCheckpoint).flatMap((record) => {
    const separator = record.jobId.indexOf(':');
    const kind = record.jobKind as JobType;
    return separator > 0 ? [{ jobType: kind, correlationKey: record.jobId.slice(separator + 1) }] : [];
  });
  // Run at most one logical job per family in a cycle. Historical failed
  // minute buckets are reconciled one at a time and suppress a fresh job of
  // the same family, preventing a restart from creating a retry storm.
  const recoveredByType=new Map<JobType,DueJob>();
  for(const job of recoveredJobs)if(allowedJobTypes.has(job.jobType)&&!recoveredByType.has(job.jobType))recoveredByType.set(job.jobType,job);
  const jobs=[...recoveredByType.values(),...scheduledJobs(bucket,scope).filter((job)=>!recoveredByType.has(job.jobType))];
  let reconciliation: BrokerReconciliationResult | null = null;
  let opportunityScanCompleted = false;
  let masterPaperOrdersSubmitted = 0;
  const retryAt = new Date(now.getTime() + 60_000).toISOString();

  const executor = async (jobType: JobType, _key: string, jobId: string): Promise<JobRunResult> => {
    try {
      if (jobType === 'POSITION_RECONCILIATION') {
        reconciliation = await runReadOnlyBrokerReconciliation({
          broker: master.broker, store: new PostgresBrokerReconciliationStore(pool),
          connectionId: master.connectionId, expectedProviderAccountRef: master.providerAccountRef,
          correlationId: jobId, now: () => new Date().toISOString(),
        });
        if (reconciliation.accountStatus !== 'ACTIVE') return degraded('MASTER_ACCOUNT_NOT_ACTIVE', retryAt);
        return reconciliation.dataQuality === 'GOOD'
          ? succeeded() : degraded('BROKER_SESSION_STATE_UNKNOWN', retryAt);
      }
      if (jobType === 'ORDER_RECONCILIATION') {
        if (reconciliation === null) return degraded('BROKER_RECONCILIATION_REQUIRED', retryAt);
        if (master.executionAccountId === null) return skipped('MASTER_EXECUTION_ACCOUNT_NOT_CREATED');
        return reconciliation.localOnlyIntentCount > 0
          ? degraded('AMBIGUOUS_ORDER_REQUIRES_READ_ONLY_RECONCILIATION', retryAt) : succeeded();
      }
      if (jobType === 'POSITION_MANAGEMENT_SCAN') {
        if (reconciliation === null) return degraded('BROKER_RECONCILIATION_REQUIRED', retryAt);
        const managementStore = new PostgresManagementInputStore(pool);
        // Candidate BBO must be observed and persisted before the immutable
        // management input freezes its decision timestamp. The candidate
        // producer enumerates only; this remains the one policy authority.
        const candidateDiscovery = await new ProductionPaperManagementCandidateSource(pool,master.alpaca)
          .discover(master.connectionId,reconciliation.snapshotId);
        const states = await managementStore.assembleAndPersistOpenChains(
          master.connectionId, reconciliation.snapshotId, reconciliation.observedAt,candidateDiscovery,
        );
        if (states.length === 0) return skipped('NO_OPEN_THETA_CHAINS');
        // Persist research-only profit-preservation and strategy-switching
        // evidence before the production policy boundary is evaluated. This
        // collector has no conversion path to ManagementPolicyEvidence and
        // therefore cannot authorize or dispatch a broker action.
        await new PostgresShadowManagementPolicyStore(pool).assembleAndPersist(states);
        const frontiers = await buildRuntimeManagementFrontiers(
          states, managementPolicyEvidenceProvider,
        );
        await new PostgresP2EEvidenceStore(pool).persistManagementEvidence(states,frontiers);
        const persistedFrontiers=await managementStore.persistFrontiers(states, frontiers);
        const actionPlanStore=new PostgresMasterPaperActionPlanStore(pool);
        for(let index=0;index<states.length;index+=1){
          const state=states[index],persisted=persistedFrontiers[index];
          if(state===undefined||persisted===undefined)throw new Error('MANAGEMENT_PERSISTENCE_ALIGNMENT_FAILED');
          const versions=state.context.strategyVersions;
          const strategyVersion=versions!==null&&typeof versions==='object'&&!Array.isArray(versions)
            ? (['strategyVersion','strategy_version','strategy'].map((key)=>(versions as Record<string,unknown>)[key])
              .find((value)=>typeof value==='string'&&value.trim()) as string|undefined)??null:null;
          const rawAegis=state.context.aegisState;
          const aegisState=typeof rawAegis==='string'&&['ALLOW_FULL','ALLOW_REDUCED','HOLD_ONLY','HARD_VETO'].includes(rawAegis)
            ? rawAegis as 'ALLOW_FULL'|'ALLOW_REDUCED'|'HOLD_ONLY'|'HARD_VETO':null;
          const compiled=compileManagementExecutionLegDirectives(state,persisted.frontier);
          if(compiled.state==='BLOCKED')return degraded(compiled.blockers[0]??'MANAGEMENT_LEG_COMPILATION_BLOCKED',retryAt);
          const assembly=assembleManagementPaperPlans({state,frontier:persisted.frontier,
            managementActionFrontierId:persisted.managementActionFrontierId,
            executionAccountId:master.executionAccountId,strategyVersion,accountStatus:reconciliation.accountStatus,
            optionsCapabilityVerified:master.optionsCapabilityVerified,aegisState,
            killSwitchActive:executionControl.emergencyExecutionLock||!executionControl.managementSubmissionEnabled,
            paperEvidenceRiskCap:environment.PAPER_EVIDENCE_RISK_CAP,executionLegs:compiled.legs,
            now:reconciliation.observedAt,decisionExpiresAt:new Date(Date.parse(reconciliation.observedAt)+30_000).toISOString()});
          if(assembly.state==='READY')await actionPlanStore.publishManagementPlans(assembly.decision,assembly.plans,reconciliation.observedAt);
          if(assembly.state==='BLOCKED')return degraded(assembly.blockers[0]??'MANAGEMENT_ACTION_PLAN_BLOCKED',retryAt);
        }
        if (states.some((state) => state.hardBlockers.length > 0)) {
          return degraded('MANAGEMENT_HARD_BLOCKERS_PRESENT', retryAt);
        }
        return degraded('EV_MODEL_NOT_EMPIRICALLY_READY', retryAt);
      }
      if (jobType === 'ASSIGNMENT_EXPIRY_RECONCILIATION') {
        if (reconciliation===null) return degraded('BROKER_RECONCILIATION_REQUIRED',retryAt);
        const lifecycle=await applyConfirmedTerminalLifecycle(pool,master.connectionId,reconciliation.snapshotId,reconciliation.observedAt);
        const fills=await applyConfirmedFillLifecycle(pool,master.connectionId,reconciliation.observedAt);
        const tca=await persistConfirmedFillTca(pool,master.connectionId,reconciliation.observedAt);
        if(tca.failed>0)return degraded('TCA_EVIDENCE_PERSISTENCE_FAILURE',retryAt);
        if(tca.missing>0)return degraded('TCA_EVIDENCE_MISSING',retryAt);
        return lifecycle.unresolved>0||fills.unresolved>0 ? degraded('BROKER_LIFECYCLE_FACTS_UNRESOLVED',retryAt) : succeeded();
      }
      if (jobType === 'PENDING_ORDER_MANAGEMENT') {
        if(reconciliation===null)return degraded('BROKER_RECONCILIATION_REQUIRED',retryAt);
        if(master.executionAccountId===null)return skipped('MASTER_EXECUTION_ACCOUNT_NOT_CREATED');
        const store=new PostgresPaperOrderStore(pool,master.executionAccountId);
        const coordinator=new PaperOrderCoordinator(master.executionBroker,store,{
          masterEnabled:masterExecutionEnabled,followerEnabled:false,
          pauseNewOrders});
        const recovered=await coordinator.recoverAfterRestart();
        if(recovered.some((item)=>!item.resolved))return degraded('AMBIGUOUS_ORDER_REQUIRES_READ_ONLY_RECONCILIATION',retryAt);
        const active=await store.activeIntents();
        for(const intent of active){
          const brokerOrder=await coordinator.reconcileIntent(intent.orderIntentId);
          if(brokerOrder===null)return degraded('LOCAL_ORDER_MISSING_AT_BROKER',retryAt);
        }
        return succeeded();
      }
      if (jobType === 'WAIT_RECHECK') {
        const pending=await cycleStore.pendingNearMisses();
        if(pending.length===0)return skipped('NO_DUE_WAIT_DECISIONS');
        const session=shadowSessionDecision(reconciliation?.marketOpen??null,reconciliation?.calendarSessionConfirmed??false);
        if(session==='MARKET_CLOSED')return skipped('MARKET_CLOSED_NO_WAIT_RECHECK');
        if(session!=='RUN')return degraded('OPTION_MARKET_SESSION_UNCONFIRMED',retryAt);
        const scan=await runProductionShadowEvidenceScan({environment,pool,alpaca:master.alpaca,
          executionAccountId:master.executionAccountId,reconciliation:reconciliation as BrokerReconciliationResult,
          now:()=>new Date().toISOString(),releaseIdentity:dependencies.releaseIdentity??null});
        if(scan.completeness!=='COMPLETE')return degraded(`WAIT_RECHECK_SCAN_${scan.completeness}`,retryAt);
        await cycleStore.markNearMissesTriggered(pending,new Date().toISOString(),scan.scanId);
        opportunityScanCompleted=true;
        return succeeded();
      }
      if (jobType === 'OPPORTUNITY_SCAN') {
        if(opportunityScanCompleted)return skipped('FULL_FRONTIER_ALREADY_RESCANNED');
        const session=shadowSessionDecision(reconciliation?.marketOpen??null,reconciliation?.calendarSessionConfirmed??false);
        if (session==='MARKET_CLOSED') return skipped('MARKET_CLOSED_NO_SHADOW_EVIDENCE');
        if (session!=='RUN') {
          return degraded('OPTION_MARKET_SESSION_UNCONFIRMED', retryAt);
        }
        const scan=await runProductionShadowEvidenceScan({environment,pool,alpaca:master.alpaca,
          executionAccountId:master.executionAccountId,reconciliation:reconciliation as BrokerReconciliationResult,
          now:()=>new Date().toISOString(),releaseIdentity:dependencies.releaseIdentity??null});
        return scan.completeness==='COMPLETE' ? succeeded() : degraded(`SHADOW_SCAN_${scan.completeness}`,retryAt);
      }
      if(jobType==='PAPER_EXECUTION_HANDOFF'){
        if(reconciliation===null)return degraded('BROKER_RECONCILIATION_REQUIRED',retryAt);
        {
          const marketGate=paperExecutionHandoffMarketGate(reconciliation);
          if(marketGate!==null)return skipped(marketGate);
        }
        if(!executionControl.managementSubmissionEnabled)
          return degraded('MASTER_PAPER_SUBMISSION_NOT_AUTHORIZED',retryAt);
        if(master.executionAccountId===null)return degraded('MASTER_EXECUTION_ACCOUNT_NOT_CREATED',retryAt);
        const planStore=new PostgresMasterPaperActionPlanStore(pool);
        const plan=await planStore.claimNext(master.executionAccountId,workerInstance,new Date().toISOString(),
          {allowNewRisk:newRiskRuntimeEnabled});
        if(plan===null)return skipped(pauseNewOrders?'NO_APPROVED_MANAGEMENT_ACTION_PLAN':'NO_APPROVED_MASTER_ACTION_PLAN');
        const coordinator=new PaperOrderCoordinator(master.executionBroker,new PostgresPaperOrderStore(pool,master.executionAccountId),{
          masterEnabled:masterExecutionEnabled,followerEnabled:false,pauseNewOrders});
        const handoff=new MasterPaperActionHandoff(new AlpacaExecutionQuoteSource(master.alpaca),
          new MasterPaperExecutionOrchestrator(coordinator,new PostgresExecutionEvidenceStore(pool)),
          paperBootstrapPreSubmitQuoteAgePolicy);
        try{
          const at=new Date().toISOString();
          const result=await handoff.execute(plan,at,true);
          if(result.state==='EXECUTED'&&result.execution!==null){
            const disposition=classifyMasterPaperActionExecution(result.execution);
            if(disposition==='WAIT_RECONCILIATION'){
              await planStore.wait(plan.actionPlanId,['BROKER_RECONCILIATION_REQUIRED'],retryAt,at);
              return degraded('BROKER_RECONCILIATION_REQUIRED',retryAt);
            }
            if(result.execution.submittedNow)masterPaperOrdersSubmitted+=1;
            if(disposition==='TERMINAL')await planStore.terminal(plan.actionPlanId,result.execution.orderIntentId,at);
            else await planStore.submitted(plan.actionPlanId,result.execution.orderIntentId,at);
            if(result.execution.submittedNow&&plan.decisionAuthority==='NEW_RISK'){
              const persistedLock=await new PostgresPaperExecutionAuthorizationStore(pool)
                .lockNewRiskAfterFirstCanary(at);
              if(!persistedLock)return degraded('FIRST_CANARY_RUNTIME_LOCKED_PERSISTED_CONTROL_PENDING',retryAt);
            }
            return succeeded();
          }
          await planStore.wait(plan.actionPlanId,result.blockers,retryAt,at);
          return degraded(result.blockers[0]??result.state,retryAt);
        }catch(error){
          const failure=safeRuntimeFailure(error);
          if(isRetryableExternalExecutionFailure(error)){
            await planStore.wait(plan.actionPlanId,[failure.code],retryAt,new Date().toISOString());
            return degraded(failure.code,retryAt);
          }
          await planStore.quarantine(plan.actionPlanId,[failure.code],new Date().toISOString());
          return {status:'QUARANTINED',errorCode:failure.code,errorDetail:failure.detail,nextRunAt:null};
        }
      }
      if (jobType === 'COPY_FANOUT_PREPARATION') return skipped('FOLLOWER_SUBMISSION_LOCKED');
      if (jobType === 'MARKET_STATE_REFRESH') {
        if (reconciliation === null || reconciliation.dataQuality !== 'GOOD') return degraded('BROKER_RECONCILIATION_REQUIRED',retryAt);
        await processDueExecutionObservations({pool,alpaca:master.alpaca,now:()=>new Date().toISOString()});
        return succeeded();
      }
      if (jobType === 'ACCOUNT_STATE_REFRESH') {
        return reconciliation === null || reconciliation.dataQuality !== 'GOOD'
          ? degraded('BROKER_RECONCILIATION_REQUIRED', retryAt) : succeeded();
      }
      return succeeded();
    } catch (error) {
      const failure = safeRuntimeFailure(error);
      return { status: 'FAILED', errorCode: failure.code, errorDetail: failure.detail, nextRunAt: retryAt };
    }
  };

  const outcomes = await dispatchDueJobs(checkpointStore, {
    workerId: workerInstance, workerVersion: autonomousRuntimeVersion, policyVersion: autonomousPolicyVersion,
    leaseDurationMs: 45_000, maxAttempts: 3,
  }, jobs, () => new Date().toISOString(), executor);
  const jobResults = outcomes.map((outcome) => ({
    jobType: outcome.jobType, outcome: outcome.outcome, status: outcome.runResult?.status ?? null,
    errorCode: outcome.runResult?.errorCode ?? null,
  }));
  const statuses = outcomes.flatMap((outcome) => outcome.runResult?.status ?? []);
  const status: AutonomousRuntimeReport['status'] = statuses.includes('QUARANTINED') ? 'QUARANTINED'
    : statuses.includes('FAILED') ? 'FAILED'
      : statuses.includes('DEGRADED') ? 'DEGRADED' : 'SUCCEEDED';
  const report: AutonomousRuntimeReport = {
    correlationId, status, runtimeVersion: autonomousRuntimeVersion, policyVersion: autonomousPolicyVersion,
    jobsAttempted: outcomes.length,
    jobsCompleted: outcomes.filter((outcome) => outcome.runResult !== null).length,
    jobResults, reconciliation, runtimeMode: masterPaperRuntimeMode,
    executionGate:runtimeExecutionGate,
    masterPaperOrdersSubmitted, followerPaperOrdersSubmitted: 0, liveOrdersSubmitted: 0,
  };
  await cycleStore.finish(correlationId, report, new Date().toISOString());
  return report;
  } catch (error) {
    const failure = safeRuntimeFailure(error);
    const report: AutonomousRuntimeReport = {
      correlationId, status: 'FAILED', runtimeVersion: autonomousRuntimeVersion,
      policyVersion: autonomousPolicyVersion, jobsAttempted: 0, jobsCompleted: 0,
      jobResults: [{ jobType: 'HEALTH_HEARTBEAT', outcome: 'STARTUP_FAILED', status: 'FAILED', errorCode: failure.code }],
      reconciliation: null, runtimeMode: masterPaperRuntimeMode,
      executionGate:runtimeExecutionGate,
      masterPaperOrdersSubmitted: 0, followerPaperOrdersSubmitted: 0, liveOrdersSubmitted: 0,
    };
    // If Aiven is still unavailable, retain the original failure for the HTTP
    // 503. The next healthy begin() marks the stranded RUNNING row as failed.
    await cycleStore.finish(correlationId, report, new Date().toISOString()).catch((finishError: unknown) => {
      if (!classifyPostgresRuntimeError(finishError).retryableRead) throw finishError;
    });
    return report;
  }
}
