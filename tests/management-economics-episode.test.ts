import assert from 'node:assert/strict';
import test from 'node:test';
import { buildEpisodeAccountingReceipt, type EpisodeEvent } from '../src/theta/management-economics/episode-accounting.js';

const d = (day: number) => new Date(Date.UTC(2026, 9, day)).toISOString();

test('Q -> assignment -> C -> call-away is one episode with exact whole-chain P&L and no double counting', () => {
  const events: EpisodeEvent[] = [
    { id: 'e1', at: d(1), kind: 'PUT_OPEN', legId: 'P50', strike: 50, contracts: 1, creditPerShare: 1.0, slippageUsd: 1 },
    { id: 'e2', at: d(11), kind: 'PUT_ASSIGNED', legId: 'P50' },
    { id: 'e3', at: d(12), kind: 'CALL_OPEN', legId: 'C52', strike: 52, contracts: 1, creditPerShare: 0.8, slippageUsd: 1 },
    { id: 'e4', at: d(22), kind: 'CALLED_AWAY', legId: 'C52' },
    { id: 'e5', at: d(22), kind: 'FEE', amountUsd: 1.3 },
    { id: 'e3', at: d(12), kind: 'CALL_OPEN', legId: 'C52', strike: 52, contracts: 1, creditPerShare: 0.8, slippageUsd: 1 }, // replayed duplicate
  ];
  const r = buildEpisodeAccountingReceipt({ episodeId: 'ep1', multiplier: 100, events, asOf: d(23), currentStockMarkPerShare: null, feesKnown: true });
  assert.deepEqual(r.duplicateEventIdsIgnored, ['e3']);
  assert.equal(r.putPremiumUsd, 100);
  assert.equal(r.coveredCallPremiumUsd, 80);
  assert.equal(r.assignmentBasisPerShare, 50);
  assert.equal(r.effectiveBasisPerShare, 49);
  assert.equal(r.stockPnlUsd, 200); // called away at 52, assigned at 50
  assert.equal(r.wholeChain.wholeChainPnl, 100 + 80 + 200 - 1.3);
  assert.equal(r.slippageUsd, 2);
  // Capital-days: put collateral 5,000 x 10 days + stock 5,000 x 11 days.
  assert.equal(r.capitalDays, 5000 * 10 + 5000 * 11);
  assert.deepEqual([r.assigned, r.calledAway, r.state], [true, true, 'CLOSED']);
});

test('a roll is close old + open new: the old leg realized P&L is immutable and the new credit is separate', () => {
  const r = buildEpisodeAccountingReceipt({ episodeId: 'ep2', multiplier: 100, asOf: d(30), currentStockMarkPerShare: null, feesKnown: true, events: [
    { id: 'a', at: d(1), kind: 'PUT_OPEN', legId: 'P50', strike: 50, contracts: 1, creditPerShare: 1.0, slippageUsd: 0 },
    { id: 'b', at: d(10), kind: 'PUT_CLOSE', legId: 'P50', debitPerShare: 2.5, isRoll: true, slippageUsd: 0 },
    { id: 'c', at: d(10), kind: 'PUT_OPEN', legId: 'P48', strike: 48, contracts: 1, creditPerShare: 2.0, slippageUsd: 0 },
    { id: 'f', at: d(30), kind: 'PUT_EXPIRED', legId: 'P48' },
  ] });
  const old = r.legs.find((l) => l.legId === 'P50');
  assert.deepEqual([old?.closedBy, old?.realizedPnlUsd], ['ROLL_CLOSE', -150]);
  assert.equal(r.legs.find((l) => l.legId === 'P48')?.realizedPnlUsd, 200);
  assert.deepEqual([r.components.initialPutPremium, r.components.rollCredits, r.components.rollCloseCosts], [100, 200, 250]);
  assert.equal(r.wholeChain.wholeChainPnl, 100 - 250 + 200);
  assert.equal(r.state, 'CLOSED');
});

test('open exposure, unknown fees and invalid sequences are explicit', () => {
  const open = buildEpisodeAccountingReceipt({ episodeId: 'ep3', multiplier: 100, asOf: d(5), currentStockMarkPerShare: null, feesKnown: false, events: [
    { id: 'a', at: d(1), kind: 'PUT_OPEN', legId: 'P50', strike: 50, contracts: 1, creditPerShare: 1.0, slippageUsd: null }] });
  assert.equal(open.state, 'OPEN');
  assert.equal(open.wholeChain.wholeChainPnl, null, 'unknown fees never become zero');
  assert.equal(open.slippageUsd, null);
  assert.equal(open.capitalDays, 5000 * 4);
  assert.throws(() => buildEpisodeAccountingReceipt({ episodeId: 'x', multiplier: 100, asOf: d(5), currentStockMarkPerShare: null, feesKnown: true, events: [
    { id: 'a', at: d(1), kind: 'CALL_OPEN', legId: 'C1', strike: 50, contracts: 1, creditPerShare: 1, slippageUsd: 0 }] }), /NAKED_CALL_REJECTED/);
  assert.throws(() => buildEpisodeAccountingReceipt({ episodeId: 'x', multiplier: 100, asOf: d(5), currentStockMarkPerShare: null, feesKnown: true, events: [
    { id: 'a', at: d(1), kind: 'PUT_OPEN', legId: 'P', strike: 50, contracts: 1, creditPerShare: 1, slippageUsd: 0 },
    { id: 'b', at: d(2), kind: 'PUT_EXPIRED', legId: 'P' }, { id: 'c', at: d(3), kind: 'PUT_EXPIRED', legId: 'P' }] }), /ALREADY_CLOSED/);
});
