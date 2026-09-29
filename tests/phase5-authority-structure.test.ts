import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { canonicalThetaStrategyRegistry, thetaHardRule } from '../src/theta/strategy-package.js';

const read = (relative: string): string => readFileSync(fileURLToPath(new URL(`../${relative}`, import.meta.url)), 'utf8');

test('all five product strategies carry the exact eleven governed hard-rule families', () => {
  const expected = new Set(thetaHardRule.options);
  assert.equal(expected.size, 11);
  assert.equal(canonicalThetaStrategyRegistry.size, 5);
  for (const strategy of canonicalThetaStrategyRegistry.values()) {
    assert.deepEqual(new Set(strategy.hardRules), expected, `${strategy.branch} hard-rule drift`);
  }
});

test('PaperOrderCoordinator is the sole source caller of broker mutation methods', () => {
  const coordinator = read('src/execution/paper-order-coordinator.ts');
  for (const operation of ['submitOrder', 'cancelOrder', 'replaceOrder']) {
    assert.match(coordinator, new RegExp(`this\\.broker\\.${operation}\\(`));
  }

  const mutationCall = /\.\s*(submitOrder|cancelOrder|replaceOrder)\s*\(/;
  const guardedSources = [
    'src/execution/master-paper-execution-orchestrator.ts',
    'src/execution/master-paper-action-handoff.ts',
    'src/theta/autonomous-runtime.ts',
    'src/theta/new-risk-orchestrator.ts',
    'src/theta/canonical-strategy-frontier.ts',
  ];
  for (const source of guardedSources) {
    assert.doesNotMatch(read(source), mutationCall, `${source} bypasses the canonical execution state machine`);
  }
});

test('the sovereign decision quantity comes from the canonical frontier, never the subordinate receipt', () => {
  const authority = read('src/theta/canonical-decision-authority.ts');
  assert.match(authority, /quantity:\s*frontier\.selectedQuantity/);
  assert.doesNotMatch(authority, /quantity:\s*subordinateReceipt\.quantity/);

  const frontier = read('src/theta/canonical-strategy-frontier.ts');
  assert.equal((frontier.match(/function\s+structuralSizing\s*\(/g) ?? []).length, 1);
  assert.doesNotMatch(frontier, /Math\.max\(\s*1\s*,\s*(?:quantity|qty)/);
});
