import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import process from 'node:process';
import {
  historicalFailureRegistryVersion,
  historicalFailureRegressions,
  validateHistoricalFailureRegistry,
} from '../src/operations/historical-failure-registry.js';

const registryIssues = validateHistoricalFailureRegistry();
const unclassified: string[] = [...registryIssues];
for (const item of historicalFailureRegressions) {
  for (const testFile of item.testFiles) {
    let source = '';
    try { source = readFileSync(testFile, 'utf8'); }
    catch { unclassified.push(`MISSING_TEST_FILE:${item.fixtureId}:${testFile}`); continue; }
    if (!new RegExp(item.proofPattern, 'i').test(source)) {
      unclassified.push(`PROOF_PATTERN_MISSING:${item.fixtureId}:${testFile}`);
    }
  }
}

const testFiles = [...new Set(historicalFailureRegressions.flatMap((item) => item.testFiles))].sort();
const regressionTimeoutMs = 300_000;
const execution = unclassified.length === 0
  ? spawnSync(process.execPath, ['--import', 'tsx', '--test', ...testFiles], {
    encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: regressionTimeoutMs, windowsHide: true,
  }) : null;
const executionTimedOut = execution?.error?.code === 'ETIMEDOUT' || execution?.signal !== null;
if (executionTimedOut) unclassified.push('HISTORICAL_REGRESSION_PROCESS_TIMEOUT');
else if (execution?.error !== undefined) unclassified.push('HISTORICAL_REGRESSION_PROCESS_START_FAILED');
const regression = execution !== null && !executionTimedOut && execution.error === undefined && execution.status !== 0
  ? historicalFailureRegressions.map((item) => item.fixtureId) : [];
const passed = execution?.status === 0 && !executionTimedOut ? historicalFailureRegressions.length : 0;
const receipt = {
  contractVersion: historicalFailureRegistryVersion,
  total: historicalFailureRegressions.length,
  pass: passed,
  fail: Math.max(0, historicalFailureRegressions.length - passed - regression.length),
  regression: regression.length,
  unclassified: unclassified.length,
  executedTestFiles: testFiles,
  failureIds: regression,
  unclassifiedReasons: unclassified,
  executionState: execution === null ? 'NOT_RUN'
    : executionTimedOut ? 'TIMED_OUT'
      : execution.error !== undefined ? 'START_FAILED'
        : execution.status === 0 ? 'PASS' : 'FAILED',
  executionTimeoutMs: regressionTimeoutMs,
  orderSubmissions: 0,
  brokerMutations: 0,
};
process.stdout.write(`${JSON.stringify(receipt)}\n`);
if (receipt.fail !== 0 || receipt.regression !== 0 || receipt.unclassified !== 0) process.exitCode = 1;
