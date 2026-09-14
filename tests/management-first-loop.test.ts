import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluatePreExistingRisk,ManagementFirstLoopGuard } from '../src/theta/management-first-loop.js';

const allOk={assignmentExposure:'OK',concentration:'OK',buyingPower:'OK',portfolioGreeks:'OK',drawdown:'OK',brokerDrift:'OK',pendingOrders:'OK'} as const;
test('new risk is impossible until reconciliation, lifecycle, management, and risk recomputation complete',()=>{
  const guard=new ManagementFirstLoopGuard();
  assert.throws(()=>guard.complete('DISCOVERY'),/MANAGEMENT_FIRST_SEQUENCE_VIOLATION/);
  guard.complete('RECONCILE');guard.complete('MANAGE_OPEN_POSITIONS');guard.complete('EXPIRY_ASSIGNMENT');
  guard.complete('OPEN_ORDER_REVIEW');guard.complete('PORTFOLIO_RISK');
  assert.equal(guard.mayDiscoverNewRisk(),true);guard.complete('DISCOVERY');guard.complete('STRATEGY_ROUTER');
  guard.complete('STRATEGY_FRONTIER');guard.complete('SIZING');guard.complete('AEGIS');guard.complete('EXECUTION_PREFLIGHT');
});
test('existing breach routes to management first and unknown risk fails closed',()=>{
  assert.equal(evaluatePreExistingRisk({...allOk,concentration:'BREACH'}).state,'MANAGEMENT_FIRST');
  assert.equal(evaluatePreExistingRisk({...allOk,portfolioGreeks:'UNKNOWN'}).state,'SYSTEM_HOLD');
  assert.equal(evaluatePreExistingRisk(allOk).state,'READY');
});
