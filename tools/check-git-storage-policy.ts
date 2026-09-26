import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import {
  assessGitArtifact, inferTrackedArtifactKind,
  type GitStorageDisposition,
} from '../src/storage/github-storage-policy.js';

const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 })
  .split('\0').filter(Boolean);
const rejected = new Set<GitStorageDisposition>([
  'PROHIBITED', 'ARCHIVE_STORAGE_REQUIRED', 'BACKUP_STORAGE_REQUIRED',
  'GITHUB_RELEASE_OR_GIT_LFS_REVIEW_REQUIRED',
]);
const findings: Array<{ readonly path: string; readonly disposition: GitStorageDisposition; readonly reason: string }> = [];

for (const path of tracked) {
  const metadata = statSync(path);
  if (!metadata.isFile()) continue;
  const prefix = metadata.size <= 256 ? readFileSync(path, { encoding: 'utf8' }) : '';
  const decision = assessGitArtifact({
    path,
    bytes: metadata.size,
    kind: inferTrackedArtifactKind(path),
    gitLfsPointer: prefix.startsWith('version https://git-lfs.github.com/spec/v1'),
  });
  if (rejected.has(decision.disposition)) findings.push({ path, ...decision });
}

process.stdout.write(`${JSON.stringify({
  policyVersion: 'theta-github-storage-policy-v1',
  trackedFiles: tracked.length,
  findings,
  state: findings.length === 0 ? 'PASS' : 'FAIL',
})}\n`);
process.exitCode = findings.length === 0 ? 0 : 1;
