import assert from 'node:assert/strict';
import test from 'node:test';
import { assertNoSubmitProbeGuard } from '../src/theta/no-submit-probe-guard.js';
import type { Environment } from '../src/config/environment.js';

const locked = {
  THETA_RUNTIME_MODE: 'MASTER_THETA_PAPER', MASTER_PAPER_EXECUTION_ENABLED: false,
  FOLLOWER_PAPER_EXECUTION_ENABLED: false, PAPER_PAUSE_NEW_ORDERS: true,
  ALPACA_BASE_URL: 'https://paper-api.alpaca.markets',
  DATABASE_URL: 'postgres://aiven.example.test:25934/defaultdb?sslmode=require',
  AIVEN_DATABASE_URL: 'postgres://aiven.example.test:25934/defaultdb?sslmode=require',
} as Pick<Environment, 'THETA_RUNTIME_MODE' | 'MASTER_PAPER_EXECUTION_ENABLED'
  | 'FOLLOWER_PAPER_EXECUTION_ENABLED' | 'PAPER_PAUSE_NEW_ORDERS' | 'ALPACA_BASE_URL'
  | 'DATABASE_URL' | 'AIVEN_DATABASE_URL'>;

test('the no-submit probe accepts only a locked Paper/Aiven target', () => {
  assert.doesNotThrow(() => assertNoSubmitProbeGuard(locked));
  for (const override of [
    { MASTER_PAPER_EXECUTION_ENABLED: true }, { FOLLOWER_PAPER_EXECUTION_ENABLED: true },
    { PAPER_PAUSE_NEW_ORDERS: false }, { THETA_RUNTIME_MODE: 'LIVE' },
  ]) assert.throws(() => assertNoSubmitProbeGuard({ ...locked, ...override } as typeof locked), /EXECUTION_LOCKS_REQUIRED/);
  assert.throws(() => assertNoSubmitProbeGuard({ ...locked, ALPACA_BASE_URL: 'https://api.alpaca.markets' }), /PAPER_BROKER_REQUIRED/);
  assert.throws(() => assertNoSubmitProbeGuard({ ...locked, DATABASE_URL: 'postgres://neon.example.test/defaultdb' }), /AIVEN_DATABASE_REQUIRED/);
});
