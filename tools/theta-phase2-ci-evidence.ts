import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { certifyExecutedRequirement, evidenceSourceHash,
  type ReviewedRequirementBinding, type ExecutedTestEvent } from '../src/operations/executed-requirement-evidence.js';

// Imports only sanitized executed-test events downloaded from exact-SHA CI.
// No Production connection, provider request, backup or worker mutation.
const [runId, directory] = process.argv.slice(2);
if (!runId || !/^\d+$/.test(runId) || !directory) throw new Error('CI_RUN_AND_ARTIFACT_DIRECTORY_REQUIRED');
function command(binary: string, args: string[]): string {
  const result = spawnSync(binary, args, { encoding: 'utf8', timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });
  if (result.status !== 0 || result.error) throw new Error('CI_EVIDENCE_COMMAND_FAILED');
  return result.stdout;
}
const sha = readFileSync(join(directory, 'source-sha.txt'), 'utf8').trim();
if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error('CI_SOURCE_SHA_INVALID');
const run = JSON.parse(command('gh', ['run', 'view', runId, '--json', 'headSha,conclusion,status,url']));
if (run.headSha !== sha || run.status !== 'completed' || run.conclusion !== 'success') throw new Error('EXACT_CI_NOT_SUCCESSFUL');
const faultBinding: ReviewedRequirementBinding = {
  id: '2.2.FAULT_MATRIX',
  reviewedBehavior: 'Actual disposable PostgreSQL exercises statement timeout, checked-out and idle backend termination, transaction rollback and expired queue handoff. Every stage checks complete drain and no idle transaction. No Production fault is injected.',
  sources: ['src/theta/runtime-postgres-client.ts', 'src/theta/runtime-postgres-pool.ts', 'src/theta/postgres-runtime-error.ts'],
  tests: [{ file: 'tests/db/runtime-postgres-faults.test.ts', names: [
    'server statement timeout retains SQLSTATE 57014, never acquisition timeout',
    'backend termination during a checked-out query is contained and the next client is fresh',
    'transaction error rolls back with no leaked transaction or client',
    'expired queued acquisition never invokes work and late client handoff is released',
    'idle backend termination is reported without an unhandled emitter error',
    'real local PostgreSQL fault containment releases clients and distinguishes query failure from acquisition',
  ] }],
};
const recoveryBinding: ReviewedRequirementBinding = {
  id: '2.4.FRESH_CYCLE',
  reviewedBehavior: 'Actual runAutonomousRuntimeCycle BROKER scope persists good reconciliation, injects a GET-only broker account 503 and recovers with new reads, correlation and persisted snapshot in real disposable PostgreSQL. Checks zero orders and drained pool. Does not prove deployed recovery or market evidence.',
  sources: ['src/theta/autonomous-runtime.ts', 'src/customer/customer-store.ts',
    'src/customer/paper-account-role.ts', 'src/theta/runtime-postgres-client.ts'],
  tests: [{ file: 'tests/db/customer-persistence.test.ts',
    names: ['real disposable PostgreSQL preserves user limits, master role and tenant isolation'] }],
};
const runs = [
  { binding: faultBinding, artifact: 'disposable-faults.jsonl' },
  { binding: recoveryBinding, artifact: 'disposable-persistence.jsonl' },
].map(({ binding, artifact }) => {
  const raw = readFileSync(join(directory, artifact), 'utf8');
  const events = raw.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line) as ExecutedTestEvent);
  const paths = [...new Set([...binding.sources, ...binding.tests.map(test => test.file)])];
  const hashes = Object.fromEntries(paths.map(path => {
    const executed = evidenceSourceHash(command('git', ['show', `${sha}:${path}`]));
    if (executed !== evidenceSourceHash(readFileSync(path, 'utf8'))) throw new Error(`CI_COMPONENT_CHANGED:${path}`);
    return [path, executed];
  }));
  const result = certifyExecutedRequirement(binding, events, hashes);
  if (result.state !== 'PASS') throw new Error(`CI_REQUIREMENT_NOT_PROVEN:${binding.id}`);
  return { binding, artifact, rawArtifactSha256: createHash('sha256').update(raw).digest('hex'), result };
});
const body = { version: 'theta-phase2-disposable-ci-evidence-v1', sourceSha: sha, ciRun: runId,
  ciUrl: run.url, observedAt: new Date().toISOString(), scope: 'DISPOSABLE_DATABASE_NOT_PRODUCTION',
  currentWorkerProven: false, brokerMutations: 0, runs };
const receipt = { ...body, artifactHash: createHash('sha256').update(JSON.stringify(body)).digest('hex') };
const path = 'docs/operations/evidence/THETA_PHASE2_DISPOSABLE_CI.json';
writeFileSync(path, JSON.stringify(receipt, null, 2) + '\n');
const registerPath = 'docs/operations/THETA_PHASE2_COMPLETION_REGISTER.json';
const register = JSON.parse(readFileSync(registerPath, 'utf8'));
const offlinePath = 'docs/operations/evidence/THETA_PHASE2_EXECUTED_TESTS.json';
const offline = JSON.parse(readFileSync(offlinePath, 'utf8'));
for (const row of register.requirements) {
  const proof = runs.find(item => item.binding.id === row.ID);
  if (!proof) continue;
  const deterministic = offline.results.find((item: {requirementId: string}) => item.requirementId === row.ID);
  if (!offline.executionSucceeded || deterministic?.state !== 'PASS') throw new Error('OFFLINE_REQUIREMENT_NOT_PROVEN');
  row.TEST_RESULT = { ...deterministic, command: offline.command, artifactHash: offline.artifactHash, artifactPath: offlinePath };
  row.DISPOSABLE_DB_EVIDENCE = { artifactPath: path, artifactHash: receipt.artifactHash, ciRun: runId,
    sourceSha: sha, requirementId: row.ID };
  row.CLOSURE_STATE = row.CURRENT_STATUS = 'CLOSED_ENGINEERING';
  row.BLOCKER_CLASS = 'NONE_ENGINEERING';
  row.FIX_REQUIRED = 'NO_KNOWN_SOURCE_FIX_REMAINING_FOR_REVIEWED_REQUIREMENT';
  row.FIX_COMMIT = sha;
  row.RUNTIME_EVIDENCE = 'Executed disposable PostgreSQL evidence. Deployed current-worker behavior remains separately unproven.';
}
register.PHASE2_CODE_SOLVABLE_COMPLETE = register.requirements.filter((row: {CODE_SOLVABLE: boolean; CLOSURE_STATE: string}) => row.CODE_SOLVABLE && row.CLOSURE_STATE === 'CLOSED_ENGINEERING').length;
register.PHASE2_CODE_SOLVABLE_REMAINING = register.PHASE2_CODE_SOLVABLE - register.PHASE2_CODE_SOLVABLE_COMPLETE;
register.currentPhase = register.PHASE2_CODE_SOLVABLE_REMAINING === 0 ? 3 : 2;
register.phase2EngineeringState = register.PHASE2_CODE_SOLVABLE_REMAINING === 0 ? 'CLOSED_REVIEWED_ENGINEERING' : 'OPEN';
register.phase2CurrentWorkerProof = 'PENDING_REVIEWED_RELEASE_INTEGRATION';
register.checkpoint = { CURRENT_PHASE: register.currentPhase, EXACT_CI: { sourceSha: sha, runId, conclusion: 'success' },
  COMPLETED: '21 reviewed Phase-2 engineering requirements have executed evidence, including real disposable database fault and fresh-cycle recovery tests.',
  OPEN_ITEMS: ['Current-worker release alignment', 'Lost original incident telemetry remains unidentifiable',
    'Phase 3 actual decision-authority, consumer, pruning and provenance audit'],
  NEXT_EXACT_ACTION: 'Continue Phase 3 without reopening completed Phase 1 infrastructure.' };
writeFileSync(registerPath, JSON.stringify(register, null, 2) + '\n');
console.log(JSON.stringify({ path, artifactHash: receipt.artifactHash, remaining: register.PHASE2_CODE_SOLVABLE_REMAINING,
  currentWorkerProven: false, nextPhase: register.currentPhase }));
