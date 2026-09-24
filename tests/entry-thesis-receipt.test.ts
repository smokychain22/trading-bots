import assert from 'node:assert/strict';
import test from 'node:test';
import { buildEntryThesisReceipt } from '../src/theta/entry-thesis-receipt.js';

const known = (statement: string) => ({ state: 'KNOWN' as const, statement, evidenceIds: ['evidence-1'] });
const unknown = (statement: string) => ({ state: 'UNKNOWN' as const, statement, evidenceIds: [] });

const input = () => ({
  decisionId: 'decision-1', snapshotId: 'snapshot-1', candidateId: 'candidate-1',
  decisionAt: '2026-09-24T14:00:00.000Z', underlying: 'SPY', strategy: 'THETA_CONVENTIONAL' as const,
  whyUnderlying: known('Ownership evidence passed.'), whyStrategy: known('Conventional was Paper-authorized.'),
  whyExpiry: known('The expiry survived the lattice.'), whyStrike: known('The strike survived the lattice.'),
  whyNow: known('Risk, size, and execution evidence passed.'), volatilityThesis: unknown('Volatility edge is unknown.'),
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
  assert.equal(first.contractVersion, 'theta-entry-thesis-receipt-v1');
  assert.equal(first.empiricalProfitabilityState, 'UNPROVEN');
  assert.equal(first.executionAuthorized, false);
  assert.match(first.immutableHash, /^[a-f0-9]{64}$/);
  assert.equal(first.immutableHash, second.immutableHash);
});

test('known claims require evidence and unproven capital days cannot carry a number', () => {
  assert.throws(() => buildEntryThesisReceipt({ ...input(), whyNow: { state: 'KNOWN', statement: 'Known', evidenceIds: [] } }),
    /ENTRY_THESIS_KNOWN_WITHOUT_EVIDENCE/);
  assert.throws(() => buildEntryThesisReceipt({
    ...input(), expectedCapitalDays: { value: 10, state: 'EMPIRICALLY_UNPROVEN' },
  }), /ENTRY_THESIS_UNPROVEN_CAPITAL_DAYS_MUST_BE_NULL/);
});
