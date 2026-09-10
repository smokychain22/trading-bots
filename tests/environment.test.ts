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
