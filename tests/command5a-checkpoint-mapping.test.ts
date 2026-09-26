import assert from 'node:assert/strict';
import test from 'node:test';
import {
  mapProducerCheckpointToPathCheckpoint, mapPathCheckpointToProducerCheckpoint, classifyObservationJobStateGroup,
} from '../src/research/command5a-checkpoint-mapping.js';

test('every real producer checkpoint value maps to a real consumer value', () => {
  assert.equal(mapProducerCheckpointToPathCheckpoint('15M'), '15M');
  assert.equal(mapProducerCheckpointToPathCheckpoint('1H'), '1H');
  assert.equal(mapProducerCheckpointToPathCheckpoint('EOD'), 'EOD');
  assert.equal(mapProducerCheckpointToPathCheckpoint('1_TRADING_DAY'), '1D');
  assert.equal(mapProducerCheckpointToPathCheckpoint('3_TRADING_DAYS'), '3D');
  assert.equal(mapProducerCheckpointToPathCheckpoint('5_TRADING_DAYS'), '5D');
  assert.equal(mapProducerCheckpointToPathCheckpoint('EXPIRATION'), 'EXPIRATION');
  assert.equal(mapProducerCheckpointToPathCheckpoint('PRIMARY_COMMON_HORIZON'), 'COMMON_HORIZON');
});

test('the mapping round-trips exactly in both directions', () => {
  const producerValues = ['15M', '1H', 'EOD', '1_TRADING_DAY', '3_TRADING_DAYS', '5_TRADING_DAYS', 'EXPIRATION', 'PRIMARY_COMMON_HORIZON'] as const;
  for (const value of producerValues) {
    const consumer = mapProducerCheckpointToPathCheckpoint(value);
    assert.equal(mapPathCheckpointToProducerCheckpoint(consumer), value);
  }
});

test('ADVERSARIAL: an unknown producer enum value throws rather than silently defaulting', () => {
  // Cast through unknown to simulate a version-drifted producer emitting a
  // checkpoint value that does not exist in the current mapping.
  assert.throws(() => mapProducerCheckpointToPathCheckpoint('NEW_UNMAPPED_HORIZON' as never),
    /COMMAND5A_CHECKPOINT_MAPPING_UNKNOWN_PRODUCER_VALUE/);
});

test('ADVERSARIAL: an unknown consumer enum value throws rather than silently defaulting', () => {
  assert.throws(() => mapPathCheckpointToProducerCheckpoint('NEW_UNMAPPED_CHECKPOINT' as never),
    /COMMAND5A_CHECKPOINT_MAPPING_UNKNOWN_CONSUMER_VALUE/);
});

test('CORE CLAIM: PENDING, DUE, and IN_PROGRESS are all distinctly NOT_YET_DUE, never confused with a resolved state', () => {
  assert.equal(classifyObservationJobStateGroup('PENDING'), 'NOT_YET_DUE');
  assert.equal(classifyObservationJobStateGroup('DUE'), 'NOT_YET_DUE');
  assert.equal(classifyObservationJobStateGroup('IN_PROGRESS'), 'NOT_YET_DUE');
});

test('CORE CLAIM: MISSED, DEFERRED_PROVIDER, and DEFERRED_MARKET are three distinct groups', () => {
  const groups = new Set([
    classifyObservationJobStateGroup('MISSED'),
    classifyObservationJobStateGroup('DEFERRED_PROVIDER'),
    classifyObservationJobStateGroup('DEFERRED_MARKET'),
  ]);
  assert.equal(groups.size, 3);
});

test('CORE CLAIM: INVALIDATED and CENSORED are distinct groups, never conflated', () => {
  assert.notEqual(classifyObservationJobStateGroup('INVALIDATED'), classifyObservationJobStateGroup('CENSORED'));
});

test('OBSERVED is its own group, distinct from every other resolved state', () => {
  const resolved = ['OBSERVED', 'MISSED', 'DEFERRED_PROVIDER', 'DEFERRED_MARKET', 'INVALIDATED', 'CENSORED', 'TERMINAL'] as const;
  const groups = new Set(resolved.map((state) => classifyObservationJobStateGroup(state)));
  assert.equal(groups.size, 7);
});
