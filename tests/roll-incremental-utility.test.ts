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
