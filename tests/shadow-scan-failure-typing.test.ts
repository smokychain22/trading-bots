import assert from 'node:assert/strict';
import test from 'node:test';
import { safeErrorCode } from '../src/research/shadow-evidence-runtime.js';

test('a failed symbol scan is typed, never a bare generic code and never the provider message', () => {
  assert.equal(safeErrorCode(new Error('ALPACA_OPTION_CHAIN_HTTP_429')), 'ALPACA_OPTION_CHAIN_HTTP_429', 'an existing code passes through');
  assert.equal(safeErrorCode(Object.assign(new Error('deadlock detected'), { code: '40P01' })), 'SHADOW_SYMBOL_DATABASE_POSTGRES_40P01');
  assert.equal(safeErrorCode(Object.assign(new Error('Connection terminated unexpectedly'), {})), 'SHADOW_SYMBOL_DATABASE_POSTGRES_CONNECTION_TERMINATED');
  assert.equal(safeErrorCode(Object.assign(new Error('timeout exceeded when trying to connect'), {})), 'SHADOW_SYMBOL_DATABASE_POSTGRES_CONNECTION_ACQUISITION_TIMEOUT');
  assert.equal(safeErrorCode(Object.assign(new Error('This operation was aborted'), { name: 'AbortError' })), 'SHADOW_SYMBOL_SCAN_TIMEOUT');
  assert.equal(safeErrorCode(new TypeError('fetch failed')), 'SHADOW_SYMBOL_PROVIDER_FETCH_FAILED');
  const leaked = safeErrorCode(new RangeError('postgres://user:secret@host/db exploded'));
  assert.equal(leaked, 'SHADOW_SYMBOL_SCAN_FAILED:RangeError');
  assert.doesNotMatch(leaked, /secret|postgres:/, 'no provider message or URL ever reaches the code');
  assert.equal(safeErrorCode('string thrown'), 'SHADOW_SYMBOL_SCAN_FAILED:string');
});
