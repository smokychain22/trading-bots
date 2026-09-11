import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ManagementOpportunityBookBuilder,
  buildManagementOpportunityEntry,
  parseManagementOpportunityEntry,
} from '../src/theta/management-opportunity-book.js';
import type { ManagementCycleResult } from '../src/theta/management-cycle.js';
import type { ManagementDecisionReceipt } from '../src/theta/management-assembly.js';

const NOW = new Date().toISOString();
const HASH = 'a'.repeat(64);

const shortPutReceipt = (overrides: Partial<ManagementDecisionReceipt> = {}): ManagementDecisionReceipt => ({
  decisionId: 'd1', snapshotId: 's1', fusionSnapshotHash: HASH, timestamp: NOW, chainId: 'chain-1',
  selectedAction: 'CLOSE', holdAdvantage: -20,
  valuations: [
    { action: 'HOLD', feasible: true, certainCashflow: 0, estimatedFutureValue: null, tailRiskPenalty: 1, capitalDaysPenalty: 1, executionPenalty: 0, utility: 8, reasons: [{ code: 'HOLD_UNKNOWN', polarity: -1, detail: 'x' }] },
    { action: 'CLOSE', feasible: true, certainCashflow: 320, estimatedFutureValue: null, tailRiskPenalty: null, capitalDaysPenalty: null, executionPenalty: null, utility: 320, reasons: [{ code: 'CLOSE_VALUED', polarity: 0, detail: 'x' }] },
  ],
  aegisState: 'ALLOW_FULL', executionRecommendedAction: 'SUBMIT', executionAuthorized: false,
  reasonCodes: ['MANAGEMENT_ACTION_CONFIRMED'],
  plainEnglishExplanation: 'x', failClosedReason: null,
  policyVersion: 'v1', modelVersions: { management: 'v1' },
  ...overrides,
});

const cycleResult = (overrides: Partial<ManagementCycleResult> = {}): ManagementCycleResult => ({
  chainId: 'chain-1', lifecycleState: 'CSP_OPEN', route: 'SHORT_PUT',
  shortPut: shortPutReceipt(), assignmentPending: null, stockRecovery: null, coveredCall: null,
  failClosedReason: null,
  ...overrides,
});

test('a SHORT_PUT cycle result reshapes into a valid ManagementOpportunityEntry with exactly one selected alternative', () => {
  const entry = buildManagementOpportunityEntry(cycleResult(), 'v1', { management: 'v1' });
  const parsed = parseManagementOpportunityEntry(entry);
  assert.equal(parsed.route, 'SHORT_PUT');
  assert.equal(parsed.selectedLabel, 'CLOSE');
  assert.equal(parsed.alternatives.filter((a) => a.selected).length, 1);
  assert.equal(parsed.alternatives.find((a) => a.selected)?.label, 'CLOSE');
  assert.equal(parsed.aegisState, 'ALLOW_FULL');
  assert.equal(parsed.executionQualityAcceptable, true);
});

test('reason codes containing UNKNOWN markers are collected into unknownInputReasonCodes, deduplicated', () => {
  const entry = buildManagementOpportunityEntry(cycleResult(), 'v1', { management: 'v1' });
  assert.deepEqual(entry.unknownInputReasonCodes, ['HOLD_UNKNOWN']);
});

test('a fail-closed cycle result never claims a confident selection', () => {
  const failedResult = cycleResult({
    shortPut: shortPutReceipt({ selectedAction: 'HOLD', failClosedReason: 'PROVIDER_STATE_INVALID', valuations: [] }),
    failClosedReason: 'PROVIDER_STATE_INVALID',
  });
  const entry = buildManagementOpportunityEntry(failedResult, 'v1', { management: 'v1' });
  assert.equal(entry.failClosedReason, 'PROVIDER_STATE_INVALID');
  // HOLD is still reported as the fail-closed default, per management-assembly.ts's own discipline
  assert.equal(entry.selectedLabel, 'HOLD');
});

test('a genuinely UNKNOWN (not fail-closed) assignment recommendation reports no selectedLabel, never a fabricated one', () => {
  const result: ManagementCycleResult = {
    chainId: 'chain-2', lifecycleState: 'ROLL_DECISION', route: 'ASSIGNMENT_PENDING',
    shortPut: null, stockRecovery: null, coveredCall: null,
    assignmentPending: {
      decisionId: 'd2', snapshotId: 's2', fusionSnapshotHash: HASH, timestamp: NOW, chainId: 'chain-2',
      recommendation: 'UNKNOWN', assignmentFeasible: null, requiredCash: 5000, resultingShareQuantity: 100,
      expectedBasisPerShare: 49.4, accountConcentrationAfterAssignmentPct: null, assignmentCapacityUsedPct: null,
      ownershipAcceptable: null, mechanicalCloseRealizedPnl: null, acceptAssignmentTailPenalty: null,
      reasonCodes: ['OWNERSHIP_UNKNOWN'], plainEnglishExplanation: 'x', failClosedReason: null,
      policyVersion: 'v1', modelVersions: { assignment: 'v1' },
    },
    failClosedReason: null,
  };
  const entry = buildManagementOpportunityEntry(result, 'v1', { assignment: 'v1' });
  assert.equal(entry.selectedLabel, null);
  assert.equal(entry.alternatives.every((a) => !a.selected), true);
});

test('the builder collects entries and counts them by route', () => {
  const builder = new ManagementOpportunityBookBuilder();
  builder.recordFromCycleResult(cycleResult(), 'v1', { management: 'v1' });
  builder.recordFromCycleResult(cycleResult({ chainId: 'chain-2', route: 'CLOSED', lifecycleState: 'CLOSED', shortPut: null }), 'v1', { management: 'v1' });
  assert.equal(builder.all().length, 2);
  assert.equal(builder.countByRoute().SHORT_PUT, 1);
  assert.equal(builder.countByRoute().CLOSED, 1);
});

test('an entry with two alternatives both marked selected is rejected by the schema', () => {
  const receipt = shortPutReceipt({
    valuations: [
      { action: 'HOLD', feasible: true, certainCashflow: 0, estimatedFutureValue: null, tailRiskPenalty: null, capitalDaysPenalty: null, executionPenalty: null, utility: 8, reasons: [] },
      { action: 'CLOSE', feasible: true, certainCashflow: 320, estimatedFutureValue: null, tailRiskPenalty: null, capitalDaysPenalty: null, executionPenalty: null, utility: 320, reasons: [] },
    ],
  });
  const entry = buildManagementOpportunityEntry(cycleResult({ shortPut: receipt }), 'v1', { management: 'v1' });
  const tampered = { ...entry, alternatives: entry.alternatives.map((a) => ({ ...a, selected: true })) };
  assert.throws(() => parseManagementOpportunityEntry(tampered));
});

test('eventualRealizedPnl must stay null until eventualOutcomeKnown is true', () => {
  const entry = buildManagementOpportunityEntry(cycleResult(), 'v1', { management: 'v1' });
  const tampered = { ...entry, eventualRealizedPnl: 100 };
  assert.throws(() => parseManagementOpportunityEntry(tampered));
});
