import assert from 'node:assert/strict';
import test from 'node:test';
import { persistedPositionIntent } from '../src/execution/postgres-paper-order-store.js';

test('persisted option intents reject missing, invalid and contradictory evidence', () => {
  for (const raw of [undefined, null, '', 'null', 'UNKNOWN'])
    assert.throws(() => persistedPositionIntent('OPTION', 'sell', raw));
  assert.throws(() => persistedPositionIntent('OPTION', 'buy', 'SELL_TO_OPEN'));
  assert.throws(() => persistedPositionIntent('UNKNOWN', 'sell', 'SELL_TO_OPEN'));
});

test('all four explicit position intents survive storage decoding', () => {
  for (const intent of ['BUY_TO_OPEN','BUY_TO_CLOSE','SELL_TO_OPEN','SELL_TO_CLOSE']) {
    assert.equal(persistedPositionIntent('OPTION', intent.split('_')[0]?.toLowerCase(), intent), intent.toLowerCase());
  }
});

test('stock orders omit option intent without converting NULL to a string', () => {
  assert.equal(persistedPositionIntent('STOCK', 'sell', null), undefined);
  assert.throws(() => persistedPositionIntent('STOCK', 'sell', 'SELL_TO_CLOSE'));
});
