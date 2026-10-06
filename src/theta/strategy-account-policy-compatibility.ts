import type { CandidateCapacityPolicy, CandidateInclusiveAegisInputs, DerivedAccountExposure } from './account-exposure.js';

export type StrategyRiskProfile = 'CASH_SECURED_SHORT_PUT' | 'SHORT_DTE_CASH_SECURED_PUT'
  | 'DEFINED_RISK_VERTICAL' | 'STOCK_INVENTORY' | 'COVERED_CALL';
export type AccountPolicyDimension = 'TICKER_CONCENTRATION' | 'SECTOR_CONCENTRATION' | 'CORRELATION_CLUSTER'
  | 'PORTFOLIO_CAPITAL_AT_RISK' | 'INVENTORY_CAPACITY' | 'ASSIGNMENT_CAPACITY' | 'RECOVERY_CAPACITY';
export type CapitalEvidenceProvenance = 'OBSERVED' | 'DERIVED' | 'CONSERVATIVE_PROXY' | 'UNKNOWN' | 'NOT_APPLICABLE';

export interface StrategyRiskProfileSemantics {
  readonly profile: StrategyRiskProfile;
  readonly capitalBasis: 'SECURED_COLLATERAL' | 'DEFINED_MAX_LOSS' | 'STOCK_INVENTORY_VALUE' | 'INCREMENTAL_CALL_RISK';
  readonly ownershipRequired: boolean;
  readonly applicablePolicyDimensions: readonly AccountPolicyDimension[];
  readonly executionAuthorityGranted: false;
}

const cspDimensions = ['TICKER_CONCENTRATION', 'SECTOR_CONCENTRATION', 'CORRELATION_CLUSTER',
  'PORTFOLIO_CAPITAL_AT_RISK', 'ASSIGNMENT_CAPACITY'] as const;
export const strategyRiskProfileSemantics: Readonly<Record<StrategyRiskProfile, StrategyRiskProfileSemantics>> = {
  CASH_SECURED_SHORT_PUT: { profile: 'CASH_SECURED_SHORT_PUT', capitalBasis: 'SECURED_COLLATERAL', ownershipRequired: true,
    applicablePolicyDimensions: cspDimensions, executionAuthorityGranted: false },
  SHORT_DTE_CASH_SECURED_PUT: { profile: 'SHORT_DTE_CASH_SECURED_PUT', capitalBasis: 'SECURED_COLLATERAL', ownershipRequired: true,
    applicablePolicyDimensions: cspDimensions, executionAuthorityGranted: false },
  DEFINED_RISK_VERTICAL: { profile: 'DEFINED_RISK_VERTICAL', capitalBasis: 'DEFINED_MAX_LOSS', ownershipRequired: false,
    applicablePolicyDimensions: ['TICKER_CONCENTRATION', 'SECTOR_CONCENTRATION', 'CORRELATION_CLUSTER', 'PORTFOLIO_CAPITAL_AT_RISK'],
    executionAuthorityGranted: false },
  STOCK_INVENTORY: { profile: 'STOCK_INVENTORY', capitalBasis: 'STOCK_INVENTORY_VALUE', ownershipRequired: true,
    applicablePolicyDimensions: ['TICKER_CONCENTRATION', 'SECTOR_CONCENTRATION', 'CORRELATION_CLUSTER',
      'PORTFOLIO_CAPITAL_AT_RISK', 'INVENTORY_CAPACITY', 'RECOVERY_CAPACITY'], executionAuthorityGranted: false },
  COVERED_CALL: { profile: 'COVERED_CALL', capitalBasis: 'INCREMENTAL_CALL_RISK', ownershipRequired: false,
    // Fully covered calls reuse broker-confirmed inventory. Share coverage and call-away economics are separate authorities.
    applicablePolicyDimensions: [], executionAuthorityGranted: false },
};

export type StrategyAccountPolicyCompatibilityState = 'ACCOUNT_FEASIBLE' | 'ACCOUNT_FEASIBLE_REDUCED_ONLY'
  | 'STRATEGY_ACCOUNT_POLICY_INCOMPATIBLE' | 'ACCOUNT_INFEASIBLE_BROKER_CAPACITY' | 'UNKNOWN' | 'NOT_APPLICABLE';

export interface AccountPolicyDimensionAssessment {
  readonly dimension: AccountPolicyDimension;
  readonly applicability: 'APPLICABLE' | 'NOT_APPLICABLE';
  readonly state: 'WITHIN_LIMIT' | 'SOFT_LIMIT_REACHED' | 'HARD_LIMIT_REACHED' | 'UNKNOWN' | 'NOT_APPLICABLE';
  readonly valuePct: number | null;
  readonly softLimitPct: number | null;
  readonly hardLimitPct: number | null;
  readonly provenance: CapitalEvidenceProvenance;
  readonly reason: string;
}

export interface CandidateCapitalRiskEvidence {
  readonly unit: 'USD';
  readonly brokerBuyingPower: number | null;
  readonly securedCollateral: number | null;
  readonly definedMaxLoss: number | null;
  readonly portfolioCapitalAtRiskIncrement: number | null;
  readonly assignmentCollateralIncrement: number | null;
  readonly inventoryValueIncrement: number | null;
  readonly concentrationExposureIncrement: number | null;
  readonly capitalBasis: StrategyRiskProfileSemantics['capitalBasis'];
  readonly provenance: Readonly<Record<'brokerBuyingPower' | 'securedCollateral' | 'definedMaxLoss'
    | 'portfolioCapitalAtRiskIncrement' | 'assignmentCollateralIncrement' | 'inventoryValueIncrement'
    | 'concentrationExposureIncrement', CapitalEvidenceProvenance>>;
}

export interface StrategyAccountPolicyCompatibility {
  readonly state: StrategyAccountPolicyCompatibilityState;
  readonly strategy: 'THETA_CONVENTIONAL' | 'THETA_HOLD_STRIKE' | 'THETA_DEFINED_RISK' | 'THETA_RECOVERY' | 'THETA_CC';
  readonly riskProfile: StrategyRiskProfile;
  readonly underlying: string;
  readonly marketApplicable: boolean | null;
  readonly accountFeasible: boolean | null;
  readonly minimumExecutableQuantity: 1;
  readonly minimumCapitalRequired: number | null;
  readonly equity: number | null;
  readonly minimumTickerConcentrationPct: number | null;
  readonly policyLimitPct: number | null;
  readonly hardVetoLimitPct: number | null;
  readonly brokerFeasible: boolean | null;
  readonly ownershipRequired: boolean;
  readonly capitalRiskEvidence: CandidateCapitalRiskEvidence;
  readonly policyAssessments: readonly AccountPolicyDimensionAssessment[];
  readonly bindingPolicies: readonly string[];
  readonly reasons: readonly string[];
  readonly scope: 'CANDIDATE_STRATEGY_RISK_STRUCTURE';
  readonly assessmentVersion: 'theta-strategy-account-policy-compatibility-v2';
  readonly executionAuthorityGranted: false;
}

const allDimensions: readonly AccountPolicyDimension[] = ['TICKER_CONCENTRATION', 'SECTOR_CONCENTRATION',
  'CORRELATION_CLUSTER', 'PORTFOLIO_CAPITAL_AT_RISK', 'INVENTORY_CAPACITY', 'ASSIGNMENT_CAPACITY', 'RECOVERY_CAPACITY'];
const defaultRiskProfile = (strategy: StrategyAccountPolicyCompatibility['strategy']): StrategyRiskProfile =>
  strategy === 'THETA_HOLD_STRIKE' ? 'SHORT_DTE_CASH_SECURED_PUT'
    : strategy === 'THETA_DEFINED_RISK' ? 'DEFINED_RISK_VERTICAL'
      : strategy === 'THETA_RECOVERY' ? 'STOCK_INVENTORY' : strategy === 'THETA_CC' ? 'COVERED_CALL' : 'CASH_SECURED_SHORT_PUT';
const knownNonnegative = (value: number | null): value is number => value !== null && Number.isFinite(value) && value >= 0;
const policyLimit = (dimension: AccountPolicyDimension, policy: CandidateCapacityPolicy): number => ({
  TICKER_CONCENTRATION: policy.maxTickerConcentrationPct, SECTOR_CONCENTRATION: policy.maxSectorConcentrationPct,
  CORRELATION_CLUSTER: policy.maxCorrelationClusterPct, PORTFOLIO_CAPITAL_AT_RISK: policy.maxPortfolioCapitalAtRiskPct,
  INVENTORY_CAPACITY: policy.maxInventoryCapacityPct, ASSIGNMENT_CAPACITY: policy.maxAssignmentCapacityPct,
  RECOVERY_CAPACITY: policy.maxRecoveryCapacityPct,
})[dimension];

export function assessStrategyAccountPolicyCompatibility(input: {
  readonly strategy: StrategyAccountPolicyCompatibility['strategy'];
  readonly riskProfile?: StrategyRiskProfile;
  readonly underlying: string;
  readonly marketApplicable: boolean | null;
  /** CSP collateral, vertical max loss, stock value, or incremental covered-call risk, according to riskProfile. */
  readonly minimumCapitalRequired: number | null;
  readonly securedCollateralRequired?: number | null;
  readonly definedMaxLoss?: number | null;
  readonly brokerAllowedQty: number | null;
  readonly exposure: DerivedAccountExposure;
  readonly policy: CandidateCapacityPolicy | null;
  /** Exact candidate-inclusive inputs sent to AEGIS. When present, these ratios are authoritative. */
  readonly candidateInclusiveAegisInputs?: CandidateInclusiveAegisInputs | null;
}): StrategyAccountPolicyCompatibility {
  const riskProfile = input.riskProfile ?? defaultRiskProfile(input.strategy);
  const semantics = strategyRiskProfileSemantics[riskProfile];
  const capital = input.minimumCapitalRequired;
  const securedCollateral = ['CASH_SECURED_SHORT_PUT', 'SHORT_DTE_CASH_SECURED_PUT'].includes(riskProfile)
    ? (input.securedCollateralRequired ?? capital) : null;
  const definedMaxLoss = riskProfile === 'DEFINED_RISK_VERTICAL' ? (input.definedMaxLoss ?? capital) : null;
  const inventoryIncrement = riskProfile === 'STOCK_INVENTORY' ? capital : riskProfile === 'COVERED_CALL' ? 0 : null;
  const riskIncrement = riskProfile === 'DEFINED_RISK_VERTICAL' ? definedMaxLoss : riskProfile === 'COVERED_CALL' ? 0 : capital;
  const assignmentIncrement = semantics.applicablePolicyDimensions.includes('ASSIGNMENT_CAPACITY') ? securedCollateral : null;
  const concentrationIncrement = riskProfile === 'COVERED_CALL' ? 0 : riskIncrement;
  const provenanceFor = (value: number | null, applicable = true): CapitalEvidenceProvenance =>
    !applicable ? 'NOT_APPLICABLE' : knownNonnegative(value) ? 'DERIVED' : 'UNKNOWN';
  const capitalRiskEvidence: CandidateCapitalRiskEvidence = {
    unit: 'USD', brokerBuyingPower: input.exposure.optionsBuyingPower,
    securedCollateral, definedMaxLoss, portfolioCapitalAtRiskIncrement: riskIncrement,
    assignmentCollateralIncrement: assignmentIncrement, inventoryValueIncrement: inventoryIncrement,
    concentrationExposureIncrement: concentrationIncrement, capitalBasis: semantics.capitalBasis,
    provenance: {
      brokerBuyingPower: input.exposure.optionsBuyingPower !== null ? 'OBSERVED' : 'UNKNOWN',
      securedCollateral: provenanceFor(securedCollateral, securedCollateral !== null),
      definedMaxLoss: provenanceFor(definedMaxLoss, definedMaxLoss !== null),
      portfolioCapitalAtRiskIncrement: provenanceFor(riskIncrement, riskIncrement !== null),
      assignmentCollateralIncrement: provenanceFor(assignmentIncrement, assignmentIncrement !== null),
      inventoryValueIncrement: provenanceFor(inventoryIncrement, inventoryIncrement !== null),
      concentrationExposureIncrement: provenanceFor(concentrationIncrement, concentrationIncrement !== null),
    },
  };
  const base = {
    strategy: input.strategy, riskProfile, underlying: input.underlying, marketApplicable: input.marketApplicable,
    minimumExecutableQuantity: 1 as const, minimumCapitalRequired: capital, equity: input.exposure.equity,
    brokerFeasible: input.brokerAllowedQty === null ? null : input.brokerAllowedQty >= 1,
    ownershipRequired: semantics.ownershipRequired, capitalRiskEvidence,
    scope: 'CANDIDATE_STRATEGY_RISK_STRUCTURE' as const,
    assessmentVersion: 'theta-strategy-account-policy-compatibility-v2' as const, executionAuthorityGranted: false as const,
  };
  const emptyAssessments = (reason: string): AccountPolicyDimensionAssessment[] => allDimensions.map((dimension) => ({
    dimension, applicability: semantics.applicablePolicyDimensions.includes(dimension) ? 'APPLICABLE' : 'NOT_APPLICABLE',
    state: semantics.applicablePolicyDimensions.includes(dimension) ? 'UNKNOWN' : 'NOT_APPLICABLE', valuePct: null,
    softLimitPct: input.policy === null ? null : policyLimit(dimension, input.policy),
    hardLimitPct: input.policy === null ? null : policyLimit(dimension, input.policy) * input.policy.hardCapMultiplier,
    provenance: semantics.applicablePolicyDimensions.includes(dimension) ? 'UNKNOWN' : 'NOT_APPLICABLE', reason,
  }));
  const limits = { policyLimitPct: input.policy?.maxTickerConcentrationPct ?? null,
    hardVetoLimitPct: input.policy === null ? null : input.policy.maxTickerConcentrationPct * input.policy.hardCapMultiplier };
  if (input.marketApplicable === false) return { ...base, ...limits, state: 'NOT_APPLICABLE', accountFeasible: null,
    minimumTickerConcentrationPct: null, policyAssessments: emptyAssessments('MARKET_OR_STRATEGY_NOT_APPLICABLE'),
    bindingPolicies: [], reasons: ['MARKET_OR_STRATEGY_NOT_APPLICABLE'] };
  if (input.brokerAllowedQty !== null && input.brokerAllowedQty < 1) return { ...base, ...limits,
    state: 'ACCOUNT_INFEASIBLE_BROKER_CAPACITY', accountFeasible: false, minimumTickerConcentrationPct: null,
    policyAssessments: emptyAssessments('BROKER_CAPACITY_BELOW_MINIMUM_EXECUTABLE_QUANTITY'),
    bindingPolicies: ['BROKER_CAPACITY'], reasons: ['BROKER_CAPACITY_BELOW_MINIMUM_EXECUTABLE_QUANTITY'] };
  const equity = input.exposure.equity;
  const longValue = input.exposure.longOptionValue === undefined
    ? input.exposure.longPutCount + input.exposure.longCallCount === 0 ? 0 : null : input.exposure.longOptionValue;
  if (input.marketApplicable === null || input.policy === null || equity === null || equity <= 0
    || !knownNonnegative(riskIncrement) || !knownNonnegative(concentrationIncrement)
    || input.exposure.cspCollateralRequired === null || input.exposure.stockInventoryValue === null
    || input.exposure.pendingOpeningCapitalAtRisk === null || input.exposure.pendingAssignmentCollateral === null
    || longValue === null || input.exposure.unclassifiedPositionSymbols === undefined || input.exposure.unclassifiedPositionSymbols.length > 0) {
    return { ...base, ...limits, state: 'UNKNOWN', accountFeasible: null, minimumTickerConcentrationPct: null,
      policyAssessments: emptyAssessments('REQUIRED_ACCOUNT_OR_POLICY_EVIDENCE_UNKNOWN'), bindingPolicies: [],
      reasons: ['REQUIRED_ACCOUNT_OR_POLICY_EVIDENCE_UNKNOWN'] };
  }
  const currentUnderlying = input.exposure.exposureByUnderlying[input.underlying] ?? 0;
  const ticker = (currentUnderlying + concentrationIncrement) / equity;
  const portfolio = (input.exposure.cspCollateralRequired + input.exposure.stockInventoryValue
    + input.exposure.pendingOpeningCapitalAtRisk + longValue + riskIncrement) / equity;
  const assignment = assignmentIncrement === null ? null
    : (input.exposure.cspCollateralRequired + input.exposure.pendingAssignmentCollateral + assignmentIncrement) / equity;
  const inventory = inventoryIncrement === null ? null : (input.exposure.stockInventoryValue + inventoryIncrement) / equity;
  const supplied = input.candidateInclusiveAegisInputs;
  const ratios: Readonly<Record<AccountPolicyDimension, number | null>> = {
    TICKER_CONCENTRATION: supplied?.tickerConcentrationPct ?? ticker,
    SECTOR_CONCENTRATION: supplied?.sectorConcentrationPct ?? ticker,
    CORRELATION_CLUSTER: supplied?.correlationClusterExposurePct ?? ticker,
    PORTFOLIO_CAPITAL_AT_RISK: supplied?.portfolioCapitalAtRiskPct ?? portfolio,
    INVENTORY_CAPACITY: supplied?.inventoryCapacityUsedPct ?? inventory,
    ASSIGNMENT_CAPACITY: supplied?.assignmentCapacityUsedPct ?? assignment,
    RECOVERY_CAPACITY: supplied?.recoveryCapacityUsedPct ?? null,
  };
  const policy = input.policy;
  const policyAssessments: AccountPolicyDimensionAssessment[] = allDimensions.map((dimension) => {
    if (!semantics.applicablePolicyDimensions.includes(dimension)) return { dimension, applicability: 'NOT_APPLICABLE',
      state: 'NOT_APPLICABLE', valuePct: null, softLimitPct: policyLimit(dimension, policy),
      hardLimitPct: policyLimit(dimension, policy) * policy.hardCapMultiplier, provenance: 'NOT_APPLICABLE',
      reason: 'POLICY_DIMENSION_NOT_APPLICABLE_TO_RISK_PROFILE' };
    const value = ratios[dimension]; const soft = policyLimit(dimension, policy); const hard = soft * policy.hardCapMultiplier;
    const state = value === null || !Number.isFinite(value) ? 'UNKNOWN'
      : value >= hard ? 'HARD_LIMIT_REACHED' : value >= soft ? 'SOFT_LIMIT_REACHED' : 'WITHIN_LIMIT';
    const proxy = dimension === 'SECTOR_CONCENTRATION' || dimension === 'CORRELATION_CLUSTER';
    return { dimension, applicability: 'APPLICABLE', state, valuePct: value, softLimitPct: soft, hardLimitPct: hard,
      provenance: value === null ? 'UNKNOWN' : proxy ? 'CONSERVATIVE_PROXY' : 'DERIVED',
      reason: state === 'HARD_LIMIT_REACHED' ? 'VALUE_AT_OR_ABOVE_HARD_LIMIT'
        : state === 'SOFT_LIMIT_REACHED' ? 'VALUE_AT_OR_ABOVE_SOFT_AND_BELOW_HARD_LIMIT'
          : state === 'WITHIN_LIMIT' ? 'VALUE_BELOW_SOFT_LIMIT' : 'REQUIRED_RATIO_UNKNOWN' };
  });
  if (policyAssessments.some((item) => item.state === 'UNKNOWN')) return { ...base, ...limits, state: 'UNKNOWN',
    accountFeasible: null, minimumTickerConcentrationPct: ticker, policyAssessments, bindingPolicies: [],
    reasons: ['REQUIRED_ACCOUNT_POLICY_RATIO_UNKNOWN'] };
  const hard = policyAssessments.filter((item) => item.state === 'HARD_LIMIT_REACHED').map((item) => item.dimension);
  const soft = policyAssessments.filter((item) => item.state === 'SOFT_LIMIT_REACHED').map((item) => item.dimension);
  if (hard.length > 0) return { ...base, ...limits, state: 'STRATEGY_ACCOUNT_POLICY_INCOMPATIBLE',
    accountFeasible: false, minimumTickerConcentrationPct: ticker, policyAssessments, bindingPolicies: hard,
    reasons: ['MINIMUM_EXECUTABLE_UNIT_EXCEEDS_HARD_RISK_POLICY'] };
  return { ...base, ...limits, state: soft.length > 0 ? 'ACCOUNT_FEASIBLE_REDUCED_ONLY' : 'ACCOUNT_FEASIBLE',
    accountFeasible: true, minimumTickerConcentrationPct: ticker, policyAssessments, bindingPolicies: soft,
    reasons: soft.length > 0 ? ['MINIMUM_EXECUTABLE_UNIT_REACHES_SOFT_RISK_POLICY'] : ['MINIMUM_EXECUTABLE_UNIT_WITHIN_POLICY'] };
}

export interface AccountPolicyIncompatibilitySummary {
  readonly totalCandidates: number;
  readonly byUnderlying: Readonly<Record<string, number>>;
  readonly byRiskProfile: Readonly<Record<string, number>>;
  readonly allBindingPolicies: Readonly<Record<string, number>>;
  readonly uniqueBindingPolicies: Readonly<Record<string, number>>;
  readonly cofailBindingSets: Readonly<Record<string, number>>;
  readonly firstBindingPolicies: Readonly<Record<string, number>>;
}

export function summarizeAccountPolicyIncompatibilities(items: readonly StrategyAccountPolicyCompatibility[]): AccountPolicyIncompatibilitySummary {
  const incompatible = items.filter((item) => item.state === 'STRATEGY_ACCOUNT_POLICY_INCOMPATIBLE'
    || item.state === 'ACCOUNT_INFEASIBLE_BROKER_CAPACITY');
  const byUnderlying: Record<string, number> = {};
  const byRiskProfile: Record<string, number> = {};
  const allBindingPolicies: Record<string, number> = {};
  const uniqueBindingPolicies: Record<string, number> = {};
  const cofailBindingSets: Record<string, number> = {};
  const firstBindingPolicies: Record<string, number> = {};
  const count = (record: Record<string, number>, key: string) => { record[key] = (record[key] ?? 0) + 1; };
  for (const item of incompatible) {
    count(byUnderlying, item.underlying); count(byRiskProfile, item.riskProfile);
    item.bindingPolicies.forEach((binding) => count(allBindingPolicies, binding));
    if (item.bindingPolicies.length === 1) count(uniqueBindingPolicies, item.bindingPolicies[0] as string);
    if (item.bindingPolicies.length > 0) { count(firstBindingPolicies, item.bindingPolicies[0] as string);
      count(cofailBindingSets, item.bindingPolicies.join('+')); }
  }
  const sorted = (record: Record<string, number>) => Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)));
  return { totalCandidates: incompatible.length, byUnderlying: sorted(byUnderlying), byRiskProfile: sorted(byRiskProfile),
    allBindingPolicies: sorted(allBindingPolicies), uniqueBindingPolicies: sorted(uniqueBindingPolicies),
    cofailBindingSets: sorted(cofailBindingSets), firstBindingPolicies: sorted(firstBindingPolicies) };
}
