/**
 * COMMAND 4 item 11 (COMMAND 3 §11/§21). Versioned research dependence-
 * grouping contract. Research-only, `brokerAuthority: false`.
 *
 * Groups research rows so the same economic exposure can never cross a
 * train/test fold boundary through different rolled legs, and repeated
 * scans never inflate independent sample count. Exposes `rawN, episodeN,
 * independentN, effectiveN` as four DISTINCT, never-conflated quantities --
 * `effectiveN` stays `null` until a real selection-bias procedure
 * (`selection-bias.py` via `selection-bias-receipt.ts`) actually runs; this
 * module never fabricates it.
 */

export const dependenceGroupingContractVersion = 'theta-dependence-grouping-contract-v1' as const;

export type DependenceGroupKind = 'WHOLE_CHAIN' | 'OVERLAPPING_UNDERLYING_EXPOSURE' | 'MARKET_EVENT_CLUSTER';

export interface DependenceGroupMembership {
  readonly rowId: string;
  readonly chainId: string | null;
  readonly underlying: string | null;
  readonly exposureWindowStart: string | null;
  readonly exposureWindowEnd: string | null;
  readonly marketEventClusterId: string | null;
}

export interface DependenceGroupAssignment {
  readonly rowId: string;
  readonly groupId: string;
  readonly groupKind: DependenceGroupKind;
}

/**
 * `chainId` is the mandatory, primary grouping key -- every row
 * sharing one `chainId` gets the SAME group id regardless of any
 * other field, so a rolled chain's every leg is structurally forced into
 * one fold. Rows without a `chainId` group by overlapping-underlying-
 * exposure-window when both are present, else fall back to a singleton
 * group keyed on the row itself (never silently grouped with an unrelated
 * row merely because both lack richer identity).
 */
export function assignDependenceGroups(memberships: readonly DependenceGroupMembership[]): readonly DependenceGroupAssignment[] {
  const results: DependenceGroupAssignment[] = [];
  for (const m of memberships) {
    if (m.chainId !== null) {
      results.push({ rowId: m.rowId, groupId: `chain:${m.chainId}`, groupKind: 'WHOLE_CHAIN' });
      continue;
    }
    if (m.underlying !== null && m.exposureWindowStart !== null && m.exposureWindowEnd !== null) {
      results.push({ rowId: m.rowId, groupId: `underlying:${m.underlying}:${m.exposureWindowStart}:${m.exposureWindowEnd}`, groupKind: 'OVERLAPPING_UNDERLYING_EXPOSURE' });
      continue;
    }
    if (m.marketEventClusterId !== null) {
      results.push({ rowId: m.rowId, groupId: `event:${m.marketEventClusterId}`, groupKind: 'MARKET_EVENT_CLUSTER' });
      continue;
    }
    results.push({ rowId: m.rowId, groupId: `singleton:${m.rowId}`, groupKind: 'WHOLE_CHAIN' });
  }
  return results;
}

export interface SampleSizeReceipt {
  readonly contractVersion: typeof dependenceGroupingContractVersion;
  readonly rawN: number;
  readonly episodeN: number;
  readonly independentN: number;
  /** `null` until a real DSR/PBO selection-bias procedure has run against
   * this exact dataset -- see `selection-bias-receipt.ts`. Never fabricated
   * as a plausible-looking number. */
  readonly effectiveN: number | null;
}

export function buildSampleSizeReceipt(input: {
  readonly rawObservationCount: number;
  readonly episodeIds: readonly string[];
  readonly assignments: readonly DependenceGroupAssignment[];
  readonly effectiveN: number | null;
}): SampleSizeReceipt {
  return {
    contractVersion: dependenceGroupingContractVersion,
    rawN: input.rawObservationCount,
    episodeN: new Set(input.episodeIds).size,
    independentN: new Set(input.assignments.map((a) => a.groupId)).size,
    effectiveN: input.effectiveN,
  };
}
