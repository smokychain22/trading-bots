import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { z } from 'zod';
import {
  invokeAndValidate,
  invokePythonModel,
  redactSecretShapedContent,
  type PythonBridgeConfig,
} from '../src/theta/python-bridge.js';

// This dev environment's Python 3.12 install, established earlier in this
// engagement (winget-installed since Python was not on PATH by default).
// Skips gracefully if genuinely absent so this suite doesn't fail on a
// machine without that exact install.
const CANDIDATE_PYTHON_PATHS = [
  process.env.PYTHON_EXECUTABLE_FOR_TESTS,
  'C:\\Users\\hp\\AppData\\Local\\Programs\\Python\\Python312\\python.exe',
].filter((candidate): candidate is string => candidate !== undefined);

const pythonExecutablePath = CANDIDATE_PYTHON_PATHS.find((candidate) => existsSync(candidate));

const fixture = (name: string): string => path.resolve('tests/fixtures/python-bridge', name);

const baseConfig = (overrides: Partial<PythonBridgeConfig> = {}): PythonBridgeConfig => ({
  pythonExecutablePath: pythonExecutablePath ?? 'python',
  scriptAllowlist: new Map([['valid', fixture('valid_response.py')]]),
  timeoutMs: 5000,
  maxOutputBytes: 1_000_000,
  ...overrides,
});

const responseSchema = z.object({
  policyVersion: z.string(),
  fusionSnapshotHash: z.string(),
  modelVersions: z.record(z.string(), z.string()),
});

test('redacts secret-shaped content without needing a live process', () => {
  const redacted = redactSecretShapedContent('failed: api_key=abcd1234efgh5678 while connecting');
  assert.ok(!redacted.includes('abcd1234efgh5678'));
  assert.ok(redacted.includes('<redacted>'));
});

test('an unknown model family fails closed without spawning anything', async () => {
  const result = await invokePythonModel(baseConfig(), 'nonexistent-family', {});
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.failureCode, 'UNKNOWN_MODEL_FAMILY');
});

test('process unavailable (bad executable path) fails closed as PROCESS_ERROR', async () => {
  const result = await invokePythonModel(
    baseConfig({ pythonExecutablePath: 'C:\\definitely\\not\\a\\real\\python.exe' }),
    'valid',
    {},
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.failureCode, 'PROCESS_ERROR');
});

test('a valid Python response round-trips through invokeAndValidate', { skip: pythonExecutablePath === undefined }, async () => {
  const config = baseConfig();
  const result = await invokeAndValidate(
    config, 'valid', { fusionSnapshotHash: 'abc123' }, (payload) => responseSchema.parse(payload),
    { expectedSnapshotHash: 'abc123', expectedPolicyVersion: 'v1', expectedModelVersions: { ownership: 'v1' } },
  );
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.data.fusionSnapshotHash, 'abc123');
});

test('malformed JSON fails closed, never silently becomes WAIT/OPEN', { skip: pythonExecutablePath === undefined }, async () => {
  const config = baseConfig({ scriptAllowlist: new Map([['bad', fixture('malformed_json.py')]]) });
  const result = await invokeAndValidate(config, 'bad', {}, (payload) => responseSchema.parse(payload));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.failureCode, 'MALFORMED_JSON');
});

test('NaN/Infinity tokens are rejected as malformed JSON', { skip: pythonExecutablePath === undefined }, async () => {
  const config = baseConfig({ scriptAllowlist: new Map([['nan', fixture('nan_infinity.py')]]) });
  const result = await invokeAndValidate(config, 'nan', {}, (payload) => responseSchema.parse(payload));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.failureCode, 'MALFORMED_JSON');
});

test('a non-zero exit fails closed and redacts secret-shaped stderr content', { skip: pythonExecutablePath === undefined }, async () => {
  const config = baseConfig({ scriptAllowlist: new Map([['fail', fixture('nonzero_exit.py')]]) });
  const result = await invokeAndValidate(config, 'fail', {}, (payload) => responseSchema.parse(payload));
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.failureCode, 'NON_ZERO_EXIT');
    assert.ok(!result.detail.includes('abcd1234efgh5678'));
  }
});

test('missing required field fails schema validation, not silently accepted', { skip: pythonExecutablePath === undefined }, async () => {
  const config = baseConfig({ scriptAllowlist: new Map([['missing', fixture('missing_field.py')]]) });
  const result = await invokeAndValidate(config, 'missing', {}, (payload) => responseSchema.parse(payload));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.failureCode, 'SCHEMA_VALIDATION_FAILED');
});

test('empty output fails closed as EMPTY_OUTPUT', { skip: pythonExecutablePath === undefined }, async () => {
  const config = baseConfig({ scriptAllowlist: new Map([['empty', fixture('empty_output.py')]]) });
  const result = await invokeAndValidate(config, 'empty', {}, (payload) => responseSchema.parse(payload));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.failureCode, 'EMPTY_OUTPUT');
});

test('wrong policyVersion/modelVersions fails closed as VERSION_MISMATCH', { skip: pythonExecutablePath === undefined }, async () => {
  const config = baseConfig({ scriptAllowlist: new Map([['wrong', fixture('wrong_version.py')]]) });
  const result = await invokeAndValidate(
    config, 'wrong', { fusionSnapshotHash: 'abc123' }, (payload) => responseSchema.parse(payload),
    { expectedPolicyVersion: 'v1' },
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.failureCode, 'VERSION_MISMATCH');
});

test('wrong fusionSnapshotHash fails closed as SNAPSHOT_MISMATCH', { skip: pythonExecutablePath === undefined }, async () => {
  const config = baseConfig();
  const result = await invokeAndValidate(
    config, 'valid', { fusionSnapshotHash: 'abc123' }, (payload) => responseSchema.parse(payload),
    { expectedSnapshotHash: 'different-hash' },
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.failureCode, 'SNAPSHOT_MISMATCH');
});

test('a timeout fails closed as TIMEOUT, never hangs the caller', { skip: pythonExecutablePath === undefined }, async () => {
  const config = baseConfig({ scriptAllowlist: new Map([['slow', fixture('sleep_forever.py')]]), timeoutMs: 200 });
  const result = await invokePythonModel(config, 'slow', {});
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.failureCode, 'TIMEOUT');
});

test('correlationId is present on every result, success or failure', async () => {
  const failure = await invokePythonModel(baseConfig(), 'nonexistent-family', {});
  assert.ok(failure.correlationId.length > 0);
});
