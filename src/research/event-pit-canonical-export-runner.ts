/**
 * Consumes Codex's REAL canonical event export
 * (`src/research/canonical-event-export.ts`, `CanonicalEventExport`) --
 * this is genuinely stronger-lineage evidence than a direct Optionomics
 * MCP research call, per the compatibility review documented in
 * `docs/research/THETA_CANONICAL_EXPORT_COMPATIBILITY_2026-09-21.md`.
 *
 * That review found Codex's producer is NOT a drop-in match for the
 * generic `event-pit-real-data-runner.ts` path: it stamps
 * `exportContractVersion: 'theta-real-data-export-contract-v3'` (the
 * generic envelope version), not this module's domain-specific
 * `EVENT_PIT_EXPORT_CONTRACT_VERSION`; its rows are `CanonicalEventRow`,
 * a materially different shape from `EventPitRecord` (real Aiven
 * evidence IDs, a `releaseEvidence` block, market-wide `ticker: null`
 * rows that the original non-nullable `EventPitRecord.underlying: string`
 * could not represent); and it adds release-SHA binding this module's
 * generic envelope validator never checks. This file is the real,
 * dedicated consumer for that actual shape -- never a generic adapter
 * pretending the two contracts are identical.
 *
 * `brokerAuthority: false`. This module owns no export production and no
 * Production release verification -- it only converts and classifies
 * rows an already-validated Codex export supplied.
 */
import {
  canonicalEventExportContract, canonicalExportHash,
  type CanonicalEventExport, type CanonicalEventRow,
} from './canonical-event-export.js';
import {
  classifyHistoricalEventPit, type EventPitRecord, type HistoricalPitClassificationResult,
} from './event-pit-toolkit.js';

export const eventPitCanonicalExportRunnerVersion = 'theta-event-pit-canonical-export-runner-v1' as const;

const VERCEL_DEPLOYMENT_URL_PATTERN = /^trading-bots-[a-z0-9]+-skillswap7\.vercel\.app$/;
const GIT_SHA_PATTERN = /^[0-9a-f]{40}$/;

export type CanonicalEventExportLoadStatus =
  | 'AWAITING_REAL_EXPORT' | 'EXPORT_CONTRACT_INVALID' | 'EXPORT_CONTENT_HASH_MISMATCH'
  | 'EXPORT_RELEASE_EVIDENCE_INVALID' | 'LOADED';

export interface CanonicalEventExportLoadResult {
  readonly status: CanonicalEventExportLoadStatus;
  readonly reason: string | null;
  readonly export: CanonicalEventExport | null;
}

/**
 * Validates a Codex canonical event export using CODEX'S OWN hash
 * algorithm (`canonicalExportHash`, imported directly from
 * `canonical-event-export.ts`, never reimplemented here) plus this
 * module's own release-evidence and identity checks. Deliberately
 * separate from `real-data-export-contract.ts`'s `loadRealDataExport`
 * because this export's row shape and its release-binding fields are
 * NOT covered by that generic validator at all.
 */
export function loadCanonicalEventExport(input: unknown): CanonicalEventExportLoadResult {
  if (input === null || input === undefined) {
    return { status: 'AWAITING_REAL_EXPORT', reason: 'NO_EXPORT_SUPPLIED', export: null };
  }
  if (typeof input !== 'object' || Array.isArray(input)) {
    return { status: 'EXPORT_CONTRACT_INVALID', reason: 'EXPORT_NOT_AN_OBJECT', export: null };
  }
  const candidate = input as Partial<CanonicalEventExport>;
  if (candidate.exportContractVersion !== canonicalEventExportContract) {
    return { status: 'EXPORT_CONTRACT_INVALID', reason: 'EXPORT_CONTRACT_VERSION_MISMATCH', export: null };
  }
  if (candidate.sanitized !== true) {
    return { status: 'EXPORT_CONTRACT_INVALID', reason: 'EXPORT_NOT_ATTESTED_SANITIZED', export: null };
  }
  if (!Array.isArray(candidate.rows) || !Array.isArray(candidate.evidenceIds)) {
    return { status: 'EXPORT_CONTRACT_INVALID', reason: 'EXPORT_ROWS_OR_EVIDENCE_IDS_NOT_AN_ARRAY', export: null };
  }
  if (candidate.rowCount !== candidate.rows.length || candidate.evidenceIds.length !== candidate.rows.length) {
    return { status: 'EXPORT_CONTRACT_INVALID', reason: 'EXPORT_ROW_COUNT_MISMATCH', export: null };
  }
  if (new Set(candidate.evidenceIds).size !== candidate.evidenceIds.length
    || !candidate.evidenceIds.every((id) => typeof id === 'string' && id.trim().length > 0)) {
    return { status: 'EXPORT_CONTRACT_INVALID', reason: 'EXPORT_EVIDENCE_IDS_INVALID', export: null };
  }
  const release = candidate.releaseEvidence;
  if (release === undefined || !GIT_SHA_PATTERN.test(release.canonicalSourceSha)
    || release.deploymentEnvironment !== 'production' || release.source !== 'VERCEL_BUILD_METADATA'
    || !VERCEL_DEPLOYMENT_URL_PATTERN.test(release.deploymentUrl)) {
    return { status: 'EXPORT_RELEASE_EVIDENCE_INVALID', reason: 'EXPORT_RELEASE_EVIDENCE_MALFORMED', export: null };
  }
  if (candidate.canonicalSourceSha !== release.canonicalSourceSha) {
    return { status: 'EXPORT_RELEASE_EVIDENCE_INVALID', reason: 'EXPORT_CANONICAL_SHA_RELEASE_EVIDENCE_MISMATCH', export: null };
  }
  if (typeof candidate.contentHash !== 'string' || canonicalExportHash(candidate.rows) !== candidate.contentHash) {
    return { status: 'EXPORT_CONTENT_HASH_MISMATCH', reason: 'EXPORT_CONTENT_HASH_DOES_NOT_MATCH_ROWS', export: null };
  }
  return { status: 'LOADED', reason: null, export: candidate as CanonicalEventExport };
}

/**
 * Maps ONE real CanonicalEventRow onto the research five-field timing
 * model. `identityKey` uses `providerEventIdHash` (the real EVENT
 * identity, stable across repeated polls of the same event) rather than
 * `evidenceId` (a per-OBSERVATION Aiven row ID that can differ between
 * polls of the same event) -- using the wrong one would break
 * first-observed folding across repeated polling. `providerKnownAt` and
 * `thetaFirstObservedAt` map directly (both contracts use the identical
 * name and meaning). `providerTimestampIndependentlyVerified` is never
 * set `true` here -- Codex's export does not carry that attestation, and
 * this module never invents one.
 */
export function fromCanonicalEventExportRow(row: CanonicalEventRow): EventPitRecord {
  return {
    identityKey: row.providerEventIdHash, underlying: row.ticker, eventType: row.eventKind ?? 'UNKNOWN',
    eventTime: row.scheduledAt, providerPublishedAt: null, providerKnownAt: row.providerKnownAt,
    thetaFirstObservedAt: row.thetaFirstObservedAt, ingestedAt: row.thetaFirstObservedAt,
    providerTimestampIndependentlyVerified: false,
  };
}

export interface CanonicalEventRowClassification {
  readonly evidenceId: string;
  readonly ticker: string | null;
  readonly eventKind: string | null;
  readonly classification: HistoricalPitClassificationResult;
}

export type EventPitCanonicalStudyStatus =
  | CanonicalEventExportLoadStatus | 'COMPLETED';

export interface EventPitCanonicalStudyResult {
  readonly status: EventPitCanonicalStudyStatus;
  readonly reason: string | null;
  readonly rowCount: number | null;
  readonly scope: CanonicalEventExport['scope'] | null;
  readonly symbolCount: number | null;
  readonly classifications: readonly CanonicalEventRowClassification[] | null;
}

/**
 * Runs the real Item A study against a real, already-validated Codex
 * canonical event export. Reports EVERY row's classification
 * individually (never only aggregate counts), per the directive's own
 * instruction -- a market-wide (ticker=null) export legitimately
 * supports bounded macro/Fed research and must never be summarized as
 * if it said anything about ticker-level or company-earnings coverage.
 */
export function runEventPitCanonicalExportStudy(rawExport: unknown): EventPitCanonicalStudyResult {
  const loaded = loadCanonicalEventExport(rawExport);
  if (loaded.status !== 'LOADED' || loaded.export === null) {
    return { status: loaded.status, reason: loaded.reason, rowCount: null, scope: null, symbolCount: null, classifications: null };
  }
  const classifications = loaded.export.rows.map((row) => ({
    evidenceId: row.evidenceId, ticker: row.ticker, eventKind: row.eventKind,
    classification: classifyHistoricalEventPit(fromCanonicalEventExportRow(row)),
  }));
  return {
    status: 'COMPLETED', reason: null, rowCount: loaded.export.rowCount,
    scope: loaded.export.scope, symbolCount: loaded.export.symbolCount, classifications,
  };
}
