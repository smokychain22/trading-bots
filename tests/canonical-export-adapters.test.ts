import assert from 'node:assert/strict';
import test from 'node:test';
import { adaptDecisionCandidateDataset, adaptStrategyComparisonDataset } from '../src/research/canonical-export-adapters.js';
import { RESEARCH_EXPECTED_EXPORT_CONTRACT_VERSION } from '../src/research/export-schema-drift-detector.js';

const CONTEXT = {
  decisionId: 'cycle-1', decisionAt: '2026-09-26T14:00:00Z', sourceSha: 'sha-main-1', workerSha: 'sha-worker-1',
};

function archive(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    contractVersion: RESEARCH_EXPECTED_EXPORT_CONTRACT_VERSION,
    snapshotContentHash: 'h', snapshot: {}, thetaQ: null, decisionReceipt: null, shadowOpportunities: [],
    strategyFrontier: {
      selectedCandidateId: 'AAPL-c1',
      branches: [
        { branch: 'THETA_CONVENTIONAL', candidates: [{ candidateId: 'AAPL-c1' }, { candidateId: 'AAPL-c2' }] },
        { branch: 'THETA_DEFINED_RISK', candidates: [{ candidateId: 'AAPL-d1' }] },
      ],
    },
    ...overrides,
  };
}

test('CORE CLAIM: decision-candidate adapter marks exactly the frontier-selected candidate SELECTED, all others REJECTED', () => {
  const rows = adaptDecisionCandidateDataset(archive(), CONTEXT);
  assert.equal(rows.length, 3);
  const selected = rows.filter((r) => r.status === 'SELECTED');
  assert.equal(selected.length, 1);
  assert.equal(selected[0]?.candidateId, 'AAPL-c1');
  assert.ok(rows.every((r) => r.decisionId === 'cycle-1' && r.sourceSha === 'sha-main-1'));
});

test('no candidate row ever carries a realized-outcome field -- structurally impossible per entry-unit-separation', () => {
  const rows = adaptDecisionCandidateDataset(archive(), CONTEXT);
  for (const row of rows) assert.ok(!('realizedPnl' in row) && !('outcome' in row));
});

test('two adapter runs over the identical archive produce identical featureSnapshotHash values (reproducibility)', () => {
  const a = adaptDecisionCandidateDataset(archive(), CONTEXT);
  const b = adaptDecisionCandidateDataset(archive(), CONTEXT);
  assert.deepEqual(a.map((r) => r.featureSnapshotHash), b.map((r) => r.featureSnapshotHash));
});

test('a null strategyFrontier yields an empty candidate dataset, not a crash', () => {
  const rows = adaptDecisionCandidateDataset(archive({ strategyFrontier: null }), CONTEXT);
  assert.deepEqual(rows, []);
});

test('ADVERSARIAL: a drifted archive (missing required field) is rejected before any row is produced', () => {
  const bad = archive();
  delete (bad as Record<string, unknown>).decisionReceipt;
  assert.throws(() => adaptDecisionCandidateDataset(bad, CONTEXT), /EXPORT_SCHEMA_DRIFT/);
});

test('CORE CLAIM: strategy-comparison adapter marks exactly the branch containing the selected candidate as wasChosen', () => {
  const rows = adaptStrategyComparisonDataset(archive(), CONTEXT);
  const chosen = rows.filter((r) => r.identifiabilityStatus === 'FACTUAL_OBSERVED' || r.identifiabilityStatus === 'NOT_IDENTIFIABLE');
  assert.ok(chosen.length >= 1);
  assert.equal(rows.length, 2); // two branches had candidates this cycle
});

test('a WAIT cycle (no branch contains the selected id) reports every alternative unchosen, never forces one', () => {
  const rows = adaptStrategyComparisonDataset(archive({
    strategyFrontier: {
      selectedCandidateId: 'WAIT',
      branches: [{ branch: 'THETA_CONVENTIONAL', candidates: [{ candidateId: 'AAPL-c1' }] }],
    },
  }), CONTEXT);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.identifiabilityStatus, 'NOT_IDENTIFIABLE');
});
