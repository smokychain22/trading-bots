import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateRollCandidates, type RollCandidateEconomics, type RollOldLeg } from '../src/theta/roll-incremental-utility.js';

const oldLeg: RollOldLeg = {
  closeCostDollars: 100, strike: 200, expiration: '2026-10-16', delta: -0.3, capitalCommittedDollars: 20_000,
};

const candidate = (overrides: Partial<RollCandidateEconomics> = {}): RollCandidateEconomics => ({
  symbol: 'AAPL261120P00195000', optionContractId: 'target-a', strike: 195, expiration: '2026-11-20',
  delta: -0.28, openCreditDollars: 150, capitalCommittedDollars: 19_500, ...overrides,
});

test('rejects a negative capital-day weight rather than silently accepting it', () => {
  assert.throws(() => evaluateRollCandidates(oldLeg, null, [candidate()], -1),
    /ROLL_INCREMENTAL_UTILITY_INVALID_CAPITAL_DAY_WEIGHT/);
});

test('with zero capital-day weight, ranking reduces to net credit and preserves old-leg + sunk-P&L fields', () => {
  const result = evaluateRollCandidates(oldLeg, 42, [
    candidate({ optionContractId: 'low-credit', openCreditDollars: 120 }),
    candidate({ optionContractId: 'high-credit', openCreditDollars: 300 }),
  ], 0);
  assert.equal(result.oldLeg, oldLeg);
  assert.equal(result.sunkRealizedPnl, 42);
  assert.equal(result.bestCandidate?.candidate.optionContractId, 'high-credit');
  assert.equal(result.bestCandidate?.netCreditDollars, 200);
  assert.equal(result.bestBeatsHold, true);
});

test('a large capital-day penalty can make a smaller, shorter-extension roll beat a bigger net-credit roll', () => {
  const result = evaluateRollCandidates(oldLeg, null, [
    // Big net credit, but far out in time and much larger capital -- expensive to carry.
    candidate({ optionContractId: 'far-and-big', expiration: '2027-01-15', openCreditDollars: 500, capitalCommittedDollars: 80_000 }),
    // Small net credit, short extension, capital roughly unchanged.
    candidate({ optionContractId: 'near-and-small', expiration: '2026-10-23', openCreditDollars: 110, capitalCommittedDollars: 20_100 }),
  ], 0.01);
  assert.equal(result.bestCandidate?.candidate.optionContractId, 'near-and-small');
});

test('a net-debit roll never beats HOLD regardless of capital-day weight', () => {
  const result = evaluateRollCandidates(oldLeg, null, [candidate({ openCreditDollars: 40 })], 0);
  assert.ok((result.bestCandidate?.netCreditDollars ?? 0) < 0);
  assert.equal(result.bestBeatsHold, false);
});

test('a candidate missing openCreditDollars is reported incomplete, never assigned a fabricated utility', () => {
  const result = evaluateRollCandidates(oldLeg, null, [candidate({ openCreditDollars: null })], 0);
  assert.equal(result.assessments[0]?.rollIncrementalUtility, null);
  assert.ok(result.assessments[0]?.reasons.includes('FORWARD_ECONOMICS_INCOMPLETE'));
  assert.equal(result.bestCandidate, null);
});

test('days extended and incremental capital are computed and exposed on the winning assessment', () => {
  const result = evaluateRollCandidates(oldLeg, null, [candidate()], 0.001);
  const best = result.bestCandidate;
  assert.ok(best !== null);
  assert.equal(best?.daysExtended, 35);
  assert.equal(best?.incrementalCapitalDollars, -500);
});

test('with a zero weight released capital is free, and ties are provider-order independent', () => {
  const a = candidate({ optionContractId: 'a' }), b = candidate({ optionContractId: 'b' });
  assert.equal(evaluateRollCandidates(oldLeg, null, [a], 0).bestCandidate?.rollIncrementalUtility, 50);
  assert.equal(evaluateRollCandidates(oldLeg, null, [a, b], 1).bestCandidate?.candidate.optionContractId,
    evaluateRollCandidates(oldLeg, null, [b, a], 1).bestCandidate?.candidate.optionContractId);
});

test('D4: extending the SAME collateral for more days is priced as capital-days (forward economics, no new weight)', () => {
  const same = candidate({ optionContractId: 'same', strike: 200, expiration: '2027-04-16', openCreditDollars: 150, capitalCommittedDollars: 20_000 });
  const days = 182; // 2026-10-16 -> 2027-04-16
  // no asOf: the extension alone, newCapital x days(oldExpiry -> newExpiry)
  const noAsOf = evaluateRollCandidates(oldLeg, 0, [same], 1).assessments[0];
  assert.equal(noAsOf?.daysExtended, days);
  assert.equal(noAsOf?.incrementalCapitalDollars, 0, 'the dollars of collateral are unchanged ...');
  assert.equal(noAsOf?.incrementalCapitalDays, 20_000 * days, '... but the extra days are capital-days');
  assert.equal(noAsOf?.rollIncrementalUtility, 50 - 20_000 * days, 'a weight of 1 per USD-day now prices a six-month extension');
  // with asOf the overlap period is exact: new 20,000 x days(asOf -> 2027-04-16) - old 20,000 x days(asOf -> 2026-10-16)
  const asOf = '2026-09-12T00:00:00Z';
  const exact = evaluateRollCandidates(oldLeg, 0, [same], 1, asOf).assessments[0];
  assert.ok(Math.abs((exact?.incrementalCapitalDays ?? 0) - 20_000 * days) < 1e-6, 'same collateral => the difference is exactly the extension');
  // weight 0 stays inert: ranking is pure net credit, never an invented penalty
  assert.equal(evaluateRollCandidates(oldLeg, 0, [same], 0, asOf).assessments[0]?.rollIncrementalUtility, 50);
  // a roll that does NOT extend and does not add collateral pays nothing
  const flat = candidate({ optionContractId: 'flat', expiration: oldLeg.expiration as string, capitalCommittedDollars: 20_000, openCreditDollars: 150 });
  assert.equal(evaluateRollCandidates(oldLeg, 0, [flat], 1, asOf).assessments[0]?.rollIncrementalUtility, 50);
  // unknown collateral keeps the candidate unrankable, never a zero penalty
  const unknown = candidate({ optionContractId: 'unk', capitalCommittedDollars: null });
  assert.equal(evaluateRollCandidates(oldLeg, 0, [unknown], 1, asOf).assessments[0]?.rollIncrementalUtility, null);
});

test('nonfinite roll economics never rank or produce a fabricated finite utility', () => {
  for (const value of [NaN, Infinity, -1]) {
    assert.equal(evaluateRollCandidates(oldLeg, null, [candidate({ openCreditDollars: value })], 0).bestCandidate, null);
  }
});
