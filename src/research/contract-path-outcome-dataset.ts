/**
 * COMMAND 5B items 2/3/4: contract path-outcome dataset. Research-only,
 * `brokerAuthority: false`. Replaces WIN/LOSS reduction with path
 * observations at named checkpoints -- and enforces the directive's most
 * important discipline: a rejected candidate's later-favorable market path
 * is NEVER, by itself, sufficient to construct a `FACTUAL_OBSERVED`
 * outcome. Fill probability, stale quotes, execution cost, assignment
 * risk, AEGIS, capital constraints, and management path are all still
 * unresolved for a candidate that was never actually taken.
 *
 * Wires Command 4's `empirical-identifiability-taxonomy.ts` -- does not
 * invent a parallel truth taxonomy.
 */
import { assertNotShadowClaimingObservedParallel, type IdentifiabilityStatus } from './empirical-identifiability-taxonomy.js';

export const contractPathOutcomeDatasetVersion = 'theta-contract-path-outcome-dataset-v1' as const;

export type PathCheckpoint = '15M' | '1H' | 'EOD' | '1D' | '3D' | '5D' | 'EXPIRATION' | 'COMMON_HORIZON';

export interface PathObservation {
  readonly checkpoint: PathCheckpoint;
  readonly observedAt: string | null;
  /** Real underlying/option market mark at this checkpoint -- market-
   * observed, never a hypothetical fill. */
  readonly marketMarkPath: number | null;
  /** THETA's own modeled after-cost value at this checkpoint, distinct
   * from the raw market mark (execution costs/spread applied). Modeled,
   * never labeled as an actual broker fill. */
  readonly modeledAfterCostPath: number | null;
}

export interface PathStatistics {
  readonly maximumAdverseExcursion: number | null;
  readonly maximumFavorableExcursion: number | null;
  readonly peakProfit: number | null;
  readonly worstProfit: number | null;
  readonly giveback: number | null;
  readonly timeToPeakSeconds: number | null;
  readonly capitalDays: number | null;
  readonly assignmentState: 'NO_ASSIGNMENT' | 'EARLY_ASSIGNMENT' | 'EXPIRATION_ASSIGNMENT' | 'RIGHT_CENSORED' | null;
  readonly recoveryState: string | null;
  readonly terminalState: 'CHAIN_OPEN' | 'CHAIN_CENSORED' | 'CHAIN_RESOLVED' | null;
}

export interface ContractPathOutcomeRow {
  readonly contractVersion: typeof contractPathOutcomeDatasetVersion;
  readonly subjectId: string;
  readonly decisionAt: string;
  /** Whether this subject was ever actually selected/executed -- the sole
   * gate on whether `FACTUAL_OBSERVED` is even reachable for it. */
  readonly wasSelected: boolean;
  readonly wasShadowOnly: boolean;
  readonly identifiabilityStatus: IdentifiabilityStatus;
  readonly path: readonly PathObservation[];
  readonly statistics: PathStatistics;
}

/**
 * The core enforcement point. A candidate that was never selected can
 * never be assigned `FACTUAL_OBSERVED` here, regardless of how favorable
 * its later market path looks -- this function is the one place that
 * invariant is checked, so no dataset builder can bypass it by
 * constructing the row object directly with a different status.
 */
export function buildContractPathOutcomeRow(input: Omit<ContractPathOutcomeRow, 'contractVersion'>): ContractPathOutcomeRow {
  if (!input.wasSelected && input.identifiabilityStatus === 'FACTUAL_OBSERVED') {
    throw new Error('CONTRACT_PATH_UNSELECTED_CANDIDATE_CANNOT_BE_FACTUAL_OBSERVED');
  }
  assertNotShadowClaimingObservedParallel({ status: input.identifiabilityStatus, wasShadowOnly: input.wasShadowOnly });
  return { contractVersion: contractPathOutcomeDatasetVersion, ...input };
}

/**
 * The directive's central example, made mechanical: given only a rejected
 * candidate's later-favorable market path (no fill/execution/assignment
 * evidence at all), the honest identifiability status is `NOT_IDENTIFIABLE`
 * unless the caller supplies real matched-cohort or model-based evidence --
 * a favorable path alone resolves to neither `FACTUAL_OBSERVED` nor even
 * `MATCHED_ESTIMABLE`/`MODEL_BASED_ESTIMATE` without that evidence.
 */
export function classifyRejectedCandidateFavorablePath(input: {
  readonly hasMatchedCohortEvidence: boolean;
  readonly hasModelBasedEstimate: boolean;
}): IdentifiabilityStatus {
  if (input.hasMatchedCohortEvidence) return 'MATCHED_ESTIMABLE';
  if (input.hasModelBasedEstimate) return 'MODEL_BASED_ESTIMATE';
  return 'NOT_IDENTIFIABLE';
}
