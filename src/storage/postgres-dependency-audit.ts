import type { RelationClassification } from './storage-authority-registry.js';

export type PostgresDependencyClass =
  | 'SAFETY_REQUIRED'
  | 'CANONICAL_STATE_REQUIRED'
  | 'PERSISTENCE_ONLY'
  | 'RESEARCH_ONLY'
  | 'ACCIDENTAL_COUPLING';

export type PostgresReferenceMode = 'READ' | 'WRITE' | 'READ_WRITE';

export interface PostgresDependencyCallsite {
  readonly file: string;
  readonly relation: string;
  readonly mode: PostgresReferenceMode;
  readonly dependencyClass: PostgresDependencyClass;
}

const normalized = (file: string): string => file.replaceAll('\\', '/').toLowerCase();

export function classifyDependencyCallsite(
  file: string,
  mode: PostgresReferenceMode,
  relationClassification: RelationClassification,
): PostgresDependencyClass {
  const path = normalized(file);
  if (path.includes('src/execution/') || path.includes('src/broker/') || path.includes('src/lifecycle/')) {
    return 'SAFETY_REQUIRED';
  }
  if (/src\/theta\/(?:aegis-|alpaca-corporate-action-evidence|management-input-state|production-paper-management-candidate-source|postgres-lifecycle|postgres-whole-chain)/.test(path)) {
    return 'SAFETY_REQUIRED';
  }
  if (path.includes('src/theta/autonomous-runtime-handler.ts')) return 'CANONICAL_STATE_REQUIRED';
  if (path.includes('postgres-theta-cycle-store.ts') || path.includes('point-in-time-evidence.ts')
    || path.includes('postgres-local-evidence-backfill.ts')) return 'PERSISTENCE_ONLY';
  if (path.includes('src/research/') || path.includes('bots/theta/quant/research/')
    || path.startsWith('tools/') || path.includes('/tools/')
    || /src\/theta\/(?:p2e-evidence-store|runtime-behavior-diagnostic|zero-trade-diagnostic|shadow-management-policy|recovery-history-loader)/.test(path)
    || (path.includes('src/theta/autonomous-runtime.ts')
      && (relationClassification === 'RESEARCH_HISTORY' || relationClassification === 'SHORT_RETENTION_OBSERVATION'))) {
    return 'RESEARCH_ONLY';
  }
  if ((relationClassification === 'RESEARCH_HISTORY' || relationClassification === 'SHORT_RETENTION_OBSERVATION')
    && mode !== 'WRITE' && (path.includes('src/theta/') || path.includes('src/worker/'))) {
    return 'ACCIDENTAL_COUPLING';
  }
  return 'CANONICAL_STATE_REQUIRED';
}

const escaped = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function relationReferenceMode(source: string, qualifiedRelation: string): PostgresReferenceMode | null {
  const relation = escaped(qualifiedRelation);
  const any = new RegExp(`\\b${relation}\\b`, 'i').test(source);
  if (!any) return null;
  const write = new RegExp(`(?:INSERT\\s+INTO|UPDATE|DELETE\\s+FROM|TRUNCATE(?:\\s+TABLE)?)\\s+${relation}\\b`, 'i').test(source);
  const read = new RegExp(`(?:FROM|JOIN|REFERENCES)\\s+${relation}\\b`, 'i').test(source);
  if (!write && !read) return null;
  if (write && read) return 'READ_WRITE';
  if (write) return 'WRITE';
  return 'READ';
}
