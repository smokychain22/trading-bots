/**
 * COMMAND 4 item 8 / COMMAND 3 correction 8. Strategy-choice outcome
 * builder for Q/H/D/WAIT comparison points. Research-only,
 * `brokerAuthority: false`.
 *
 * Per COMMAND 3's own correction: the strategy actually taken CAN
 * eventually have a factual realized common-horizon outcome
 * (`FACTUAL_OBSERVED`). Unchosen strategies remain
 * `COUNTERFACTUAL_REQUIRED` (`NOT_IDENTIFIABLE` here, since none of
 * OFF_POLICY_ESTIMABLE/MATCHED_ESTIMABLE/MODEL_BASED_ESTIMATE apply without
 * additional evidence this builder is not given) -- this module never
 * fabricates Y(Q)/Y(H)/Y(D)/Y(WAIT) for an alternative that was not
 * actually taken.
 */
import { identifiabilityTaxonomyVersion, type IdentifiabilityStatus } from './empirical-identifiability-taxonomy.js';

export const strategyChoiceOutcomeBuilderVersion = 'theta-strategy-choice-outcome-builder-v1' as const;

export interface StrategyAlternative {
  readonly strategyFamily: string;
  readonly wasChosen: boolean;
  readonly preDecisionStateHash: string;
}

export interface StrategyChoiceOutcomeRow {
  readonly contractVersion: typeof strategyChoiceOutcomeBuilderVersion;
  readonly taxonomyVersion: typeof identifiabilityTaxonomyVersion;
  readonly comparisonPointId: string;
  readonly strategyFamily: string;
  readonly preDecisionStateHash: string;
  readonly identifiabilityStatus: IdentifiabilityStatus;
  readonly commonHorizonOutcome: number | null;
}

export function buildStrategyChoiceOutcomeRows(input: {
  readonly comparisonPointId: string;
  readonly alternatives: readonly StrategyAlternative[];
  readonly chosenStrategyResolvedOutcome: number | null;
}): readonly StrategyChoiceOutcomeRow[] {
  const chosen = input.alternatives.filter((a) => a.wasChosen);
  if (chosen.length !== 1) throw new Error('STRATEGY_CHOICE_REQUIRES_EXACTLY_ONE_CHOSEN_ALTERNATIVE');

  return input.alternatives.map((alt) => {
    if (!alt.wasChosen) {
      return {
        contractVersion: strategyChoiceOutcomeBuilderVersion, taxonomyVersion: identifiabilityTaxonomyVersion,
        comparisonPointId: input.comparisonPointId, strategyFamily: alt.strategyFamily,
        preDecisionStateHash: alt.preDecisionStateHash, identifiabilityStatus: 'NOT_IDENTIFIABLE', commonHorizonOutcome: null,
      };
    }
    const resolved = input.chosenStrategyResolvedOutcome !== null;
    return {
      contractVersion: strategyChoiceOutcomeBuilderVersion, taxonomyVersion: identifiabilityTaxonomyVersion,
      comparisonPointId: input.comparisonPointId, strategyFamily: alt.strategyFamily,
      preDecisionStateHash: alt.preDecisionStateHash,
      identifiabilityStatus: resolved ? 'FACTUAL_OBSERVED' : 'NOT_IDENTIFIABLE',
      commonHorizonOutcome: input.chosenStrategyResolvedOutcome,
    };
  });
}
