import assert from 'node:assert/strict';
import test from 'node:test';
import { assessPaperEntryBootstrap, classifyAlpacaBrokerEnvironment, paperEntryBootstrapPolicyVersion } from '../src/theta/paper-entry-bootstrap.js';

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
