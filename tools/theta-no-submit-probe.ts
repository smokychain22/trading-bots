import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { Pool } from 'pg';
import { z } from 'zod';
import { loadEnvironmentFile } from '../src/config/environment.js';
import { AlpacaPaperBrokerAdapter } from '../src/execution/broker.js';
import { asReadOnlyPaperBroker, assertShadowBrokerHasNoMutationSurface } from '../src/execution/read-only-paper-broker.js';
import { PostgresBrokerReconciliationStore, runReadOnlyBrokerReconciliation } from '../src/execution/broker-reconciliation-worker.js';
import { runProductionShadowEvidenceScan } from '../src/research/production-shadow-runtime.js';
import { assertNoSubmitProbeGuard, classifyNoSubmitProbeError } from '../src/theta/no-submit-probe-guard.js';

const environmentFile = process.argv.find((argument) => argument.startsWith('--environment-file='))
  ?.slice('--environment-file='.length) ?? '.env.local';
const sourceSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
let probeStage = 'SOURCE_GUARD';
if (!/^[0-9a-f]{40}$/.test(sourceSha)
  || execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()) {
  throw new Error('NO_SUBMIT_PROBE_IMMUTABLE_SOURCE_REQUIRED');
}
// Aiven may terminate a checked-out pg Client while another runtime module
// owns it. Node treats an unhandled Client error as fatal even though the
// Pool's idle-client listener exists. This diagnostic must fail closed with a
// sanitized receipt, never crash with a raw connection stack or retry a scan.
process.once('uncaughtException', (error: unknown) => {
  const errorCategory = classifyNoSubmitProbeError(error);
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
const pool = new Pool({ connectionString: environment.DATABASE_URL, max: 2,
  connectionTimeoutMillis: 10_000, application_name: 'theta-no-submit-probe' });
let poolConnectionFailed = false;
// pg emits idle-client disconnects on the Pool itself. Without a listener,
// a transient Aiven disconnect crashes this read-only diagnostic outside the
// fail-closed receipt path.
pool.on('error', () => { poolConnectionFailed = true; });

try {
  probeStage = 'DATABASE_SCHEMA_READ';
  const migrations = await pool.query(`SELECT version FROM core.schema_migration
    WHERE version IN ('064_alpaca_corporate_action_observation','065_aegis_iv_stress_evidence')
    ORDER BY version`);
  if (!migrations.rows.some((row) => row.version === '064_alpaca_corporate_action_observation'))
    throw new Error('NO_SUBMIT_PROBE_SCHEMA_064_REQUIRED');
  const schema = migrations.rows.some((row) => row.version === '065_aegis_iv_stress_evidence') ? '065' : '064';
  probeStage = 'BROKER_CLOCK_READ';
  const clock = await broker.getClock();
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
      probeStage = 'SHADOW_EVIDENCE_SCAN';
      const scan = await runProductionShadowEvidenceScan({ environment, pool, alpaca,
        reconciliation, executionAccountId: null, now: () => new Date().toISOString(),
        readOnlyPreSubmitPreview: true });
      if (scan.actionPlansReady !== 0) throw new Error('NO_SUBMIT_PROBE_ACTION_PLAN_UNEXPECTED');
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
  console.info(JSON.stringify({ state: 'FAILED_CLOSED', errorCategory: category, probeStage, sourceSha,
    brokerMutations: 0, orderSubmissions: 0 }));
  process.exitCode = 1;
} finally {
  await pool.end().catch(() => { process.exitCode = 1; });
}
