export type StorageHome =
  | 'POSTGRESQL'
  | 'SQLITE_WAL'
  | 'PARQUET_DUCKDB'
  | 'GITHUB_REPOSITORY'
  | 'GITHUB_RELEASE'
  | 'GIT_LFS'
  | 'CONTENT_ADDRESSED_ARCHIVE'
  | 'BACKUP_STORAGE'
  | 'MEMORY';

export type RetentionClass =
  | 'PERMANENT_CANONICAL'
  | 'LONG_TERM_AUDIT'
  | 'HOT_OBSERVATION'
  | 'ARCHIVE_AFTER_VERIFICATION'
  | 'DERIVABLE_CACHE';

export type RelationClassification =
  | 'CANONICAL_TRADING_STATE'
  | 'CANONICAL_AUDIT'
  | 'SHORT_RETENTION_OBSERVATION'
  | 'RESEARCH_HISTORY'
  | 'DERIVABLE_CACHE'
  | 'REDUNDANT'
  | 'UNKNOWN_REQUIRES_REVIEW';

export interface StorageAuthorityEntry {
  readonly family: string;
  readonly canonicalHome: StorageHome;
  readonly temporaryHome: StorageHome | null;
  readonly archiveHome: StorageHome | null;
  readonly retentionClass: RetentionClass;
  readonly tradingAuthority: boolean;
  readonly researchAuthority: boolean;
  readonly runtimeState:
    | 'ACTIVE'
    | 'ACTIVE_LOCAL_FRONTIER_ARCHIVE'
    | 'PARTIAL_ARCHIVE_PROVEN_POSTGRES_WRITE_CUTOVER_PENDING';
  readonly rationale: string;
}

export const storageAuthorityRegistry: readonly StorageAuthorityEntry[] = [
  {
    family: 'SOURCE_SCHEMAS_MIGRATIONS_POLICIES_AND_REPRODUCIBILITY_METADATA', canonicalHome: 'GITHUB_REPOSITORY',
    temporaryHome: null, archiveHome: 'GITHUB_RELEASE', retentionClass: 'PERMANENT_CANONICAL',
    tradingAuthority: false, researchAuthority: true,
    runtimeState: 'ACTIVE',
    rationale: 'Private source control is the versioned authority for code, schema, policy, manifests, compact fixtures, and reproducibility metadata.',
  },
  {
    family: 'SMALL_IMMUTABLE_REFERENCE_AND_RESEARCH_ARTIFACTS', canonicalHome: 'GITHUB_REPOSITORY',
    temporaryHome: null, archiveHome: 'GITHUB_RELEASE', retentionClass: 'LONG_TERM_AUDIT',
    tradingAuthority: false, researchAuthority: true,
    runtimeState: 'ACTIVE',
    rationale: 'Compact immutable artifacts that benefit from review and Git history belong in the private repository.',
  },
  {
    family: 'LARGE_IMMUTABLE_VERSIONED_ARTIFACTS', canonicalHome: 'CONTENT_ADDRESSED_ARCHIVE',
    temporaryHome: 'SQLITE_WAL', archiveHome: 'GITHUB_RELEASE', retentionClass: 'ARCHIVE_AFTER_VERIFICATION',
    tradingAuthority: false, researchAuthority: true,
    runtimeState: 'ACTIVE',
    rationale: 'Large immutable artifacts use content-addressed storage, with GitHub Releases or Git LFS considered only under an explicit governed manifest.',
  },
  {
    family: 'DATABASE_RECOVERY_ARTIFACTS', canonicalHome: 'BACKUP_STORAGE',
    temporaryHome: null, archiveHome: 'CONTENT_ADDRESSED_ARCHIVE', retentionClass: 'PERMANENT_CANONICAL',
    tradingAuthority: false, researchAuthority: false,
    runtimeState: 'ACTIVE',
    rationale: 'Database dumps and restore evidence belong in verified recovery storage, never ordinary Git history or hot PostgreSQL.',
  },
  {
    family: 'BROKER_ACCOUNT_ORDER_POSITION_AND_FILL_STATE', canonicalHome: 'POSTGRESQL',
    temporaryHome: 'SQLITE_WAL', archiveHome: 'PARQUET_DUCKDB', retentionClass: 'PERMANENT_CANONICAL',
    tradingAuthority: true, researchAuthority: false,
    runtimeState: 'ACTIVE',
    rationale: 'Transactional broker reconciliation and idempotency require canonical relational state.',
  },
  {
    family: 'STRATEGY_LIFECYCLE_AND_WHOLE_CHAIN_LEDGER', canonicalHome: 'POSTGRESQL',
    temporaryHome: 'SQLITE_WAL', archiveHome: 'PARQUET_DUCKDB', retentionClass: 'PERMANENT_CANONICAL',
    tradingAuthority: true, researchAuthority: true,
    runtimeState: 'ACTIVE',
    rationale: 'Open lifecycle truth and realized chain accounting must remain transactionally consistent.',
  },
  {
    family: 'DECISION_AND_MUTATION_AUDIT_RECEIPTS', canonicalHome: 'POSTGRESQL',
    temporaryHome: 'SQLITE_WAL', archiveHome: 'PARQUET_DUCKDB', retentionClass: 'LONG_TERM_AUDIT',
    tradingAuthority: true, researchAuthority: true,
    runtimeState: 'ACTIVE',
    rationale: 'Immutable decision and mutation receipts support reconciliation, replay, and incident review.',
  },
  {
    family: 'HIGH_FREQUENCY_MARKET_AND_RISK_OBSERVATIONS', canonicalHome: 'PARQUET_DUCKDB',
    temporaryHome: 'SQLITE_WAL', archiveHome: 'PARQUET_DUCKDB', retentionClass: 'HOT_OBSERVATION',
    tradingAuthority: false, researchAuthority: true,
    runtimeState: 'PARTIAL_ARCHIVE_PROVEN_POSTGRES_WRITE_CUTOVER_PENDING',
    rationale: 'Append-heavy observations are kept locally during outages and compacted into verified columnar history.',
  },
  {
    family: 'RESEARCH_DATASETS_MODELS_AND_COUNTERFACTUALS', canonicalHome: 'PARQUET_DUCKDB',
    temporaryHome: 'SQLITE_WAL', archiveHome: 'PARQUET_DUCKDB', retentionClass: 'ARCHIVE_AFTER_VERIFICATION',
    tradingAuthority: false, researchAuthority: true,
    runtimeState: 'PARTIAL_ARCHIVE_PROVEN_POSTGRES_WRITE_CUTOVER_PENDING',
    rationale: 'Large analytical history belongs in compressed, portable, queryable archives rather than the trading database.',
  },
  {
    family: 'CANONICAL_STRATEGY_CANDIDATE_RESEARCH_HISTORY', canonicalHome: 'PARQUET_DUCKDB',
    temporaryHome: 'SQLITE_WAL', archiveHome: 'PARQUET_DUCKDB', retentionClass: 'ARCHIVE_AFTER_VERIFICATION',
    tradingAuthority: false, researchAuthority: true,
    runtimeState: 'ACTIVE_LOCAL_FRONTIER_ARCHIVE',
    rationale: 'The canonical frontier stays in PostgreSQL while its high-volume candidate projection is verified locally and compacted to Parquet.',
  },
  {
    family: 'REBUILDABLE_PROVIDER_AND_FEATURE_CACHES', canonicalHome: 'MEMORY',
    temporaryHome: 'SQLITE_WAL', archiveHome: null, retentionClass: 'DERIVABLE_CACHE',
    tradingAuthority: false, researchAuthority: false,
    runtimeState: 'ACTIVE',
    rationale: 'Caches may be rebuilt from authoritative evidence and must not be presented as canonical facts.',
  },
] as const;

const canonicalTradingSchemas = new Set(['broker', 'customer', 'ledger', 'lifecycle']);
const canonicalAuditSchemas = new Set(['audit', 'evidence', 'ops', 'risk']);
const canonicalControlSchemas = new Set(['core', 'iam']);
const researchHeavyTradeRelations = new Set([
  'candidate_point_in_time_evidence', 'canonical_strategy_candidate_evidence', 'candidate',
  'candidate_reason', 'shadow_opportunity', 'canonical_strategy_branch_evidence',
]);
const canonicalTradeAuditRelations = new Set([
  'decision', 'canonical_strategy_frontier', 'strategy_route', 'broker_activity_fact',
  'broker_reconciliation_snapshot',
]);

export function classifyPostgresRelation(schema: string, relation: string): {
  readonly classification: RelationClassification;
  readonly rationale: string;
} {
  const qualified = `${schema}.${relation}`.toLowerCase();
  const schemaName = schema.toLowerCase();
  const relationName = relation.toLowerCase();
  if (schemaName === 'trade' && researchHeavyTradeRelations.has(relationName)) {
    return { classification: 'RESEARCH_HISTORY', rationale: 'High-volume candidate/counterfactual history, portable after verified archive.' };
  }
  if (schemaName === 'trade' && canonicalTradeAuditRelations.has(relationName)) {
    return { classification: 'CANONICAL_AUDIT', rationale: 'Selected decision, frontier, reconciliation, or broker audit lineage.' };
  }
  if (schemaName === 'trade' && relationName === 'fusion_snapshot') {
    return { classification: 'SHORT_RETENTION_OBSERVATION', rationale: 'Large immutable feature snapshot with bounded PostgreSQL hot retention.' };
  }
  if (schemaName === 'legacy_neon') {
    return { classification: 'RESEARCH_HISTORY', rationale: 'Preserved legacy lineage, recoverable from verified historical archive.' };
  }
  if (schemaName === 'copy') {
    return { classification: relationName.includes('event') || relationName.includes('audit')
      ? 'CANONICAL_AUDIT' : 'CANONICAL_TRADING_STATE', rationale: 'Follower configuration, lifecycle, and copy audit state remain canonical while execution is locked.' };
  }
  if (canonicalControlSchemas.has(schemaName)) {
    return { classification: 'CANONICAL_TRADING_STATE', rationale: 'Identity, provider, policy, and runtime control-plane state.' };
  }
  if (canonicalTradingSchemas.has(schema.toLowerCase())) {
    return { classification: 'CANONICAL_TRADING_STATE', rationale: 'Transactional trading or lifecycle schema.' };
  }
  if (qualified === 'public.schema_migrations' || relation.toLowerCase().includes('migration')) {
    return { classification: 'CANONICAL_AUDIT', rationale: 'Migration history is required to reconstruct schema authority.' };
  }
  if (canonicalAuditSchemas.has(schema.toLowerCase())) {
    return { classification: 'CANONICAL_AUDIT', rationale: 'Operational evidence and immutable audit receipt schema.' };
  }
  if (schemaName === 'research') {
    return { classification: 'RESEARCH_HISTORY', rationale: 'Research history is portable to verified Parquet/DuckDB archives.' };
  }
  if (schemaName === 'market' || /observation|snapshot|quote|bar|metric|flow|event_revision/.test(qualified)) {
    return { classification: 'SHORT_RETENTION_OBSERVATION', rationale: 'Append-heavy observation family with bounded hot retention.' };
  }
  if (/cache|materialized|derived|feature/.test(qualified)) {
    return { classification: 'DERIVABLE_CACHE', rationale: 'Derived or cached state can be rebuilt from preserved evidence.' };
  }
  if (schemaName === 'trade') {
    return { classification: 'CANONICAL_AUDIT', rationale: 'Trade decisions and candidate evidence are retained as canonical audit lineage.' };
  }
  return { classification: 'UNKNOWN_REQUIRES_REVIEW', rationale: 'No governed storage classification rule matches this relation.' };
}

export function authorityForClassification(classification: RelationClassification): StorageAuthorityEntry | null {
  const family = classification === 'CANONICAL_TRADING_STATE' ? 'BROKER_ACCOUNT_ORDER_POSITION_AND_FILL_STATE'
    : classification === 'CANONICAL_AUDIT' ? 'DECISION_AND_MUTATION_AUDIT_RECEIPTS'
      : classification === 'SHORT_RETENTION_OBSERVATION' ? 'HIGH_FREQUENCY_MARKET_AND_RISK_OBSERVATIONS'
        : classification === 'RESEARCH_HISTORY' ? 'RESEARCH_DATASETS_MODELS_AND_COUNTERFACTUALS'
          : classification === 'DERIVABLE_CACHE' ? 'REBUILDABLE_PROVIDER_AND_FEATURE_CACHES'
            : null;
  if (family !== null) return storageAuthorityRegistry.find((entry) => entry.family === family) ?? null;
  return null;
}
