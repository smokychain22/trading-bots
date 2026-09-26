import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

// Phase 1 Zero-Unknown Reclosure Pass 3 source-final (item 15): a
// lightweight static test so THETA_BRAIN_AUTHORITY_V1.md cannot silently
// lose a required concern row or regain a stale/contradictory statement
// without a test failing loudly.
const docPath = fileURLToPath(new URL('../docs/research/THETA_BRAIN_AUTHORITY_V1.md', import.meta.url));
const doc = readFileSync(docPath, 'utf8');

const requiredConcernLabels = [
  'Q ENUMERATION', 'H ENUMERATION', 'D ENUMERATION', 'A/RECOVERY ENUMERATION', 'C/COVERED-CALL ENUMERATION',
  'AEGIS', 'SIZING', 'FINAL ENTRY SELECTION', 'MANAGEMENT CANDIDATE', 'MANAGEMENT ACTION',
  'EXECUTION AUTHORIZATION', 'PERSISTENCE/HANDOFF VALIDATION', 'ACCOUNTING', 'LEARNING/EMPIRICAL',
];

test('every required Phase-1 authority concern is present in THETA_BRAIN_AUTHORITY_V1.md', () => {
  for (const label of requiredConcernLabels) {
    assert.ok(doc.includes(label), `missing required concern row: ${label}`);
  }
});

test('exactly one FINAL ENTRY SELECTION owner row exists', () => {
  const matches = doc.match(/^\|\s*FINAL ENTRY SELECTION/gm) ?? [];
  assert.equal(matches.length, 1, 'exactly one row must claim FINAL ENTRY SELECTION authority, never zero or more than one');
});

test('the document contains no stale "not broken out row-by-row" / "not yet extended to this document" deferral language', () => {
  assert.doesNotMatch(doc, /not broken out row-by-row/i);
  assert.doesNotMatch(doc, /not yet extended to this document/i);
  assert.doesNotMatch(doc, /^Not yet extended/im);
});

test('CANONICAL_ENTRY_SELECTION (the real selector) and CANONICAL_DECISION_HANDOFF_VALIDATION (persistence-time only) are never merged into one row', () => {
  assert.match(doc, /CANONICAL_ENTRY_SELECTION/);
  assert.match(doc, /CANONICAL_DECISION_HANDOFF_VALIDATION/);
  const selectionRow = doc.split('\n').find((line) => line.includes('FINAL ENTRY SELECTION'));
  assert.ok(selectionRow !== undefined && !selectionRow.includes('CANONICAL_DECISION_HANDOFF_VALIDATION'),
    'the final-selection row must not also claim the persistence-time handoff-validation function');
});
