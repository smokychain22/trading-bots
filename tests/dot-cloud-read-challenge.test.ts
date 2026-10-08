import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { buildDotCloudReadChallenge, verifyDotCloudReadResponse } from '../src/lab/cloud-read-challenge.js';

const path = 'research/dot-proposals/examples/theta-hold-strike.json';
const proposal = JSON.parse(readFileSync(path, 'utf8'));
const ref = '2cb0d470f473132e80d44c2a2c051765e525afee';
test('versioned proposal challenge verifies content without fabricating cloud origin', () => {
  const challenge = buildDotCloudReadChallenge(ref, path, proposal, randomUUID());
  const response = { challengeId: challenge.challengeId, ref, path, proposal };
  const result = verifyDotCloudReadResponse(challenge, response);
  assert.equal(result.contentVerified, true);
  assert.equal(result.dotCloudConnectionProven, false);
  assert.throws(() => verifyDotCloudReadResponse(challenge, { ...response, claimedOrigin: 'DOT_CLOUD' }));
  for (const change of [{ ref: 'a'.repeat(40) }, { path: 'other' }, { challengeId: randomUUID() },
    { proposal: { ...proposal, hypothesis: 'Tampered economic hypothesis.' } }]) {
    assert.throws(() => verifyDotCloudReadResponse(challenge, { ...response, ...change }), /MISMATCH/);
  }
});
