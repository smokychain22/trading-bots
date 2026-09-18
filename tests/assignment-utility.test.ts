import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateAssignmentUtility } from '../src/theta/assignment-utility.js';
import { assembleManagementInput } from '../src/theta/management-input-state.js';

const state = (overrides: Record<string, unknown> = {}) => assembleManagementInput({
  chain_id: 'chain', lifecycle_state: 'CSP_OPEN', underlying_id: 'underlying', underlying: 'AAPL',
  option_leg_id: 'leg', option_contract_id: 'contract', quantity: '1',
  entry_credit_debit: '200', contract_symbol: 'AAPL261016P00200000', option_type: 'PUT', strike: '200',
  expiration_date: '2026-10-16', multiplier: '100', bid: '5', ask: '5.2', quote_as_of: '2026-10-14T14:00:00.000Z',
  feed: 'OPRA', quote_quality: 'GOOD', realized_option_pnl: '0', open_stock_shares: '0',
  stock_basis_per_share: null, realized_stock_pnl: '0', dividends: '0', fees: '0',
  buying_power: '50000', options_buying_power: '40000', account_as_of: '2026-10-14T14:00:00.000Z', fusion_snapshot_id: 'fusion',
  snapshot_json: { underlyingState: { last: 195 }, marketSession: { isOpen: false },
    riskState: { assignmentCapacity: 1, newRiskState: 'ALLOW_FULL' }, eventState: { state: 'CLEAR' } },
  broker_position: null,
  ...overrides,
}, { managementInputSnapshotId: 'input', reconciliationSnapshotId: 'recon', observedAt: '2026-10-14T14:00:00.000Z' });

test('buildAssignmentState reports secured cash and shares from known contract terms', () => {
  const comparison = evaluateAssignmentUtility(state(), 520, null);
  assert.equal(comparison.assignmentState.securedCashDollars, 200 * 100 * 1);
  assert.equal(comparison.assignmentState.sharesIfAssigned, 100);
});

test('ACCEPT_ASSIGNMENT never claims a negative or positive verdict about the resulting stock position', () => {
  const comparison = evaluateAssignmentUtility(state(), 520, null);
  const accept = comparison.assessments.find((assessment) => assessment.action === 'ACCEPT_ASSIGNMENT');
  assert.equal(accept?.utility, 0);
  assert.ok(accept?.reasons.includes('RESULTING_STOCK_POSITION_ECONOMICS_EVALUATED_SEPARATELY_BY_RECOVERY_STATE'));
});

test('CLOSE ranks by its own known negative cash flow (the cost to close)', () => {
  const comparison = evaluateAssignmentUtility(state(), 520, null);
  const close = comparison.assessments.find((assessment) => assessment.action === 'CLOSE');
  assert.equal(close?.forwardCashFlowDollars, -520);
});

test('a roll candidate with a strong net credit can outrank LET_EXPIRE/ACCEPT_ASSIGNMENT/CLOSE on pure forward economics', () => {
  const comparison = evaluateAssignmentUtility(state(), 520, { openCreditDollars: 900 });
  assert.equal(comparison.best?.action, 'ROLL');
});

test('with no roll candidate and a real close cost, ACCEPT_ASSIGNMENT/LET_EXPIRE (utility 0) beat a costly CLOSE', () => {
  const comparison = evaluateAssignmentUtility(state(), 520, null);
  assert.notEqual(comparison.best?.action, 'CLOSE');
});

test('never fabricates recovery-horizon or downside-estimate fields on the assignment state', () => {
  const comparison = evaluateAssignmentUtility(state(), 520, null);
  assert.ok(comparison.assignmentState.dataCompleteness.missingUpstreamFields.includes('expected_recovery_horizon'));
  assert.ok(comparison.assignmentState.dataCompleteness.missingUpstreamFields.includes('stock_downside_estimate'));
});
