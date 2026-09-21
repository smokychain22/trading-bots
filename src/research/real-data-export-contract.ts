/**
 * Shared envelope contract for every "run the real study" runner in this
 * directory (event PIT, correlation cluster, IV/spread). Defines exactly
 * what Codex's future sanitized canonical exports must look like before
 * any of Claude's research functions are allowed to treat their rows as
 * real evidence -- an export missing this envelope, or missing
 * `sanitized: true`, is never silently treated as usable data.
 *
 * `brokerAuthority: false` always. This module owns no export production
 * -- it only validates an already-produced export and classifies whether
 * a study is allowed to run against it.
 */
export const realDataExportContractVersion = 'theta-real-data-export-contract-v1' as const;

export interface RealDataExportEnvelope<TRows> {
  readonly exportContractVersion: string;
  readonly generatedAt: string;
  /** Must be the literal `true` -- an export that has not been through a
   * sanitization step (credential/PII redaction) must never reach this
   * runner, and this field is the caller's explicit attestation of that,
   * never inferred. */
  readonly sanitized: true;
  readonly sourceDescription: string;
  readonly rowCount: number;
  readonly rows: readonly TRows[];
}

export type ExportLoadStatus =
  | 'AWAITING_REAL_EXPORT' | 'EXPORT_CONTRACT_INVALID' | 'EXPORT_ROW_COUNT_MISMATCH' | 'LOADED';

export interface ExportLoadResult<TRows> {
  readonly status: ExportLoadStatus;
  readonly reason: string | null;
  readonly envelope: RealDataExportEnvelope<TRows> | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Validates an already-parsed export payload against the envelope
 * contract. `input === null` (no file/export exists yet) is the expected,
 * common case pre-Codex-integration and reports AWAITING_REAL_EXPORT
 * rather than a validation failure -- those are deliberately distinct
 * statuses so a caller can tell "nothing to run yet" apart from
 * "something is wrong with what was given."
 */
export function loadRealDataExport<TRows>(
  input: unknown, expectedContractVersion: string,
): ExportLoadResult<TRows> {
  if (input === null || input === undefined) {
    return { status: 'AWAITING_REAL_EXPORT', reason: 'NO_EXPORT_SUPPLIED', envelope: null };
  }
  if (!isRecord(input)) {
    return { status: 'EXPORT_CONTRACT_INVALID', reason: 'EXPORT_NOT_AN_OBJECT', envelope: null };
  }
  if (input.exportContractVersion !== expectedContractVersion) {
    return { status: 'EXPORT_CONTRACT_INVALID', reason: 'EXPORT_CONTRACT_VERSION_MISMATCH', envelope: null };
  }
  if (input.sanitized !== true) {
    return { status: 'EXPORT_CONTRACT_INVALID', reason: 'EXPORT_NOT_ATTESTED_SANITIZED', envelope: null };
  }
  if (typeof input.generatedAt !== 'string' || Number.isNaN(Date.parse(input.generatedAt))) {
    return { status: 'EXPORT_CONTRACT_INVALID', reason: 'EXPORT_GENERATED_AT_INVALID', envelope: null };
  }
  if (typeof input.sourceDescription !== 'string' || input.sourceDescription.trim().length === 0) {
    return { status: 'EXPORT_CONTRACT_INVALID', reason: 'EXPORT_SOURCE_DESCRIPTION_MISSING', envelope: null };
  }
  if (!Array.isArray(input.rows)) {
    return { status: 'EXPORT_CONTRACT_INVALID', reason: 'EXPORT_ROWS_NOT_AN_ARRAY', envelope: null };
  }
  if (typeof input.rowCount !== 'number' || input.rowCount !== input.rows.length) {
    return { status: 'EXPORT_ROW_COUNT_MISMATCH', reason: 'EXPORT_ROW_COUNT_DOES_NOT_MATCH_ROWS_LENGTH', envelope: null };
  }
  return {
    status: 'LOADED', reason: null,
    envelope: {
      exportContractVersion: input.exportContractVersion, generatedAt: input.generatedAt,
      sanitized: true, sourceDescription: input.sourceDescription, rowCount: input.rowCount,
      rows: input.rows as readonly TRows[],
    },
  };
}

export type EvidenceLineage = 'REAL_EXPORT' | 'SYNTHETIC_FIXTURE';
