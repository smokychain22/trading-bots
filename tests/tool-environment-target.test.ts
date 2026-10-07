import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { explicitEnvironmentFile } from '../src/config/tool-environment.js';

// ENVIRONMENT TARGET AUDIT (2026-10-07). `.env.local` points at a NON-Production development database. Tools that silently defaulted to it
// validated or wrote the wrong database three times (post-migration checks, strategy authority, emergency lock). No operational tool may pick
// a target implicitly; every worker invocation states the Production env.
// theta-data-platform.ts is the one reviewed exception: its DB tests drive it against disposable databases through an explicit URL.
const REVIEWED_IMPLICIT_EXCEPTIONS = new Set(['theta-data-platform.ts']);

test('no operational tool defaults to .env.local (an implicit target is a refusal, not a guess)', () => {
  const offenders = readdirSync('tools').filter((file) => file.endsWith('.ts') && !REVIEWED_IMPLICIT_EXCEPTIONS.has(file))
    .filter((file) => /['"]\.env\.local['"]/.test(readFileSync(`tools/${file}`, 'utf8')));
  assert.deepEqual(offenders, []);
  assert.throws(() => explicitEnvironmentFile(['node', 'tool.ts']), /TOOL_REQUIRES_EXPLICIT_ENVIRONMENT_FILE/);
  assert.throws(() => explicitEnvironmentFile(['node', 'tool.ts', '--environment-file=']), /TOOL_REQUIRES_EXPLICIT_ENVIRONMENT_FILE/);
  assert.equal(explicitEnvironmentFile(['node', 'tool.ts', '--environment-file=.theta-local-worker/production.env']), '.theta-local-worker/production.env');
});

test('every TypeScript tool the Windows worker runs is given the Production environment explicitly', () => {
  const worker = readFileSync('tools/windows/theta-local-worker.ps1', 'utf8').split(/\r?\n/);
  const missing: string[] = [];
  worker.forEach((line, index) => {
    const tool = /tools\/[a-z0-9-]+\.ts/.exec(line)?.[0];
    if (tool === undefined) return;
    const call = worker.slice(index, index + 4).join(' ');
    if (!/--environment-file=\$productionEnvFile|--env-file=\$productionEnvFile/.test(call)) missing.push(`${index + 1}:${tool}`);
  });
  assert.deepEqual(missing, []);
});

test('npm scripts that run a target-requiring tool state the target', () => {
  const scripts = (JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> }).scripts;
  const requiring = readdirSync('tools').filter((file) => file.endsWith('.ts') && readFileSync(`tools/${file}`, 'utf8').includes('explicitEnvironmentFile('));
  const missing = Object.entries(scripts).filter(([, command]) => requiring.some((tool) => command.includes(`tools/${tool}`))
    && !/--environment-file=/.test(command)).map(([name]) => name);
  assert.deepEqual(missing, []);
});
