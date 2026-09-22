/**
 * Historical replay import adapter (Wave 13 Batch 5). Research-only,
 * `brokerAuthority: false`. Defines the export contract Codex can
 * produce once Aiven access is usable (Q-10 in
 * `THETA_CODEX_INTEGRATION_QUEUE.md`), and a real, tested validator/
 * importer so real Sep-16/18/21 rows can be run through
 * `historical-false-reject-analyzer.ts` the moment that export exists.
 * This module never blocks on Q-10 -- it is built and tested now, ready
 * for real data whenever it arrives.
 *
 * Every field a historical row might legitimately not have carried is
 * `ABSENT_IN_HISTORICAL_SCHEMA`, a distinct state from `null` (data was
 * captured but empty) -- this module never invents fake null semantics
 * for a field the historical schema never populated at all.
 */
import { z } from 'zod';

export const historicalReplayImportVersion = 'theta-historical-replay-import-v1' as const;

const absentOrString = z.union([z.string(), z.literal('ABSENT_IN_HISTORICAL_SCHEMA')]);
const absentOrNumber = z.union([z.number(), z.null(), z.literal('ABSENT_IN_HISTORICAL_SCHEMA')]);
const absentOrBoolean = z.union([z.boolean(), z.literal('ABSENT_IN_HISTORICAL_SCHEMA')]);
const absentOrStringArray = z.union([z.array(z.string()), z.literal('ABSENT_IN_HISTORICAL_SCHEMA')]);

/** The exact export contract Codex should produce -- every required
 * candidate export field named in this wave's directive, each real or
 * explicitly ABSENT_IN_HISTORICAL_SCHEMA, never a fabricated default. */
export const historicalReplayRowSchema = z.object({
  candidateId: z.string().min(1),
  cycleId: z.string().min(1),
  asOf: z.string().datetime({ offset: true }),
  symbol: z.string().min(1),
  strategy: absentOrString,
  dte: absentOrNumber,
  strike: absentOrNumber,
  delta: absentOrNumber,
  bid: absentOrNumber,
  ask: absentOrNumber,
  quoteProviderTimestamp: absentOrString,
  quoteReceivedAt: absentOrString,
  executable: absentOrBoolean,
  rejectionCodes: absentOrStringArray,
  eventState: absentOrString,
  aegisState: absentOrString,
  sizingState: absentOrString,
  selectedQty: absentOrNumber,
  economicDisposition: absentOrString,
  persistedEvidenceIds: absentOrStringArray,
});
export type HistoricalReplayRow = z.infer<typeof historicalReplayRowSchema>;

export interface HistoricalReplayImportIssue {
  readonly rowIndex: number;
  readonly candidateId: string | null;
  readonly code: 'SCHEMA_INVALID' | 'DUPLICATE_CANDIDATE_ID' | 'PIT_TIMESTAMP_INVALID' | 'PIT_TIMESTAMP_FUTURE' | 'EVIDENCE_INCOMPLETE';
  readonly detail: string;
}

export interface HistoricalReplayImportResult {
  readonly importVersion: typeof historicalReplayImportVersion;
  readonly asOfDate: string;
  readonly rowsTotal: number;
  readonly rowsAccepted: readonly HistoricalReplayRow[];
  readonly issues: readonly HistoricalReplayImportIssue[];
  readonly brokerAuthority: false;
}

/**
 * Validates a real batch of raw import rows (parsed from Codex's JSON/CSV
 * export) into `HistoricalReplayRow`s, or a precise per-row issue.
 * Checks: schema shape, duplicate candidateId within the batch, PIT
 * timestamp validity (parseable, not future-dated relative to `asOf` --
 * a future-dated quote observation is a real PIT violation, never
 * silently accepted), and evidence completeness (a row with zero
 * persisted evidence IDs is flagged, not silently treated as complete).
 */
export function importHistoricalReplayBatch(asOfDate: string, rawRows: readonly unknown[]): HistoricalReplayImportResult {
  const issues: HistoricalReplayImportIssue[] = [];
  const accepted: HistoricalReplayRow[] = [];
  const seenCandidateIds = new Set<string>();

  rawRows.forEach((raw, rowIndex) => {
    const parsed = historicalReplayRowSchema.safeParse(raw);
    if (!parsed.success) {
      const candidateId = typeof (raw as Record<string, unknown>)?.candidateId === 'string'
        ? (raw as Record<string, unknown>).candidateId as string : null;
      issues.push({ rowIndex, candidateId, code: 'SCHEMA_INVALID', detail: parsed.error.issues.map((i) => i.message).join('; ') });
      return;
    }
    const row = parsed.data;
    if (seenCandidateIds.has(row.candidateId)) {
      issues.push({ rowIndex, candidateId: row.candidateId, code: 'DUPLICATE_CANDIDATE_ID', detail: `candidateId "${row.candidateId}" already seen in this batch.` });
      return;
    }
    seenCandidateIds.add(row.candidateId);

    const asOfMs = Date.parse(row.asOf);
    if (!Number.isFinite(asOfMs)) {
      issues.push({ rowIndex, candidateId: row.candidateId, code: 'PIT_TIMESTAMP_INVALID', detail: `asOf "${row.asOf}" does not parse.` });
      return;
    }
    if (typeof row.quoteProviderTimestamp === 'string') {
      const quoteMs = Date.parse(row.quoteProviderTimestamp);
      if (Number.isFinite(quoteMs) && quoteMs > asOfMs) {
        issues.push({
          rowIndex, candidateId: row.candidateId, code: 'PIT_TIMESTAMP_FUTURE',
          detail: `quoteProviderTimestamp (${row.quoteProviderTimestamp}) is after asOf (${row.asOf}) -- a real PIT violation, row rejected.`,
        });
        return;
      }
    }
    if (row.persistedEvidenceIds === 'ABSENT_IN_HISTORICAL_SCHEMA'
      || (Array.isArray(row.persistedEvidenceIds) && row.persistedEvidenceIds.length === 0)) {
      issues.push({
        rowIndex, candidateId: row.candidateId, code: 'EVIDENCE_INCOMPLETE',
        detail: 'No persisted evidence IDs -- row accepted for structural fields but should not be treated as fully evidence-backed.',
      });
    }
    accepted.push(row);
  });

  return {
    importVersion: historicalReplayImportVersion, asOfDate, rowsTotal: rawRows.length,
    rowsAccepted: accepted, issues, brokerAuthority: false,
  };
}
