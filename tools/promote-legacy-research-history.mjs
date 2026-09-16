import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import dotenv from 'dotenv';

const envPath = resolve(process.argv[2] ?? '.theta-local-worker/production.env');
const environment = dotenv.parse(await readFile(envPath));
const endpoint = environment.THETA_RUNTIME_ENDPOINT ?? 'https://trading-bots-one.vercel.app/api/theta-runtime';
const token = environment.THETA_OPERATOR_TOKEN ?? environment.CRON_SECRET ?? '';
const buildSha = process.env.THETA_BUILD_SHA ?? environment.THETA_BUILD_SHA ?? '';
const importBatchId = process.argv[3];
if (token.length < 32) throw new Error('THETA_OPERATOR_TOKEN_REQUIRED');
if (!/^[0-9a-f]{7,40}$/.test(buildSha)) throw new Error('THETA_BUILD_SHA_REQUIRED');

const response = await fetch(endpoint, {
  method:'POST',
  headers:{ 'content-type':'application/json', authorization:`Bearer ${token}`,
    'x-theta-operation':'database-legacy-promote', 'x-theta-database-change':'AIVEN_LEGACY_PROMOTE_051',
    'x-theta-worker-id':'codex-legacy-promote', 'x-theta-host-id':'windows-owner', 'x-theta-build-sha':buildSha },
  body:JSON.stringify(importBatchId === undefined ? {} : { importBatchId }),
});
const result = await response.json();
if (!response.ok) throw new Error(`LEGACY_PROMOTION_HTTP_${response.status}:${result.failureCode ?? result.error ?? 'UNKNOWN'}`);
process.stdout.write(`${JSON.stringify(result)}\n`);
