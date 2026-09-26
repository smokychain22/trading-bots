import assert from 'node:assert/strict';
import test from 'node:test';
import { assessGitArtifact, inferTrackedArtifactKind, ordinaryGitMaximumBytes } from '../src/storage/github-storage-policy.js';

test('ordinary Git accepts compact source and immutable reference artifacts', () => {
  assert.equal(assessGitArtifact({
    path: 'src/policy.ts', bytes: 1_000, kind: 'SOURCE_OR_CONFIGURATION', gitLfsPointer: false,
  }).disposition, 'ORDINARY_GIT_ALLOWED');
  assert.equal(assessGitArtifact({
    path: 'fixtures/reference.json', bytes: ordinaryGitMaximumBytes, kind: 'SMALL_IMMUTABLE_REFERENCE', gitLfsPointer: false,
  }).disposition, 'ORDINARY_GIT_ALLOWED');
});

test('large, mutable, recovery, and secret artifacts cannot enter ordinary Git', () => {
  assert.equal(assessGitArtifact({
    path: 'model.bin', bytes: ordinaryGitMaximumBytes + 1, kind: 'LARGE_IMMUTABLE_ARTIFACT', gitLfsPointer: false,
  }).disposition, 'GITHUB_RELEASE_OR_GIT_LFS_REVIEW_REQUIRED');
  assert.equal(assessGitArtifact({
    path: 'history.parquet', bytes: 1, kind: 'CONTINUOUS_OR_MUTABLE_DATA', gitLfsPointer: false,
  }).disposition, 'ARCHIVE_STORAGE_REQUIRED');
  assert.equal(assessGitArtifact({
    path: 'db.backup', bytes: 1, kind: 'DATABASE_RECOVERY_ARTIFACT', gitLfsPointer: false,
  }).disposition, 'BACKUP_STORAGE_REQUIRED');
  assert.equal(assessGitArtifact({
    path: '.env.production', bytes: 1, kind: 'SECRET_OR_CREDENTIAL', gitLfsPointer: false,
  }).disposition, 'PROHIBITED');
});

test('tracked path inference keeps runtime databases and dumps out of Git', () => {
  assert.equal(inferTrackedArtifactKind('research_outputs/chain.sqlite'), 'CONTINUOUS_OR_MUTABLE_DATA');
  assert.equal(inferTrackedArtifactKind('recovery/database.dump'), 'DATABASE_RECOVERY_ARTIFACT');
  assert.equal(inferTrackedArtifactKind('docs/reference/compact.json'), 'SMALL_IMMUTABLE_REFERENCE');
  assert.equal(inferTrackedArtifactKind('bots/theta/quant/runtime/aegis_contract.py'), 'SOURCE_OR_CONFIGURATION');
  assert.equal(inferTrackedArtifactKind('src/customer/broker-credential-provider.ts'), 'SOURCE_OR_CONFIGURATION');
  assert.equal(inferTrackedArtifactKind('.env.example'), 'SOURCE_OR_CONFIGURATION');
});
