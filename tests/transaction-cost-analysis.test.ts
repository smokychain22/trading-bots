import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTransactionCostAnalysis } from '../src/execution/transaction-cost-analysis.js';

const base={side:'SELL' as const,quantity:2,multiplier:100,decision:{bid:1,ask:1.2,at:'2026-09-14T14:00:00Z'},
  arrival:{bid:1.02,ask:1.18,at:'2026-09-14T14:00:01Z'},limitAttempts:2,fees:null,
  estimatedMarketImpact:null,postFillMove:{'5s':null},quoteProvider:'TEST',
  quoteSemantics:'TRUSTED_TWO_SIDED_ORDER_PRICING',providerTimestamp:null,
  receivedAt:'2026-09-14T14:00:00Z',quoteAgeMs:10};

test('seller TCA uses direction-aware implementation shortfall and multiplier',()=>{
  const tca=buildTransactionCostAnalysis({...base,fill:{price:1.05,bid:1.02,ask:1.18,at:'2026-09-14T14:00:02Z'}});
  assert.ok(Math.abs((tca.slippageDollars??0)-10)<1e-9);
  assert.ok(Math.abs((tca.slippageBps??0)-454.5454545)<1e-5);
  assert.equal(tca.latencyMs,2000); assert.ok(Math.abs((tca.spreadCapture??0)-0.1875)<1e-9);
  assert.deepEqual(tca.unknownReasons,['FEES_UNKNOWN','MARKET_IMPACT_UNKNOWN']);
});

test('buy-to-close reverses the adverse direction',()=>{
  const tca=buildTransactionCostAnalysis({...base,side:'BUY',fill:{price:1.15,bid:1.02,ask:1.18,at:'2026-09-14T14:00:02Z'}});
  assert.ok(Math.abs((tca.slippageDollars??0)-10)<1e-9);
});

test('no fill preserves unknown execution fields rather than zero',()=>{
  const tca=buildTransactionCostAnalysis({...base,fill:null,feeMissingReason:'BROKER_FEE_NOT_REPORTED'});
  assert.equal(tca.fillPrice,null); assert.equal(tca.slippageDollars,null);
  assert.ok(tca.unknownReasons.includes('NO_FILL')); assert.ok(tca.unknownReasons.includes('BROKER_FEE_NOT_REPORTED'));
});

test('confirmed fill without observed fill BBO retains shortfall but not spread capture',()=>{
  const tca=buildTransactionCostAnalysis({...base,quoteProvider:'ALPACA',quoteSemantics:'PAPER_INDICATIVE_REFERENCE',
    fill:{price:1.05,bid:null,ask:null,at:'2026-09-14T14:00:02Z'}});
  assert.equal(tca.fillPrice,1.05);
  assert.ok(Math.abs((tca.slippageDollars??0)-10)<1e-9);
  assert.equal(tca.spreadAtFill,null);
  assert.equal(tca.spreadCapture,null);
  assert.equal(tca.benchmarkClass,'ALPACA_INDICATIVE_TCA');
  assert.ok(tca.unknownReasons.includes('FILL_BBO_UNKNOWN'));
});
