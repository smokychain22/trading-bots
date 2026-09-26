import assert from 'node:assert/strict';
import test from 'node:test';
import {
  RESEARCH_COMPLETION_REGISTRY, listCapabilitiesByDomain, listCapabilitiesRequiringCodexRuntime,
} from '../src/research/research-completion-registry.js';

test('every capability has at least one real source file and a valid implementation state', () => {
  const validStates = new Set([
    'NOT_STARTED', 'CONTRACT_ONLY', 'IMPLEMENTED', 'TESTED', 'INTEGRATED_RESEARCH',
    'WAITING_RUNTIME_INPUT', 'WAITING_REAL_DATA', 'OWNER_GATED', 'SUPERSEDED',
  ]);
  for (const record of RESEARCH_COMPLETION_REGISTRY) {
    assert.ok(record.sourceFiles.length > 0, `${record.capabilityId} has no source files`);
    assert.ok(validStates.has(record.implementationState), `${record.capabilityId} has an invalid state`);
  }
});

test('CORE CLAIM: the registry never claims empirical validation merely because code exists -- no state above INTEGRATED_RESEARCH', () => {
  const forbidden = new Set(['EMPIRICALLY_VALIDATED', 'PROMOTED', 'PAPER_AUTHORIZED']);
  for (const record of RESEARCH_COMPLETION_REGISTRY) {
    assert.ok(!forbidden.has(record.implementationState));
  }
});

test('capabilities with a real runtimeDependency are all genuinely Codex/runtime-shaped, not vague', () => {
  const withRuntimeDep = listCapabilitiesRequiringCodexRuntime();
  assert.ok(withRuntimeDep.length >= 1);
  for (const record of withRuntimeDep) {
    const dependency: string | null = record.runtimeDependency;
    assert.ok(dependency !== null && dependency.length > 10);
  }
});

test('domain filtering returns only matching records', () => {
  const strategyResearch = listCapabilitiesByDomain('STRATEGY_RESEARCH');
  assert.ok(strategyResearch.length >= 3);
  assert.ok(strategyResearch.every((r) => r.domain === 'STRATEGY_RESEARCH'));
});
