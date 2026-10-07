import assert from 'node:assert/strict';
import test from 'node:test';
import { paperBootstrapRuntimePolicy as P } from '../src/theta/paper-bootstrap-runtime-policy.js';
import { deriveAccountExposure, deriveCandidateCapacityAssessment, type DerivedAccountExposure } from '../src/theta/account-exposure.js';
import {
  allocationClassOf, assertProposalQuantityImmutable, buildPortfolioBudgetSnapshot, buildStrategyBudgetEnvelope, compareEnvelopeParity,
  maximumQuantityWithinEnvelope, parsePortfolioAllocatorMode, proposalCapitalPerContractCents,
  type PortfolioBudgetPolicy, type PortfolioBudgetSnapshot,
} from '../src/theta/portfolio-budget.js';

// The EXISTING production capital policy, mapped once. No new percentage is introduced anywhere in this file except where a test fixture
// explicitly demonstrates reserve arithmetic (marked FIXTURE_ONLY).
const policy: PortfolioBudgetPolicy = { policyVersion: 'paper-bootstrap-capital-v1', hardCapMultiplier: P.aegis.hardCapMultiplier,
  maximumTickerConcentrationPct: P.aegis.maximumTickerConcentrationPct, maximumSectorConcentrationPct: P.aegis.maximumSectorConcentrationPct,
  maximumCorrelationClusterPct: P.aegis.maximumCorrelationClusterPct, maximumPortfolioCapitalAtRiskPct: P.aegis.maximumPortfolioCapitalAtRiskPct,
  maximumAssignmentCapacityPct: P.aegis.maximumAssignmentCapacityPct, maximumInventoryCapacityPct: P.aegis.maximumInventoryCapacityPct,
  maximumRecoveryCapacityPct: P.aegis.maximumRecoveryCapacityPct, assignmentReserveCents: null, managementReserveCents: null, opportunityReserveCents: null };
const capacityPolicy = { hardCapMultiplier: P.aegis.hardCapMultiplier, maxTickerConcentrationPct: P.aegis.maximumTickerConcentrationPct,
  maxSectorConcentrationPct: P.aegis.maximumSectorConcentrationPct, maxCorrelationClusterPct: P.aegis.maximumCorrelationClusterPct,
  maxPortfolioCapitalAtRiskPct: P.aegis.maximumPortfolioCapitalAtRiskPct, maxInventoryCapacityPct: P.aegis.maximumInventoryCapacityPct,
  maxAssignmentCapacityPct: P.aegis.maximumAssignmentCapacityPct, maxRecoveryCapacityPct: P.aegis.maximumRecoveryCapacityPct };
const NOW = '2026-10-07T14:00:00.000Z';
const EXPIRES = '2026-10-07T14:00:45.000Z';

function exposureOf(input: { equity?: number; buyingPower?: number; csp?: number; stock?: number; pending?: number; pendingAssignment?: number;
  byUnderlying?: Record<string, number>; stockByUnderlying?: Record<string, number> } = {}): DerivedAccountExposure {
  const byUnderlying = input.byUnderlying ?? {};
  return { equity: input.equity ?? 100_000, cash: input.equity ?? 100_000, buyingPower: input.buyingPower ?? 100_000, optionsBuyingPower: input.buyingPower ?? 100_000,
    cspCollateralRequired: input.csp ?? 0, stockInventoryValue: input.stock ?? 0, longOptionValue: 0, stockValueByUnderlying: input.stockByUnderlying ?? {},
    shortPutCount: 0, shortCallCount: 0, longPutCount: 0, longCallCount: 0, openOrderCount: 0, pendingOpeningCapitalAtRisk: input.pending ?? 0,
    pendingAssignmentCollateral: input.pendingAssignment ?? input.pending ?? 0, pendingExposureByUnderlying: {}, unclassifiedOpenOrderIds: [],
    portfolioCapitalAtRiskPct: null, tickerConcentrationPct: null, largestConcentrationUnderlying: null, exposureByUnderlying: byUnderlying,
    riskyUnderlyings: Object.keys(byUnderlying).filter((key) => (byUnderlying[key] ?? 0) > 0), unparsedOptionSymbols: [], unclassifiedPositionSymbols: [] };
}
const snapshotOf = (exposure: DerivedAccountExposure, budgetPolicy = policy, recovery = 0): PortfolioBudgetSnapshot => {
  const result = buildPortfolioBudgetSnapshot({ accountId: 'acct', observedAt: NOW, exposure, activePositions: 0, pendingOpeningOrders: 0,
    recoveryInventoryValue: recovery, reconciling: false }, budgetPolicy);
  assert.equal(result.state, 'READY', JSON.stringify(result));
  return (result as { snapshot: PortfolioBudgetSnapshot }).snapshot;
};
const envelope = (snapshot: PortfolioBudgetSnapshot, strategy: 'THETA_Q' | 'THETA_H' | 'THETA_D' | 'THETA_A' | 'THETA_C', underlying: string, budgetPolicy = policy) =>
  buildStrategyBudgetEnvelope(snapshot, { strategy, underlying, policy: budgetPolicy, expiresAt: EXPIRES });
const maxQty = (snapshot: PortfolioBudgetSnapshot, strategy: 'THETA_Q' | 'THETA_H' | 'THETA_D', underlying: string, capitalDollars: number, broker = 10,
  budgetPolicy = policy) => maximumQuantityWithinEnvelope(envelope(snapshot, strategy, underlying, budgetPolicy),
  { capitalPerContractCents: Math.round(capitalDollars * 100), brokerAllowedQuantity: broker });

test('PARITY (differential, 600 seeded portfolios): the allocator envelope reproduces the existing capacity cap exactly; zero divergences', () => {
  let seed = 20261007;
  const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const pick = <T>(items: readonly T[]): T => items[Math.floor(rand() * items.length)] as T;
  const divergences: string[] = [];
  let nonZero = 0, policyBound = 0;
  for (let index = 0; index < 600; index += 1) {
    const equity = pick([25_000, 50_000, 100_000, 100_000, 250_000, 73_456.78]);
    const underlyings = ['TLT', 'SPY', 'QQQ', 'IWM'].slice(0, 1 + Math.floor(rand() * 3));
    const byUnderlying: Record<string, number> = {};
    let csp = 0;
    for (const underlying of underlyings) if (rand() < 0.6) { const value = Math.round(rand() * equity * 0.25 / 100) * 100; byUnderlying[underlying] = value; csp += value; }
    const pending = rand() < 0.3 ? Math.round(rand() * equity * 0.1 / 100) * 100 : 0;
    const exposure = exposureOf({ equity, buyingPower: equity * pick([0.5, 1, 2]), csp, pending, byUnderlying });
    const recovery = rand() < 0.1 ? equity * 0.5 : 0;
    const underlying = pick(['TLT', 'SPY', 'QQQ', 'IWM', 'XLE']);
    const strike = pick([12, 25, 49.5, 76, 100, 150, 225, 226, 400]);
    const brokerAllowed = Math.floor(rand() * 8);
    const existing = deriveCandidateCapacityAssessment(exposure, [], { underlying, securedCollateralPerContract: strike * 100 }, brokerAllowed, capacityPolicy, recovery);
    if (existing.quantityCap > 0) nonZero += 1;
    if (existing.quantityCap < brokerAllowed) policyBound += 1;
    const snapshot = snapshotOf(exposure, policy, recovery);
    const parity = compareEnvelopeParity({ envelope: envelope(snapshot, 'THETA_Q', underlying), capitalPerContractCents: strike * 100 * 100,
      brokerAllowedQuantity: brokerAllowed, currentQuantityCap: existing.quantityCap, reservesConfigured: false });
    if (parity.divergence !== null) divergences.push(`#${index} ${underlying} strike=${strike} existing=${existing.quantityCap} allocator=${parity.allocatorMaximumQuantity} ${parity.divergence.classification}`);
  }
  assert.deepEqual(divergences, [], 'PARITY_DIVERGENCES must be 0 for certified fixtures');
  assert.ok(nonZero >= 150 && policyBound >= 200, `the fixtures must exercise real capacity, not only zeros (nonZero=${nonZero}, policyBound=${policyBound})`);
});

test('PARITY at the exact boundary: a candidate landing exactly ON the hard limit is rejected by both (strictly-below rule), one cent under fits', () => {
  for (const [equity, strike] of [[100_000, 225], [100_000, 112.5], [73_456.78, 165.27]] as const) {
    const limitDollars = equity * P.aegis.maximumTickerConcentrationPct * P.aegis.hardCapMultiplier;
    for (const existingTicker of [0, 0.01, limitDollars - strike * 100, limitDollars - strike * 100 - 0.01, limitDollars - strike * 100 + 0.01]) {
      const value = Math.max(0, Math.round(existingTicker * 100) / 100);
      const exposure = exposureOf({ equity, csp: value, byUnderlying: value > 0 ? { TLT: value } : {} });
      const existing = deriveCandidateCapacityAssessment(exposure, [], { underlying: 'TLT', securedCollateralPerContract: strike * 100 }, 3, capacityPolicy, 0);
      const parity = compareEnvelopeParity({ envelope: envelope(snapshotOf(exposure), 'THETA_Q', 'TLT'), capitalPerContractCents: Math.round(strike * 100 * 100),
        brokerAllowedQuantity: 3, currentQuantityCap: existing.quantityCap, reservesConfigured: false });
      assert.equal(parity.divergence, null, `equity=${equity} strike=${strike} existing=${value}: existing=${existing.quantityCap} allocator=${parity.allocatorMaximumQuantity}`);
    }
  }
});

test('snapshot is typed and exact: integer cents, one id per state, typed failures, never ALLOCATOR_UNKNOWN or an invented reserve', () => {
  const snapshot = snapshotOf(exposureOf());
  assert.equal(snapshot.accountEquityCents, 10_000_000);
  assert.equal(snapshot.tickerLimitCents, 2_250_000, '$100k x 15% x 1.5 = $22,500 exactly, no float drift');
  assert.ok(Number.isSafeInteger(snapshot.remainingNewRiskCapitalCents));
  assert.deepEqual(snapshot.policyNotes, ['ASSIGNMENT_RESERVE_POLICY_NOT_CONFIGURED', 'MANAGEMENT_RESERVE_POLICY_NOT_CONFIGURED', 'OPPORTUNITY_RESERVE_POLICY_NOT_CONFIGURED']);
  assert.equal(snapshotOf(exposureOf()).snapshotId, snapshot.snapshotId, 'same state, same snapshot id');
  assert.notEqual(snapshotOf(exposureOf({ csp: 100 , byUnderlying: { TLT: 100 } })).snapshotId, snapshot.snapshotId);
  const missing = buildPortfolioBudgetSnapshot({ accountId: 'a', observedAt: NOW, exposure: exposureOf(), activePositions: 0, pendingOpeningOrders: 0,
    recoveryInventoryValue: 0, reconciling: false }, null);
  assert.deepEqual(missing, { state: 'UNAVAILABLE', failure: 'BUDGET_POLICY_MISSING', reasons: ['BUDGET_POLICY_MISSING_OR_INVALID'] });
  const reconciling = buildPortfolioBudgetSnapshot({ accountId: 'a', observedAt: NOW, exposure: exposureOf(), activePositions: 0, pendingOpeningOrders: 1,
    recoveryInventoryValue: 0, reconciling: true }, policy);
  assert.equal(reconciling.state === 'UNAVAILABLE' && reconciling.failure, 'PORTFOLIO_EXPOSURE_RECONCILING', 'an ambiguous broker order holds capacity');
  const noEquity = buildPortfolioBudgetSnapshot({ accountId: 'a', observedAt: NOW, exposure: { ...exposureOf(), equity: null }, activePositions: 0,
    pendingOpeningOrders: 0, recoveryInventoryValue: 0, reconciling: false }, policy);
  assert.equal(noEquity.state === 'UNAVAILABLE' && noEquity.failure, 'PORTFOLIO_SNAPSHOT_UNAVAILABLE');
  const pendingUnknown = buildPortfolioBudgetSnapshot({ accountId: 'a', observedAt: NOW, exposure: { ...exposureOf(), pendingOpeningCapitalAtRisk: null },
    activePositions: 0, pendingOpeningOrders: 1, recoveryInventoryValue: 0, reconciling: false }, policy);
  assert.equal(pendingUnknown.state === 'UNAVAILABLE' && pendingUnknown.failure, 'PORTFOLIO_EXPOSURE_RECONCILING', 'unknown pending capital is never zero');
  assert.equal(parsePortfolioAllocatorMode(undefined), 'OFF');
  assert.equal(parsePortfolioAllocatorMode('enforced'), 'OFF', 'an unrecognised value is OFF, never a stronger mode');
  assert.equal(parsePortfolioAllocatorMode('SHADOW'), 'SHADOW');
});

test('Scenario A: a $50k CSP on a flat $100k account is NOT_FEASIBLE (exceeds the $22,500 ticker limit); never a fractional or alternate quantity', () => {
  const result = maxQty(snapshotOf(exposureOf()), 'THETA_Q', 'BIG', 50_000, 1);
  assert.deepEqual(result, { state: 'NOT_FEASIBLE_WITHIN_PORTFOLIO_ENVELOPE', maximumQuantity: 0, bindingConstraint: 'TICKER_CONCENTRATION' });
  assert.equal(maxQty(snapshotOf(exposureOf()), 'THETA_Q', 'TLT', 7_600, 5).maximumQuantity, 2, 'TLT $7,600: 2 x 7,600 = 15,200 < 22,500 < 3 x 7,600');
});

test('Scenarios B + C: Q and H on the SAME underlying share one ticker capacity; H sees what is left after an open Q position', () => {
  const flat = snapshotOf(exposureOf());
  const q = envelope(flat, 'THETA_Q', 'TLT'), h = envelope(flat, 'THETA_H', 'TLT');
  assert.equal(q.snapshotId, h.snapshotId, 'one portfolio snapshot per decision cycle');
  assert.equal(q.constraints.find((c) => c.code === 'TICKER_CONCENTRATION')?.remainingCents, h.constraints.find((c) => c.code === 'TICKER_CONCENTRATION')?.remainingCents);
  const afterQ = snapshotOf(exposureOf({ csp: 12_000, byUnderlying: { TLT: 12_000 } }));
  const hTicker = envelope(afterQ, 'THETA_H', 'TLT').constraints.find((c) => c.code === 'TICKER_CONCENTRATION');
  assert.equal(hTicker?.remainingCents, 1_050_000, 'H on TLT sees $22,500 - $12,000 = $10,500, never the original $22,500');
  assert.equal(maxQty(afterQ, 'THETA_H', 'TLT', 7_600, 5).maximumQuantity, 1);
  assert.equal(maxQty(afterQ, 'THETA_H', 'TLT', 11_000, 5).state, 'NOT_FEASIBLE_WITHIN_PORTFOLIO_ENVELOPE');
});

test('Scenario D: D uses its defined maximum loss, never CSP strike x 100 collateral, and no assignment capacity', () => {
  const perContract = proposalCapitalPerContractCents({ strategy: 'THETA_D', shortStrike: 300, longStrike: 295, netCreditPerShare: 1, multiplier: 100 });
  assert.equal(perContract, 40_000, '($5 width - $1 credit) x 100 = $400');
  const d = envelope(snapshotOf(exposureOf()), 'THETA_D', 'MID');
  assert.equal(d.constraints.some((c) => c.code === 'ASSIGNMENT_CAPACITY'), false);
  assert.equal(maximumQuantityWithinEnvelope(d, { capitalPerContractCents: perContract, brokerAllowedQuantity: 3 }).maximumQuantity, 3);
  assert.equal(maxQty(snapshotOf(exposureOf()), 'THETA_Q', 'MID', 30_000, 3).maximumQuantity, 0, 'the same structure as a CSP would not fit');
  assert.throws(() => proposalCapitalPerContractCents({ strategy: 'THETA_D', shortStrike: 295, longStrike: 300, netCreditPerShare: 1, multiplier: 100 }));
});

test('Scenario E: A/C are INVENTORY_MANAGEMENT, never charged against new-risk capacity; new entries can not starve them', () => {
  assert.equal(allocationClassOf('THETA_A'), 'INVENTORY_MANAGEMENT');
  assert.equal(allocationClassOf('THETA_C'), 'INVENTORY_MANAGEMENT');
  assert.equal(allocationClassOf('THETA_D'), 'NEW_RISK');
  const exhausted = snapshotOf(exposureOf({ csp: 74_000, byUnderlying: { TLT: 20_000, SPY: 20_000, QQQ: 20_000, IWM: 14_000 } }));
  const c = envelope(exhausted, 'THETA_C', 'TLT');
  assert.deepEqual(c.constraints, [], 'no new-risk constraint applies to covered calls');
  assert.ok(c.notes.includes('INVENTORY_MANAGEMENT_NOT_CHARGED_AGAINST_NEW_RISK_CAPACITY'));
  assert.throws(() => maximumQuantityWithinEnvelope(c, { capitalPerContractCents: 1, brokerAllowedQuantity: 1 }), /SIZED_BY_INVENTORY/,
    'C is sized by free covered shares, never by a cash envelope');
  assert.equal(maxQty(exhausted, 'THETA_Q', 'XLE', 1_000, 5).state, 'NOT_FEASIBLE_WITHIN_PORTFOLIO_ENVELOPE', 'while new risk is exhausted');
});

test('Scenario F + reserve math (FIXTURE_ONLY 20k): equity 100k, committed 30k, opportunity reserve 20k -> at most 50k new deployment, not 70k', () => {
  const fixturePolicy: PortfolioBudgetPolicy = { ...policy, policyVersion: 'fixture-reserve-math', maximumPortfolioCapitalAtRiskPct: 1, maximumTickerConcentrationPct: 1,
    maximumAssignmentCapacityPct: 1, opportunityReserveCents: 2_000_000 };
  const snapshot = snapshotOf(exposureOf({ csp: 30_000, byUnderlying: { TLT: 30_000 } }), fixturePolicy);
  assert.equal(snapshot.remainingNewRiskCapitalCents, 5_000_000);
  assert.equal(maxQty(snapshot, 'THETA_Q', 'SPY', 10_000, 10, fixturePolicy).maximumQuantity, 5, 'the first trades can not consume the protected reserve');
  assert.equal(maxQty(snapshot, 'THETA_Q', 'SPY', 10_000, 10, fixturePolicy).bindingConstraint, 'UNRESERVED_NEW_RISK_CAPITAL');
  assert.ok(!snapshot.policyNotes.includes('OPPORTUNITY_RESERVE_POLICY_NOT_CONFIGURED'));
});

test('management reserve can not be stolen: a new trade asking for full broker buying power is bounded by the reserve-excluded envelope', () => {
  const fixturePolicy: PortfolioBudgetPolicy = { ...policy, policyVersion: 'fixture-mgmt', maximumPortfolioCapitalAtRiskPct: 1, maximumTickerConcentrationPct: 1,
    maximumAssignmentCapacityPct: 1, managementReserveCents: 1_500_000 };
  const snapshot = snapshotOf(exposureOf({ buyingPower: 100_000 }), fixturePolicy);
  const result = maxQty(snapshot, 'THETA_Q', 'SPY', 100_000, 1, fixturePolicy);
  assert.equal(result.state, 'NOT_FEASIBLE_WITHIN_PORTFOLIO_ENVELOPE', 'broker buying power is a constraint, not the allocator');
  assert.equal(result.bindingConstraint, 'UNRESERVED_NEW_RISK_CAPITAL');
  assert.equal(envelope(snapshot, 'THETA_Q', 'SPY', fixturePolicy).protectedManagementReserveCents, 1_500_000);
});

test('THREE STRATEGIES ALL WANT $50K: one snapshot, typed envelopes, each FEASIBLE or NOT_FEASIBLE, no UNKNOWN, no three independent reservations', () => {
  const snapshot = snapshotOf(exposureOf());
  const q = maxQty(snapshot, 'THETA_Q', 'AAA', 50_000, 1);
  const h = maxQty(snapshot, 'THETA_H', 'AAA', 50_000, 1);
  const d = maxQty(snapshot, 'THETA_D', 'BBB', 50_000, 1);
  for (const result of [q, h, d]) assert.ok(['FEASIBLE', 'NOT_FEASIBLE_WITHIN_PORTFOLIO_ENVELOPE'].includes(result.state));
  assert.equal(q.state, 'NOT_FEASIBLE_WITHIN_PORTFOLIO_ENVELOPE');
  assert.equal(h.state, 'NOT_FEASIBLE_WITHIN_PORTFOLIO_ENVELOPE');
  assert.equal(d.state, 'NOT_FEASIBLE_WITHIN_PORTFOLIO_ENVELOPE', '$50k modeled loss on one underlying also exceeds the ticker limit');
  // the envelope is a ceiling the strategies optimise inside: it never adds up three $50k reservations
  const capacity = snapshot.remainingPortfolioRiskCapacityCents;
  assert.ok(capacity < 3 * 5_000_000, 'three independent $50k reservations would exceed portfolio capacity; only atomic reservation admits them one at a time');
  const afterOne = snapshotOf(exposureOf({ csp: 22_000, byUnderlying: { AAA: 22_000 } }));
  assert.ok(afterOne.remainingPortfolioRiskCapacityCents < capacity, 'the next decision sees the updated remaining capacity');
});

test('pending capital: partial fill reserves filled + remaining exactly once; zero-fill terminal releases; assignment moves collateral to inventory without double count', () => {
  const now = NOW;
  const account = { accountStatus: 'ACTIVE', equity: 100_000, cash: 100_000, buyingPower: 400_000, optionsBuyingPower: 100_000, optionsApprovedLevel: 3,
    optionsTradingLevel: 3, tradingBlocked: false, transfersBlocked: false, maskedAccountId: '****', receivedAt: now } as never;
  const leg = { symbol: 'TLT261113P00076000', quantity: -1, assetClass: 'us_option', side: 'short', marketValue: -150, costBasis: -180, avgEntryPrice: 1.8 } as never;
  const order = (filled: number, status: string) => ({ orderId: 'o-1', clientOrderId: 'c-1', symbol: 'TLT261113P00076000', side: 'sell', positionIntent: 'sell_to_open',
    quantity: 3, filledQuantity: filled, limitPrice: 1.8, status, submittedAt: now, receivedAt: now }) as never;
  const partial = snapshotOf(deriveAccountExposure(account, [leg], [order(1, 'partially_filled')], 100));
  assert.equal(partial.openShortPutCollateralCents, 760_000, '1 filled contract');
  assert.equal(partial.pendingOpeningCapitalCents, 1_520_000, '2 remaining working contracts, not 3');
  assert.equal(partial.exposureByUnderlyingCents.TLT, 2_280_000, '3 contracts total, never 4');
  const canceledRemainder = snapshotOf(deriveAccountExposure(account, [leg], [], 100));
  assert.equal(canceledRemainder.pendingOpeningCapitalCents, 0, 'remaining 2 released after cancel; the filled one stays');
  assert.equal(canceledRemainder.openShortPutCollateralCents, 760_000);
  const zeroFill = snapshotOf(deriveAccountExposure(account, [], [], 100));
  assert.equal(zeroFill.committedCapitalCents + zeroFill.pendingOpeningCapitalCents, 0, 'a zero-fill terminal order leaks no capital');
  const assigned = snapshotOf(deriveAccountExposure(account, [{ symbol: 'TLT', quantity: 100, assetClass: 'us_equity', side: 'long', marketValue: 7_500,
    costBasis: 7_600, avgEntryPrice: 76 } as never], [], 100));
  assert.equal(assigned.openShortPutCollateralCents, 0, 'after assignment the put collateral is gone');
  assert.equal(assigned.committedCapitalCents, 750_000, 'and the stock inventory is counted once');
});

test('NO POST-HOC QUANTITY MUTATION: same decision must carry one quantity end to end; a different quantity needs a new decision', () => {
  assert.doesNotThrow(() => assertProposalQuantityImmutable({ decisionId: 'd1', proposalQuantity: 3, planDecisionId: 'd1', planQuantity: 3, requestQuantity: 3 }));
  assert.throws(() => assertProposalQuantityImmutable({ decisionId: 'd1', proposalQuantity: 3, planDecisionId: 'd1', planQuantity: 1 }), /MUTATED_UNDER_SAME_DECISION/);
  assert.throws(() => assertProposalQuantityImmutable({ decisionId: 'd1', proposalQuantity: 3, planDecisionId: 'd1', planQuantity: 3, requestQuantity: 1 }));
  assert.doesNotThrow(() => assertProposalQuantityImmutable({ decisionId: 'd1', proposalQuantity: 3, planDecisionId: 'd2', planQuantity: 1 }), 'new decision, new quantity');
});

test('sector/correlation: a multi-underlying portfolio reports the missing classification instead of inventing a sector budget', () => {
  const multi = envelope(snapshotOf(exposureOf({ csp: 10_000, byUnderlying: { SPY: 10_000 } })), 'THETA_Q', 'QQQ');
  assert.ok(multi.notes.includes('SECTOR_CLASSIFICATION_REQUIRED_FOR_MULTI_UNDERLYING_PORTFOLIO'));
  assert.equal(multi.constraints.some((c) => c.code === 'SECTOR_CONCENTRATION'), false);
  const single = envelope(snapshotOf(exposureOf({ csp: 10_000, byUnderlying: { SPY: 10_000 } })), 'THETA_Q', 'SPY');
  assert.ok(single.constraints.some((c) => c.code === 'CORRELATION_CLUSTER'), 'single risk group: the conservative proxy applies, exactly as today');
});
