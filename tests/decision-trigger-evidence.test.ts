import assert from 'node:assert/strict';
import test from 'node:test';
import { debounceBucket } from '../src/theta/decision-trigger-evidence.js';
import { buildInvalidationSnapshot } from '../src/theta/decision-invalidation.js';

test('trigger debounce buckets noisy events deterministically',()=>{
  assert.equal(debounceBucket('2026-09-12T14:30:04.999Z',5000),'2026-09-12T14:30:00.000Z');
  assert.throws(()=>debounceBucket('bad',5000),/TRIGGER_TIME_INVALID/);
});
test('invalidation thresholds remain UNKNOWN unless supplied by the strategy version',()=>{
  const triggers=buildInvalidationSnapshot('s1',{PORTFOLIO_BREACH:{source:'AEGIS'}});
  assert.equal(triggers.find((item)=>item.fact==='PORTFOLIO_BREACH')?.state,'CONFIGURED');
  assert.equal(triggers.find((item)=>item.fact==='IV_SHOCK')?.state,'UNKNOWN');
});
