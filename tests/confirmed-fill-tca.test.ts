import assert from 'node:assert/strict';
import test from 'node:test';
import { persistConfirmedFillTca } from '../src/execution/confirmed-fill-tca.js';

test('TCA database failure is evidence-only and returns a sanitized recoverable failure',async()=>{
  const pool={query:async()=>{throw new Error('private database detail');}};
  assert.deepEqual(await persistConfirmedFillTca(pool as never,'connection','2026-09-18T14:00:00Z'),
    {persisted:0,missing:0,failed:1});
});

test('incomplete confirmed fills cannot create immutable premature TCA',async()=>{
  let calls=0;
  const pool={query:async()=>++calls===1
    ?{rows:[{order_intent_id:'intent',quantity:2,multiplier:100,side:'sell',instrument_type:'OPTION'}]}
    :{rows:[{quantity:1,price_per_share:2,fees:null,filled_at:'2026-09-18T14:00:00Z'}]}};
  assert.deepEqual(await persistConfirmedFillTca(pool as never,'connection','2026-09-18T14:00:01Z'),
    {persisted:0,missing:1,failed:0});
  assert.equal(calls,2);
});
