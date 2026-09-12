import { Pool } from 'pg';
import { loadEnvironmentFile } from '../src/config/environment.js';
import { ensureMasterShadowContext, masterShadowContextVersions } from '../src/research/master-shadow-context.js';

const environment=loadEnvironmentFile('.env.local');
if(environment.DATABASE_URL===undefined) throw new Error('DATABASE_URL_REQUIRED');
const pool=new Pool({connectionString:environment.DATABASE_URL,max:1,connectionTimeoutMillis:10_000});
try{
  const master=await pool.query(`SELECT provider_account_ref FROM copy.follower_account
    WHERE account_role='MASTER_THETA_PAPER' AND environment='PAPER' AND disconnected_at IS NULL`);
  if(master.rowCount!==1) throw new Error(master.rowCount===0?'MASTER_THETA_PAPER_NOT_DESIGNATED':'MASTER_THETA_PAPER_AMBIGUOUS');
  const context=await ensureMasterShadowContext(pool,String(master.rows[0].provider_account_ref));
  console.info(JSON.stringify({status:'READY',botInstanceId:context.botInstanceId,mode:'SHADOW',schedulerEnabled:true,
    versions:masterShadowContextVersions,brokerIdentity:'MASKED',credentials:'ENCRYPTED_REFERENCE_ONLY',orderSubmission:'LOCKED'}));
}finally{await pool.end();}
