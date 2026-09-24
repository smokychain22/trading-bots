import type { RetentionClass } from './storage-authority-registry.js';

export interface ArchiveVerificationEvidence {
  readonly manifestVerified: boolean;
  readonly sourceRowCount: number;
  readonly archivedRowCount: number;
  readonly sourceDigest: string;
  readonly archivedDigest: string;
  readonly parquetReadable: boolean;
  readonly schemaVerified: boolean;
}

export type RetentionDisposition =
  | 'KEEP_CANONICAL'
  | 'KEEP_HOT'
  | 'ELIGIBLE_FOR_GOVERNED_ARCHIVE_CLEANUP'
  | 'BLOCKED_ARCHIVE_NOT_VERIFIED'
  | 'OWNER_APPROVAL_REQUIRED';

export function evaluateRetentionDisposition(
  retentionClass: RetentionClass,
  archive: ArchiveVerificationEvidence | null,
): RetentionDisposition {
  if (retentionClass === 'PERMANENT_CANONICAL' || retentionClass === 'LONG_TERM_AUDIT') return 'KEEP_CANONICAL';
  if (retentionClass === 'HOT_OBSERVATION') return 'KEEP_HOT';
  if (retentionClass === 'DERIVABLE_CACHE') return 'OWNER_APPROVAL_REQUIRED';
  if (archive === null) return 'BLOCKED_ARCHIVE_NOT_VERIFIED';
  const verified = archive.manifestVerified && archive.parquetReadable && archive.schemaVerified
    && archive.sourceRowCount === archive.archivedRowCount
    && archive.sourceDigest.length === 64 && archive.sourceDigest === archive.archivedDigest;
  return verified ? 'ELIGIBLE_FOR_GOVERNED_ARCHIVE_CLEANUP' : 'BLOCKED_ARCHIVE_NOT_VERIFIED';
}
