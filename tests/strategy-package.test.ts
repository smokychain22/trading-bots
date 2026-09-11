import assert from 'node:assert/strict';
import test from 'node:test';
import { buildStrategyRegistry, canonicalBranchForRouterFamily, canonicalThetaStrategyRegistry,
  canonicalThetaStrategySources, resolveStrategyVersion, type ThetaStrategyVersionSource } from '../src/theta/strategy-package.js';

const sourceAt = (index: number): ThetaStrategyVersionSource => {
  const source = canonicalThetaStrategySources[index];
  if (source === undefined) throw new Error(`missing canonical source ${index}`);
  return source;
};

test('all five canonical branches are registered and execution remains disabled', () => {
  assert.equal(canonicalThetaStrategyRegistry.size, 5);
  const branches = [...canonicalThetaStrategyRegistry.values()].map((config) => config.branch);
  assert.deepEqual(new Set(branches), new Set(['THETA_CONVENTIONAL', 'THETA_HOLD_STRIKE', 'THETA_RECOVERY', 'THETA_CC', 'THETA_DEFINED_RISK']));
  assert.equal([...canonicalThetaStrategyRegistry.values()].every((config) => config.executionEnabled === false), true);
});

test('resolved versions are immutable and have stable configuration hashes', () => {
  const first = resolveStrategyVersion(sourceAt(0));
  const second = resolveStrategyVersion(sourceAt(0));
  assert.match(first.configurationHash, /^[0-9a-f]{64}$/);
  assert.equal(first.configurationHash, second.configurationHash);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.lattice), true);
});

test('duplicate strategy versions are rejected', () => {
  assert.throws(() => buildStrategyRegistry([sourceAt(0), sourceAt(0)]),
    /DUPLICATE_STRATEGY_VERSION/);
});

test('research-only strategy cannot be marked executable', () => {
  assert.throws(() => resolveStrategyVersion({ ...sourceAt(1), executionEnabled: true }),
    /research or unpromoted branches cannot execute/);
});

test('invalid lattice, unknown action, and missing risk version fail schema validation', () => {
  const base = sourceAt(0);
  assert.throws(() => resolveStrategyVersion({ ...base, lattice: { ...base.lattice, dteMin: 61, dteMax: 30 } }), /dteMin/);
  assert.throws(() => resolveStrategyVersion({ ...base, allowedActions: ['INVENTED_ACTION' as never] }), /Invalid option/);
  const missingRisk = { ...base } as Record<string, unknown>;
  delete missingRisk.riskLimitVersion;
  assert.throws(() => resolveStrategyVersion(missingRisk as never), /riskLimitVersion/);
});

test('router families map to canonical branches without making THETA_R a duplicate branch', () => {
  assert.equal(canonicalBranchForRouterFamily('THETA_Q'), 'THETA_CONVENTIONAL');
  assert.equal(canonicalBranchForRouterFamily('THETA_R', 'CSP_OPEN'), 'THETA_CONVENTIONAL');
  assert.equal(canonicalBranchForRouterFamily('THETA_R', 'CC_OPEN'), 'THETA_CC');
  assert.equal(canonicalBranchForRouterFamily('THETA_R'), null);
});
