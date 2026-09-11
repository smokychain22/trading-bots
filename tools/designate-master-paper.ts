import { Pool } from 'pg';
import { loadEnvironmentFile } from '../src/config/environment.js';
import { PostgresCustomerStore } from '../src/customer/customer-store.js';
import { reverifyStoredFollowerAccount, verifyStoredFollowerAccount } from '../src/customer/alpaca-oauth.js';
import {
  designateConnectedPaperMaster,
  PostgresMasterRoleStore,
  resolveAuthenticatedMasterCandidate,
} from '../src/customer/paper-account-role.js';

const envFile = process.env.THETA_ENV_FILE;
if (!envFile) throw new Error('THETA_ENV_FILE_REQUIRED');
if (process.env.CONFIRM_MASTER_DESIGNATION !== 'MASTER_THETA_PAPER')
  throw new Error('MASTER_DESIGNATION_CONFIRMATION_REQUIRED');

const environment = loadEnvironmentFile(envFile);
if (!environment.DATABASE_URL) throw new Error('CUSTOMER_DATABASE_NOT_CONFIGURED');
const pool = new Pool({ connectionString: environment.DATABASE_URL, max: 2, connectionTimeoutMillis: 8_000 });

try {
  const candidates = await pool.query(`SELECT DISTINCT f.customer_id
    FROM copy.follower_account f
    JOIN iam.customer_identity c ON c.customer_id=f.customer_id AND c.status='ACTIVE'
    JOIN copy.alpaca_oauth_token t ON t.token_secret_id=f.token_secret_id
      AND t.customer_id=f.customer_id AND t.revoked_at IS NULL
    WHERE f.disconnected_at IS NULL AND f.connection_status='CONNECTED'
      AND f.connection_method='PAPER_API_KEY_PRIVATE_BETA' AND f.environment='PAPER'
      AND EXISTS (SELECT 1 FROM iam.customer_session s WHERE s.customer_id=f.customer_id
        AND s.revoked_at IS NULL AND s.expires_at>now())`);
  const customerId = resolveAuthenticatedMasterCandidate(candidates.rows.map((row) => String(row.customer_id)));
  const customerStore = new PostgresCustomerStore(pool);

  // Persist current read-only broker facts first, then independently verify the
  // same encrypted credential again inside the promotion boundary.
  await reverifyStoredFollowerAccount(customerStore, environment, customerId);
  const role = await designateConnectedPaperMaster(
    environment,
    customerId,
    new PostgresMasterRoleStore(pool),
    () => verifyStoredFollowerAccount(customerStore, environment, customerId),
  );
  const account = await customerStore.getFollower(customerId);
  if (!account || account.accountRole !== 'MASTER_THETA_PAPER') throw new Error('MASTER_ROLE_PERSISTENCE_FAILED');

  process.stdout.write(JSON.stringify({
    ...role,
    broker_identity: account.maskedAccount,
    equity: account.equity,
    cash: account.cash,
    buying_power: account.buyingPower,
    options_buying_power: account.optionsBuyingPower,
    options_approved_level: account.optionsApprovedLevel,
    options_trading_level: account.optionsTradingLevel,
    positions: account.openPositionCount,
    open_orders: account.openOrderCount,
    market_open: account.marketIsOpen,
    last_verified_at: account.lastBrokerSyncAt,
  }) + '\n');
} finally {
  await pool.end();
}
