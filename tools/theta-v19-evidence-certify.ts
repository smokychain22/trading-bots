import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { buildV19EvidenceCertification, v19RequiredEvidenceFiles, v19RequiredTestFiles,
  v19ScenarioEvidence } from '../src/operations/v19-evidence-certification.js';

const run = (command: string, args: readonly string[], timeout = 300_000) => spawnSync(command, [...args], {
  encoding: 'utf8', timeout, windowsHide: true,
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
const testResults = Object.fromEntries(v19RequiredTestFiles.map((file) => {
  if (!existsSync(file)) return [file, false];
  const result = run(process.execPath, ['--import', 'tsx', '--test', file]);
  return [file, result.status === 0];
}));
const unknown = run(process.execPath, ['--import', 'tsx', 'tools/theta-pre-vps-unknown-audit.ts']);
const regression = run(process.execPath, ['--import', 'tsx', 'tools/theta-historical-regressions.ts']);
let runtimeAligned = false;
let runtimeReceiptHash = createHash('sha256').update('RUNTIME_NOT_PROBED').digest('hex');
if (process.platform === 'win32') {
  const worker = run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
    'tools/windows/status-theta-local-worker.ps1'], 30_000);
  try {
    const line = worker.stdout.trim().split(/\r?\n/).at(-1) ?? '{}';
    const status = JSON.parse(line) as Record<string, unknown>;
    runtimeAligned = status.runtimeSha === sourceSha && status.healthShaAligned === true
      && status.taskState === 'Running' && status.executionGate === 'LOCKED';
    runtimeReceiptHash = createHash('sha256').update(line).digest('hex');
  } catch { runtimeAligned = false; }
}
const receipt = buildV19EvidenceCertification({ sourceSha, sourceClean, runtimeReceiptHash, runtimeAligned,
  fileAuditFailures, testResults, unknownAuditPass: unknown.status === 0,
  regressionAuditPass: regression.status === 0 });
process.stdout.write(`${JSON.stringify(receipt)}\n`);
if (receipt.FINAL_CERTIFICATION !== 'PASS') process.exitCode = 1;
