import assert from 'node:assert/strict';
import test from 'node:test';
import type { Pool } from 'pg';
import { persistProviderCapabilities } from '../src/providers/capability-registry.js';
import type { CheckResult } from '../src/providers/readiness.js';
import { EventEmitter } from 'node:events';

test('capability registry persists sanitized metadata and no account financial values', async () => {
  const queries: { text: string; values: readonly unknown[] }[] = [];
  const client = Object.assign(new EventEmitter(), {
    async query(text: string, values: readonly unknown[] = []) {
      queries.push({ text, values });
      if (text.includes('SELECT provider_connection_id')) {
        return { rowCount: 1, rows: [{ provider_connection_id: 'provider-1' }] };
      }
      return { rowCount: 1, rows: [] };
    },
    release() {},
  });
  const pool = { async connect() { return client; } } as unknown as Pool;
  const result: CheckResult = {
    provider: 'ALPACA', capability: 'ACCOUNT_ENVIRONMENT', operationAlias: 'alpaca.get_account',
    state: 'GOOD', httpStatus: 200, observedAt: '2026-09-12T00:00:00.000Z',
    retrievedAt: '2026-09-12T00:00:00.000Z', latencyMs: 1,
    provenance: { host: 'paper-api.alpaca.markets', path: '/v2/account', method: 'GET', credentialValuesLogged: false },
    details: {
      maskedAccount: '••••1234', equity: 100_000, cash: 90_000, buyingPower: 180_000,
      optionsBuyingPower: 90_000, optionsApprovedLevel: 2, optionsTradingLevel: 2,
      accountStatus: 'ACTIVE',
    },
  };
  const persisted = await persistProviderCapabilities(pool, 'ALPACA', [result]);
  assert.deepEqual(persisted, { providerConnectionId: 'provider-1', capabilityCount: 1 });
  const serializedParameters = JSON.stringify(queries.map((query) => query.values));
  assert.equal(serializedParameters.includes('100000'), false);
  assert.equal(serializedParameters.includes('90000'), false);
  assert.equal(serializedParameters.includes('180000'), false);
  assert.equal(serializedParameters.includes('••••1234'), false);
  assert.equal(serializedParameters.includes('ACTIVE'), true);
  assert.equal(queries.some((query) => query.text === 'COMMIT'), true);
});

test('capability registry rolls back provider mismatches', async () => {
  const commands: string[] = [];
  const client = Object.assign(new EventEmitter(), {
    async query(text: string) {
      commands.push(text);
      if (text.includes('SELECT provider_connection_id')) {
        return { rowCount: 1, rows: [{ provider_connection_id: 'provider-1' }] };
      }
      return { rowCount: 1, rows: [] };
    },
    release() {},
  });
  const pool = { async connect() { return client; } } as unknown as Pool;
  const result: CheckResult = {
    provider: 'OPTIONOMICS', capability: 'OPTIONOMICS_AUTHENTICATION', operationAlias: 'opt.list_tickers',
    state: 'GOOD', httpStatus: 200, observedAt: '2026-09-12T00:00:00.000Z',
    retrievedAt: '2026-09-12T00:00:00.000Z', latencyMs: 1,
    provenance: { host: 'optionomics.ai', path: '/api/v1/tickers', method: 'GET', credentialValuesLogged: false },
    details: {},
  };
  await assert.rejects(persistProviderCapabilities(pool, 'ALPACA', [result]), /PROVIDER_CAPABILITY_RESULT_MISMATCH/);
  assert.equal(commands.includes('ROLLBACK'), true);
});

test('capability persistence discards a broken rollback client and never repeats writes', async () => {
  const commands: string[] = [];
  const releases: unknown[] = [];
  const client = Object.assign(new EventEmitter(), {
    async query(text: string) {
      commands.push(text);
      if (text === 'BEGIN') return { rows: [], rowCount: 0 };
      if (text === 'ROLLBACK') throw Object.assign(new Error('synthetic disconnect'), { code: '08006' });
      throw Object.assign(new Error('synthetic unavailable'), { code: '57P03' });
    },
    release(broken?: boolean) { releases.push(broken); },
  });
  await assert.rejects(persistProviderCapabilities({ connect: async () => client } as unknown as Pool, 'ALPACA', []),
    /POSTGRES_CHECKED_OUT_CLIENT_LOST/);
  assert.deepEqual(releases, [true]);
  assert.equal(commands.filter(command => command === 'BEGIN').length, 1);
  assert.equal(commands.filter(command => command === 'ROLLBACK').length, 1);
});
