import { entryModelFamilies } from '../research/theta-entry-model-readiness.js';
import { canonicalV7ProfitTakingPolicies } from '../research/profit-taking-experiment.js';
import { canonicalThetaStrategySources, thetaFeatureFamily, thetaHardRule, thetaStrategyAction } from './strategy-package.js';

export const profitabilityBrainRealityVersion = 'theta-profitability-brain-reality-v1' as const;

export type RealityLevel = 'L0_ABSENT' | 'L1_TYPED_CONTRACT' | 'L2_SOURCE_IMPLEMENTED'
  | 'L3_DETERMINISTIC_TESTED' | 'L4_CANONICAL_INTEGRATED' | 'L5_PERSISTED'
  | 'L6_RUNTIME_REACHABLE' | 'L7_CURRENT_WORKER_REAL_DATA'
  | 'L8_EMPIRICALLY_VALIDATED' | 'L9_BROKER_AUTHORIZED';

export interface CapabilityRealityEvidence {
  readonly typedContract: boolean;
  readonly sourceImplemented: boolean;
  readonly deterministicTested: boolean;
  readonly canonicalIntegrated: boolean;
  readonly persisted: boolean;
  readonly runtimeReachable: boolean;
  readonly currentWorkerRealData: boolean;
  readonly empiricallyValidated: boolean;
  readonly brokerAuthorized: boolean;
}

export type BrainMethodAuthority = 'PRODUCTION_LOCKED' | 'SHADOW' | 'RESEARCH_ONLY';
export type BrainMethodFamily = 'STATE' | 'APPLICABILITY' | 'CANDIDATE_ENUMERATION' | 'ECONOMICS'
  | 'RISK' | 'SIZING' | 'SELECTION' | 'MANAGEMENT' | 'ACCOUNTING' | 'EXECUTION' | 'LEARNING';

export interface ProfitabilityBrainMethod {
  readonly methodId: string;
  readonly family: BrainMethodFamily;
  readonly authority: BrainMethodAuthority;
  readonly sourceEvidence: readonly string[];
  readonly baseEvidence: CapabilityRealityEvidence;
  readonly empiricalBlocker: string | null;
}

const evidence = (level: 0 | 1 | 2 | 3 | 4 | 5 | 6): CapabilityRealityEvidence => ({
  typedContract: level >= 1,
  sourceImplemented: level >= 2,
  deterministicTested: level >= 3,
  canonicalIntegrated: level >= 4,
  persisted: level >= 5,
  runtimeReachable: level >= 6,
  currentWorkerRealData: false,
  empiricallyValidated: false,
  brokerAuthorized: false,
});

const method = (
  methodId: string, family: BrainMethodFamily, authority: BrainMethodAuthority,
  level: 0 | 1 | 2 | 3 | 4 | 5 | 6, sourceEvidence: readonly string[], empiricalBlocker: string | null = null,
): ProfitabilityBrainMethod => ({ methodId, family, authority, sourceEvidence, baseEvidence: evidence(level), empiricalBlocker });

/**
 * Decision-critical method families, not a count of files, functions, enums,
 * indicators, or routes. THETA_R is represented by management methods and is
 * deliberately not counted as a sixth product strategy.
 */
export const profitabilityBrainMethodRegistry: readonly ProfitabilityBrainMethod[] = [
  method('CURRENT_DECISION_STATE', 'STATE', 'PRODUCTION_LOCKED', 6,
    ['src/market/fusion-snapshot.ts', 'src/theta/autonomous-runtime.ts']),
  method('STRATEGY_APPLICABILITY_ROUTER', 'APPLICABILITY', 'PRODUCTION_LOCKED', 6,
    ['bots/theta/quant/models/strategy_router.py', 'src/theta/new-risk-orchestrator.ts']),
  method('CONVENTIONAL_CANDIDATE_ENUMERATION', 'CANDIDATE_ENUMERATION', 'PRODUCTION_LOCKED', 6,
    ['bots/theta/quant/models/theta_q_lattice.py', 'src/theta/canonical-strategy-frontier.ts']),
  method('HOLD_STRIKE_CANDIDATE_ENUMERATION', 'CANDIDATE_ENUMERATION', 'RESEARCH_ONLY', 6,
    ['bots/theta/quant/models/theta_h_baseline.py', 'src/research/shadow-strategy-orchestrator.ts']),
  method('DEFINED_RISK_CANDIDATE_ENUMERATION', 'CANDIDATE_ENUMERATION', 'RESEARCH_ONLY', 6,
    ['src/theta/canonical-strategy-frontier.ts', 'src/research/shadow-strategy-orchestrator.ts']),
  method('RECOVERY_CANDIDATE_ENUMERATION', 'CANDIDATE_ENUMERATION', 'PRODUCTION_LOCKED', 6,
    ['src/theta/canonical-strategy-frontier.ts', 'src/theta/production-paper-management-candidate-source.ts']),
  method('COVERED_CALL_CANDIDATE_ENUMERATION', 'CANDIDATE_ENUMERATION', 'PRODUCTION_LOCKED', 6,
    ['src/theta/covered-call-lattice.ts', 'src/theta/production-paper-management-candidate-source.ts']),
  method('Q_STRUCTURAL_ECONOMIC_DECISION', 'ECONOMICS', 'PRODUCTION_LOCKED', 6,
    ['bots/theta/quant/models/theta_q_baseline.py', 'src/theta/decision-assembly.ts'],
    'Expected after-cost EV remains unavailable until resolved whole-chain outcomes exist.'),
  method('CROSS_STRATEGY_COMMON_HORIZON_COMPARATOR', 'ECONOMICS', 'SHADOW', 4,
    ['src/research/cross-strategy-common-horizon-contract.ts', 'src/theta/canonical-shadow-comparison.ts',
      'src/theta/canonical-strategy-frontier.ts', 'src/theta/postgres-theta-cycle-store.ts'],
    'No calibrated common-horizon Q/H/D utility or sufficient independent OOS outcomes.'),
  method('ADAPTIVE_ECONOMIC_STRATEGY_SWITCHING', 'SELECTION', 'RESEARCH_ONLY', 1,
    ['src/theta/adaptive-decision-brain.ts'],
    'Only an applicability router and a non-authoritative utility contract exist. No adaptive switching policy is implemented.'),
  method('AEGIS_RISK_PERMISSION', 'RISK', 'PRODUCTION_LOCKED', 6,
    ['bots/theta/quant/models/aegis.py', 'src/theta/aegis-derivation.ts']),
  method('CONSTRAINED_QUANTITY_SIZING', 'SIZING', 'PRODUCTION_LOCKED', 6,
    ['bots/theta/quant/models/sizing.py', 'src/theta/canonical-strategy-frontier.ts']),
  method('CANONICAL_ENTRY_SELECTION', 'SELECTION', 'PRODUCTION_LOCKED', 6,
    ['src/theta/canonical-decision-authority.ts', 'src/execution/master-paper-plan-assembly.ts']),
  method('MANAGEMENT_CANDIDATE_DISCOVERY', 'MANAGEMENT', 'PRODUCTION_LOCKED', 6,
    ['src/theta/production-paper-management-candidate-source.ts']),
  method('MANAGEMENT_ACTION_FRONTIER', 'MANAGEMENT', 'PRODUCTION_LOCKED', 6,
    ['src/theta/management-action-frontier.ts', 'src/theta/paper-bootstrap-management-policy.ts'],
    'Forward continuation EV, tail distribution, and opportunity-cost coefficients are empirically unproven.'),
  method('LOSS_ACTION_COMMON_HORIZON_COMPARATOR', 'MANAGEMENT', 'RESEARCH_ONLY', 3,
    ['src/research/loss-roll-experiment.ts']),
  method('PROFIT_TAKING_CHALLENGER_GRID', 'MANAGEMENT', 'RESEARCH_ONLY', 3,
    ['src/research/profit-taking-experiment.ts', 'src/research/profit-taking-replay.ts', 'tools/theta-profit-taking-replay.ts'],
    'Offline dispatcher executes all 17 policies. Real managed episodes and calibrated continuation forecasts remain required.'),
  method('WHOLE_CHAIN_ACCOUNTING', 'ACCOUNTING', 'PRODUCTION_LOCKED', 6,
    ['src/theta/whole-chain-economics.ts', 'src/theta/postgres-whole-chain-components-repository.ts']),
  method('TRANSACTION_COST_ANALYSIS', 'EXECUTION', 'PRODUCTION_LOCKED', 6,
    ['src/execution/confirmed-fill-tca.ts']),
  method('BROKER_RECONCILIATION', 'EXECUTION', 'PRODUCTION_LOCKED', 6,
    ['src/execution/broker-reconciliation-worker.ts']),
  method('WAIT_NEAR_MISS_REGRET', 'LEARNING', 'SHADOW', 5,
    ['src/research/wait-regret-dataset.ts', 'src/theta/runtime-behavior-diagnostic.ts'],
    'Counterfactual labels remain unresolved until forward outcomes are observed.'),
  method('ENTRY_PROFITABILITY_MODEL', 'LEARNING', 'RESEARCH_ONLY', 1,
    ['src/research/theta-entry-model-readiness.ts'],
    'Model readiness contracts exist, but no model is trained, calibrated, OOS-supported, or promoted.'),
  method('MANAGED_EPISODE_DISTRIBUTION_MODEL', 'LEARNING', 'RESEARCH_ONLY', 2,
    ['src/research/managed-episode-outcome-distribution.ts'],
    'Output contract is implemented, but real distribution estimates remain empirically unproven.'),
  method('ENTRY_THESIS_RECEIPT', 'STATE', 'PRODUCTION_LOCKED', 6,
    ['src/theta/entry-thesis-receipt.ts', 'src/theta/new-risk-orchestrator.ts', 'src/theta/postgres-theta-cycle-store.ts'],
    'The thesis is explanatory lineage. Empirical profitability remains unproven.'),
];

const levelOrder: readonly RealityLevel[] = [
  'L0_ABSENT', 'L1_TYPED_CONTRACT', 'L2_SOURCE_IMPLEMENTED', 'L3_DETERMINISTIC_TESTED',
  'L4_CANONICAL_INTEGRATED', 'L5_PERSISTED', 'L6_RUNTIME_REACHABLE',
  'L7_CURRENT_WORKER_REAL_DATA', 'L8_EMPIRICALLY_VALIDATED', 'L9_BROKER_AUTHORIZED',
];

export function realityLevelFor(value: CapabilityRealityEvidence): RealityLevel {
  const stages = [value.typedContract, value.sourceImplemented, value.deterministicTested, value.canonicalIntegrated,
    value.persisted, value.runtimeReachable, value.currentWorkerRealData, value.empiricallyValidated, value.brokerAuthorized];
  const firstMissing = stages.findIndex((stage) => !stage);
  return levelOrder[firstMissing < 0 ? 9 : firstMissing] as RealityLevel;
}

export interface ProfitabilityBrainRealityReceipt {
  readonly version: typeof profitabilityBrainRealityVersion;
  readonly strategyCount: number;
  readonly strategies: readonly string[];
  readonly actionCount: number;
  readonly actions: readonly string[];
  readonly hardRuleCount: number;
  readonly hardRules: readonly string[];
  readonly softFeatureFamilyCount: number;
  readonly softFeatureFamilies: readonly string[];
  readonly methodCount: number;
  readonly empiricalModelFamilyCount: number;
  readonly empiricalModelFamilies: readonly string[];
  readonly profitTakingChallengerCount: number;
  readonly methods: readonly (ProfitabilityBrainMethod & { readonly evidence: CapabilityRealityEvidence; readonly level: RealityLevel })[];
  readonly levelCounts: Readonly<Record<RealityLevel, number>>;
  readonly brokerAuthorizedMethodCount: number;
}

export function buildProfitabilityBrainRealityReceipt(input: {
  readonly currentWorkerRealData?: readonly string[];
  readonly empiricallyValidated?: readonly string[];
  readonly brokerAuthorized?: readonly string[];
} = {}): ProfitabilityBrainRealityReceipt {
  const current = new Set(input.currentWorkerRealData ?? []);
  const empirical = new Set(input.empiricallyValidated ?? []);
  const authorized = new Set(input.brokerAuthorized ?? []);
  const methods = profitabilityBrainMethodRegistry.map((item) => {
    const merged: CapabilityRealityEvidence = {
      ...item.baseEvidence,
      currentWorkerRealData: item.baseEvidence.runtimeReachable && current.has(item.methodId),
      empiricallyValidated: item.baseEvidence.runtimeReachable && current.has(item.methodId) && empirical.has(item.methodId),
      brokerAuthorized: item.baseEvidence.runtimeReachable && current.has(item.methodId)
        && empirical.has(item.methodId) && authorized.has(item.methodId),
    };
    return { ...item, evidence: merged, level: realityLevelFor(merged) };
  });
  const levelCounts = Object.fromEntries(
    levelOrder.map((level) => [level, methods.filter((item) => item.level === level).length]),
  ) as Record<RealityLevel, number>;
  return {
    version: profitabilityBrainRealityVersion,
    strategyCount: canonicalThetaStrategySources.length,
    strategies: canonicalThetaStrategySources.map((item) => item.branch),
    actionCount: thetaStrategyAction.options.length,
    actions: thetaStrategyAction.options,
    hardRuleCount: thetaHardRule.options.length,
    hardRules: thetaHardRule.options,
    softFeatureFamilyCount: thetaFeatureFamily.options.length,
    softFeatureFamilies: thetaFeatureFamily.options,
    methodCount: methods.length,
    empiricalModelFamilyCount: entryModelFamilies.length,
    empiricalModelFamilies: entryModelFamilies,
    profitTakingChallengerCount: canonicalV7ProfitTakingPolicies.length,
    methods,
    levelCounts,
    brokerAuthorizedMethodCount: methods.filter((item) => item.level === 'L9_BROKER_AUTHORIZED').length,
  };
}
