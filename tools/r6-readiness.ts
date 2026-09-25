import { Pool } from 'pg';
import { loadEnvironment } from '../src/config/environment.js';
import { buildR6ReadinessReceipt } from '../src/research/r6-readiness.js';

const connectionString=loadEnvironment().DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_CONNECTION_NOT_CONFIGURED');
const pool=new Pool({connectionString,max:1,application_name:'theta-r6-readiness'});
try {
  process.stdout.write(`${JSON.stringify(await buildR6ReadinessReceipt(pool))}\n`);
} finally { await pool.end(); }
