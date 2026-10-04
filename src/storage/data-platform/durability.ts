// Retirement-time durability gates. An archive that lives on ONE disk is not enough to remove the only other copy (the hot partition). A partition may be retired when
//   (a) a SECOND archive backend holds the identical object, OR
//   (b) a VERIFIED disaster-recovery backup that STARTED after the archive was created contains the hot partition (it was complete and still in PostgreSQL then).
// Neither is a vendor choice; (a) needs an off-disk target configured by the owner, (b) uses the existing verified-backup system and expires with its retention.
import type { ArchiveBackend } from './archive-backend.js';
import { sha256Hex, type DataPlatformArchiveManifest } from './archive-manifest.js';

export type DurabilityCheck = (manifest: DataPlatformArchiveManifest) => Promise<{ readonly ok: boolean; readonly reason: string }>;

export function secondCopyDurability(secondary: ArchiveBackend, objectKeyFor: (manifest: DataPlatformArchiveManifest) => string): DurabilityCheck {
  return async (manifest) => {
    const bytes = await secondary.get(objectKeyFor(manifest)).catch(() => null);
    if (bytes === null) return { ok: false, reason: 'SECOND_COPY_MISSING' };
    return sha256Hex(bytes) === manifest.fileHash ? { ok: true, reason: 'SECOND_COPY_VERIFIED' } : { ok: false, reason: 'SECOND_COPY_HASH_MISMATCH' };
  };
}

export interface DrBackupStatus { readonly startedAt: string; readonly verifiedAt: string | null }

/** `readStatus` returns the most recent verified backup (start time and verification time), or null if none. */
export function drBackupDurability(readStatus: () => Promise<DrBackupStatus | null>): DurabilityCheck {
  return async (manifest) => {
    const status = await readStatus();
    if (status === null || status.verifiedAt === null) return { ok: false, reason: 'NO_VERIFIED_DR_BACKUP' };
    return Date.parse(status.startedAt) > Date.parse(manifest.createdAt) ? { ok: true, reason: 'DR_BACKUP_VERIFIED_AFTER_ARCHIVE' } : { ok: false, reason: 'DR_BACKUP_OLDER_THAN_ARCHIVE' };
  };
}

export function anyDurability(...checks: readonly DurabilityCheck[]): DurabilityCheck {
  return async (manifest) => {
    const reasons: string[] = [];
    for (const check of checks) {
      const result = await check(manifest).catch((error: unknown) => ({ ok: false, reason: `CHECK_ERROR:${error instanceof Error ? error.message : String(error)}` }));
      if (result.ok) return result;
      reasons.push(result.reason);
    }
    return { ok: false, reason: reasons.join('|') || 'NO_DURABILITY_CHECK_CONFIGURED' };
  };
}

/** Parses the start time out of a backup id of the form 2026-10-03_023612-c03d5f99 (UTC start of the dump). */
export function backupStartFromId(backupId: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})(\d{2})-[0-9a-f]{8}$/.exec(backupId);
  return match === null ? null : `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}Z`;
}
