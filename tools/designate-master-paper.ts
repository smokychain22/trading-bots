import { Pool } from 'pg';
import { loadEnvironmentFile } from '../src/config/environment.js';
import { PostgresCustomerStore } from '../src/customer/customer-store.js';
import { reverifyStoredFollowerAccount } from '../src/customer/alpaca-oauth.js';
import {
  designateAuthenticatedPaperMaster,
  PostgresMasterRoleStore,
} from '../src/customer/paper-account-role.js';

const envFile = process.env.THETA_ENV_FILE;
if (!envFile) throw new Error('THETA_ENV_FILE_REQUIRED');
if (process.env.CONFIRM_MASTER_DESIGNATION !== 'MASTER_THETA_PAPER')
  throw new Error('MASTER_DESIGNATION_CONFIRMATION_REQUIRED');

const environment = loadEnvironmentFile(envFile);
if (!environment.DATABASE_URL) throw new Error('CUSTOMER_DATABASE_NOT_CONFIGURED');
const pool = new Pool({ connectionString: environment.DATABASE_URL, max: 2, connectionTimeoutMillis: 8_000 });

try {
  const customerStore = new PostgresCustomerStore(pool);
  const roleStore = new PostgresMasterRoleStore(pool);
  const customerId = await roleStore.resolveAuthenticatedCustomer();

  // Persist current read-only broker facts first, then independently verify the
  // same encrypted credential again inside the promotion boundary.
  await reverifyStoredFollowerAccount(customerStore, environment, customerId);
  const role = await designateAuthenticatedPaperMaster(environment, roleStore);
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
