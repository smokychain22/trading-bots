import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyDependencyCallsite, relationReferenceMode } from '../src/storage/postgres-dependency-audit.js';

test('static SQL reference detection distinguishes reads and writes', () => {
  assert.equal(relationReferenceMode('SELECT * FROM trade.decision', 'trade.decision'), 'READ');
  assert.equal(relationReferenceMode('INSERT INTO trade.decision(id) VALUES(1)', 'trade.decision'), 'WRITE');
  assert.equal(relationReferenceMode('nothing relevant', 'trade.decision'), null);
});

test('intentional safety, persistence, and execution dependencies stay separately classified', () => {
  assert.equal(classifyDependencyCallsite('src/theta/aegis-alpaca-iv-stress.ts', 'READ', 'RESEARCH_HISTORY'), 'SAFETY_REQUIRED');
  assert.equal(classifyDependencyCallsite('src/theta/postgres-theta-cycle-store.ts', 'WRITE', 'RESEARCH_HISTORY'), 'PERSISTENCE_ONLY');
  assert.equal(classifyDependencyCallsite('src/execution/postgres-plan-store.ts', 'READ_WRITE', 'CANONICAL_TRADING_STATE'), 'SAFETY_REQUIRED');
});
