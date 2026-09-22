import assert from 'node:assert/strict';
import test from 'node:test';
import { AlpacaProviderError } from '../src/theta/alpaca-provider.js';
import { classifyObservationFailure, missingObservationReason, universeDiscoveryDiagnosticBlockers } from '../src/research/production-shadow-runtime.js';

test('bounded zero-candidate discovery cannot be called an opportunity-free market', () => {
  const funnel={assetsDiscovered:100,assetsTruncatedByBound:true,assetsAfterExchangeFilter:80,
    assetsWithUsableBars:0,optionabilityChecksAttempted:0,optionableConfirmed:0,candidatesProduced:0};
  assert.deepEqual(universeDiscoveryDiagnosticBlockers({candidates:[],candidatesOrigin:'REAL_PROVIDER_UNKNOWN',funnel,
    blockers:['UNIVERSE_BARS_BATCH_FAILED:provider detail must not persist']}),
    ['UNIVERSE_BARS_BATCH_FAILED','UNIVERSE_DISCOVERY_ZERO_CANDIDATES_COVERAGE_UNVERIFIED']);
});

test('observation misses retain actionable provider, contract, quote, and session reasons',()=>{
  assert.equal(classifyObservationFailure(new AlpacaProviderError('RATE_LIMITED',429,'safe')),'PROVIDER_UNAVAILABLE');
  assert.equal(missingObservationReason(false),'INVALID_CONTRACT');
  assert.equal(missingObservationReason(true),'INVALID_QUOTE');
  assert.equal(missingObservationReason(false,false),'PROVIDER_UNAVAILABLE');
  assert.equal(missingObservationReason(false,true,true),'SESSION_ENDED');
});
