export type GitArtifactKind =
  | 'SOURCE_OR_CONFIGURATION'
  | 'SMALL_IMMUTABLE_REFERENCE'
  | 'LARGE_IMMUTABLE_ARTIFACT'
  | 'CONTINUOUS_OR_MUTABLE_DATA'
  | 'DATABASE_RECOVERY_ARTIFACT'
  | 'SECRET_OR_CREDENTIAL';

export type GitStorageDisposition =
  | 'ORDINARY_GIT_ALLOWED'
  | 'GITHUB_RELEASE_OR_GIT_LFS_REVIEW_REQUIRED'
  | 'ARCHIVE_STORAGE_REQUIRED'
  | 'BACKUP_STORAGE_REQUIRED'
  | 'PROHIBITED';

export interface GitArtifactPolicyInput {
  readonly path: string;
  readonly bytes: number;
  readonly kind: GitArtifactKind;
  readonly gitLfsPointer: boolean;
}

export interface GitArtifactPolicyDecision {
  readonly disposition: GitStorageDisposition;
  readonly reason: string;
}

export const ordinaryGitMaximumBytes = 10 * 1024 * 1024;

const runtimeBinaryExtension = /\.(?:backup|dump|sqlite|sqlite3|duckdb|parquet|wal)$/i;

export function assessGitArtifact(input: GitArtifactPolicyInput): GitArtifactPolicyDecision {
  if (!Number.isSafeInteger(input.bytes) || input.bytes < 0) {
    throw new Error('INVALID_GIT_ARTIFACT_SIZE');
  }
  if (input.kind === 'SECRET_OR_CREDENTIAL') {
    return { disposition: 'PROHIBITED', reason: 'Secrets and credentials must never enter Git or release artifacts.' };
  }
  if (input.kind === 'DATABASE_RECOVERY_ARTIFACT') {
    return { disposition: 'BACKUP_STORAGE_REQUIRED', reason: 'Database recovery artifacts require verified backup storage.' };
  }
  if (input.kind === 'CONTINUOUS_OR_MUTABLE_DATA' || runtimeBinaryExtension.test(input.path)) {
    return { disposition: 'ARCHIVE_STORAGE_REQUIRED', reason: 'Continuously growing or mutable binary data belongs in SQLite, Parquet, or content-addressed archive storage.' };
  }
  if (input.gitLfsPointer) {
    return { disposition: 'GITHUB_RELEASE_OR_GIT_LFS_REVIEW_REQUIRED', reason: 'Git LFS use requires an explicit governed artifact manifest and retention owner.' };
  }
  if (input.kind === 'LARGE_IMMUTABLE_ARTIFACT' || input.bytes > ordinaryGitMaximumBytes) {
    return { disposition: 'GITHUB_RELEASE_OR_GIT_LFS_REVIEW_REQUIRED', reason: 'Large immutable artifacts must not inflate ordinary Git history.' };
  }
  return { disposition: 'ORDINARY_GIT_ALLOWED', reason: 'Compact source, configuration, fixture, or immutable reference artifact is suitable for versioned Git history.' };
}

export function inferTrackedArtifactKind(path: string): GitArtifactKind {
  const normalized = path.replaceAll('\\', '/').toLowerCase();
  if (/(^|\/)\.env(?:\.|$)/.test(normalized) && !normalized.endsWith('.env.example')) return 'SECRET_OR_CREDENTIAL';
  if (/(^|\/)(?:credentials?|secrets?|private[-_]?keys?)(?:\.[^/]*)?$/.test(normalized)) return 'SECRET_OR_CREDENTIAL';
  if (/\.(?:backup|dump)$/.test(normalized) || /(^|\/)backups?\//.test(normalized)) return 'DATABASE_RECOVERY_ARTIFACT';
  if (/\.(?:sqlite|sqlite3|duckdb|parquet|wal)$/.test(normalized)
    || /(^|\/)(?:research[_-]?(?:exports?|outputs?)|spool|observations?|option[_-]?chains?)\//.test(normalized)) {
    return 'CONTINUOUS_OR_MUTABLE_DATA';
  }
  if (/\.(?:bin|zip|zst|gz|tar|onnx|pt|pth|h5|pkl|joblib)$/.test(normalized)) return 'LARGE_IMMUTABLE_ARTIFACT';
  if (/(^|\/)(?:fixtures?|reference|manifests?)\//.test(normalized)) return 'SMALL_IMMUTABLE_REFERENCE';
  return 'SOURCE_OR_CONFIGURATION';
}
