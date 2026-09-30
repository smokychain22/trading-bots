/** A locally computed frontier remains diagnostic until the canonical scan and
 * required persistence succeed. Backfilling bytes does not confer authority. */
export function classifyNoSubmitDecisionAuthority(input: {
  readonly databaseFailure: string | null;
  readonly scanComplete: boolean;
  readonly computedAction: string | null;
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
  if (!input.scanComplete || input.computedAction === null) return {
    outcome: !input.scanComplete ? 'PROVIDER_DEFERRED' as const : 'SYSTEM_HOLD' as const,
    decisionState: 'PROVISIONAL_COMPUTE_RESULT' as const,
    evidenceUse: 'PARTIAL_DIAGNOSTIC_ONLY' as const,
    canonicalAction: null,
    provisionalAction: input.computedAction,
    primaryStop: !input.scanComplete ? 'CANONICAL_SCAN_INCOMPLETE' : 'CANONICAL_ACTION_MISSING',
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
