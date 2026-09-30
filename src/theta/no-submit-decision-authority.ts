/** A locally computed frontier remains diagnostic until the canonical scan and
 * required persistence succeed. Backfilling bytes does not confer authority. */
export function classifyNoSubmitDecisionAuthority(input: {
  readonly databaseFailure: string | null;
  readonly scanComplete: boolean;
  readonly computedAction: string | null;
  /** Required-path failures only. Optional research gaps do not enter this list. */
  readonly requiredProviderBlockers?: readonly string[];
}) {
  if (input.databaseFailure !== null) return {
    outcome: 'INFRASTRUCTURE_DEFERRED' as const,
    decisionState: 'PROVISIONAL_COMPUTE_RESULT' as const,
    evidenceUse: 'PARTIAL_DIAGNOSTIC_ONLY' as const,
    canonicalAction: null,
    provisionalAction: input.computedAction,
    primaryStop: input.databaseFailure,
    canonicalPersistence: false,
    executionEligible: false,
    exitCode: 1 as const,
  };
  const providerBlocker=input.requiredProviderBlockers?.[0]??null;
  if (providerBlocker!==null || !input.scanComplete || input.computedAction === null || input.computedAction === 'SYSTEM_HOLD') return {
    outcome: providerBlocker!==null || !input.scanComplete ? 'PROVIDER_DEFERRED' as const : 'SYSTEM_HOLD' as const,
    decisionState: 'PROVISIONAL_COMPUTE_RESULT' as const,
    evidenceUse: 'PARTIAL_DIAGNOSTIC_ONLY' as const,
    canonicalAction: null,
    provisionalAction: input.computedAction,
    primaryStop: providerBlocker ?? (!input.scanComplete ? 'CANONICAL_SCAN_INCOMPLETE'
      : input.computedAction === 'SYSTEM_HOLD' ? 'CANONICAL_SYSTEM_HOLD' : 'CANONICAL_ACTION_MISSING'),
    canonicalPersistence: false,
    executionEligible: false,
    exitCode: 1 as const,
  };
  return {
    outcome: 'COMPLETE_DECISION' as const,
    decisionState: 'CANONICAL_PERSISTED_DECISION' as const,
    evidenceUse: 'CANONICAL_NO_SUBMIT_EVIDENCE' as const,
    canonicalAction: input.computedAction,
    provisionalAction: null,
    primaryStop: null,
    canonicalPersistence: true,
    executionEligible: false,
    exitCode: 0 as const,
  };
}
