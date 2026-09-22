import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildPaperBootstrapCandidateSet, enumerateCandidates,
  type CandidateQuoteObservation, type CurrentShortLeg, type EnumerationConfig,
} from '../src/research/paper-bootstrap-candidate-source.js';

const CONFIG: EnumerationConfig = { maxQuoteAgeMs: 60_000, asOf: '2026-09-22T15:00:00Z' };

const CURRENT_PUT_LEG: CurrentShortLeg = {
  contractId: 'AAPL-2026-10-16-P-200', underlying: 'AAPL', optionType: 'PUT',
  strike: 200, expiration: '2026-10-16', multiplier: 100, quantity: 1,
};

function observation(overrides: Partial<CandidateQuoteObservation> = {}): CandidateQuoteObservation {
  return {
    contractId: 'AAPL-2026-11-20-P-195', underlying: 'AAPL', optionType: 'PUT', strike: 195,
    expiration: '2026-11-20', multiplier: 100, bid: 1.5, ask: 1.6, quoteTimestamp: '2026-09-22T14:59:50Z',
    dte: 59, delta: -0.2, quoteSource: 'ALPACA_EXECUTABLE_MARKET', ...overrides,
  };
}

test('enumerateCandidates returns zero candidates for zero observations', () => {
  const result = enumerateCandidates([], CURRENT_PUT_LEG, 1, CONFIG);
  assert.deepEqual(result.accepted, []);
  assert.deepEqual(result.rejected, []);
});

test('enumerateCandidates accepts exactly one valid alternative candidate', () => {
  const result = enumerateCandidates([observation()], CURRENT_PUT_LEG, 1, CONFIG);
  assert.equal(result.accepted.length, 1);
  assert.equal(result.accepted[0]?.optionContractId, 'AAPL-2026-11-20-P-195');
  assert.equal(result.accepted[0]?.quantity, 1);
  assert.equal(result.rejected.length, 0);
});

test('enumerateCandidates accepts many distinct valid alternative candidates (multiple expirations and strikes, never pre-selecting one)', () => {
  const observations = [
    observation({ contractId: 'c1', strike: 195, expiration: '2026-10-16' }),
    observation({ contractId: 'c2', strike: 190, expiration: '2026-10-16' }),
    observation({ contractId: 'c3', strike: 195, expiration: '2026-11-20' }),
    observation({ contractId: 'c4', strike: 190, expiration: '2026-12-18' }),
  ];
  const result = enumerateCandidates(observations, CURRENT_PUT_LEG, 1, CONFIG);
  assert.equal(result.accepted.length, 4);
  const strikes = new Set(result.accepted.map((c) => c.strike));
  const expirations = new Set(result.accepted.map((c) => c.expiration));
  assert.equal(strikes.size, 2);
  assert.equal(expirations.size, 3);
});

test('enumerateCandidates rejects the current contract itself as SAME_CONTRACT_AS_CURRENT', () => {
  const result = enumerateCandidates(
    [observation({ contractId: CURRENT_PUT_LEG.contractId, strike: CURRENT_PUT_LEG.strike, expiration: CURRENT_PUT_LEG.expiration })],
    CURRENT_PUT_LEG, 1, CONFIG,
  );
  assert.equal(result.accepted.length, 0);
  assert.equal(result.rejected[0]?.reason, 'SAME_CONTRACT_AS_CURRENT');
});

test('enumerateCandidates rejects a duplicate contractId on its second occurrence, keeping the first', () => {
  const dup = observation({ contractId: 'dup-1' });
  const result = enumerateCandidates([dup, dup], CURRENT_PUT_LEG, 1, CONFIG);
  assert.equal(result.accepted.length, 1);
  assert.equal(result.rejected.length, 1);
  assert.equal(result.rejected[0]?.reason, 'DUPLICATE_CONTRACT_ID');
});

test('enumerateCandidates rejects a stale quote relative to asOf and maxQuoteAgeMs', () => {
  const stale = observation({ contractId: 'stale-1', quoteTimestamp: '2026-09-22T14:00:00Z' }); // 1 hour old vs. a 60s max age
  const result = enumerateCandidates([stale], CURRENT_PUT_LEG, 1, CONFIG);
  assert.equal(result.accepted.length, 0);
  assert.equal(result.rejected[0]?.reason, 'STALE_QUOTE');
});

test('enumerateCandidates rejects a missing bid or ask, never fabricating a price', () => {
  const noBid = observation({ contractId: 'no-bid', bid: null });
  const noAsk = observation({ contractId: 'no-ask', ask: null });
  const result = enumerateCandidates([noBid, noAsk], CURRENT_PUT_LEG, 1, CONFIG);
  assert.equal(result.accepted.length, 0);
  assert.equal(result.rejected.every((r) => r.reason === 'MISSING_BID_OR_ASK'), true);
});

test('enumerateCandidates rejects a crossed/inverted quote (ask < bid)', () => {
  const crossed = observation({ contractId: 'crossed', bid: 2.0, ask: 1.0 });
  const result = enumerateCandidates([crossed], CURRENT_PUT_LEG, 1, CONFIG);
  assert.equal(result.accepted.length, 0);
  assert.equal(result.rejected[0]?.reason, 'CROSSED_OR_INVERTED_QUOTE');
});

test('enumerateCandidates rejects an observation for a different underlying or option type', () => {
  const wrongUnderlying = observation({ contractId: 'wrong-u', underlying: 'MSFT' });
  const wrongType = observation({ contractId: 'wrong-t', optionType: 'CALL' });
  const result = enumerateCandidates([wrongUnderlying, wrongType], CURRENT_PUT_LEG, 1, CONFIG);
  assert.equal(result.accepted.length, 0);
  assert.equal(result.rejected.find((r) => r.contractId === 'wrong-u')?.reason, 'WRONG_UNDERLYING');
  assert.equal(result.rejected.find((r) => r.contractId === 'wrong-t')?.reason, 'WRONG_OPTION_TYPE');
});

test('buildPaperBootstrapCandidateSet never populates the legacy singular fields -- ranking stays the policy\'s job, never this module\'s', () => {
  const result = buildPaperBootstrapCandidateSet({
    currentShortPutLeg: CURRENT_PUT_LEG, currentShortCallLeg: null,
    putObservations: [observation()], callObservations: [], quantity: 1, config: CONFIG,
  });
  assert.equal(result.candidateSet.rollCandidate, null);
  assert.equal(result.candidateSet.ccCandidate, null);
  assert.equal(result.candidateSet.rollCandidates.length, 1);
});

test('buildPaperBootstrapCandidateSet populates rollCcCandidates when an open CC exists to roll', () => {
  const currentCallLeg: CurrentShortLeg = {
    contractId: 'AAPL-2026-10-16-C-220', underlying: 'AAPL', optionType: 'CALL',
    strike: 220, expiration: '2026-10-16', multiplier: 100, quantity: 1,
  };
  const callObs = observation({ contractId: 'call-alt', optionType: 'CALL', strike: 225, expiration: '2026-11-20' });
  const result = buildPaperBootstrapCandidateSet({
    currentShortPutLeg: null, currentShortCallLeg: currentCallLeg,
    putObservations: [], callObservations: [callObs], quantity: 1, config: CONFIG,
  });
  assert.equal(result.candidateSet.rollCcCandidates.length, 1);
  assert.equal(result.candidateSet.ccCandidates.length, 0); // no open CC to roll means this path is ROLL_CC, not a fresh SELL_CC
});

test('buildPaperBootstrapCandidateSet populates ccCandidates for a fresh SELL_CC decision when no CC is currently open', () => {
  const callObs = observation({ contractId: 'fresh-cc', optionType: 'CALL', strike: 225, expiration: '2026-11-20' });
  const result = buildPaperBootstrapCandidateSet({
    currentShortPutLeg: null, currentShortCallLeg: null,
    putObservations: [], callObservations: [callObs], quantity: 1, config: CONFIG,
  });
  assert.equal(result.candidateSet.ccCandidates.length, 1);
  assert.equal(result.candidateSet.rollCcCandidates.length, 0);
});

test('buildPaperBootstrapCandidateSet produces an entirely empty set when there is no current leg and no observations, never fabricated', () => {
  const result = buildPaperBootstrapCandidateSet({
    currentShortPutLeg: null, currentShortCallLeg: null,
    putObservations: [], callObservations: [], quantity: 1, config: CONFIG,
  });
  assert.deepEqual(result.candidateSet.rollCandidates, []);
  assert.deepEqual(result.candidateSet.ccCandidates, []);
  assert.deepEqual(result.candidateSet.rollCcCandidates, []);
});
