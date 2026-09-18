import assert from 'node:assert/strict';
import test from 'node:test';
import { buildLossStateVector } from '../src/theta/loss-state-vector.js';
import { assembleManagementInput } from '../src/theta/management-input-state.js';

const state = (lifecycleState: string, overrides: Record<string, unknown> = {}) => assembleManagementInput({
  chain_id: 'chain', lifecycle_state: lifecycleState, underlying_id: 'underlying', underlying: 'AAPL',
  option_leg_id: 'leg', option_contract_id: 'contract', quantity: '1',
  entry_credit_debit: '200', contract_symbol: 'AAPL261016P00200000', option_type: 'PUT', strike: '200',
  expiration_date: '2026-10-16', multiplier: '100', bid: '1', ask: '1.1', quote_as_of: '2026-09-12T14:00:00.000Z',
  feed: 'OPRA', quote_quality: 'GOOD', realized_option_pnl: '0',
  open_stock_shares: lifecycleState === 'RECOVERY_WAIT' ? '100' : '0',
  stock_basis_per_share: lifecycleState === 'RECOVERY_WAIT' ? '195' : null, realized_stock_pnl: '0', dividends: '0', fees: '0',
  buying_power: '50000', options_buying_power: '40000', account_as_of: '2026-09-12T14:00:00.000Z', fusion_snapshot_id: 'fusion',
  snapshot_json: { underlyingState: { last: 205 }, marketSession: { isOpen: false },
    riskState: { assignmentCapacity: 1, newRiskState: 'ALLOW_FULL' }, eventState: { state: 'CLEAR' },
    contractCandidates: [{ occSymbol: 'AAPL261016P00200000', delta: -0.3, gamma: 0.02, theta: -0.05, vega: 0.1, iv: 0.28 }] },
  broker_position: lifecycleState === 'RECOVERY_WAIT' ? { currentPrice: 190 } : null,
  ...overrides,
}, { managementInputSnapshotId: 'input', reconciliationSnapshotId: 'recon', observedAt: '2026-09-12T14:00:00.000Z' });

test('computes known price/structure/vol/greek fields from the current snapshot with no entry data required', () => {
  const vector = buildLossStateVector(state('CSP_OPEN'));
  assert.equal(vector.distanceToStrikeFraction, (205 - 200) / 200);
  assert.equal(vector.ivCurrent, 0.28);
  assert.equal(vector.delta, -0.3);
  assert.ok(vector.dte !== null && vector.dte > 0);
  assert.ok(vector.expectedMoveDollars !== null && vector.expectedMoveDollars > 0);
  assert.equal(vector.capitalLockedDollars, 200 * 100 * 1);
});

test('never computes an assignment probability field -- delta is not probability', () => {
  const vector = buildLossStateVector(state('CSP_OPEN'));
  assert.ok(!('assignmentProbability' in vector));
});

test('reports entry-dependent fields as UNKNOWN and names them when no entry snapshot is supplied', () => {
  const vector = buildLossStateVector(state('CSP_OPEN'));
  assert.equal(vector.ivAtEntry, null);
  assert.equal(vector.ivChange, null);
  assert.equal(vector.capitalDaysSoFar, null);
  assert.ok(vector.dataCompleteness.requiresEntrySnapshot.length > 0);
});

test('computes ivChange and capitalDaysSoFar honestly when an entry snapshot is supplied', () => {
  const vector = buildLossStateVector(state('CSP_OPEN'), {
    observedAt: '2026-09-01T14:00:00.000Z', spotAtEntry: 210, ivAtEntry: 0.22,
    deltaAtEntry: -0.25, gammaAtEntry: 0.015, thetaAtEntry: -0.04, vegaAtEntry: 0.09,
  });
  assert.ok(vector.ivChange !== null && Math.abs(vector.ivChange - (0.28 - 0.22)) < 1e-9);
  assert.ok(vector.capitalDaysSoFar !== null && vector.capitalDaysSoFar > 0);
  assert.ok(vector.underlyingDrawdownFraction !== null);
});

test('surfaces stock-position drawdown for RECOVERY_WAIT without needing an entry snapshot', () => {
  const vector = buildLossStateVector(state('RECOVERY_WAIT'));
  assert.ok(vector.underlyingDrawdownFraction !== null && vector.underlyingDrawdownFraction < 0);
});

test('names upstream fields (Optionomics skew/GEX/flow/liquidity) as not yet plumbed rather than fabricating them', () => {
  const vector = buildLossStateVector(state('CSP_OPEN'));
  assert.ok(vector.dataCompleteness.missingUpstreamFields.includes('skew_change'));
  assert.ok(vector.dataCompleteness.missingUpstreamFields.includes('liquidity_open_interest_volume'));
});
