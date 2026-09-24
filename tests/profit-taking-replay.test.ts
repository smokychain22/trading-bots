import assert from 'node:assert/strict';
import test from 'node:test';
import { runProfitTakingReplay, type ProfitReplayInput } from '../src/research/profit-taking-replay.js';
const required = <T>(value: T | null | undefined): T => { assert.ok(value !== null && value !== undefined); return value; };

const input = (): ProfitReplayInput => ({ version: 'theta-profit-taking-replay-input-v1', sourceSha: 'a'.repeat(40),
  sourceManifestHash: 'b'.repeat(64), episodeId: 'episode', chainId: 'chain', evidenceClass: 'DETERMINISTIC_TEST',
  entryAt: '2026-09-21T14:00:00Z', entryCreditDollars: 100, entryFeesDollars: 1,
  policy: { version: 'test-policy-v1', maxHoldingMinutes: 60, exitDte: 5, maxTailLossDollars: 1000 },
  observations: [{ evidenceId: 'quote-1', decisionAt: '2026-09-22T14:00:00Z', dte: 4,
    closeAskDollars: 4, closeFeesDollars: 1, adverseSlippageDollars: 1,
    quoteAt: '2026-09-22T13:59:59Z', quoteReceivedAt: '2026-09-22T14:00:00Z',
    quoteValidThrough: '2026-09-22T14:00:10Z', quoteAuthority: 'ALPACA_EXECUTABLE_MARKET',
    hardRiskExitRequired: false, eventExitRequired: false, riskAvailableAt: '2026-09-22T14:00:00Z',
    eventAvailableAt: '2026-09-22T14:00:00Z', eventValidThrough: '2026-09-22T15:00:00Z',
    forecast: { modelVersion: 'TEST_NOT_TRAINED', availableAt: '2026-09-22T13:00:00Z', validThrough: '2026-09-22T15:00:00Z',
      horizonEnd: '2026-09-25T20:00:00Z', units: 'USD_PER_EPISODE_INCREMENTAL_VS_CLOSE_NOW_AFTER_COST',
      holdValue: -1, uncertainty: 1, tailLoss: 100, redeploymentValue: 2, evidenceIds: ['forecast-test'] } }],
});

test('all 17 registered challengers execute offline and preserve explicit after-cost fill assumptions', () => {
  const r = runProfitTakingReplay(input());
  assert.equal(r.policies.length, 17);
  assert.equal(new Set(r.policies.map((p) => p.policy)).size, 17);
  for (const p of r.policies) {
    assert.equal(p.terminal, 'ESTIMATED_EXIT'); assert.equal(p.estimatedAfterCostPnlDollars, 93); assert.equal(p.actualFill, false);
  }
  assert.equal(r.brokerAuthority, false);
  assert.deepEqual(runProfitTakingReplay(input()), r);
});

test('a missing continuation model remains unresolved, never a zero EV or forced hold', () => {
  const i = input(); required(i.observations[0]).forecast = null;
  const r = runProfitTakingReplay(i);
  for (const p of r.policies.filter((p) => p.policy.startsWith('DYNAMIC'))) {
    assert.equal(p.terminal, 'CENSORED'); assert.equal(p.estimatedAfterCostPnlDollars, null);
    assert.equal(required(p.decisions[0]).reason, 'EV_MODEL_NOT_EMPIRICALLY_READY');
  }
});

test('future evidence and stale BBO cannot create counterfactual fills', () => {
  const i = input(); required(i.observations[0]).quoteReceivedAt = '2026-09-22T14:00:01Z';
  for (const p of runProfitTakingReplay(i).policies) assert.equal(p.terminal, 'CENSORED');
  required(i.observations[0]).quoteReceivedAt = '2026-09-22T14:00:00Z';
  required(required(i.observations[0]).forecast).availableAt = '2026-09-22T14:00:01Z';
  assert.equal(required(runProfitTakingReplay(i).policies.find((p) => p.policy === 'DYNAMIC_REMAINING_EV')).terminal, 'CENSORED');
});

test('known hard risk can exit without pretending a continuation model exists', () => {
  const i = input(); required(i.observations[0]).forecast = null; required(i.observations[0]).hardRiskExitRequired = true;
  const p = required(runProfitTakingReplay(i).policies.find((p) => p.policy === 'DYNAMIC_EV_PLUS_HARD_RISK'));
  assert.equal(required(p.decisions[0]).reason, 'OBSERVED_HARD_RISK_EXIT');
});

test('high captured profit can hold when forward economics remain better', () => {
  const i = input(); required(required(i.observations[0]).forecast).holdValue = 10;
  const r = runProfitTakingReplay(i);
  assert.equal(required(r.policies.find((p) => p.policy === 'FIXED_90')).terminal, 'ESTIMATED_EXIT');
  assert.equal(required(r.policies.find((p) => p.policy === 'DYNAMIC_REMAINING_EV')).terminal, 'OPEN_UNRESOLVED');
});

test('malformed values and duplicate evidence are rejected, not silently converted', () => {
  const i = input(); required(i.observations[0]).closeAskDollars = NaN;
  assert.throws(() => runProfitTakingReplay(i));
  const j = input(); j.observations.push(required(j.observations[0]));
  assert.throws(() => runProfitTakingReplay(j), /DUPLICATE/);
});
