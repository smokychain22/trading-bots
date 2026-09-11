import assert from 'node:assert/strict';
import test from 'node:test';
import { assembleEventState, DEFAULT_EVENT_STATE_POLICY, knownDate, unknownDate, type CorporateEventState } from '../src/theta/event-state.js';

const ASOF = '2026-09-10';
const noCorporateEvent: CorporateEventState = { known: false, category: null, effectiveDate: null, provenance: 'UNKNOWN' };

test('every fact UNKNOWN produces eventRiskState UNKNOWN, never NONE_CONFIRMED as a default', () => {
  const result = assembleEventState(ASOF, unknownDate(), unknownDate(), noCorporateEvent);
  assert.equal(result.eventRiskState, 'UNKNOWN');
});

test('a known earnings date far in the future produces NONE_CONFIRMED, since it is real evidence of no near-term event', () => {
  const result = assembleEventState(ASOF, knownDate('2026-12-01', ASOF, 'ALPACA'), unknownDate(), noCorporateEvent);
  assert.equal(result.eventRiskState, 'NONE_CONFIRMED');
  assert.equal(result.earnings.distanceDays, 82);
});

test('a known earnings date within the near window (but not active) produces EVENT_NEAR', () => {
  const result = assembleEventState(ASOF, knownDate('2026-09-17', ASOF, 'ALPACA'), unknownDate(), noCorporateEvent); // 7 days out, within default 10-day window
  assert.equal(result.eventRiskState, 'EVENT_NEAR');
});

test('a known event today (distance 0) produces EVENT_ACTIVE', () => {
  const result = assembleEventState(ASOF, knownDate(ASOF, ASOF, 'ALPACA'), unknownDate(), noCorporateEvent);
  assert.equal(result.eventRiskState, 'EVENT_ACTIVE');
  assert.equal(result.earnings.distanceDays, 0);
});

test('a known event that already happened a day ago is still EVENT_ACTIVE within the active window (past events matter too)', () => {
  const result = assembleEventState(ASOF, knownDate('2026-09-09', ASOF, 'ALPACA'), unknownDate(), noCorporateEvent);
  assert.equal(result.eventRiskState, 'EVENT_ACTIVE');
  assert.equal(result.earnings.distanceDays, -1);
});

test('a corporate action alone (no earnings/ex-dividend known) can still drive EVENT_NEAR', () => {
  const result = assembleEventState(ASOF, unknownDate(), unknownDate(), { known: true, category: 'forward_split', effectiveDate: '2026-09-15', provenance: 'ALPACA' });
  assert.equal(result.eventRiskState, 'EVENT_NEAR');
});

test('the NEAREST known fact governs -- a near ex-dividend overrides a distant known earnings date', () => {
  const result = assembleEventState(ASOF, knownDate('2027-01-01', ASOF, 'ALPACA'), knownDate('2026-09-12', ASOF, 'ALPACA'), noCorporateEvent);
  assert.equal(result.eventRiskState, 'EVENT_NEAR');
});

test('a custom stricter policy narrows the near/active windows', () => {
  const strictPolicy = { policyVersion: 'event-state-v1-strict-test', nearWindowDays: 3, activeWindowDays: 0 };
  const result = assembleEventState(ASOF, knownDate('2026-09-15', ASOF, 'ALPACA'), unknownDate(), noCorporateEvent, strictPolicy); // 5 days out
  assert.equal(result.eventRiskState, 'NONE_CONFIRMED'); // 5 days exceeds the strict 3-day near window
});

test('unknownDate can report a distinct UNRECOGNIZED_RESPONSE_SHAPE data quality without becoming known', () => {
  const d = unknownDate('UNRECOGNIZED_RESPONSE_SHAPE');
  assert.equal(d.known, false);
  assert.equal(d.dataQuality, 'UNRECOGNIZED_RESPONSE_SHAPE');
  assert.equal(d.date, null);
});

test('the assessment is point-in-time -- asOfDate is preserved verbatim and distanceDays never implies future leakage beyond it', () => {
  const result = assembleEventState(ASOF, knownDate('2026-09-20', ASOF, 'ALPACA'), unknownDate(), noCorporateEvent);
  assert.equal(result.asOfDate, ASOF);
  assert.equal(result.policyVersion, DEFAULT_EVENT_STATE_POLICY.policyVersion);
});
