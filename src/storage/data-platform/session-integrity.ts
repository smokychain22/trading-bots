import { canonicalJson, sha256Hex } from './archive-manifest.js';

export const SESSION_INTEGRITY_VERSION = 'theta-session-integrity-v1' as const;

export interface DecisionIntegrityInput {
  readonly decisionId: string;
  readonly decidedAt: string;
  readonly action: string;
  readonly strategy: string | null;
  readonly selectedCandidateId: string | null;
  readonly quantity: string;
  readonly aegisOutcome: string | null;
  readonly sizingOutcome: string | null;
  readonly bindingConstraint: string | null;
  readonly chainId: string | null;
  readonly archivalTerminal: boolean;
  readonly policyVersions: Readonly<Record<string, string>>;
  readonly sourceSha: string;
  readonly archiveId: string;
  readonly archiveHash: string;
}

export interface DecisionIntegrityLeaf {
  readonly decisionId: string;
  readonly decidedAt: string;
  readonly hash: string;
}

export interface SessionIntegrityManifestBody {
  readonly version: typeof SESSION_INTEGRITY_VERSION;
  readonly sessionId: string;
  readonly sessionDate: string;
  readonly decisionCount: number;
  readonly firstDecisionId: string | null;
  readonly lastDecisionId: string | null;
  readonly archiveIds: readonly string[];
  readonly archiveHashes: readonly string[];
  readonly parquetManifestHashes: readonly string[];
  readonly sourceSha: string;
  readonly policyVersions: Readonly<Record<string, string>>;
  readonly schemaVersions: readonly string[];
  readonly decisionIntegrityRoot: string;
  readonly previousSessionIntegrityRoot: string | null;
  readonly sessionIntegrityRoot: string;
  readonly createdAt: string;
  readonly verifiedAt: string;
}

export interface SessionIntegrityManifest extends SessionIntegrityManifestBody {
  readonly manifestHash: string;
}

const byDecisionOrder = (a: Pick<DecisionIntegrityInput, 'decidedAt' | 'decisionId'>, b: Pick<DecisionIntegrityInput, 'decidedAt' | 'decisionId'>): number =>
  a.decidedAt.localeCompare(b.decidedAt) || a.decisionId.localeCompare(b.decisionId);

export function decisionIntegrityLeaf(input: DecisionIntegrityInput): DecisionIntegrityLeaf {
  return {
    decisionId: input.decisionId,
    decidedAt: input.decidedAt,
    hash: sha256Hex(canonicalJson([SESSION_INTEGRITY_VERSION, 'decision', input])),
  };
}

/** A deterministic binary Merkle root. Odd levels duplicate their final leaf. */
export function merkleRoot(hashes: readonly string[]): string {
  if (hashes.length === 0) return sha256Hex(canonicalJson([SESSION_INTEGRITY_VERSION, 'empty']));
  let level = [...hashes];
  while (level.length > 1) {
    const next: string[] = [];
    for (let index = 0; index < level.length; index += 2) {
      const left = level[index] as string;
      const right = level[index + 1] ?? left;
      next.push(sha256Hex(canonicalJson([SESSION_INTEGRITY_VERSION, 'node', left, right])));
    }
    level = next;
  }
  return level[0] as string;
}

export const chainedSessionRoot = (sessionDate: string, decisionRoot: string, previousRoot: string | null): string =>
  sha256Hex(canonicalJson([SESSION_INTEGRITY_VERSION, 'session', sessionDate, decisionRoot, previousRoot]));

export function buildSessionIntegrityManifest(input: {
  readonly sessionId: string;
  readonly sessionDate: string;
  readonly decisions: readonly DecisionIntegrityInput[];
  readonly parquetManifestHashes: readonly string[];
  readonly sourceSha: string;
  readonly policyVersions: Readonly<Record<string, string>>;
  readonly schemaVersions: readonly string[];
  readonly previousSessionIntegrityRoot: string | null;
  readonly createdAt: string;
  readonly verifiedAt: string;
}): SessionIntegrityManifest {
  const ordered = [...input.decisions].sort(byDecisionOrder);
  const leaves = ordered.map(decisionIntegrityLeaf);
  const decisionIntegrityRoot = merkleRoot(leaves.map((leaf) => leaf.hash));
  const sessionIntegrityRoot = chainedSessionRoot(input.sessionDate, decisionIntegrityRoot, input.previousSessionIntegrityRoot);
  const body: SessionIntegrityManifestBody = {
    version: SESSION_INTEGRITY_VERSION,
    sessionId: input.sessionId,
    sessionDate: input.sessionDate,
    decisionCount: ordered.length,
    firstDecisionId: ordered[0]?.decisionId ?? null,
    lastDecisionId: ordered.at(-1)?.decisionId ?? null,
    archiveIds: [...new Set(ordered.map((decision) => decision.archiveId))].sort(),
    archiveHashes: [...new Set(ordered.map((decision) => decision.archiveHash))].sort(),
    parquetManifestHashes: [...input.parquetManifestHashes].sort(),
    sourceSha: input.sourceSha,
    policyVersions: input.policyVersions,
    schemaVersions: [...input.schemaVersions].sort(),
    decisionIntegrityRoot,
    previousSessionIntegrityRoot: input.previousSessionIntegrityRoot,
    sessionIntegrityRoot,
    createdAt: input.createdAt,
    verifiedAt: input.verifiedAt,
  };
  return { ...body, manifestHash: sha256Hex(canonicalJson(body)) };
}

export function verifySessionIntegrityManifest(manifest: SessionIntegrityManifest, decisions: readonly DecisionIntegrityInput[]): readonly string[] {
  const problems: string[] = [];
  const { manifestHash, ...body } = manifest;
  if (manifest.version !== SESSION_INTEGRITY_VERSION) problems.push('SESSION_MANIFEST_VERSION');
  if (sha256Hex(canonicalJson(body)) !== manifestHash) problems.push('SESSION_MANIFEST_HASH');
  const ordered = [...decisions].sort(byDecisionOrder);
  if (ordered.length !== manifest.decisionCount) problems.push('DECISION_COUNT');
  if ((ordered[0]?.decisionId ?? null) !== manifest.firstDecisionId) problems.push('FIRST_DECISION');
  if ((ordered.at(-1)?.decisionId ?? null) !== manifest.lastDecisionId) problems.push('LAST_DECISION');
  const root = merkleRoot(ordered.map((decision) => decisionIntegrityLeaf(decision).hash));
  if (root !== manifest.decisionIntegrityRoot) problems.push('DECISION_ROOT');
  if (chainedSessionRoot(manifest.sessionDate, root, manifest.previousSessionIntegrityRoot) !== manifest.sessionIntegrityRoot) problems.push('CHAINED_SESSION_ROOT');
  return problems;
}
