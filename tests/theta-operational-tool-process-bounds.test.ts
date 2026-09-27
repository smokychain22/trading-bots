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
