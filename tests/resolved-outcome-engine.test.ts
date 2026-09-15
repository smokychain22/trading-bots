import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyWaitOutcome, evaluatePolicyChallenger, resolveOutcome,
  type OutcomeLabelType, type OutcomeObservation, type OutcomeSubject,
} from '../src/research/resolved-outcome-engine.js';

const decision='2026-09-15T14:00:00.000Z',close='2026-09-16T14:00:00.000Z',asOf='2026-09-16T14:01:00.000Z';
const subject=(labelType:OutcomeLabelType='SELECTED_CONTRACT_OUTCOME',exactContractId:string|null='AAPL261218P00200000'):OutcomeSubject=>({
  subjectId:`subject:${labelType}`,labelType,decisionTimestamp:decision,featureSnapshotHash:'a'.repeat(64),
  candidateUniverseHash:'b'.repeat(64),exactContractId,strategyVersion:'theta-research-v1',
  horizonId:'theta-outcome-horizons-v1:ONE_DAY',horizonClosesAt:close,
});
const observation=(overrides:Partial<OutcomeObservation>={}):OutcomeObservation=>({
  observationId:'observation-1',subjectId:'subject:SELECTED_CONTRACT_OUTCOME',observedAt:'2026-09-16T13:59:00.000Z',
  providerTimestamp:'2026-09-16T13:58:59.000Z',receivedAt:'2026-09-16T13:59:00.000Z',source:'RESEARCH_FEED',
  provenance:'MARKET_OBSERVED',completeness:'COMPLETE',reasonCodes:[],exactContractId:'AAPL261218P00200000',
  bid:1.0,ask:1.2,underlyingSpot:205,economicPnl:20,fees:null,slippage:null,capitalDays:1,
  lifecycleState:'CSP_OPEN',terminal:false,...overrides,
});
const noExecution={modelClass:'MARKET_MARK' as const,version:'theta-market-mark-v1',positionSide:null,multiplier:null,
  entryPrice:null,entryFees:null,exitFees:null,perLegSlippage:null};

test('resolved market mark is causal, immutable, deterministic, and never execution authority',()=>{
  const inputSubject=subject(),snapshot=structuredClone(inputSubject),first=resolveOutcome({subject:inputSubject,observations:[observation()],asOf,executionModel:noExecution});
  const second=resolveOutcome({subject:inputSubject,observations:[observation()],asOf,executionModel:noExecution});
  assert.equal(first.state,'RESOLVED');assert.equal(first.provenance,'MARKET_OBSERVED');assert.equal(first.completeness,'COMPLETE');
  assert.equal(first.labelAvailableAt,close);assert.ok(Date.parse(first.labelAvailableAt as string)>Date.parse(first.decisionTimestamp));
  assert.equal(first.marketMark.exitMid,1.1);assert.equal(first.modeledExecution.netPnl,null);assert.equal(first.executionAuthorized,false);
  assert.equal(first.contentHash,second.contentHash);assert.deepEqual(inputSubject,snapshot);
});

test('horizon must close and pre-decision observations cannot create a label',()=>{
  const pending=resolveOutcome({subject:subject(),observations:[observation()],asOf:'2026-09-16T13:00:00.000Z',executionModel:noExecution});
  assert.equal(pending.state,'PENDING');assert.equal(pending.labelAvailableAt,null);
  const unresolved=resolveOutcome({subject:subject(),observations:[observation({observedAt:'2026-09-15T13:00:00.000Z',
    providerTimestamp:'2026-09-15T12:59:00.000Z',receivedAt:'2026-09-15T13:00:00.000Z'})],asOf,executionModel:noExecution});
  assert.equal(unresolved.state,'UNRESOLVED');assert.ok(unresolved.reasonCodes.includes('NO_CAUSAL_FUTURE_OBSERVATIONS'));
});

test('contract identity mismatch is invalid and cannot silently join by underlying and strike',()=>{
  const result=resolveOutcome({subject:subject(),observations:[observation({exactContractId:'AAPL261218P00195000'})],asOf,executionModel:noExecution});
  assert.equal(result.state,'INVALID');assert.equal(result.provenance,'INVALID');
  assert.ok(result.reasonCodes.includes('EXACT_CONTRACT_IDENTITY_MISMATCH'));
});

test('stale or incomplete future data stays partial rather than becoming certain',()=>{
  const result=resolveOutcome({subject:subject(),observations:[observation({completeness:'PARTIAL',reasonCodes:['STALE_FUTURE_QUOTE']})],asOf,executionModel:noExecution});
  assert.equal(result.state,'RESOLVED');assert.equal(result.completeness,'PARTIAL');
  assert.ok(result.reasonCodes.includes('STALE_FUTURE_QUOTE'));
});

test('modeled execution is explicit and uses conservative quote sides with costs',()=>{
  const result=resolveOutcome({subject:subject(),observations:[observation({provenance:'MODELED_RESEARCH',bid:1.9,ask:2.1})],asOf,
    executionModel:{modelClass:'MODELED_RESEARCH',version:'theta-bid-ask-side-v1',positionSide:'SHORT',multiplier:100,
      entryPrice:2.5,entryFees:1,exitFees:1,perLegSlippage:0.01}});
  assert.equal(result.provenance,'MODELED_RESEARCH');assert.ok(Math.abs((result.modeledExecution.grossPnl as number)-40)<1e-9);
  assert.ok(Math.abs((result.modeledExecution.netPnl as number)-36)<1e-9);assert.equal(result.executionAuthorized,false);
});

test('modeled research cannot masquerade as broker actual',()=>{
  const result=resolveOutcome({subject:subject(),observations:[observation({provenance:'MODELED_RESEARCH'})],asOf,
    executionModel:{...noExecution,modelClass:'MODELED_RESEARCH',version:'BROKER_ACTUAL'}});
  assert.equal(result.state,'INVALID');assert.ok(result.reasonCodes.includes('MODELED_OUTCOME_CANNOT_MASQUERADE_AS_BROKER_ACTUAL'));
});

test('profit path captures winner giveback without encoding a fixed target',()=>{
  const observations=[observation({observationId:'a',observedAt:'2026-09-15T15:00:00.000Z',providerTimestamp:'2026-09-15T14:59:59.000Z',receivedAt:'2026-09-15T15:00:00.000Z',economicPnl:30}),
    observation({observationId:'b',observedAt:'2026-09-16T10:00:00.000Z',providerTimestamp:'2026-09-16T09:59:59.000Z',receivedAt:'2026-09-16T10:00:00.000Z',economicPnl:55}),
    observation({observationId:'c',economicPnl:-5,terminal:true,lifecycleState:'CLOSED'})];
  const result=resolveOutcome({subject:subject(),observations,asOf,executionModel:noExecution,profitAtDecision:20});
  assert.equal(result.path.peakFutureProfit,55);assert.equal(result.path.terminalProfit,-5);
  assert.equal(result.path.worstGivebackFromPeak,60);assert.equal(result.path.maximumAdverseExcursion,-25);
  assert.equal(result.terminalState,'CLOSED');
});

test('WAIT classification requires a closed complete risk-aware comparison',()=>{
  assert.equal(classifyWaitOutcome({windowClosed:false,alternatives:[]}),'UNKNOWN');
  assert.equal(classifyWaitOutcome({windowClosed:true,alternatives:[{subjectId:'x',complete:true,afterCostPnl:20,
    maxAdverseExcursion:-5,capitalDays:1,policyFeasibleAtDecision:true}]}),'OVERSTRICT_POLICY_WAIT');
  assert.equal(classifyWaitOutcome({windowClosed:true,alternatives:[{subjectId:'x',complete:true,afterCostPnl:-10,
    maxAdverseExcursion:-20,capitalDays:1,policyFeasibleAtDecision:true}]}),'CORRECT_WAIT');
  assert.equal(classifyWaitOutcome({windowClosed:true,alternatives:[{subjectId:'x',complete:true,afterCostPnl:20,
    maxAdverseExcursion:-5,capitalDays:1,policyFeasibleAtDecision:false}]}),'HEALTHY_WAIT');
});

test('policy challenger evaluation reports correlated effective N and never promotes',()=>{
  const episodes=Array.from({length:35},(_,index)=>({clusterId:`day-${Math.floor(index/5)}`,selectedAction:'HOLD',
    outcomes:{FIXED_40:{afterCostPnl:1,capitalDays:2,complete:true}}}));
  const result=evaluatePolicyChallenger('FIXED_40',episodes);
  assert.equal(result.state,'EVALUABLE');assert.equal(result.rawN,35);assert.equal(result.effectiveClusterN,7);
  assert.equal(result.promoted,false);assert.equal(result.executionAuthorized,false);
  assert.equal(evaluatePolicyChallenger('FIXED_75',episodes).state,'NOT_EVALUABLE');
});

for(const [name,labelType] of [
  ['CSP winner','SELECTED_CONTRACT_OUTCOME'],['CSP loser','SELECTED_CONTRACT_OUTCOME'],
  ['OTM expiry','SELECTED_CONTRACT_OUTCOME'],['ITM assignment','WHOLE_CHAIN_OUTCOME'],
  ['roll chain','MANAGEMENT_ACTION_OUTCOME'],['failed roll close only','MANAGEMENT_ACTION_OUTCOME'],
  ['stock recovery','WHOLE_CHAIN_OUTCOME'],['covered call','MANAGEMENT_ACTION_OUTCOME'],['call away','WHOLE_CHAIN_OUTCOME'],
  ['selected strike vs neighbor','NEIGHBOR_STRIKE_OUTCOME'],['selected expiration vs other','OTHER_EXPIRATION_OUTCOME'],
  ['CSP vs spread','OTHER_STRUCTURE_OUTCOME'],
] as const){
  test(`${name} uses the same causal label-side resolver`,()=>{
    const exact=labelType.includes('CONTRACT')||labelType.includes('STRIKE')?'AAPL261218P00200000':null;
    const s=subject(labelType,exact),o=observation({subjectId:s.subjectId,exactContractId:exact,terminal:true,lifecycleState:name.toUpperCase().replaceAll(' ','_')});
    const result=resolveOutcome({subject:s,observations:[o],asOf,executionModel:noExecution});
    assert.equal(result.state,'RESOLVED');assert.equal(result.executionAuthorized,false);
  });
}
