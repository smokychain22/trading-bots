import type { CandidateCapacityPolicy, DerivedAccountExposure } from './account-exposure.js';

export type StrategyAccountPolicyCompatibilityState =
  | 'ACCOUNT_FEASIBLE'
  | 'ACCOUNT_FEASIBLE_REDUCED_ONLY'
  | 'STRATEGY_ACCOUNT_POLICY_INCOMPATIBLE'
  | 'ACCOUNT_INFEASIBLE_BROKER_CAPACITY'
  | 'UNKNOWN'
  | 'NOT_APPLICABLE';

export interface StrategyAccountPolicyCompatibility {
  readonly state: StrategyAccountPolicyCompatibilityState;
  readonly strategy: 'THETA_CONVENTIONAL' | 'THETA_DEFINED_RISK';
  readonly underlying: string;
  readonly marketApplicable: boolean | null;
  readonly accountFeasible: boolean | null;
  readonly minimumExecutableQuantity: 1;
  readonly minimumCapitalRequired: number | null;
  readonly equity: number | null;
  readonly minimumTickerConcentrationPct: number | null;
  readonly policyLimitPct: number | null;
  readonly hardVetoLimitPct: number | null;
  readonly bindingPolicies: readonly string[];
  readonly reasons: readonly string[];
  readonly assessmentVersion: 'theta-strategy-account-policy-compatibility-v1';
}

export function assessStrategyAccountPolicyCompatibility(input: {
  readonly strategy: StrategyAccountPolicyCompatibility['strategy'];
  readonly underlying: string;
  readonly marketApplicable: boolean | null;
  readonly minimumCapitalRequired: number | null;
  readonly brokerAllowedQty: number | null;
  readonly exposure: DerivedAccountExposure;
  readonly policy: CandidateCapacityPolicy | null;
}): StrategyAccountPolicyCompatibility {
  const base = {
    strategy: input.strategy, underlying: input.underlying, marketApplicable: input.marketApplicable,
    minimumExecutableQuantity: 1 as const, minimumCapitalRequired: input.minimumCapitalRequired,
    equity: input.exposure.equity, assessmentVersion: 'theta-strategy-account-policy-compatibility-v1' as const,
  };
  if (input.marketApplicable === false) return {
    ...base, state: 'NOT_APPLICABLE', accountFeasible: null, minimumTickerConcentrationPct: null,
    policyLimitPct: input.policy?.maxTickerConcentrationPct ?? null,
    hardVetoLimitPct: input.policy === null ? null : input.policy.maxTickerConcentrationPct * input.policy.hardCapMultiplier,
    bindingPolicies: [], reasons: ['MARKET_OR_STRATEGY_NOT_APPLICABLE'],
  };
  if (input.brokerAllowedQty !== null && input.brokerAllowedQty < 1) return {
    ...base, state: 'ACCOUNT_INFEASIBLE_BROKER_CAPACITY', accountFeasible: false,
    minimumTickerConcentrationPct: null, policyLimitPct: input.policy?.maxTickerConcentrationPct ?? null,
    hardVetoLimitPct: input.policy === null ? null : input.policy.maxTickerConcentrationPct * input.policy.hardCapMultiplier,
    bindingPolicies: ['BROKER_CAPACITY'], reasons: ['BROKER_CAPACITY_BELOW_MINIMUM_EXECUTABLE_QUANTITY'],
  };
  const equity = input.exposure.equity;
  const capital = input.minimumCapitalRequired;
  if (input.marketApplicable === null || input.policy === null || equity === null || equity <= 0
    || capital === null || !Number.isFinite(capital) || capital <= 0
    || input.exposure.cspCollateralRequired === null || input.exposure.stockInventoryValue === null
    || input.exposure.pendingOpeningCapitalAtRisk === null || input.exposure.pendingAssignmentCollateral === null) {
    return {
      ...base, state: 'UNKNOWN', accountFeasible: null, minimumTickerConcentrationPct: null,
      policyLimitPct: input.policy?.maxTickerConcentrationPct ?? null,
      hardVetoLimitPct: input.policy === null ? null : input.policy.maxTickerConcentrationPct * input.policy.hardCapMultiplier,
      bindingPolicies: [], reasons: ['REQUIRED_ACCOUNT_OR_POLICY_EVIDENCE_UNKNOWN'],
    };
  }
  const currentUnderlying = input.exposure.exposureByUnderlying[input.underlying] ?? 0;
  const policy = input.policy;
  const minimumTickerConcentrationPct = (currentUnderlying + capital) / equity;
  const minimumPortfolioRiskPct = (
    input.exposure.cspCollateralRequired + input.exposure.stockInventoryValue
    + input.exposure.pendingOpeningCapitalAtRisk + capital
  ) / equity;
  const minimumAssignmentPct = (
    input.exposure.cspCollateralRequired + input.exposure.pendingAssignmentCollateral + capital
  ) / equity;
  const ratios: ReadonlyArray<[string, number, number]> = [
    ['TICKER_CONCENTRATION', minimumTickerConcentrationPct, policy.maxTickerConcentrationPct],
    ['SECTOR_CONCENTRATION_SINGLE_UNDERLYING', minimumTickerConcentrationPct, policy.maxSectorConcentrationPct],
    ['CORRELATION_CLUSTER_SINGLE_UNDERLYING', minimumTickerConcentrationPct, policy.maxCorrelationClusterPct],
    ['PORTFOLIO_CAPITAL_AT_RISK', minimumPortfolioRiskPct, policy.maxPortfolioCapitalAtRiskPct],
    ['ASSIGNMENT_CAPACITY', minimumAssignmentPct, policy.maxAssignmentCapacityPct],
  ];
  const hard = ratios.filter(([, value, limit]) => value >= limit * policy.hardCapMultiplier).map(([name]) => name);
  const soft = ratios.filter(([, value, limit]) => value >= limit).map(([name]) => name);
  if (hard.length > 0) return {
    ...base, state: 'STRATEGY_ACCOUNT_POLICY_INCOMPATIBLE', accountFeasible: false,
    minimumTickerConcentrationPct, policyLimitPct: policy.maxTickerConcentrationPct,
    hardVetoLimitPct: policy.maxTickerConcentrationPct * policy.hardCapMultiplier,
    bindingPolicies: hard, reasons: ['MINIMUM_EXECUTABLE_UNIT_EXCEEDS_HARD_RISK_POLICY'],
  };
  return {
    ...base, state: soft.length > 0 ? 'ACCOUNT_FEASIBLE_REDUCED_ONLY' : 'ACCOUNT_FEASIBLE', accountFeasible: true,
    minimumTickerConcentrationPct, policyLimitPct: policy.maxTickerConcentrationPct,
    hardVetoLimitPct: policy.maxTickerConcentrationPct * policy.hardCapMultiplier,
    bindingPolicies: soft, reasons: soft.length > 0 ? ['MINIMUM_EXECUTABLE_UNIT_REACHES_SOFT_RISK_POLICY'] : ['MINIMUM_EXECUTABLE_UNIT_WITHIN_POLICY'],
  };
}
