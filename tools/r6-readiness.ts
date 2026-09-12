import { Pool } from 'pg';
import { buildR6ReadinessReceipt } from '../src/research/r6-readiness.js';

const connectionString=process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_CONNECTION_NOT_CONFIGURED');
const pool=new Pool({connectionString,max:1});
try {
  process.stdout.write(`${JSON.stringify(await buildR6ReadinessReceipt(pool))}\n`);
} finally { await pool.end(); }
