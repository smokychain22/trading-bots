import { createHash } from 'node:crypto';
import type { SanitizedOptionomicsEventRevision } from '../database/optionomics-event-inspection.js';

// Claude's research envelope v3 is used only for typed research inputs. The
// production producer additionally binds the SHA to the Vercel release facts.
export const canonicalEventExportContract = 'theta-real-data-export-contract-v3' as const;
export type EvidenceAuthority = 'OPTIONOMICS_SESSION_RESEARCH' | 'ALPACA_EXECUTABLE_MARKET'
  | 'ALPACA_BROKER_LIFECYCLE' | 'THETA_PERSISTED_DECISION';

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  }
  const json = JSON.stringify(value);
  if (json === undefined) throw new Error('EXPORT_VALUE_NOT_JSON');
  return json;
}
export const canonicalExportHash = (rows: readonly unknown[]): string => createHash('sha256').update(canonical(rows)).digest('hex');

export interface CanonicalReleaseEvidence {
  readonly canonicalSourceSha: string;
  readonly deploymentUrl: string;
  readonly deploymentEnvironment: 'production';
  readonly source: 'VERCEL_BUILD_METADATA';
}
export interface CanonicalEventRow {
  readonly evidenceId: string;
  readonly sourceRawObservationId: string;
  readonly sourceFusionSnapshotId: string;
  readonly authority: 'OPTIONOMICS_SESSION_RESEARCH';
  readonly providerEventIdHash: string;
  readonly payloadHash: string;
  readonly eventKind: string | null;
  readonly ticker: string | null;
  readonly scheduledAt: string | null;
  readonly providerKnownAt: string | null;
  readonly thetaFirstObservedAt: string;
  readonly decisionTime: string;
  readonly pitTimingState: string;
  readonly forwardEvidence: SanitizedOptionomicsEventRevision['forwardEvidence'];
}
export interface CanonicalEventExport {
  readonly exportContractVersion: typeof canonicalEventExportContract;
  readonly generatedAt: string;
  readonly sanitized: true;
  readonly sourceDescription: string;
  readonly provider: 'OPTIONOMICS';
  readonly sourceWindowStart: string;
  readonly sourceWindowEnd: string;
  readonly scope: 'MARKET_WIDE' | 'SYMBOL_SCOPED' | 'MIXED';
  readonly symbolCount: number;
  readonly canonicalSourceSha: string;
  readonly releaseEvidence: CanonicalReleaseEvidence;
  readonly evidenceIds: readonly string[];
  readonly contentHash: string;
  readonly rowCount: number;
  readonly rows: readonly CanonicalEventRow[];
}

export function buildCanonicalEventExport(input: {
  readonly rows: readonly SanitizedOptionomicsEventRevision[];
  readonly generatedAt: string;
  readonly release: CanonicalReleaseEvidence;
}): CanonicalEventExport {
  if (!/^[0-9a-f]{40}$/.test(input.release.canonicalSourceSha)
    || input.release.deploymentEnvironment !== 'production'
    || !/^trading-bots-[a-z0-9]+-skillswap7\.vercel\.app$/.test(input.release.deploymentUrl)
    || input.release.source !== 'VERCEL_BUILD_METADATA') throw new Error('CANONICAL_RELEASE_EVIDENCE_INVALID');
  if (input.rows.length === 0 || input.rows.length > 100 || !Number.isFinite(Date.parse(input.generatedAt)))
    throw new Error('CANONICAL_EXPORT_WINDOW_INVALID');
  const rows: CanonicalEventRow[] = input.rows.map((row) => ({
    evidenceId: row.observationId, sourceRawObservationId: row.sourceRawObservationId,
    sourceFusionSnapshotId: row.sourceFusionSnapshotId, authority: 'OPTIONOMICS_SESSION_RESEARCH' as const,
    providerEventIdHash: row.providerEventIdHash, payloadHash: row.payloadHash,
    eventKind: row.eventKind, ticker: row.ticker, scheduledAt: row.scheduledAt,
    providerKnownAt: row.providerKnownAt, thetaFirstObservedAt: row.thetaFirstObservedAt,
    decisionTime: row.decisionTime, pitTimingState: row.pitTimingState,
    forwardEvidence: row.forwardEvidence,
  })).sort((a, b) => a.thetaFirstObservedAt.localeCompare(b.thetaFirstObservedAt) || a.evidenceId.localeCompare(b.evidenceId));
  const evidenceIds = rows.map((row) => row.evidenceId);
  if (new Set(evidenceIds).size !== rows.length) throw new Error('CANONICAL_EXPORT_DUPLICATE_EVIDENCE_ID');
  const first = rows[0], last = rows[rows.length - 1];
  if (first === undefined || last === undefined) throw new Error('CANONICAL_EXPORT_WINDOW_INVALID');
  const symbols = new Set(rows.map((row) => row.ticker).filter((symbol): symbol is string => symbol !== null));
  const marketWide = rows.some((row) => row.ticker === null);
  const scope = marketWide && symbols.size === 0 ? 'MARKET_WIDE'
    : marketWide ? 'MIXED' : 'SYMBOL_SCOPED';
  return {
    exportContractVersion: canonicalEventExportContract, generatedAt: input.generatedAt,
    sanitized: true, sourceDescription: 'Immutable Aiven Optionomics event revision observations, no account or credential fields',
    provider: 'OPTIONOMICS', sourceWindowStart: first.thetaFirstObservedAt,
    sourceWindowEnd: last.thetaFirstObservedAt,
    scope, symbolCount: symbols.size,
    canonicalSourceSha: input.release.canonicalSourceSha, releaseEvidence: input.release,
    evidenceIds, contentHash: canonicalExportHash(rows), rowCount: rows.length, rows,
  };
}
