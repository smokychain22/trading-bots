import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveAccountExposure, type CandidateCapacityPolicy } from '../src/theta/account-exposure.js';
import { assessStrategyAccountPolicyCompatibility } from '../src/theta/strategy-account-policy-compatibility.js';

const policy: CandidateCapacityPolicy = {
  hardCapMultiplier: 1.5, maxTickerConcentrationPct: 0.15, maxSectorConcentrationPct: 0.15,
  maxCorrelationClusterPct: 0.15, maxPortfolioCapitalAtRiskPct: 0.25, maxInventoryCapacityPct: 0.5,
  maxAssignmentCapacityPct: 0.25, maxRecoveryCapacityPct: 0.5,
};
const account = (equity: number | null) => ({
  accountId: 'paper', status: 'ACTIVE' as const, tradingBlocked: false, accountBlocked: false,
  equity, cash: equity, buyingPower: equity, optionsBuyingPower: equity, optionsTradingLevel: 2,
  patternDayTrader: false, daytradeCount: 0, retrievedAt: '2026-09-25T00:00:00.000Z',
});

test('one SPY CSP minimum is explicitly account-policy incompatible while market applicability remains true', () => {
  const exposure = deriveAccountExposure(account(100_000), [], []);
  const result = assessStrategyAccountPolicyCompatibility({
    strategy: 'THETA_CONVENTIONAL', underlying: 'SPY', marketApplicable: true,
    minimumCapitalRequired: 72_000, brokerAllowedQty: 1, exposure, policy,
  });
  assert.equal(result.marketApplicable, true);
  assert.equal(result.state, 'STRATEGY_ACCOUNT_POLICY_INCOMPATIBLE');
  assert.equal(result.accountFeasible, false);
  assert.equal(result.minimumTickerConcentrationPct, 0.72);
  assert.ok(result.bindingPolicies.includes('TICKER_CONCENTRATION'));
});

test('defined-risk minimum capital can be account feasible without gaining Paper authority', () => {
  const exposure = deriveAccountExposure(account(100_000), [], []);
  const result = assessStrategyAccountPolicyCompatibility({
    strategy: 'THETA_DEFINED_RISK', underlying: 'SPY', marketApplicable: true,
    minimumCapitalRequired: 500, brokerAllowedQty: 1, exposure, policy,
  });
  assert.equal(result.state, 'ACCOUNT_FEASIBLE');
  assert.equal(result.accountFeasible, true);
  assert.equal(result.strategy, 'THETA_DEFINED_RISK');
});

test('missing account evidence remains unknown and broker zero remains distinct from policy incompatibility', () => {
  const unknown = assessStrategyAccountPolicyCompatibility({
    strategy: 'THETA_CONVENTIONAL', underlying: 'SPY', marketApplicable: true,
    minimumCapitalRequired: 72_000, brokerAllowedQty: 1, exposure: deriveAccountExposure(null, [], []), policy,
  });
  assert.equal(unknown.state, 'UNKNOWN');
  const brokerZero = assessStrategyAccountPolicyCompatibility({
    strategy: 'THETA_CONVENTIONAL', underlying: 'SPY', marketApplicable: true,
    minimumCapitalRequired: 72_000, brokerAllowedQty: 0, exposure: deriveAccountExposure(account(100_000), [], []), policy,
  });
  assert.equal(brokerZero.state, 'ACCOUNT_INFEASIBLE_BROKER_CAPACITY');
});
