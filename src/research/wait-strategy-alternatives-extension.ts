/**
 * COMMAND 4 item 20 (COMMAND 3 §17/§20). Additive extension to the real,
 * already-tested `wait-regret-dataset.ts` (this session's own earlier
 * work, not rebuilt). Adds exactly the fields that directive asked for and
 * were not already present: the full strategy-alternative set considered
 * at a WAIT decision, and an explicit opportunity-cost hierarchy state --
 * WITHOUT modifying the existing, tested `WaitRegretRow` type. Joined by
 * `waitDecisionId`.
 *
 * Per COMMAND 3 §17: opportunity cost follows an explicit hierarchy
 * (`OBSERVED_DEPLOYABLE_ALTERNATIVE > CREDIBLE_BENCHMARK_CASH_YIELD >
 * ZERO_AS_EXPERIMENTAL_CONTROL > UNKNOWN`), and `UNKNOWN` must make the
 * WAIT comparison itself unresolved -- never silently favorable.
 */
import { identifiabilityTaxonomyVersion, type IdentifiabilityStatus } from './empirical-identifiability-taxonomy.js';

export const waitStrategyAlternativesExtensionVersion = 'theta-wait-strategy-alternatives-extension-v1' as const;

export type OpportunityCostBasis = 'OBSERVED_DEPLOYABLE_ALTERNATIVE' | 'CREDIBLE_BENCHMARK_CASH_YIELD' | 'ZERO_AS_EXPERIMENTAL_CONTROL' | 'UNKNOWN';

export interface OpportunityCostState {
  readonly basis: OpportunityCostBasis;
  /** Required non-null for every basis except `UNKNOWN`, where it must be
   * `null` -- an `UNKNOWN` basis can never carry a fabricated value. */
  readonly value: number | null;
}

export function buildOpportunityCostState(basis: OpportunityCostBasis, value: number | null): OpportunityCostState {
  if (basis === 'UNKNOWN' && value !== null) throw new Error('OPPORTUNITY_COST_UNKNOWN_MUST_BE_NULL');
  if (basis !== 'UNKNOWN' && value === null) throw new Error('OPPORTUNITY_COST_NON_UNKNOWN_REQUIRES_VALUE');
  return { basis, value };
}

/** A WAIT comparison can never be resolved as "favorable" when its
 * opportunity cost is UNKNOWN -- this function is the one gate every
 * consumer of a WAIT comparison must call. */
export function waitComparisonIsResolvable(state: OpportunityCostState): boolean {
  return state.basis !== 'UNKNOWN';
}

export interface WaitStrategyAlternative {
  readonly strategyFamily: string;
  readonly eligible: boolean;
  readonly identifiabilityStatus: IdentifiabilityStatus;
}

export interface WaitStrategyAlternativesRow {
  readonly contractVersion: typeof waitStrategyAlternativesExtensionVersion;
  readonly taxonomyVersion: typeof identifiabilityTaxonomyVersion;
  readonly waitDecisionId: string;
  readonly strategyAlternatives: readonly WaitStrategyAlternative[];
  readonly opportunityCost: OpportunityCostState;
}

export function buildWaitStrategyAlternativesRow(input: Omit<WaitStrategyAlternativesRow, 'contractVersion' | 'taxonomyVersion'>): WaitStrategyAlternativesRow {
  return { contractVersion: waitStrategyAlternativesExtensionVersion, taxonomyVersion: identifiabilityTaxonomyVersion, ...input };
}
