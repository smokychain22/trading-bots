import type { RelationClassification, RetentionClass, StorageHome } from './storage-authority-registry.js';

export type GovernedRelationClassification = Exclude<RelationClassification, 'UNKNOWN_REQUIRES_REVIEW'>;

export interface StorageDatasetPolicy {
  readonly classification: GovernedRelationClassification;
  readonly owner: 'TRADING_RUNTIME' | 'OPERATIONS' | 'RESEARCH' | 'PROVIDER_ADAPTER';
  readonly retentionClass: RetentionClass;
  readonly maximumInlinePayloadBytes: number;
  readonly canonicalHome: StorageHome;
  readonly archiveFormat: 'NONE' | 'ZSTD_PARQUET';
  readonly reconstructionKey: string;
  readonly truthRequirements: readonly string[];
  readonly botNamespaceRequired: true;
  readonly cleanupAuthority: 'NEVER_AUTOMATIC' | 'VERIFIED_ARCHIVE_AND_OWNER_APPROVAL';
}

/**
 * Class-level bootstrap policy. Relation-specific exceptions require a reviewed
 * registry entry. No entry authorizes automatic deletion from PostgreSQL.
 */
export const storageDatasetPolicies: readonly StorageDatasetPolicy[] = [
  {
    classification: 'CANONICAL_TRADING_STATE',
    owner: 'TRADING_RUNTIME',
    retentionClass: 'PERMANENT_CANONICAL',
    maximumInlinePayloadBytes: 64 * 1024,
    canonicalHome: 'POSTGRESQL',
    archiveFormat: 'ZSTD_PARQUET',
    reconstructionKey: 'bot_id + canonical entity identity + observed_at/version',
    truthRequirements: ['transactional integrity', 'broker reconciliation identity', 'idempotent mutation lineage'],
    botNamespaceRequired: true,
    cleanupAuthority: 'NEVER_AUTOMATIC',
  },
  {
    classification: 'CANONICAL_AUDIT',
    owner: 'OPERATIONS',
    retentionClass: 'LONG_TERM_AUDIT',
    maximumInlinePayloadBytes: 768 * 1024,
    canonicalHome: 'POSTGRESQL',
    archiveFormat: 'ZSTD_PARQUET',
    reconstructionKey: 'bot_id + receipt/event identity + observed_at',
    truthRequirements: ['immutable receipt identity', 'content hash', 'source release identity'],
    botNamespaceRequired: true,
    cleanupAuthority: 'NEVER_AUTOMATIC',
  },
  {
    classification: 'SHORT_RETENTION_OBSERVATION',
    owner: 'PROVIDER_ADAPTER',
    retentionClass: 'HOT_OBSERVATION',
    maximumInlinePayloadBytes: 4 * 1024 * 1024,
    canonicalHome: 'PARQUET_DUCKDB',
    archiveFormat: 'ZSTD_PARQUET',
    reconstructionKey: 'bot_id + provider + instrument identity + provider timestamp + received_at',
    truthRequirements: ['provider provenance', 'provider and received timestamps', 'content hash', 'archive row-count parity'],
    botNamespaceRequired: true,
    cleanupAuthority: 'VERIFIED_ARCHIVE_AND_OWNER_APPROVAL',
  },
  {
    classification: 'RESEARCH_HISTORY',
    owner: 'RESEARCH',
    retentionClass: 'ARCHIVE_AFTER_VERIFICATION',
    maximumInlinePayloadBytes: 64 * 1024,
    canonicalHome: 'PARQUET_DUCKDB',
    archiveFormat: 'ZSTD_PARQUET',
    reconstructionKey: 'bot_id + evidence/subject identity + feature_available_at + label_available_at',
    truthRequirements: ['point-in-time provenance', 'content hash', 'source release identity', 'archive row-count parity'],
    botNamespaceRequired: true,
    cleanupAuthority: 'VERIFIED_ARCHIVE_AND_OWNER_APPROVAL',
  },
  {
    classification: 'DERIVABLE_CACHE',
    owner: 'OPERATIONS',
    retentionClass: 'DERIVABLE_CACHE',
    maximumInlinePayloadBytes: 32 * 1024,
    canonicalHome: 'MEMORY',
    archiveFormat: 'NONE',
    reconstructionKey: 'bot_id + derivation version + authoritative evidence identities',
    truthRequirements: ['derivation version', 'authoritative input identities', 'rebuild proof'],
    botNamespaceRequired: true,
    cleanupAuthority: 'VERIFIED_ARCHIVE_AND_OWNER_APPROVAL',
  },
  {
    classification: 'REDUNDANT',
    owner: 'OPERATIONS',
    retentionClass: 'ARCHIVE_AFTER_VERIFICATION',
    maximumInlinePayloadBytes: 0,
    canonicalHome: 'CONTENT_ADDRESSED_ARCHIVE',
    archiveFormat: 'ZSTD_PARQUET',
    reconstructionKey: 'bot_id + original relation/key + content hash',
    truthRequirements: ['superseding authority identity', 'content hash', 'verified archive parity'],
    botNamespaceRequired: true,
    cleanupAuthority: 'VERIFIED_ARCHIVE_AND_OWNER_APPROVAL',
  },
] as const;

export function datasetPolicyForClassification(
  classification: RelationClassification,
): StorageDatasetPolicy | null {
  if (classification === 'UNKNOWN_REQUIRES_REVIEW') return null;
  return storageDatasetPolicies.find((policy) => policy.classification === classification) ?? null;
}

export function assertInlinePayloadWithinPolicy(input: {
  readonly classification: GovernedRelationClassification;
  readonly serializedBytes: number;
  readonly errorCode: string;
}): void {
  if (!Number.isInteger(input.serializedBytes) || input.serializedBytes < 0) {
    throw new Error('STORAGE_INLINE_PAYLOAD_SIZE_INVALID');
  }
  if (!/^[A-Z][A-Z0-9_]+$/.test(input.errorCode)) throw new Error('STORAGE_INLINE_PAYLOAD_ERROR_CODE_INVALID');
  const policy = datasetPolicyForClassification(input.classification);
  if (policy === null) throw new Error('STORAGE_DATASET_POLICY_MISSING');
  if (input.serializedBytes > policy.maximumInlinePayloadBytes) {
    throw new Error(`${input.errorCode}:${input.serializedBytes}:${policy.maximumInlinePayloadBytes}`);
  }
}
