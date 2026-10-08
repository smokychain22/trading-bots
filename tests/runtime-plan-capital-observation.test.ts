import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import type { Pool } from 'pg';
import { produceRuntimePlanCapitalObservation } from '../src/execution/runtime-plan-capital-observation.js';
import { enqueueObservedMasterPaperPlan } from '../src/execution/observed-master-paper-plan.js';
import type { ApprovedMasterPaperActionPlan } from '../src/execution/master-paper-action-handoff.js';
import type { BrokerReconciliationResult } from '../src/execution/broker-reconciliation-worker.js';
import { deriveQualifiedAccountEnvelope } from '../src/execution/qualified-account-capital.js';
import { CapitalPlanAdmissionError } from '../src/execution/plan-capital-binding.js';

const at='2026-10-08T13:30:00.000Z',symbol='XLE261120P00057000';
const accountHash=createHash('sha256').update('synthetic-account').digest('hex');
const reconciliation={snapshotId:randomUUID(),dataQuality:'GOOD',localOnlyIntentCount:0,
  brokerFactImpactSummary:{currentEconomicExposureCount:1,currentReconciliationDefectCount:0,unknownCurrentImpactCount:0}} as BrokerReconciliationResult;
const plan={executionAccountId:randomUUID(),underlying:'XLE',symbol} as ApprovedMasterPaperActionPlan;

function fixture(overrides:{account?:Record<string,unknown>;positions?:unknown[];orders?:unknown[];contract?:Record<string,unknown>}={}) {
  const paths:string[]=[];
  const pool={query:async()=>({rows:[{account_hash:accountHash}]}),connect:()=>{throw Error('CLIENT_HELD_OVER_PROVIDER');}} as unknown as Pool;
  const alpaca={tradingApiBase:'https://paper-api.alpaca.markets',marketDataApiBase:'https://data.alpaca.markets',
    apiKey:'synthetic',apiSecret:'synthetic',readRetry:{maxAttempts:1},fetchImpl:(async(url:RequestInfo|URL,init?:RequestInit)=>{
      assert.ok(!init?.method||init.method==='GET','physically read-only requests');
      const path=new URL(String(url)).pathname;paths.push(path);
      if(path==='/v2/account')return Response.json({id:'synthetic-account',status:'ACTIVE',equity:'100000.00000001',
        cash:'100028',options_buying_power:'94328',buying_power:'999999',trading_blocked:false,account_blocked:false,...overrides.account});
      if(path==='/v2/positions')return Response.json(overrides.positions??[{symbol,qty:'-1',side:'short',asset_class:'us_option'}]);
      if(path==='/v2/orders')return Response.json(overrides.orders??[]);
      if(path.startsWith('/v2/options/contracts/'))return Response.json({symbol,strike_price:'57',expiration_date:'2026-11-20',
        type:'put',size:'100',tradable:true,underlying_symbol:'XLE',root_symbol:'XLE',style:'american',
        deliverables:[{type:'equity',symbol:'XLE',amount:'100',allocation_percentage:'100'}],...overrides.contract});
      throw Error('UNEXPECTED_READ');
    }) as typeof fetch};
  return {input:{pool,alpaca,plan,reconciliation,now:()=>at},paths};
}

test('real provider adapters build one account-bound observation outside any DB checkout',async()=>{
  const f=fixture(),result=await produceRuntimePlanCapitalObservation(f.input);
  assert.equal(result.state,'READY');
  if(result.state!=='READY')throw Error('NOT_READY');
  const v=result.observation;
  assert.equal(v.account.optionsBuyingPower,'94328');assert.equal(v.account.equity,'100000.00000001');
  assert.equal(v.account.snapshotId,v.positions.snapshotId);assert.equal(v.orders.snapshotId,v.account.snapshotId);
  assert.equal(v.accountHash,accountHash);assert.equal(Object.hasOwn(v,'commitments'),false);
  const qualified=deriveQualifiedAccountEnvelope({...v,now:at,commitments:[]});
  assert.equal(qualified.state,'QUALIFIED');
  if(qualified.state==='QUALIFIED')assert.equal(qualified.usedByDimension.PORTFOLIO,'5700.00000000');
  assert.deepEqual(f.paths,['/v2/account','/v2/positions','/v2/orders',`/v2/options/contracts/${symbol}`]);
  assert.equal(JSON.stringify(v).includes('synthetic-account'),false);
});

test('missing options capacity, unknown account controls and wrong physical identity refuse instead of using margin BP',async()=>{
  for(const account of [{options_buying_power:null},{account_blocked:null},{account_blocked:true},{trading_blocked:true},{id:'different-account'}]){
    const f=fixture({account});
    assert.equal((await produceRuntimePlanCapitalObservation(f.input)).state,'BLOCKED');
  }
});

test('partial order commitments preserve exact cumulative fills and ambiguous quantities cannot be dropped',async()=>{
  const order={id:'broker-order',client_order_id:'client-order',symbol,qty:'2',filled_qty:'1',
    side:'sell',position_intent:'sell_to_open',status:'pending_cancel'};
  const f=fixture({orders:[order]});
  const result=await produceRuntimePlanCapitalObservation(f.input);
  assert.equal(result.state,'READY');
  if(result.state==='READY')assert.equal(result.observation.orders.rows[0]?.filledQuantity,1);
  for(const invalid of [{filled_qty:null},{filled_qty:'3'},{position_intent:null}]){
    const x=fixture({orders:[{...order,...invalid}]});
    assert.equal((await produceRuntimePlanCapitalObservation(x.input)).state,'BLOCKED');
  }
});

test('unsupported held long legs, stocks and unverified deliverables never become zero exposure',async()=>{
  for(const positions of [[{symbol,qty:'1',side:'long',asset_class:'us_option'}],
    [{symbol:'XLE',qty:'100',side:'long',asset_class:'us_equity'}]]) {
    const f=fixture({positions});assert.equal((await produceRuntimePlanCapitalObservation(f.input)).state,'BLOCKED');
  }
  for(const contract of [{deliverables:null},{size:null},{underlying_symbol:'SPY'},
    {deliverables:[{type:'equity',symbol:'XLE',amount:'150',allocation_percentage:'100'}]}]){
    const f=fixture({contract});assert.equal((await produceRuntimePlanCapitalObservation(f.input)).state,'BLOCKED');
  }
});

test('current reconciliation defects and infrastructure failures are refusals or incidents, never global WAIT',async()=>{
  const f=fixture();
  assert.equal((await produceRuntimePlanCapitalObservation({...f.input,reconciliation:{...reconciliation,localOnlyIntentCount:1}})).state,'BLOCKED');
  assert.equal(f.paths.length,0);
  const failure=Object.assign(Error('synthetic'),{code:'EAI_AGAIN'});
  await assert.rejects(produceRuntimePlanCapitalObservation({...f.input,pool:{query:async()=>{throw failure;}} as unknown as Pool}),e=>e===failure);
});

test('read window aging refuses the envelope and known zero remains explicit evidence',async()=>{
  const f=fixture({account:{options_buying_power:'0'}});
  const result=await produceRuntimePlanCapitalObservation(f.input);
  assert.equal(result.state,'READY');if(result.state==='READY')assert.equal(result.observation.account.optionsBuyingPower,'0');
  let tick=0;
  const stale=await produceRuntimePlanCapitalObservation({...fixture().input,
    now:()=>new Date(Date.parse(at)+tick++*10000).toISOString()});
  assert.equal(stale.state,'BLOCKED');if(stale.state==='BLOCKED')assert.ok(stale.reasons.includes('CAPITAL_OBSERVATION_STALE_OR_FUTURE'));
});

test('schema 071 real cycle boundary supplies the observation to canonical enqueue and records capital refusal',async()=>{
  const f=fixture();const produced=await produceRuntimePlanCapitalObservation(f.input);
  assert.equal(produced.state,'READY');
  const args={...f.input,createdAt:at,chain:{botInstanceId:randomUUID(),underlyingId:randomUUID()}};
  let calls=0;
  const deps={required:async()=>true,produce:async()=>produced,enqueue:async(...received:unknown[])=>{
    calls++;assert.deepEqual(received[4],produced.state==='READY'?produced.observation:null);
    return {inserted:true,disposition:'ENQUEUED' as const,conflictingIds:[]};}};
  assert.equal((await enqueueObservedMasterPaperPlan(args,deps)).inserted,true);
  const blocked=await enqueueObservedMasterPaperPlan(args,{...deps,produce:async()=>({state:'BLOCKED',reasons:['CAPITAL_MISSING']})});
  assert.equal(blocked.disposition,'CAPITAL_BLOCKED');assert.equal(calls,1);
  const conflict=await enqueueObservedMasterPaperPlan(args,{...deps,enqueue:async()=>{throw new CapitalPlanAdmissionError(['CAPITAL_EXCESS']);}});
  assert.deepEqual(conflict.reasons,['CAPITAL_EXCESS']);
});

test('schema 070 behavior stays unchanged and a failed capability query never takes the legacy path',async()=>{
  const f=fixture(),args={...f.input,createdAt:at,chain:{botInstanceId:randomUUID(),underlyingId:randomUUID()}};
  const deps={required:async()=>false,produce:async()=>{throw Error('PRODUCER_NOT_EXPECTED_ON_070');},
    enqueue:async(...received:unknown[])=>{assert.equal(received[4],undefined);return {inserted:true,disposition:'ENQUEUED' as const,conflictingIds:[]};}};
  assert.equal((await enqueueObservedMasterPaperPlan(args,deps)).inserted,true);
  const failure=Error('SCHEMA_CAPABILITY_UNAVAILABLE');
  await assert.rejects(enqueueObservedMasterPaperPlan(args,{...deps,required:async()=>{throw failure;}}),e=>e===failure);
});
