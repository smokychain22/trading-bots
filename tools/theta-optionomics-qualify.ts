import { Pool } from 'pg';
import { loadEnvironment,loadEnvironmentFile } from '../src/config/environment.js';
import { qualifyOptionomicsProvider,persistOptionomicsQualification,type OptionomicsQualificationMode } from '../src/providers/optionomics-qualification.js';
import { optionomicsConfigFromEnvironment } from '../src/theta/theta-shadow-once.js';

const mode=(process.argv.find((value)=>value.startsWith('--mode='))?.split('=')[1]??'SYNTHETIC') as OptionomicsQualificationMode;
if(!['SYNTHETIC','REPLAY','REAL_AUTHENTICATED'].includes(mode))throw new Error('QUALIFICATION_MODE_INVALID');
const environmentFile=process.argv.find((value)=>value.startsWith('--environment-file='))?.slice('--environment-file='.length);
const environment=mode==='REAL_AUTHENTICATED'
  ? environmentFile ? loadEnvironmentFile(environmentFile) : loadEnvironment()
  : null;
const receipt=await qualifyOptionomicsProvider({mode,at:new Date().toISOString(),symbol:'SPY',config:environment===null?null:optionomicsConfigFromEnvironment(environment)});
let persistenceState:'NOT_REQUESTED'|'PERSISTED'|'FAILED'='NOT_REQUESTED';
let persistenceErrorCode:string|null=null;
if(environment?.DATABASE_URL){
  const pool=new Pool({connectionString:environment.DATABASE_URL,max:1});
  try{
    await persistOptionomicsQualification(pool,receipt);
    persistenceState='PERSISTED';
  }catch(error){
    persistenceState='FAILED';
    persistenceErrorCode=typeof error==='object'&&error!==null&&'code' in error&&typeof error.code==='string'
      ? error.code
      : 'UNCLASSIFIED';
  }finally{await pool.end();}
}
process.stdout.write(`${JSON.stringify({version:receipt.version,mode:receipt.mode,secretState:receipt.secretState,
  families:receipt.families.map(({family,state,blockers})=>({family,state,blockers})),realPayloadCount:receipt.realPayloadCount,
  staleCapabilityCount:receipt.staleCapabilityCount,executionAuthorized:false,receiptHash:receipt.receiptHash,
  persistenceState,persistenceErrorCode})}\n`);
