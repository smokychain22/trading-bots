import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildPortfolioCapitalSnapshotReport, computeTopNCapitalShare, type PortfolioCapitalPositionRecord,
  type PortfolioCapitalSnapshotInput,
} from '../src/research/portfolio-capital-analytics.js';

const position = (overrides: Partial<PortfolioCapitalPositionRecord> = {}): PortfolioCapitalPositionRecord => ({
  positionId: 'pos-1', chainId: 'chain-1', underlying: 'AAPL', strategy: 'THETA_CONVENTIONAL',
  category: 'PUT_COLLATERAL', stockLifecycleState: null, capitalAmount: 19500, daysOccupied: 10,
  sectorOrGroup: null, ...overrides,
});

const snapshot = (positions: readonly PortfolioCapitalPositionRecord[], overrides: Partial<PortfolioCapitalSnapshotInput> = {}): PortfolioCapitalSnapshotInput => ({
  snapshotId: 'snap-1', asOf: '2026-09-19T14:00:00Z', accountEquity: 100000, cash: 50000, buyingPower: 80000,
  positions, ...overrides,
});

test('an empty portfolio reports a known zero capitalCommitted, not UNKNOWN', () => {
  const report = buildPortfolioCapitalSnapshotReport(snapshot([]));
  assert.equal(report.positionCount, 0);
  assert.equal(report.capitalCommitted, 0);
  assert.equal(report.freeCapital, 100000);
  assert.equal(report.capitalUtilizationRatio, 0);
  assert.equal(report.brokerAuthority, false);
});

test('a single CSP reports PUT_COLLATERAL capital and full utilization math', () => {
  const report = buildPortfolioCapitalSnapshotReport(snapshot([position()]));
  assert.equal(report.capitalCommitted, 19500);
  assert.equal(report.freeCapital, 100000 - 19500);
  assert.ok(Math.abs((report.capitalUtilizationRatio as number) - 0.195) < 1e-9);
  const csp = report.categoryBreakdown.find((row) => row.category === 'PUT_COLLATERAL');
  assert.equal(csp?.totalCapital, 19500);
  assert.equal(report.capitalDaysTotal, 195000); // 19500 * 10
});

test('multiple CSPs across two underlyings compute correct concentration shares', () => {
  const positions = [
    position({ positionId: 'p1', underlying: 'AAPL', capitalAmount: 30000, daysOccupied: 5 }),
    position({ positionId: 'p2', underlying: 'MSFT', capitalAmount: 10000, daysOccupied: 5 }),
  ];
  const report = buildPortfolioCapitalSnapshotReport(snapshot(positions));
  assert.equal(report.capitalCommitted, 40000);
  const aapl = report.underlyingConcentration.find((row) => row.key === 'AAPL');
  const msft = report.underlyingConcentration.find((row) => row.key === 'MSFT');
  assert.ok(Math.abs((aapl?.shareOfKnownCommittedCapital as number) - 0.75) < 1e-9);
  assert.ok(Math.abs((msft?.shareOfKnownCommittedCapital as number) - 0.25) < 1e-9);
  assert.equal(report.largestUnderlyingCapitalShare, aapl?.shareOfKnownCommittedCapital);
});

test('assigned stock reports STOCK_INVENTORY_CAPITAL with a RECOVERY_WAIT lifecycle tag and recoveryCapitalDays', () => {
  const stock = position({
    positionId: 'stock-1', category: 'STOCK_INVENTORY_CAPITAL', stockLifecycleState: 'RECOVERY_WAIT',
    capitalAmount: 19000, daysOccupied: 4,
  });
  const report = buildPortfolioCapitalSnapshotReport(snapshot([stock]));
  assert.equal(report.capitalCommitted, 19000);
  assert.equal(report.recoveryCapitalDays, 76000); // 19000 * 4
  assert.equal(report.ccCapitalDays, null);
});

test('assigned stock covered by a CC is ONE STOCK_INVENTORY_CAPITAL row, never double-counted as separate stock + CC capital', () => {
  const covered = position({
    positionId: 'stock-covered', category: 'STOCK_INVENTORY_CAPITAL', stockLifecycleState: 'CC_COVERED',
    capitalAmount: 19000, daysOccupied: 3,
  });
  const report = buildPortfolioCapitalSnapshotReport(snapshot([covered]));
  assert.equal(report.positionCount, 1);
  assert.equal(report.capitalCommitted, 19000); // exactly the stock capital, not stock + a second CC commitment
  assert.equal(report.ccCapitalDays, 57000); // 19000 * 3
  const stockCategory = report.categoryBreakdown.find((row) => row.category === 'STOCK_INVENTORY_CAPITAL');
  assert.equal(stockCategory?.positionCount, 1);
});

test('a defined-risk structure reports DEFINED_RISK_MAX_LOSS_CAPITAL and definedRiskCapitalDays separately from CSP collateral', () => {
  const definedRisk = position({
    positionId: 'dr-1', category: 'DEFINED_RISK_MAX_LOSS_CAPITAL', capitalAmount: 500, daysOccupied: 20,
  });
  const report = buildPortfolioCapitalSnapshotReport(snapshot([definedRisk]));
  assert.equal(report.definedRiskCapitalDays, 10000);
  assert.equal(report.assignmentCapitalDays, null);
});

test('a pending order reserve is tracked in its own category, not conflated with an open position', () => {
  const pending = position({ positionId: 'pend-1', category: 'PENDING_ORDER_RESERVE', capitalAmount: 5000, daysOccupied: 0 });
  const report = buildPortfolioCapitalSnapshotReport(snapshot([pending]));
  const category = report.categoryBreakdown.find((row) => row.category === 'PENDING_ORDER_RESERVE');
  assert.equal(category?.totalCapital, 5000);
});

test('missing account equity leaves freeCapital, utilization, and idle fields UNKNOWN rather than fabricated', () => {
  const report = buildPortfolioCapitalSnapshotReport(snapshot([position()], { accountEquity: null }));
  assert.equal(report.freeCapital, null);
  assert.equal(report.capitalUtilizationRatio, null);
  assert.equal(report.knownIdleCapital, null);
  assert.equal(report.idleCapitalFraction, null);
  assert.equal(report.capitalCommitted, 19500); // still computable independent of equity
});

test('a position with an unknown capitalAmount is excluded from sums but counted separately, never fabricated as zero', () => {
  const known = position({ positionId: 'known', capitalAmount: 10000 });
  const unknown = position({ positionId: 'unknown', capitalAmount: null });
  const report = buildPortfolioCapitalSnapshotReport(snapshot([known, unknown]));
  assert.equal(report.capitalCommitted, 10000);
  assert.equal(report.knownCapitalPositionCount, 1);
  assert.equal(report.unknownCapitalPositionCount, 1);
});

test('an all-unknown-capital portfolio (nonzero position count) reports capitalCommitted as null, not a fabricated zero', () => {
  const report = buildPortfolioCapitalSnapshotReport(snapshot([position({ capitalAmount: null })]));
  assert.equal(report.capitalCommitted, null);
  assert.equal(report.freeCapital, null); // depends on capitalCommitted being known
});

test('zero account equity never divides by zero -- utilization and idle fraction remain null', () => {
  const report = buildPortfolioCapitalSnapshotReport(snapshot([position()], { accountEquity: 0 }));
  assert.equal(report.capitalUtilizationRatio, null);
  assert.equal(report.idleCapitalFraction, null);
});

test('non-finite or negative capitalAmount/daysOccupied is treated as UNKNOWN, never propagated as NaN or a fabricated commitment', () => {
  const nanAmount = position({ positionId: 'nan-amount', capitalAmount: Number.NaN });
  const negativeAmount = position({ positionId: 'negative-amount', capitalAmount: -100 });
  const negativeDays = position({ positionId: 'negative-days', capitalAmount: 1000, daysOccupied: -1 });
  const report = buildPortfolioCapitalSnapshotReport(snapshot([nanAmount, negativeAmount, negativeDays]));
  assert.equal(report.knownCapitalPositionCount, 1); // only negativeDays has a valid capitalAmount
  assert.equal(report.capitalCommitted, 1000);
  assert.equal(report.capitalDaysTotal, null); // the one valid amount has an invalid days figure
  assert.ok(Number.isFinite(report.capitalCommitted as number));
});

test('a duplicate positionId in the same snapshot is rejected, never silently summed', () => {
  assert.throws(
    () => buildPortfolioCapitalSnapshotReport(snapshot([position({ positionId: 'dup' }), position({ positionId: 'dup' })])),
    /PORTFOLIO_CAPITAL_DUPLICATE_POSITION_ID/,
  );
});

test('a STOCK_INVENTORY_CAPITAL row without a stockLifecycleState is a structural error, never silently defaulted', () => {
  assert.throws(
    () => buildPortfolioCapitalSnapshotReport(snapshot([position({ category: 'STOCK_INVENTORY_CAPITAL', stockLifecycleState: null })])),
    /PORTFOLIO_CAPITAL_STOCK_LIFECYCLE_STATE_REQUIRED/,
  );
});

test('a non-stock row carrying a stockLifecycleState is a structural error, since that tag only applies to stock capital', () => {
  assert.throws(
    () => buildPortfolioCapitalSnapshotReport(snapshot([position({ category: 'PUT_COLLATERAL', stockLifecycleState: 'PLAIN_HOLDING' })])),
    /PORTFOLIO_CAPITAL_STOCK_LIFECYCLE_STATE_NOT_APPLICABLE/,
  );
});

test('sector concentration is null (not an empty computed zero) when no position carries sector evidence', () => {
  const report = buildPortfolioCapitalSnapshotReport(snapshot([position()]));
  assert.equal(report.sectorConcentration, null);
});

test('sector concentration is computed only from positions that actually carry sectorOrGroup evidence', () => {
  const withSector = position({ positionId: 'p1', sectorOrGroup: 'TECH', capitalAmount: 10000 });
  const withoutSector = position({ positionId: 'p2', underlying: 'XOM', sectorOrGroup: null, capitalAmount: 5000 });
  const report = buildPortfolioCapitalSnapshotReport(snapshot([withSector, withoutSector]));
  assert.equal(report.sectorConcentration?.length, 1);
  assert.equal(report.sectorConcentration?.[0]?.key, 'TECH');
});

test('computeTopNCapitalShare sums only the top N entries over the true known-committed-capital denominator', () => {
  const positions = [
    position({ positionId: 'p1', underlying: 'AAPL', capitalAmount: 60000 }),
    position({ positionId: 'p2', underlying: 'MSFT', capitalAmount: 30000 }),
    position({ positionId: 'p3', underlying: 'TSLA', capitalAmount: 10000 }),
  ];
  const report = buildPortfolioCapitalSnapshotReport(snapshot(positions));
  const top2 = computeTopNCapitalShare(report.underlyingConcentration, 2, report.capitalCommitted);
  assert.ok(Math.abs((top2 as number) - 0.9) < 1e-9); // (60000+30000)/100000
});

test('computeTopNCapitalShare returns null when the denominator is unknown or zero, and rejects a non-positive N', () => {
  assert.equal(computeTopNCapitalShare([], 3, null), null);
  assert.equal(computeTopNCapitalShare([], 3, 0), null);
  assert.throws(() => computeTopNCapitalShare([], 0, 1000));
});

test('the report carries no risk/sizing/allocation verdict field of any kind -- descriptive statistics only', () => {
  const report = buildPortfolioCapitalSnapshotReport(snapshot([position()]));
  const keys = Object.keys(report).map((key) => key.toLowerCase());
  for (const forbidden of ['riskapproved', 'openmore', 'reduceposition', 'bestticker', 'optimalsize', 'recommendation', 'verdict', 'approved']) {
    assert.ok(!keys.includes(forbidden), `report must not carry a decision-shaped field: ${forbidden}`);
  }
});

test('buyingPower is a pure passthrough of broker-reported truth, never recomputed by this module', () => {
  const reportWithBp = buildPortfolioCapitalSnapshotReport(snapshot([position()], { buyingPower: 42000 }));
  assert.equal(reportWithBp.buyingPower, 42000);
  const reportWithoutBp = buildPortfolioCapitalSnapshotReport(snapshot([position()], { buyingPower: null }));
  assert.equal(reportWithoutBp.buyingPower, null);
});
