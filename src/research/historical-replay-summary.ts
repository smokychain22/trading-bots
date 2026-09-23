import { hashJson, type JsonValue } from '../market/fusion-snapshot.js';
import { importHistoricalReplayBatch, type HistoricalReplayRow } from './historical-replay-import.js';
import {
  historicalReplayExportVersion,
  type HistoricalReplayExportArtifact,
} from './historical-replay-export.js';

export const historicalReplaySummaryVersion = 'theta-historical-replay-summary-v1' as const;
const absent = 'ABSENT_IN_HISTORICAL_SCHEMA';

export interface ReplaySessionSummary {
  readonly sessionDate: string;
  readonly candidateCount: number;
  readonly symbolCount: number;
  readonly executableCount: number;
  readonly nonExecutableCount: number;
  readonly executableUnknownCount: number;
  readonly positiveQuantityCount: number;
  readonly zeroQuantityCount: number;
  readonly quantityUnobservedCount: number;
  readonly aegisUnobservedCount: number;
  readonly eventContextObservedCount: number;
  readonly eventSafetyCoverageNotEstablishedCount: number;
  readonly quoteAgeKnownCount: number;
  readonly quoteAgeUnknownCount: number;
  readonly quoteAgeSeconds: {
    readonly p50: number | null;
    readonly p90: number | null;
    readonly p95: number | null;
    readonly p99: number | null;
  };
  /** Codes can coexist, so these counts need not sum to candidateCount. */
  readonly rejectionCodeCounts: Readonly<Record<string, number>>;
}

export interface HistoricalReplaySummary {
  readonly contractVersion: typeof historicalReplaySummaryVersion;
  readonly sourceContractVersion: typeof historicalReplayExportVersion;
  readonly sourceContentHash: string;
  readonly canonicalSourceSha: string;
  readonly sourceSessions: readonly string[];
  readonly rowCount: number;
  readonly importIssueCount: 0;
  readonly sessions: readonly ReplaySessionSummary[];
  readonly falseRejectRate: null;
  readonly waitRegret: null;
  readonly wholeChainOutcomeCount: 0;
  readonly outcomeState: 'ABSENT_IN_HISTORICAL_EXPORT';
  readonly brokerAuthority: false;
}

const newYorkDate = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
});

function sessionDate(iso: string): string {
  const parts = newYorkDate.formatToParts(new Date(iso));
  const value = (type: string): string => parts.find((part) => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

function percentile(sorted: readonly number[], fraction: number): number | null {
  if (sorted.length === 0) return null;
  return sorted[Math.ceil(fraction * sorted.length) - 1] ?? null;
}

function summarizeSession(date: string, rows: readonly HistoricalReplayRow[]): ReplaySessionSummary {
  const ages: number[] = [];
  const reasonCounts = new Map<string, number>();
  for (const row of rows) {
    if (row.quoteProviderTimestamp !== absent) {
      const age = (Date.parse(row.asOf) - Date.parse(row.quoteProviderTimestamp)) / 1000;
      if (Number.isFinite(age) && age >= 0) ages.push(age);
    }
    if (row.rejectionCodes !== absent) {
      for (const code of new Set(row.rejectionCodes)) reasonCounts.set(code, (reasonCounts.get(code) ?? 0) + 1);
    }
  }
  ages.sort((left, right) => left - right);
  return {
    sessionDate: date,
    candidateCount: rows.length,
    symbolCount: new Set(rows.map((row) => row.symbol)).size,
    executableCount: rows.filter((row) => row.executable === true).length,
    nonExecutableCount: rows.filter((row) => row.executable === false).length,
    executableUnknownCount: rows.filter((row) => row.executable === absent).length,
    positiveQuantityCount: rows.filter((row) => typeof row.selectedQty === 'number' && row.selectedQty > 0).length,
    zeroQuantityCount: rows.filter((row) => row.selectedQty === 0).length,
    quantityUnobservedCount: rows.filter((row) => row.selectedQty === absent || row.selectedQty === null).length,
    aegisUnobservedCount: rows.filter((row) => row.aegisState === absent).length,
    eventContextObservedCount: rows.filter((row) => row.eventState === 'OBSERVED_CONTEXT').length,
    // The old export records context presence, not a bounded negative event assurance.
    eventSafetyCoverageNotEstablishedCount: rows.length,
    quoteAgeKnownCount: ages.length,
    quoteAgeUnknownCount: rows.length - ages.length,
    quoteAgeSeconds: {
      p50: percentile(ages, 0.5), p90: percentile(ages, 0.9),
      p95: percentile(ages, 0.95), p99: percentile(ages, 0.99),
    },
    rejectionCodeCounts: Object.fromEntries([...reasonCounts].sort(([a], [b]) => a.localeCompare(b))),
  };
}

/** Analyze an immutable real export. Missing AEGIS and future outcomes stay unavailable. */
export function summarizeHistoricalReplay(artifact: HistoricalReplayExportArtifact): HistoricalReplaySummary {
  if (artifact.contractVersion !== historicalReplayExportVersion || artifact.sanitized !== true
    || artifact.brokerAuthority !== false || artifact.scope !== 'SYMBOL_SCOPED'
    || !Array.isArray(artifact.providerAuthorities)
    || artifact.providerAuthorities[0] !== 'ALPACA_EXECUTABLE_MARKET'
    || artifact.providerAuthorities[1] !== 'THETA_PERSISTED_DECISION'
    || artifact.providerAuthorities.length !== 2) {
    throw new Error('HISTORICAL_REPLAY_EXPORT_CONTRACT_INVALID');
  }
  const { contentHash, ...body } = artifact;
  if (hashJson(body as unknown as JsonValue) !== contentHash) throw new Error('HISTORICAL_REPLAY_EXPORT_HASH_MISMATCH');
  if (!/^[0-9a-f]{40}$/.test(artifact.canonicalSourceSha)) throw new Error('HISTORICAL_REPLAY_EXPORT_SOURCE_SHA_INVALID');
  if (artifact.rowCount !== artifact.rows.length) throw new Error('HISTORICAL_REPLAY_EXPORT_ROW_COUNT_MISMATCH');
  if (artifact.importIssueCount !== 0) throw new Error('HISTORICAL_REPLAY_EXPORT_HAS_IMPORT_ISSUES');
  const evidenceIds = new Set(artifact.rows.flatMap((row) => Array.isArray(row.persistedEvidenceIds)
    ? row.persistedEvidenceIds : []));
  if (artifact.immutableEvidenceIdCount !== evidenceIds.size) {
    throw new Error('HISTORICAL_REPLAY_EXPORT_EVIDENCE_COUNT_MISMATCH');
  }
  if (artifact.symbolCount !== new Set(artifact.rows.map((row) => row.symbol)).size) {
    throw new Error('HISTORICAL_REPLAY_EXPORT_SYMBOL_COUNT_MISMATCH');
  }
  const sourceSessions = [...new Set(artifact.sourceSessions)].sort();
  if (sourceSessions.length === 0 || sourceSessions.length !== artifact.sourceSessions.length
    || sourceSessions.some((date, index) => date !== artifact.sourceSessions[index])) {
    throw new Error('HISTORICAL_REPLAY_EXPORT_SESSION_SET_INVALID');
  }
  if (artifact.sourceWindow.timezone !== 'America/New_York'
    || artifact.sourceWindow.sessionDates.length !== sourceSessions.length
    || artifact.sourceWindow.sessionDates.some((date, index) => date !== sourceSessions[index])) {
    throw new Error('HISTORICAL_REPLAY_EXPORT_SESSION_WINDOW_INVALID');
  }
  const imported = importHistoricalReplayBatch(sourceSessions.join(','), artifact.rows);
  if (imported.issues.length > 0 || imported.rowsAccepted.length !== artifact.rows.length) {
    throw new Error('HISTORICAL_REPLAY_EXPORT_IMPORT_INVALID');
  }
  const bySession = new Map(sourceSessions.map((date) => [date, [] as HistoricalReplayRow[]]));
  for (const row of imported.rowsAccepted) {
    const date = sessionDate(row.asOf);
    const target = bySession.get(date);
    if (!target) throw new Error('HISTORICAL_REPLAY_EXPORT_ROW_OUTSIDE_SESSION_SET');
    target.push(row);
  }
  return {
    contractVersion: historicalReplaySummaryVersion,
    sourceContractVersion: historicalReplayExportVersion,
    sourceContentHash: contentHash,
    canonicalSourceSha: artifact.canonicalSourceSha,
    sourceSessions,
    rowCount: artifact.rowCount,
    importIssueCount: 0,
    sessions: sourceSessions.map((date) => summarizeSession(date, bySession.get(date) ?? [])),
    falseRejectRate: null,
    waitRegret: null,
    wholeChainOutcomeCount: 0,
    outcomeState: 'ABSENT_IN_HISTORICAL_EXPORT',
    brokerAuthority: false,
  };
}
