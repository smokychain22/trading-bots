import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import {
  assertLabelAvailableAfterObservation, buildReplayObservation, replayObservationSchema,
  type ReplayOutcomeLabel,
} from '../src/research/theta-replay.js';

const observation = () => buildReplayObservation({
  fusionSnapshotId: null, chainId: null, underlying: 'AAPL', contractSymbol: null,
  strategyBranch: 'THETA_Q', asOf: '2026-09-11T14:30:00Z',
  providerTimestamp: '2026-09-11T14:29:59Z', ingestedAt: '2026-09-11T14:30:01Z',
  policyVersion: 'policy-v1', modelVersions: { selector: 'v1' },
  provenance: { quote: 'ALPACA' }, features: { iv: null, spread: 0.04 },
});

test('replay observation has a stable evidence hash and contains no future outcome label', () => {
  const first = observation();
  const second = observation();
  assert.equal(first.contentHash, second.contentHash);
  assert.equal('wholeChainPnl' in first, false);
  assert.equal('managedEpisodeOutcome' in first, false);
});

test('future provider timestamps are rejected rather than leaking into an as-of feature record', () => {
  const value = { ...observation(), providerTimestamp: '2026-09-11T14:31:00Z' };
  assert.equal(replayObservationSchema.safeParse(value).success, false);
});

test('outcome labels cannot predate their observation', () => {
  const input = observation();
  const label: ReplayOutcomeLabel = {
    replayOutcomeLabelId: randomUUID(), replayObservationId: input.replayObservationId,
    labelAvailableAt: '2026-09-11T14:29:00Z', censoringState: 'RESOLVED',
    managedEpisodeOutcome: 'WIN', wholeChainPnl: 10, capitalDays: 5, label: {},
  };
  assert.throws(() => assertLabelAvailableAfterObservation(input, label), /REPLAY_LABEL_PRECEDES_OBSERVATION/);
});
