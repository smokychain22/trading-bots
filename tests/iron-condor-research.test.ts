import assert from 'node:assert/strict';
import test from 'node:test';
import { buildIronCondorEconomics, replayIronCondorManagement, type CondorLegQuote,
  type IronCondorCandidateInput } from '../src/research/source-replication/iron-condor.js';

const leg = (symbol: string, strike: number, bid: number, ask: number, delta: number): CondorLegQuote => ({
  symbol, strike, expiration: '2026-11-20', multiplier: 100, bid, ask, delta, gamma: 0.01,
  theta: -0.02, vega: 0.05,
});
const input = (overrides: Partial<IronCondorCandidateInput> = {}): IronCondorCandidateInput => ({
  candidateId: 'SPY-CONDOR', observedAt: '2026-10-07T15:00:00.000Z', providerKnownAt: '2026-10-07T15:00:00.000Z', spot: 100,
  longPut: leg('LP', 90, 0.4, 0.5, -0.1), shortPut: leg('SP', 95, 1.4, 1.5, -0.2),
  shortCall: leg('SC', 105, 1.3, 1.4, 0.2), longCall: leg('LC', 110, 0.3, 0.4, 0.1),
  modeledOpeningCostsUsd: 8, ...overrides,
});

test('iron condor uses executable four-leg credit and exact asymmetric wing risk', () => {
  const receipt = buildIronCondorEconomics(input({ longCall: leg('LC', 112, 0.2, 0.3, 0.08) }));
  assert.equal(receipt.state, 'READY');
  assert.equal(receipt.netCreditPerShare, 1.9);
  assert.equal(receipt.grossCreditUsd, 190);
  assert.equal(receipt.lowerMaxLossUsd, 310);
  assert.equal(receipt.upperMaxLossUsd, 510);
  assert.equal(receipt.maximumLossUsd, 510);
  assert.equal(receipt.lowerBreakeven, 93.1);
  assert.equal(receipt.upperBreakeven, 106.9);
  assert.equal(receipt.executionAuthorized, false);
});

test('invalid geometry and future-known quotes fail closed', () => {
  assert.equal(buildIronCondorEconomics(input({ longPut: leg('LP', 97, 0.4, 0.5, -0.1) })).state, 'INVALID');
  assert.equal(buildIronCondorEconomics(input({ providerKnownAt: '2026-10-07T16:00:00.000Z' })).state, 'PIT_UNSAFE');
});

test('profit target and time exit use executable close debit and preserve unknown net costs', () => {
  const entry = buildIronCondorEconomics(input());
  const observations = [{ observedAt: '2026-10-08T15:00:00.000Z', providerKnownAt: '2026-10-08T15:00:00.000Z',
    longPutBid: 0.2, shortPutAsk: 0.7, shortCallAsk: 0.6, longCallBid: 0.2, modeledClosingCostsUsd: 6 }];
  const profit = replayIronCondorManagement(entry, observations,
    { version: 'profit-50', mode: 'PROFIT_TARGET', exitAtOrAfter: null, profitCaptureFraction: 0.5 });
  assert.equal(profit.state, 'COMPLETE');
  assert.equal(profit.closeDebitUsd, 90);
  assert.equal(profit.grossPnlUsd, 90);
  assert.equal(profit.netPnlUsd, 76);
  const unknownCosts = replayIronCondorManagement({ ...entry, netCreditAfterModeledCostsUsd: null }, observations,
    { version: 'time', mode: 'TIME_EXIT', exitAtOrAfter: '2026-10-08T14:00:00.000Z', profitCaptureFraction: null });
  assert.equal(unknownCosts.state, 'COMPLETE');
  assert.equal(unknownCosts.netPnlUsd, null);
});

test('missing management threshold blocks rather than choosing an arbitrary exit', () => {
  const receipt = replayIronCondorManagement(buildIronCondorEconomics(input()), [],
    { version: 'missing', mode: 'PROFIT_TARGET', exitAtOrAfter: null, profitCaptureFraction: null });
  assert.equal(receipt.state, 'BLOCKED_MISSING_POLICY');
});
