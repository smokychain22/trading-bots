import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const endpoint = process.env.THETA_RUNTIME_ENDPOINT ?? 'https://trading-bots-one.vercel.app/api/theta-runtime';
const tokenPath = resolve(process.env.THETA_WORKER_TOKEN_FILE ?? '.theta-local-worker/worker.token');
const outputPath = resolve(process.argv[2] ?? '.theta-local-worker/receipts/risk-policy-empirical-study.json');
const token = (await readFile(tokenPath, 'utf8')).trim();
if (token.length < 32) throw new Error('THETA_OPERATOR_TOKEN_REQUIRED');
const buildSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (!/^[0-9a-f]{40}$/.test(buildSha)) throw new Error('THETA_BUILD_SHA_REQUIRED');

const response = await fetch(endpoint, { method: 'POST', headers: {
  authorization: `Bearer ${token}`,
  'x-theta-operation': 'risk-policy-empirical-study',
  'x-theta-worker-id': 'codex-risk-policy-study',
  'x-theta-host-id': 'windows-owner',
  'x-theta-build-sha': buildSha,
} });
const result: unknown = await response.json();
if (!response.ok) {
  const record = result !== null && typeof result === 'object' ? result as Record<string, unknown> : {};
  throw new Error(`RISK_POLICY_STUDY_HTTP_${response.status}:${String(record.error ?? 'UNKNOWN')}`);
}
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
const record = result as Record<string, unknown>;
process.stdout.write(`${JSON.stringify({ outputPath, version: record.version, studyHash: record.studyHash })}\n`);
