import assert from 'node:assert/strict';
import test from 'node:test';
import { AlpacaProviderError } from '../src/theta/alpaca-provider.js';
import { applyPendingUnsupportedCorporateActions, classifyObservationFailure, missingObservationReason,
  universeDiscoveryDiagnosticBlockers } from '../src/research/production-shadow-runtime.js';
import type { UnderlyingCandidateInput } from '../src/theta/universe-policy.js';

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

test('positive corporate-action evidence reaches the final Paper cohort while empty results stay unknown', () => {
  const candidate = { symbol: 'AAPL', unsupportedCorporateActionPending: null,
    eventNear: null } as UnderlyingCandidateInput;
  const positive = applyPendingUnsupportedCorporateActions([candidate], new Set(['AAPL']));
  const empty = applyPendingUnsupportedCorporateActions([candidate], new Set());
  assert.equal(positive[0]?.unsupportedCorporateActionPending, true);
  assert.equal(empty[0]?.unsupportedCorporateActionPending, null);
});
