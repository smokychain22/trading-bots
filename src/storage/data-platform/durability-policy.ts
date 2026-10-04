// The two-authority purge rule, as ONE auditable function. A hot partition may become purge-eligible only when
//   1. the PRIMARY archive object re-verifies right now (content hash re-computed from the bytes), AND
//   2. a SECOND independent authority holds the same data: either a verified second archive copy, OR a verified DR backup that started after the archive was created, AND
//   3. (policy default) at least one verified authority is OFF-MACHINE. The laptop that runs the worker must never be the sole holder of cold data.
// Every verdict carries the evidence list so the purge packet and the weekly receipt show exactly which authority said what.
import { sha256Hex, type DataPlatformArchiveManifest } from './archive-manifest.js';
import type { DrBackupStatus, DurabilityCheck } from './durability.js';
import type { ProductionArchiveBackend } from './archive-remote.js';

export type AuthorityKind = 'PRIMARY_ARCHIVE' | 'SECOND_ARCHIVE' | 'DR_BACKUP';
export interface AuthorityEvidence { readonly authority: AuthorityKind; readonly verified: boolean; readonly offMachine: boolean; readonly detail: string }
export interface PurgeDurabilityVerdict { readonly eligible: boolean; readonly reasons: readonly string[]; readonly evidence: readonly AuthorityEvidence[] }

export interface PurgeDurabilityDeps {
  readonly primary: ProductionArchiveBackend;
  readonly keyFor: (manifest: DataPlatformArchiveManifest) => string;
  readonly secondary?: ProductionArchiveBackend;
  readonly secondaryKeyFor?: (manifest: DataPlatformArchiveManifest) => string;
  /** most recent verified DR backup (start and verification time) or null */
  readonly drBackup?: () => Promise<DrBackupStatus | null>;
  /** where the DR backups live: false when they are on the same machine as the worker */
  readonly drBackupOffMachine?: boolean;
  readonly policy?: { readonly requireOffMachineCopy: boolean };
}

async function verified(backend: ProductionArchiveBackend, key: string, manifest: DataPlatformArchiveManifest): Promise<{ ok: boolean; detail: string }> {
  try { const result = await backend.verify(key, manifest.fileHash); return { ok: result.ok, detail: result.reason }; } catch (error) { return { ok: false, detail: `VERIFY_ERROR:${error instanceof Error ? error.message : String(error)}` }; }
}

export async function evaluatePurgeDurability(manifest: DataPlatformArchiveManifest, deps: PurgeDurabilityDeps): Promise<PurgeDurabilityVerdict> {
  const evidence: AuthorityEvidence[] = [];
  const reasons: string[] = [];
  const primary = await verified(deps.primary, deps.keyFor(manifest), manifest);
  evidence.push({ authority: 'PRIMARY_ARCHIVE', verified: primary.ok, offMachine: deps.primary.durabilityClass === 'REMOTE_OBJECT_STORE', detail: `${deps.primary.identity()}:${primary.detail}` });
  if (!primary.ok) reasons.push(`PRIMARY_ARCHIVE_NOT_VERIFIED:${primary.detail}`);

  let secondOk = false;
  if (deps.secondary !== undefined && deps.secondaryKeyFor !== undefined) {
    const second = await verified(deps.secondary, deps.secondaryKeyFor(manifest), manifest);
    evidence.push({ authority: 'SECOND_ARCHIVE', verified: second.ok, offMachine: deps.secondary.durabilityClass === 'REMOTE_OBJECT_STORE', detail: `${deps.secondary.identity()}:${second.detail}` });
    secondOk = second.ok;
  }
  let drOk = false;
  if (deps.drBackup !== undefined) {
    const status = await deps.drBackup().catch(() => null);
    drOk = status !== null && status.verifiedAt !== null && Date.parse(status.startedAt) > Date.parse(manifest.createdAt);
    evidence.push({ authority: 'DR_BACKUP', verified: drOk, offMachine: deps.drBackupOffMachine === true, detail: status === null ? 'NO_VERIFIED_DR_BACKUP' : drOk ? 'DR_BACKUP_VERIFIED_AFTER_ARCHIVE' : 'DR_BACKUP_OLDER_THAN_ARCHIVE_OR_UNVERIFIED' });
  }
  if (!secondOk && !drOk) reasons.push('SECOND_AUTHORITY_MISSING:no verified second archive copy and no verified DR backup newer than the archive');
  const requireOffMachine = deps.policy?.requireOffMachineCopy ?? true;
  if (requireOffMachine && !evidence.some((entry) => entry.verified && entry.offMachine)) reasons.push('OFF_MACHINE_COPY_REQUIRED:the laptop would be the sole holder of cold data (a remote archive target must be configured)');
  return { eligible: reasons.length === 0, reasons, evidence };
}

/** Adapter for the retirement pipeline. */
export function purgeDurabilityCheck(deps: PurgeDurabilityDeps): DurabilityCheck {
  return async (manifest) => {
    const verdict = await evaluatePurgeDurability(manifest, deps);
    return { ok: verdict.eligible, reason: verdict.eligible ? 'TWO_AUTHORITIES_VERIFIED' : verdict.reasons.join('|') };
  };
}

/** For the weekly integrity task and the purge packet: the exact hash the verdict was computed against. */
export const verdictFingerprint = (manifest: DataPlatformArchiveManifest, verdict: PurgeDurabilityVerdict): string => sha256Hex(JSON.stringify({ archive: manifest.archiveId, hash: manifest.fileHash, eligible: verdict.eligible, evidence: verdict.evidence }));
