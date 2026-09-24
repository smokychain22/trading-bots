import assert from 'node:assert/strict';
import test from 'node:test';

import {
  defaultOwnershipHistoryCalendarDays,
  defaultShadowCycleConfig,
  shadowHistoryAcquisitionPolicyVersion,
} from '../src/theta/theta-shadow-once.js';

test('default shadow acquisition requests enough calendar history for MA200 and records lineage', () => {
  const before = Date.now();
  const config = defaultShadowCycleConfig(
    {
      tradingApiBase: 'https://paper-api.alpaca.markets',
      marketDataApiBase: 'https://data.alpaca.markets',
      apiKey: 'test-key',
      apiSecret: 'test-secret',
    },
    null,
    { pythonExecutablePath: 'python', scriptAllowlist: new Map(), timeoutMs: 1_000, maxOutputBytes: 1_000 },
    [],
    'CALLER_MANUAL',
  );
  const after = Date.now();

  assert.equal(defaultOwnershipHistoryCalendarDays, 400);
  const requestedHistoryMs = Date.parse(config.historyEnd) - Date.parse(config.historyStart);
  assert.ok(requestedHistoryMs >= defaultOwnershipHistoryCalendarDays * 86_400_000 - (after - before) - 1_000);
  assert.equal(config.modelVersions.historyAcquisition, shadowHistoryAcquisitionPolicyVersion);
});
