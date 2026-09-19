import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeManagementCounterfactuals, type ManagementCounterfactualInput } from '../src/research/management-counterfactual-analysis.js';

const base:ManagementCounterfactualInput={decisionId:'decision-1',chainId:'chain-1',decidedAt:'2026-09-01T14:00:00Z',
  featureCutoff:'2026-09-01T14:00:00Z',selectedAction:'HOLD',outcomes:[
    {action:'HOLD',source:'BROKER_ACTUAL',state:'RESOLVED',labelAvailableAt:'2026-09-10T14:00:00Z',wholeChainNetPnl:100,
      returnPerCapitalDay:0.002,maxAdverseExcursion:-80,executionCost:0,fillModelVersion:null,evidenceId:'actual-1'},
    {action:'CLOSE_FULL',source:'DEFENSIBLE_REPLAY',state:'RESOLVED',labelAvailableAt:'2026-09-10T14:00:00Z',wholeChainNetPnl:80,
      returnPerCapitalDay:0.003,maxAdverseExcursion:-20,executionCost:5,fillModelVersion:'replay-v1',evidenceId:'replay-1'},
  ]};
const actual=base.outcomes[0];
const alternative=base.outcomes[1];
if(actual===undefined||alternative===undefined)throw new Error('TEST_FIXTURE_INCOMPLETE');

test('compares resolved broker outcome with a versioned counterfactual without choosing an action',()=>{
  const result=analyzeManagementCounterfactuals(base);
  assert.equal(result.status,'COMPLETE');
  assert.equal(result.comparisons[0]?.netPnlDifference,-20);
  assert.equal(result.comparisons[0]?.returnPerCapitalDayDifference,0.001);
  assert.equal(result.executionAuthorized,false);
});

test('NO_FILL and blocked evidence remain explicit and never become hypothetical wins',()=>{
  const result=analyzeManagementCounterfactuals({...base,outcomes:[actual,
    {...alternative,state:'NO_FILL',wholeChainNetPnl:null,returnPerCapitalDay:null}]});
  assert.equal(result.status,'BLOCKED_ON_DATA');
  assert.equal(result.comparisons[0]?.state,'NO_FILL');
  assert.equal(result.comparisons[0]?.netPnlDifference,null);
});

test('future feature leakage, missing replay model, and absent selected broker truth fail closed',()=>{
  assert.throws(()=>analyzeManagementCounterfactuals({...base,featureCutoff:'2026-09-02T14:00:00Z'}),/FEATURE_LEAKAGE/);
  assert.throws(()=>analyzeManagementCounterfactuals({...base,outcomes:[actual,{...alternative,fillModelVersion:null}]}),/FILL_MODEL_MISSING/);
  assert.throws(()=>analyzeManagementCounterfactuals({...base,outcomes:[{...actual,source:'DEFENSIBLE_REPLAY'},alternative]}),/SELECTED_BROKER_OUTCOME_MISSING/);
});
