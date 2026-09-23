import assert from 'node:assert/strict';
import test from 'node:test';
import { AlpacaProviderError } from '../src/theta/alpaca-provider.js';
import { applyPendingUnsupportedCorporateActions, classifyObservationFailure, ivStressEvidenceForUnderlying, ivStressPaperBlockers, refreshScanIvStress, missingObservationReason,
  universeDiscoveryDiagnosticBlockers } from '../src/research/production-shadow-runtime.js';
import { assessAegisIvStress, normalizeOptionomicsAtmIvObservation,
  paperBootstrapAegisIvStressPolicy } from '../src/theta/aegis-iv-stress.js';
import type { NormalizedOptionomicsContextObservation } from '../src/theta/optionomics-provider.js';
import type { Pool } from 'pg';
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

test('IV stress evidence for one underlying cannot become another underlying’s AEGIS input', () => {
  const context={family:'METRICS',operationAlias:'optionomics.get_symbol_metrics',underlying:'SPY',
    requestedAt:'2026-09-22T14:00:00.000Z',retrievedAt:'2026-09-22T14:00:01.000Z',
    providerTimestamp:null,sessionDate:'2026-09-22',requestParameters:{date:'2026-09-22'},
    responseHash:'a'.repeat(64),normalized:{atmIv:{state:'KNOWN',value:0.2,units:'PROVIDER_REPORTED_UNVERIFIED'}},
  } as unknown as NormalizedOptionomicsContextObservation;
  const normalized=normalizeOptionomicsAtmIvObservation(context);
  assert.equal(normalized.state,'KNOWN');
  const assessment=assessAegisIvStress({current:normalized.observation,history:[],
    decisionAsOf:'2026-09-22T14:00:02.000Z',policy:paperBootstrapAegisIvStressPolicy});
  const source={state:'BASELINE_IMMATURE' as const,assessment,reason:'BASELINE_ACCUMULATING'};
  assert.equal(ivStressEvidenceForUnderlying('SPY',source).assessment?.underlying,'SPY');
  assert.deepEqual(ivStressEvidenceForUnderlying('MSFT',source),{
    state:'INVALID',assessment:null,reason:'AEGIS_IV_STRESS_UNDERLYING_MISMATCH',
  });
});

test('multi-symbol scan requests IV stress per underlying and freezes after each read', async () => {
  const calls:{underlying:string|undefined;before:string;after:string}[]=[];
  let tick=0;
  const now=()=>`2026-09-23T00:00:0${tick++}.000Z`;
  const optionomics={apiBase:'https://optionomics.ai',email:'owner@example.test',apiToken:'not-returned'};
  for(const underlying of ['SPY','MSFT']){
    const result=await refreshScanIvStress({pool:{} as Pool,optionomics,underlying,now},async(input)=>{
      calls.push({underlying:input.underlying,before:input.decisionAsOf,after:input.freezeDecisionAsOf?.()??''});
      return {state:'OBSERVATION_UNKNOWN',assessment:null,reason:'NO_CURRENT_IV'};
    });
    assert.equal(result.state,'OBSERVATION_UNKNOWN');
  }
  assert.deepEqual(calls,[
    {underlying:'SPY',before:'2026-09-23T00:00:00.000Z',after:'2026-09-23T00:00:01.000Z'},
    {underlying:'MSFT',before:'2026-09-23T00:00:02.000Z',after:'2026-09-23T00:00:03.000Z'},
  ]);
});

test('research breadth IV uncertainty does not block Paper-authorized symbols',()=>{
  const states=new Map([['SPY','READY'],['MSFT','PROVIDER_ERROR'],['QQQ','BASELINE_IMMATURE']] as const);
  assert.deepEqual(ivStressPaperBlockers(states,new Set(['SPY','QQQ'])),
    ['QQQ:AEGIS_IV_STRESS_BASELINE_IMMATURE']);
});
