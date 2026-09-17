import assert from 'node:assert/strict';
import test from 'node:test';
import { assessThesisInvalidation } from '../src/theta/thesis-invalidation.js';
import { assembleManagementInput } from '../src/theta/management-input-state.js';

const state = (overrides: Record<string, unknown> = {}, snapshotOverrides: Record<string, unknown> = {}) => assembleManagementInput({
  chain_id: 'chain', lifecycle_state: 'CSP_OPEN', underlying_id: 'underlying', underlying: 'AAPL',
  option_leg_id: 'leg', option_contract_id: 'contract', quantity: '1',
  entry_credit_debit: '200', contract_symbol: 'AAPL261016P00200000', option_type: 'PUT', strike: '200',
  expiration_date: '2026-10-16', multiplier: '100', bid: '1', ask: '1.1', quote_as_of: '2026-09-12T14:00:00.000Z',
  feed: 'OPRA', quote_quality: 'GOOD', realized_option_pnl: '0', open_stock_shares: '0',
  stock_basis_per_share: null, realized_stock_pnl: '0', dividends: '0', fees: '0',
  buying_power: '50000', options_buying_power: '40000', account_as_of: '2026-09-12T14:00:00.000Z', fusion_snapshot_id: 'fusion',
  snapshot_json: { underlyingState: { last: 205 }, marketSession: { isOpen: false },
    riskState: { assignmentCapacity: 1, newRiskState: 'ALLOW_FULL' }, eventState: { state: 'CLEAR' }, ...snapshotOverrides },
  broker_position: null,
  ...overrides,
}, { managementInputSnapshotId: 'input', reconciliationSnapshotId: 'recon', observedAt: '2026-09-12T14:00:00.000Z' });

test('a small, known price loss with no structural break and a clear event state is PRICE_LOSS_ONLY', () => {
  const assessment = assessThesisInvalidation(state({ bid: 2.5, ask: 2.6 }));
  assert.equal(assessment.priceLossKnown, true);
  assert.ok((assessment.priceLossDollars ?? 0) > 0);
  assert.equal(assessment.priceStructureBroken, false);
  assert.equal(assessment.classification, 'PRICE_LOSS_ONLY');
  assert.deepEqual(assessment.thesisFailureSignals, []);
});

test('spot moving ITM against the short-put thesis is a structural break even with only a modest price loss', () => {
  const assessment = assessThesisInvalidation(state({}, { underlyingState: { last: 195 } }));
  assert.equal(assessment.priceStructureBroken, true);
  assert.ok(assessment.thesisFailureSignals.includes('PRICE_STRUCTURE_BREAK_ITM_AGAINST_SHORT_PREMIUM_THESIS'));
  assert.notEqual(assessment.classification, 'NO_KNOWN_LOSS');
});

test('an AEGIS hard veto is a thesis-failure signal independent of price', () => {
  const assessment = assessThesisInvalidation(state({}, { riskState: { assignmentCapacity: 1, newRiskState: 'HARD_VETO' } }));
  assert.ok(assessment.thesisFailureSignals.includes('AEGIS_HARD_VETO'));
});

test('a non-CLEAR event state is surfaced as a named thesis-failure signal', () => {
  const assessment = assessThesisInvalidation(state({}, { eventState: { state: 'EARNINGS_IMMINENT' } }));
  assert.ok(assessment.thesisFailureSignals.includes('EVENT_STATE_EARNINGS_IMMINENT'));
});

test('opaque context fields with no verified schema are reported as uninterpreted, never counted as failure', () => {
  const assessment = assessThesisInvalidation(state({}, { expertPriorState: { anything: 'unverified' }, regimeState: { anything: true } }));
  assert.ok(assessment.uninterpretedSignals.includes('OWNERSHIP_QUALITY_PRESENT_UNINTERPRETED'));
  assert.ok(assessment.uninterpretedSignals.includes('REGIME_STATE_PRESENT_UNINTERPRETED'));
  assert.ok(!assessment.thesisFailureSignals.some((signal) => signal.includes('OWNERSHIP') || signal.includes('REGIME')));
});

test('no known loss and no thesis-failure signals classifies as NO_KNOWN_LOSS', () => {
  const assessment = assessThesisInvalidation(state({ bid: 0.05, ask: 0.06 }));
  assert.equal(assessment.classification, 'NO_KNOWN_LOSS');
});

test('missing bid/ask AND missing spot with no other signal classifies as INSUFFICIENT_EVIDENCE', () => {
  const assessment = assessThesisInvalidation(state({ bid: null, ask: null, quote_quality: 'BAD' }, { underlyingState: {} }));
  assert.equal(assessment.priceStructureBroken, null);
  assert.equal(assessment.classification, 'INSUFFICIENT_EVIDENCE');
});
