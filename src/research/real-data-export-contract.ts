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
 * v3 repair, per direct user review of v2's own claims:
 *  - Adds `evidenceIds`, an explicit immutable per-row identity manifest
 *    (one stable ID per row, aligned by index, all unique) -- v2's
 *    "immutable evidence IDs" language in its own comment described a
 *    field that did not actually exist in the interface. This is the
 *    real field.
 *  - Replaces raw `JSON.stringify(rows)` hashing with a canonical
 *    serialization (`canonicalize`, JCS/RFC-8785-style: recursively
 *    sorted object keys, stable array order) BEFORE hashing, so the hash
 *    is invariant to key order and reproducible across languages/
 *    implementations that follow the same canonicalization rule --
 *    JSON.stringify's key order is insertion-order-dependent and is NOT
 *    a safe cross-language reproducibility basis on its own.
 *  - Replaces the single `symbolCount` requirement with an explicit
 *    `scope: 'SYMBOL_SCOPED' | 'MARKET_WIDE' | 'MIXED'` field.
 *    `symbolCount` must be positive for SYMBOL_SCOPED/MIXED, and must be
 *    exactly 0 for MARKET_WIDE (e.g. macro/Fed datasets legitimately
 *    cover zero individual symbols) -- v2 wrongly required
 *    `symbolCount > 0` unconditionally.
 *  - Corrects `canonicalSourceSha`'s own doc comment: this module
 *    verifies only that the field is SYNTACTICALLY a real 40-hex-char git
 *    SHA. It is NOT independent proof the export was actually derived
 *    from that commit of canonical main -- that provenance claim can only
 *    come from Codex's own export-receipt/evidence process, never from a
 *    format check performed here.
 *
 * `brokerAuthority: false` always. This module owns no export production
 * -- it only validates an already-produced export and classifies whether
 * a study is allowed to run against it.
 */
export const realDataExportContractVersion = 'theta-real-data-export-contract-v3' as const;

export type ExportScope = 'SYMBOL_SCOPED' | 'MARKET_WIDE' | 'MIXED';

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
  /** SYMBOL_SCOPED: every row belongs to one or more named symbols
   * (symbolCount > 0 required). MARKET_WIDE: rows describe the market/
   * macro environment with no per-symbol scoping at all (symbolCount
   * MUST be exactly 0 -- e.g. a Fed rate-decision or GDP-release
   * export). MIXED: an export combining both (symbolCount > 0 required,
   * naming only the symbol-scoped subset). */
  readonly scope: ExportScope;
  readonly symbolCount: number;
  /** SYNTAX-VALIDATED ONLY: a real 40-hex-char git SHA shape. This is
   * NOT independent proof the export was derived from that exact commit
   * of canonical main -- actual provenance is Codex's export-receipt
   * responsibility, never established by this format check alone. */
  readonly canonicalSourceSha: string;
  /** One immutable, stable identifier per row, aligned by array index
   * with `rows` (evidenceIds[i] identifies rows[i]). Every ID must be a
   * non-empty string and every ID in the array must be unique -- this is
   * the real "immutable evidence ID" manifest v2's own comment described
   * but never actually added to the interface. */
  readonly evidenceIds: readonly string[];
  /** sha256 of the CANONICALLY serialized `rows` array (see
   * `canonicalize`/`computeExportContentHash` below) -- computed the
   * same way this module recomputes it in `loadRealDataExport`. A
   * mismatch means the rows were altered after the export claimed this
   * hash (or were serialized non-canonically), and the export is
   * rejected outright. Key order in the original rows never affects this
   * hash. */
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
const EXPORT_SCOPES: readonly ExportScope[] = ['SYMBOL_SCOPED', 'MARKET_WIDE', 'MIXED'];

/**
 * JCS/RFC-8785-style canonicalization: object keys are sorted
 * recursively (lexicographic, applied at every nesting depth); array
 * element order is preserved (arrays are ordered data, not sets);
 * primitives pass through unchanged. This is deliberately a MINIMAL
 * canonicalization -- it does not attempt RFC 8785's exact numeric
 * string-formatting rules (which matter for cross-language float
 * reproducibility in edge cases like `-0` or very large integers) since
 * every row shape in this codebase uses plain finite numbers or nulls;
 * if a future row shape needs exact RFC 8785 numeric semantics, extend
 * this function rather than silently relying on JSON.stringify's
 * platform-default number formatting.
 */
/**
 * Names the exact serialization semantics `canonicalize`/
 * `computeExportContentHash` implement, versioned independently of
 * `realDataExportContractVersion` -- the envelope SHAPE (which fields
 * exist) and the HASH ALGORITHM (how rows are serialized before
 * hashing) are two different things that can each change on their own
 * schedule. A producer (Codex's `canonical-event-export.ts` included)
 * implementing an equivalent algorithm should reference this constant
 * in its own comments so a future change to either side is a deliberate,
 * documented decision rather than a silent drift. Empirically verified
 * this session: Codex's independently-written `canonical()` +
 * `canonicalExportHash()` produce byte-identical sha256 digests to this
 * implementation across representative row shapes (flat objects,
 * reversed key order, nested objects, arrays, realistic event rows).
 * THETA CANONICAL JSON v1 (this algorithm) is JCS/RFC-8785-STYLE --
 * recursive lexicographic object-key sorting, preserved array order --
 * but is explicitly NOT full RFC 8785 compliance: it does not implement
 * RFC 8785's exact numeric-string serialization rules. Never describe
 * this as "RFC 8785 compliant."
 */
export const canonicalSerializationVersion = 'theta-canonical-json-v1' as const;

export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    const sortedKeys = Object.keys(value as Record<string, unknown>).sort();
    const result: Record<string, unknown> = {};
    for (const key of sortedKeys) result[key] = canonicalize((value as Record<string, unknown>)[key]);
    return result;
  }
  return value;
}

export function computeExportContentHash(rows: readonly unknown[]): string {
  return createHash('sha256').update(JSON.stringify(canonicalize(rows))).digest('hex');
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
  if (typeof input.scope !== 'string' || !EXPORT_SCOPES.includes(input.scope as ExportScope)) {
    return { status: 'EXPORT_CONTRACT_INVALID', reason: 'EXPORT_SCOPE_INVALID', envelope: null };
  }
  if (typeof input.symbolCount !== 'number' || !Number.isInteger(input.symbolCount) || input.symbolCount < 0) {
    return { status: 'EXPORT_CONTRACT_INVALID', reason: 'EXPORT_SYMBOL_COUNT_INVALID', envelope: null };
  }
  if (input.scope === 'MARKET_WIDE' && input.symbolCount !== 0) {
    return { status: 'EXPORT_CONTRACT_INVALID', reason: 'EXPORT_MARKET_WIDE_SCOPE_MUST_HAVE_ZERO_SYMBOL_COUNT', envelope: null };
  }
  if (input.scope !== 'MARKET_WIDE' && input.symbolCount <= 0) {
    return { status: 'EXPORT_CONTRACT_INVALID', reason: 'EXPORT_SCOPED_EXPORT_REQUIRES_POSITIVE_SYMBOL_COUNT', envelope: null };
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
  if (!Array.isArray(input.evidenceIds) || input.evidenceIds.length !== input.rows.length) {
    return { status: 'EXPORT_CONTRACT_INVALID', reason: 'EXPORT_EVIDENCE_IDS_LENGTH_MISMATCH', envelope: null };
  }
  if (!input.evidenceIds.every((id) => typeof id === 'string' && id.trim().length > 0)) {
    return { status: 'EXPORT_CONTRACT_INVALID', reason: 'EXPORT_EVIDENCE_ID_EMPTY_OR_NOT_A_STRING', envelope: null };
  }
  if (new Set(input.evidenceIds).size !== input.evidenceIds.length) {
    return { status: 'EXPORT_CONTRACT_INVALID', reason: 'EXPORT_EVIDENCE_IDS_NOT_UNIQUE', envelope: null };
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
      scope: input.scope as ExportScope, symbolCount: input.symbolCount,
      canonicalSourceSha: input.canonicalSourceSha, evidenceIds: input.evidenceIds as readonly string[],
      contentHash: input.contentHash, rowCount: input.rowCount, rows: input.rows as readonly TRows[],
    },
  };
}

export type EvidenceLineage = 'REAL_EXPORT' | 'SYNTHETIC_FIXTURE';
