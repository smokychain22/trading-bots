const empiricalBlockerPrefixes = Object.freeze([
  'EV_MODEL_', 'EXPECTED_AFTER_COST_', 'TAIL_EVIDENCE_', 'CAPITAL_DAY_ECONOMICS_',
  'EV_UNCERTAINTY_', 'CALIBRATION_COHORT_', 'PROMOTION_EVIDENCE_', 'RESEARCH_PROMOTION_',
]);

export function isEmpiricalPolicyBlocker(blocker: string): boolean {
  return empiricalBlockerPrefixes.some((prefix) => blocker.startsWith(prefix));
}
