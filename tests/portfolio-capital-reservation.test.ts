import assert from 'node:assert/strict';
import test from 'node:test';
import { paperBootstrapRuntimePolicy as P } from '../src/theta/paper-bootstrap-runtime-policy.js';
import type { DerivedAccountExposure } from '../src/theta/account-exposure.js';
import { buildPortfolioBudgetSnapshot, type PortfolioBudgetPolicy, type PortfolioBudgetSnapshot } from '../src/theta/portfolio-budget.js';
import { decideCapitalReservation, inFlightCapitalFromPlan, withInFlightCapital, type CapitalProposal } from '../src/execution/portfolio-capital-reservation.js';

const NOW = '2026-10-07T14:00:00.000Z';
// FIXTURE_ONLY: limits opened to 100% so the arithmetic under test (remaining new-risk capital) is the only binding constraint.
export const reservationFixturePolicy: PortfolioBudgetPolicy = { policyVersion: 'fixture-reservation', hardCapMultiplier: 1, maximumTickerConcentrationPct: 1,
  maximumSectorConcentrationPct: 1, maximumCorrelationClusterPct: 1, maximumPortfolioCapitalAtRiskPct: 1, maximumAssignmentCapacityPct: 1,
  maximumInventoryCapacityPct: P.aegis.maximumInventoryCapacityPct, maximumRecoveryCapacityPct: P.aegis.maximumRecoveryCapacityPct,
  assignmentReserveCents: null, managementReserveCents: null, opportunityReserveCents: null };
export function twentyThousandRemaining(observedAt = NOW): PortfolioBudgetSnapshot {
  const exposure = { equity: 100_000, cash: 100_000, buyingPower: 100_000, optionsBuyingPower: 100_000, cspCollateralRequired: 80_000, stockInventoryValue: 0,
    longOptionValue: 0, stockValueByUnderlying: {}, shortPutCount: 1, shortCallCount: 0, longPutCount: 0, longCallCount: 0, openOrderCount: 0,
    pendingOpeningCapitalAtRisk: 0, pendingAssignmentCollateral: 0, pendingExposureByUnderlying: {}, unclassifiedOpenOrderIds: [], portfolioCapitalAtRiskPct: null,
    tickerConcentrationPct: null, largestConcentrationUnderlying: null, exposureByUnderlying: { SPY: 80_000 }, riskyUnderlyings: ['SPY'],
    unparsedOptionSymbols: [], unclassifiedPositionSymbols: [] } as DerivedAccountExposure;
  const result = buildPortfolioBudgetSnapshot({ accountId: 'acct', observedAt, exposure, activePositions: 1, pendingOpeningOrders: 0, recoveryInventoryValue: 0,
    reconciling: false }, reservationFixturePolicy);
  if (result.state !== 'READY') throw new Error('fixture');
  return result.snapshot;
}
const proposal = (decisionId: string, underlying = 'TLT', quantity = 1): CapitalProposal => ({ decisionId, strategy: 'THETA_Q', candidateId: `THETA_CONVENTIONAL:${underlying}`,
  underlying, quantity, capitalPerContractCents: 1_200_000 });
const decide = (overrides: Partial<Parameters<typeof decideCapitalReservation>[0]> = {}) => decideCapitalReservation({ snapshot: twentyThousandRemaining(),
  policy: reservationFixturePolicy, proposal: proposal('d-a'), inFlight: [], ambiguousIntentIds: [], now: NOW, maximumSnapshotAgeMilliseconds: 45_000, ...overrides });

test('TWO SIMULTANEOUS $12k OPPORTUNITIES against $20k: the first reserves, the second (seeing the first in flight) must REEVALUATE, never $24k', () => {
  assert.equal(twentyThousandRemaining().remainingNewRiskCapitalCents, 2_000_000);
  const first = decide();
  assert.equal(first.state, 'RESERVED');
  const second = decide({ proposal: proposal('d-b', 'IWM'), inFlight: [{ sourceId: 'plan-a', underlying: 'TLT', capitalCents: 1_200_000, assignmentCollateralCents: 1_200_000 }] });
  assert.equal(second.state, 'PORTFOLIO_CAPACITY_CHANGED_REEVALUATE');
  if (second.state === 'PORTFOLIO_CAPACITY_CHANGED_REEVALUATE') {
    assert.equal(second.proposalQuantity, 1, 'the proposal is reported unchanged');
    assert.equal(second.maximumQuantity, 0);
    assert.equal(second.bindingConstraint, 'UNRESERVED_NEW_RISK_CAPITAL');
  }
});

test('the reservation never shrinks a proposal: 3 contracts that no longer fit are REEVALUATE, not 1', () => {
  const result = decide({ proposal: { ...proposal('d-c'), quantity: 3, capitalPerContractCents: 900_000 } });
  assert.equal(result.state, 'PORTFOLIO_CAPACITY_CHANGED_REEVALUATE', '3 x $9k = $27k > $20k: a new decision is required');
  assert.equal(decide({ proposal: { ...proposal('d-c'), quantity: 2, capitalPerContractCents: 900_000 } }).state, 'RESERVED');
});

test('stale snapshot and ambiguous broker state are typed, never a reservation and never UNKNOWN', () => {
  const stale = decide({ snapshot: twentyThousandRemaining('2026-10-07T13:58:00.000Z') });
  assert.equal(stale.state, 'BUDGET_SNAPSHOT_STALE');
  const future = decide({ snapshot: twentyThousandRemaining('2026-10-07T14:05:00.000Z') });
  assert.equal(future.state, 'BUDGET_SNAPSHOT_STALE', 'a snapshot from the future is not trusted');
  const ambiguous = decide({ ambiguousIntentIds: ['intent-x'] });
  assert.deepEqual(ambiguous, { state: 'CAPITAL_RESERVATION_RECONCILING', ambiguousIntentIds: ['intent-x'] }, 'capital is not reused while a broker order might exist');
});

test('in-flight capital comes from the durable plan payload with strategy semantics (CSP collateral; D max loss) and never mutates the snapshot', () => {
  const csp = inFlightCapitalFromPlan('p1', { action: 'OPEN_CSP', symbol: 'TLT261113P00076000', quantity: 2, multiplier: 100, underlying: 'TLT' });
  assert.deepEqual(csp, { sourceId: 'p1', underlying: 'TLT', capitalCents: 1_520_000, assignmentCollateralCents: 1_520_000 });
  const d = inFlightCapitalFromPlan('p2', { action: 'OPEN_DEFINED_RISK', symbol: 'MLEG', quantity: 1, multiplier: 100, underlying: 'SPY',
    definedRisk: { structuralNetCreditPerShare: 1, legs: [{ strike: 500, positionIntent: 'sell_to_open', multiplier: 100 }, { strike: 495, positionIntent: 'buy_to_open', multiplier: 100 }] } });
  assert.deepEqual(d, { sourceId: 'p2', underlying: 'SPY', capitalCents: 40_000, assignmentCollateralCents: 0 });
  assert.throws(() => inFlightCapitalFromPlan('p3', { action: 'CLOSE_CSP', symbol: 'TLT261113P00076000', quantity: 1, multiplier: 100, underlying: 'TLT' }));
  const base = twentyThousandRemaining();
  const view = withInFlightCapital(base, [csp]);
  assert.equal(base.pendingOpeningCapitalCents, 0, 'the original snapshot is immutable');
  assert.equal(view.pendingOpeningCapitalCents, 1_520_000);
  assert.equal(view.exposureByUnderlyingCents.TLT, 1_520_000, 'the in-flight plan counts against its own underlying');
});
