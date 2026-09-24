import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildDefinedRiskLockedPlan, classifyAlpacaMultiLegSupport,
} from '../src/research/defined-risk-locked-plan.js';
import type { CanonicalFrontierCandidate } from '../src/theta/canonical-strategy-frontier.js';
import { masterPaperActionPlanSchema } from '../src/execution/master-paper-action-handoff.js';

const DECISION = '2026-09-25T14:30:00.000Z';

function candidate(overrides: Partial<CanonicalFrontierCandidate> = {}): CanonicalFrontierCandidate {
  return {
    candidateId: 'THETA_DEFINED_RISK:SPY261016P00680000:SPY261016P00675000',
    branch: 'THETA_DEFINED_RISK', action: 'OPEN_DEFINED_RISK', underlying: 'SPY',
    legs: [
      { positionIntent: 'SELL_TO_OPEN', optionSymbol: 'SPY261016P00680000', occSymbol: 'SPY261016P00680000',
        optionType: 'PUT', strike: 680, expiration: '2026-10-16', multiplier: 100,
        bid: 4.2, ask: 4.3, quoteTimestamp: '2026-09-25T14:29:55.000Z' },
      { positionIntent: 'BUY_TO_OPEN', optionSymbol: 'SPY261016P00675000', occSymbol: 'SPY261016P00675000',
        optionType: 'PUT', strike: 675, expiration: '2026-10-16', multiplier: 100,
        bid: 2.2, ask: 2.3, quoteTimestamp: '2026-09-25T14:29:56.000Z' },
    ],
    dte: 21, delta: -0.28, moneyness: -0.03, spreadPct: 0.06,
    liquidity: { volume: 500, openInterest: 2_000 },
    economics: {
      premiumPerShare: 1.9, grossPremium: 190, collateral: 310, maxProfit: 190, maxLoss: 310,
      breakEven: 678.1, downsideCushion: null, retainedUpside: null, callAwayProceeds: null,
      wholeChainPnlAtCallAway: null, capitalDayYield: 190 / (310 * 21), expectedAfterCostEv: null,
    },
    assignmentCapacityQty: null, aegisState: 'DEFINED_RISK_ONLY', hardBlockers: [],
    softEvidence: ['EVENT_STATE:CLEAR'], unknownEvidence: ['EV_MODEL_NOT_EMPIRICALLY_READY'],
    structurallyFeasible: true, riskFeasible: true,
    sizing: { quantity: 2, bindingConstraint: 'RISK_BUDGET', reasons: ['BOUNDED_MAX_LOSS'] },
    paretoRank: 1, dominatedBy: [], executionAuthorized: false,
    ...overrides,
  };
}

function build(value: CanonicalFrontierCandidate = candidate()) {
  return buildDefinedRiskLockedPlan({
    candidate: value, snapshotId: 'snapshot-1', decisionCycleId: 'cycle-1', decisionAsOf: DECISION,
    strategyVersion: '1.0.0-research', sourceEvidenceIds: ['quote-short', 'quote-long', 'aegis-1'],
    brokerMultiLegSupport: 'UNKNOWN',
  });
}

test('builds an exact two-leg, locked and non-submittable Defined Risk plan', () => {
  const result = build();
  assert.equal(result.state, 'READY_LOCKED');
  assert.equal(result.plan?.legs.length, 2);
  assert.equal(result.plan?.legs[0].side, 'SELL_TO_OPEN');
  assert.equal(result.plan?.legs[1].side, 'BUY_TO_OPEN');
  assert.equal(result.plan?.netLimitCreditPerShare, 1.9);
  assert.equal(result.plan?.maxLoss, 620);
  assert.equal(result.plan?.brokerMultiLegSupport, 'UNKNOWN');
  assert.equal(result.plan?.brokerAuthority, false);
  assert.equal(result.plan?.submissionAllowed, false);
  assert.equal(masterPaperActionPlanSchema.safeParse(result.plan).success, false,
    'research D plan must remain structurally rejected by the broker-capable handoff');
});

test('fails closed when a leg quote is crossed or observed after the decision', () => {
  const value = candidate({ legs: [
    { ...(candidate().legs[0] as CanonicalFrontierCandidate['legs'][number]), bid: 5, ask: 4 },
    { ...(candidate().legs[1] as CanonicalFrontierCandidate['legs'][number]), quoteTimestamp: '2026-09-25T14:31:00.000Z' },
  ] });
  const result = build(value);
  assert.equal(result.state, 'BLOCKED_INVALID_FINALIST');
  assert.ok(result.reasons.includes('LEG_QUOTE_CROSSED'));
  assert.ok(result.reasons.includes('LEG_QUOTE_AFTER_DECISION'));
  assert.equal(result.plan, null);
});

test('fails closed on mismatched expiry, multiplier, or non-positive quantity', () => {
  const value = candidate({
    legs: [candidate().legs[0] as CanonicalFrontierCandidate['legs'][number], {
      ...(candidate().legs[1] as CanonicalFrontierCandidate['legs'][number]),
      expiration: '2026-10-23', multiplier: 10,
    }],
    sizing: { quantity: 0, bindingConstraint: 'RISK_BUDGET', reasons: ['NO_CAPACITY'] },
  });
  const result = build(value);
  assert.ok(result.reasons.includes('LEG_EXPIRATION_MISMATCH'));
  assert.ok(result.reasons.includes('LEG_MULTIPLIER_MISMATCH'));
  assert.ok(result.reasons.includes('POSITIVE_INTEGER_QUANTITY_REQUIRED'));
});

test('fails closed when source evidence identity is absent', () => {
  const result = buildDefinedRiskLockedPlan({
    candidate: candidate(), snapshotId: 'snapshot-1', decisionCycleId: 'cycle-1', decisionAsOf: DECISION,
    strategyVersion: '1.0.0-research', sourceEvidenceIds: [], brokerMultiLegSupport: 'UNKNOWN',
  });
  assert.deepEqual(result.reasons, ['SOURCE_EVIDENCE_ID_MISSING']);
});

test('plan identity and content hash are deterministic under evidence-id ordering', () => {
  const first = buildDefinedRiskLockedPlan({
    candidate: candidate(), snapshotId: 'snapshot-1', decisionCycleId: 'cycle-1', decisionAsOf: DECISION,
    strategyVersion: '1.0.0-research', sourceEvidenceIds: ['b', 'a'], brokerMultiLegSupport: 'UNKNOWN',
  });
  const second = buildDefinedRiskLockedPlan({
    candidate: candidate(), snapshotId: 'snapshot-1', decisionCycleId: 'cycle-1', decisionAsOf: DECISION,
    strategyVersion: '1.0.0-research', sourceEvidenceIds: ['a', 'b'], brokerMultiLegSupport: 'UNKNOWN',
  });
  assert.equal(first.plan?.contentHash, second.plan?.contentHash);
  assert.equal(first.plan?.planId, second.plan?.planId);
});

test('Alpaca Level 3 account evidence classifies atomic MLeg support without granting authority', () => {
  assert.equal(classifyAlpacaMultiLegSupport({ optionsTradingLevel: 3, optionsApprovedLevel: 3 }),
    'ATOMIC_MULTI_LEG_SUPPORTED');
  assert.equal(classifyAlpacaMultiLegSupport({ optionsTradingLevel: 2, optionsApprovedLevel: 3 }),
    'PROVIDER_LIMITED');
  assert.equal(classifyAlpacaMultiLegSupport({ optionsTradingLevel: null, optionsApprovedLevel: null }), 'UNKNOWN');
});
