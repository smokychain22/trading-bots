import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { certifyExecutedRequirement, evidenceSourceHash,
  type ReviewedRequirementBinding, type ExecutedTestEvent } from '../src/operations/executed-requirement-evidence.js';

const bindings = JSON.parse(readFileSync('docs/operations/THETA_PHASE3_REVIEWED_TEST_BINDINGS.json', 'utf8')) as ReviewedRequirementBinding[];
if (bindings.length !== 13 || bindings.some((row, i) => row.id !== `3.${i + 1}`))
  throw new Error('PHASE3_REVIEWED_DENOMINATOR_INCOMPLETE');
const files = [...new Set(bindings.flatMap(row => row.tests.map(test => test.file)))].sort();
const paths = [...new Set(bindings.flatMap(row => [...row.sources, ...row.tests.map(test => test.file)]))].sort();
const capture = () => Object.fromEntries(paths.map(path => [path, evidenceSourceHash(readFileSync(path, 'utf8'))]));
const hashes = capture();
const environment = { ...process.env };
for (const key of Object.keys(environment)) if (/TEST.*DATABASE|DATABASE.*TEST/.test(key)) delete environment[key];
if (files.some(file => !/^tests\/[a-z0-9-]+\.test\.ts$/.test(file))) throw new Error('OFFLINE_TEST_FILE_REQUIRED');
const child = spawnSync(process.execPath, ['--import', 'tsx', '--test',
  '--test-reporter=./tools/theta-test-evidence-reporter.mjs', ...files],
{ encoding: 'utf8', env: environment, timeout: 240_000, maxBuffer: 16 * 1024 * 1024 });
const events: ExecutedTestEvent[] = child.stdout.split(/\r?\n/).filter(line => line.startsWith('{')).map(line => JSON.parse(line));
if (JSON.stringify(hashes) !== JSON.stringify(capture())) throw new Error('SOURCE_CHANGED_DURING_EVIDENCE_EXECUTION');
const results = bindings.map(binding => certifyExecutedRequirement(binding, events, hashes));
const revision = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' });
if (revision.status !== 0 || !/^[a-f0-9]{40}$/.test(revision.stdout.trim())) throw new Error('SOURCE_REVISION_UNAVAILABLE');
const body = { version: 'theta-phase3-executed-evidence-v1', observedAt: new Date().toISOString(),
  checkoutHead: revision.stdout.trim(), identityAuthority: 'PER_FILE_HASHES_INCLUDE_UNCOMMITTED_CHANGES',
  command: 'node --import tsx tools/theta-phase3-executed-evidence.ts',
  executionSucceeded: child.status === 0 && !child.error, results,
  passed: events.filter(row => row.state === 'PASS').length, failed: events.filter(row => row.state === 'FAIL').length,
  skipped: events.filter(row => row.state === 'SKIPPED' || row.state === 'TODO').length,
  currentWorkerProven: false, brokerAuthorized: false, providerRequests: 0, brokerMutations: 0,
  scope: 'REVIEWED_SOURCE_ENGINEERING_NOT_L7_OR_EMPIRICAL' };
const artifactHash = createHash('sha256').update(JSON.stringify(body)).digest('hex');
writeFileSync('docs/operations/evidence/THETA_PHASE3_EXECUTED_TESTS.json', JSON.stringify({ ...body, artifactHash }, null, 2) + '\n');
console.log(JSON.stringify({ executionSucceeded: body.executionSucceeded, passed: body.passed, failed: body.failed,
  skipped: body.skipped, results: results.map(row => ({ id: row.requirementId, state: row.state, blockers: row.blockers })) }));
if (!body.executionSucceeded || results.some(row => row.state !== 'PASS')) process.exitCode = 1;
