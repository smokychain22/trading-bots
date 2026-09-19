import assert from 'node:assert/strict';
import test from 'node:test';
import { buildVolatilityAccelerationEvidence } from '../src/research/volatility-acceleration.js';
import type { HistoricalBar } from '../src/theta/underlying-history.js';

const bars=Array.from({length:70},(_,index):HistoricalBar=>{
  const timestamp=new Date(Date.UTC(2026,0,index+1)).toISOString();
  const close=100+index+(index%2===0?1:-1);
  return {symbol:'AAPL',timestamp,open:close-0.5,high:close+1,low:close-1,close,volume:1_000_000};
});

test('volatility acceleration is PIT-safe shadow evidence with no broker authority',()=>{
  const asOf=bars[65]?.timestamp as string;
  const evidence=buildVolatilityAccelerationEvidence([...bars,{...bars[69] as HistoricalBar,timestamp:'2027-01-01T00:00:00.000Z',close:1}],asOf);
  const baseline=buildVolatilityAccelerationEvidence(bars,asOf);
  assert.deepEqual(evidence,baseline);
  assert.equal(evidence.state,'KNOWN');
  assert.equal(evidence.brokerAuthority,false);
  assert.notEqual(evidence.weeklyVsMonthly,null);
  assert.notEqual(evidence.monthlyVsQuarterly,null);
});

test('insufficient history remains UNKNOWN rather than zero',()=>{
  const evidence=buildVolatilityAccelerationEvidence(bars.slice(0,10),bars[9]?.timestamp as string);
  assert.equal(evidence.state,'UNKNOWN');
  assert.equal(evidence.rv63,null);
  assert.equal(evidence.monthlyVsQuarterly,null);
});
