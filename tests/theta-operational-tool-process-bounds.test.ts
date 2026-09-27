import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('historical regression execution has a hard deadline and sanitized failure receipt', () => {
  const source = readFileSync('tools/theta-historical-regressions.ts', 'utf8');
  assert.match(source, /timeout:\s*regressionTimeoutMs/);
  assert.match(source, /maxBuffer:\s*16 \* 1024 \* 1024/);
  assert.match(source, /HISTORICAL_REGRESSION_PROCESS_TIMEOUT/);
  assert.match(source, /executionState/);
  assert.doesNotMatch(source, /process\.stderr\.write\(execution\.stderr\)/);
});

test('historical certification bounds git and nested regression processes', () => {
  const source = readFileSync('tools/theta-history-certify.ts', 'utf8');
  assert.match(source, /timeout:\s*30_000/);
  assert.match(source, /timeout:\s*regressionTimeoutMs/);
  assert.match(source, /regressionProcessState/);
  assert.match(source, /regressionProcessTimeoutMs/);
});

test('method census uses argument-safe bounded git execution', () => {
  const source = readFileSync('tools/theta-method-census.mjs', 'utf8');
  assert.match(source, /execFileSync\('git', \['ls-files', pattern\]/);
  assert.match(source, /timeout:\s*30_000/);
  assert.doesNotMatch(source, /execSync\(/);
});

test('runtime and recovery tools bound immutable source identity probes', () => {
  for (const path of [
    'src/theta/theta-shadow-once.ts',
    'tools/theta-no-submit-probe.ts',
    'tools/theta-runtime-truth.ts',
    'tools/theta-local-evidence-backfill.ts',
    'tools/theta-database-recovery-gate.mjs',
  ]) {
    const source = readFileSync(path, 'utf8');
    assert.match(source, /timeout:\s*30_000/, path);
    assert.match(source, /windowsHide:\s*true/, path);
  }
});

test('forensic and legacy discovery processes have bounded execution', () => {
  const forensic = readFileSync('tools/local-forensic-recovery-sweep.ts', 'utf8');
  assert.match(forensic, /timeout:localSearchTimeoutMs/);
  assert.match(forensic, /SEARCH_TIMEOUT/);
  assert.match(forensic, /timeout:gitProcessTimeoutMs/);
  const legacy = readFileSync('tools/legacy-reconstruction-sweep.ts', 'utf8');
  assert.match(legacy, /timeout:discoveryProcessTimeoutMs/g);
  assert.match(legacy, /windowsHide:true/);
});

test('operator-facing git and HTTP probes cannot wait forever', () => {
  for (const path of [
    'tools/capture-canonical-event-export.ts',
    'tools/export-historical-replay.ts',
    'tools/check-git-storage-policy.ts',
    'tools/security-scan.mjs',
    'tools/summarize-historical-replay.ts',
    'tools/theta-risk-policy-study.ts',
    'tools/theta-profit-taking-replay.ts',
    'tools/theta-runtime-wiring-audit.ts',
    'tools/theta-system-truth.ts',
  ]) {
    const source = readFileSync(path, 'utf8');
    assert.match(source, /timeout:\s*30_000/, path);
  }
  const riskStudy = readFileSync('tools/theta-risk-policy-study.ts', 'utf8');
  assert.match(riskStudy, /AbortSignal\.timeout\(120_000\)/);
});
