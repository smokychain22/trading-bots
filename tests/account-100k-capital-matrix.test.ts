import assert from 'node:assert/strict';
import test from 'node:test';
import { paperBootstrapRuntimePolicy as P } from '../src/theta/paper-bootstrap-runtime-policy.js';
import { assessStrategyAccountPolicyCompatibility } from '../src/theta/strategy-account-policy-compatibility.js';
import { deriveAccountExposure } from '../src/theta/account-exposure.js';

// $100,000 Paper account capital-safety matrix with the PRODUCTION policy values (ticker 15% soft x 1.5 hard = $22,500 per underlying).
// Production data (2026-09/10): ~90k ACCOUNT_CAPACITY_ZERO candidate-evaluations. This matrix classifies them: a put whose one-contract
// collateral exceeds the hard per-underlying threshold is LEGITIMATE_DISCRETE_CONTRACT_TOO_LARGE, never a computation defect, and the bot
// never blindly allocates most of the account to one CSP just because the broker could afford it.
const NOW = '2026-10-07T14:00:00.000Z';
const account = (positions: Parameters<typeof deriveAccountExposure>[1] = [], multiplierEvidence: number | undefined = 100) => deriveAccountExposure({ accountStatus: 'ACTIVE',
  equity: 100_000, cash: 100_000, buyingPower: 400_000, optionsBuyingPower: 100_000, optionsApprovedLevel: 3, optionsTradingLevel: 3, tradingBlocked: false,
  transfersBlocked: false, maskedAccountId: '****', receivedAt: NOW }, positions, [], multiplierEvidence);
const policy = { hardCapMultiplier: P.aegis.hardCapMultiplier, maxTickerConcentrationPct: P.aegis.maximumTickerConcentrationPct,
  maxSectorConcentrationPct: P.aegis.maximumSectorConcentrationPct, maxCorrelationClusterPct: P.aegis.maximumCorrelationClusterPct,
  maxPortfolioCapitalAtRiskPct: P.aegis.maximumPortfolioCapitalAtRiskPct, maxInventoryCapacityPct: P.aegis.maximumInventoryCapacityPct,
  maxAssignmentCapacityPct: P.aegis.maximumAssignmentCapacityPct, maxRecoveryCapacityPct: P.aegis.maximumRecoveryCapacityPct };
const hardTickerThreshold = 100_000 * P.aegis.maximumTickerConcentrationPct * P.aegis.hardCapMultiplier;

test('production per-underlying hard threshold on $100k is $22,500 (15% x 1.5): a one-contract CSP above a $225 strike can never size', () => {
  assert.equal(hardTickerThreshold, 22_500);
});

test('Case A: a CSP needing ~$73,000 collateral is rejected by internal policy although the broker could afford it (no blind $73k allocation)', () => {
  const result = assessStrategyAccountPolicyCompatibility({ strategy: 'THETA_CONVENTIONAL', underlying: 'BIG', marketApplicable: true, minimumCapitalRequired: 73_000,
    brokerAllowedQty: 1, exposure: account(), policy });
  assert.equal(result.state, 'STRATEGY_ACCOUNT_POLICY_INCOMPATIBLE');
  assert.equal(result.accountFeasible, false);
  assert.ok(result.bindingPolicies.includes('TICKER_CONCENTRATION'));
  assert.deepEqual(result.reasons, ['MINIMUM_EXECUTABLE_UNIT_EXCEEDS_HARD_RISK_POLICY'], 'classified as contract-too-large, not as a defect or unknown');
});

test('Case B: a smaller CSP (TLT-like $76 strike = $7,600) fits every limit: the zero is not universal', () => {
  const result = assessStrategyAccountPolicyCompatibility({ strategy: 'THETA_CONVENTIONAL', underlying: 'TLT', marketApplicable: true, minimumCapitalRequired: 7_600,
    brokerAllowedQty: 2, exposure: account(), policy });
  assert.notEqual(result.state, 'STRATEGY_ACCOUNT_POLICY_INCOMPATIBLE');
  assert.equal(result.accountFeasible, true);
});

test('Case C: a defined-risk spread uses its bounded max loss, not strike x 100 collateral', () => {
  // a 5-wide put spread on a $300 underlying: CSP semantics would need $30,000 (> $22,500), the spread risks at most $500 - credit
  const asCsp = assessStrategyAccountPolicyCompatibility({ strategy: 'THETA_CONVENTIONAL', underlying: 'MID', marketApplicable: true, minimumCapitalRequired: 30_000,
    brokerAllowedQty: 1, exposure: account(), policy });
  const asSpread = assessStrategyAccountPolicyCompatibility({ strategy: 'THETA_DEFINED_RISK', riskProfile: 'DEFINED_RISK_VERTICAL', underlying: 'MID', marketApplicable: true,
    minimumCapitalRequired: 400, definedMaxLoss: 400, brokerAllowedQty: 1, exposure: account(), policy });
  assert.equal(asCsp.accountFeasible, false);
  assert.equal(asSpread.accountFeasible, true);
  assert.equal(asSpread.capitalRiskEvidence.definedMaxLoss, 400);
  assert.equal(asSpread.capitalRiskEvidence.securedCollateral, null, 'no CSP collateral semantics for a spread');
});

test('Case D: an existing open short put on the same underlying consumes its capacity: the new trade sees less, never double free capacity', () => {
  const fresh = assessStrategyAccountPolicyCompatibility({ strategy: 'THETA_CONVENTIONAL', underlying: 'TLT', marketApplicable: true, minimumCapitalRequired: 15_000,
    brokerAllowedQty: 2, exposure: account(), policy });
  const existing = account([{ symbol: 'TLT261113P00150000', quantity: -1, assetClass: 'us_option', side: 'short', marketValue: -200, costBasis: -250, avgEntryPrice: 2.5 } as never]);
  const withOpen = assessStrategyAccountPolicyCompatibility({ strategy: 'THETA_CONVENTIONAL', underlying: 'TLT', marketApplicable: true, minimumCapitalRequired: 15_000,
    brokerAllowedQty: 2, exposure: existing, policy });
  assert.equal(fresh.accountFeasible, true, '$15,000 alone fits under $22,500');
  assert.equal(withOpen.accountFeasible, false, '$15,000 existing + $15,000 new exceeds the per-underlying hard threshold');
  assert.ok(withOpen.bindingPolicies.includes('TICKER_CONCENTRATION'));
  // existing exposure whose multiplier is not evidenced is UNKNOWN (fail closed), never silently free capacity
  const unevidenced = assessStrategyAccountPolicyCompatibility({ strategy: 'THETA_CONVENTIONAL', underlying: 'TLT', marketApplicable: true, minimumCapitalRequired: 15_000,
    brokerAllowedQty: 2, exposure: account([{ symbol: 'TLT261113P00150000', quantity: -1, assetClass: 'us_option', side: 'short', marketValue: -200, costBasis: -250,
      avgEntryPrice: 2.5 } as never], undefined), policy });
  assert.equal(unevidenced.state, 'UNKNOWN');
  assert.notEqual(unevidenced.accountFeasible, true);
});
