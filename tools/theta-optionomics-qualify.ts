import { Pool } from 'pg';
import { loadEnvironment } from '../src/config/environment.js';
import { qualifyOptionomicsProvider,persistOptionomicsQualification,type OptionomicsQualificationMode } from '../src/providers/optionomics-qualification.js';
import { optionomicsConfigFromEnvironment } from '../src/theta/theta-shadow-once.js';

const mode=(process.argv.find((value)=>value.startsWith('--mode='))?.split('=')[1]??'SYNTHETIC') as OptionomicsQualificationMode;
if(!['SYNTHETIC','REPLAY','REAL_AUTHENTICATED'].includes(mode))throw new Error('QUALIFICATION_MODE_INVALID');
const environment=mode==='REAL_AUTHENTICATED'?loadEnvironment():null;
const receipt=await qualifyOptionomicsProvider({mode,at:new Date().toISOString(),symbol:'SPY',config:environment===null?null:optionomicsConfigFromEnvironment(environment)});
if(environment?.DATABASE_URL){const pool=new Pool({connectionString:environment.DATABASE_URL,max:1});try{await persistOptionomicsQualification(pool,receipt);}finally{await pool.end();}}
process.stdout.write(`${JSON.stringify({version:receipt.version,mode:receipt.mode,secretState:receipt.secretState,
  families:receipt.families.map(({family,state,blockers})=>({family,state,blockers})),realPayloadCount:receipt.realPayloadCount,
  staleCapabilityCount:receipt.staleCapabilityCount,executionAuthorized:false,receiptHash:receipt.receiptHash})}\n`);
