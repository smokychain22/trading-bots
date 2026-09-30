import assert from 'node:assert/strict';
import test from 'node:test';
import { buildEntryThesisReceipt } from '../src/theta/entry-thesis-receipt.js';
import { loadManagementEntryThesis } from '../src/theta/management-entry-thesis.js';
import { assembleManagementInput } from '../src/theta/management-input-state.js';
import { assessThesisInvalidation } from '../src/theta/thesis-invalidation.js';
import { projectDecisionReceiptForPostgres } from '../src/theta/postgres-cycle-evidence-storage.js';

const known = (statement: string) => ({ state: 'KNOWN' as const, statement, evidenceIds: ['evidence-1'] });
const unknown = (statement: string) => ({ state: 'UNKNOWN' as const, statement, evidenceIds: [] });

const input = () => ({
  decisionId: 'decision-1', snapshotId: 'snapshot-1', candidateId: 'candidate-1',
  decisionAt: '2026-09-24T14:00:00.000Z', underlying: 'SPY', strategy: 'THETA_CONVENTIONAL' as const,
  whyUnderlying: known('Ownership evidence passed.'), whyStrategy: known('Conventional was Paper-authorized.'),
  whyExpiry: known('The expiry survived the lattice.'), whyStrike: known('The strike survived the lattice.'),
  whyNow: known('Risk, size, and execution evidence passed.'), volatilityThesis: unknown('Volatility edge is unknown.'),
  quantityReason: known('Quantity and its binding constraint were persisted.'),
  directionalTolerance: known('Break-even and cushion are deterministic.'),
  eventAssumptions: known('Bounded event coverage was clear.'), breakEven: 500, downsideCushion: 0.02,
  assignmentWillingness: unknown('Assignment is assessed at management time.'),
  expectedManagementPath: known('The canonical management frontier applies.'),
  expectedCapitalDays: { value: null, state: 'EMPIRICALLY_UNPROVEN' as const },
  invalidationConditions: ['Executable quote becomes stale.'],
});

test('entry thesis is immutable, hashed, non-authoritative, and empirically honest', () => {
  const first = buildEntryThesisReceipt(input());
  const second = buildEntryThesisReceipt(input());
  assert.equal(first.contractVersion, 'theta-entry-thesis-receipt-v2');
  assert.equal(first.empiricalProfitabilityState, 'UNPROVEN');
  assert.equal(first.executionAuthorized, false);
  assert.match(first.immutableHash, /^[a-f0-9]{64}$/);
  assert.equal(first.immutableHash, second.immutableHash);
  assert.equal(first.quantityReason.state, 'KNOWN');
});

test('known claims require evidence and unproven capital days cannot carry a number', () => {
  assert.throws(() => buildEntryThesisReceipt({ ...input(), whyNow: { state: 'KNOWN', statement: 'Known', evidenceIds: [] } }),
    /ENTRY_THESIS_KNOWN_WITHOUT_EVIDENCE/);
  assert.throws(() => buildEntryThesisReceipt({
    ...input(), expectedCapitalDays: { value: 10, state: 'EMPIRICALLY_UNPROVEN' },
  }), /ENTRY_THESIS_UNPROVEN_CAPITAL_DAYS_MUST_BE_NULL/);
});

test('persisted original entry thesis reaches management without rewriting its identity or treating price loss as thesis failure', () => {
  const receipt = buildEntryThesisReceipt(input());
  const stored = projectDecisionReceiptForPostgres({ legacyThetaQReceipt: { entryThesisReceipt: receipt } });
  const payload = JSON.parse(JSON.stringify(stored.projection));
  const row = { chain_id: 'chain', lifecycle_state: 'CSP_OPEN', underlying_id: 'spy', underlying: 'SPY',
    option_type: 'PUT', strike: 490, multiplier: 100, quantity: 1, entry_credit_debit: 100,
    bid: 2, ask: 2.1, realized_option_pnl: 0, realized_stock_pnl: 0, open_stock_shares: 0,
    dividends: 0, fees: 0, unknown_fill_fees: false,
    original_entry_thesis: payload.legacyThetaQReceipt.entryThesisReceipt,
    original_decision_id: receipt.decisionId, original_snapshot_id: receipt.snapshotId, original_decided_at: receipt.decisionAt,
  };
  const state = assembleManagementInput(row, { managementInputSnapshotId: 'management', reconciliationSnapshotId: 'recon',
    observedAt: '2026-09-24T15:00:00.000Z' });
  assert.equal(state.originalEntryThesis?.state, 'VERIFIED');
  const assessment = assessThesisInvalidation({ ...state, market: { ...state.market, spot: 495 } });
  assert.equal(assessment.originalEntryThesisHash, receipt.immutableHash);
  assert.equal(assessment.entryBreakEvenBreached, true);
  assert.equal(assessment.classification, 'PRICE_LOSS_ONLY');
  const tampered = assembleManagementInput({ ...row, original_entry_thesis: { ...receipt, breakEven: 499 } },
    { managementInputSnapshotId: 'management', reconciliationSnapshotId: 'recon', observedAt: state.observedAt });
  assert.equal(tampered.originalEntryThesis?.reason, 'ORIGINAL_ENTRY_THESIS_HASH_MISMATCH');
  assert.notEqual(tampered.contentHash, state.contentHash);
  assert.equal(assessThesisInvalidation(tampered).originalEntryThesisHash, null);
});

test('original thesis loader rejects missing malformed future mismatched and semantically invalid evidence', () => {
  const receipt = buildEntryThesisReceipt(input());
  const binding = { decisionId: receipt.decisionId, snapshotId: receipt.snapshotId, decidedAt: receipt.decisionAt,
    underlying: 'SPY', managementAsOf: '2026-09-24T15:00:00.000Z' };
  assert.equal(loadManagementEntryThesis(null, binding).state, 'UNAVAILABLE');
  assert.equal(loadManagementEntryThesis({ ...receipt, whyNow: { ...receipt.whyNow, state: 'FAKE' } }, binding).state, 'INVALID');
  assert.equal(loadManagementEntryThesis(receipt, { ...binding, decisionId: 'other' }).reason, 'ORIGINAL_ENTRY_THESIS_IDENTITY_MISMATCH');
  assert.equal(loadManagementEntryThesis(receipt, { ...binding, snapshotId: 'other' }).state, 'INVALID');
  assert.equal(loadManagementEntryThesis(receipt, { ...binding, underlying: 'QQQ' }).state, 'INVALID');
  assert.equal(loadManagementEntryThesis(receipt, { ...binding, managementAsOf: '2026-09-24T13:00:00Z' }).reason, 'ORIGINAL_ENTRY_THESIS_PIT_INVALID');
  assert.equal(loadManagementEntryThesis({ ...receipt, whyNow: { ...receipt.whyNow, evidenceIds: [] } }, binding).reason,
    'ORIGINAL_ENTRY_THESIS_SEMANTICS_INVALID');
  assert.equal(loadManagementEntryThesis(receipt, { ...binding, decidedAt: new Date(receipt.decisionAt) }).state, 'VERIFIED');
});
