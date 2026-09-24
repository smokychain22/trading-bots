import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { canonicalFrontierResearchBatch } from '../src/storage/canonical-frontier-local-archive.js';
import { LocalResearchHistorySpool } from '../src/storage/local-research-history-spool.js';
import {
  canonicalStrategyFrontierContentHash,
  type CanonicalStrategyFrontier,
} from '../src/theta/canonical-strategy-frontier.js';

function frontier(): CanonicalStrategyFrontier {
  const candidate = {
    candidateId: 'THETA_CONVENTIONAL:SPY261016P00680000', branch: 'THETA_CONVENTIONAL',
    action: 'OPEN_CSP', underlying: 'SPY', legs: [], dte: 21, delta: -0.2, moneyness: -0.03,
    spreadPct: 0.04, liquidity: { volume: 1_000, openInterest: 4_000 },
    economics: { premiumPerShare: 2, grossPremium: 200, collateral: 68_000, maxProfit: 200,
      maxLoss: null, breakEven: 678, downsideCushion: 0.03, retainedUpside: null,
      callAwayProceeds: null, wholeChainPnlAtCallAway: null, capitalDayYield: 0.0001,
      expectedAfterCostEv: null },
    assignmentCapacityQty: 1, aegisState: 'ALLOW_FULL', hardBlockers: [], softEvidence: [],
    unknownEvidence: ['EV_MODEL_NOT_EMPIRICALLY_READY'], structurallyFeasible: true, riskFeasible: true,
    sizing: { quantity: 1, bindingConstraint: 'RISK_BUDGET', reasons: ['STRUCTURAL_SIZING_COMPUTED'] },
    paretoRank: 1, dominatedBy: [], executionAuthorized: false,
  } as const;
  const branch = {
    branch: 'THETA_CONVENTIONAL', strategyVersion: 'theta-q-v1', status: 'SHADOW', applicable: true,
    evaluated: true, routeReasons: [], evaluationState: 'EVALUATED', candidateCount: 1,
    mechanicallyRejected: 0, enumerationTruncated: false, hardVetoed: 0, softRanked: 1,
    dataInsufficient: 0, candidates: [candidate], bestCandidateId: candidate.candidateId,
    secondBestCandidateId: null, bestRejectedCandidateId: null, empiricalEconomicsReady: false,
    executionAuthorized: false,
  } as const;
  const base: Omit<CanonicalStrategyFrontier, 'contentHash'> = {
    contractVersion: 'theta-canonical-strategy-frontier-v1', snapshotId: 'snapshot-1',
    timestamp: '2026-09-25T14:30:00.000Z', strategyVersion: 'theta-shadow-once-v1',
    decisionAuthorityVersion: 'theta-canonical-decision-authority-v1', branches: [branch],
    branchesConsidered: ['THETA_CONVENTIONAL'], branchesEvaluated: ['THETA_CONVENTIONAL'],
    selectedBranch: 'THETA_CONVENTIONAL', selectedCandidateId: candidate.candidateId,
    primaryAction: 'OPEN_CSP', selectedQuantity: 1, empiricalUtilityState: 'UNKNOWN_NOT_YET_CALIBRATED',
    secondBestCandidateId: null, nearMissCandidateId: null, bestRejectedCandidateId: null,
    globalWaitEarned: false, globalWaitReasons: [], empiricalEconomicsReady: false,
    executionAuthorized: false, optionomicsContext: {},
    definedRiskLockedPlan: { state: 'BLOCKED_INVALID_FINALIST', plan: null,
      reasons: ['NO_DEFINED_RISK_FINALIST'] },
  };
  return { ...base, contentHash: canonicalStrategyFrontierContentHash(base) };
}

test('verified canonical frontier projects into an immutable local research batch', () => {
  const value = frontier();
  const batch = canonicalFrontierResearchBatch(value, {
    frontier_id: '11111111-1111-4111-8111-111111111111',
    fusion_snapshot_id: '22222222-2222-4222-8222-222222222222',
    observed_at: value.timestamp,
    content_hash: value.contentHash,
  }, 'a'.repeat(40));
  assert.equal(batch.rowCount, 1);
  const root = mkdtempSync(join(tmpdir(), 'theta-frontier-archive-'));
  const spool = new LocalResearchHistorySpool(join(root, 'research.sqlite'));
  try {
    const receipt = spool.append(batch.receiptInput);
    assert.equal(receipt.rowCount, 1);
    assert.equal(receipt.brokerAuthority, false);
    assert.deepEqual(spool.verify(), { valid: true, checked: 1, invalidBatchIds: [] });
  } finally {
    spool.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('tampered frontier content cannot enter the local archive', () => {
  const value = frontier();
  const tampered = { ...value, selectedQuantity: 2 };
  assert.throws(() => canonicalFrontierResearchBatch(tampered, {
    frontier_id: '11111111-1111-4111-8111-111111111111',
    fusion_snapshot_id: '22222222-2222-4222-8222-222222222222',
    observed_at: value.timestamp,
    content_hash: value.contentHash,
  }, 'a'.repeat(40)), /CONTENT_HASH_INVALID/);
});

test('frontier hash is reproducible after JSON persistence removes undefined fields', () => {
  const base = frontier();
  const persistedShape = JSON.parse(JSON.stringify({
    ...base,
    optionomicsContext: { nested: { omitted: undefined, retained: null } },
  })) as Omit<CanonicalStrategyFrontier, 'contentHash'>;
  const hash = canonicalStrategyFrontierContentHash({
    ...base,
    optionomicsContext: { nested: { omitted: undefined, retained: null } },
  } as Omit<CanonicalStrategyFrontier, 'contentHash'>);
  assert.equal(canonicalStrategyFrontierContentHash(persistedShape), hash);
});
