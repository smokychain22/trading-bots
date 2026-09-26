// Phase 1 Zero-Unknown Reclosure Pass 3 continuation (items 2-6): the ONE
// resolver for "what source produced this decision cycle's evidence,"
// reused everywhere a decision needs to persist a real, fail-closed release
// identity. This is NOT the same question `inspectRuntimeSchemaCompatibility`
// answers (whether the deployed Vercel code and the calling local worker's
// pinned release currently AGREE) -- that check must keep comparing the two
// raw values for drift and must not be rewired through this resolver, or
// the schema-incompatibility gate this repo depends on would stop detecting
// exactly the kind of drift Pass 2/3 found in production (worker pinned 15
// commits behind the live checkout).
const fullSha = /^[0-9a-f]{40}$/;

export type ReleaseRuntimeKind = 'VERCEL' | 'LOCAL_PINNED_RELEASE' | 'UNKNOWN';
export type ReleaseIdentityValidationState = 'RESOLVED' | 'SOURCE_IDENTITY_UNAVAILABLE';

export interface ResolvedReleaseIdentity {
  readonly runtimeKind: ReleaseRuntimeKind;
  readonly sourceSha: string | null;
  readonly workerBuildSha: string | null;
  readonly identitySource: string;
  readonly validationState: ReleaseIdentityValidationState;
}

/**
 * Proven invariant (`tools/windows/install-theta-local-worker.ps1:8,31,37`):
 * a LOCAL_PINNED_RELEASE's `buildSha` is not an opaque worker label -- it is
 * a `git worktree add --detach <releasePath> <buildSha>` checkout, and the
 * install script itself throws `THETA_RELEASE_SHA_MISMATCH` if that release
 * directory's own `git rev-parse HEAD` ever disagrees with `buildSha`.
 * Independently re-verified this pass: `git -C
 * .theta-local-worker/releases/af3d43d1... rev-parse HEAD` returns exactly
 * `af3d43d1...`. That makes a full-40-hex local `buildSha` legitimately
 * BOTH the running process's build identity AND its real source identity --
 * this function documents that as the one place this claim is made, never
 * copied elsewhere without this same proof standing behind it. A short
 * (abbreviated) SHA is not accepted as a source identity: fail closed rather
 * than risk ambiguity.
 */
export function resolveReleaseIdentity(input: {
  readonly vercelGitCommitSha: string | null | undefined;
  readonly localWorkerBuildSha: string | null;
}): ResolvedReleaseIdentity {
  if (input.localWorkerBuildSha !== null && fullSha.test(input.localWorkerBuildSha)) {
    return {
      runtimeKind: 'LOCAL_PINNED_RELEASE',
      sourceSha: input.localWorkerBuildSha,
      workerBuildSha: input.localWorkerBuildSha,
      identitySource: 'LOCAL_PINNED_RELEASE_WORKTREE_HEAD',
      validationState: 'RESOLVED',
    };
  }
  if (typeof input.vercelGitCommitSha === 'string' && fullSha.test(input.vercelGitCommitSha)) {
    return {
      runtimeKind: 'VERCEL',
      sourceSha: input.vercelGitCommitSha,
      workerBuildSha: null,
      identitySource: 'VERCEL_GIT_COMMIT_SHA',
      validationState: 'RESOLVED',
    };
  }
  return {
    runtimeKind: 'UNKNOWN',
    sourceSha: null,
    workerBuildSha: null,
    identitySource: 'NONE',
    validationState: 'SOURCE_IDENTITY_UNAVAILABLE',
  };
}
