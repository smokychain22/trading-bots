import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveReleaseIdentity } from '../src/theta/release-identity.js';

// Phase 1 Zero-Unknown Reclosure Pass 3 continuation (items 2-5): the one
// resolver deciding what release identity a decision cycle actually ran
// under. Covers exactly the scenarios the owner's directive named: valid
// Vercel SHA, valid local pinned SHA, missing both, malformed SHA, and a
// local worker call taking priority when both are present (the local
// worker's pinned release is the more precise, request-scoped identity;
// see release-identity.ts's own doc comment for the proof this rests on).

const validSha = 'af3d43d14d703c47ff52e833588130af60d61e48';
const otherValidSha = '47bbf9905a27a7231a5f47cab7c777c48d29b632';

test('valid Vercel SHA, no local worker: resolves VERCEL, sourceSha = the Vercel SHA', () => {
  const result = resolveReleaseIdentity({ vercelGitCommitSha: validSha, localWorkerBuildSha: null });
  assert.deepEqual(result, {
    runtimeKind: 'VERCEL', sourceSha: validSha, workerBuildSha: null,
    identitySource: 'VERCEL_GIT_COMMIT_SHA', validationState: 'RESOLVED',
  });
});

test('valid local pinned release SHA: resolves LOCAL_PINNED_RELEASE, sourceSha = workerBuildSha = the pinned SHA (never null)', () => {
  const result = resolveReleaseIdentity({ vercelGitCommitSha: undefined, localWorkerBuildSha: validSha });
  assert.deepEqual(result, {
    runtimeKind: 'LOCAL_PINNED_RELEASE', sourceSha: validSha, workerBuildSha: validSha,
    identitySource: 'LOCAL_PINNED_RELEASE_WORKTREE_HEAD', validationState: 'RESOLVED',
  });
});

test('both present: the local worker\'s pinned release takes priority over the Vercel deploy SHA', () => {
  const result = resolveReleaseIdentity({ vercelGitCommitSha: otherValidSha, localWorkerBuildSha: validSha });
  assert.equal(result.runtimeKind, 'LOCAL_PINNED_RELEASE');
  assert.equal(result.sourceSha, validSha);
});

test('missing both: fails closed to UNKNOWN/SOURCE_IDENTITY_UNAVAILABLE, never a fabricated SHA', () => {
  const result = resolveReleaseIdentity({ vercelGitCommitSha: undefined, localWorkerBuildSha: null });
  assert.deepEqual(result, {
    runtimeKind: 'UNKNOWN', sourceSha: null, workerBuildSha: null,
    identitySource: 'NONE', validationState: 'SOURCE_IDENTITY_UNAVAILABLE',
  });
});

test('malformed SHA (short/abbreviated, or non-hex): rejected, never accepted as a source identity', () => {
  const short = resolveReleaseIdentity({ vercelGitCommitSha: undefined, localWorkerBuildSha: 'af3d43d' });
  assert.equal(short.validationState, 'SOURCE_IDENTITY_UNAVAILABLE');
  const nonHex = resolveReleaseIdentity({ vercelGitCommitSha: 'not-a-real-sha'.padEnd(40, 'g'), localWorkerBuildSha: null });
  assert.equal(nonHex.validationState, 'SOURCE_IDENTITY_UNAVAILABLE');
  const empty = resolveReleaseIdentity({ vercelGitCommitSha: '', localWorkerBuildSha: '' });
  assert.equal(empty.validationState, 'SOURCE_IDENTITY_UNAVAILABLE');
});
