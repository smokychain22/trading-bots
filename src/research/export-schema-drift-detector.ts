/**
 * OVERNIGHT WAVE item (b): a real, versioned compatibility check between
 * Codex's canonical cycle-evidence export contract
 * (`postgres-cycle-evidence-storage.ts`'s `postgresCycleEvidenceStorageVersion`)
 * and this research branch's consumers. Never silently accepts an unknown
 * enum value or a missing required field -- every outcome is a named,
 * typed verdict a caller must handle explicitly.
 *
 * This module does not decode/parse the archive itself (that stays owned
 * by `postgres-cycle-evidence-storage.ts`) -- it only answers "is this
 * exported shape one my adapters know how to consume."
 */

export const exportSchemaDriftDetectorVersion = 'theta-export-schema-drift-detector-v1' as const;

/** The exact contract version this research branch's adapters were built
 * against. Bump this deliberately (with adapter changes) whenever Codex's
 * export version changes -- never silently. */
export const RESEARCH_EXPECTED_EXPORT_CONTRACT_VERSION = 'theta-postgres-cycle-evidence-storage-v2' as const;

export type SchemaDriftVerdict =
  | 'COMPATIBLE'
  | 'BACKWARD_COMPATIBLE'
  | 'MISSING_REQUIRED_FIELD'
  | 'UNKNOWN_ENUM_VALUE'
  | 'VERSION_AHEAD_UNSUPPORTED'
  | 'VERSION_BEHIND_UNSUPPORTED';

export interface SchemaDriftResult {
  readonly contractVersion: typeof exportSchemaDriftDetectorVersion;
  readonly verdict: SchemaDriftVerdict;
  readonly observedExportVersion: string;
  readonly expectedExportVersion: string;
  readonly missingRequiredFields: readonly string[];
  readonly unknownEnumFindings: readonly { readonly field: string; readonly value: string }[];
  readonly reasons: readonly string[];
}

/** The archive's own required top-level keys, per `projectCycleEvidenceForPostgres`
 * (`postgres-cycle-evidence-storage.ts:125-133`) -- kept in sync manually,
 * deliberately, rather than importing the private literal so a real Codex
 * schema change is forced to be a visible, reviewed diff here too. */
const REQUIRED_ARCHIVE_FIELDS: readonly string[] = [
  'contractVersion', 'snapshotContentHash', 'snapshot', 'strategyFrontier',
  'thetaQ', 'decisionReceipt', 'shadowOpportunities',
];

/** Enum fields this research branch's adapters switch on exhaustively --
 * an export containing a value outside this set must fail loudly, never
 * be silently ignored/defaulted. */
const KNOWN_CANDIDATE_STATUS_VALUES: ReadonlySet<string> = new Set(['SELECTED', 'REJECTED', 'WAITED', 'SHADOW_ONLY']);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Given a decoded archive record (the output of `decodeCycleEvidenceArchive`,
 * already version-checked by that function -- this detector re-checks
 * independently so a caller bypassing that function is still caught) and
 * an optional set of observed per-candidate status strings (from whatever
 * derives `DecisionCandidateStatus` for this cycle), produce one verdict.
 */
export function detectExportSchemaDrift(
  decodedArchive: Record<string, unknown>,
  observedCandidateStatuses: readonly string[] = [],
): SchemaDriftResult {
  const observedVersion = typeof decodedArchive.contractVersion === 'string' ? decodedArchive.contractVersion : '';
  const missingRequiredFields = REQUIRED_ARCHIVE_FIELDS.filter((field) => !(field in decodedArchive));
  const unknownEnumFindings = observedCandidateStatuses
    .filter((value) => !KNOWN_CANDIDATE_STATUS_VALUES.has(value))
    .map((value) => ({ field: 'candidateStatus', value }));

  const reasons: string[] = [];
  let verdict: SchemaDriftVerdict;

  if (missingRequiredFields.length > 0) {
    verdict = 'MISSING_REQUIRED_FIELD';
    reasons.push(`archive is missing required field(s): ${missingRequiredFields.join(', ')}`);
  } else if (unknownEnumFindings.length > 0) {
    verdict = 'UNKNOWN_ENUM_VALUE';
    reasons.push(`unrecognized enum value(s): ${unknownEnumFindings.map((f) => `${f.field}=${f.value}`).join(', ')}`);
  } else if (observedVersion === RESEARCH_EXPECTED_EXPORT_CONTRACT_VERSION) {
    verdict = 'COMPATIBLE';
    reasons.push('exact contract version match, all required fields present, no unknown enum values');
  } else if (observedVersion === '') {
    verdict = 'MISSING_REQUIRED_FIELD';
    reasons.push('contractVersion field itself is missing or not a string');
  } else {
    // A real version string is present but differs from what these adapters
    // were built against. Never guess ordering from string comparison --
    // an unrecognized version is unsupported until a human updates
    // RESEARCH_EXPECTED_EXPORT_CONTRACT_VERSION and the adapters together.
    verdict = observedVersion > RESEARCH_EXPECTED_EXPORT_CONTRACT_VERSION
      ? 'VERSION_AHEAD_UNSUPPORTED' : 'VERSION_BEHIND_UNSUPPORTED';
    reasons.push(`observed export version "${observedVersion}" does not match expected "${RESEARCH_EXPECTED_EXPORT_CONTRACT_VERSION}"`);
  }

  return {
    contractVersion: exportSchemaDriftDetectorVersion,
    verdict,
    observedExportVersion: observedVersion,
    expectedExportVersion: RESEARCH_EXPECTED_EXPORT_CONTRACT_VERSION,
    missingRequiredFields,
    unknownEnumFindings,
    reasons,
  };
}

/** Convenience guard: throws with the exact verdict reason if the archive
 * is not COMPATIBLE. Adapters should call this before consuming a decoded
 * archive rather than assuming shape. */
export function assertExportSchemaCompatible(
  decodedArchive: Record<string, unknown>,
  observedCandidateStatuses: readonly string[] = [],
): void {
  const result = detectExportSchemaDrift(decodedArchive, observedCandidateStatuses);
  if (result.verdict !== 'COMPATIBLE') {
    throw new Error(`EXPORT_SCHEMA_DRIFT:${result.verdict}:${result.reasons.join('; ')}`);
  }
}

export function isPlainObjectExport(value: unknown): value is Record<string, unknown> {
  return isPlainObject(value);
}
