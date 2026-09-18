import assert from 'node:assert/strict';
import test from 'node:test';
import { parseBrokerActivity } from '../src/execution/broker.js';

test('broker cash activity retains signed cash and explicit zero, absence remains unknown',()=>{
  const base={id:'fixture',activity_type:'DIV',date:'2026-09-18',symbol:'XYZ'};
  assert.equal(parseBrokerActivity({...base,net_amount:'1.02',per_share_amount:'.51'}).netAmount,1.02);
  assert.equal(parseBrokerActivity({...base,activity_type:'FEE',net_amount:'-.02'}).netAmount,-.02);
  assert.equal(parseBrokerActivity({...base,net_amount:'0'}).netAmount,0);
  assert.equal(parseBrokerActivity(base).netAmount,null);
  assert.throws(()=>parseBrokerActivity({...base,net_amount:'invalid'}),/non-finite numeric field/);
});
