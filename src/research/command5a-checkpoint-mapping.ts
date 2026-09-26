/**
 * UNIFIED TAKEOVER GAP 1: exhaustive checkpoint/status enum mapping
 * between Codex's real Command 5A producer types
 * (`strategy-learning-horizon.ts`'s `StrategyLearningHorizonCode`,
 * `observation-job-state.ts`'s 10-value `ObservationJobState`) and my
 * research-consumer types (`contract-path-outcome-dataset.ts`'s
 * `PathCheckpoint`). No stringly-typed best-effort conversion, no
 * `default -> OBSERVED/UNKNOWN/PENDING` fallback for an unrecognized
 * state -- an exhaustive TypeScript switch with a `never`-typed default
 * branch means a new producer enum value fails to COMPILE here, not just
 * fails at runtime, so version drift between the two sides is caught at
 * build time.
 */
import type { StrategyLearningHorizonCode } from './strategy-learning-horizon.js';
import type { ObservationJobState } from './contract-path-observation-runtime.js';
import type { PathCheckpoint } from './contract-path-outcome-dataset.js';

export const command5aCheckpointMappingVersion = 'theta-command5a-checkpoint-mapping-v1' as const;

function assertNever(value: never, reason: string): never {
  throw new Error(`${reason}:${String(value)}`);
}

/**
 * Producer -> consumer checkpoint mapping. Exhaustive over every real
 * value of `StrategyLearningHorizonCode` (8 values, confirmed from
 * `strategy-learning-horizon.ts`). `PRIMARY_COMMON_HORIZON` maps to
 * `COMMON_HORIZON` -- the two names for the same concept on either side.
 */
export function mapProducerCheckpointToPathCheckpoint(checkpoint: StrategyLearningHorizonCode): PathCheckpoint {
  switch (checkpoint) {
    case '15M': return '15M';
    case '1H': return '1H';
    case 'EOD': return 'EOD';
    case '1_TRADING_DAY': return '1D';
    case '3_TRADING_DAYS': return '3D';
    case '5_TRADING_DAYS': return '5D';
    case 'EXPIRATION': return 'EXPIRATION';
    case 'PRIMARY_COMMON_HORIZON': return 'COMMON_HORIZON';
    default: return assertNever(checkpoint, 'COMMAND5A_CHECKPOINT_MAPPING_UNKNOWN_PRODUCER_VALUE');
  }
}

/** Inverse mapping, for callers that need to go from a consumer-side
 * checkpoint back to the producer's own horizon code (e.g. to re-query
 * the scheduler for a specific checkpoint's job state). Exhaustive over
 * `PathCheckpoint`'s 8 real values. */
export function mapPathCheckpointToProducerCheckpoint(checkpoint: PathCheckpoint): StrategyLearningHorizonCode {
  switch (checkpoint) {
    case '15M': return '15M';
    case '1H': return '1H';
    case 'EOD': return 'EOD';
    case '1D': return '1_TRADING_DAY';
    case '3D': return '3_TRADING_DAYS';
    case '5D': return '5_TRADING_DAYS';
    case 'EXPIRATION': return 'EXPIRATION';
    case 'COMMON_HORIZON': return 'PRIMARY_COMMON_HORIZON';
    default: return assertNever(checkpoint, 'COMMAND5A_CHECKPOINT_MAPPING_UNKNOWN_CONSUMER_VALUE');
  }
}

/** The four confusable-pair distinctions the directive explicitly calls
 * out, made into named, documented groups rather than left implicit in a
 * flat 10-value union. This function classifies a real
 * `ObservationJobState` into exactly one group -- it does not change any
 * runtime behavior, it exists so a caller (and a test) can assert on the
 * distinction directly instead of re-deriving it ad hoc. */
export type ObservationJobStateGroup =
  | 'NOT_YET_DUE' // PENDING, DUE, IN_PROGRESS -- job has not resolved
  | 'RESOLVED_OBSERVED' // OBSERVED -- a real market observation exists
  | 'RESOLVED_MISSED' // MISSED -- the observation window passed with no data at all
  | 'RESOLVED_DEFERRED_PROVIDER' // provider itself was unavailable at due time
  | 'RESOLVED_DEFERRED_MARKET' // market was closed at due time (not a provider failure)
  | 'RESOLVED_INVALIDATED' // the job itself was determined structurally invalid (e.g. contract expired/delisted)
  | 'RESOLVED_CENSORED' // observation window is over, right-censored -- distinct from INVALIDATED: censoring is an epistemically honest "we stopped looking," invalidation is "this job should never have existed"
  | 'RESOLVED_TERMINAL'; // subject's own lifecycle ended (e.g. subject superseded) -- distinct from CENSORED, which is about the OBSERVATION window, not the SUBJECT's lifecycle

export function classifyObservationJobStateGroup(state: ObservationJobState): ObservationJobStateGroup {
  switch (state) {
    case 'PENDING': case 'DUE': case 'IN_PROGRESS': return 'NOT_YET_DUE';
    case 'OBSERVED': return 'RESOLVED_OBSERVED';
    case 'MISSED': return 'RESOLVED_MISSED';
    case 'DEFERRED_PROVIDER': return 'RESOLVED_DEFERRED_PROVIDER';
    case 'DEFERRED_MARKET': return 'RESOLVED_DEFERRED_MARKET';
    case 'INVALIDATED': return 'RESOLVED_INVALIDATED';
    case 'CENSORED': return 'RESOLVED_CENSORED';
    case 'TERMINAL': return 'RESOLVED_TERMINAL';
    default: return assertNever(state, 'COMMAND5A_CHECKPOINT_MAPPING_UNKNOWN_JOB_STATE');
  }
}
