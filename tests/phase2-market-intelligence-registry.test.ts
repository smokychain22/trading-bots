import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';
import { featureFamilyAuthorityMatrix, providerCapabilityAuthorityMatrix,
  validatePhase2MarketIntelligenceRegistry } from '../src/theta/phase2-market-intelligence-registry.js';
import { thetaFeatureFamily } from '../src/theta/strategy-package.js';

test('Phase-2 provider authority is complete and has one Alpaca Paper option-price authority',()=>{
  assert.deepEqual(validatePhase2MarketIntelligenceRegistry(),[]);
  const authorities=providerCapabilityAuthorityMatrix.filter((item)=>item.pricingSuitability==='MASTER_PAPER_EXECUTABLE_REFERENCE');
  assert.equal(authorities.length,1);
  assert.equal(authorities[0]?.logicalCapability,'OPTION_EXECUTABLE_BBO');
  assert.equal(authorities[0]?.provider,'ALPACA');
  assert.match(authorities[0]?.fallback??'',/NONE/);
  assert.equal(providerCapabilityAuthorityMatrix.filter((item)=>item.provider==='OPTIONOMICS')
    .every((item)=>item.pricingSuitability==='NOT_PRICING_AUTHORITY'),true);
});

test('all 20 feature families have an honest producer, consumer, units, timing and role',()=>{
  assert.deepEqual(featureFamilyAuthorityMatrix.map((item)=>item.family).toSorted(),[...thetaFeatureFamily.options].toSorted());
  for(const feature of featureFamilyAuthorityMatrix){
    assert.ok(feature.producer.length>0);
    assert.ok(feature.consumer.length>0);
    assert.ok(feature.units.length>0);
    assert.match(feature.timestampSemantics,/observed_at.*available_at.*retrieved_at/);
    assert.ok(feature.unknownBehavior.length>0);
  }
  const hard=new Set(featureFamilyAuthorityMatrix.filter((item)=>item.role==='HARD_SAFETY').map((item)=>item.family));
  for(const predictive of ['MOMENTUM','SKEW','TERM_STRUCTURE','FLOW','UNUSUAL_ACTIVITY','REGIME']){
    assert.equal(hard.has(predictive as never),false,`${predictive} must not be silently promoted to a hard safety veto`);
  }
});

test('matrix call-graph anchors exist in current source',()=>{
  for(const path of ['src/theta/alpaca-provider.ts','src/theta/optionomics-provider.ts',
    'src/execution/alpaca-execution-quote-source.ts','src/research/alpaca-command5a-observation-source.ts',
    'src/theta/pit-feature-materializer.ts'])assert.equal(existsSync(path),true,path);
});
