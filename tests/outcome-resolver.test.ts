import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveWholeChainOutcome } from '../src/research/outcome-resolver.js';

const complete=()=>({chainId:'chain',closedAt:'2026-09-14T20:00:00Z',allOptionLegsResolved:true,
  allStockLotsResolved:true,executionFeesKnown:true,economicFactCount:1,optionRealizedPnl:125,stockRealizedPnl:-40,dividends:5,fees:3});

test('whole-chain resolver includes option, stock, dividend, and fee economics',()=>{
  assert.deepEqual(resolveWholeChainOutcome(complete()),{state:'RESOLVED',wholeChainNetPnl:87,labelAvailableAt:'2026-09-14T20:00:00Z'});
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
