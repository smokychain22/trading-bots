import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { z } from 'zod';
import { loadEnvironmentFile } from '../src/config/environment.js';
import { AlpacaPaperBrokerAdapter } from '../src/execution/broker.js';
import { asReadOnlyPaperBroker, assertShadowBrokerHasNoMutationSurface } from '../src/execution/read-only-paper-broker.js';
import {
  PostgresBrokerReconciliationStore,
  runReadOnlyBrokerReconciliation,
} from '../src/execution/broker-reconciliation-worker.js';

const environmentArgument = process.argv.find((argument) => argument.startsWith('--environment-file='));
const environmentFile = environmentArgument?.slice('--environment-file='.length) ?? '.env.local';
const environment = loadEnvironmentFile(environmentFile);

if (!environment.DATABASE_URL) throw new Error('DATABASE_CONNECTION_NOT_CONFIGURED');
if (!environment.ALPACA_API_KEY || !environment.ALPACA_SECRET_KEY || !environment.ALPACA_BASE_URL) {
  throw new Error('ALPACA_PAPER_CONFIGURATION_INCOMPLETE');
}
if (environment.MASTER_PAPER_EXECUTION_ENABLED || environment.FOLLOWER_PAPER_EXECUTION_ENABLED
  || !environment.PAPER_PAUSE_NEW_ORDERS) {
  throw new Error('READ_ONLY_RECONCILIATION_REQUIRES_ALL_EXECUTION_LOCKS');
}

const broker = new AlpacaPaperBrokerAdapter({
  baseUrl: environment.ALPACA_BASE_URL,
  authentication: { kind: 'MASTER_API_KEY', apiKey: environment.ALPACA_API_KEY, apiSecret: environment.ALPACA_SECRET_KEY },
});
const readOnlyBroker = asReadOnlyPaperBroker(broker);
assertShadowBrokerHasNoMutationSurface(readOnlyBroker);
const account = z.object({ id: z.string().min(1) }).passthrough().parse(await readOnlyBroker.getAccount());
const pool = new Pool({ connectionString: environment.DATABASE_URL, max: 2, connectionTimeoutMillis: 10_000,
  application_name: 'theta-broker-reconciliation-read-only' });

try {
  const connection = await pool.query(
    `SELECT follower_account_id FROM copy.follower_account
     WHERE provider_account_ref=$1 AND account_role='MASTER_THETA_PAPER'
       AND environment='PAPER' AND connection_status='CONNECTED' AND disconnected_at IS NULL`,
    [account.id],
  );
  if (connection.rowCount !== 1) throw new Error('MASTER_CONNECTION_ROLE_INVALID');
  const result = await runReadOnlyBrokerReconciliation({
    broker: readOnlyBroker,
    store: new PostgresBrokerReconciliationStore(pool),
    connectionId: String(connection.rows[0].follower_account_id),
    expectedProviderAccountRef: account.id,
    correlationId: `readonly-current-impact-${randomUUID()}`,
    now: () => new Date().toISOString(),
  });
  console.info(JSON.stringify({
    operation: 'ALPACA_PAPER_READ_ONLY_RECONCILIATION',
    persisted: true,
    dataQuality: result.dataQuality,
    positionCount: result.positionCount,
    openOrderCount: result.openOrderCount,
    activityCount: result.activityCount,
    matchedOrderCount: result.matchedOrderCount,
    rawExternalOrUnknownCount: result.externalOrUnknownCount,
    entryBlockingFactCount: result.entryBlockingFactCount,
    localOnlyIntentCount: result.localOnlyIntentCount,
    brokerFactImpactSummary: result.brokerFactImpactSummary,
    brokerMutations: 0,
    orderSubmissionAttempted: false,
  }));
} finally {
  await pool.end();
}
