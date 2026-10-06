import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveAccountExposure, type CandidateCapacityPolicy } from '../src/theta/account-exposure.js';
import {
  assessStrategyAccountPolicyCompatibility, strategyRiskProfileSemantics,
  summarizeAccountPolicyIncompatibilities,
} from '../src/theta/strategy-account-policy-compatibility.js';

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
  assert.equal(result.riskProfile, 'DEFINED_RISK_VERTICAL');
  assert.equal(result.ownershipRequired, false);
  assert.equal(result.capitalRiskEvidence.definedMaxLoss, 500);
  assert.equal(result.capitalRiskEvidence.securedCollateral, null);
  assert.equal(result.policyAssessments.find((item) => item.dimension === 'ASSIGNMENT_CAPACITY')?.state, 'NOT_APPLICABLE');
  assert.equal(result.executionAuthorityGranted, false);
});

test('October 5 SPY finalist preserves the exact legitimate minimum-unit bindings', () => {
  const canonical: CandidateCapacityPolicy = {
    hardCapMultiplier: 1.5, maxTickerConcentrationPct: 0.15, maxSectorConcentrationPct: 0.3,
    maxCorrelationClusterPct: 0.3, maxPortfolioCapitalAtRiskPct: 0.5, maxInventoryCapacityPct: 0.5,
    maxAssignmentCapacityPct: 0.5, maxRecoveryCapacityPct: 0.3,
  };
  const result = assessStrategyAccountPolicyCompatibility({
    strategy: 'THETA_CONVENTIONAL', riskProfile: 'CASH_SECURED_SHORT_PUT', underlying: 'SPY',
    marketApplicable: true, minimumCapitalRequired: 73_000, securedCollateralRequired: 73_000,
    brokerAllowedQty: 1, exposure: deriveAccountExposure(account(99_999.96), [], []), policy: canonical,
  });
  assert.equal(result.minimumTickerConcentrationPct, 73_000 / 99_999.96);
  assert.equal(result.brokerFeasible, true);
  assert.equal(result.state, 'STRATEGY_ACCOUNT_POLICY_INCOMPATIBLE');
  assert.deepEqual(result.bindingPolicies,
    ['TICKER_CONCENTRATION', 'SECTOR_CONCENTRATION', 'CORRELATION_CLUSTER']);
  assert.equal(result.policyAssessments.find((item) => item.dimension === 'PORTFOLIO_CAPITAL_AT_RISK')?.state,
    'SOFT_LIMIT_REACHED');
  assert.equal(result.policyAssessments.find((item) => item.dimension === 'ASSIGNMENT_CAPACITY')?.state,
    'SOFT_LIMIT_REACHED');
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

test('generic margin buying power is never relabelled as options buying power', () => {
  const exposure = deriveAccountExposure({ ...account(100_000), buyingPower: 200_000, optionsBuyingPower: null }, [], []);
  const result = assessStrategyAccountPolicyCompatibility({
    strategy: 'THETA_CONVENTIONAL', underlying: 'SPY', marketApplicable: true,
    minimumCapitalRequired: 10_000, brokerAllowedQty: null, exposure, policy,
  });
  assert.equal(result.brokerFeasible, null);
  assert.equal(result.capitalRiskEvidence.brokerBuyingPower, null);
  assert.equal(result.capitalRiskEvidence.provenance.brokerBuyingPower, 'UNKNOWN');
});

test('soft and hard boundaries have distinct exact semantics', () => {
  const isolatedPolicy: CandidateCapacityPolicy = {
    ...policy, maxSectorConcentrationPct: 1, maxCorrelationClusterPct: 1,
    maxPortfolioCapitalAtRiskPct: 1, maxAssignmentCapacityPct: 1,
  };
  const state = (capital: number) => assessStrategyAccountPolicyCompatibility({
    strategy: 'THETA_CONVENTIONAL', underlying: 'XYZ', marketApplicable: true,
    minimumCapitalRequired: capital, brokerAllowedQty: 1,
    exposure: deriveAccountExposure(account(100_000), [], []), policy: isolatedPolicy,
  }).state;
  assert.equal(state(14_999.99), 'ACCOUNT_FEASIBLE');
  assert.equal(state(15_000), 'ACCOUNT_FEASIBLE_REDUCED_ONLY');
  assert.equal(state(15_000.01), 'ACCOUNT_FEASIBLE_REDUCED_ONLY');
  assert.equal(state(22_499.99), 'ACCOUNT_FEASIBLE_REDUCED_ONLY');
  assert.equal(state(22_500), 'STRATEGY_ACCOUNT_POLICY_INCOMPATIBLE');
  assert.equal(state(22_500.01), 'STRATEGY_ACCOUNT_POLICY_INCOMPATIBLE');
});

test('risk-profile matrix uses bounded max loss for a vertical and never creates CSP assignment risk', () => {
  const exposure = deriveAccountExposure(account(100_000), [], []);
  const spread = assessStrategyAccountPolicyCompatibility({
    strategy: 'THETA_DEFINED_RISK', riskProfile: 'DEFINED_RISK_VERTICAL', underlying: 'SPY', marketApplicable: true,
    minimumCapitalRequired: 2_000, definedMaxLoss: 2_000, brokerAllowedQty: 1, exposure, policy,
  });
  const csp = assessStrategyAccountPolicyCompatibility({
    strategy: 'THETA_CONVENTIONAL', riskProfile: 'CASH_SECURED_SHORT_PUT', underlying: 'SPY', marketApplicable: true,
    minimumCapitalRequired: 75_000, securedCollateralRequired: 75_000, brokerAllowedQty: 1, exposure, policy,
  });
  assert.equal(spread.capitalRiskEvidence.portfolioCapitalAtRiskIncrement, 2_000);
  assert.equal(spread.capitalRiskEvidence.assignmentCollateralIncrement, null);
  assert.equal(spread.policyAssessments.find((item) => item.dimension === 'ASSIGNMENT_CAPACITY')?.applicability, 'NOT_APPLICABLE');
  assert.equal(csp.capitalRiskEvidence.securedCollateral, 75_000);
  assert.equal(csp.capitalRiskEvidence.assignmentCollateralIncrement, 75_000);
  assert.equal(csp.ownershipRequired, true);
  assert.equal(csp.state, 'STRATEGY_ACCOUNT_POLICY_INCOMPATIBLE');
});

test('covered-call compatibility adds no second copy of broker-confirmed stock inventory', () => {
  const exposure = deriveAccountExposure(account(100_000), [{
    symbol: 'XYZ', assetClass: 'us_equity', quantity: 100, side: 'long', avgEntryPrice: 50,
    marketValue: 5_000, unrealizedPl: 0, receivedAt: '2026-09-25T00:00:00.000Z',
  }], []);
  const result = assessStrategyAccountPolicyCompatibility({
    strategy: 'THETA_CC', riskProfile: 'COVERED_CALL', underlying: 'XYZ', marketApplicable: true,
    minimumCapitalRequired: 0, brokerAllowedQty: 1, exposure, policy,
  });
  assert.equal(result.capitalRiskEvidence.inventoryValueIncrement, 0);
  assert.equal(result.capitalRiskEvidence.portfolioCapitalAtRiskIncrement, 0);
  assert.equal(result.policyAssessments.every((item) => item.state === 'NOT_APPLICABLE'), true);
  assert.equal(result.state, 'ACCOUNT_FEASIBLE');
});

test('sector and correlation bootstrap values are explicit conservative proxies, not observed portfolio facts', () => {
  const result = assessStrategyAccountPolicyCompatibility({
    strategy: 'THETA_CONVENTIONAL', underlying: 'XYZ', marketApplicable: true,
    minimumCapitalRequired: 10_000, brokerAllowedQty: 1,
    exposure: deriveAccountExposure(account(100_000), [], []), policy,
  });
  assert.equal(result.policyAssessments.find((item) => item.dimension === 'SECTOR_CONCENTRATION')?.provenance, 'CONSERVATIVE_PROXY');
  assert.equal(result.policyAssessments.find((item) => item.dimension === 'CORRELATION_CLUSTER')?.provenance, 'CONSERVATIVE_PROXY');
  assert.equal(result.scope, 'CANDIDATE_STRATEGY_RISK_STRUCTURE');
});

test('incompatibility summary distinguishes unique blockers, cofailures and first bindings', () => {
  const exposure = deriveAccountExposure(account(100_000), [], []);
  const isolated: CandidateCapacityPolicy = { ...policy, maxSectorConcentrationPct: 1, maxCorrelationClusterPct: 1,
    maxPortfolioCapitalAtRiskPct: 1, maxAssignmentCapacityPct: 1 };
  const one = assessStrategyAccountPolicyCompatibility({ strategy: 'THETA_CONVENTIONAL', underlying: 'ONE', marketApplicable: true,
    minimumCapitalRequired: 30_000, brokerAllowedQty: 1, exposure, policy: isolated });
  const many = assessStrategyAccountPolicyCompatibility({ strategy: 'THETA_CONVENTIONAL', underlying: 'MANY', marketApplicable: true,
    minimumCapitalRequired: 80_000, brokerAllowedQty: 1, exposure, policy });
  const broker = assessStrategyAccountPolicyCompatibility({ strategy: 'THETA_CONVENTIONAL', underlying: 'BROKER', marketApplicable: true,
    minimumCapitalRequired: 10_000, brokerAllowedQty: 0, exposure, policy });
  const summary = summarizeAccountPolicyIncompatibilities([one, many, broker]);
  assert.equal(summary.totalCandidates, 3);
  assert.equal(summary.uniqueBindingPolicies.TICKER_CONCENTRATION, 1);
  assert.equal(summary.uniqueBindingPolicies.BROKER_CAPACITY, 1);
  assert.equal(summary.cofailBindingSets['TICKER_CONCENTRATION+SECTOR_CONCENTRATION+CORRELATION_CLUSTER+PORTFOLIO_CAPITAL_AT_RISK+ASSIGNMENT_CAPACITY'], 1);
  assert.equal(summary.firstBindingPolicies.TICKER_CONCENTRATION, 2);
});

test('risk-profile declarations are explanatory and never grant execution authority', () => {
  for (const semantics of Object.values(strategyRiskProfileSemantics)) assert.equal(semantics.executionAuthorityGranted, false);
  assert.equal(strategyRiskProfileSemantics.CASH_SECURED_SHORT_PUT.ownershipRequired, true);
  assert.equal(strategyRiskProfileSemantics.DEFINED_RISK_VERTICAL.ownershipRequired, false);
});

test('account-size and risk-structure matrix separates broker affordability from internal policy', () => {
  const canonical: CandidateCapacityPolicy = {
    hardCapMultiplier: 1.5, maxTickerConcentrationPct: 0.15, maxSectorConcentrationPct: 0.3,
    maxCorrelationClusterPct: 0.3, maxPortfolioCapitalAtRiskPct: 0.5, maxInventoryCapacityPct: 0.5,
    maxAssignmentCapacityPct: 0.5, maxRecoveryCapacityPct: 0.3,
  };
  const classify = (equity: number, capital: number, profile: 'CASH_SECURED_SHORT_PUT' | 'DEFINED_RISK_VERTICAL') =>
    assessStrategyAccountPolicyCompatibility({
      strategy: profile === 'DEFINED_RISK_VERTICAL' ? 'THETA_DEFINED_RISK' : 'THETA_CONVENTIONAL',
      riskProfile: profile, underlying: 'XYZ', marketApplicable: true, minimumCapitalRequired: capital,
      ...(profile === 'DEFINED_RISK_VERTICAL' ? { definedMaxLoss: capital } : { securedCollateralRequired: capital }),
      brokerAllowedQty: Math.floor(equity / capital), exposure: deriveAccountExposure(account(equity), [], []), policy: canonical,
    });
  assert.equal(classify(25_000, 75_000, 'CASH_SECURED_SHORT_PUT').state, 'ACCOUNT_INFEASIBLE_BROKER_CAPACITY');
  assert.equal(classify(100_000, 75_000, 'CASH_SECURED_SHORT_PUT').state, 'STRATEGY_ACCOUNT_POLICY_INCOMPATIBLE');
  assert.equal(classify(100_000, 20_000, 'CASH_SECURED_SHORT_PUT').state, 'ACCOUNT_FEASIBLE_REDUCED_ONLY');
  assert.equal(classify(100_000, 10_000, 'CASH_SECURED_SHORT_PUT').state, 'ACCOUNT_FEASIBLE');
  assert.equal(classify(25_000, 2_000, 'DEFINED_RISK_VERTICAL').state, 'ACCOUNT_FEASIBLE');
  assert.equal(classify(50_000, 20_000, 'CASH_SECURED_SHORT_PUT').state, 'STRATEGY_ACCOUNT_POLICY_INCOMPATIBLE');
  assert.equal(classify(250_000, 20_000, 'CASH_SECURED_SHORT_PUT').state, 'ACCOUNT_FEASIBLE');
});
