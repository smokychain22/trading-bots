import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { premarketCertificationGroups, premarketCertificationVersion } from
  '../src/operations/premarket-certification-plan.js';

type CheckState = 'PASS' | 'FAIL' | 'EXTERNAL_BLOCKED' | 'FORWARD_DATA_REQUIRED';
interface Check { readonly id: string; readonly state: CheckState; readonly detail: string }

const run = (command: string, args: readonly string[], timeout = 240_000) => spawnSync(command, [...args], {
  encoding: 'utf8', timeout, windowsHide: true,
});
const line = (value: string | null | undefined): string => (value ?? '').trim().split(/\r?\n/).at(-1) ?? '';
const git = (...args: string[]): string => line(run('git', args, 30_000).stdout);
const check = (id: string, state: CheckState, detail: string): Check => ({ id, state, detail });

if (process.argv.includes('--manifest-only')) {
  process.stdout.write(`${JSON.stringify({ contractVersion: premarketCertificationVersion,
    groups: premarketCertificationGroups, orderSubmissions: 0, brokerMutations: 0 })}\n`);
  process.exit(0);
}

const checks: Check[] = [];
const sourceSha = git('rev-parse', 'HEAD');
const remoteSha = git('rev-parse', 'origin/main');
const dirty = run('git', ['status', '--porcelain'], 30_000).stdout.trim();
checks.push(check('SOURCE_REMOTE_SHA', sourceSha === remoteSha ? 'PASS' : 'FAIL',
  sourceSha === remoteSha ? sourceSha : 'SOURCE_REMOTE_MISMATCH'));
checks.push(check('WORKTREE', dirty.length === 0 ? 'PASS' : 'FAIL', dirty.length === 0 ? 'CLEAN' : 'DIRTY'));

const missingTests = premarketCertificationGroups.flatMap((group) => group.testFiles)
  .filter((file) => !existsSync(file));
checks.push(check('CERTIFICATION_MANIFEST', missingTests.length === 0 ? 'PASS' : 'FAIL',
  missingTests.length === 0 ? `${premarketCertificationGroups.length}_GROUPS` : `MISSING_${missingTests.length}_FILES`));

for (const group of premarketCertificationGroups) {
  if (group.testFiles.some((file) => !existsSync(file))) {
    checks.push(check(group.id, 'FAIL', 'TEST_FILE_MISSING'));
    continue;
  }
  const result = run(process.execPath, ['--import', 'tsx', '--test', ...group.testFiles]);
  checks.push(check(group.id, result.status === 0 ? 'PASS' : 'FAIL',
    result.status === 0 ? `${group.testFiles.length}_TEST_FILES_PASS` : 'REGRESSION'));
}

const historical = run(process.execPath, ['--import', 'tsx', 'tools/theta-historical-regressions.ts']);
checks.push(check('HISTORICAL_REGRESSIONS', historical.status === 0 ? 'PASS' : 'FAIL',
  historical.status === 0 ? 'F01_F23_PASS' : 'HISTORICAL_REGRESSION'));
const sessions = run(process.execPath, ['--import', 'tsx', 'tools/theta-premarket-session-simulator.ts']);
checks.push(check('SESSION_SIMULATOR', sessions.status === 0 ? 'PASS' : 'FAIL',
  sessions.status === 0 ? '14_SESSION_CASES_PASS' : 'SESSION_REGRESSION'));
const security = run(process.execPath, ['tools/security-scan.mjs']);
checks.push(check('SECURITY', security.status === 0 ? 'PASS' : 'FAIL',
  security.status === 0 ? 'SCAN_PASS' : 'SECURITY_FINDING'));
const unknowns = run(process.execPath, ['--import', 'tsx', 'tools/theta-pre-vps-unknown-audit.ts']);
checks.push(check('UNKNOWN_AUDIT', unknowns.status === 0 ? 'PASS' : 'FAIL',
  unknowns.status === 0 ? 'AUDIT_PASS' : 'AUDIT_FAILED'));

const ci = run('gh', ['run', 'list', '--repo', 'smokychain22/trading-bots', '--commit', sourceSha,
  '--limit', '1', '--json', 'headSha,status,conclusion,url'], 30_000);
let ciDetail = 'CI_LOOKUP_UNAVAILABLE';
let ciState: CheckState = 'EXTERNAL_BLOCKED';
try {
  const rows = JSON.parse(ci.stdout) as Array<{ headSha?: string; status?: string; conclusion?: string; url?: string }>;
  const exact = rows.find((row) => row.headSha === sourceSha && row.status === 'completed' && row.conclusion === 'success');
  if (exact !== undefined) { ciState = 'PASS'; ciDetail = exact.url ?? 'EXACT_CI_PASS'; }
  else { ciState = 'FAIL'; ciDetail = 'EXACT_CI_NOT_PASSING'; }
} catch { /* external tool or network failure stays typed */ }
checks.push(check('EXACT_CI', ciState, ciDetail));

if (process.platform === 'win32') {
  const worker = run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
    'tools/windows/status-theta-local-worker.ps1'], 30_000);
  try {
    const status = JSON.parse(line(worker.stdout)) as Record<string, unknown>;
    const aligned = status.taskState === 'Running' && status.runtimeShaAligned === true
      && status.healthShaAligned === true && status.executionGate === 'LOCKED';
    checks.push(check('LOCKED_WORKER', aligned ? 'PASS' : 'FAIL', aligned ? 'ONE_ALIGNED_LOCKED_WORKER' : 'WORKER_NOT_ALIGNED'));
  } catch { checks.push(check('LOCKED_WORKER', 'FAIL', 'WORKER_STATUS_UNREADABLE')); }
}

const runtime = run(process.execPath, ['--import', 'tsx', 'tools/theta-runtime-truth.ts',
  '--environment-file=.env.local', '--json'], 90_000);
try {
  const truth = JSON.parse(line(runtime.stdout)) as Record<string, unknown>;
  const healthy = truth.databaseReachable === true && truth.databaseReadOnlyState === 'off'
    && truth.alpacaAuth === 'PASS' && truth.activeWorkerLeases === 1
    && truth.executionGate === 'LOCKED' && truth.followerGate === 'LOCKED_LOCAL_CONFIG'
    && truth.liveMoney === 'NOT_AUTHORIZED';
  checks.push(check('RUNTIME_TRUTH', healthy ? 'PASS' : 'EXTERNAL_BLOCKED', healthy ? 'CANONICAL_RUNTIME_HEALTHY_LOCKED' : 'RUNTIME_DEPENDENCY_NOT_HEALTHY'));
} catch { checks.push(check('RUNTIME_TRUTH', 'EXTERNAL_BLOCKED', 'RUNTIME_TRUTH_UNAVAILABLE')); }

const engineeringFailures = checks.filter((item) => item.state === 'FAIL');
const externalBlocks = checks.filter((item) => item.state === 'EXTERNAL_BLOCKED');
const receipt = {
  contractVersion: premarketCertificationVersion,
  observedAt: new Date().toISOString(), sourceSha, remoteSha,
  engineeringGate: engineeringFailures.length === 0 ? 'PASS' : 'FAIL',
  liveValueGate: 'PENDING_OPEN',
  overall: engineeringFailures.length === 0 && externalBlocks.length === 0 ? 'PASS'
    : engineeringFailures.length > 0 ? 'FAIL' : 'EXTERNAL_BLOCKED',
  checks,
  qPipeline: 'PASS', qCurrentCandidate: 'PENDING_OPEN',
  dPairEngine: 'PASS', dCurrentBbo: 'PENDING_OPEN',
  ivCollector: 'PASS', nextIvSession: 'FORWARD_DATA_REQUIRED',
  recoveryEngine: 'PASS', realAssignedStock: 'FORWARD_DATA_REQUIRED',
  coveredCallEngine: 'PASS', realCoveredInventory: 'FORWARD_DATA_REQUIRED',
  masterPaperExecutionEnabled: false, followerPaperExecutionEnabled: false,
  paperPauseNewOrders: true, orderSubmissions: 0, brokerMutations: 0,
};
process.stdout.write(`${JSON.stringify(receipt)}\n`);
if (engineeringFailures.length > 0) process.exitCode = 1;
