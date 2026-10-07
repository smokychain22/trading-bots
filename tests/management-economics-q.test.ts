import assert from 'node:assert/strict';
import test from 'node:test';
import { blackScholes } from '../src/theta/management-economics/black-scholes.js';
import { evaluateQManagementShadow, type QManagementResearchPolicy, type QManagementSnapshot } from '../src/theta/management-economics/q-management-economics.js';

test('Black-Scholes reproduces a textbook value, put-call parity and expiry intrinsic', () => {
  const call = blackScholes('CALL', 100, 100, 1, 0.2, 0);
  const put = blackScholes('PUT', 100, 100, 1, 0.2, 0);
  assert.ok(Math.abs(call.price - 7.9656) < 1e-3);
  assert.ok(Math.abs((call.price - put.price) - 0) < 1e-6);
  const r = 0.04; const c = blackScholes('CALL', 105, 100, 0.5, 0.3, r); const p = blackScholes('PUT', 105, 100, 0.5, 0.3, r);
  assert.ok(Math.abs((c.price - p.price) - (105 - 100 * Math.exp(-r * 0.5))) < 1e-6);
  assert.ok(Math.abs(c.delta - p.delta - 1) < 1e-9);
  assert.deepEqual(blackScholes('PUT', 90, 100, 0, 0.2), { price: 10, delta: -1, gamma: 0, thetaPerDay: 0, vega: 0 });
  assert.ok(put.thetaPerDay < 0 && put.gamma > 0 && put.vega > 0);
});

// XLE 57P Paper position (fill 0.28) as of the 2026-10-07 session, used as a realistic shape (not a policy claim).
const xle = (over: Partial<QManagementSnapshot> = {}): QManagementSnapshot => ({
  positionId: 'xle-57p', observedAt: '2026-10-07T17:00:00Z', strike: 57, multiplier: 100, quantity: 1, entryCreditPerShare: 0.28,
  entrySpot: 64.36, dte: 44, daysHeld: 0, spot: 63.15, closeAsk: 0.37, closeBid: 0.35, iv: 0.27, delta: null, supportLevel: null,
  eventInWindow: false, regimeChangedSinceEntry: false, redeploymentReturnPerCapitalDay: null, ...over,
});
const policy = (over: Partial<QManagementResearchPolicy> = {}): QManagementResearchPolicy => ({
  policyVersion: 'research-grid-test', profitCaptureTarget: 0.5, dteExit: 7, favorableCaptureThreshold: 0.25, adverseLossMultiple: 1,
  riskCloseDelta: 0.5, riskClosePremiumMultiple: 1.25, riskCloseCushionSigmas: 0.25, weakeningCushionSigmas: 0.75,
  minRemainingRewardToTail: null, redeploymentAdvantage: null, rollPermitted: false, ...over,
});

test('a red position with an intact thesis is HELD: premium multiple alone never closes (no close on red)', () => {
  const r = evaluateQManagementShadow(xle(), policy());
  assert.equal(r.tradeState, 'FLAT');
  assert.equal(r.thesisStatus, 'VALID');
  assert.equal(r.recommended, 'HOLD');
  const risk = r.evaluations.find((e) => e.action === 'RISK_CLOSE');
  assert.equal(risk?.triggered, false);
  assert.ok(risk?.reasons.includes('THESIS_NOT_INVALIDATED_NO_CLOSE_ON_RED_ALONE'));
  assert.equal(r.metrics.openPnlUsd, -9);
  assert.equal(r.authority, 'SHADOW_RESEARCH_NO_EXECUTION');
  assert.ok(r.unknownInputs.includes('SUPPORT_LEVEL'));
});

test('credit-capture target and the dynamic remaining-reward rule take profit; 80%+ captured with tiny residual closes', () => {
  assert.equal(evaluateQManagementShadow(xle({ closeAsk: 0.12 }), policy()).recommended, 'TAKE_PROFIT');
  const dynamic = evaluateQManagementShadow(xle({ closeAsk: 0.05, dte: 20 }), policy({ profitCaptureTarget: null, minRemainingRewardToTail: 0.05 }));
  assert.equal(dynamic.recommended, 'TAKE_PROFIT');
  assert.ok(dynamic.recommendationReasons.includes('REMAINING_REWARD_SMALL_VS_REMAINING_TAIL'));
  assert.ok((dynamic.metrics.remainingRewardToTail as number) < 0.05);
  const redeploy = evaluateQManagementShadow(xle({ closeAsk: 0.1, redeploymentReturnPerCapitalDay: 0.0005 }),
    policy({ profitCaptureTarget: null, redeploymentAdvantage: 0.0001 }));
  assert.ok(redeploy.recommendationReasons.includes('REDEPLOYMENT_RETURN_EXCEEDS_HOLD_RETURN'));
});

test('an invalidated thesis with a configured risk trigger RISK_CLOSEs; DTE exit and expiry outcomes', () => {
  const broken = evaluateQManagementShadow(xle({ spot: 56, closeAsk: 1.8, iv: 0.35 }), policy());
  assert.equal(broken.thesisStatus, 'INVALIDATED');
  assert.equal(broken.tradeState, 'ADVERSE');
  assert.equal(broken.recommended, 'RISK_CLOSE');
  assert.ok(broken.recommendationReasons.includes('SPOT_BELOW_BREAKEVEN'));
  assert.equal(evaluateQManagementShadow(xle({ dte: 5, closeAsk: 0.2 }), policy({ profitCaptureTarget: 0.9 })).recommended, 'TIME_EXIT');
  assert.equal(evaluateQManagementShadow(xle({ dte: 0, spot: 55, closeAsk: 2 }), policy()).recommended, 'ACCEPT_ASSIGNMENT');
  assert.equal(evaluateQManagementShadow(xle({ dte: 0, spot: 60, closeAsk: 0.01 }), policy()).recommended, 'LET_EXPIRE');
  const roll = evaluateQManagementShadow(xle(), policy()).evaluations.find((e) => e.action === 'ROLL');
  assert.deepEqual([roll?.feasible, roll?.reasons], [false, ['ROLL_NOT_PERMITTED_BY_Q_POLICY']]);
});

test('unknown market inputs never trigger a close and are reported', () => {
  const r = evaluateQManagementShadow(xle({ closeAsk: null, iv: null }), policy());
  assert.equal(r.recommended, 'HOLD');
  assert.equal(r.tradeState, 'UNKNOWN');
  assert.ok(r.unknownInputs.includes('CLOSE_ASK') && r.unknownInputs.includes('IV'));
  assert.equal(r.metrics.remainingRewardToTail, null);
  assert.throws(() => evaluateQManagementShadow(xle({ quantity: 0 }), policy()), /SNAPSHOT_INVALID/);
});
