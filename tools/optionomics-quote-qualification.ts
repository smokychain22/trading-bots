import { Pool } from 'pg';
import { loadEnvironment } from '../src/config/environment.js';
import { runOptionomicsQuoteQualification, sanitizeQualificationReport } from '../src/theta/optionomics-quote-qualification-runtime.js';

const environment = loadEnvironment();
if (!environment.DATABASE_URL) throw new Error('DATABASE_CONNECTION_NOT_CONFIGURED');
const pool = new Pool({ connectionString: environment.DATABASE_URL, max: 1 });

try {
  process.stdout.write(`${JSON.stringify(sanitizeQualificationReport(await runOptionomicsQuoteQualification(environment,pool)))}\n`);
} finally {
  await pool.end();
}
