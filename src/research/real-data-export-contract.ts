import { createHash } from 'node:crypto';

/**
 * Shared envelope contract for every "run the real study" runner in this
 * directory (event PIT, correlation cluster, IV/spread, severe-downside).
 * Defines exactly what Codex's future sanitized canonical exports must
 * look like before any of Claude's research functions are allowed to
 * treat their rows as real evidence -- an export missing this envelope,
 * missing `sanitized: true`, or failing its content-hash check is never
 * silently treated as usable data.
 *
 * v2 repair for a defect Codex's df88f3f review found
 * (docs/research/THETA_CLAUDE_DF88F3F_REVIEW.md): "The envelope checks
 * `sanitized: true` but lacks mandatory source window, provider, symbol
 * count, canonical SHA, immutable evidence IDs and reproducible content
 * hash." v1 only validated exportContractVersion/sanitized/
 * sourceDescription/rowCount -- this version additionally requires and
 * verifies `provider`, `sourceWindowStart`/`sourceWindowEnd`,
 * `symbolCount`, `canonicalSourceSha`, and a `contentHash` that this
 * module INDEPENDENTLY RECOMPUTES over the rows and compares, rather than
 * trusting whatever hash the export claims for itself.
 *
 * `brokerAuthority: false` always. This module owns no export production
 * -- it only validates an already-produced export and classifies whether
 * a study is allowed to run against it.
 */
export const realDataExportContractVersion = 'theta-real-data-export-contract-v2' as const;

export interface RealDataExportEnvelope<TRows> {
  readonly exportContractVersion: string;
  readonly generatedAt: string;
  /** Must be the literal `true` -- an export that has not been through a
   * sanitization step (credential/PII redaction) must never reach this
   * runner, and this field is the caller's explicit attestation of that,
   * never inferred. */
  readonly sanitized: true;
  readonly sourceDescription: string;
  /** The real-world provider this export's rows were observed from (e.g.
   * 'OPTIONOMICS', 'ALPACA') -- never inferred from context. */
  readonly provider: string;
  /** The inclusive real-world observation window this export covers,
   * as ISO dates/instants -- distinct from `generatedAt` (when the
   * export FILE was produced), which says nothing about what period of
   * market history it actually contains. */
  readonly sourceWindowStart: string;
  readonly sourceWindowEnd: string;
  readonly symbolCount: number;
  /** The exact canonical (Codex-owned main) commit SHA this export was
   * derived from -- lets a later reviewer reproduce or audit the export
   * against the exact Production code/schema state that produced it. */
  readonly canonicalSourceSha: string;
  /** sha256 of the deterministically-serialized `rows` array, computed
   * the same way this module recomputes it in `loadRealDataExport` --
   * a mismatch means the rows were altered after the export claimed this
   * hash, and the export is rejected outright. */
  readonly contentHash: string;
  readonly rowCount: number;
  readonly rows: readonly TRows[];
}

export type ExportLoadStatus =
  | 'AWAITING_REAL_EXPORT' | 'EXPORT_CONTRACT_INVALID' | 'EXPORT_ROW_COUNT_MISMATCH'
  | 'EXPORT_CONTENT_HASH_MISMATCH' | 'LOADED';

export interface ExportLoadResult<TRows> {
  readonly status: ExportLoadStatus;
  readonly reason: string | null;
  readonly envelope: RealDataExportEnvelope<TRows> | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

const CANONICAL_SHA_PATTERN = /^[0-9a-f]{40}$/;
const CONTENT_HASH_PATTERN = /^[0-9a-f]{64}$/;

export function computeExportContentHash(rows: readonly unknown[]): string {
  return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
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
  if (typeof input.provider !== 'string' || input.provider.trim().length === 0) {
    return { status: 'EXPORT_CONTRACT_INVALID', reason: 'EXPORT_PROVIDER_MISSING', envelope: null };
  }
  if (typeof input.sourceWindowStart !== 'string' || Number.isNaN(Date.parse(input.sourceWindowStart))) {
    return { status: 'EXPORT_CONTRACT_INVALID', reason: 'EXPORT_SOURCE_WINDOW_START_INVALID', envelope: null };
  }
  if (typeof input.sourceWindowEnd !== 'string' || Number.isNaN(Date.parse(input.sourceWindowEnd))) {
    return { status: 'EXPORT_CONTRACT_INVALID', reason: 'EXPORT_SOURCE_WINDOW_END_INVALID', envelope: null };
  }
  if (Date.parse(input.sourceWindowEnd) < Date.parse(input.sourceWindowStart)) {
    return { status: 'EXPORT_CONTRACT_INVALID', reason: 'EXPORT_SOURCE_WINDOW_END_BEFORE_START', envelope: null };
  }
  if (typeof input.symbolCount !== 'number' || !Number.isInteger(input.symbolCount) || input.symbolCount <= 0) {
    return { status: 'EXPORT_CONTRACT_INVALID', reason: 'EXPORT_SYMBOL_COUNT_INVALID', envelope: null };
  }
  if (typeof input.canonicalSourceSha !== 'string' || !CANONICAL_SHA_PATTERN.test(input.canonicalSourceSha)) {
    return { status: 'EXPORT_CONTRACT_INVALID', reason: 'EXPORT_CANONICAL_SOURCE_SHA_INVALID', envelope: null };
  }
  if (typeof input.contentHash !== 'string' || !CONTENT_HASH_PATTERN.test(input.contentHash)) {
    return { status: 'EXPORT_CONTRACT_INVALID', reason: 'EXPORT_CONTENT_HASH_INVALID', envelope: null };
  }
  if (!Array.isArray(input.rows)) {
    return { status: 'EXPORT_CONTRACT_INVALID', reason: 'EXPORT_ROWS_NOT_AN_ARRAY', envelope: null };
  }
  if (typeof input.rowCount !== 'number' || input.rowCount !== input.rows.length) {
    return { status: 'EXPORT_ROW_COUNT_MISMATCH', reason: 'EXPORT_ROW_COUNT_DOES_NOT_MATCH_ROWS_LENGTH', envelope: null };
  }
  const recomputedHash = computeExportContentHash(input.rows);
  if (recomputedHash !== input.contentHash) {
    return { status: 'EXPORT_CONTENT_HASH_MISMATCH', reason: 'EXPORT_CONTENT_HASH_DOES_NOT_MATCH_ROWS', envelope: null };
  }
  return {
    status: 'LOADED', reason: null,
    envelope: {
      exportContractVersion: input.exportContractVersion, generatedAt: input.generatedAt,
      sanitized: true, sourceDescription: input.sourceDescription, provider: input.provider,
      sourceWindowStart: input.sourceWindowStart, sourceWindowEnd: input.sourceWindowEnd,
      symbolCount: input.symbolCount, canonicalSourceSha: input.canonicalSourceSha,
      contentHash: input.contentHash, rowCount: input.rowCount, rows: input.rows as readonly TRows[],
    },
  };
}

export type EvidenceLineage = 'REAL_EXPORT' | 'SYNTHETIC_FIXTURE';
