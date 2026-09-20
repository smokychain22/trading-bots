import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('production cycle has no numeric broker quantity fixture', () => {
  const cycle = readFileSync(new URL('../src/theta/theta-shadow-cycle.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(cycle, /brokerAllowedQty\s*:\s*\d+/);
  assert.match(cycle, /deriveCandidateCapacityAssessment/);
  assert.match(cycle, /aegisNewRiskStateByCandidateId/);
});

test('canonical persistence fails closed instead of selecting from the subordinate receipt', () => {
  const store = readFileSync(new URL('../src/theta/postgres-theta-cycle-store.ts', import.meta.url), 'utf8');
  assert.match(store, /resolveCanonicalDecisionAuthority/);
  assert.doesNotMatch(store, /authority\?\.selectedCandidateId\s*\?\?/);
  assert.doesNotMatch(store, /authority\?\.selectedQuantity\s*\?\?/);
});
