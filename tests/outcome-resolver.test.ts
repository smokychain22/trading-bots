import assert from 'node:assert/strict';
import test from 'node:test';
import type { Pool } from 'pg';
import { PostgresOutcomeResolver, resolveWholeChainOutcome } from '../src/research/outcome-resolver.js';

const complete=()=>({chainId:'chain',closedAt:'2026-09-14T20:00:00Z',allOptionLegsResolved:true,
  evidenceAvailableAt:'2026-09-15T12:00:00Z',
  allStockLotsResolved:true,executionFeesKnown:true,economicFactCount:1,optionRealizedPnl:125,stockRealizedPnl:-40,dividends:5,fees:3});

test('whole-chain resolver includes option, stock, dividend, and fee economics',()=>{
  assert.deepEqual(resolveWholeChainOutcome(complete()),{state:'RESOLVED',wholeChainNetPnl:87,labelAvailableAt:'2026-09-15T12:00:00Z'});
});

test('closed empty chains cannot manufacture a zero-PnL label',()=>{
  const result=resolveWholeChainOutcome({...complete(),economicFactCount:0,optionRealizedPnl:0,stockRealizedPnl:0,dividends:0,fees:0});
  assert.deepEqual(result,{state:'BLOCKED',reasons:['NO_ECONOMIC_FACTS']});
});

test('unresolved chains and unknown execution fees never become labels',()=>{
  const result=resolveWholeChainOutcome({...complete(),closedAt:null,executionFeesKnown:false});
  assert.equal(result.state,'BLOCKED');
  if(result.state==='BLOCKED') assert.deepEqual(result.reasons,['CHAIN_OPEN','EXECUTION_FEES_UNKNOWN']);
});

test('roll loss erasure is impossible in the terminal whole-chain label',()=>{
  const result=resolveWholeChainOutcome({...complete(),economicFactCount:2,
    optionRealizedPnl:-500+300,stockRealizedPnl:0,dividends:0,fees:0});
  assert.deepEqual(result,{state:'RESOLVED',wholeChainNetPnl:-200,labelAvailableAt:'2026-09-15T12:00:00Z'});
});

test('unavailable, future, unzoned or nonfinite chain evidence cannot resolve',()=>{
  for(const patch of [{economicFactCount:-1},{economicFactCount:NaN},{optionRealizedPnl:Infinity},
    {fees:NaN},{fees:-1},{closedAt:'invalid'},{evidenceAvailableAt:'invalid'},
    {evidenceAvailableAt:'2026-09-13T00:00:00Z'},{closedAt:'2026-09-14T20:00:00'},
    {optionRealizedPnl:Number.MAX_VALUE,stockRealizedPnl:Number.MAX_VALUE}]) {
    assert.equal(resolveWholeChainOutcome({...complete(),...patch}).state,'BLOCKED');
  }
});

test('persisted labels use actual evidence-read time, never the historical query cutoff',async()=>{
  const writes:unknown[][]=[];
  const query=async(sql:string,values:unknown[])=>{
    if(sql.startsWith('SELECT'))return {rowCount:1,rows:[{chain_id:'chain',closed_at:new Date('2026-09-14T20:00:00Z'),
      option_resolved:true,stock_resolved:true,fees_known:true,economic_fact_count:1,
      option_pnl:'125',stock_pnl:'-40',dividends:'5',fees:'3'}]};
    writes.push(values);return {rowCount:1,rows:[]};
  };
  const resolver=new PostgresOutcomeResolver({query} as unknown as Pool,()=> '2026-09-24T14:00:00Z');
  assert.equal((await resolver.resolveClosedChains('2026-09-15T00:00:00Z')).resolved,1);
  assert.equal(writes[0]?.[2],'2026-09-24T14:00:00Z');
  assert.equal(writes[0]?.[4],87);
});

test('database blanks and string booleans never produce a resolved zero-cost label',async()=>{
  for(const bad of [{fees:''},{fees:' '},{option_pnl:false},{fees_known:'false'},{stock_resolved:'true'}]) {
    let inserts=0;
    const query=async(sql:string)=>{
      if(sql.startsWith('SELECT'))return {rowCount:1,rows:[{chain_id:'chain',closed_at:'2026-09-14T20:00:00Z',
        option_resolved:true,stock_resolved:true,fees_known:true,economic_fact_count:1,
        option_pnl:'125',stock_pnl:'-40',dividends:'5',fees:'3',...bad}]};
      inserts++;return {rowCount:1,rows:[]};
    };
    const resolver=new PostgresOutcomeResolver({query} as unknown as Pool,()=> '2026-09-24T14:00:00Z');
    assert.equal((await resolver.resolveClosedChains('2026-09-15T00:00:00Z')).blocked,1);
    assert.equal(inserts,0);
  }
});
