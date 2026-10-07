import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateDManagementShadow, type DManagementResearchPolicy, type DManagementSnapshot } from '../src/theta/management-economics/d-management-economics.js';

const snap = (over: Partial<DManagementSnapshot> = {}): DManagementSnapshot => ({
  positionId: 'd-95-90', observedAt: '2026-10-07T17:00:00Z', multiplier: 100, quantity: 1, entryNetCreditPerShare: 1.0,
  shortLeg: { strike: 95, bid: 1.0, ask: 1.1, delta: null }, longLeg: { strike: 90, bid: 0.4, ask: 0.45, delta: null },
  dte: 20, spot: 100, iv: 0.3, eventInWindow: false, brokerShortContracts: 1, brokerLongContracts: 1, ...over,
});
const policy = (over: Partial<DManagementResearchPolicy> = {}): DManagementResearchPolicy => ({
  policyVersion: 'research-grid-test', profitCaptureTarget: 0.5, dteExit: 5, maxLossApproachFraction: 0.5, shortStrikeThreatBuffer: 0.01,
  maxSlippageFractionOfWidth: 0.1, minRemainingRewardToRemainingMaxLoss: null, closeOnEventInWindow: false, ...over,
});

test('whole-spread economics: width, max profit/loss, both-leg close debit and slippage', () => {
  const r = evaluateDManagementShadow(snap(), policy());
  assert.deepEqual([r.metrics.widthUsd, r.metrics.maxProfitUsd, r.metrics.maxLossUsd], [500, 100, 400]);
  assert.equal(r.metrics.closeDebitUsd, 70); // short ask 1.10 - long bid 0.40
  assert.equal(r.metrics.capturedFraction, 0.3);
  assert.equal(r.metrics.bothLegSlippageUsd, 7.5);
  assert.ok((r.metrics.spreadDelta as number) > 0, 'a bull put spread is net long delta');
  assert.equal(r.recommended, 'HOLD');
  assert.equal(r.authority, 'SHADOW_RESEARCH_NO_EXECUTION');
});

test('take profit by credit capture or remaining reward vs remaining max loss; DTE exit closes the package', () => {
  assert.equal(evaluateDManagementShadow(snap({ shortLeg: { strike: 95, bid: 0.3, ask: 0.35, delta: null } }), policy()).recommended, 'TAKE_PROFIT');
  const dyn = evaluateDManagementShadow(snap({ shortLeg: { strike: 95, bid: 0.55, ask: 0.6, delta: null } }),
    policy({ profitCaptureTarget: null, minRemainingRewardToRemainingMaxLoss: 0.05 }));
  assert.equal(dyn.recommended, 'TAKE_PROFIT');
  assert.equal(evaluateDManagementShadow(snap({ dte: 3 }), policy()).recommended, 'FULL_CLOSE');
});

test('risk close on max-loss approach, short-strike threat and liquidity widening -- always both legs', () => {
  const threat = evaluateDManagementShadow(snap({ spot: 95.5, shortLeg: { strike: 95, bid: 2.3, ask: 2.4, delta: null } }), policy());
  assert.equal(threat.recommended, 'RISK_CLOSE');
  assert.ok(threat.reasons.includes('SHORT_STRIKE_THREATENED') && threat.reasons.includes('CLOSE_BOTH_LEGS_AS_ONE_PACKAGE'));
  const loss = evaluateDManagementShadow(snap({ shortLeg: { strike: 95, bid: 3.5, ask: 3.6, delta: null } }), policy());
  assert.ok(loss.reasons.includes('MAX_LOSS_APPROACH'));
  const wide = evaluateDManagementShadow(snap({ longLeg: { strike: 90, bid: 0.1, ask: 1.2, delta: null } }), policy());
  assert.ok(wide.reasons.includes('LIQUIDITY_WIDENED'));
});

test('asymmetric or unreconciled broker legs never produce an isolated short-leg action', () => {
  const missingLong = evaluateDManagementShadow(snap({ brokerLongContracts: 0 }), policy());
  assert.equal(missingLong.recommended, 'ASYMMETRIC_EMERGENCY_REVIEW');
  assert.ok(missingLong.reasons.includes('LONG_LEG_ABSENT_SHORT_EXPOSURE_UNDEFINED_RISK'));
  assert.equal(evaluateDManagementShadow(snap({ brokerShortContracts: null }), policy()).recommended, 'RECONCILE_REQUIRED');
});

test('expiry payoff is exact across the three regions and flags pin risk between strikes', () => {
  const at = (spot: number) => evaluateDManagementShadow(snap({ dte: 0, spot }), policy());
  assert.equal(at(100).metrics.expiryPnlUsd, 100);
  assert.equal(at(93).metrics.expiryPnlUsd, -100);
  assert.equal(at(80).metrics.expiryPnlUsd, -400);
  assert.equal(at(93).metrics.pinRisk, true);
  assert.equal(at(93).recommended, 'EXPIRY');
  assert.throws(() => evaluateDManagementShadow(snap({ entryNetCreditPerShare: 5 }), policy()), /CREDIT_NOT_BELOW_WIDTH/);
});
