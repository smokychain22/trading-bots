/**
 * COMMAND 5C-7 item 14 (COMMAND 3 §16, COMMAND 4 item 17). Versioned
 * research return-normalization bases. `selection-bias-receipt.ts`'s
 * `returnNormalizationVersion` field must be one of these -- a caller
 * cannot invent a new basis string ad hoc, and raw, un-normalized dollar
 * P&L is never an accepted value (Command 3 §12/§16's explicit
 * correction: Q's collateral is not the same denominator as D's
 * max-loss, and comparing raw dollars across episodes of different
 * size/duration/risk is exactly the confound this module exists to
 * foreclose).
 */

export const returnNormalizationVersion = 'theta-return-normalization-v1' as const;

export type ReturnNormalizationVersion =
  | 'capital-at-risk-return-v1'
  | 'capital-day-return-v1'
  | 'max-loss-normalized-return-v1'
  | 'collateral-normalized-return-v1';

export const ALL_RETURN_NORMALIZATION_VERSIONS: readonly ReturnNormalizationVersion[] = [
  'capital-at-risk-return-v1',
  'capital-day-return-v1',
  'max-loss-normalized-return-v1',
  'collateral-normalized-return-v1',
];

/** Which strategies this basis is a defensible denominator for, per
 * Command 3 §11/§16 (Q's economic worst case is finite capital-at-risk,
 * never collateral silently substituted; D's true denominator is its own
 * defined max loss, never Q's collateral basis). */
export const RETURN_NORMALIZATION_APPLICABILITY: Readonly<Record<ReturnNormalizationVersion, readonly string[]>> = {
  'capital-at-risk-return-v1': ['THETA_CONVENTIONAL', 'THETA_HOLD_STRIKE', 'THETA_DEFINED_RISK', 'THETA_RECOVERY', 'THETA_CC'],
  'capital-day-return-v1': ['THETA_CONVENTIONAL', 'THETA_HOLD_STRIKE', 'THETA_DEFINED_RISK', 'THETA_RECOVERY', 'THETA_CC'],
  'max-loss-normalized-return-v1': ['THETA_DEFINED_RISK'],
  'collateral-normalized-return-v1': ['THETA_CONVENTIONAL', 'THETA_HOLD_STRIKE'],
};

export interface NormalizedReturnInput {
  readonly wholeChainId: string;
  readonly strategyFamily: string;
  readonly netPnl: number;
  /** Null when the denominator itself is unknown -- never coerced to a
   * fallback denominator (e.g. never silently substituting collateral for
   * a missing max-loss figure). */
  readonly capitalAtRisk: number | null;
  readonly capitalDays: number | null;
  readonly maxLoss: number | null;
  readonly collateral: number | null;
}

export interface NormalizedReturn {
  readonly contractVersion: typeof returnNormalizationVersion;
  readonly wholeChainId: string;
  readonly normalizationVersion: ReturnNormalizationVersion;
  /** `null` (never `0`) when the required denominator for this basis is
   * unavailable for this row -- an unresolvable normalization is dropped
   * from a return series, never silently zeroed. */
  readonly normalizedReturn: number | null;
}

/**
 * A `normalizationVersion` must be declared BEFORE building a return
 * series for a selection-bias campaign (Command 3 §12/Command 5C-7 §14:
 * "must be explicit in every selection-bias campaign... never selected
 * post hoc"). This function only ever computes the one basis it is told
 * to -- it never picks the "best-looking" normalization for a row.
 */
export function computeNormalizedReturn(
  input: NormalizedReturnInput,
  normalizationVersion: ReturnNormalizationVersion,
): NormalizedReturn {
  if (!ALL_RETURN_NORMALIZATION_VERSIONS.includes(normalizationVersion)) {
    throw new Error('RETURN_NORMALIZATION_UNREGISTERED_VERSION');
  }
  const applicable = RETURN_NORMALIZATION_APPLICABILITY[normalizationVersion];
  if (!applicable.includes(input.strategyFamily)) {
    throw new Error(`RETURN_NORMALIZATION_NOT_APPLICABLE_TO_STRATEGY:${input.strategyFamily}`);
  }
  const denominator = (() => {
    switch (normalizationVersion) {
      case 'capital-at-risk-return-v1': return input.capitalAtRisk;
      case 'capital-day-return-v1': return input.capitalAtRisk !== null && input.capitalDays !== null
        ? input.capitalAtRisk * input.capitalDays : null;
      case 'max-loss-normalized-return-v1': return input.maxLoss;
      case 'collateral-normalized-return-v1': return input.collateral;
      default: return null;
    }
  })();
  if (denominator === null || denominator <= 0) {
    return { contractVersion: returnNormalizationVersion, wholeChainId: input.wholeChainId, normalizationVersion, normalizedReturn: null };
  }
  return {
    contractVersion: returnNormalizationVersion,
    wholeChainId: input.wholeChainId,
    normalizationVersion,
    normalizedReturn: input.netPnl / denominator,
  };
}

/**
 * Builds a pre-registered, versioned return series for a selection-bias
 * campaign. `null` rows (unresolvable denominator) are reported as a
 * count, never silently dropped-and-hidden -- a caller must see how many
 * whole chains could not be normalized before treating the series as
 * complete.
 */
export function buildNormalizedReturnSeries(
  inputs: readonly NormalizedReturnInput[],
  normalizationVersion: ReturnNormalizationVersion,
): { readonly series: readonly number[]; readonly wholeChainIds: readonly string[]; readonly unresolvedCount: number } {
  const series: number[] = [];
  const wholeChainIds: string[] = [];
  let unresolvedCount = 0;
  for (const input of inputs) {
    const normalized = computeNormalizedReturn(input, normalizationVersion);
    if (normalized.normalizedReturn === null) { unresolvedCount += 1; continue; }
    series.push(normalized.normalizedReturn);
    wholeChainIds.push(input.wholeChainId);
  }
  return { series, wholeChainIds, unresolvedCount };
}
