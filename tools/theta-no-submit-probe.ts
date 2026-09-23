import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { Pool } from 'pg';
import { z } from 'zod';
import { loadEnvironmentFile } from '../src/config/environment.js';
import { AlpacaPaperBrokerAdapter } from '../src/execution/broker.js';
import { asReadOnlyPaperBroker, assertShadowBrokerHasNoMutationSurface } from '../src/execution/read-only-paper-broker.js';
import { PostgresBrokerReconciliationStore, runReadOnlyBrokerReconciliation } from '../src/execution/broker-reconciliation-worker.js';
import { runProductionShadowEvidenceScan } from '../src/research/production-shadow-runtime.js';
import { assertNoSubmitProbeGuard } from '../src/theta/no-submit-probe-guard.js';

const environmentFile = process.argv.find((argument) => argument.startsWith('--environment-file='))
  ?.slice('--environment-file='.length) ?? '.env.local';
const sourceSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (!/^[0-9a-f]{40}$/.test(sourceSha)
  || execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()) {
  throw new Error('NO_SUBMIT_PROBE_IMMUTABLE_SOURCE_REQUIRED');
}
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

try {
  const migrations = await pool.query(`SELECT version FROM core.schema_migration
    WHERE version IN ('064_alpaca_corporate_action_observation','065_aegis_iv_stress_evidence')
    ORDER BY version`);
  if (!migrations.rows.some((row) => row.version === '064_alpaca_corporate_action_observation'))
    throw new Error('NO_SUBMIT_PROBE_SCHEMA_064_REQUIRED');
  const schema = migrations.rows.some((row) => row.version === '065_aegis_iv_stress_evidence') ? '065' : '064';
  const clock = await broker.getClock();
  if (clock.isOpen !== true) {
    console.info(JSON.stringify({ state: clock.isOpen === false ? 'MARKET_CLOSED_NO_SCAN' : 'SESSION_UNCONFIRMED_NO_SCAN',
      sourceSha,
      schema, brokerEnvironment: 'PAPER', masterExecution: 'LOCKED', followerExecution: 'LOCKED',
      brokerMutations: 0, orderSubmissions: 0 }));
    process.exitCode = 0;
  } else {
    const account = z.object({ id: z.string().min(1) }).passthrough().parse(await broker.getAccount());
    const master = await pool.query(`SELECT follower_account_id FROM copy.follower_account
      WHERE provider_account_ref=$1 AND account_role='MASTER_THETA_PAPER'
        AND environment='PAPER' AND connection_status='CONNECTED' AND disconnected_at IS NULL`, [account.id]);
    if (master.rowCount !== 1) throw new Error('NO_SUBMIT_PROBE_MASTER_CONNECTION_INVALID');
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
      const scan = await runProductionShadowEvidenceScan({ environment, pool, alpaca,
        reconciliation, executionAccountId: null, now: () => new Date().toISOString() });
      if (scan.actionPlansReady !== 0) throw new Error('NO_SUBMIT_PROBE_ACTION_PLAN_UNEXPECTED');
      console.info(JSON.stringify({ state: 'CURRENT_SOURCE_NO_SUBMIT_SCAN_COMPLETED', schema, sourceSha,
        completeness: scan.completeness, symbolsAttempted: scan.symbolsAttempted,
        symbolsCompleted: scan.symbolsCompleted, candidateCount: scan.candidateCount,
        observationsScheduled: scan.observationsScheduled,
        paperActionPlansReady: scan.actionPlansReady,
        finalAction: scan.behaviorDiagnostic.finalAction,
        brokerMutations: 0, orderSubmissions: 0,
        masterExecution: 'LOCKED', followerExecution: 'LOCKED', liveMoney: 'NOT_AUTHORIZED' }));
      process.exitCode = scan.completeness === 'COMPLETE' ? 0 : 1;
    }
  }
} catch (error) {
  const message = error instanceof Error ? error.message : '';
  const category = /^[A-Z0-9_]{3,100}$/.test(message) ? message : 'UNCLASSIFIED_NO_SUBMIT_FAILURE';
  console.info(JSON.stringify({ state: 'FAILED_CLOSED', errorCategory: category, sourceSha,
    brokerMutations: 0, orderSubmissions: 0 }));
  process.exitCode = 1;
} finally {
  await pool.end();
}
