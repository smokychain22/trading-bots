import assert from 'node:assert/strict';
import test from 'node:test';
import { assertProviderConfiguration, assertRuntimeConfiguration, loadEnvironment, missingProviderVariables } from '../src/config/environment.js';

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
    OPTIONOMICS_API_KEY: 'test-key'
  });
  assert.doesNotThrow(() => assertProviderConfiguration(environment, 'ALPACA'));
  assert.doesNotThrow(() => assertProviderConfiguration(environment, 'OPTIONOMICS'));
});

test('rejects malformed provider URLs', () => {
  const environment = loadEnvironment({
    ALPACA_API_KEY: 'test-key',
    ALPACA_SECRET_KEY: 'test-secret',
    ALPACA_BASE_URL: 'not-a-url',
    OPTIONOMICS_API_KEY: 'test-key'
  });
  assert.throws(() => assertRuntimeConfiguration(environment), /paper API/);
});

test('rejects a non-paper Alpaca endpoint', () => {
  const environment = loadEnvironment({
    ALPACA_API_KEY: 'test-key',
    ALPACA_SECRET_KEY: 'test-secret',
    ALPACA_BASE_URL: 'https://api.alpaca.markets',
    OPTIONOMICS_API_KEY: 'test-key'
  });
  assert.throws(() => assertRuntimeConfiguration(environment), /paper API/);
});
