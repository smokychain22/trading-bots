import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runBoundedResearch } from '../tools/theta-research-actions.js';
import {
  runDeterministicResearchAdapters,
  type DeterministicResearchScenario,
} from '../tools/theta-research-deterministic-adapters.js';

function deterministicScenario(): DeterministicResearchScenario {
  return JSON.parse(
    readFileSync('config/research/deterministic-scenarios.json', 'utf8'),
  ) as DeterministicResearchScenario;
}

test('deterministic adapters invoke existing Q/D and A/C modules without empirical or broker claims', () => {
  const result = runDeterministicResearchAdapters(deterministicScenario());
  assert.equal(result.evidenceClass, 'DETERMINISTIC_SCENARIO_COMPARISON');
  assert.equal(result.empirical, false);
  assert.equal(result.brokerAuthority, false);
  assert.equal(result.comparisonCount, 2);
  assert.equal(result.qd.module, 'defined-risk-vs-csp-paired-study');
  assert.equal(result.qd.readiness, 'STRUCTURAL_PAIR_READY');
  assert.equal(result.qd.identicalShortLeg, true);
  assert.equal(result.qd.identicalExpiration, true);
  assert.equal(result.ac.module, 'recovery-covered-call-experiment');
  assert.equal(result.ac.comparisonState, 'DESCRIPTIVE_NO_RANKING');
  assert.deepEqual(result.ac.actions, ['SELL_CC', 'SELL_STOCK']);
  assert.ok(!('winner' in result) && !('selectedAction' in result));
});

test('Q/D adapter rejects a labeled identity that does not preserve the primary short leg or expiration', () => {
  const shortLegMismatch = structuredClone(deterministicScenario()) as unknown as {
    qd: { primaryIdentity: { definedRiskShortLegIdentity: string } };
  };
  shortLegMismatch.qd.primaryIdentity.definedRiskShortLegIdentity = 'AAPL261022P00185000';
  assert.throws(
    () => runDeterministicResearchAdapters(shortLegMismatch as unknown as DeterministicResearchScenario),
    /Q_D_PRIMARY_SHORT_LEG_IDENTITY_MISMATCH/,
  );

  const expirationMismatch = structuredClone(deterministicScenario()) as unknown as {
    qd: { primaryIdentity: { definedRiskExpiration: string } };
  };
  expirationMismatch.qd.primaryIdentity.definedRiskExpiration = '2026-11-20';
  assert.throws(
    () => runDeterministicResearchAdapters(expirationMismatch as unknown as DeterministicResearchScenario),
    /Q_D_PRIMARY_EXPIRATION_MISMATCH/,
  );
});

test('A/C adapter delegates stage-valid action enforcement to the existing experiment contract', () => {
  const invalidStageAction = structuredClone(deterministicScenario()) as unknown as {
    ac: { experiment: { alternatives: { action: string; ccRollCost: number | null }[] } };
  };
  invalidStageAction.ac.experiment.alternatives[1]!.action = 'ROLL_CC';
  invalidStageAction.ac.experiment.alternatives[1]!.ccRollCost = 90;
  assert.throws(
    () => runDeterministicResearchAdapters(invalidStageAction as unknown as DeterministicResearchScenario),
    /RECOVERY_CC_ACTION_NOT_APPLICABLE_TO_STAGE/,
  );
});

test('empty approved manifest produces a small truthful gap receipt and no fabricated replay', async () => {
  const outputDir = mkdtempSync(join(tmpdir(), 'theta-zero-cost-research-'));
  try {
    const result = await runBoundedResearch({
      rootDir: process.cwd(),
      mode: 'research',
      targetDate: '2026-10-10',
      slotId: 'research-2026-10-10',
      sourceSha: 'bc7ffbd5c87595040d69ce165dbcded52885b893',
      policyPath: 'config/research/actions-policy.json',
      manifestPath: 'config/research/evidence-manifest.json',
      outputDir,
      now: new Date('2026-10-10T15:43:00.000Z'),
    });
    const receipt = JSON.parse(readFileSync(result.receiptPath, 'utf8'));
    assert.equal(receipt.overallStatus, 'DATA_GAP');
    assert.equal(receipt.historicalReplayStatus, 'HISTORICAL_REPLAY_NOT_RUN');
    assert.equal(receipt.manifest.entryCount, 0);
    assert.equal(receipt.authority.brokerAuthority, false);
    assert.equal(receipt.authority.orderSubmissionAvailable, false);
    assert.equal(receipt.authority.productionMutationAvailable, false);
    assert.equal(receipt.limitsObserved.comparisons, 2);
    const qd = receipt.stages.find((stage: { id: string }) => (
      stage.id === 'Q_D_DETERMINISTIC_CONTRACT_COMPOSITION'
    ));
    const ac = receipt.stages.find((stage: { id: string }) => (
      stage.id === 'A_C_DETERMINISTIC_CONTRACT_COMPOSITION'
    ));
    assert.equal(qd?.status, 'SOURCE_ALREADY_IMPLEMENTED');
    assert.ok(qd?.reasons.includes('DETERMINISTIC_SCENARIO_COMPARISON'));
    assert.equal(ac?.status, 'SOURCE_ALREADY_IMPLEMENTED');
    assert.ok(ac?.reasons.includes('NON_EMPIRICAL'));
    assert.ok(receipt.stages.some((stage: { status: string }) => stage.status === 'SOURCE_ALREADY_IMPLEMENTED'));
    assert.ok(receipt.stages.some((stage: { status: string }) => stage.status === 'DATA_GAP'));
    assert.ok(receipt.stages.some((stage: { status: string }) => stage.status === 'EMPIRICAL_GAP'));
    assert.ok(receipt.stages.some((stage: { status: string }) => stage.status === 'PAPER_AUTHORITY_GAP'));
    assert.ok(result.summary.includes('DATA_GAP'));
    assert.ok(result.summary.includes('HISTORICAL_REPLAY_NOT_RUN'));
    assert.ok(statSync(result.receiptPath).size <= 262_144);
    assert.ok(statSync(result.summaryPath).size <= 65_536);
  } finally {
    rmSync(outputDir, { recursive: true, force: true });
  }
});

test('source reuse inventory checks existing modules instead of silently duplicating them', async () => {
  const outputDir = mkdtempSync(join(tmpdir(), 'theta-source-reuse-'));
  try {
    const result = await runBoundedResearch({
      rootDir: process.cwd(),
      mode: 'daily-report',
      targetDate: '2026-10-08',
      slotId: 'daily-report-2026-10-08',
      sourceSha: 'bc7ffbd5c87595040d69ce165dbcded52885b893',
      policyPath: 'config/research/actions-policy.json',
      manifestPath: 'config/research/evidence-manifest.json',
      outputDir,
      now: new Date('2026-10-08T21:23:00.000Z'),
    });
    const receipt = result.receipt as {
      stages: readonly { id: string; status: string; reasons: readonly string[]; count: number }[];
    };
    const source = receipt.stages.find((stage) => stage.id === 'SOURCE_REUSE');
    assert.equal(source?.status, 'SOURCE_ALREADY_IMPLEMENTED');
    assert.ok((source?.count ?? 0) >= 18);
    assert.deepEqual(source?.reasons, ['REQUIRED_REUSE_CONTRACTS_PRESENT']);
  } finally {
    rmSync(outputDir, { recursive: true, force: true });
  }
});

test('repeated job inputs produce the same run identity and classifications', async () => {
  const firstDir = mkdtempSync(join(tmpdir(), 'theta-repeat-first-'));
  const secondDir = mkdtempSync(join(tmpdir(), 'theta-repeat-second-'));
  const request = {
    rootDir: process.cwd(),
    mode: 'research' as const,
    targetDate: '2026-10-10',
    slotId: 'research-2026-10-10',
    sourceSha: 'bc7ffbd5c87595040d69ce165dbcded52885b893',
    policyPath: 'config/research/actions-policy.json',
    manifestPath: 'config/research/evidence-manifest.json',
    now: new Date('2026-10-10T15:43:00.000Z'),
  };
  try {
    const first = await runBoundedResearch({ ...request, outputDir: firstDir });
    const second = await runBoundedResearch({ ...request, outputDir: secondDir });
    assert.equal(first.receipt.runId, second.receipt.runId);
    assert.equal(first.receipt.overallStatus, second.receipt.overallStatus);
    assert.deepEqual(first.receipt.stages, second.receipt.stages);
    assert.deepEqual(first.receipt.recommendations, second.receipt.recommendations);
  } finally {
    rmSync(firstDir, { recursive: true, force: true });
    rmSync(secondDir, { recursive: true, force: true });
  }
});
