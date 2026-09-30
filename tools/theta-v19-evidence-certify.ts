import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { buildV19EvidenceCertification, v19RequiredEvidenceFiles, v19RequiredTestFiles,
  v19ScenarioEvidence } from '../src/operations/v19-evidence-certification.js';
import { classifyLockedWorker } from '../src/operations/premarket-certification-plan.js';
import type { ExecutedTestEvent } from '../src/operations/executed-requirement-evidence.js';

const run = (command: string, args: readonly string[], timeout = 300_000) => spawnSync(command, [...args], {
  encoding: 'utf8', timeout, windowsHide: true, maxBuffer: 16 * 1024 * 1024,
});
const git = (...args: string[]) => (run('git', args, 30_000).stdout.trim().split(/\r?\n/).at(-1) ?? '');
const sourceSha = git('rev-parse', 'HEAD');
const sourceClean = run('git', ['status', '--porcelain'], 30_000).stdout.trim().length === 0;
const fileAuditFailures = v19RequiredEvidenceFiles.filter((file) => !existsSync(file));
for (const item of v19ScenarioEvidence) {
  if (existsSync(item.testFile) && !readFileSync(item.testFile, 'utf8').includes(item.testId)) {
    fileAuditFailures.push(`${item.testFile}#${item.testId}`);
  }
}
const executedTests: ExecutedTestEvent[] = [];
const testResults = Object.fromEntries(v19RequiredTestFiles.map((file) => {
  if (!existsSync(file)) return [file, false];
  const result = run(process.execPath, ['--import', 'tsx', '--test',
    '--test-reporter=./tools/theta-test-evidence-reporter.mjs', file]);
  const events = result.stdout.split(/\r?\n/).filter(line => line.startsWith('{'))
    .map(line => JSON.parse(line) as ExecutedTestEvent);
  executedTests.push(...events);
  return [file, result.status === 0 && !result.error && events.some(event => event.state === 'PASS')
    && !events.some(event => event.state === 'FAIL')];
}));
const unknown = run(process.execPath, ['--import', 'tsx', 'tools/theta-pre-vps-unknown-audit.ts']);
const regression = run(process.execPath, ['--import', 'tsx', 'tools/theta-historical-regressions.ts']);
let runtimeAlignmentState: 'ALIGNED' | 'EXTERNAL_BLOCKED' | 'MISALIGNED' = 'MISALIGNED';
let runtimeReceiptHash = createHash('sha256').update('RUNTIME_NOT_PROBED').digest('hex');
if (process.platform === 'win32') {
  const worker = run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
    'tools/windows/status-theta-local-worker.ps1'], 30_000);
  try {
    const line = worker.stdout.trim().split(/\r?\n/).at(-1) ?? '{}';
    const status = JSON.parse(line) as Record<string, unknown>;
    const classification = classifyLockedWorker(status, sourceSha);
    runtimeAlignmentState = classification.state === 'PASS' ? 'ALIGNED'
      : classification.state === 'EXTERNAL_BLOCKED' ? 'EXTERNAL_BLOCKED' : 'MISALIGNED';
    runtimeReceiptHash = createHash('sha256').update(line).digest('hex');
  } catch { runtimeAlignmentState = 'MISALIGNED'; }
}
const receipt = buildV19EvidenceCertification({ sourceSha, sourceClean, runtimeReceiptHash, runtimeAlignmentState,
  fileAuditFailures, testResults, executedTests, unknownAuditPass: unknown.status === 0,
  regressionAuditPass: regression.status === 0 });
process.stdout.write(`${JSON.stringify(receipt)}\n`);
// This legacy index cannot grant global certification. Requirement-specific
// executed evidence belongs in the current phase completion registers.
process.exitCode = receipt.FINAL_CERTIFICATION === 'FAIL' ? 1 : 2;
