import assert from 'node:assert/strict';
import test from 'node:test';
import { writeFileSync, unlinkSync } from 'node:fs';
import { assertProviderConfiguration, assertRuntimeConfiguration, loadEnvironment, loadEnvironmentFile, missingProviderVariables } from '../src/config/environment.js';

test('reports missing Alpaca settings by name only', () => {
  const environment = loadEnvironment({});
  assert.deepEqual(missingProviderVariables(environment, 'ALPACA'), [
    'ALPACA_API_KEY',
    'ALPACA_SECRET_KEY',
    'ALPACA_BASE_URL'
  ]);
});

test('accepts complete paper-provider configuration', () => {
  const environment = loadEnvironment({
    ALPACA_API_KEY: 'test-key',
    ALPACA_SECRET_KEY: 'test-secret',
    ALPACA_BASE_URL: 'https://paper-api.alpaca.markets',
    OPTIONOMICS_API_KEY: 'test-key',
    OPTIONOMICS_EMAIL: 'test@example.com'
  });
  assert.doesNotThrow(() => assertProviderConfiguration(environment, 'ALPACA'));
  assert.doesNotThrow(() => assertProviderConfiguration(environment, 'OPTIONOMICS'));
});

test('rejects malformed provider URLs', () => {
  const environment = loadEnvironment({
    ALPACA_API_KEY: 'test-key',
    ALPACA_SECRET_KEY: 'test-secret',
    ALPACA_BASE_URL: 'not-a-url',
    OPTIONOMICS_API_KEY: 'test-key',
    OPTIONOMICS_EMAIL: 'test@example.com'
  });
  assert.throws(() => assertRuntimeConfiguration(environment), /paper API/);
});

test('rejects a non-paper Alpaca endpoint', () => {
  const environment = loadEnvironment({
    ALPACA_API_KEY: 'test-key',
    ALPACA_SECRET_KEY: 'test-secret',
    ALPACA_BASE_URL: 'https://api.alpaca.markets',
    OPTIONOMICS_API_KEY: 'test-key',
    OPTIONOMICS_EMAIL: 'test@example.com'
  });
  assert.throws(() => assertRuntimeConfiguration(environment), /paper API/);
});

test('rejects lookalike Alpaca paper hosts and non-root paths', () => {
  const base = {
    ALPACA_API_KEY: 'test-key',
    ALPACA_SECRET_KEY: 'test-secret',
    OPTIONOMICS_API_KEY: 'test-key',
    OPTIONOMICS_EMAIL: 'test@example.com'
  } as const;
  for (const ALPACA_BASE_URL of [
    'https://paper-api.alpaca.markets.evil.invalid',
    'https://paper-api.alpaca.markets@evil.invalid',
    'https://paper-api.alpaca.markets/v2'
  ]) {
    assert.throws(
      () => assertRuntimeConfiguration(loadEnvironment({ ...base, ALPACA_BASE_URL })),
      /paper API/
    );
  }
});

test('rejects an invalid Optionomics email only when checking Optionomics', () => {
  const environment = loadEnvironment({
    ALPACA_API_KEY: 'test-key',
    ALPACA_SECRET_KEY: 'test-secret',
    ALPACA_BASE_URL: 'https://paper-api.alpaca.markets',
    OPTIONOMICS_API_KEY: 'test-key',
    OPTIONOMICS_EMAIL: 'not-an-email'
  });
  assert.doesNotThrow(() => assertProviderConfiguration(environment, 'ALPACA'));
  assert.throws(() => assertProviderConfiguration(environment, 'OPTIONOMICS'), /valid email address/);
});

test('parses dotenv quotes and lets the explicit file override stale process values', () => {
  const filePath = 'tests/.environment-precedence.env';
  writeFileSync(filePath, 'ALPACA_BASE_URL="https://paper-api.alpaca.markets"\nOPTIONOMICS_EMAIL="info@techisthenewblack.com"\n');
  try {
    const environment = loadEnvironmentFile(filePath, {
      ALPACA_BASE_URL: 'stale-placeholder',
      OPTIONOMICS_EMAIL: 'stale-placeholder'
    });
    assert.equal(environment.ALPACA_BASE_URL, 'https://paper-api.alpaca.markets');
    assert.equal(environment.OPTIONOMICS_EMAIL, 'info@techisthenewblack.com');
  } finally {
    unlinkSync(filePath);
  }
});

test('Vercel redaction markers never override real process values', () => {
  const filePath = 'tests/.environment-precedence.env';
  writeFileSync(filePath, 'ALPACA_API_KEY="[SENSITIVE]"\nMASTER_PAPER_EXECUTION_ENABLED="[SENSITIVE]"\n');
  try {
    const environment = loadEnvironmentFile(filePath, {
      ALPACA_API_KEY: 'real-process-key', MASTER_PAPER_EXECUTION_ENABLED: 'false',
    });
    assert.equal(environment.ALPACA_API_KEY, 'real-process-key');
    assert.equal(environment.MASTER_PAPER_EXECUTION_ENABLED, false);
  } finally {
    unlinkSync(filePath);
  }
});

test('empty dotenv placeholders never override securely injected process values',()=>{
  const filePath='tests/.environment-precedence.env';
  writeFileSync(filePath,'CRON_SECRET=\nOPTIONOMICS_EMAIL=\n');
  try{
    const environment=loadEnvironmentFile(filePath,{CRON_SECRET:'x'.repeat(40),OPTIONOMICS_EMAIL:'ops@example.com'});
    assert.equal(environment.CRON_SECRET,'x'.repeat(40));
    assert.equal(environment.OPTIONOMICS_EMAIL,'ops@example.com');
  }finally{unlinkSync(filePath);}
});

test('Vercel redaction markers without a real fallback fail closed', () => {
  const filePath = 'tests/.environment-precedence.env';
  writeFileSync(filePath, 'ALPACA_API_KEY="[SENSITIVE]"\nPAPER_PAUSE_NEW_ORDERS="[SENSITIVE]"\n');
  try {
    const environment = loadEnvironmentFile(filePath, {});
    assert.equal(environment.ALPACA_API_KEY, undefined);
    assert.equal(environment.PAPER_PAUSE_NEW_ORDERS, true);
  } finally {
    unlinkSync(filePath);
  }
});

test('a Vercel redaction sentinel already loaded into process env is ignored', () => {
  const filePath = 'tests/.environment-precedence.env';
  writeFileSync(filePath, 'PRIVATE_PAPER_API_KEY_BETA_ENABLED="[SENSITIVE]"\n');
  try {
    const parsed = loadEnvironmentFile(filePath, { PRIVATE_PAPER_API_KEY_BETA_ENABLED:'[SENSITIVE]' });
    assert.equal(parsed.PRIVATE_PAPER_API_KEY_BETA_ENABLED, false);
  } finally {
    unlinkSync(filePath);
  }
});

// Security correction: a credential-loading/validation failure must report
// PRESENT/MISSING/VALID/INVALID by name only -- never the secret value
// itself, even when the value is realistic-shaped. Every thrown message and
// every missingProviderVariables() entry is checked structurally here
// rather than trusted by convention.
const REALISTIC_FAKE_SECRET = 'FakeTestSecretValueNotReal0000000000000000';

test('a configuration error message never contains the secret value that triggered it', () => {
  const environment = loadEnvironment({
    ALPACA_API_KEY: 'test-key',
    ALPACA_SECRET_KEY: REALISTIC_FAKE_SECRET,
    ALPACA_BASE_URL: 'not-a-url', // triggers assertRuntimeConfiguration's thrown error
    OPTIONOMICS_API_KEY: 'test-key',
    OPTIONOMICS_EMAIL: 'test@example.com'
  });
  try {
    assertRuntimeConfiguration(environment);
    assert.fail('expected assertRuntimeConfiguration to throw for a malformed ALPACA_BASE_URL');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    assert.ok(!message.includes(REALISTIC_FAKE_SECRET), 'thrown configuration error must never echo a secret value');
  }
});

test('missingProviderVariables reports variable NAMES only, never a partially-set value', () => {
  const environment = loadEnvironment({ ALPACA_API_KEY: REALISTIC_FAKE_SECRET });
  const missing = missingProviderVariables(environment, 'ALPACA');
  const serialized = JSON.stringify(missing);
  assert.ok(!serialized.includes(REALISTIC_FAKE_SECRET), 'missingProviderVariables must never include an actual configured value');
  assert.deepEqual(missing, ['ALPACA_SECRET_KEY', 'ALPACA_BASE_URL']);
});

test('paper execution flags fail closed when absent or blank', () => {
  const absent = loadEnvironment({ NODE_ENV: 'test' });
  assert.equal(absent.MASTER_PAPER_EXECUTION_ENABLED, false);
  assert.equal(absent.FOLLOWER_PAPER_EXECUTION_ENABLED, false);
  assert.equal(absent.PAPER_PAUSE_NEW_ORDERS, true);
  assert.equal(absent.THETA_RUNTIME_MODE, 'THETA_SHADOW_ONLY');
  const blank = loadEnvironment({
    NODE_ENV: 'test', MASTER_PAPER_EXECUTION_ENABLED: '', FOLLOWER_PAPER_EXECUTION_ENABLED: '', PAPER_PAUSE_NEW_ORDERS: '',
  });
  assert.equal(blank.MASTER_PAPER_EXECUTION_ENABLED, false);
  assert.equal(blank.FOLLOWER_PAPER_EXECUTION_ENABLED, false);
  assert.equal(blank.PAPER_PAUSE_NEW_ORDERS, true);
});

test('runtime mode cannot be configured to a broker-mutating mode',()=>{
  assert.throws(()=>loadEnvironment({THETA_RUNTIME_MODE:'PAPER_EXECUTION'}),/THETA_RUNTIME_MODE/);
});
