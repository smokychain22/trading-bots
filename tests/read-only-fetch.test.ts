import assert from 'node:assert/strict';
import test from 'node:test';
import { createGetOnlyFetch } from '../src/theta/read-only-fetch.js';

test('GET-only fetch rejects mutation methods supplied through init or a Request object', async () => {
  let calls = 0;
  const underlying: typeof fetch = async () => {
    calls += 1;
    return new Response('ok');
  };
  const getOnly = createGetOnlyFetch(underlying, 'TEST_NON_GET_REJECTED');
  await getOnly('https://example.test/read');
  await getOnly(new Request('https://example.test/read', { method: 'GET' }));
  assert.throws(() => getOnly('https://example.test/write', { method: 'POST' }), /TEST_NON_GET_REJECTED/);
  assert.throws(() => getOnly(new Request('https://example.test/write', {
    method: 'POST', body: 'mutation',
  })), /TEST_NON_GET_REJECTED/);
  assert.throws(() => getOnly('https://example.test/read-with-body', {
    method: 'GET', body: 'unexpected',
  }), /TEST_NON_GET_REJECTED/);
  assert.equal(calls, 2);
});

test('GET-only fetch validates its bounded error code', () => {
  assert.throws(() => createGetOnlyFetch(fetch, 'unsafe detail'), /GET_ONLY_FETCH_ERROR_CODE_INVALID/);
});
