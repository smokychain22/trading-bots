export const paperLiveGraduationGovernanceVersion = 'theta-paper-live-graduation-governance-v1' as const;

export const firstPaperCanaryPolicy = Object.freeze({
  policyVersion: 'theta-first-paper-canary-policy-v1',
  environment: 'PAPER' as const,
  strategy: 'THETA_CONVENTIONAL' as const,
  approvedUnderlyings: ['SPY', 'TLT', 'XLE'] as const,
  maximumInitialOrders: 1,
  maximumInitialQuantity: 1,
  automaticNewRiskRelockRequired: true,
  rollback: 'LOCK_ALL_EXECUTION_AND_RECONCILE' as const,
  killSwitchRequired: true,
  reconciliationRequired: true,
  partialFillHandling: 'RECONCILE_FILLED_QUANTITY_THEN_MANAGE_ACTUAL_EXPOSURE' as const,
  managementScheduleRequired: true,
  assignmentProcedure: 'BROKER_FACT_REQUIRED_THEN_WHOLE_CHAIN_MANAGEMENT' as const,
  exerciseProcedure: 'BROKER_FACT_REQUIRED_NO_MONEYNESS_INFERENCE' as const,
  expirationProcedure: 'BROKER_CONFIRMATION_REQUIRED_BEFORE_TERMINAL_STATE' as const,
  followerExecutionAllowed: false,
  liveMoneyAllowed: false,
});

export interface FirstPaperCanaryGovernanceInput {
  readonly strategy: string;
  readonly underlying: string;
  readonly quantity: number;
  readonly priorBrokerOrderCount: number;
  readonly currentWorkerProven: boolean;
  readonly operationalReadinessPassed: boolean;
  readonly ownerPermissionGranted: boolean;
  readonly masterExecutionEnabled: boolean;
  readonly followerExecutionEnabled: boolean;
  readonly pauseNewOrders: boolean;
}

export interface FirstPaperCanaryGovernanceReceipt {
  readonly contractVersion: typeof paperLiveGraduationGovernanceVersion;
  readonly state: 'LOCKED' | 'READY_FOR_OWNER_AUTHORIZATION' | 'AUTHORIZED_BOUNDED_CANARY';
  readonly maximumInitialOrders: 1;
  readonly maximumInitialQuantity: 1;
  readonly paperOnly: true;
  readonly liveAuthorized: false;
  readonly blockers: readonly string[];
}

export function evaluateFirstPaperCanaryGovernance(
  input: FirstPaperCanaryGovernanceInput,
): FirstPaperCanaryGovernanceReceipt {
  const blockers: string[] = [];
  if (input.strategy !== firstPaperCanaryPolicy.strategy) blockers.push('FIRST_CANARY_STRATEGY_NOT_APPROVED');
  if (!(firstPaperCanaryPolicy.approvedUnderlyings as readonly string[]).includes(input.underlying))
    blockers.push('FIRST_CANARY_UNDERLYING_NOT_APPROVED');
  if (input.quantity !== firstPaperCanaryPolicy.maximumInitialQuantity) blockers.push('FIRST_CANARY_QUANTITY_MUST_BE_ONE');
  if (input.priorBrokerOrderCount !== 0) blockers.push('FIRST_CANARY_ALREADY_USED');
  if (!input.currentWorkerProven) blockers.push('CURRENT_WORKER_RUNTIME_PROOF_REQUIRED');
  if (!input.operationalReadinessPassed) blockers.push('OPERATIONAL_READINESS_REQUIRED');
  if (input.followerExecutionEnabled) blockers.push('FOLLOWER_EXECUTION_MUST_REMAIN_LOCKED');

  const technicalBlockers = [...blockers];
  if (!input.ownerPermissionGranted) blockers.push('OWNER_PERMISSION_REQUIRED');
  const authorized = blockers.length === 0 && input.masterExecutionEnabled && !input.pauseNewOrders;
  if (input.ownerPermissionGranted && (!input.masterExecutionEnabled || input.pauseNewOrders)) {
    blockers.push('BOUNDED_CANARY_AUTHORIZATION_NOT_ACTIVE');
  }
  return {
    contractVersion: paperLiveGraduationGovernanceVersion,
    state: authorized ? 'AUTHORIZED_BOUNDED_CANARY'
      : technicalBlockers.length === 0 && !input.ownerPermissionGranted ? 'READY_FOR_OWNER_AUTHORIZATION' : 'LOCKED',
    maximumInitialOrders: 1,
    maximumInitialQuantity: 1,
    paperOnly: true,
    liveAuthorized: false,
    blockers: [...new Set(blockers)],
  };
}

export interface LiveGraduationEvidence {
  readonly resolvedPaperEpisodes: number;
  readonly independentSessions: number;
  readonly paperTimeSpanDays: number;
  readonly regimesObserved: readonly string[];
  readonly effectiveN: number | null;
  readonly afterCostEv: number | null;
  readonly profitFactor: number | null;
  readonly payoffRatio: number | null;
  readonly expectedShortfall: number | null;
  readonly maxDrawdown: number | null;
  readonly calibrationBrierScore: number | null;
  readonly executionQuality: number | null;
  readonly paperSimulationDiscrepancy: number | null;
  readonly providerReliability: number | null;
  readonly runtimeReliability: number | null;
  readonly strategySpecificCriteriaPassed: boolean | null;
}

export interface LiveSmallSafetyPolicy {
  readonly capitalLimitUsd: number;
  readonly dailyLossLimitUsd: number;
  readonly maximumStrategies: number;
  readonly maximumSymbols: number;
  readonly killSwitchPolicyVersion: string;
  readonly manualReviewRequired: true;
  readonly automaticDowngradeToPaper: true;
}

export interface LiveGraduationThresholdPolicy {
  readonly policyVersion: string | null;
  readonly minResolvedPaperEpisodes: number | null;
  readonly minIndependentSessions: number | null;
  readonly minPaperTimeSpanDays: number | null;
  readonly minRegimes: number | null;
  readonly minEffectiveN: number | null;
  readonly minAfterCostEv: number | null;
  readonly minProfitFactor: number | null;
  readonly minPayoffRatio: number | null;
  readonly maxExpectedShortfall: number | null;
  readonly maxDrawdown: number | null;
  readonly maxCalibrationBrierScore: number | null;
  readonly minExecutionQuality: number | null;
  readonly maxPaperSimulationDiscrepancy: number | null;
  readonly minProviderReliability: number | null;
  readonly minRuntimeReliability: number | null;
  readonly strategySpecificCriteriaVersion: string | null;
  readonly liveSmallSafetyPolicy: LiveSmallSafetyPolicy | null;
}

export interface LiveGraduationGovernanceReceipt {
  readonly contractVersion: typeof paperLiveGraduationGovernanceVersion;
  readonly state: 'POLICY_NOT_SET' | 'EVIDENCE_INSUFFICIENT' | 'READY_FOR_OWNER_REVIEW';
  readonly liveAuthorized: false;
  readonly blockers: readonly string[];
}

const thresholdFields = [
  'minResolvedPaperEpisodes', 'minIndependentSessions', 'minPaperTimeSpanDays', 'minRegimes', 'minEffectiveN',
  'minAfterCostEv', 'minProfitFactor', 'minPayoffRatio', 'maxExpectedShortfall', 'maxDrawdown',
  'maxCalibrationBrierScore', 'minExecutionQuality', 'maxPaperSimulationDiscrepancy', 'minProviderReliability',
  'minRuntimeReliability',
] as const;

export function evaluateLiveGraduationGovernance(
  evidence: LiveGraduationEvidence,
  policy: LiveGraduationThresholdPolicy,
): LiveGraduationGovernanceReceipt {
  const unset = policy.policyVersion === null || policy.policyVersion.trim() === ''
    ? ['LIVE_GRADUATION_POLICY_VERSION_NOT_SET'] : [];
  for (const field of thresholdFields) {
    if (policy[field] === null || !Number.isFinite(policy[field])) unset.push(`LIVE_GRADUATION_THRESHOLD_NOT_SET:${field}`);
  }
  if (policy.strategySpecificCriteriaVersion === null || policy.strategySpecificCriteriaVersion.trim() === '') {
    unset.push('STRATEGY_SPECIFIC_CRITERIA_VERSION_NOT_SET');
  }
  const liveSmall = policy.liveSmallSafetyPolicy;
  if (liveSmall === null) unset.push('LIVE_SMALL_SAFETY_POLICY_NOT_SET');
  else if (!Number.isFinite(liveSmall.capitalLimitUsd) || liveSmall.capitalLimitUsd <= 0
    || !Number.isFinite(liveSmall.dailyLossLimitUsd) || liveSmall.dailyLossLimitUsd <= 0
    || !Number.isInteger(liveSmall.maximumStrategies) || liveSmall.maximumStrategies <= 0
    || !Number.isInteger(liveSmall.maximumSymbols) || liveSmall.maximumSymbols <= 0
    || liveSmall.killSwitchPolicyVersion.trim() === '' || !liveSmall.manualReviewRequired
    || !liveSmall.automaticDowngradeToPaper) unset.push('LIVE_SMALL_SAFETY_POLICY_INVALID');
  if (unset.length > 0) return {
    contractVersion: paperLiveGraduationGovernanceVersion, state: 'POLICY_NOT_SET', liveAuthorized: false, blockers: unset,
  };

  const blockers: string[] = [];
  const requireKnown = (name: string, value: number | null): value is number => {
    if (value === null || !Number.isFinite(value)) { blockers.push(`${name}_UNKNOWN`); return false; }
    return true;
  };
  const minEpisodes = policy.minResolvedPaperEpisodes as number;
  const minSessions = policy.minIndependentSessions as number;
  const minRegimes = policy.minRegimes as number;
  if (evidence.resolvedPaperEpisodes < minEpisodes) blockers.push('RESOLVED_PAPER_EPISODES_INSUFFICIENT');
  if (evidence.independentSessions < minSessions) blockers.push('INDEPENDENT_SESSIONS_INSUFFICIENT');
  if (evidence.paperTimeSpanDays < (policy.minPaperTimeSpanDays as number)) blockers.push('PAPER_TIME_SPAN_INSUFFICIENT');
  if (new Set(evidence.regimesObserved).size < minRegimes) blockers.push('REGIME_COVERAGE_INSUFFICIENT');
  if (requireKnown('EFFECTIVE_N', evidence.effectiveN) && evidence.effectiveN < (policy.minEffectiveN as number)) blockers.push('EFFECTIVE_N_INSUFFICIENT');
  if (requireKnown('AFTER_COST_EV', evidence.afterCostEv) && evidence.afterCostEv <= (policy.minAfterCostEv as number)) blockers.push('AFTER_COST_EV_BELOW_POLICY');
  if (requireKnown('PROFIT_FACTOR', evidence.profitFactor) && evidence.profitFactor < (policy.minProfitFactor as number)) blockers.push('PROFIT_FACTOR_BELOW_POLICY');
  if (requireKnown('PAYOFF_RATIO', evidence.payoffRatio) && evidence.payoffRatio < (policy.minPayoffRatio as number)) blockers.push('PAYOFF_RATIO_BELOW_POLICY');
  if (requireKnown('EXPECTED_SHORTFALL', evidence.expectedShortfall) && evidence.expectedShortfall > (policy.maxExpectedShortfall as number)) blockers.push('EXPECTED_SHORTFALL_ABOVE_POLICY');
  if (requireKnown('MAX_DRAWDOWN', evidence.maxDrawdown) && evidence.maxDrawdown > (policy.maxDrawdown as number)) blockers.push('MAX_DRAWDOWN_ABOVE_POLICY');
  if (requireKnown('CALIBRATION_BRIER_SCORE', evidence.calibrationBrierScore)
    && evidence.calibrationBrierScore > (policy.maxCalibrationBrierScore as number)) blockers.push('CALIBRATION_BELOW_POLICY');
  if (requireKnown('EXECUTION_QUALITY', evidence.executionQuality)
    && evidence.executionQuality < (policy.minExecutionQuality as number)) blockers.push('EXECUTION_QUALITY_BELOW_POLICY');
  if (requireKnown('PAPER_SIMULATION_DISCREPANCY', evidence.paperSimulationDiscrepancy)
    && evidence.paperSimulationDiscrepancy > (policy.maxPaperSimulationDiscrepancy as number)) blockers.push('PAPER_SIMULATION_DISCREPANCY_ABOVE_POLICY');
  if (requireKnown('PROVIDER_RELIABILITY', evidence.providerReliability)
    && evidence.providerReliability < (policy.minProviderReliability as number)) blockers.push('PROVIDER_RELIABILITY_BELOW_POLICY');
  if (requireKnown('RUNTIME_RELIABILITY', evidence.runtimeReliability)
    && evidence.runtimeReliability < (policy.minRuntimeReliability as number)) blockers.push('RUNTIME_RELIABILITY_BELOW_POLICY');
  if (evidence.strategySpecificCriteriaPassed !== true) blockers.push(evidence.strategySpecificCriteriaPassed === null
    ? 'STRATEGY_SPECIFIC_CRITERIA_UNKNOWN' : 'STRATEGY_SPECIFIC_CRITERIA_FAILED');
  return {
    contractVersion: paperLiveGraduationGovernanceVersion,
    state: blockers.length === 0 ? 'READY_FOR_OWNER_REVIEW' : 'EVIDENCE_INSUFFICIENT',
    liveAuthorized: false,
    blockers,
  };
}
