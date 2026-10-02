import assert from 'node:assert/strict';
import test from 'node:test';
import type { Pool } from 'pg';
import { deriveAccountExposure, deriveCandidateInclusiveAegisInputs, type CandidateCapacityPolicy, type DerivedAccountExposure } from '../src/theta/account-exposure.js';
import { assembleManagementInput } from '../src/theta/management-input-state.js';
import { PostgresWholeChainComponentsRepository } from '../src/theta/postgres-whole-chain-components-repository.js';
import { assessStrategyAccountPolicyCompatibility } from '../src/theta/strategy-account-policy-compatibility.js';

type Row = Record<string, unknown>;
const repository = new PostgresWholeChainComponentsRepository({} as unknown as Pool) as unknown as {
  putCloseCosts(rows: readonly Row[], assignments: readonly Row[], expirations: readonly Row[], asOf: string): { status: string; value: number | null };
  coveredCallCloseCosts(calls: readonly Row[], assignments: readonly Row[], expirations: readonly Row[], asOf: string): { status: string; value: number | null };
};
const ASOF = '2026-10-01T20:00:00.000Z';
const put = (over: Row): Row => ({ option_leg_id: 'p1', side: 'SHORT', option_type: 'PUT', quantity: 1, multiplier: 100, closed_at: '2026-09-20T15:00:00.000Z',
  close_reason: 'BTC_CLOSE', close_price_per_share: 0.5, partial_closing_debit: 0, ...over });
const call = (over: Row): Row => ({ option_leg_id: 'c1', side: 'SHORT', option_type: 'CALL', quantity: 1, multiplier: 100, closed_at: '2026-09-25T15:00:00.000Z',
  close_reason: 'BTC_CLOSE', close_price_per_share: 0.4, partial_closing_debit: 0, ...over });

test('put close cost: a closed leg must prove its terminal event; an unrecognised close reason is UNKNOWN, never a known zero', () => {
  assert.equal(repository.putCloseCosts([put({})], [], [], ASOF).value, 50, 'BTC_CLOSE prices the buy-back');
  assert.equal(repository.putCloseCosts([put({ close_reason: 'ROLLED' })], [], [], ASOF).value, 0, 'a roll close is accounted separately');
  assert.equal(repository.putCloseCosts([put({ closed_at: null, close_reason: null })], [], [], ASOF).value, 0, 'an open leg has incurred no close cost');
  for (const reason of [null, 'MANUAL', 'UNEXPECTED_REASON']) {
    const result = repository.putCloseCosts([put({ close_reason: reason, close_price_per_share: null })], [], [], ASOF);
    assert.equal(result.status, 'UNKNOWN', String(reason));
    assert.equal(result.value, null);
  }
  assert.equal(repository.putCloseCosts([put({ close_reason: 'ASSIGNED' })], [], [], ASOF).status, 'UNKNOWN', 'assignment without an assignment event is unproven');
  assert.equal(repository.putCloseCosts([put({ close_reason: 'ASSIGNED' })], [{ option_leg_id: 'p1', option_type: 'PUT' }], [], ASOF).value, 0);
  assert.equal(repository.putCloseCosts([put({ close_reason: 'EXPIRE_OTM' })], [], [{ option_leg_id: 'p1' }], ASOF).value, 0);
  assert.equal(repository.putCloseCosts([put({ close_reason: 'EXPIRE_OTM' })], [], [], ASOF).status, 'UNKNOWN');
});

test('a partially bought-back put or call that later expires or is assigned keeps the buy-back debit (no cash flow disappears)', () => {
  const expiredPut = put({ close_reason: 'EXPIRE_OTM', partial_closing_debit: 35 });
  assert.equal(repository.putCloseCosts([expiredPut], [], [{ option_leg_id: 'p1' }], ASOF).value, 35);
  const assignedCall = call({ close_reason: 'ASSIGNED', partial_closing_debit: 22.5 });
  assert.equal(repository.coveredCallCloseCosts([assignedCall], [{ option_leg_id: 'c1', option_type: 'CALL' }], [], ASOF).value, 22.5);
  const expiredCall = call({ close_reason: 'EXPIRE_OTM', partial_closing_debit: 10 });
  assert.equal(repository.coveredCallCloseCosts([expiredCall], [], [{ option_leg_id: 'c1' }], ASOF).value, 10);
  const plainExpired = call({ close_reason: 'EXPIRE_OTM' });
  assert.equal(repository.coveredCallCloseCosts([plainExpired], [], [{ option_leg_id: 'c1' }], ASOF).value, 0, 'no partial -> a real zero');
  assert.equal(repository.coveredCallCloseCosts([call({ close_reason: 'EXPIRE_OTM' })], [], [], ASOF).status, 'UNKNOWN', 'no terminal evidence -> unknown');
});

const managementRow = (over: Row = {}): Row => ({
  chain_id: 'chain', lifecycle_state: 'CSP_OPEN', underlying_id: 'underlying', underlying: 'AAPL', option_leg_id: 'leg', option_contract_id: 'contract',
  quantity: '1', entry_credit_debit: '200', contract_symbol: 'AAPL261016P00200000', option_type: 'PUT', strike: '200', expiration_date: '2026-10-16',
  multiplier: '100', bid: '5', ask: '5.2', quote_as_of: '2026-10-14T14:00:00.000Z', feed: 'OPRA', quote_quality: 'GOOD', realized_option_pnl: '120',
  open_stock_shares: '0', stock_basis_per_share: null, realized_stock_pnl: '0', dividends: '0', fees: '0', buying_power: '50000',
  options_buying_power: '40000', account_as_of: '2026-10-14T14:00:00.000Z', fusion_snapshot_id: 'fusion',
  snapshot_json: { underlyingState: { last: 195 }, marketSession: { isOpen: false }, riskState: { assignmentCapacity: 1, newRiskState: 'ALLOW_FULL' },
    eventState: { state: 'CLEAR' } }, broker_position: null, ...over,
});
const economics = (over: Row = {}) => assembleManagementInput(managementRow(over), {
  managementInputSnapshotId: 'input', reconciliationSnapshotId: 'recon', observedAt: '2026-10-14T14:00:00.000Z' }).economics;

test('whole-chain P&L is UNKNOWN when a closed leg has no realized P&L or the chain held stock with unproven dividends; fees stay governing', () => {
  assert.equal(typeof economics().wholeChainPnl, 'number', 'complete ledger evidence yields a number');
  assert.equal(economics({ unknown_closed_leg_pnl: true }).wholeChainPnl, null, 'a closed leg without P&L is broken evidence, not zero');
  assert.equal(economics({ has_stock_lots: true, open_stock_shares: '100', stock_basis_per_share: '195' }).wholeChainPnl, null,
    'no dividend writer exists, so a stock chain cannot prove its dividends');
  assert.equal(economics({ unknown_fill_fees: true }).wholeChainPnl, null, 'unknown fill fees remain unknown');
});

const policy: CandidateCapacityPolicy = { hardCapMultiplier: 1.5, maxTickerConcentrationPct: 0.15, maxSectorConcentrationPct: 0.15,
  maxCorrelationClusterPct: 0.15, maxPortfolioCapitalAtRiskPct: 0.25, maxInventoryCapacityPct: 0.5, maxAssignmentCapacityPct: 0.25, maxRecoveryCapacityPct: 0.5 };
const account = { accountId: 'paper', status: 'ACTIVE' as const, tradingBlocked: false, accountBlocked: false, equity: 100_000, cash: 100_000, buyingPower: 100_000,
  optionsBuyingPower: 100_000, optionsTradingLevel: 2, patternDayTrader: false, daytradeCount: 0, retrievedAt: '2026-10-01T15:00:00.000Z' };

test('an exposure object whose classification coverage was never established is UNKNOWN, not "nothing unclassified"', () => {
  const complete = deriveAccountExposure(account, [], []);
  const legacyShape = { ...complete, unclassifiedPositionSymbols: undefined } as unknown as DerivedAccountExposure;
  const footprint = { underlying: 'AAPL', securedCollateralPerContract: 10_000, quantity: 1 };
  assert.equal(deriveCandidateInclusiveAegisInputs(complete, [], footprint, 0).evidenceState, 'KNOWN_DERIVED_FROM_REAL');
  assert.equal(deriveCandidateInclusiveAegisInputs(legacyShape, [], footprint, 0).evidenceState, 'UNKNOWN_INSUFFICIENT_ACCOUNT_STATE');
  const compatibility = assessStrategyAccountPolicyCompatibility({ strategy: 'THETA_CONVENTIONAL', underlying: 'AAPL', marketApplicable: true,
    minimumCapitalRequired: 10_000, brokerAllowedQty: 1, exposure: legacyShape, policy });
  assert.equal(compatibility.state, 'UNKNOWN');
  assert.equal(compatibility.accountFeasible, null);
});
