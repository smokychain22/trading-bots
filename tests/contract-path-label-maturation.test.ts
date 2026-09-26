import assert from 'node:assert/strict';
import test from 'node:test';
import { matureContractPath, type ContractPathMarkPoint } from '../src/research/contract-path-label-maturation.js';

const decisionAt = '2026-09-25T14:30:00Z';
const point = (checkpoint: string, actualObservedAt: string, markChangeDollars: number | null,
  evidenceClass: ContractPathMarkPoint['evidenceClass'] = 'MARKET_OBSERVED'): ContractPathMarkPoint => ({
  checkpoint,
  targetAt: actualObservedAt,
  actualObservedAt,
  providerTimestamp: new Date(Date.parse(actualObservedAt) - 2_000).toISOString(),
  receivedAt: new Date(Date.parse(actualObservedAt) - 1_000).toISOString(),
  markChangeDollars,
  evidenceClass,
  evidenceId: `evidence-${checkpoint}`,
});

test('market marks mature MAE/MFE without pretending they are fills or realized PnL', () => {
  const receipt = matureContractPath({
    subjectId: 'subject-1', decisionAt, requiredCheckpoints: ['15M', '1H', 'EOD'],
    points: [point('15M', '2026-09-25T14:45:00Z', -20), point('1H', '2026-09-25T15:30:00Z', 40),
      point('EOD', '2026-09-25T20:00:00Z', 10)],
  });
  assert.equal(receipt.state, 'MATURED_MARK_ONLY');
  assert.equal(receipt.mfeDollars, 40);
  assert.equal(receipt.maeDollars, -20);
  assert.equal(receipt.givebackDollars, 30);
  assert.equal(receipt.marketMarkOnly, true);
  assert.equal(receipt.brokerAuthority, false);
});

test('partial and not-identifiable paths remain typed instead of zero-filled', () => {
  const partial = matureContractPath({ subjectId: 'subject-1', decisionAt,
    requiredCheckpoints: ['15M', '1H'], points: [point('15M', '2026-09-25T14:45:00Z', 5)] });
  assert.equal(partial.state, 'PARTIAL');
  assert.deepEqual(partial.reasonCodes, ['REQUIRED_HORIZON_PENDING']);
  const unknown = matureContractPath({ subjectId: 'subject-1', decisionAt,
    requiredCheckpoints: ['15M'], points: [point('15M', '2026-09-25T14:45:00Z', null)] });
  assert.equal(unknown.state, 'NOT_IDENTIFIABLE');
  assert.equal(unknown.mfeDollars, null);
  assert.equal(unknown.maeDollars, null);
});

test('future timestamps and labels before their target fail the PIT firewall', () => {
  const invalid = { ...point('15M', '2026-09-25T14:45:00Z', 1),
    receivedAt: '2026-09-25T14:44:00Z', providerTimestamp: '2026-09-25T14:46:00Z' };
  assert.throws(() => matureContractPath({ subjectId: 'subject-1', decisionAt,
    requiredCheckpoints: ['15M'], points: [invalid] }), /CONTRACT_PATH_MATURATION_TIME_TRAVEL/);
});

test('no observations can be pending or explicitly right-censored, never fake known', () => {
  const pending = matureContractPath({ subjectId: 'subject-1', decisionAt,
    requiredCheckpoints: ['15M'], points: [] });
  assert.equal(pending.state, 'PENDING');
  const censored = matureContractPath({ subjectId: 'subject-1', decisionAt,
    requiredCheckpoints: ['15M'], points: [], terminalState: 'RIGHT_CENSORED',
    terminalReasonCode: 'CONTRACT_DELISTED' });
  assert.equal(censored.state, 'RIGHT_CENSORED');
  assert.deepEqual(censored.reasonCodes, ['CONTRACT_DELISTED']);
});
