import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const chunkDirectory=resolve(process.argv[2]??'.theta-local-worker/forensic-recovery/chunks');
const endpoint=process.env.THETA_RUNTIME_ENDPOINT??'https://trading-bots-one.vercel.app/api/theta-runtime';
const token=process.env.THETA_OPERATOR_TOKEN??'';
const buildSha=process.env.THETA_BUILD_SHA??'';
if(token.length<32)throw new Error('THETA_OPERATOR_TOKEN_REQUIRED');
if(!/^[0-9a-f]{7,40}$/.test(buildSha))throw new Error('THETA_BUILD_SHA_REQUIRED');
const files=(await readdir(chunkDirectory)).filter((name)=>/^\d{4}\.json$/.test(name)).sort();
if(files.length===0)throw new Error('LOCAL_FORENSIC_CHUNKS_REQUIRED');
let finalReceipt=null;
for(const file of files){
  const body=await readFile(resolve(chunkDirectory,file),'utf8');
  const response=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${token}`,
    'x-theta-operation':'database-local-forensic-import','x-theta-database-change':'AIVEN_LOCAL_FORENSIC_RECOVERY_053',
    'x-theta-worker-id':'codex-local-forensic','x-theta-host-id':'windows-owner','x-theta-build-sha':buildSha},body});
  const result=await response.json();
  if(!response.ok)throw new Error(`LOCAL_FORENSIC_IMPORT_HTTP_${response.status}:${result.failureCode??result.error??'UNKNOWN'}`);
  finalReceipt=result.receipt;
  process.stdout.write(`${JSON.stringify({file,state:finalReceipt.state,chunksImported:finalReceipt.chunksImported,
    chunkCount:finalReceipt.chunkCount,executionAuthorized:false})}\n`);
}
process.stdout.write(`${JSON.stringify({target:'AIVEN_LOCAL_FORENSIC_RECOVERY',receipt:finalReceipt,runtimeAuthority:'AIVEN',
  executionGate:'EXTERNAL_QUOTE_BLOCKER',followerExecution:'LOCKED',liveMoneyAuthorized:false,ordersSubmitted:0})}\n`);
