/**
 * Completeness record for the bounded history reads behind the AEGIS spread and IV stress detectors.
 *
 * Both detectors read "the most recent N rows" inside a lookback window. A read that hit its bound is NOT the complete
 * history, and an assessment built from it must say so rather than look empirically complete. The bound is probed with
 * the limit+1 pattern, so truncation is detected exactly without an unbounded COUNT.
 *
 * Risk effect: none. Truncation only ever REMOVES older rows from the baseline, so counts and maturity can only be
 * lower, which is the fail-safe direction. This record makes that visible; it never relaxes a decision.
 */
export const stressHistoryRowLimit = 5000 as const;

export type StressHistoryCompletenessState =
  | 'COMPLETE_WITHIN_QUERY_CONTRACT'
  | 'TRUNCATED_BOUNDED_HISTORY'
  | 'NOT_SUPPLIED_BY_CALLER';

export interface StressHistoryCompleteness {
  readonly state: StressHistoryCompletenessState;
  /** Rows actually used. null when the caller supplied history without a completeness record. */
  readonly rowCountUsed: number | null;
  readonly rowLimit: number | null;
  readonly oldestObservationAt: string | null;
  readonly newestObservationAt: string | null;
}

/** History handed to an assessor with no record of how it was read is UNKNOWN completeness, never "complete". */
export const stressHistoryNotSupplied: StressHistoryCompleteness = Object.freeze({
  state: 'NOT_SUPPLIED_BY_CALLER', rowCountUsed: null, rowLimit: null, oldestObservationAt: null, newestObservationAt: null,
});

/**
 * @param fetched rows read with `LIMIT rowLimit + 1`, newest first
 * @param timestampOf the observation time of a row (ISO)
 */
export function boundStressHistory<T>(fetched: readonly T[], timestampOf: (row: T) => string,
  rowLimit: number = stressHistoryRowLimit): { readonly rows: readonly T[]; readonly completeness: StressHistoryCompleteness } {
  if (!Number.isSafeInteger(rowLimit) || rowLimit < 1) throw new Error('STRESS_HISTORY_ROW_LIMIT_INVALID');
  const truncated = fetched.length > rowLimit;
  const rows = truncated ? fetched.slice(0, rowLimit) : fetched;
  const times = rows.map(timestampOf).filter((value) => Number.isFinite(Date.parse(value))).toSorted();
  return {
    rows,
    completeness: {
      state: truncated ? 'TRUNCATED_BOUNDED_HISTORY' : 'COMPLETE_WITHIN_QUERY_CONTRACT',
      rowCountUsed: rows.length, rowLimit,
      oldestObservationAt: times.at(0) ?? null, newestObservationAt: times.at(-1) ?? null,
    },
  };
}
