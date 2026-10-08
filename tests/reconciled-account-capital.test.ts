import assert from 'node:assert/strict';
import test from 'node:test';
import { buildReconciledAccountCapital, reconciledAccountCapitalSchema } from '../src/execution/reconciled-account-capital.js';

const raw={equity:'99993.88000001',cash:'100027.88',options_buying_power:'94327.88',buying_power:'377311.52',
  status:'ACTIVE',trading_blocked:false,account_blocked:false};
const stamp={accountHash:'a'.repeat(64),snapshotId:'recon-1',requestedAt:'2026-10-08T13:30:00Z',receivedAt:'2026-10-08T13:30:01Z'};
test('reconciliation producer preserves exact decimals and separates margin from options capital',()=>{
  const result=buildReconciledAccountCapital(raw,stamp);
  assert.equal(result.state,'READY');
  if(result.state!=='READY')throw new Error('NOT_READY');
  assert.equal(result.account.equity,raw.equity);
  assert.equal(result.account.optionsBuyingPower,raw.options_buying_power);
  assert.equal(result.buyingPower,raw.buying_power);
  assert.equal(result.account.snapshotId,'recon-1');
  assert.deepEqual(result,buildReconciledAccountCapital(raw,stamp));
});
test('absent or malformed options buying power is never replaced by margin buying power',()=>{
  for(const value of [undefined,null,94327.88,'','NaN','-1','1e6','01','100.000000001']){
    const result=buildReconciledAccountCapital({...raw,options_buying_power:value},stamp);
    assert.equal(result.state,'BLOCKED');
  }
  assert.equal(buildReconciledAccountCapital({...raw,options_buying_power:'0'},stamp).state,'READY');
});
test('missing, blocked or malformed controls and impossible receipt clocks refuse capital',()=>{
  for(const controls of [{trading_blocked:undefined},{account_blocked:undefined},{account_blocked:true},
    {trading_blocked:'false'},{status:'SUSPENDED'}]){
    assert.equal(buildReconciledAccountCapital({...raw,...controls},stamp).state,'BLOCKED');
  }
  for(const invalid of [{accountHash:'private-account-id'},{requestedAt:'invalid'},
    {receivedAt:'2026-10-08T13:29:59Z'}]){
    assert.equal(buildReconciledAccountCapital(raw,{...stamp,...invalid}).state,'BLOCKED');
  }
});

test('persisted account observation rejects changed balances, timing or identity without a matching hash',()=>{
  const result=buildReconciledAccountCapital(raw,stamp);
  assert.equal(result.state,'READY');
  if(result.state!=='READY')throw new Error('NOT_READY');
  for(const change of [{equity:'999999'},{optionsBuyingPower:'999999'},
    {accountHash:'b'.repeat(64)},{snapshotId:'another-cycle'},{receivedAt:'2026-10-08T13:30:02Z'}]){
    assert.equal(reconciledAccountCapitalSchema.safeParse({...result,account:{...result.account,...change}}).success,false);
  }
  assert.equal(reconciledAccountCapitalSchema.safeParse({...result,buyingPower:'999999'}).success,false);
});
