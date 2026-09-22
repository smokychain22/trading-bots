import assert from 'node:assert/strict';
import test from 'node:test';
import { optionExecutabilityCauses } from '../src/theta/option-executability-diagnostics.js';
import { normalizeOptionContract, type RawOptionQuoteInput } from '../src/theta/option-contract.js';

const observedAt = '2026-09-22T14:00:00.000Z';
const raw = (overrides: Partial<RawOptionQuoteInput> = {}): RawOptionQuoteInput => ({
  source:'ALPACA', underlying:'SPY', optionSymbol:'SPY261016P00600000',
  occSymbol:'SPY261016P00600000', optionType:'PUT', strike:600, expiration:'2026-10-16',
  asOfDate:'2026-09-22', multiplier:100, underlyingBid:null, underlyingAsk:null,
  underlyingLast:null, underlyingTimestamp:null, bid:2, ask:2.1, bidSize:10, askSize:10,
  lastTradePrice:null, lastTradeSize:null, quoteTimestamp:observedAt, tradeTimestamp:null,
  volume:null, volumeSource:null, openInterest:null, openInterestSource:null,
  iv:null, delta:null, gamma:null, theta:null, vega:null, rho:null, greeksTimestamp:null,
  greeksSource:null, feed:'INDICATIVE', dataQuality:'GOOD',
  maxQuoteAgeSecondsForExecutable:30, maxSpreadPctForExecutable:0.15, ...overrides,
});

test('a stale and wide broker quote reports both causes without becoming executable', () => {
  const contract=normalizeOptionContract(raw({bid:1,ask:2,
    quoteTimestamp:'2026-09-22T13:58:00.000Z'}),observedAt);
  assert.equal(contract.executable,false);
  assert.deepEqual(optionExecutabilityCauses(contract),['QUOTE_STALE','SPREAD_TOO_WIDE']);
});

test('missing sides, invalid market and unknown quote time remain distinct', () => {
  const missing=normalizeOptionContract(raw({bid:null,ask:null,quoteTimestamp:null}),observedAt);
  assert.deepEqual(optionExecutabilityCauses(missing),[
    'ASK_MISSING','BID_MISSING','QUOTE_TIMESTAMP_MISSING','SPREAD_UNKNOWN',
  ]);
  const crossed=normalizeOptionContract(raw({bid:3,ask:2}),observedAt);
  assert.deepEqual(optionExecutabilityCauses(crossed),['CROSSED_MARKET']);
});

test('unknown diagnostic text does not silently become a known quote cause', () => {
  const contract=normalizeOptionContract(raw(),observedAt);
  assert.deepEqual(optionExecutabilityCauses(contract),[]);
  assert.deepEqual(optionExecutabilityCauses({...contract,executable:false,
    nonExecutableReason:'new provider failure mode'}),['OTHER_NON_EXECUTABLE']);
});
