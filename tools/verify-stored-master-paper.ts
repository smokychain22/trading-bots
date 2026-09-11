import { Pool } from 'pg';
import { loadEnvironmentFile } from '../src/config/environment.js';
import { PostgresCustomerStore } from '../src/customer/customer-store.js';
import { verifyStoredMasterPaperConnection } from '../src/customer/master-paper-runtime.js';

// Vercel writes a dotenv file. Parse dotenv syntax before schema validation,
// and let the freshly pulled file override stale session variables.
const environment = loadEnvironmentFile(process.env.THETA_ENV_FILE ?? '.env.local');
if (!environment.DATABASE_URL) throw new Error('CUSTOMER_DATABASE_NOT_CONFIGURED');
const pool = new Pool({ connectionString: environment.DATABASE_URL, max: 2, idleTimeoutMillis: 5_000 });
try {
  const result = await verifyStoredMasterPaperConnection(environment, new PostgresCustomerStore(pool));
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.connectionState !== 'CONNECTED') process.exitCode = 1;
} finally {
  await pool.end();
}
