import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const path=resolve(process.argv[2]??'.theta-local-worker/legacy-reconstruction/reconstruction-manifest.json');
const endpoint=process.env.THETA_RUNTIME_ENDPOINT??'https://trading-bots-one.vercel.app/api/theta-runtime';
const token=process.env.THETA_OPERATOR_TOKEN??'';
const buildSha=process.env.THETA_BUILD_SHA??'';
if(token.length<32)throw new Error('THETA_OPERATOR_TOKEN_REQUIRED');
if(!/^[0-9a-f]{7,40}$/.test(buildSha))throw new Error('THETA_BUILD_SHA_REQUIRED');
const body=await readFile(path,'utf8');
const response=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${token}`,
  'x-theta-operation':'database-legacy-reconstruction-import','x-theta-database-change':'AIVEN_LEGACY_RECONSTRUCT_052',
  'x-theta-worker-id':'codex-legacy-reconstruction','x-theta-host-id':'windows-owner','x-theta-build-sha':buildSha},body});
const result=await response.json();
if(!response.ok)throw new Error(`LEGACY_RECONSTRUCTION_IMPORT_HTTP_${response.status}:${result.failureCode??result.error??'UNKNOWN'}`);
process.stdout.write(`${JSON.stringify({target:result.target,receipt:result.receipt,runtimeAuthority:result.runtimeAuthority,
  legacyRuntimeAuthority:result.legacyRuntimeAuthority,executionGate:result.executionGate,
  followerExecution:result.followerExecution,liveMoneyAuthorized:result.liveMoneyAuthorized,ordersSubmitted:result.ordersSubmitted})}\n`);
