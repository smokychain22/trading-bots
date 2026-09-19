import assert from 'node:assert/strict';
import test from 'node:test';
import {canonicalClosedMarketLifecycleScenarios,canonicalFullChainScenario,p2gScenarioFamilies,simulateLifecycle} from '../src/theta/p2g-lifecycle-simulator.js';

test('full synthetic wheel chain preserves the old roll loss and closes with honest economics',()=>{
  const first=simulateLifecycle(canonicalFullChainScenario()),second=simulateLifecycle(canonicalFullChainScenario());
  assert.equal(first.terminalState,'CLOSED');
  assert.equal(first.realizedOptionPnl,560);
  assert.equal(first.realizedStockPnl,400);
  assert.equal(first.fees,6);
  assert.equal(first.wholeChainNetPnl,954);
  assert.ok(first.capitalDays>0);
  assert.equal(first.contentHash,second.contentHash);
  assert.equal(first.events[1]?.realizedPnl,-120);
  assert.deepEqual([first.evidenceOrigin,first.executionAuthorized,first.realPaperEvidence,first.policyLearningEligible],
    ['SIMULATED',false,false,false]);
});

test('P2G scenario registry covers loss, winner, wait, hold, churn, and short-DTE evidence families',()=>{
  assert.ok(p2gScenarioFamilies.loss.includes('WINNER_TO_LOSER'));
  assert.deepEqual(p2gScenarioFamilies.winner,['WINNER_5','WINNER_8','WINNER_20','WINNER_35','WINNER_50','WINNER_75']);
  assert.ok(p2gScenarioFamilies.wait.includes('POSSIBLE_LOGIC_PARALYSIS'));
  assert.ok(p2gScenarioFamilies.hold.includes('HOLD_UNKNOWN'));
  assert.ok(p2gScenarioFamilies.overtrading.includes('COST_DOMINATED_REENTRY'));
  assert.ok(p2gScenarioFamilies.shortDte.includes('EXPIRY_PIN'));
});

test('synthetic lifecycle rejects time travel and invalid numeric evidence',()=>{
  const base=canonicalFullChainScenario();
  const first=base.events.at(0),second=base.events.at(1);assert.ok(first);assert.ok(second);
  assert.throws(()=>simulateLifecycle({...base,events:[second,first]}),/SIMULATION_TIME_ORDER_INVALID/);
  assert.throws(()=>simulateLifecycle({...base,events:[{...first,collateral:Number.NaN}]}),/SIMULATION_NUMERIC_INPUT_INVALID/);
});

test('closed-market lifecycle library covers close, expiry, assignment, stock sale, CC close, CC roll, and call-away',()=>{
  const receipts=canonicalClosedMarketLifecycleScenarios().map(simulateLifecycle);
  assert.equal(new Set(receipts.map((receipt)=>receipt.contentHash)).size,receipts.length);
  const actions=new Set(receipts.flatMap((receipt)=>receipt.events.map((event)=>event.action)));
  for(const action of ['CLOSE_CSP','EXPIRE_CSP','ASSIGN','RECOVERY_WAIT','SELL_STOCK','OPEN_CC','CLOSE_CC','EXPIRE_CC','ROLL_CLOSE_CC','ROLL_OPEN_CC','CALL_AWAY']) {
    assert.ok(actions.has(action as never),`missing ${action}`);
  }
  assert.ok(receipts.every((receipt)=>receipt.executionAuthorized===false&&receipt.realPaperEvidence===false&&receipt.policyLearningEligible===false));
  assert.equal(receipts.find((receipt)=>receipt.scenarioId==='ASSIGN_THEN_SELL_STOCK')?.wholeChainNetPnl,-3);
});
