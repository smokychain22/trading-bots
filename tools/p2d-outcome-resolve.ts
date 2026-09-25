import { Pool } from 'pg';
import { loadEnvironment } from '../src/config/environment.js';
import { PostgresOutcomeResolver } from '../src/research/outcome-resolver.js';
import { buildR6ReadinessReceipt } from '../src/research/r6-readiness.js';

const connectionString=loadEnvironment().DATABASE_URL;
if(!connectionString) throw new Error('DATABASE_CONNECTION_NOT_CONFIGURED');

const pool=new Pool({connectionString,max:1,application_name:'theta-p2d-outcome-resolve'});
try{
  const asOf=new Date().toISOString();
  const resolver=new PostgresOutcomeResolver(pool);
  const wholeChains=await resolver.resolveClosedChains(asOf);
  const labels=await resolver.resolveEligibleOutcomes(asOf);
  const familyCounts=await pool.query(`SELECT label_type,count(*)::int AS count
    FROM research.theta_outcome_subject GROUP BY label_type ORDER BY label_type`);
  const resolutionCounts=await pool.query(`SELECT resolution_state,count(*)::int AS count
    FROM research.theta_outcome_resolution_receipt GROUP BY resolution_state ORDER BY resolution_state`);
  const output={
    asOf,
    wholeChains,
    labels,
    subjectCounts:Object.fromEntries(familyCounts.rows.map((row)=>[String(row.label_type),Number(row.count)])),
    resolutionCounts:Object.fromEntries(resolutionCounts.rows.map((row)=>[String(row.resolution_state),Number(row.count)])),
    readiness:await buildR6ReadinessReceipt(pool),
    executionAuthorized:false,
  };
  process.stdout.write(`${JSON.stringify(output)}\n`);
}finally{
  await pool.end();
}
