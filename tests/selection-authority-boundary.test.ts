import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveSelectionAuthorityBoundary } from '../src/theta/selection-authority-boundary.js';

test('structural fallback remains sovereign and empirical evidence stays shadow', () => {
  const boundary = resolveSelectionAuthorityBoundary();
  assert.equal(boundary.activeMode, 'STRUCTURAL_SAFE_FALLBACK');
  assert.equal(boundary.shadowMode, 'EMPIRICAL_SHADOW');
  assert.equal(boundary.promotedModeAvailable, false);
  assert.equal(boundary.brokerAuthority, false);
});

test('even a complete-looking empirical package cannot activate a second authority', () => {
  const boundary = resolveSelectionAuthorityBoundary({ contractVersion: 'wrong' });
  assert.equal(boundary.activeMode, 'STRUCTURAL_SAFE_FALLBACK');
  assert.ok(boundary.blockers.includes('PROMOTION_RECEIPT_INVALID'));
});
