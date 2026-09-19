import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { buildHarRvShadowComparison } from '../src/research/har-rv-shadow.js';
import type { VolatilityAccelerationEvidence } from '../src/research/volatility-acceleration.js';
import type { PythonBridgeConfig } from '../src/theta/python-bridge.js';

const CANDIDATE_PYTHON_PATHS = [
  process.env.PYTHON_EXECUTABLE_FOR_TESTS,
  'C:\\Users\\hp\\AppData\\Local\\Programs\\Python\\Python312\\python.exe',
].filter((candidate): candidate is string => candidate !== undefined);

const pythonExecutablePath = CANDIDATE_PYTHON_PATHS.find((candidate) => existsSync(candidate));

const harRvScript = path.resolve('bots/theta/quant/runtime/har_rv_contract.py');

const acceleration = (overrides: Partial<VolatilityAccelerationEvidence> = {}): VolatilityAccelerationEvidence => ({
  contractVersion: 'theta-volatility-acceleration-shadow-v1', asOf: '2026-09-19T00:00:00.000Z',
  rv5: 0.20, rv21: 0.18, rv63: 0.22, weeklyVsMonthly: 0.02, monthlyVsQuarterly: -0.04,
  state: 'KNOWN', brokerAuthority: false, ...overrides,
});

function sinSeries(n: number, scale: number): number[] {
  return Array.from({ length: n }, (_, i) => scale * (2.0 + Math.sin(i * 0.37) + 0.5 * Math.cos(i * 0.131)));
}

test('buildHarRvShadowComparison never claims broker authority and always includes the simple baselines', { skip: pythonExecutablePath === undefined ? 'Python 3.12 not found on this machine' : false }, async () => {
  const config: PythonBridgeConfig = {
    pythonExecutablePath: pythonExecutablePath as string,
    scriptAllowlist: new Map([['harRv', harRvScript]]),
    timeoutMs: 10_000, maxOutputBytes: 1_000_000,
  };
  const result = await buildHarRvShadowComparison({
    bridgeConfig: config, snapshotId: 'snap-1', timestamp: '2026-09-19T00:00:00.000Z', asOf: '2026-09-19T00:00:00.000Z',
    realizedVarianceSeries: sinSeries(200, 0.0002), acceleration: acceleration(), minimumTrainingObservations: 30,
  });
  assert.equal(result.brokerAuthority, false);
  assert.equal(result.harRv.state, 'AVAILABLE');
  assert.ok((result.harRv.forecastRealizedVolatility as number) > 0);
  assert.equal(result.rv5, 0.20);
  assert.equal(result.naivePersistenceRealizedVolatility, 0.20);
});

test('insufficient history degrades to DEGRADED_RESEARCH_FEATURE, never a fabricated forecast', { skip: pythonExecutablePath === undefined ? 'Python 3.12 not found on this machine' : false }, async () => {
  const config: PythonBridgeConfig = {
    pythonExecutablePath: pythonExecutablePath as string,
    scriptAllowlist: new Map([['harRv', harRvScript]]),
    timeoutMs: 10_000, maxOutputBytes: 1_000_000,
  };
  const result = await buildHarRvShadowComparison({
    bridgeConfig: config, snapshotId: 'snap-1', timestamp: '2026-09-19T00:00:00.000Z', asOf: '2026-09-19T00:00:00.000Z',
    realizedVarianceSeries: [0.0001, 0.0002, 0.0001], acceleration: acceleration(), minimumTrainingObservations: 30,
  });
  assert.equal(result.harRv.state, 'DEGRADED_RESEARCH_FEATURE');
  assert.equal(result.harRv.forecastRealizedVolatility, null);
  assert.equal(result.brokerAuthority, false);
});

test('a genuinely unavailable Python executable degrades to DEGRADED_RESEARCH_FEATURE with a bridge failure code, never a thrown exception', async () => {
  const config: PythonBridgeConfig = {
    pythonExecutablePath: 'C:\\this\\path\\does\\not\\exist\\python.exe',
    scriptAllowlist: new Map([['harRv', harRvScript]]),
    timeoutMs: 5_000, maxOutputBytes: 1_000_000,
  };
  const result = await buildHarRvShadowComparison({
    bridgeConfig: config, snapshotId: 'snap-1', timestamp: '2026-09-19T00:00:00.000Z', asOf: '2026-09-19T00:00:00.000Z',
    realizedVarianceSeries: sinSeries(200, 0.0002), acceleration: acceleration(),
  });
  assert.equal(result.harRv.state, 'DEGRADED_RESEARCH_FEATURE');
  assert.equal(result.harRv.failureCode, 'BRIDGE_PROCESS_ERROR');
  assert.equal(result.brokerAuthority, false);
});

test('an unallowlisted model family degrades to DEGRADED_RESEARCH_FEATURE via BRIDGE_UNKNOWN_MODEL_FAMILY', async () => {
  const config: PythonBridgeConfig = {
    pythonExecutablePath: pythonExecutablePath ?? 'python',
    scriptAllowlist: new Map(), // harRv deliberately not allowlisted
    timeoutMs: 5_000, maxOutputBytes: 1_000_000,
  };
  const result = await buildHarRvShadowComparison({
    bridgeConfig: config, snapshotId: 'snap-1', timestamp: '2026-09-19T00:00:00.000Z', asOf: '2026-09-19T00:00:00.000Z',
    realizedVarianceSeries: sinSeries(200, 0.0002), acceleration: acceleration(),
  });
  assert.equal(result.harRv.failureCode, 'BRIDGE_UNKNOWN_MODEL_FAMILY');
});
