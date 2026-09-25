import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { buildV20EvidenceClosure, criticalDimensionProbeSpecs, crossStrategyProbeSpecs,
  realDataRouteProbeSpecs, strategyCapabilityProbeIds, strategyIdentityProbeSpecs,
  v18CoverageProbeSpecs, type EvidenceProbeSpec, type ExecutedNamedTest }
  from '../src/operations/v20-evidence-closure.js';
import { v19ScenarioEvidence } from '../src/operations/v19-evidence-certification.js';

const run = (command: string, args: readonly string[], timeout = 300_000) => spawnSync(command, [...args], {
  encoding: 'utf8', timeout, windowsHide: true,
});
const git = (...args: string[]) => run('git', args, 30_000).stdout.trim().split(/\r?\n/).at(-1) ?? '';
const key = (file: string, id: string) => `${file}#${id}`;
const scenarioSpecs: readonly EvidenceProbeSpec[] = v19ScenarioEvidence.map((item) => ({
  id: item.id, sourceFile: item.testFile, testFile: item.testFile, testId: item.testId,
}));
const allSpecs = [...realDataRouteProbeSpecs, ...crossStrategyProbeSpecs, ...v18CoverageProbeSpecs,
  ...scenarioSpecs, ...Object.values(strategyIdentityProbeSpecs), ...Object.values(criticalDimensionProbeSpecs)];
const uniqueSpecs = [...new Map(allSpecs.map((item) => [key(item.testFile, item.testId), item])).values()];

const namedTests: Record<string, ExecutedNamedTest> = {};
const typescriptFiles = [...new Set(uniqueSpecs.filter((item) => item.testFile.endsWith('.ts')).map((item) => item.testFile))];
for (const file of typescriptFiles) {
  const source = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const result = existsSync(file) ? run(process.execPath, ['--import', 'tsx', '--test', '--test-reporter=tap', file]) : null;
  const output = `${result?.stdout ?? ''}\n${result?.stderr ?? ''}`;
  for (const item of uniqueSpecs.filter((spec) => spec.testFile === file)) {
    const exists = source.includes(item.testId);
    const lines = output.split(/\r?\n/).filter((line) => line.includes(item.testId));
    const skipped = lines.some((line) => /# SKIP/i.test(line));
    const failed = lines.some((line) => /^\s*not ok\b/i.test(line));
    const executed = lines.some((line) => /^\s*ok\b/i.test(line) && !/# SKIP/i.test(line));
    namedTests[key(file, item.testId)] = { testFile: file, testId: item.testId, exists, executed,
      passed: exists && executed && !failed && result?.status === 0, skipped };
  }
}
for (const item of uniqueSpecs.filter((spec) => spec.testFile.endsWith('.py'))) {
  const exists = existsSync(item.testFile) && readFileSync(item.testFile, 'utf8').includes(item.testId);
  const module = item.testFile.replace(/[\\/]/g, '.').replace(/\.py$/, '');
  const result = exists ? run('python', ['-m', 'unittest', '-v', `${module}.FeatureFamilyStatusTests.${item.testId}`]) : null;
  const output = `${result?.stdout ?? ''}\n${result?.stderr ?? ''}`;
  namedTests[key(item.testFile, item.testId)] = { testFile: item.testFile, testId: item.testId, exists,
    executed: output.includes(item.testId), passed: exists && output.includes(item.testId) && result?.status === 0, skipped: false };
}

const v19MatrixProbePass: Record<string, boolean> = {};
for (const id of strategyCapabilityProbeIds) {
  const split = id.indexOf('_');
  const strategy = id.slice(0, split) as keyof typeof strategyIdentityProbeSpecs;
  const dimension = id.slice(split + 1) as keyof typeof criticalDimensionProbeSpecs;
  const strategyProbe = strategyIdentityProbeSpecs[strategy];
  const dimensionProbe = criticalDimensionProbeSpecs[dimension];
  v19MatrixProbePass[id] = namedTests[key(strategyProbe.testFile, strategyProbe.testId)]?.passed === true
    && namedTests[key(dimensionProbe.testFile, dimensionProbe.testId)]?.passed === true;
}

const parseLastJson = (text: string): Record<string, unknown> => {
  for (const line of text.trim().split(/\r?\n/).reverse()) {
    try { return JSON.parse(line) as Record<string, unknown>; } catch { /* continue */ }
  }
  return {};
};
const unknownRun = run(process.execPath, ['--import', 'tsx', 'tools/theta-pre-vps-unknown-audit.ts']);
const regressionRun = run(process.execPath, ['--import', 'tsx', 'tools/theta-historical-regressions.ts']);
const unknown = parseLastJson(unknownRun.stdout);
const regression = parseLastJson(regressionRun.stdout);
const sourceSha = git('rev-parse', 'HEAD');
let workerSha = 'UNVERIFIED'; let runtimeAligned = false;
if (process.platform === 'win32') {
  const worker = run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
    'tools/windows/status-theta-local-worker.ps1'], 30_000);
  const status = parseLastJson(worker.stdout);
  workerSha = typeof status.runtimeSha === 'string' ? status.runtimeSha : workerSha;
  runtimeAligned = workerSha === sourceSha && status.taskState === 'Running'
    && status.executionGate === 'LOCKED' && status.healthShaAligned === true;
}
let exactCi = 'UNVERIFIED';
const ci = run('gh', ['run', 'list', '--commit', sourceSha, '--limit', '20', '--json',
  'databaseId,status,conclusion,headSha'], 60_000);
try {
  const rows = JSON.parse(ci.stdout) as Array<Record<string, unknown>>;
  const successful = rows.find((row) => row.headSha === sourceSha && row.status === 'completed' && row.conclusion === 'success');
  if (successful) exactCi = String(successful.databaseId);
} catch { /* retained as UNVERIFIED */ }

const receipt = buildV20EvidenceClosure({ sourceSha, workerSha, exactCi,
  sourceClean: run('git', ['status', '--porcelain'], 30_000).stdout.trim().length === 0,
  namedTests, v19MatrixProbePass,
  genericEngineeringUnknown: Number(unknown.avoidableUnknownCount ?? 1),
  genericDecisionUnknown: Number(unknown.unresolvedSafetyCriticalCount ?? 1)
    + Number(unknown.unresolvedPaperEntryCount ?? 1),
  genericWait: Number(regression.unclassified ?? 1), runtimeAligned,
  liveValuesCurrent: false, ownerPaperAuthorized: false });
process.stdout.write(`${JSON.stringify(receipt)}\n`);
if (receipt.V20_FINAL_EVIDENCE_CERTIFICATION !== 'PASS') process.exitCode = 1;
