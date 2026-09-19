import assert from 'node:assert/strict';
import test from 'node:test';
import {buildR8PerformanceReceipt,buildR8StrategyAttribution,classifyR8Defect,type R8EpisodeEvidence} from '../src/research/r8-performance-analytics.js';

const lineage={strategyVersion:'theta-conventional-v1',policyVersion:'bootstrap-v1',riskVersion:'aegis-v1',modelVersion:'none',featureVersion:'f1',buildSha:'abc',fusionSnapshotId:'fusion',reasonCodes:['OPEN']};
const episode=(overrides:Partial<R8EpisodeEvidence>={}):R8EpisodeEvidence=>({episodeId:'e1',lineage,navStart:100000,navEnd:100100,
  realizedPnl:100,unrealizedPnl:0,legPnl:100,managedEpisodePnl:100,wholeChainPnl:100,premiumCollected:120,stockPnl:0,
  feesAndCosts:20,tca:5,mfe:140,mae:-30,capitalDays:10000,assigned:false,recoveryDurationDays:null,coveredCallContribution:0,calledAway:false,...overrides});

test('R8 performance reports complete after-cost episode economics without replacing missing values with zero',()=>{
  const result=buildR8PerformanceReceipt([episode(),episode({episodeId:'e2',wholeChainPnl:-50,realizedPnl:-50,managedEpisodePnl:-50,legPnl:-50,
    premiumCollected:80,feesAndCosts:10,tca:4,mfe:20,mae:-90,capitalDays:5000,assigned:true,recoveryDurationDays:12,coveredCallContribution:15,calledAway:true})],
  [{at:'2026-01-01T00:00:00Z',equity:100000},{at:'2026-01-02T00:00:00Z',equity:100200},{at:'2026-01-03T00:00:00Z',equity:100050}]);
  assert.equal(result.wholeChainPnl,50);
  assert.equal(result.profitFactor,2);
  assert.equal(result.assignmentRate,0.5);
  assert.equal(result.medianRecoveryDurationDays,12);
  assert.equal(result.maxDrawdown,-150);
  assert.equal(result.navChange,50);
});

test('one unknown component keeps the corresponding aggregate UNKNOWN',()=>{
  const result=buildR8PerformanceReceipt([episode(),episode({episodeId:'e2',feesAndCosts:null,wholeChainPnl:null})],[]);
  assert.equal(result.feesAndCosts,null);
  assert.equal(result.wholeChainPnl,null);
  assert.ok(result.unknownFields.includes('wholeChainPnl'));
  assert.equal(result.resolvedEpisodeCount,1);
  assert.equal(result.unknownEpisodeCount,1);
});

test('an empty evidence set reports UNKNOWN metrics rather than fabricated zeroes',()=>{
  const result=buildR8PerformanceReceipt([],[]);
  assert.equal(result.wholeChainPnl,null);
  assert.equal(result.realizedPnl,null);
  assert.equal(result.capitalDays,null);
  assert.equal(result.assignmentRate,null);
});

test('strategy attribution is version-coherent and deterministic',()=>{
  const other={...lineage,strategyVersion:'theta-recovery-v1'};
  const result=buildR8StrategyAttribution([episode(),episode({episodeId:'e2',lineage:other})]);
  assert.deepEqual(Object.keys(result),[
    'theta-conventional-v1|bootstrap-v1|aegis-v1|none|f1|abc',
    'theta-recovery-v1|bootstrap-v1|aegis-v1|none|f1|abc',
  ]);
});

test('a loss is never automatically labeled a defect or ordinary variance',()=>{
  assert.equal(classifyR8Defect({confirmedDefect:null,ordinaryMarketVarianceConfirmed:false}),null);
  assert.equal(classifyR8Defect({confirmedDefect:'EXECUTION_DEFECT',ordinaryMarketVarianceConfirmed:false}),'EXECUTION_DEFECT');
  assert.equal(classifyR8Defect({confirmedDefect:null,ordinaryMarketVarianceConfirmed:true}),'ORDINARY_MARKET_VARIANCE');
});
