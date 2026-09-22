/**
 * Real-data study runner for the event PIT toolkit (directive Phase 9A).
 * `brokerAuthority: false`. Runs `summarizeHistoricalEventPitStudy` against
 * a Codex-produced sanitized canonical export once one exists; until then,
 * reports AWAITING_REAL_EXPORT rather than fabricating a result from
 * synthetic data and calling it a real study.
 *
 * EXPORT CONTRACT for Codex: a JSON file matching RealDataExportEnvelope
 * (real-data-export-contract.ts) whose `rows` are `EventPitExportRow`
 * below -- one row per persisted event-evidence observation, after
 * sanitization (no credentials/PII), each row already carrying whatever
 * of the five PIT timing fields Production actually persisted (null for
 * any field Production does not yet capture -- never approximated here).
 */
import {
  classifyHistoricalEventPit, summarizeHistoricalEventPitStudy,
  type EventPitRecord, type HistoricalEventPitStudySummary,
} from './event-pit-toolkit.js';
import { loadRealDataExport, type EvidenceLineage } from './real-data-export-contract.js';

export const eventPitRealDataRunnerVersion = 'theta-event-pit-real-data-runner-v1' as const;
export const EVENT_PIT_EXPORT_CONTRACT_VERSION = 'theta-event-pit-export-v1' as const;

export type EventPitExportRow = EventPitRecord;

export interface EventPitRealDataStudyResult {
  readonly status: 'AWAITING_REAL_EXPORT' | 'EXPORT_CONTRACT_INVALID' | 'EXPORT_ROW_COUNT_MISMATCH' | 'EXPORT_CONTENT_HASH_MISMATCH' | 'COMPLETED';
  readonly reason: string | null;
  readonly evidenceLineage: EvidenceLineage | null;
  readonly sourceDescription: string | null;
  readonly generatedAt: string | null;
  readonly summary: HistoricalEventPitStudySummary | null;
  readonly conflictCount: number | null;
}

/**
 * `rawExport` is the already-JSON.parsed export payload (or null/undefined
 * if no export file exists yet) -- this function performs no file I/O
 * itself, keeping it deterministic and directly unit-testable.
 */
export function runEventPitRealDataStudy(rawExport: unknown): EventPitRealDataStudyResult {
  const loaded = loadRealDataExport<EventPitExportRow>(rawExport, EVENT_PIT_EXPORT_CONTRACT_VERSION);
  if (loaded.status !== 'LOADED' || loaded.envelope === null) {
    // loaded.status === 'LOADED' with a null envelope should be unreachable per loadRealDataExport's
    // own contract; the fallback below only satisfies TS's inability to link status and envelope nullability.
    const status = loaded.status === 'LOADED' ? 'EXPORT_CONTRACT_INVALID' : loaded.status;
    return {
      status, reason: loaded.reason, evidenceLineage: null, sourceDescription: null,
      generatedAt: null, summary: null, conflictCount: null,
    };
  }
  const rows = loaded.envelope.rows;
  const summary = summarizeHistoricalEventPitStudy(rows);
  // A row is a "conflict" for this runner's purposes when its own
  // classification is AMBIGUOUS -- surfaced separately here because an
  // operator scanning the receipt should not have to open `summary` to
  // see whether any row needs manual review.
  const conflictCount = rows.filter((row) => classifyHistoricalEventPit(row).classification === 'AMBIGUOUS').length;
  return {
    status: 'COMPLETED', reason: null, evidenceLineage: 'REAL_EXPORT',
    sourceDescription: loaded.envelope.sourceDescription, generatedAt: loaded.envelope.generatedAt,
    summary, conflictCount,
  };
}
