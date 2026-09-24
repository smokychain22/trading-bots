import assert from 'node:assert/strict';
import test from 'node:test';
import { parseOwnershipEvaluationResponse } from '../src/theta/ownership-contract.js';
import { assessPaperBootstrapOwnershipEvidence, assessPaperEntryBootstrap, classifyAlpacaBrokerEnvironment, paperEntryBootstrapPolicyVersion } from '../src/theta/paper-entry-bootstrap.js';

const eligibleInput = () => ({
  enabled: true,
  runtimeMode: 'MASTER_THETA_PAPER',
  brokerEnvironment: 'PAPER' as const,
  accountStatus: 'ACTIVE',
  reconciliationQuality: 'GOOD' as const,
  localOnlyIntentCount: 0,
  externalOrUnknownOrderCount: 0,
  marketOpen: true,
  calendarSessionConfirmed: true,
  followerExecutionEnabled: false,
  liveMoneyAuthorized: false,
});

test('Paper entry bootstrap is explicit, uncalibrated, and never execution authority', () => {
  const assessment = assessPaperEntryBootstrap(eligibleInput());
  assert.equal(assessment.state, 'ELIGIBLE_UNCALIBRATED');
  assert.equal(assessment.policyVersion, paperEntryBootstrapPolicyVersion);
  assert.equal(assessment.eligibilityTier, 'PAPER_ENTRY_BOOTSTRAP_UNCALIBRATED');
  assert.equal(assessment.executionAuthorized, false);
  assert.deepEqual(assessment.hardBlockers, []);
});

test('Paper entry bootstrap fails closed on broker drift and unknown session', () => {
  const assessment = assessPaperEntryBootstrap({
    ...eligibleInput(), localOnlyIntentCount: 1, marketOpen: null, calendarSessionConfirmed: false,
  });
  assert.equal(assessment.state, 'BLOCKED_HARD_SAFETY');
  assert.ok(assessment.hardBlockers.includes('LOCAL_ONLY_ORDER_INTENT_PRESENT'));
  assert.ok(assessment.hardBlockers.includes('OPTION_MARKET_SESSION_UNCONFIRMED'));
});

test('Paper entry bootstrap rejects live brokers, follower execution, and live money', () => {
  const assessment = assessPaperEntryBootstrap({
    ...eligibleInput(), brokerEnvironment: 'LIVE', followerExecutionEnabled: true, liveMoneyAuthorized: true,
  });
  assert.equal(assessment.state, 'BLOCKED_HARD_SAFETY');
  assert.ok(assessment.hardBlockers.includes('PAPER_BROKER_REQUIRED'));
  assert.ok(assessment.hardBlockers.includes('FOLLOWER_EXECUTION_MUST_REMAIN_LOCKED'));
  assert.ok(assessment.hardBlockers.includes('LIVE_MONEY_MUST_REMAIN_DISABLED'));
});

test('disabled bootstrap cannot silently become eligible', () => {
  const assessment = assessPaperEntryBootstrap({ ...eligibleInput(), enabled: false });
  assert.equal(assessment.state, 'DISABLED');
  assert.equal(assessment.eligibilityTier, null);
});

test('broker environment classification requires the exact secure Alpaca Paper root',()=>{
  assert.equal(classifyAlpacaBrokerEnvironment('https://paper-api.alpaca.markets'),'PAPER');
  assert.equal(classifyAlpacaBrokerEnvironment('https://api.alpaca.markets'),'LIVE');
  assert.equal(classifyAlpacaBrokerEnvironment('https://paper-api.alpaca.markets/v2'),'UNKNOWN');
  assert.equal(classifyAlpacaBrokerEnvironment('not-a-url'),'UNKNOWN');
});

const ownership = (unknownComponents: readonly ('RecoveryQuality' | 'TailQuality' | 'EventAdjustment')[] | null, thesisInvalidated = false) =>
  parseOwnershipEvaluationResponse({
    contractVersion: 'theta-ownership-runtime-v1', snapshotId: 'snapshot', underlyingSymbol: 'SYN',
    timestamp: '2026-09-20T10:00:00.000Z', policyVersion: 'ownership-v1',
    ownability: unknownComponents === null ? 0.9 ** 5 : null, thesisInvalidated,
    components: ['LiquidityQuality', 'StructuralQuality', 'RecoveryQuality', 'TailQuality', 'EventAdjustment'].map((name) => ({
      name, value: unknownComponents?.includes(name as 'RecoveryQuality' | 'TailQuality' | 'EventAdjustment') ? null : 0.9, status: 'TEST',
      reasons: unknownComponents?.includes(name as 'RecoveryQuality' | 'TailQuality' | 'EventAdjustment') ? [{
        code: name === 'RecoveryQuality' ? 'RECOVERY_HISTORY_UNKNOWN'
          : name === 'EventAdjustment' ? 'EVENT_DISTANCE_UNKNOWN' : 'TAIL_UNKNOWN', polarity: -1, detail: 'test unknown',
      }] : [{ code: `${name.toUpperCase()}_KNOWN`, polarity: 1, detail: 'test known' }],
    })), reasons: thesisInvalidated ? [{ code: 'THESIS_INVALIDATED', polarity: -1, detail: 'invalidated' }] : [],
  });

test('component bootstrap permits named recovery and event-model gaps without inventing a drawdown probability', () => {
  const result = assessPaperBootstrapOwnershipEvidence(assessPaperEntryBootstrap(eligibleInput()),
    ownership(['RecoveryQuality','EventAdjustment']), null);
  assert.equal(result.eligible, true);
  assert.deepEqual(result.allowedUnknownComponents, ['EventAdjustment','RecoveryQuality']);
  assert.deepEqual(result.reasonCodes, ['EVENT_DISTANCE_UNKNOWN','RECOVERY_HISTORY_UNKNOWN','SEVERE_DRAWDOWN_MODEL_NOT_PROMOTED']);
});

test('component bootstrap rejects unrelated UNKNOWN, invalid probability, and thesis invalidation', () => {
  assert.equal(assessPaperBootstrapOwnershipEvidence(assessPaperEntryBootstrap(eligibleInput()), ownership(['TailQuality']), 0.08).eligible, false);
  assert.equal(assessPaperBootstrapOwnershipEvidence(assessPaperEntryBootstrap(eligibleInput()), ownership(['RecoveryQuality']), 2).eligible, false);
  assert.equal(assessPaperBootstrapOwnershipEvidence(assessPaperEntryBootstrap(eligibleInput()), ownership(['RecoveryQuality'], true), 0.08).eligible, false);
});
