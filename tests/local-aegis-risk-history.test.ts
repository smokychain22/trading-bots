import assert from 'node:assert/strict';
import test from 'node:test';
import { buildLocalAegisRiskHistory, createLocalAegisRiskObservation,
  localAegisAssessors } from '../src/theta/local-aegis-risk-history.js';
import { normalizeOptionContract } from '../src/theta/option-contract.js';

const contract = (asOfDate='2026-09-24', receivedAt='2026-09-24T15:30:00.000Z') => normalizeOptionContract({
  source:'ALPACA',underlying:'SPY',optionSymbol:'SPY261016P00600000',occSymbol:'SPY261016P00600000',
  optionType:'PUT',strike:600,expiration:'2026-10-16',asOfDate,multiplier:100,
  contractTradable:true,exerciseStyle:'american',deliverableClassification:'STANDARD_EQUITY',
  underlyingBid:669.99,underlyingAsk:670.01,underlyingLast:670,
  underlyingTimestamp:new Date(Date.parse(receivedAt)-1_000).toISOString(),
  underlyingQuoteReceivedAt:receivedAt,underlyingQuoteSource:'ALPACA_IEX',
  bid:4.1,ask:4.2,bidSize:10,askSize:12,lastTradePrice:4.15,lastTradeSize:1,
  quoteTimestamp:new Date(Date.parse(receivedAt)-1_000).toISOString(),tradeTimestamp:null,
  volume:100,volumeSource:'ALPACA',openInterest:500,openInterestSource:'ALPACA',
  iv:0.21,delta:-0.18,gamma:0.01,theta:-0.04,vega:0.1,rho:-0.02,
  greeksTimestamp:receivedAt,greeksSource:'ALPACA',feed:'INDICATIVE',dataQuality:'GOOD',
  maxQuoteAgeSecondsForExecutable:30,maxSpreadPctForExecutable:0.25,
},receivedAt);

test('local risk observation preserves qualified Alpaca BBO and IV lineage',()=>{
  const observation=createLocalAegisRiskObservation({snapshotId:'snapshot-1',decisionCycleId:'cycle-1',
    decisionTime:'2026-09-24T15:30:01.000Z',contract:contract()});
  assert.equal(observation.spreadHistoryState,'QUALIFIED');
  assert.equal(observation.ivHistoryState,'QUALIFIED');
  const history=buildLocalAegisRiskHistory([observation]);
  assert.equal(history.scanned,1);
  assert.equal(history.spread.length,1);
  assert.equal(history.alpacaIv.length,1);
  assert.equal(history.spread[0]?.feed,'INDICATIVE');
  assert.equal(history.alpacaIv[0]?.iv,0.21);
});

test('tampered and unqualified local history never becomes detector evidence',()=>{
  const qualified=createLocalAegisRiskObservation({snapshotId:'snapshot-1',decisionCycleId:'cycle-1',
    decisionTime:'2026-09-24T15:30:01.000Z',contract:contract()});
  const unqualified=createLocalAegisRiskObservation({snapshotId:'snapshot-2',decisionCycleId:'cycle-2',
    decisionTime:'2026-09-24T15:30:01.000Z',contract:{...contract(),underlyingQuoteSource:null,
      underlyingTimestamp:null,underlyingQuoteReceivedAt:null}});
  assert.equal(unqualified.spreadHistoryState,'REJECTED');
  assert.equal(unqualified.ivHistoryState,'REJECTED');
  const history=buildLocalAegisRiskHistory([{...qualified,sourceHash:'0'.repeat(64)},unqualified]);
  assert.equal(history.scanned,1);
  assert.equal(history.spread.length,0);
  assert.equal(history.alpacaIv.length,0);
  assert.equal(history.spreadRejected,1);
  assert.equal(history.ivRejected,1);
});

test('local assessors expose honest baseline maturity rather than inventing no stress',async()=>{
  const prior=createLocalAegisRiskObservation({snapshotId:'snapshot-prior',decisionCycleId:'cycle-prior',
    decisionTime:'2026-09-23T15:30:01.000Z',contract:contract('2026-09-23','2026-09-23T15:30:00.000Z')});
  const history=buildLocalAegisRiskHistory([prior]);
  const assessors=localAegisAssessors(history);
  const current=contract();
  const spread=await assessors.spread({contracts:[current],decisionAsOf:'2026-09-24T15:30:01.000Z'});
  const iv=await assessors.alpacaIv({contracts:[current],decisionAsOf:'2026-09-24T15:30:01.000Z'});
  assert.equal(spread[current.optionSymbol]?.maturity.state,'BASELINE_ACCUMULATING');
  assert.equal(spread[current.optionSymbol]?.stressSpreadWideningDetected,null);
  assert.equal(iv[current.optionSymbol]?.maturity.state,'BASELINE_ACCUMULATING');
  assert.equal(iv[current.optionSymbol]?.stressIvShockDetected,null);
});

