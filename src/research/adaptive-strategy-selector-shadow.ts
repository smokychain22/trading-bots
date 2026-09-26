/**
 * COMMAND 5B item 22: adaptive strategy selector, SHADOW ONLY. Research-
 * only. `brokerAuthority: false` is a LITERAL type, matching Command 4's
 * `shadow-prediction-receipt.ts` pattern -- the type system itself
 * forecloses this interface from ever declaring broker authority.
 *
 * This is an INTERFACE/CONTRACT only. It is not trained and not wired to
 * run against live cycles (that is Codex-runtime-dependent, per the
 * directive's parallelism rule). It has no shared type with, and no
 * import from, `canonical-strategy-frontier.ts` /
 * `canonical-decision-authority.ts` / `management-action-frontier.ts` --
 * structurally incapable of influencing the real Production selection.
 */

export const adaptiveStrategySelectorShadowVersion = 'theta-adaptive-strategy-selector-shadow-v1' as const;

export type ShadowStrategyId = 'THETA_CONVENTIONAL' | 'THETA_HOLD_STRIKE' | 'THETA_DEFINED_RISK' | 'WAIT';

export interface ShadowStrategyUtilityEstimate {
  readonly strategy: ShadowStrategyId;
  /** null until a real, calibrated model produces a value -- never a
   * fabricated utility. */
  readonly utilityEstimate: number | null;
  readonly uncertainty: number | null;
  readonly reasonDecomposition: readonly string[];
}

export interface AdaptiveStrategySelectorShadowReceipt {
  readonly contractVersion: typeof adaptiveStrategySelectorShadowVersion;
  readonly predictionId: string;
  readonly modelId: string;
  readonly modelVersion: string;
  readonly decisionId: string;
  readonly featureSnapshotHash: string;
  readonly predictedAt: string;
  readonly sourceSha: string;
  readonly workerSha: string | null;
  readonly estimates: readonly [
    ShadowStrategyUtilityEstimate, ShadowStrategyUtilityEstimate, ShadowStrategyUtilityEstimate, ShadowStrategyUtilityEstimate,
  ];
  readonly shadowPreferredStrategy: ShadowStrategyId | null;
  readonly shadowOnly: true;
  readonly brokerAuthority: false;
}

export function buildAdaptiveStrategySelectorShadowReceipt(
  input: Omit<AdaptiveStrategySelectorShadowReceipt, 'contractVersion' | 'shadowOnly' | 'brokerAuthority'>,
): AdaptiveStrategySelectorShadowReceipt {
  const strategies = new Set(input.estimates.map((e) => e.strategy));
  if (strategies.size !== 4) throw new Error('ADAPTIVE_SELECTOR_SHADOW_MUST_ESTIMATE_ALL_FOUR_ALTERNATIVES_EXACTLY_ONCE');
  if (input.shadowPreferredStrategy !== null) {
    const preferredEstimate = input.estimates.find((e) => e.strategy === input.shadowPreferredStrategy);
    if (preferredEstimate === undefined || preferredEstimate.utilityEstimate === null) {
      throw new Error('ADAPTIVE_SELECTOR_SHADOW_PREFERRED_STRATEGY_MUST_HAVE_A_REAL_UTILITY_ESTIMATE');
    }
  }
  return { contractVersion: adaptiveStrategySelectorShadowVersion, shadowOnly: true, brokerAuthority: false, ...input };
}
