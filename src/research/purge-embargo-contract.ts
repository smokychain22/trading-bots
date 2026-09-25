/**
 * COMMAND 4 item 12 (COMMAND 3 §12/§22). TS-side purge/embargo contract,
 * standardizing the real Python `validation.py` purged walk-forward
 * discipline (Codex/quant-owned, not modified here) for TS research
 * consumers. Research-only, `brokerAuthority: false`.
 *
 * Purge boundary is based on `decisionAt`, the outcome-window END (not just
 * decision time), and `labelAvailableAt` -- a long-duration label (e.g.
 * RECOVERY_DURATION) whose resolution window overlaps the validation
 * period must be purged even if its decision happened well before the
 * split boundary.
 */

export const purgeEmbargoContractVersion = 'theta-purge-embargo-contract-v1' as const;

export interface PurgeEmbargoWindow {
  readonly trainEnd: string;
  readonly embargoEnd: string;
  readonly validationStart: string;
  readonly validationEnd: string;
}

export interface CandidateTrainingRow {
  readonly rowId: string;
  readonly decisionAt: string;
  /** The label's outcome-window end -- for a point-in-time label this
   * equals `decisionAt`/`eventAt`; for a duration label (recovery, managed
   * episode) this is the real resolution/censoring timestamp. */
  readonly labelWindowEnd: string;
  readonly labelAvailableAt: string;
}

export type PurgeDisposition = 'TRAIN_ELIGIBLE' | 'PURGED_OVERLAPS_EMBARGO' | 'VALIDATION_ELIGIBLE' | 'EXCLUDED_FUTURE';

/**
 * A row is TRAIN_ELIGIBLE only if BOTH its decision time AND its label
 * window end fall entirely before `trainEnd`, and its label was actually
 * available by then. A row whose label window END overlaps
 * `[trainEnd, embargoEnd]` is PURGED even if its decision happened well
 * before `trainEnd` -- this is the exact "long-duration label leakage"
 * fix the directive requires.
 */
export function classifyPurgeDisposition(row: CandidateTrainingRow, window: PurgeEmbargoWindow): PurgeDisposition {
  const decisionAt = Date.parse(row.decisionAt);
  const labelWindowEnd = Date.parse(row.labelWindowEnd);
  const labelAvailableAt = Date.parse(row.labelAvailableAt);
  const trainEnd = Date.parse(window.trainEnd);
  const embargoEnd = Date.parse(window.embargoEnd);
  const validationStart = Date.parse(window.validationStart);
  const validationEnd = Date.parse(window.validationEnd);

  if (decisionAt >= validationStart && decisionAt <= validationEnd) {
    return labelAvailableAt <= validationEnd ? 'VALIDATION_ELIGIBLE' : 'EXCLUDED_FUTURE';
  }
  if (decisionAt > validationEnd) return 'EXCLUDED_FUTURE';
  if (decisionAt < trainEnd && labelWindowEnd < trainEnd && labelAvailableAt <= trainEnd) return 'TRAIN_ELIGIBLE';
  if (labelWindowEnd >= trainEnd && labelWindowEnd <= embargoEnd) return 'PURGED_OVERLAPS_EMBARGO';
  if (decisionAt >= trainEnd && decisionAt < validationStart) return 'PURGED_OVERLAPS_EMBARGO';
  return 'PURGED_OVERLAPS_EMBARGO';
}

export interface PurgeEmbargoReport {
  readonly contractVersion: typeof purgeEmbargoContractVersion;
  readonly window: PurgeEmbargoWindow;
  readonly trainRowIds: readonly string[];
  readonly validationRowIds: readonly string[];
  readonly purgedRowIds: readonly string[];
  readonly excludedFutureRowIds: readonly string[];
}

export function buildPurgeEmbargoReport(rows: readonly CandidateTrainingRow[], window: PurgeEmbargoWindow): PurgeEmbargoReport {
  if (Date.parse(window.embargoEnd) < Date.parse(window.trainEnd)) throw new Error('PURGE_EMBARGO_INVALID_WINDOW_ORDER');
  if (Date.parse(window.validationStart) < Date.parse(window.embargoEnd)) throw new Error('PURGE_EMBARGO_VALIDATION_STARTS_BEFORE_EMBARGO_ENDS');
  if (Date.parse(window.validationEnd) < Date.parse(window.validationStart)) throw new Error('PURGE_EMBARGO_INVALID_VALIDATION_WINDOW');

  const train: string[] = []; const validation: string[] = []; const purged: string[] = []; const future: string[] = [];
  for (const row of rows) {
    const disposition = classifyPurgeDisposition(row, window);
    if (disposition === 'TRAIN_ELIGIBLE') train.push(row.rowId);
    else if (disposition === 'VALIDATION_ELIGIBLE') validation.push(row.rowId);
    else if (disposition === 'EXCLUDED_FUTURE') future.push(row.rowId);
    else purged.push(row.rowId);
  }
  return { contractVersion: purgeEmbargoContractVersion, window, trainRowIds: train, validationRowIds: validation, purgedRowIds: purged, excludedFutureRowIds: future };
}
