import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { decisionCriticalEvidenceFields } from '../src/theta/decision-critical-evidence-registry.js';
import {
  claudeWorkPackageInventory, databaseRelationInventoryFromNames, deepSystemInventory, infrastructureInventory,
  methodInventory, summarizeDeepSystemInventory,
  validateDeepSystemInventory,
} from '../src/theta/deep-system-inventory.js';

test('deep inventory covers every mandated cardinality without duplicate or blank rows', () => {
  assert.deepEqual(validateDeepSystemInventory(), []);
  const summary = summarizeDeepSystemInventory();
  assert.equal(summary.inventoryCoverage, 'COMPLETE');
  assert.equal(summary.inventoryCoverageMeaning, 'ROW_CARDINALITY_SCHEMA_AUTHORITY_AND_SOURCE_REFERENCE_VALIDATION_ONLY');
  assert.equal(summary.byCategory.METHOD, 32);
  assert.equal(summary.byCategory.STRATEGY, 5);
  assert.equal(summary.byCategory.ACTION, 17);
  assert.equal(summary.byCategory.FEATURE, 20);
  assert.equal(summary.byCategory.HARD_RULE, 11);
  assert.equal(summary.byCategory.AEGIS_FAMILY, 12);
  assert.equal(summary.byCategory.BRAIN_LAYER, 21);
  assert.equal(summary.byCategory.PROFIT_POLICY, 17);
  assert.equal(summary.byCategory.CLAUDE_WORK_PACKAGE, 100);
  assert.equal(summary.byCategory.INFRASTRUCTURE, 20);
  assert.equal(summary.liveAuthorizedRows, 0);
  assert.equal(summary.ownerPermissionRequiredRows, 0);
});

test('deep audit denominator matches the canonical typed evidence registry', () => {
  const audit = readFileSync('docs/operations/THETA_DEEP_UNIFIED_PHASE_AUDIT_2026-09-29.md', 'utf8');
  assert.match(audit, new RegExp(`Decision-critical denominator \\| ${decisionCriticalEvidenceFields.length} typed fields`));
  assert.doesNotMatch(audit, /47[- ]field evidence registry|47 typed fields/);
});

test('database relation inventory preserves storage classification and rejects unknown placement', () => {
  const rows = databaseRelationInventoryFromNames([
    'broker.order', 'trade.candidate', 'market.option_quote_snapshot', 'unmapped.mystery',
  ]);
  assert.equal(rows.find((row) => row.id === 'broker.order')?.inputTruthClass, 'CANONICAL_TRADING_STATE');
  assert.equal(rows.find((row) => row.id === 'trade.candidate')?.inputTruthClass, 'RESEARCH_HISTORY');
  assert.equal(rows.find((row) => row.id === 'market.option_quote_snapshot')?.inputTruthClass, 'SHORT_RETENTION_OBSERVATION');
  assert.equal(rows.find((row) => row.id === 'unmapped.mystery')?.currentAuthority, 'NONE');
  assert.equal(rows.find((row) => row.id === 'unmapped.mystery')?.currentBlocker, 'storage classification missing');
  assert.equal(infrastructureInventory.length, 20);
});

test('research-only strategy actions do not inherit Paper authority from the shared action enum', async () => {
  const { actionInventory } = await import('../src/theta/deep-system-inventory.js');
  const definedRisk = actionInventory.find((row) => row.id === 'OPEN_DEFINED_RISK');
  assert.equal(definedRisk?.currentAuthority, 'RESEARCH_ONLY');
  assert.equal(definedRisk?.paperAuthority, 'NO');
  const conventional = actionInventory.find((row) => row.id === 'OPEN_CSP');
  assert.equal(conventional?.currentAuthority, 'PRODUCTION_LOCKED');
  assert.equal(conventional?.paperAuthority, 'LOCKED_PAPER_PATH');
});

test('32-method audit does not infer runtime, empirical, or broker proof from source', () => {
  assert.equal(methodInventory.length, 32);
  assert.equal(methodInventory.filter((row) => row.currentWorkerRealData).length, 0);
  assert.equal(methodInventory.filter((row) => row.empiricalStatus === 'VALIDATED').length, 0);
  assert.equal(methodInventory.filter((row) => row.realityLevel === 'L7_CURRENT_WORKER_REAL_DATA').length, 0);
  assert.equal(methodInventory.filter((row) => row.realityLevel === 'L8_EMPIRICALLY_VALIDATED').length, 0);
  assert.equal(methodInventory.filter((row) => row.realityLevel === 'L9_BROKER_AUTHORIZED').length, 0);
  const adaptive = methodInventory.find((row) => row.id === 'ADAPTIVE_ECONOMIC_STRATEGY_SWITCHING');
  assert.equal(adaptive?.realityLevel, 'L1_TYPED_CONTRACT');
  assert.equal(adaptive?.currentAuthority, 'RESEARCH_ONLY');
});

test('Claude WP audit preserves provider and empirical blockers instead of declaring all complete', () => {
  assert.equal(claudeWorkPackageInventory.length, 100);
  for (const id of ['WP13', 'WP17', 'WP26']) {
    const row = claudeWorkPackageInventory.find((candidate) => candidate.id === id);
    assert.equal(row?.realityLevel, 'L1_TYPED_CONTRACT');
    assert.equal(row?.currentBlocker, 'required data/provider absent');
  }
  for (const id of ['WP25', 'WP37', 'WP87']) {
    const row = claudeWorkPackageInventory.find((candidate) => candidate.id === id);
    assert.equal(row?.empiricalStatus, 'INSUFFICIENT_SAMPLE');
    assert.equal(row?.currentBlocker, 'insufficient independent resolved outcomes');
  }
  assert.equal(deepSystemInventory.filter((row) => row.paperAuthority === 'OWNER_PERMISSION_REQUIRED').length, 0);
  assert.equal(deepSystemInventory.find((row) => row.id === 'PAPER_CANARY_GOVERNANCE')?.paperAuthority, 'LOCKED_PAPER_PATH');
});
