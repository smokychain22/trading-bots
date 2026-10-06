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

test('management thesis health evaluates qualified current conditions without equating price loss with failure', () => {
  const receipt = buildEntryThesisReceipt(input());
  const at = '2026-09-24T15:00:00.000Z';
  const ownership = { contractVersion: 'theta-ownership-runtime-v1', snapshotId: 'current-hash', underlyingSymbol: 'SPY',
    timestamp: at, policyVersion: 'test-bootstrap', ownability: 1, thesisInvalidated: false, reasons: [],
    components: ['LiquidityQuality', 'StructuralQuality', 'RecoveryQuality', 'TailQuality', 'EventAdjustment']
      .map(name => ({ name, value: 1, status: 'TEST', reasons: [] })) };
  const initial = assembleManagementInput({ chain_id: 'chain', lifecycle_state: 'CSP_OPEN', underlying: 'SPY', underlying_id: 'spy',
    realized_option_pnl: 0, realized_stock_pnl: 0, open_stock_shares: 0, dividends: 0, fees: 0, unknown_fill_fees: false,
    original_entry_thesis: receipt, original_decision_id: receipt.decisionId, original_snapshot_id: receipt.snapshotId,
    original_decided_at: receipt.decisionAt, management_ownership: ownership, fusion_content_hash: 'current-hash',
  }, { managementInputSnapshotId: 'input', reconciliationSnapshotId: 'recon', observedAt: at });
  const state = { ...initial, hardBlockers: [], evidenceBundle: { ...initial.evidenceBundle, timingState: 'VALID' as const },
    contract: { ...initial.contract, optionType: 'PUT' as const, strike: 490, multiplier: 100, contracts: 1 },
    economics: { ...initial.economics, entryCreditDebit: 100 },
    market: { ...initial.market, spot: 495, optionBid: 2, optionAsk: 2.1 },
    context: { ...initial.context, aegisState: 'ALLOW_FULL', eventState: 'CLEAR', dividendExDateState: 'NOT_APPLICABLE',
      assignmentCapacityEvidence: { ...initial.context.assignmentCapacityEvidence, state: 'KNOWN' as const } } };
  const valid = assessThesisInvalidation(state);
  assert.equal(valid.thesisHealth.state, 'THESIS_VALID');
  assert.equal(valid.classification, 'PRICE_LOSS_ONLY');
  assert.equal(valid.thesisHealth.scope, 'OBSERVED_STRUCTURAL_CONDITIONS_NOT_PROFITABILITY');
  assert.equal(assessThesisInvalidation({ ...state, context: { ...state.context, eventState: 'PRESENT' } }).thesisHealth.state, 'THESIS_WEAKENED');
  const failed = assessThesisInvalidation({ ...state, context: { ...state.context, ownershipAssessment: { ...ownership,
    thesisInvalidated: true, reasons: [{ code: 'THESIS_INVALIDATED', polarity: -1, detail: 'Synthetic explicit structural invalidation.' }] } } });
  assert.equal(failed.thesisHealth.state, 'THESIS_FAILED');
  assert.ok(failed.thesisFailureSignals.includes('QUALIFIED_OWNERSHIP_THESIS_INVALIDATED'));
  for (const bad of [null, { ...ownership, underlyingSymbol: 'QQQ' }, { ...ownership, snapshotId: 'other' },
    { ...ownership, timestamp: '2026-09-24T14:55:00Z' }, { ...ownership, timestamp: '2026-09-24T15:00:01Z' },
    { ...ownership, thesisInvalidated: true }, { ...ownership, ownability: null }]) {
    assert.equal(assessThesisInvalidation({ ...state, context: { ...state.context, ownershipAssessment: bad } }).thesisHealth.state,
      'THESIS_UNKNOWN');
  }
});

// H lineage (directive: H must remain THETA_HOLD_STRIKE through management). The entry thesis is produced only by the Q orchestrator, so an
// H-opened chain has none; its identity must come from the persisted OPENING decision branch, never default to Q's roll permission.
test('an H-opened chain keeps THETA_HOLD_STRIKE under management from its opening decision branch, with no roll; a Q chain is unchanged', async () => {
  const { buildManagementActionFrontier } = await import('../src/theta/management-action-frontier.js');
  const row = { chain_id: 'chain-h', lifecycle_state: 'CSP_OPEN', underlying: 'TLT', underlying_id: 'tlt', realized_option_pnl: 0, realized_stock_pnl: 0,
    open_stock_shares: 0, dividends: 0, fees: 0, unknown_fill_fees: false, original_entry_thesis: null, fusion_content_hash: 'h' };
  const at = { managementInputSnapshotId: 'input', reconciliationSnapshotId: 'recon', observedAt: '2026-10-07T15:00:00.000Z' };
  const h = assembleManagementInput({ ...row, original_strategy_branch: 'THETA_HOLD_STRIKE' }, at);
  assert.equal(h.strategyOrigin, 'THETA_HOLD_STRIKE');
  assert.ok(!buildManagementActionFrontier(h).actions.some((action) => action.action === 'ROLL'), 'H never rolls');
  const q = assembleManagementInput({ ...row, original_strategy_branch: 'THETA_CONVENTIONAL' }, at);
  assert.equal(q.strategyOrigin, undefined, 'Q without a thesis keeps its existing (unchanged) behavior');
  assert.ok(buildManagementActionFrontier(q).actions.some((action) => action.action === 'ROLL'));
});

// Production 2026-10-07: 11 WAIT chains from expired 2026-10-05 entry plans (no leg, no stock, no order) were loaded into every management
// scan, raising MANAGEMENT_HARD_BLOCKERS_PRESENT each cycle and masking any real position's blocker. Such a chain has no exposure to manage.
test('management never loads a WAIT chain that never reached the broker, but still loads one with an in-flight entry order', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(new URL('../src/theta/management-input-state.ts', import.meta.url), 'utf8');
  assert.match(source, /AND NOT \(ec\.lifecycle_state='WAIT'\s+AND NOT EXISTS\(SELECT 1 FROM trade\.option_leg l0 WHERE l0\.chain_id=ec\.chain_id\)\s+AND NOT EXISTS\(SELECT 1 FROM trade\.stock_lot s0 WHERE s0\.chain_id=ec\.chain_id\)\s+AND NOT EXISTS\(SELECT 1 FROM trade\.order_intent oi0 WHERE oi0\.chain_id=ec\.chain_id\s+AND oi0\.status::text NOT IN \('FILLED','CANCELED','REJECTED','EXPIRED'\)\)\)/);
});
