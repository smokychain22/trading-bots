import assert from 'node:assert/strict';
import test from 'node:test';
import {
  RESEARCH_BLOCKER_REGISTRY, assertNoOpenClaudeSolvableBlockers, listBlockersByClass,
} from '../src/research/research-blocker-registry.js';

test('CORE CLAIM (directive completion rule): no CODE_SOLVABLE_CLAUDE blocker remains open in the real registry', () => {
  assert.doesNotThrow(() => assertNoOpenClaudeSolvableBlockers(RESEARCH_BLOCKER_REGISTRY));
});

test('the assertion actually detects a violation when one exists (adversarial, synthetic registry)', () => {
  const first = RESEARCH_BLOCKER_REGISTRY[0] as (typeof RESEARCH_BLOCKER_REGISTRY)[number];
  const withAnOpenOne = [...RESEARCH_BLOCKER_REGISTRY, {
    ...first, issueId: 'SYNTHETIC-OPEN-BLOCKER', blockerClass: 'CODE_SOLVABLE_CLAUDE' as const, resolvedAt: null,
  }];
  assert.throws(() => assertNoOpenClaudeSolvableBlockers(withAnOpenOne), /RESEARCH_BLOCKER_REGISTRY_OPEN_CLAUDE_SOLVABLE/);
});

test('every real, still-open blocker is genuinely external-class (Codex/data/owner/provider), never a deferred code task', () => {
  const open = RESEARCH_BLOCKER_REGISTRY.filter((b) => b.resolvedAt === null);
  for (const blocker of open) {
    assert.notEqual(blocker.blockerClass, 'CODE_SOLVABLE_CLAUDE', `${blocker.issueId} is open but code-solvable`);
  }
});

test('listBlockersByClass filters correctly', () => {
  const codexOwned = listBlockersByClass('CODE_SOLVABLE_CODEX');
  assert.ok(codexOwned.every((b) => b.blockerClass === 'CODE_SOLVABLE_CODEX'));
  assert.ok(codexOwned.length >= 1);
});
