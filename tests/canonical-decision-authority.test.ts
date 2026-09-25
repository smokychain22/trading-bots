import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveCanonicalDecisionAuthority } from '../src/theta/canonical-decision-authority.js';
import type { CanonicalStrategyFrontier } from '../src/theta/canonical-strategy-frontier.js';
import type { NewRiskDecisionReceipt } from '../src/theta/decision-assembly.js';

const receipt = (): NewRiskDecisionReceipt => ({
  decisionId: 'legacy-evidence', snapshotId: 'snapshot', fusionSnapshotHash: 'a'.repeat(64),
  timestamp: '2026-09-20T14:00:00.000Z', underlying: 'SPY', winningAction: 'OPEN_FULL',
  selectedCandidateId: 'LEGACY-CANDIDATE', quantity: 9, alternatives: [], ownershipSnapshotId: null,
  regimeSnapshotId: null, executionAuthorized: false, reasonCodes: ['LEGACY_SELECTED'],
  plainEnglishExplanation: 'Subordinate evidence selected a candidate.', failClosedReason: null,
  policyVersion: 'legacy-v1', modelVersions: {},
});

test('a legacy/new-risk receipt can never select candidate, action, or quantity without canonical authority', () => {
  const resolved = resolveCanonicalDecisionAuthority(null, receipt());
  assert.equal(resolved.selectedCandidateRef, null);
  assert.equal(resolved.actionCode, 'SYSTEM_HOLD');
  assert.equal(resolved.quantity, 0);
  assert.equal(resolved.strategyBranch, null);
  assert.deepEqual(resolved.reasonCodes, ['CANONICAL_DECISION_AUTHORITY_UNAVAILABLE', 'SELECTION_AUTHORITY_STRUCTURAL_SAFE_FALLBACK']);
  assert.equal(resolved.subordinateReceipt.selectedCandidateId, 'LEGACY-CANDIDATE');
  assert.equal(resolved.selectionAuthorityBoundary.activeMode, 'STRUCTURAL_SAFE_FALLBACK');
  assert.equal(resolved.selectionAuthorityBoundary.promotedModeAvailable, false);
});

test('the canonical frontier is the only selection authority when legacy evidence disagrees', () => {
  const frontier = {
    selectedCandidateId: 'CANONICAL-CANDIDATE', primaryAction: 'OPEN_CSP', selectedQuantity: 1,
    selectedBranch: 'THETA_CONVENTIONAL', decisionAuthorityVersion: 'theta-canonical-decision-authority-v1',
    globalWaitEarned: false, globalWaitReasons: [],
  } as unknown as CanonicalStrategyFrontier;
  const resolved = resolveCanonicalDecisionAuthority(frontier, receipt());
  assert.equal(resolved.selectedCandidateRef, 'CANONICAL-CANDIDATE');
  assert.equal(resolved.actionCode, 'OPEN_CSP');
  assert.equal(resolved.quantity, 1);
  assert.equal(resolved.strategyBranch, 'THETA_CONVENTIONAL');
  assert.deepEqual(resolved.reasonCodes, ['CANONICAL_STRUCTURAL_SELECTION', 'SELECTION_AUTHORITY_STRUCTURAL_SAFE_FALLBACK']);
});
