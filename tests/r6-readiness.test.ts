import assert from 'node:assert/strict';
import test from 'node:test';
import { buildOpenSessionProof } from '../src/research/r6-readiness.js';

test('closed market with no scan is explicitly unsupported',()=>{
  const proof=buildOpenSessionProof(undefined,{market_session:'CLOSED',alpaca_health:'GOOD',optionomics_health:'UNKNOWN'});
  assert.equal(proof.state,'OPEN_SESSION_NOT_SUPPORTED');
  assert.equal(proof.reason,'MARKET_CLOSED_NO_SUPPORTED_OPEN_SESSION');
});

test('complete zero-candidate scan succeeds when all symbols reached terminal state',()=>{
  const proof=buildOpenSessionProof({scan_id:'scan',completeness_state:'COMPLETE',eligible_symbols_json:['AAPL','MSFT'],
    symbols_attempted:2,symbols_completed:2,candidate_count:0,missing_scope_json:[],failed_symbols:0,partial_symbols:0},
  {market_session:'OPEN',alpaca_health:'GOOD',optionomics_health:'GOOD'});
  assert.equal(proof.state,'OPEN_SESSION_SCAN_SUCCEEDED');
  assert.equal(proof.candidateCount,0);
  assert.equal(proof.expectedSymbols,2);
});

test('provider-limited scan is diagnosed as provider blocked',()=>{
  const proof=buildOpenSessionProof({scan_id:'scan',completeness_state:'PARTIAL',eligible_symbols_json:['SPY'],
    symbols_attempted:1,symbols_completed:0,candidate_count:0,missing_scope_json:['SPY:SCAN_FAILED'],failed_symbols:1,partial_symbols:0,
    provider_error_count:1,member_error_codes:['PROVIDER_RATE_LIMITED']},
  {market_session:'OPEN',alpaca_health:'DEGRADED',optionomics_health:'DEGRADED'});
  assert.equal(proof.state,'PROVIDER_BLOCKED');
  assert.equal(proof.reason,'PROVIDER_RATE_LIMITED');
});
