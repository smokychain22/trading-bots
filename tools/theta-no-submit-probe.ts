import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { hostname } from 'node:os';
import { z } from 'zod';
import { loadEnvironmentFile } from '../src/config/environment.js';
import { AlpacaPaperBrokerAdapter } from '../src/execution/broker.js';
import { asReadOnlyPaperBroker, assertShadowBrokerHasNoMutationSurface } from '../src/execution/read-only-paper-broker.js';
import { PostgresBrokerReconciliationStore, runReadOnlyBrokerReconciliation } from '../src/execution/broker-reconciliation-worker.js';
import { runProductionShadowEvidenceScan } from '../src/research/production-shadow-runtime.js';
import { assertNoSubmitProbeGuard, classifyNoSubmitProbeError,
  isRetryableNoSubmitDatabaseFailure, runNoSubmitStageWithDeadline } from '../src/theta/no-submit-probe-guard.js';
import { LocalEvidenceSpool } from '../src/theta/local-evidence-spool.js';
import { PostgresLocalEvidenceBackfillTarget } from '../src/theta/postgres-local-evidence-backfill.js';
import { classifyPostgresRuntimeError } from '../src/theta/postgres-runtime-error.js';
import { createRuntimePostgresPool } from '../src/theta/runtime-postgres-pool.js';
import { runDatabaseIndependentShadowObservation } from '../src/theta/database-independent-shadow-observation.js';
import { buildLocalAegisRiskHistory, type LocalAegisRiskObservation } from '../src/theta/local-aegis-risk-history.js';
import { assessPaperEntryBootstrap, classifyAlpacaBrokerEnvironment,
  type PaperEntryBootstrapAssessment } from '../src/theta/paper-entry-bootstrap.js';

const environmentFile = process.argv.find((argument) => argument.startsWith('--environment-file='))
  ?.slice('--environment-file='.length) ?? '.env.local';
const sourceSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
let probeStage = 'SOURCE_GUARD';
if (!/^[0-9a-f]{40}$/.test(sourceSha)
  || execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()) {
  throw new Error('NO_SUBMIT_PROBE_IMMUTABLE_SOURCE_REQUIRED');
}
const probeCycleId=`no-submit-${randomUUID()}`;
let probeSnapshotId=`probe-${randomUUID()}`;
const probeDecisionAsOf=new Date().toISOString();
const probeWorkerId=`no-submit:${hostname().replace(/[^A-Za-z0-9_.-]/g,'_')}`;
let spool:LocalEvidenceSpool|null=null;
let spoolSequence=0;
const spoolEvidence=(payloadType:string,payload:unknown,providerObservedAt:Readonly<Record<string,string|null>>={}):void=>{
  spool?.append({decisionCycleId:probeCycleId,snapshotId:probeSnapshotId,decisionAsOf:probeDecisionAsOf,
    sourceSha,workerId:probeWorkerId,sequenceNumber:spoolSequence++,payloadType,payload,providerObservedAt,
    receivedAt:new Date().toISOString(),computedAt:new Date().toISOString()});
};
// Aiven may terminate a checked-out pg Client while another runtime module
// owns it. Node treats an unhandled Client error as fatal even though the
// Pool's idle-client listener exists. This diagnostic must fail closed with a
// sanitized receipt, never crash with a raw connection stack or retry a scan.
process.once('uncaughtException', (error: unknown) => {
  const errorCategory = classifyNoSubmitProbeError(error);
  try{spoolEvidence('CYCLE_FAILED',{probeStage,errorCategory,brokerMutationAllowed:false});}catch{}
  try{spool?.recordDatabaseFailure(new Date().toISOString(),false);}catch{}
  try{spool?.close();}catch{}
  console.info(JSON.stringify({ state: 'FAILED_CLOSED', errorCategory,
    probeStage, sourceSha, brokerMutations: 0, orderSubmissions: 0 }));
  process.exit(1);
});
const loadedEnvironment = loadEnvironmentFile(environmentFile);
// The schema's cross-platform default is python3. On this Windows host that
// command is a Microsoft Store alias, while python is the installed runtime.
// This override is confined to the diagnostic process and never changes the
// worker release or persisted runtime configuration.
const environment = process.platform === 'win32' && loadedEnvironment.THETA_PYTHON_EXECUTABLE === 'python3'
  ? { ...loadedEnvironment, THETA_PYTHON_EXECUTABLE: 'python' } : loadedEnvironment;
assertNoSubmitProbeGuard(environment);
if (!environment.ALPACA_API_KEY || !environment.ALPACA_SECRET_KEY || !environment.DATABASE_URL)
  throw new Error('NO_SUBMIT_PROBE_REQUIRED_CONFIGURATION_MISSING');
spool=new LocalEvidenceSpool();

const broker = asReadOnlyPaperBroker(new AlpacaPaperBrokerAdapter({
  baseUrl: environment.ALPACA_BASE_URL as string,
  authentication: { kind: 'MASTER_API_KEY', apiKey: environment.ALPACA_API_KEY,
    apiSecret: environment.ALPACA_SECRET_KEY },
}));
assertShadowBrokerHasNoMutationSurface(broker);
const alpaca = {
  tradingApiBase: environment.ALPACA_BASE_URL as string,
  marketDataApiBase: 'https://data.alpaca.markets',
  apiKey: environment.ALPACA_API_KEY, apiSecret: environment.ALPACA_SECRET_KEY,
  // Every Alpaca call in this probe is physically read-only, independent
  // of the runtime flags and of the Paper action-plan store.
  fetchImpl: (input: RequestInfo | URL, init?: RequestInit) => {
    if ((init?.method ?? 'GET').toUpperCase() !== 'GET') throw new Error('NO_SUBMIT_PROBE_NON_GET_REJECTED');
    return fetch(input, init);
  },
};
let poolConnectionFailed = false;
const pool = createRuntimePostgresPool(environment.DATABASE_URL,()=>{poolConnectionFailed=true;});
let paperEntryBootstrap:PaperEntryBootstrapAssessment|undefined;
let recoveryInventoryUnderlyingsForFallback:readonly string[]|undefined;
try {
  probeStage = 'BROKER_CLOCK_READ';
  const clock = await broker.getClock();
  spoolEvidence('ACCOUNT_READY',{marketOpen:clock.isOpen,brokerHost:'paper-api.alpaca.markets',brokerMutationAllowed:false},
    {ALPACA:typeof clock.timestamp==='string'?clock.timestamp:null});
  probeStage = 'DATABASE_SCHEMA_READ';
  const migrations = await pool.query(`SELECT version FROM core.schema_migration
    WHERE version IN ('064_alpaca_corporate_action_observation','065_aegis_iv_stress_evidence','066_local_observation_evidence')
    ORDER BY version`);
  spool.recordDatabaseProbeSuccess(new Date().toISOString());
  if (!migrations.rows.some((row) => row.version === '064_alpaca_corporate_action_observation'))
    throw new Error('NO_SUBMIT_PROBE_SCHEMA_064_REQUIRED');
  const schema = migrations.rows.some((row) => row.version === '065_aegis_iv_stress_evidence') ? '065' : '064';
  const localEvidenceBackfillReady=migrations.rows.some((row)=>row.version==='066_local_observation_evidence');
  if (clock.isOpen !== true) {
    console.info(JSON.stringify({ state: clock.isOpen === false ? 'MARKET_CLOSED_NO_SCAN' : 'SESSION_UNCONFIRMED_NO_SCAN',
      sourceSha,
      schema, brokerEnvironment: 'PAPER', masterExecution: 'LOCKED', followerExecution: 'LOCKED',
      brokerMutations: 0, orderSubmissions: 0 }));
    process.exitCode = 0;
  } else {
    probeStage = 'BROKER_ACCOUNT_READ';
    const account = z.object({ id: z.string().min(1) }).passthrough().parse(await broker.getAccount());
    probeStage = 'MASTER_ACCOUNT_LOOKUP';
    const master = await pool.query(`SELECT follower_account_id FROM copy.follower_account
      WHERE provider_account_ref=$1 AND account_role='MASTER_THETA_PAPER'
        AND environment='PAPER' AND connection_status='CONNECTED' AND disconnected_at IS NULL`, [account.id]);
    if (master.rowCount !== 1) throw new Error('NO_SUBMIT_PROBE_MASTER_CONNECTION_INVALID');
    probeStage = 'BROKER_RECONCILIATION';
    const reconciliation = await runReadOnlyBrokerReconciliation({
      broker, store: new PostgresBrokerReconciliationStore(pool),
      connectionId: String(master.rows[0].follower_account_id),
      expectedProviderAccountRef: account.id,
      correlationId: `no-submit:${randomUUID()}`, now: () => new Date().toISOString(),
    });
    // A reconciled flat broker account proves there is no recovery stock.
    // Any non-flat state still needs canonical lifecycle linkage from DB.
    recoveryInventoryUnderlyingsForFallback=reconciliation.positionCount===0?[]:undefined;
    probeSnapshotId=reconciliation.snapshotId;
    spoolEvidence('ACCOUNT_READY',{reconciliationState:reconciliation.dataQuality,positions:reconciliation.positionCount,
      openOrders:reconciliation.openOrderCount,entryBlockingFactCount:reconciliation.entryBlockingFactCount,
      brokerMutationAllowed:false},{ALPACA:reconciliation.providerTimestamp});
    if (reconciliation.dataQuality !== 'GOOD' || reconciliation.marketOpen !== true
      || !reconciliation.calendarSessionConfirmed || reconciliation.entryBlockingFactCount > 0
      || reconciliation.localOnlyIntentCount > 0) {
      console.info(JSON.stringify({ state: 'BROKER_RECONCILIATION_BLOCKED_NO_SCAN', schema, sourceSha,
        dataQuality: reconciliation.dataQuality, marketOpen: reconciliation.marketOpen,
        calendarSessionConfirmed: reconciliation.calendarSessionConfirmed,
        entryBlockingFactCount: reconciliation.entryBlockingFactCount,
        localOnlyIntentCount: reconciliation.localOnlyIntentCount,
        brokerMutations: 0, orderSubmissions: 0 }));
      process.exitCode = 1;
    } else {
      paperEntryBootstrap=assessPaperEntryBootstrap({enabled:true,runtimeMode:environment.THETA_RUNTIME_MODE,
        brokerEnvironment:classifyAlpacaBrokerEnvironment(alpaca.tradingApiBase),
        accountStatus:reconciliation.accountStatus,reconciliationQuality:reconciliation.dataQuality,
        localOnlyIntentCount:reconciliation.localOnlyIntentCount,
        externalOrUnknownOrderCount:reconciliation.entryBlockingFactCount,
        marketOpen:reconciliation.marketOpen,calendarSessionConfirmed:reconciliation.calendarSessionConfirmed,
        followerExecutionEnabled:environment.FOLLOWER_PAPER_EXECUTION_ENABLED,liveMoneyAuthorized:false});
      probeStage = 'SHADOW_EVIDENCE_SCAN';
      const scan = await runNoSubmitStageWithDeadline(runProductionShadowEvidenceScan({ environment, pool, alpaca,
        reconciliation, executionAccountId: null, now: () => new Date().toISOString(),
        readOnlyPreSubmitPreview: true, scanScope:'APPROVED_PAPER_BOOTSTRAP_ONLY' }),240_000,
      'NO_SUBMIT_PROBE_SHADOW_SCAN_TIMEOUT');
      if (scan.actionPlansReady !== 0) throw new Error('NO_SUBMIT_PROBE_ACTION_PLAN_UNEXPECTED');
      spoolEvidence('PLAN_READY',{scanId:scan.scanId,completeness:scan.completeness,candidateCount:scan.candidateCount,
        symbolsAttempted:scan.symbolsAttempted,symbolsCompleted:scan.symbolsCompleted,
        finalAction:scan.behaviorDiagnostic.finalAction,actionPlansReady:scan.actionPlansReady,
        actionPlanBlockers:scan.actionPlansBlocked,readOnlyPreSubmitProofs:scan.readOnlyPreSubmitProofs,
        brokerMutationAllowed:false});
      if(localEvidenceBackfillReady)await spool.backfill(new PostgresLocalEvidenceBackfillTarget(pool),sourceSha);
      console.info(JSON.stringify({ state: poolConnectionFailed ? 'DATABASE_CONNECTION_LOST_NO_SUBMIT'
        : 'CURRENT_SOURCE_NO_SUBMIT_SCAN_COMPLETED', schema, sourceSha,
        completeness: scan.completeness, symbolsAttempted: scan.symbolsAttempted,
        symbolsCompleted: scan.symbolsCompleted, candidateCount: scan.candidateCount,
        observationsScheduled: scan.observationsScheduled,
        paperActionPlansReady: scan.actionPlansReady,
        symbolDiagnostics: scan.symbolDiagnostics,
        readOnlyPreSubmitProofs: scan.readOnlyPreSubmitProofs,
        finalAction: scan.behaviorDiagnostic.finalAction,
        brokerMutations: 0, orderSubmissions: 0,
        masterExecution: 'LOCKED', followerExecution: 'LOCKED', liveMoney: 'NOT_AUTHORIZED' }));
      process.exitCode = !poolConnectionFailed && scan.completeness === 'COMPLETE' ? 0 : 1;
    }
  }
} catch (error) {
  const category = classifyNoSubmitProbeError(error);
  const databaseFailure=classifyPostgresRuntimeError(error);
  if(databaseFailure.retryableRead||isRetryableNoSubmitDatabaseFailure(error,category)){
    spool?.recordDatabaseFailure(new Date().toISOString(),false);
    try{
      probeStage='DATABASE_INDEPENDENT_PROVIDER_OBSERVATION';
      const spoolIntegrity=spool?.verify();
      if(spoolIntegrity!==undefined&&!spoolIntegrity.valid)throw new Error('LOCAL_EVIDENCE_HASH_CHAIN_INVALID');
      const priorRiskObservations=spool?.listByPayloadType('RISK_OBSERVATIONS_READY',5_000).flatMap((envelope)=>{
        const payload=envelope.payload as {observations?:unknown}|null;
        return Array.isArray(payload?.observations)?payload.observations:[];
      })??[];
      const localRiskHistory=buildLocalAegisRiskHistory(priorRiskObservations);
      const local=await runDatabaseIndependentShadowObservation({environment,alpaca,paperEntryBootstrap,
        recoveryInventoryUnderlyings:recoveryInventoryUnderlyingsForFallback,
        localRiskHistory,
        now:()=>new Date().toISOString()});
      spoolEvidence('CONTRACTS_READY',{universeFunnel:local.universeFunnel,universeBlockers:local.universeBlockers,
        approvedSymbolsDiscovered:local.approvedSymbolsDiscovered,brokerMutationAllowed:false});
      for(const symbol of local.symbols){
        spoolEvidence('QUOTES_READY',{symbol:symbol.symbol,optionContractsComplete:symbol.optionContractsComplete,
          optionChainComplete:symbol.optionChainComplete,exactRefresh:symbol.exactRefresh,brokerMutationAllowed:false},
        {ALPACA:symbol.exactRefresh.providerTimestamp});
        spoolEvidence('Q_READY',{symbol:symbol.symbol,qCandidateCount:symbol.qCandidateCount,qDecision:symbol.qDecision,
          qReasonCodes:symbol.qReasonCodes,qCandidates:symbol.qCandidates,
          frontierCandidates:symbol.frontierCandidates,blockers:symbol.blockers,brokerMutationAllowed:false});
        spoolEvidence('RISK_OBSERVATIONS_READY',{symbol:symbol.symbol,history:symbol.riskHistory,
          observations:symbol.riskObservations as readonly LocalAegisRiskObservation[],brokerMutationAllowed:false},
        {ALPACA:symbol.riskObservations.map((observation)=>observation.contract.quoteTimestamp)
          .filter((value):value is string=>value!==null).toSorted().at(-1)??null});
        spoolEvidence('AEGIS_READY',{symbol:symbol.symbol,aegisState:symbol.aegisState,
          evidenceState:symbol.state,brokerMutationAllowed:false});
        spoolEvidence('SIZING_READY',{symbol:symbol.symbol,selectedQuantity:symbol.selectedQuantity,
          bindingState:symbol.selectedQuantity>0?'POSITIVE_BUT_MUTATION_BLOCKED':'ZERO_OR_NO_SELECTION',brokerMutationAllowed:false});
        spoolEvidence('DECISION_READY',{symbol:symbol.symbol,canonicalAction:symbol.canonicalAction,
          selectedCandidateId:symbol.selectedCandidateId,selectedOptionSymbol:symbol.selectedOptionSymbol,
          canonicalPersistence:false,brokerMutationAllowed:false});
      }
      spoolEvidence('PLAN_READY',{planState:'BLOCKED_CANONICAL_POSTGRES_REQUIRED',
        brokerMutationCapability:local.brokerMutationCapability,brokerMutationAllowed:false});
      console.info(JSON.stringify({state:'DATABASE_UNAVAILABLE_LOCAL_OBSERVATION_COMPLETED',errorCategory:category,
        probeStage,sourceSha,approvedSymbolsDiscovered:local.approvedSymbolsDiscovered,
        symbolStates:local.symbols.map((symbol)=>({symbol:symbol.symbol,state:symbol.state,
          canonicalAction:symbol.canonicalAction,selectedQuantity:symbol.selectedQuantity,
          exactRefreshState:symbol.exactRefresh.state})),brokerMutations:0,orderSubmissions:0}));
      process.exitCode=0;
    }catch(localError){
      const localCategory=classifyNoSubmitProbeError(localError);
      try{spoolEvidence('CYCLE_FAILED',{probeStage,errorCategory:localCategory,brokerMutationAllowed:false});}catch{}
      console.info(JSON.stringify({state:'FAILED_CLOSED',errorCategory:localCategory,probeStage,sourceSha,
        brokerMutations:0,orderSubmissions:0}));
      process.exitCode=1;
    }
  }else{
    try{spoolEvidence('CYCLE_FAILED',{probeStage,errorCategory:category,brokerMutationAllowed:false});}catch{}
    console.info(JSON.stringify({ state: 'FAILED_CLOSED', errorCategory: category, probeStage, sourceSha,
      brokerMutations: 0, orderSubmissions: 0 }));
    process.exitCode = 1;
  }
} finally {
  // A timed-out provider/database task may still own a checked-out client.
  // Give the pool a short graceful-close window, then terminate this
  // physically read-only diagnostic process.
  await Promise.race([pool.end().catch(() => { process.exitCode = 1; }),
    new Promise<void>((resolve)=>setTimeout(resolve,5_000))]);
  spool?.close();
}
// This is a bounded diagnostic CLI. A timed-out provider or Python operation
// may still own an internal handle even after its evidence deadline elapsed.
// All synchronous evidence is durable and the pool is closed before exit.
process.exit(process.exitCode??0);
