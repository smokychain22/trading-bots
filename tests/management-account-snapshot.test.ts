import assert from 'node:assert/strict';
import test from 'node:test';
import type { Pool } from 'pg';
import { refreshManagementAccountSnapshot } from '../src/theta/management-account-snapshot.js';
import { AlpacaProviderError, type AlpacaProviderConfig } from '../src/theta/alpaca-provider.js';
import { readFileSync } from 'node:fs';

const alpaca: AlpacaProviderConfig = {
  tradingApiBase: 'https://paper-api.alpaca.markets', marketDataApiBase: 'https://data.alpaca.markets',
  apiKey: 'SYNTHETIC', apiSecret: 'SYNTHETIC',
};
const at = '2026-10-09T14:00:00.000Z';
const snapshot = {
  accountStatus: 'ACTIVE', equity: 100_000, cash: 70_000, buyingPower: 90_000,
  optionsBuyingPower: 45_000, optionsApprovedLevel: 3, optionsTradingLevel: 3,
  tradingBlocked: false, transfersBlocked: false, maskedAccountId: '••••TEST', receivedAt: at,
} as const;

function fixture(latestAsOf: string | null, options: { changed?: boolean; failInsert?: boolean } = {}) {
  const calls: { sql: string; values: readonly unknown[] }[] = [];
  const pool = { query: async (sql: string, values: readonly unknown[]) => {
    calls.push({ sql, values });
    if (sql.includes('INSERT INTO trade.account_snapshot')) {
      if (options.failInsert) throw new Error('synthetic postgres outage');
      return { rowCount: options.changed ? 0 : 1, rows: options.changed ? [] : [{ account_snapshot_id: 41 }] };
    }
    if (sql.includes('SELECT ta.account_id')) return { rowCount: 1,
      rows: [{ account_id: 'existing-master-account', latest_as_of: latestAsOf }] };
    throw new Error('unexpected SQL');
  } } as unknown as Pool;
  return { pool, calls };
}

const evidence = async () => ({ providerAccountId: 'master-physical-id', requestedAt: at, snapshot });
const base = { alpaca, connectionId: 'master-connection', expectedProviderAccountRef: 'master-physical-id',
  now: () => at, readEvidence: evidence };

test('a recent pinned account snapshot is reused without another broker request or database write', async () => {
  const { pool, calls } = fixture('2026-10-09T13:59:00.000Z');
  const state = await refreshManagementAccountSnapshot({ ...base, pool,
    readEvidence: async () => { throw new Error('unneeded broker read'); } });
  assert.equal(state, 'FRESH');
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0]?.values, ['master-connection', 'master-physical-id']);
});

test('stale account is refreshed from a verified read before management freezes input', async () => {
  const { pool, calls } = fixture('2026-10-09T13:55:00.000Z');
  assert.equal(await refreshManagementAccountSnapshot({ ...base, pool }), 'REFRESHED');
  assert.equal(calls.length, 2);
  assert.match(calls[1]?.sql ?? '', /INSERT INTO trade\.account_snapshot[\s\S]*SELECT ta\.account_id/);
  assert.deepEqual(calls[1]?.values, ['master-connection', 'master-physical-id', 100_000, 70_000,
    90_000, 45_000, 3, at, 'existing-master-account']);
});

test('real account parser preserves unavailable buying power as unknown, never zero', async () => {
  const { pool, calls } = fixture(null);
  const requested: string[] = [];
  const fetchImpl = (async (resource: RequestInfo | URL) => {
    requested.push(new URL(String(resource)).pathname);
    return Response.json({ id: 'master-physical-id', status: 'ACTIVE', equity: '100000',
      cash: '70000', buying_power: '90000', options_buying_power: null,
      options_approved_level: 3, options_trading_level: 3 });
  }) as typeof fetch;
  assert.equal(await refreshManagementAccountSnapshot({ ...base, pool, readEvidence: undefined,
    alpaca: { ...alpaca, fetchImpl } }), 'REFRESHED');
  assert.deepEqual(requested, ['/v2/account']);
  assert.equal(calls[1]?.values[5], null);
});

test('identity mismatch, inactive account, and changed canonical row cannot persist a snapshot', async () => {
  for (const invalid of [
    { providerAccountId: 'other-account', snapshot },
    { providerAccountId: 'master-physical-id', snapshot: { ...snapshot, accountStatus: 'INACTIVE' } },
  ]) {
    const { pool, calls } = fixture(null);
    await assert.rejects(refreshManagementAccountSnapshot({ ...base, pool,
      readEvidence: async () => ({ ...invalid, requestedAt: at }) }), /MANAGEMENT_MASTER_ACCOUNT_/);
    assert.equal(calls.length, 1);
  }
  const { pool } = fixture(null, { changed: true });
  await assert.rejects(refreshManagementAccountSnapshot({ ...base, pool }),
    /MANAGEMENT_MASTER_ACCOUNT_IDENTITY_CHANGED/);
});

test('provider and database failures propagate instead of becoming a valid management account', async () => {
  const { pool, calls } = fixture(null);
  await assert.rejects(refreshManagementAccountSnapshot({ ...base, pool,
    readEvidence: async () => { throw new Error('synthetic provider timeout'); } }), /provider timeout/);
  assert.equal(calls.length, 1);
  const failed = fixture(null, { failInsert: true });
  await assert.rejects(refreshManagementAccountSnapshot({ ...base, pool: failed.pool }), /postgres outage/);
});

test('transient broker failure keeps the prior account stale and returns a typed degraded state', async () => {
  const { pool, calls } = fixture(null);
  assert.equal(await refreshManagementAccountSnapshot({ ...base, pool,
    readEvidence: async () => { throw new AlpacaProviderError('NETWORK_ERROR', null, 'synthetic network'); } }),
  'PROVIDER_UNAVAILABLE');
  assert.equal(calls.length, 1, 'a failed read must never write a replacement account snapshot');
  await assert.rejects(refreshManagementAccountSnapshot({ ...base, pool,
    readEvidence: async () => { throw new AlpacaProviderError('INVALID_AUTH', 401, 'synthetic auth'); } }),
  (error: unknown) => error instanceof AlpacaProviderError && error.errorClass === 'INVALID_AUTH');
});

test('runtime refreshes account after discovery and before immutable management input', () => {
  const source = readFileSync(new URL('../src/theta/autonomous-runtime.ts', import.meta.url), 'utf8');
  const start = source.indexOf('const candidateDiscovery = await new ProductionPaperManagementCandidateSource');
  const refresh = source.indexOf('await refreshManagementAccountSnapshot(', start);
  const freeze = source.indexOf('await managementStore.assembleAndPersistOpenChains(', start);
  assert.ok(start >= 0 && start < refresh && refresh < freeze);
  assert.match(source, /accountRefresh==='PROVIDER_UNAVAILABLE'[\s\S]{0,100}'ALPACA_ACCOUNT_REFRESH_UNAVAILABLE'/);
});
