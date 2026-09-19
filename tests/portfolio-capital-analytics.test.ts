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
  assert.equal(report.capitalAccountingState, 'COMPLETE');
  assert.equal(report.researchUncommittedEquityEstimate, 100000);
  assert.equal(report.knownCapitalToEquityRatio, 0);
  assert.equal(report.capitalDaysTotal, 0);
  assert.equal(report.assignmentCapitalDays, 0);
  assert.equal(report.brokerAuthority, false);
});

test('a single CSP reports PUT_COLLATERAL capital and full utilization math', () => {
  const report = buildPortfolioCapitalSnapshotReport(snapshot([position()]));
  assert.equal(report.capitalCommitted, 19500);
  assert.equal(report.researchUncommittedEquityEstimate, 100000 - 19500);
  assert.ok(Math.abs((report.knownCapitalToEquityRatio as number) - 0.195) < 1e-9);
  const csp = report.categoryBreakdown.find((row) => row.category === 'PUT_COLLATERAL');
  assert.equal(csp?.totalCapital, 19500);
  assert.equal(report.capitalDaysTotal, 195000); // 19500 * 10
});

test('multiple CSPs across two underlyings compute correct concentration shares', () => {
  const positions = [
    position({ positionId: 'p1', chainId: 'chain-aapl', underlying: 'AAPL', capitalAmount: 30000, daysOccupied: 5 }),
    position({ positionId: 'p2', chainId: 'chain-msft', underlying: 'MSFT', capitalAmount: 10000, daysOccupied: 5 }),
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
  assert.equal(report.ccCapitalDays, 0);
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

test('a separate covered-call commitment row cannot duplicate the covered stock chain capital', () => {
  const stock = position({
    positionId: 'stock-covered', chainId: 'covered-chain', category: 'STOCK_INVENTORY_CAPITAL',
    stockLifecycleState: 'CC_COVERED', capitalAmount: 19000,
  });
  const duplicateCallCapital = position({
    positionId: 'covered-call', chainId: 'covered-chain', category: 'OTHER_KNOWN_COMMITMENT', capitalAmount: 19000,
  });
  assert.throws(
    () => buildPortfolioCapitalSnapshotReport(snapshot([stock, duplicateCallCapital])),
    /PORTFOLIO_CAPITAL_DUPLICATE_ACTIVE_CHAIN_ID/,
  );
});

test('a defined-risk structure reports DEFINED_RISK_MAX_LOSS_CAPITAL and definedRiskCapitalDays separately from CSP collateral', () => {
  const definedRisk = position({
    positionId: 'dr-1', category: 'DEFINED_RISK_MAX_LOSS_CAPITAL', capitalAmount: 390, daysOccupied: 20,
  });
  const report = buildPortfolioCapitalSnapshotReport(snapshot([definedRisk]));
  assert.equal(report.capitalCommitted, 390); // canonical max loss, not full $500 width
  assert.equal(report.definedRiskCapitalDays, 7800);
  assert.equal(report.assignmentCapitalDays, 0);
});

test('a pending order reserve is tracked in its own category, not conflated with an open position', () => {
  const pending = position({ positionId: 'pend-1', category: 'PENDING_ORDER_RESERVE', capitalAmount: 5000, daysOccupied: 0 });
  const report = buildPortfolioCapitalSnapshotReport(snapshot([pending]));
  const category = report.categoryBreakdown.find((row) => row.category === 'PENDING_ORDER_RESERVE');
  assert.equal(category?.totalCapital, 5000);
});

test('missing account equity leaves research equity arithmetic UNKNOWN while broker buying power stays separate', () => {
  const report = buildPortfolioCapitalSnapshotReport(snapshot([position()], { accountEquity: null }));
  assert.equal(report.researchUncommittedEquityEstimate, null);
  assert.equal(report.knownCapitalToEquityRatio, null);
  assert.equal(report.researchUncommittedEquityFraction, null);
  assert.equal(report.buyingPower, 80000);
  assert.equal(report.capitalCommitted, 19500); // still computable independent of equity
});

test('a position with an unknown capitalAmount is excluded from sums but counted separately, never fabricated as zero', () => {
  const known = position({ positionId: 'known', chainId: 'known-chain', capitalAmount: 10000 });
  const unknown = position({ positionId: 'unknown', chainId: 'unknown-chain', capitalAmount: null });
  const report = buildPortfolioCapitalSnapshotReport(snapshot([known, unknown]));
  assert.equal(report.capitalCommitted, 10000);
  assert.equal(report.knownCapitalPositionCount, 1);
  assert.equal(report.unknownCapitalPositionCount, 1);
  assert.equal(report.capitalAccountingState, 'PARTIAL');
  assert.equal(report.researchUncommittedEquityEstimate, null);
  assert.equal(report.knownCapitalToEquityRatio, null);
});

test('an all-unknown-capital portfolio (nonzero position count) reports capitalCommitted as null, not a fabricated zero', () => {
  const report = buildPortfolioCapitalSnapshotReport(snapshot([position({ capitalAmount: null })]));
  assert.equal(report.capitalCommitted, null);
  assert.equal(report.capitalAccountingState, 'UNKNOWN');
  assert.equal(report.researchUncommittedEquityEstimate, null);
});

test('zero account equity never divides by zero', () => {
  const report = buildPortfolioCapitalSnapshotReport(snapshot([position()], { accountEquity: 0 }));
  assert.equal(report.knownCapitalToEquityRatio, null);
  assert.equal(report.researchUncommittedEquityFraction, null);
});

test('non-finite or negative capitalAmount/daysOccupied is treated as UNKNOWN, never propagated as NaN or a fabricated commitment', () => {
  const nanAmount = position({ positionId: 'nan-amount', chainId: 'nan-chain', capitalAmount: Number.NaN });
  const negativeAmount = position({ positionId: 'negative-amount', chainId: 'negative-chain', capitalAmount: -100 });
  const negativeDays = position({ positionId: 'negative-days', chainId: 'negative-days-chain', capitalAmount: 1000, daysOccupied: -1 });
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

test('two active rows for one chain are rejected across assignment and pending-order transitions', () => {
  const assigned = position({
    positionId: 'stock', chainId: 'transition-chain', category: 'STOCK_INVENTORY_CAPITAL',
    stockLifecycleState: 'RECOVERY_WAIT', capitalAmount: 19000,
  });
  const stalePutReserve = position({
    positionId: 'put-reserve', chainId: 'transition-chain', category: 'ASSIGNMENT_RESERVED_CAPITAL', capitalAmount: 19500,
  });
  assert.throws(
    () => buildPortfolioCapitalSnapshotReport(snapshot([assigned, stalePutReserve])),
    /PORTFOLIO_CAPITAL_DUPLICATE_ACTIVE_CHAIN_ID/,
  );
  const pending = position({
    positionId: 'pending', chainId: 'transition-chain', category: 'PENDING_ORDER_RESERVE', capitalAmount: 19500,
  });
  assert.throws(
    () => buildPortfolioCapitalSnapshotReport(snapshot([assigned, pending])),
    /PORTFOLIO_CAPITAL_DUPLICATE_ACTIVE_CHAIN_ID/,
  );
});

test('multiple distinct chains on one underlying remain separate commitments and aggregate concentration', () => {
  const first = position({ positionId: 'aapl-1', chainId: 'chain-a', underlying: 'AAPL', capitalAmount: 10000 });
  const second = position({ positionId: 'aapl-2', chainId: 'chain-b', underlying: 'AAPL', capitalAmount: 15000 });
  const report = buildPortfolioCapitalSnapshotReport(snapshot([first, second]));
  assert.equal(report.capitalCommitted, 25000);
  assert.equal(report.underlyingConcentration.length, 1);
  assert.equal(report.underlyingConcentration[0]?.positionCount, 2);
  assert.equal(report.underlyingConcentration[0]?.shareOfKnownCommittedCapital, 1);
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
  const report = buildPortfolioCapitalSnapshotReport(snapshot([position({ sectorOrGroup: '   ' })]));
  assert.equal(report.sectorConcentration, null);
});

test('sector concentration is computed only from positions that actually carry sectorOrGroup evidence', () => {
  const withSector = position({ positionId: 'p1', chainId: 'chain-tech', sectorOrGroup: 'TECH', capitalAmount: 10000 });
  const withoutSector = position({ positionId: 'p2', chainId: 'chain-energy', underlying: 'XOM', sectorOrGroup: null, capitalAmount: 5000 });
  const report = buildPortfolioCapitalSnapshotReport(snapshot([withSector, withoutSector]));
  assert.equal(report.sectorConcentration?.length, 1);
  assert.equal(report.sectorConcentration?.[0]?.key, 'TECH');
});

test('computeTopNCapitalShare sums only the top N entries over the true known-committed-capital denominator', () => {
  const positions = [
    position({ positionId: 'p1', chainId: 'chain-aapl', underlying: 'AAPL', capitalAmount: 60000 }),
    position({ positionId: 'p2', chainId: 'chain-msft', underlying: 'MSFT', capitalAmount: 30000 }),
    position({ positionId: 'p3', chainId: 'chain-tsla', underlying: 'TSLA', capitalAmount: 10000 }),
  ];
  const report = buildPortfolioCapitalSnapshotReport(snapshot(positions));
  const top2 = computeTopNCapitalShare(report.underlyingConcentration, 2, report.capitalCommitted);
  assert.ok(Math.abs((top2 as number) - 0.9) < 1e-9); // (60000+30000)/100000
});

test('computeTopNCapitalShare returns null when the denominator is unknown or zero, and rejects a non-positive N', () => {
  assert.equal(computeTopNCapitalShare([], 3, null), null);
  assert.equal(computeTopNCapitalShare([], 3, 0), null);
  assert.equal(computeTopNCapitalShare([], 3, Number.NaN), null);
  assert.throws(() => computeTopNCapitalShare([], 0, 1000));
  assert.throws(() => computeTopNCapitalShare([{ key: 'bad', capital: Number.NaN, positionCount: 1,
    shareOfKnownCommittedCapital: null }], 1, 1000), /PORTFOLIO_CAPITAL_TOP_N_ENTRY_INVALID/);
});

test('computeTopNCapitalShare sorts its input rather than trusting caller order', () => {
  const entries = [
    { key: 'small', capital: 10, positionCount: 1, shareOfKnownCommittedCapital: 0.1 },
    { key: 'large', capital: 90, positionCount: 1, shareOfKnownCommittedCapital: 0.9 },
  ];
  assert.equal(computeTopNCapitalShare(entries, 1, 100), 0.9);
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

test('non-finite account fields are quarantined as UNKNOWN and named, never propagated as NaN', () => {
  const report = buildPortfolioCapitalSnapshotReport(snapshot([position()], {
    accountEquity: Number.NaN, cash: Number.POSITIVE_INFINITY, buyingPower: Number.NEGATIVE_INFINITY,
  }));
  assert.equal(report.accountEquity, null);
  assert.equal(report.cash, null);
  assert.equal(report.buyingPower, null);
  assert.deepEqual(report.invalidAccountFields, ['accountEquity', 'cash', 'buyingPower']);
  assert.equal(report.researchUncommittedEquityEstimate, null);
});

test('capital-day completeness distinguishes a partial known sum from a complete total', () => {
  const known = position({ positionId: 'known', chainId: 'known-chain', capitalAmount: 1000, daysOccupied: 2 });
  const unknown = position({ positionId: 'unknown', chainId: 'unknown-chain', capitalAmount: 500, daysOccupied: null });
  const report = buildPortfolioCapitalSnapshotReport(snapshot([known, unknown]));
  assert.equal(report.capitalDaysTotal, 2000);
  assert.equal(report.knownCapitalDaysPositionCount, 1);
  assert.equal(report.unknownCapitalDaysPositionCount, 1);
  assert.equal(report.capitalDaysAccountingState, 'PARTIAL');
});

test('missing chain identity remains visible instead of being treated as a known chain', () => {
  const report = buildPortfolioCapitalSnapshotReport(snapshot([position({ chainId: null })]));
  assert.equal(report.knownChainPositionCount, 0);
  assert.equal(report.unknownChainPositionCount, 1);
});
