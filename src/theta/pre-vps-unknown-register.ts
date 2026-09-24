export const unknownCategories = [
  'IMPLEMENTATION_DEFECT', 'PROVIDER_MAPPING_DEFECT', 'PERSISTENCE_DEFECT',
  'CONSUMER_WIRING_DEFECT', 'POLICY_MISSING', 'TEMPORAL_HISTORY_INSUFFICIENT',
  'PROVIDER_NOT_CAPABLE', 'LEGITIMATE_RUNTIME_UNKNOWN', 'NOT_APPLICABLE',
  'RESEARCH_ONLY', 'EMPIRICAL_OUTCOME_NOT_YET_OBSERVED',
] as const;

export type UnknownCategory = typeof unknownCategories[number];
export type UnknownStatus = 'OPEN' | 'RESOLVED' | 'DEFERRED';

export interface UnknownRegisterEntry {
  readonly field: string;
  readonly strategy: string;
  readonly stage: string;
  readonly source: string;
  readonly category: UnknownCategory;
  readonly reason: string;
  readonly safetyCritical: boolean;
  readonly paperEntryRequired: boolean;
  readonly provider: string | null;
  readonly producer: string | null;
  readonly persistence: string | null;
  readonly consumer: string | null;
  readonly remediation: string;
  readonly currentStatus: UnknownStatus;
}

export interface UnknownRegister {
  readonly schemaVersion: 'theta-pre-vps-unknown-register-v1';
  readonly auditCoverage: 'PARTIAL' | 'COMPLETE';
  readonly denominatorContract?: string;
  readonly entries: readonly UnknownRegisterEntry[];
}

const avoidableCategories = new Set<UnknownCategory>([
  'IMPLEMENTATION_DEFECT', 'PROVIDER_MAPPING_DEFECT', 'PERSISTENCE_DEFECT',
  'CONSUMER_WIRING_DEFECT', 'POLICY_MISSING',
]);

/**
 * Source-controlled result of the exhaustive decision-critical audit.
 *
 * The audit command compares this snapshot with the canonical JSON register and
 * fails CI if either side changes without the other. Runtime/operator surfaces
 * may use these static audit facts, but must still prove dynamic provider,
 * broker, database, quote, AEGIS and worker checks independently.
 */
export const canonicalPreVpsUnknownAuditSummary = Object.freeze({
  auditCoverage: 'COMPLETE' as const,
  avoidableUnknownCount: 0,
  implementationBlockerCount: 0,
  unresolvedSafetyCriticalCount: 0,
  unresolvedPaperEntryCount: 0,
  denominatorContract: 'theta-decision-critical-evidence-registry-v1' as const,
});

export function assessUnknownRegister(register: UnknownRegister): {
  readonly avoidableUnknownCount: number;
  readonly openUnknownCount: number;
  readonly unresolvedSafetyCriticalCount: number;
  readonly unresolvedPaperEntryCount: number;
  readonly auditCoverage: UnknownRegister['auditCoverage'];
  readonly preVpsReady: boolean;
} {
  if (register.schemaVersion !== 'theta-pre-vps-unknown-register-v1') throw new Error('UNKNOWN_REGISTER_SCHEMA_INVALID');
  if (register.auditCoverage !== 'PARTIAL' && register.auditCoverage !== 'COMPLETE') throw new Error('UNKNOWN_REGISTER_COVERAGE_INVALID');
  if (register.entries.length === 0) throw new Error('UNKNOWN_REGISTER_EMPTY');
  const seen = new Set<string>();
  for (const entry of register.entries) {
    if (seen.has(`${entry.strategy}:${entry.stage}:${entry.field}`)) throw new Error('UNKNOWN_REGISTER_DUPLICATE_FIELD');
    seen.add(`${entry.strategy}:${entry.stage}:${entry.field}`);
    if (!unknownCategories.includes(entry.category)) throw new Error('UNKNOWN_REGISTER_CATEGORY_INVALID');
    if (entry.currentStatus !== 'OPEN' && entry.currentStatus !== 'RESOLVED' && entry.currentStatus !== 'DEFERRED') throw new Error('UNKNOWN_REGISTER_STATUS_INVALID');
    if (!entry.field || !entry.reason || !entry.remediation || !entry.source) throw new Error('UNKNOWN_REGISTER_ENTRY_INCOMPLETE');
    if (entry.safetyCritical && entry.currentStatus === 'DEFERRED') throw new Error('SAFETY_CRITICAL_UNKNOWN_DEFERRED');
  }
  const open = register.entries.filter((entry) => entry.currentStatus !== 'RESOLVED');
  const avoidableUnknownCount = open.filter((entry) => avoidableCategories.has(entry.category)).length;
  const unresolvedSafetyCriticalCount = open.filter((entry) => entry.safetyCritical).length;
  const unresolvedPaperEntryCount = open.filter((entry) => entry.paperEntryRequired).length;
  return {
    avoidableUnknownCount,
    openUnknownCount: open.length,
    unresolvedSafetyCriticalCount,
    unresolvedPaperEntryCount,
    auditCoverage: register.auditCoverage,
    preVpsReady: register.auditCoverage === 'COMPLETE' && avoidableUnknownCount === 0
      && unresolvedSafetyCriticalCount === 0 && unresolvedPaperEntryCount === 0,
  };
}
