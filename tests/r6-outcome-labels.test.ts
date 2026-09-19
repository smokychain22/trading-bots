import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildR6OutcomeLabelSet, capitalDaysLabel, fillRateLabel, legRealizedPnlLabel, maxDrawdownLabel,
  positionRealizedPnlLabel, recoveryDurationLabel, recoverySuccessLabel, resolvedPositiveLabel,
  returnPerCapitalDayLabel, timeToFillLabel, wholeChainPnlLabels,
} from '../src/research/r6-outcome-labels.js';
import type { WholeChainPnlBreakdown } from '../src/theta/whole-chain-economics.js';
import type { ManagedEpisodePathFeatures } from '../src/theta/managed-episode-path-features.js';

const breakdown = (overrides: Partial<WholeChainPnlBreakdown> = {}): WholeChainPnlBreakdown => ({
  contractVersion: 'theta-whole-chain-economics-v1', legLevelPnl: [], wholeChainPnl: 500,
  cashflowBasis: 'ACTUAL_FILL_CASHFLOW', tcaExecutionShortfall: 12, ...overrides,
});

const pathFeatures = (overrides: Partial<ManagedEpisodePathFeatures> = {}): ManagedEpisodePathFeatures => ({
  contractVersion: 'theta-managed-episode-path-features-v1', maximumFavorableExcursionDollars: 800,
  maximumAdverseExcursionDollars: -200, peakProfitFraction: null, profitGivebackFraction: null,
  timeSinceMfeDays: null, timeSinceMaeDays: null, asOf: '2026-09-19T00:00:00.000Z', ...overrides,
});

test('legRealizedPnlLabel/positionRealizedPnlLabel report KNOWN with correct unit and definition', () => {
  const leg = legRealizedPnlLabel({ legRealizedPnl: 100, positionRealizedPnl: 150, managedEpisodePnl: 200 });
  assert.equal(leg.state, 'KNOWN');
  assert.equal(leg.value, 100);
  assert.equal(leg.unit, 'USD');
  const position = positionRealizedPnlLabel({ legRealizedPnl: 100, positionRealizedPnl: 150, managedEpisodePnl: 200 });
  assert.equal(position.value, 150);
});

test('a null P&L input is reported UNKNOWN, never a fabricated zero', () => {
  const leg = legRealizedPnlLabel({ legRealizedPnl: null, positionRealizedPnl: null, managedEpisodePnl: null });
  assert.equal(leg.state, 'UNKNOWN');
  assert.equal(leg.value, null);
});

test('wholeChainPnlLabels reads the caller-supplied breakdown, never recomputing accounting', () => {
  const labels = wholeChainPnlLabels(breakdown());
  assert.equal(labels.wholeChainPnl.value, 500);
  assert.equal(labels.wholeChainAfterCostPnl.state, 'KNOWN');
  assert.equal(labels.wholeChainAfterCostPnl.value, 500);
});

test('wholeChainAfterCostPnl is UNKNOWN when the underlying whole-chain figure is UNKNOWN', () => {
  const labels = wholeChainPnlLabels(breakdown({ wholeChainPnl: null }));
  assert.equal(labels.wholeChainPnl.state, 'UNKNOWN');
  assert.equal(labels.wholeChainAfterCostPnl.state, 'UNKNOWN');
});

test('wholeChainAfterCostPnl is NOT_APPLICABLE (never silently equated) when cashflowBasis is BENCHMARK_CASHFLOW, not an actual fill', () => {
  const labels = wholeChainPnlLabels(breakdown({ cashflowBasis: 'BENCHMARK_CASHFLOW' }));
  assert.equal(labels.wholeChainPnl.state, 'KNOWN');
  assert.equal(labels.wholeChainAfterCostPnl.state, 'NOT_APPLICABLE');
  assert.equal(labels.wholeChainAfterCostPnl.value, null);
});

test('capitalDaysLabel rejects a negative value as UNKNOWN rather than reporting a nonsensical negative capital-day figure', () => {
  assert.equal(capitalDaysLabel(-5).state, 'UNKNOWN');
  assert.equal(capitalDaysLabel(100).value, 100);
});

test('returnPerCapitalDayLabel is UNKNOWN when capitalDays is exactly zero, never a fabricated infinite return', () => {
  const label = returnPerCapitalDayLabel(500, 0);
  assert.equal(label.state, 'UNKNOWN');
});

test('returnPerCapitalDayLabel computes the correct ratio when both inputs are known', () => {
  const label = returnPerCapitalDayLabel(500, 100);
  assert.equal(label.value, 5);
});

test('maxDrawdownLabel is UNKNOWN for an empty curve, never a fabricated zero drawdown', () => {
  assert.equal(maxDrawdownLabel([]).state, 'UNKNOWN');
});

test('maxDrawdownLabel computes the correct worst peak-to-trough decline for chronological input', () => {
  const curve = [
    { at: '2026-09-01T00:00:00.000Z', equity: 100 },
    { at: '2026-09-02T00:00:00.000Z', equity: 120 },
    { at: '2026-09-03T00:00:00.000Z', equity: 60 },
    { at: '2026-09-04T00:00:00.000Z', equity: 90 },
  ];
  const label = maxDrawdownLabel(curve);
  assert.equal(label.state, 'KNOWN');
  assert.equal(label.value, -60); // peak 120 on day 2, trough 60 on day 3
});

test('maxDrawdownLabel rejects unordered observations instead of silently changing their chronology', () => {
  const curve = [
    { at: '2026-09-02T00:00:00.000Z', equity: 120 },
    { at: '2026-09-01T00:00:00.000Z', equity: 100 },
  ];
  assert.equal(maxDrawdownLabel(curve).state, 'UNKNOWN');
});

test('maxDrawdownLabel is UNKNOWN when any equity point is unknown, never silently skipped', () => {
  const curve = [{ at: '2026-09-01T00:00:00.000Z', equity: 100 }, { at: '2026-09-02T00:00:00.000Z', equity: null }];
  assert.equal(maxDrawdownLabel(curve).state, 'UNKNOWN');
});

test('recoveryDurationLabel is UNKNOWN while either endpoint is unresolved', () => {
  assert.equal(recoveryDurationLabel({ assignedAt: null, stockExitAt: '2026-09-10T00:00:00.000Z' }).state, 'UNKNOWN');
  assert.equal(recoveryDurationLabel({ assignedAt: '2026-09-01T00:00:00.000Z', stockExitAt: null }).state, 'UNKNOWN');
});

test('recoveryDurationLabel computes correct elapsed days and rejects an exit before assignment', () => {
  const label = recoveryDurationLabel({ assignedAt: '2026-09-01T00:00:00.000Z', stockExitAt: '2026-09-11T00:00:00.000Z' });
  assert.equal(label.value, 10);
  const invalid = recoveryDurationLabel({ assignedAt: '2026-09-11T00:00:00.000Z', stockExitAt: '2026-09-01T00:00:00.000Z' });
  assert.equal(invalid.state, 'UNKNOWN');
});

test('recoverySuccessLabel is descriptive only and UNKNOWN while the chain is unresolved', () => {
  assert.equal(recoverySuccessLabel(null).state, 'UNKNOWN');
  assert.equal(recoverySuccessLabel(0).value, true);
  assert.equal(recoverySuccessLabel(-1).value, false);
});

test('resolvedPositiveLabel is strictly secondary (a boolean derived from resolved P&L), never a fabricated value when unresolved', () => {
  assert.equal(resolvedPositiveLabel(null).state, 'UNKNOWN');
  assert.equal(resolvedPositiveLabel(50).value, true);
  assert.equal(resolvedPositiveLabel(0).value, false);
  assert.ok(resolvedPositiveLabel(1).definition.includes('Never the primary economic target'));
});

test('fillRateLabel is UNKNOWN when requested quantity is zero, never a fabricated ratio', () => {
  assert.equal(fillRateLabel({ requestedQuantity: 0, filledQuantity: 0 }).state, 'UNKNOWN');
  assert.equal(fillRateLabel({ requestedQuantity: 4, filledQuantity: 2 }).value, 0.5);
});

test('fillRateLabel rejects impossible negative and overfilled quantities', () => {
  assert.equal(fillRateLabel({ requestedQuantity: 4, filledQuantity: -1 }).state, 'UNKNOWN');
  assert.equal(fillRateLabel({ requestedQuantity: 4, filledQuantity: 5 }).state, 'UNKNOWN');
  assert.equal(fillRateLabel({ requestedQuantity: -4, filledQuantity: 0 }).state, 'UNKNOWN');
});

test('timeToFillLabel rejects a fill timestamp before submission as UNKNOWN', () => {
  const invalid = timeToFillLabel({ submittedAt: '2026-09-19T10:00:05.000Z', firstFillAt: '2026-09-19T10:00:00.000Z' });
  assert.equal(invalid.state, 'UNKNOWN');
  const valid = timeToFillLabel({ submittedAt: '2026-09-19T10:00:00.000Z', firstFillAt: '2026-09-19T10:00:05.000Z' });
  assert.equal(valid.value, 5);
});

test('buildR6OutcomeLabelSet assembles every label from caller-supplied pieces without performing its own accounting, and never claims broker authority', () => {
  const labelSet = buildR6OutcomeLabelSet({
    chainId: 'chain-1', asOf: '2026-09-19T00:00:00.000Z',
    legPnl: { legRealizedPnl: 100, positionRealizedPnl: 100, managedEpisodePnl: 100 },
    wholeChainBreakdown: breakdown(), unrealizedMtm: null, capitalDays: 45,
    pathFeatures: pathFeatures(), equityCurve: [],
    assignmentConfirmed: true, assignedAt: '2026-08-01T00:00:00.000Z', stockExitAt: '2026-09-01T00:00:00.000Z',
    coveredCallPremiumNet: 30, stockPnl: 470, calledAwayConfirmed: true,
    requestedQuantity: 1, filledQuantity: 1, submittedAt: '2026-08-01T00:00:00.000Z', firstFillAt: '2026-08-01T00:00:01.000Z',
  });
  assert.equal(labelSet.brokerAuthority, false);
  assert.equal(labelSet.wholeChainPnl.value, 500);
  assert.equal(labelSet.mfe.value, 800);
  assert.equal(labelSet.mae.value, -200);
  assert.equal(labelSet.assignmentOccurred.value, true);
  assert.equal(labelSet.recoveryDurationDays.value, 31);
  assert.equal(labelSet.calledAwayOccurred.value, true);
  assert.equal(labelSet.fillRate.value, 1);
  assert.equal(labelSet.executionSlippage.value, 12);
  assert.equal(labelSet.returnPerCapitalDay.value, 500 / 45);
});

test('buildR6OutcomeLabelSet keeps every label independently UNKNOWN-safe -- a missing input never blocks unrelated labels', () => {
  const labelSet = buildR6OutcomeLabelSet({
    chainId: 'chain-2', asOf: '2026-09-19T00:00:00.000Z',
    legPnl: { legRealizedPnl: null, positionRealizedPnl: null, managedEpisodePnl: null },
    wholeChainBreakdown: breakdown({ wholeChainPnl: null }), unrealizedMtm: null, capitalDays: null,
    pathFeatures: pathFeatures({ maximumFavorableExcursionDollars: null, maximumAdverseExcursionDollars: null }),
    equityCurve: [], assignmentConfirmed: null, assignedAt: null, stockExitAt: null,
    coveredCallPremiumNet: null, stockPnl: null, calledAwayConfirmed: null,
    requestedQuantity: null, filledQuantity: null, submittedAt: null, firstFillAt: null,
  });
  assert.equal(labelSet.legRealizedPnl.state, 'UNKNOWN');
  assert.equal(labelSet.wholeChainPnl.state, 'UNKNOWN');
  assert.equal(labelSet.mfe.state, 'UNKNOWN');
  assert.equal(labelSet.assignmentOccurred.state, 'UNKNOWN');
  // executionSlippage still resolves from the breakdown's own tcaExecutionShortfall, independent of wholeChainPnl being unknown.
  assert.equal(labelSet.executionSlippage.state, 'KNOWN');
  assert.equal(labelSet.executionSlippage.value, 12);
});
