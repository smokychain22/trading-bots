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
