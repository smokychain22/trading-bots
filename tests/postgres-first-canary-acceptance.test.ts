import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyAlpacaCanaryOrderState } from '../src/execution/postgres-first-canary-acceptance.js';

test('Alpaca canary states preserve working partial filled and terminal outcomes',()=>{
  assert.equal(classifyAlpacaCanaryOrderState('new'),'WORKING');
  assert.equal(classifyAlpacaCanaryOrderState('accepted'),'WORKING');
  assert.equal(classifyAlpacaCanaryOrderState('partially_filled'),'PARTIAL');
  assert.equal(classifyAlpacaCanaryOrderState('filled'),'FILLED');
  assert.equal(classifyAlpacaCanaryOrderState('rejected'),'REJECTED');
  assert.equal(classifyAlpacaCanaryOrderState('canceled'),'CANCELED');
  assert.equal(classifyAlpacaCanaryOrderState('expired'),'EXPIRED');
  assert.equal(classifyAlpacaCanaryOrderState('provider_future_state'),null);
});
