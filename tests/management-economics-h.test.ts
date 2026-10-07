import assert from 'node:assert/strict';
import test from 'node:test';
import { computeHFeatures, evaluateHShadow, type HResearchPolicy, type HSnapshot } from '../src/theta/management-economics/h-early-warning.js';

const hourly = (closes: readonly number[]) => closes.map((close, i) => ({ at: new Date(Date.UTC(2026, 9, 7, 14 + i)).toISOString(), close }));
const snap = (over: Partial<HSnapshot> = {}): HSnapshot => ({
  positionId: 'h-1', observedAt: '2026-10-07T19:00:00.000Z', strike: 95, multiplier: 100, quantity: 1, entryCreditPerShare: 0.5,
  hoursToExpiry: 48, spot: 100, iv: 0.25, closeAsk: 0.3, closeBid: 0.28, recentBars: hourly([100.2, 100.1, 100, 100.1, 100]),
  barsPerYear: 252 * 6.5, previous: { at: '2026-10-07T17:00:00.000Z', spot: 100.5, deltaAbs: 0.05 }, nextEventAt: null, eventKnown: true, ...over,
});
const policy = (over: Partial<HResearchPolicy> = {}): HResearchPolicy => ({
  policyVersion: 'research-grid-test', profitCaptureTarget: 0.6, timeExitHours: 6, maxDeltaAbs: 0.4, deltaAccelerationPerHour: 0.05,
  moveSpeedSigma: 2, shortRvToIv: 1.5, minDistanceToStrike: 0.02, maxSpreadPct: 0.25, riskCloseWarningCount: 2, ...over,
});

test('H features: gamma, theta/day, distance and its velocity, short RV, move speed; unknowns typed', () => {
  const f = computeHFeatures(snap());
  assert.equal(f.H_GAMMA.state, 'KNOWN');
  assert.ok(f.H_THETA_PER_DAY.state === 'KNOWN' && f.H_THETA_PER_DAY.value > 0, 'short put collects theta');
  assert.ok(f.H_DISTANCE_TO_STRIKE.state === 'KNOWN' && Math.abs(f.H_DISTANCE_TO_STRIKE.value - 0.05) < 1e-9);
  assert.ok(f.H_DISTANCE_TO_STRIKE_VELOCITY.state === 'KNOWN' && f.H_DISTANCE_TO_STRIKE_VELOCITY.value < 0, 'moving toward strike');
  assert.equal(f.H_SHORT_RV.state, 'KNOWN');
  assert.equal(f.H_EVENT_PROXIMITY.state, 'NOT_APPLICABLE');
  const blind = computeHFeatures(snap({ iv: null, previous: null, recentBars: [], eventKnown: false }));
  assert.deepEqual([blind.H_GAMMA.state, blind.H_DELTA_ACCELERATION.state, blind.H_MOVE_SPEED.state, blind.H_EVENT_PROXIMITY.state],
    ['UNKNOWN', 'UNKNOWN', 'UNKNOWN', 'UNKNOWN']);
});

test('H gamma near the strike explodes toward expiry, while a ~3-sigma OTM put gamma collapses', () => {
  const g = (hours: number, spot: number) => { const v = computeHFeatures(snap({ hoursToExpiry: hours, spot })).H_GAMMA;
    assert.equal(v.state, 'KNOWN'); return (v as { value: number }).value; };
  assert.ok(g(6, 95.5) > 3 * g(120, 95.5), 'near-the-money short-DTE convexity');
  assert.ok(g(6, 97) < g(120, 97), 'far OTM: the danger is a fast move INTO the strike, captured by move speed / distance velocity');
});

test('a fast move toward the strike with an event before expiry is RISK_CLOSE; one warning is only WATCH', () => {
  const fast = evaluateHShadow(snap({ spot: 96.5, recentBars: hourly([100, 99.2, 98.4, 97.4, 96.5]),
    nextEventAt: '2026-10-08T12:30:00.000Z', closeAsk: 0.9, closeBid: 0.85 }), policy());
  assert.equal(fast.recommended, 'RISK_CLOSE');
  assert.ok(fast.warnings.includes('FAST_MOVE') && fast.warnings.includes('EVENT_BEFORE_EXPIRY'));
  assert.equal(fast.rollPolicy, 'NO_ROLL_PRODUCTION_POLICY');
  const calm = evaluateHShadow(snap({ nextEventAt: '2026-10-08T12:30:00.000Z' }), policy());
  assert.equal(calm.warningLevel, 'WATCH');
  assert.equal(calm.recommended, 'HOLD');
});

test('take profit, time exit, expiry and assignment; missing close quote never acts', () => {
  assert.equal(evaluateHShadow(snap({ closeAsk: 0.15, closeBid: 0.14 }), policy()).recommended, 'TAKE_PROFIT');
  assert.equal(evaluateHShadow(snap({ hoursToExpiry: 4 }), policy()).recommended, 'TIME_EXIT');
  assert.equal(evaluateHShadow(snap({ hoursToExpiry: 0, spot: 94 }), policy()).recommended, 'ASSIGNMENT');
  assert.equal(evaluateHShadow(snap({ hoursToExpiry: 0, spot: 99 }), policy()).recommended, 'EXPIRY');
  assert.equal(evaluateHShadow(snap({ closeAsk: null }), policy()).recommended, 'HOLD');
});
