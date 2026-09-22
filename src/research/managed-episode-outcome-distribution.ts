/**
 * Managed-episode outcome distribution (Wave 14 Batch 5). Research-only,
 * `brokerAuthority: false`. The common typed representation of what a
 * mature THETA outcome model should eventually estimate for one managed
 * episode (a full Wheel chain from entry through terminal state) --
 * shared by future entry comparison, profit-taking policy comparison,
 * and WAIT-regret estimation, so those three don't each invent their own
 * outcome schema.
 *
 * Every estimate field carries an explicit `EstimateState` -- this
 * module NEVER substitutes 0 for a missing/unresolved value. A censored
 * chain (still open, outcome not yet resolved) is `CENSORED`, not a
 * guessed final number; an out-of-domain feature combination is
 * `OUT_OF_DOMAIN`; insufficient independent sample size is
 * `INSUFFICIENT_DATA`; a real computed value is `KNOWN`; anything not
 * yet backed by real OOS evidence is `EMPIRICALLY_UNPROVEN`.
 */

export const managedEpisodeOutcomeDistributionVersion = 'theta-managed-episode-outcome-distribution-v1' as const;

export type EstimateState = 'KNOWN' | 'EMPIRICALLY_UNPROVEN' | 'INSUFFICIENT_DATA' | 'CENSORED' | 'OUT_OF_DOMAIN' | 'MODEL_ERROR' | 'NOT_APPLICABLE';

export interface Estimate<T> {
  readonly value: T | null;
  readonly state: EstimateState;
  readonly detail: string | null;
}

export interface Distribution {
  readonly p01: Estimate<number>;
  readonly p05: Estimate<number>;
  readonly p10: Estimate<number>;
  readonly p25: Estimate<number>;
  readonly median: Estimate<number>;
  readonly mean: Estimate<number>;
}

export interface ManagedEpisodeOutcomeDistribution {
  readonly contractVersion: typeof managedEpisodeOutcomeDistributionVersion;
  readonly episodeId: string;
  readonly asOf: string;

  readonly expectedNetPnl: Estimate<number>;
  readonly medianNetPnl: Estimate<number>;

  readonly pProfit: Estimate<number>;
  readonly pAssignment: Estimate<number>;

  readonly pRecoveryWithin30Sessions: Estimate<number>;
  readonly pRecoveryWithin60Sessions: Estimate<number>;
  readonly pRecoveryWithin120Sessions: Estimate<number>;

  readonly downside: Pick<Distribution, 'p01' | 'p05' | 'p10' | 'p25'>;

  readonly expectedCapitalDays: Estimate<number>;

  readonly maeDistribution: Distribution;
  readonly mfeDistribution: Distribution;
  readonly recoveryDurationDistribution: Distribution;
  readonly executionCostDistribution: Distribution;

  readonly uncertainty: Estimate<number>;
  readonly calibrationState: 'CALIBRATED' | 'UNCALIBRATED' | 'NOT_APPLICABLE';

  readonly trainingStart: string | null;
  readonly trainingEnd: string | null;
  readonly sourceDatasetHash: string | null;
  readonly featureSchemaVersion: string;
  readonly modelVersion: string;
}

function known<T>(value: T): Estimate<T> { return { value, state: 'KNOWN', detail: null }; }
function unresolved<T>(state: EstimateState, detail: string): Estimate<T> { return { value: null, state, detail }; }

/**
 * Builds a real, honest distribution record. `dataSufficiency` gates
 * every probabilistic/estimated field: insufficient effective N produces
 * `INSUFFICIENT_DATA` across the board rather than a computed-but-
 * untrustworthy number. A `censoredEpisode: true` input (the chain has
 * not reached a terminal state yet) forces every outcome-dependent field
 * to `CENSORED` -- this module never estimates a final PnL for an
 * episode that has not finished.
 */
export function buildManagedEpisodeOutcomeDistribution(input: {
  readonly episodeId: string;
  readonly asOf: string;
  readonly censoredEpisode: boolean;
  readonly outOfDomain: boolean;
  readonly effectiveIndependentN: number;
  readonly minimumEffectiveN: number;
  readonly featureSchemaVersion: string;
  readonly modelVersion: string;
  readonly trainingStart: string | null;
  readonly trainingEnd: string | null;
  readonly sourceDatasetHash: string | null;
  /** Real computed values, supplied only when the caller has them --
   * omitted fields fall through to the gating logic above. */
  readonly realValues?: {
    readonly expectedNetPnl?: number;
    readonly medianNetPnl?: number;
    readonly pProfit?: number;
    readonly pAssignment?: number;
    readonly expectedCapitalDays?: number;
    readonly uncertainty?: number;
  };
}): ManagedEpisodeOutcomeDistribution {
  if (!Number.isFinite(Date.parse(input.asOf))) throw new Error('INVALID_ASOF');
  if (!Number.isInteger(input.effectiveIndependentN) || input.effectiveIndependentN < 0) throw new Error('INVALID_EFFECTIVE_N');
  if (!Number.isInteger(input.minimumEffectiveN) || input.minimumEffectiveN < 0) throw new Error('INVALID_MINIMUM_N');

  const gate = (): EstimateState | null => {
    if (input.censoredEpisode) return 'CENSORED';
    if (input.outOfDomain) return 'OUT_OF_DOMAIN';
    if (input.effectiveIndependentN < input.minimumEffectiveN) return 'INSUFFICIENT_DATA';
    return null;
  };
  const gateState = gate();

  const field = (realValue: number | undefined, notYetSupportedDetail: string): Estimate<number> => {
    if (gateState !== null) return unresolved(gateState, `${gateState}: effectiveN=${input.effectiveIndependentN}, minimumN=${input.minimumEffectiveN}, censored=${input.censoredEpisode}, outOfDomain=${input.outOfDomain}`);
    if (realValue === undefined) return unresolved('EMPIRICALLY_UNPROVEN', notYetSupportedDetail);
    if (!Number.isFinite(realValue)) throw new Error('INVALID_REAL_VALUE');
    return known(realValue);
  };

  const distributionField = (): Distribution => gateState !== null
    ? {
      p01: unresolved(gateState, 'gated'), p05: unresolved(gateState, 'gated'), p10: unresolved(gateState, 'gated'),
      p25: unresolved(gateState, 'gated'), median: unresolved(gateState, 'gated'), mean: unresolved(gateState, 'gated'),
    }
    : {
      p01: unresolved('EMPIRICALLY_UNPROVEN', 'distribution model not yet built'),
      p05: unresolved('EMPIRICALLY_UNPROVEN', 'distribution model not yet built'),
      p10: unresolved('EMPIRICALLY_UNPROVEN', 'distribution model not yet built'),
      p25: unresolved('EMPIRICALLY_UNPROVEN', 'distribution model not yet built'),
      median: unresolved('EMPIRICALLY_UNPROVEN', 'distribution model not yet built'),
      mean: unresolved('EMPIRICALLY_UNPROVEN', 'distribution model not yet built'),
    };

  return {
    contractVersion: managedEpisodeOutcomeDistributionVersion, episodeId: input.episodeId, asOf: input.asOf,
    expectedNetPnl: field(input.realValues?.expectedNetPnl, 'net PnL model not yet built'),
    medianNetPnl: field(input.realValues?.medianNetPnl, 'net PnL model not yet built'),
    pProfit: field(input.realValues?.pProfit, 'profit-probability model not yet built'),
    pAssignment: field(input.realValues?.pAssignment, 'assignment-probability model not yet built'),
    pRecoveryWithin30Sessions: gateState !== null ? unresolved(gateState, 'gated') : unresolved('EMPIRICALLY_UNPROVEN', 'recovery model not yet built'),
    pRecoveryWithin60Sessions: gateState !== null ? unresolved(gateState, 'gated') : unresolved('EMPIRICALLY_UNPROVEN', 'recovery model not yet built'),
    pRecoveryWithin120Sessions: gateState !== null ? unresolved(gateState, 'gated') : unresolved('EMPIRICALLY_UNPROVEN', 'recovery model not yet built'),
    downside: gateState !== null
      ? { p01: unresolved(gateState, 'gated'), p05: unresolved(gateState, 'gated'), p10: unresolved(gateState, 'gated'), p25: unresolved(gateState, 'gated') }
      : {
        p01: unresolved('EMPIRICALLY_UNPROVEN', 'downside quantile model not yet built'),
        p05: unresolved('EMPIRICALLY_UNPROVEN', 'downside quantile model not yet built'),
        p10: unresolved('EMPIRICALLY_UNPROVEN', 'downside quantile model not yet built'),
        p25: unresolved('EMPIRICALLY_UNPROVEN', 'downside quantile model not yet built'),
      },
    expectedCapitalDays: field(input.realValues?.expectedCapitalDays, 'CapitalDays model not yet built'),
    maeDistribution: distributionField(), mfeDistribution: distributionField(),
    recoveryDurationDistribution: distributionField(), executionCostDistribution: distributionField(),
    uncertainty: field(input.realValues?.uncertainty, 'uncertainty model not yet built'),
    calibrationState: gateState !== null ? 'NOT_APPLICABLE' : 'UNCALIBRATED',
    trainingStart: input.trainingStart, trainingEnd: input.trainingEnd, sourceDatasetHash: input.sourceDatasetHash,
    featureSchemaVersion: input.featureSchemaVersion, modelVersion: input.modelVersion,
  };
}
