import { canonicalV7ProfitTakingPolicies, v7ProfitTakingPolicyDefinitions } from '../research/profit-taking-experiment.js';
import { canonicalBrainLayers } from './canonical-system-truth.js';
import { featureFamilyAuthorityMatrix, providerCapabilityAuthorityMatrix } from './phase2-market-intelligence-registry.js';
import {
  fiveStrategyRealityMatrix, profitabilityBrainMethodRegistry, realityLevelFor, type RealityLevel,
} from './profitability-brain-reality.js';
import { canonicalThetaStrategySources, thetaHardRule, thetaStrategyAction } from './strategy-package.js';
import { authorityForClassification, classifyPostgresRelation } from '../storage/storage-authority-registry.js';

export const deepSystemInventoryVersion = 'theta-deep-system-inventory-v1' as const;

export type InventoryCategory =
  | 'METHOD' | 'STRATEGY' | 'ACTION' | 'FEATURE' | 'HARD_RULE' | 'AEGIS_FAMILY'
  | 'BRAIN_LAYER' | 'PROFIT_POLICY' | 'CLAUDE_WORK_PACKAGE' | 'COMMAND5A_COMPONENT'
  | 'PROVIDER_CAPABILITY' | 'INFRASTRUCTURE';

export type InventoryAuthority = 'PRODUCTION_LOCKED' | 'SHADOW' | 'RESEARCH_ONLY' | 'OPERATIONAL' | 'NONE';
export type EmpiricalStatus = 'NOT_APPLICABLE' | 'EMPIRICALLY_UNPROVEN' | 'INSUFFICIENT_SAMPLE' | 'VALIDATED';
export type BrokerAuthority = 'LOCKED_PAPER_PATH' | 'NO' | 'OWNER_PERMISSION_REQUIRED';

export interface DeepSystemInventoryRow {
  readonly id: string;
  readonly category: InventoryCategory;
  readonly canonicalPhase: `PHASE_${number}`;
  readonly sourceFiles: readonly string[];
  readonly producer: string;
  readonly inputs: readonly string[];
  readonly inputTruthClass: string;
  readonly normalization: string;
  readonly units: string;
  readonly timestampSemantics: string;
  readonly freshnessRule: string;
  readonly persistence: string;
  readonly consumer: string;
  readonly runtimeCaller: string;
  readonly currentAuthority: InventoryAuthority;
  readonly realityLevel: RealityLevel;
  readonly historicalRealData: boolean;
  readonly currentWorkerRealData: boolean;
  readonly empiricalStatus: EmpiricalStatus;
  readonly paperAuthority: BrokerAuthority;
  readonly liveAuthority: 'NO';
  readonly unknownFields: readonly string[];
  readonly failureBehavior: string;
  readonly replaySupport: string;
  readonly tests: readonly string[];
  readonly currentBlocker: string | null;
  readonly nextAction: string;
}

const methodPhase: Readonly<Record<string, `PHASE_${number}`>> = {
  CURRENT_DECISION_STATE: 'PHASE_3', STRATEGY_APPLICABILITY_ROUTER: 'PHASE_3',
  CONVENTIONAL_CANDIDATE_ENUMERATION: 'PHASE_4', HOLD_STRIKE_CANDIDATE_ENUMERATION: 'PHASE_4',
  DEFINED_RISK_CANDIDATE_ENUMERATION: 'PHASE_4', DEFINED_RISK_LOCKED_MULTI_LEG_PLAN: 'PHASE_4',
  DEFINED_RISK_MANAGEMENT_REPLAY: 'PHASE_4', RECOVERY_CANDIDATE_ENUMERATION: 'PHASE_4',
  COVERED_CALL_CANDIDATE_ENUMERATION: 'PHASE_4', Q_STRUCTURAL_ECONOMIC_DECISION: 'PHASE_4',
  CROSS_STRATEGY_COMMON_HORIZON_COMPARATOR: 'PHASE_3', ADAPTIVE_SHADOW_STRUCTURE_COMPARISON: 'PHASE_3',
  ADAPTIVE_ECONOMIC_STRATEGY_SWITCHING: 'PHASE_6', AEGIS_RISK_PERMISSION: 'PHASE_5',
  CONSTRAINED_QUANTITY_SIZING: 'PHASE_5', CANONICAL_ENTRY_SELECTION: 'PHASE_3',
  CANONICAL_DECISION_HANDOFF_VALIDATION: 'PHASE_3', MANAGEMENT_CANDIDATE_DISCOVERY: 'PHASE_4',
  MANAGEMENT_ACTION_FRONTIER: 'PHASE_4', LOSS_ACTION_COMMON_HORIZON_COMPARATOR: 'PHASE_4',
  PROFIT_TAKING_CHALLENGER_GRID: 'PHASE_4', WHOLE_CHAIN_RESEARCH_DATASET: 'PHASE_6',
  SELECTED_CSP_ENTRY_BASELINE_AND_ABLATION: 'PHASE_6', CONTROLLED_OUTCOME_EXPERIMENT_EXECUTION: 'PHASE_6',
  PURGED_CALIBRATION_VALIDATION_EXECUTION: 'PHASE_6', WHOLE_CHAIN_ACCOUNTING: 'PHASE_4',
  TRANSACTION_COST_ANALYSIS: 'PHASE_5', BROKER_RECONCILIATION: 'PHASE_1',
  WAIT_NEAR_MISS_REGRET: 'PHASE_6', ENTRY_PROFITABILITY_MODEL: 'PHASE_6',
  MANAGED_EPISODE_DISTRIBUTION_MODEL: 'PHASE_6', ENTRY_THESIS_RECEIPT: 'PHASE_3',
};

const familySemantics = {
  STATE: { inputs: ['broker, market, provider and policy evidence'], normalization: 'immutable typed state', units: 'mixed typed evidence', persistence: 'T0 and cycle evidence', consumer: 'decision kernel' },
  APPLICABILITY: { inputs: ['current decision state'], normalization: 'tri-state applicability', units: 'categorical', persistence: 'router receipt', consumer: 'candidate enumeration' },
  CANDIDATE_ENUMERATION: { inputs: ['contract chain and strategy policy'], normalization: 'exact contract identities', units: 'contract candidates', persistence: 'canonical frontier', consumer: 'economics and risk' },
  ECONOMICS: { inputs: ['candidate prices, costs, capital and horizon'], normalization: 'per-share to per-contract with explicit multiplier', units: 'USD, days, ratios', persistence: 'frontier economics', consumer: 'comparison and selection' },
  RISK: { inputs: ['candidate-bound portfolio and provider evidence'], normalization: '12 independent risk families', units: 'states, percentages and reasons', persistence: 'AEGIS assessment', consumer: 'sizing and decision' },
  SIZING: { inputs: ['broker and policy capacity bounds'], normalization: 'nonnegative whole contracts', units: 'contracts', persistence: 'sizing waterfall', consumer: 'canonical decision' },
  SELECTION: { inputs: ['feasible candidate frontier and WAIT'], normalization: 'single sovereign result', units: 'candidate/action identity', persistence: 'decision and handoff receipt', consumer: 'locked plan assembly' },
  MANAGEMENT: { inputs: ['position lifecycle and forward alternatives'], normalization: 'whole-chain action alternatives', units: 'USD, capital-days, action state', persistence: 'management evidence', consumer: 'management authority or research' },
  ACCOUNTING: { inputs: ['broker facts and all lifecycle legs'], normalization: 'whole-chain cash-flow identity', units: 'USD', persistence: 'whole-chain ledger', consumer: 'outcomes and research' },
  EXECUTION: { inputs: ['exact BBO, intent and broker facts'], normalization: 'exact-contract after-cost execution evidence', units: 'USD, milliseconds, contracts', persistence: 'intent, TCA and reconciliation', consumer: 'plan safety and outcomes' },
  LEARNING: { inputs: ['PIT episodes, outcomes and dependency groups'], normalization: 'truth-classed chronological research rows', units: 'task-specific', persistence: 'research datasets and receipts', consumer: 'shadow evaluation and promotion governance' },
} as const;

export const methodInventory: readonly DeepSystemInventoryRow[] = profitabilityBrainMethodRegistry.map((method) => {
  const semantics = familySemantics[method.family];
  const level = realityLevelFor(method.baseEvidence);
  return {
    id: method.methodId, category: 'METHOD', canonicalPhase: methodPhase[method.methodId] ?? 'PHASE_6',
    sourceFiles: method.sourceEvidence, producer: method.sourceEvidence[0] ?? 'NO_SOURCE', inputs: semantics.inputs,
    inputTruthClass: method.authority === 'PRODUCTION_LOCKED' ? 'BROKER_OBSERVED_OR_DERIVED_REAL' : 'MODELED_RESEARCH_OR_MARKET_OBSERVED',
    normalization: semantics.normalization, units: semantics.units,
    timestampSemantics: 'PIT evidence must be available no later than decisionAt',
    freshnessRule: method.family === 'LEARNING' ? 'dataset window and label-availability governed' : 'cycle or lifecycle decision-time governed',
    persistence: semantics.persistence, consumer: semantics.consumer,
    runtimeCaller: method.baseEvidence.runtimeReachable ? method.sourceEvidence.at(-1) ?? 'UNKNOWN_RUNTIME_CALLER' : 'NO_RUNTIME_CALLER_PROVEN',
    currentAuthority: method.authority, realityLevel: level,
    historicalRealData: method.baseEvidence.historicalRealData, currentWorkerRealData: method.baseEvidence.currentWorkerRealData,
    empiricalStatus: method.baseEvidence.empiricallyValidated ? 'VALIDATED' : method.empiricalBlocker?.includes('sample') ? 'INSUFFICIENT_SAMPLE' : 'EMPIRICALLY_UNPROVEN',
    paperAuthority: method.authority === 'PRODUCTION_LOCKED' ? 'LOCKED_PAPER_PATH' : 'NO', liveAuthority: 'NO',
    unknownFields: method.empiricalBlocker === null ? [] : [method.empiricalBlocker],
    failureBehavior: method.authority === 'PRODUCTION_LOCKED' ? 'fail closed with typed reason' : 'remain shadow/research only',
    replaySupport: method.family === 'EXECUTION' && method.methodId === 'BROKER_RECONCILIATION' ? 'broker facts are replayable after capture' : 'deterministic receipt or dataset replay where persisted',
    tests: [`tests/profitability-brain-reality.test.ts`, `tests/method-l7-realness-authority.test.ts`],
    currentBlocker: method.empiricalBlocker, nextAction: level === 'L6_RUNTIME_REACHABLE'
      ? 'collect exact current-worker real-data proof without changing authority' : method.empiricalBlocker ?? 'retain governed authority',
  };
});

const strategySourceFile: Readonly<Record<(typeof fiveStrategyRealityMatrix)[number]['branch'], string>> = {
  THETA_CONVENTIONAL: 'bots/theta/quant/models/theta_q_lattice.py',
  THETA_HOLD_STRIKE: 'src/theta/canonical-strategy-frontier.ts',
  THETA_DEFINED_RISK: 'src/theta/canonical-strategy-frontier.ts',
  THETA_RECOVERY: 'src/theta/production-paper-management-candidate-source.ts',
  THETA_CC: 'src/theta/production-paper-management-candidate-source.ts',
};

export const strategyInventory: readonly DeepSystemInventoryRow[] = fiveStrategyRealityMatrix.map((strategy) => ({
  id: strategy.branch, category: 'STRATEGY', canonicalPhase: 'PHASE_4',
  sourceFiles: [strategySourceFile[strategy.branch]],
  producer: strategy.candidateProducer, inputs: ['current decision state', 'eligible exact contracts', 'strategy policy'],
  inputTruthClass: strategy.authority === 'PRODUCTION_LOCKED' ? 'BROKER_OBSERVED_OR_DERIVED_REAL' : 'MARKET_OBSERVED_AND_MODELED_RESEARCH',
  normalization: 'canonical candidate frontier contract', units: 'contract, USD, days, ratios',
  timestampSemantics: 'candidate evidence observed and available no later than decisionAt', freshnessRule: 'branch and quote-policy governed',
  persistence: strategy.persistence, consumer: strategy.canonicalConsumer, runtimeCaller: strategy.candidateProducer,
  currentAuthority: strategy.authority, realityLevel: strategy.level, historicalRealData: false, currentWorkerRealData: false,
  empiricalStatus: 'EMPIRICALLY_UNPROVEN', paperAuthority: strategy.authority === 'PRODUCTION_LOCKED' ? 'LOCKED_PAPER_PATH' : 'NO',
  liveAuthority: 'NO', unknownFields: [strategy.currentLimitation], failureBehavior: 'typed inapplicability or branch-local rejection',
  replaySupport: strategy.outcomeLinkage, tests: ['tests/canonical-strategy-frontier.test.ts', 'tests/phase3-strategy-economics-formulas.test.ts'],
  currentBlocker: strategy.currentLimitation, nextAction: 'collect current-worker and resolved-outcome evidence without promotion',
}));

export const actionInventory: readonly DeepSystemInventoryRow[] = thetaStrategyAction.options.map((action) => {
  const owners = canonicalThetaStrategySources.filter((strategy) => strategy.allowedActions.includes(action)).map((strategy) => strategy.branch);
  const productionOwner = fiveStrategyRealityMatrix.some((strategy) => owners.includes(strategy.branch)
    && strategy.authority === 'PRODUCTION_LOCKED');
  return {
    id: action, category: 'ACTION', canonicalPhase: 'PHASE_4', sourceFiles: ['src/theta/strategy-package.ts'],
    producer: owners.join('|'), inputs: ['applicable lifecycle state', 'canonical candidate or WAIT evidence'],
    inputTruthClass: 'BROKER_OBSERVED_OR_DERIVED_REAL', normalization: 'canonical action enum', units: 'categorical',
    timestampSemantics: 'decision-time or management-decision-time', freshnessRule: 'action-specific evidence bundle',
    persistence: 'decision, plan or management receipt', consumer: 'plan assembly or lifecycle frontier',
    runtimeCaller: 'canonical-strategy-frontier or management-action-frontier',
    currentAuthority: productionOwner ? 'PRODUCTION_LOCKED' : 'RESEARCH_ONLY',
    realityLevel: 'L4_CANONICAL_INTEGRATED', historicalRealData: false, currentWorkerRealData: false,
    empiricalStatus: 'EMPIRICALLY_UNPROVEN', paperAuthority: productionOwner ? 'LOCKED_PAPER_PATH' : 'NO', liveAuthority: 'NO', unknownFields: [],
    failureBehavior: 'action stays unreachable when its lifecycle or safety evidence is unavailable', replaySupport: 'T0 or management replay',
    tests: ['tests/strategy-package.test.ts', 'tests/management-invariants.test.ts'], currentBlocker: 'current-worker action-specific proof pending',
    nextAction: 'prove reachability only in an applicable real lifecycle',
  };
});

export const featureInventory: readonly DeepSystemInventoryRow[] = featureFamilyAuthorityMatrix.map((feature) => ({
  id: feature.family, category: 'FEATURE', canonicalPhase: 'PHASE_2', sourceFiles: ['src/theta/phase2-market-intelligence-registry.ts'],
  producer: feature.producer, inputs: ['provider-qualified PIT evidence'],
  inputTruthClass: feature.producerState === 'PROVIDER_LIMITED' ? 'UNKNOWN_OR_PROVIDER_LIMITED' : 'MARKET_OBSERVED_OR_DERIVED_REAL',
  normalization: `feature-family normalization, role=${feature.role}`, units: feature.units,
  timestampSemantics: feature.timestampSemantics, freshnessRule: 'feature-family and consumer governed',
  persistence: 'FusionSnapshot, feature receipt or research archive', consumer: feature.consumer,
  runtimeCaller: feature.producerState === 'PRODUCTION' ? 'theta-shadow-cycle' : 'shadow/research adapter',
  currentAuthority: feature.producerState === 'PRODUCTION' ? 'PRODUCTION_LOCKED' : feature.producerState === 'SHADOW' ? 'SHADOW' : 'RESEARCH_ONLY',
  realityLevel: feature.producerState === 'PROVIDER_LIMITED' ? 'L1_TYPED_CONTRACT' : feature.producerState === 'PRODUCTION' ? 'L6_RUNTIME_REACHABLE' : 'L4_CANONICAL_INTEGRATED',
  historicalRealData: false, currentWorkerRealData: false, empiricalStatus: 'EMPIRICALLY_UNPROVEN',
  paperAuthority: feature.role === 'HARD_SAFETY' && feature.producerState === 'PRODUCTION' ? 'LOCKED_PAPER_PATH' : 'NO', liveAuthority: 'NO',
  unknownFields: feature.producerState === 'PROVIDER_LIMITED' ? [feature.unknownBehavior] : [], failureBehavior: feature.unknownBehavior,
  replaySupport: 'PIT feature receipt replay when persisted', tests: ['tests/phase2-market-intelligence-registry.test.ts'],
  currentBlocker: feature.producerState === 'PROVIDER_LIMITED' ? feature.unknownBehavior : 'current-worker observation pending',
  nextAction: feature.producerState === 'PROVIDER_LIMITED' ? 'retain typed provider limit, do not fabricate' : 'collect current-worker and outcome evidence',
}));

export const hardRuleInventory: readonly DeepSystemInventoryRow[] = thetaHardRule.options.map((rule) => ({
  id: rule, category: 'HARD_RULE', canonicalPhase: 'PHASE_5', sourceFiles: ['src/theta/strategy-package.ts'],
  producer: 'canonical strategy policy and evidence consumers', inputs: ['required safety evidence'], inputTruthClass: 'BROKER_OBSERVED_OR_DERIVED_REAL',
  normalization: 'boolean/typed safety state with exact reason', units: 'categorical', timestampSemantics: 'must be current at decision time',
  freshnessRule: 'hard safety policy', persistence: 'canonical frontier and decision receipt', consumer: 'canonical entry selection',
  runtimeCaller: 'canonical-strategy-frontier', currentAuthority: 'PRODUCTION_LOCKED', realityLevel: 'L6_RUNTIME_REACHABLE',
  historicalRealData: false, currentWorkerRealData: false, empiricalStatus: 'NOT_APPLICABLE', paperAuthority: 'LOCKED_PAPER_PATH',
  liveAuthority: 'NO', unknownFields: [], failureBehavior: 'UNKNOWN fails closed only for the affected required safety condition',
  replaySupport: 'T0 replay', tests: ['tests/phase5-authority-structure.test.ts'], currentBlocker: 'current-worker proof pending',
  nextAction: 'preserve hard safety and record exact binding reason',
}));

export const aegisFamilies = [
  'PER_TRADE', 'UNDERLYING', 'SECTOR', 'CORRELATION', 'PORTFOLIO', 'INVENTORY',
  'ASSIGNMENT', 'RECOVERY', 'LIQUIDITY', 'EXECUTION', 'PROVIDER', 'SYSTEM',
] as const;

export const aegisInventory: readonly DeepSystemInventoryRow[] = aegisFamilies.map((family) => ({
  id: family, category: 'AEGIS_FAMILY', canonicalPhase: 'PHASE_5', sourceFiles: ['bots/theta/quant/models/aegis.py'],
  producer: `AEGIS ${family} assessment`, inputs: ['candidate-bound risk evidence'], inputTruthClass: 'DERIVED_FROM_REAL_OR_EXPLICIT_UNKNOWN',
  normalization: 'independent family state, never a blended score', units: 'ALLOW_FULL through HARD_VETO',
  timestampSemantics: 'bound to snapshot, candidate, policy and assessment hash', freshnessRule: 'decision-cycle governed',
  persistence: 'candidate-bound AEGIS receipt', consumer: 'canonical sizing and selection', runtimeCaller: 'aegis-derivation',
  currentAuthority: 'PRODUCTION_LOCKED', realityLevel: 'L6_RUNTIME_REACHABLE', historicalRealData: false,
  currentWorkerRealData: false, empiricalStatus: 'EMPIRICALLY_UNPROVEN', paperAuthority: 'LOCKED_PAPER_PATH', liveAuthority: 'NO',
  unknownFields: family === 'SECTOR' ? ['authoritative sector mapping'] : [], failureBehavior: 'applicable UNKNOWN is restrictive and reason-coded',
  replaySupport: 'T0 replay', tests: ['bots/theta/tests/quant/test_aegis.py', 'bots/theta/tests/quant/test_aegis_monotonicity_property.py'],
  currentBlocker: family === 'SECTOR' ? 'PROVIDER_LIMITED when sector evidence is applicable' : 'current-worker candidate-bound proof pending',
  nextAction: 'collect candidate-bound evidence, never infer clearance from absence',
}));

export const brainLayerInventory: readonly DeepSystemInventoryRow[] = canonicalBrainLayers.map((layer, index) => ({
  id: layer, category: 'BRAIN_LAYER', canonicalPhase: `PHASE_${Math.min(7, Math.max(1, Math.ceil((index + 1) / 3)))}` as `PHASE_${number}`,
  sourceFiles: ['src/theta/canonical-system-truth.ts'], producer: 'canonical capability graph', inputs: ['upstream layer receipt'],
  inputTruthClass: 'MIXED_WITH_EXPLICIT_PROVENANCE', normalization: 'immutable layer receipt', units: 'typed evidence',
  timestampSemantics: 'inherits source observation and availability times', freshnessRule: 'consumer governed', persistence: 'cycle or research receipt',
  consumer: index === canonicalBrainLayers.length - 1 ? 'governed policy registry' : canonicalBrainLayers[index + 1] ?? 'NONE',
  runtimeCaller: index <= 17 ? 'canonical runtime/replay path' : 'research pipeline', currentAuthority: index <= 17 ? 'PRODUCTION_LOCKED' : 'RESEARCH_ONLY',
  realityLevel: index <= 17 ? 'L4_CANONICAL_INTEGRATED' : 'L3_DETERMINISTIC_TESTED', historicalRealData: false,
  currentWorkerRealData: false, empiricalStatus: index >= 18 ? 'EMPIRICALLY_UNPROVEN' : 'NOT_APPLICABLE',
  paperAuthority: index <= 17 ? 'LOCKED_PAPER_PATH' : 'NO', liveAuthority: 'NO', unknownFields: [],
  failureBehavior: 'cannot silently invent missing upstream evidence', replaySupport: 'layer-specific deterministic receipt',
  tests: ['tests/canonical-system-truth.test.ts'], currentBlocker: 'deep current-worker or empirical evidence remains separate',
  nextAction: 'preserve layer ownership and prove reached state independently',
}));

export const profitPolicyInventory: readonly DeepSystemInventoryRow[] = v7ProfitTakingPolicyDefinitions.map((policy) => ({
  id: policy.policy, category: 'PROFIT_POLICY', canonicalPhase: 'PHASE_4', sourceFiles: ['src/research/profit-taking-experiment.ts'],
  producer: 'profit-taking challenger replay', inputs: policy.requiredEvidence, inputTruthClass: 'MARKET_OBSERVED_OR_MODELED_RESEARCH',
  normalization: policy.family, units: policy.captureFraction === null ? 'policy-specific' : 'fraction of opening credit',
  timestampSemantics: 'decision evidence at each replay checkpoint', freshnessRule: 'episode/replay governed',
  persistence: 'challenger comparison rows', consumer: 'R8 management-policy evaluation', runtimeCaller: 'profit-taking-challenger-runner',
  currentAuthority: 'RESEARCH_ONLY', realityLevel: 'L4_CANONICAL_INTEGRATED', historicalRealData: false, currentWorkerRealData: false,
  empiricalStatus: 'INSUFFICIENT_SAMPLE', paperAuthority: 'NO', liveAuthority: 'NO', unknownFields: ['resolved independent managed episodes'],
  failureBehavior: 'censor unidentifiable counterfactual, never declare winner', replaySupport: 'deterministic episode replay',
  tests: ['tests/profit-taking-challenger-runner.test.ts', 'tests/defined-risk-management-replay.test.ts'],
  currentBlocker: 'no sufficient resolved managed episodes', nextAction: 'run identical-policy comparison after future outcomes resolve',
}));

export type ClaudeWorkPackageState = 'COMPLETE_SOURCE' | 'RECONCILED_EXISTING' | 'BLOCKED_DATA' | 'EMPIRICAL_INSUFFICIENT_SAMPLE';
const wpReconciled = new Set([29, 30, 31, 33, 34, 41, 42, 43, 44, 45, 46, 47, 51, 53, 55, 58, 60, 61, 62, 79, 80]);
const wpBlockedData = new Set([13, 17, 26]);
const wpInsufficient = new Set([25, 37, 87]);
export const claudeWorkPackageState = (wp: number): ClaudeWorkPackageState => wpReconciled.has(wp) ? 'RECONCILED_EXISTING'
  : wpBlockedData.has(wp) ? 'BLOCKED_DATA' : wpInsufficient.has(wp) ? 'EMPIRICAL_INSUFFICIENT_SAMPLE' : 'COMPLETE_SOURCE';

const wpRepresentativeFile = (wp: number): string => {
  const featureFiles = [
    'feature_contract', 'trend', 'realized_volatility', 'iv', 'skew', 'term_structure', 'volatility_surface',
    'volume_open_interest', 'flow', 'unusual_activity', 'liquidity', 'event_context', 'sector', 'correlation',
    'portfolio_exposure', 'drawdown_recovery', 'fundamental_quality', 'regime_adapter', 'execution_quality_adapter',
    'feature_bundle', 'feature_definitions_registry', 'router_research_adapter', 'strictness_funnel',
  ];
  if (wp >= 1 && wp <= 23) return `bots/theta/quant/features/${featureFiles[wp - 1]}.py`;
  const direct: Readonly<Record<number, string>> = {
    24: 'bots/theta/quant/research/historical_episode_loader.py', 25: 'bots/theta/quant/features/strictness_funnel.py',
    26: 'bots/theta/quant/research/entry_feature_ablation.py', 27: 'bots/theta/quant/research/immutable_quant_snapshot.py',
    28: 'bots/theta/quant/research/t0_bundle_adapter.py', 32: 'bots/theta/quant/models/defined_risk_economics.py',
    35: 'bots/theta/quant/research/wait_outcome.py', 36: 'bots/theta/quant/models/cost_slippage_baseline.py',
    37: 'bots/theta/quant/models/fill_probability_baseline.py', 38: 'bots/theta/quant/research/after_cost_ev_identifiability.py',
    39: 'bots/theta/quant/research/empirical_estimators.py', 40: 'bots/theta/quant/research/assignment_labels.py',
    48: 'bots/theta/quant/research/management_dataset.py', 49: 'bots/theta/quant/research/regime_dataset.py',
    50: 'bots/theta/quant/research/fill_dataset.py', 52: 'bots/theta/quant/research/oos_manifest.py',
    54: 'bots/theta/quant/research/tree_baseline.py', 56: 'bots/theta/quant/research/cohort_calibration.py',
    57: 'bots/theta/quant/research/model_registry.py', 59: 'bots/theta/quant/research/benchmark_runner.py',
    63: 'bots/theta/quant/research/multiple_testing_ledger.py', 64: 'bots/theta/quant/research/failure_attribution.py',
    65: 'bots/theta/quant/research/experience_memory.py', 66: 'bots/theta/quant/research/reproducibility_bundle.py',
    67: 'bots/theta/quant/research/future_capture_contract.py', 68: 'bots/theta/quant/research/horizon_adapters.py',
    69: 'bots/theta/quant/research/expiration_outcome.py', 70: 'bots/theta/quant/research/management_checkpoint_outcomes.py',
    71: 'bots/theta/quant/research/truth_firewall.py', 72: 'bots/theta/quant/research/source_data_validation.py',
    73: 'bots/theta/quant/research/missingness_engine.py', 74: 'bots/theta/quant/research/historical_coverage_report.py',
    75: 'bots/theta/quant/research/strictness_economics_join.py', 76: 'bots/theta/quant/research/q_blocked_d_available_cohort.py',
    77: 'bots/theta/quant/research/wait_analysis.py', 78: 'bots/theta/quant/research/management_accounting_fixtures.py',
    82: 'bots/theta/quant/research/pit_leakage_harness.py', 83: 'bots/theta/quant/research/research_cli.py',
    84: 'bots/theta/quant/research/historical_export_dedupe.py', 85: 'bots/theta/quant/research/storage_classification.py',
    86: 'bots/theta/quant/research/codex_handoff_pack.py', 88: 'bots/theta/quant/research/shadow_prediction_receipt.py',
    89: 'bots/theta/quant/research/promotion_evidence_assembler.py', 90: 'bots/theta/quant/research/drift_detection.py',
    91: 'bots/theta/quant/research/paper_analysis_readiness.py', 92: 'bots/theta/quant/research/paper_model_discrepancy.py',
    93: 'bots/theta/quant/research/graduation_metric_engine.py', 94: 'bots/theta/quant/research/release_evidence_matrix.py',
    95: 'bots/theta/tests/quant/test_cross_module_e2e.py', 96: 'bots/theta/tests/quant/test_adversarial_matrix.py',
  };
  if (direct[wp]) return direct[wp];
  if (wp >= 29 && wp <= 34) return 'bots/theta/quant/models/theta_q_baseline.py';
  if (wp >= 41 && wp <= 47) return 'bots/theta/quant/research/whole_chain_dataset.py';
  if (wp === 51 || wp === 53 || wp === 55) return 'bots/theta/quant/research/validation.py';
  if (wp === 58 || (wp >= 60 && wp <= 62)) return 'bots/theta/quant/research/experiment_registry.py';
  if (wp === 79) return 'bots/theta/quant/models/aegis.py';
  if (wp === 80) return 'bots/theta/quant/models/sizing.py';
  if (wp === 81) return 'bots/theta/tests/quant/test_economic_monotonicity_property.py';
  if (wp === 87) return 'docs/operations/THETA_CODEX_UNIFIED_PHASE_LEDGER.md';
  return 'docs/operations/THETA_CODEX_UNIFIED_PHASE_LEDGER.md';
};

export const claudeWorkPackageInventory: readonly DeepSystemInventoryRow[] = Array.from({ length: 100 }, (_, index) => {
  const wp = index + 1;
  const state = claudeWorkPackageState(wp);
  const sourceFile = wpRepresentativeFile(wp);
  return {
    id: `WP${String(wp).padStart(2, '0')}`, category: 'CLAUDE_WORK_PACKAGE', canonicalPhase: wp <= 23 ? 'PHASE_2' : 'PHASE_6',
    sourceFiles: [sourceFile], producer: sourceFile, inputs: ['work-package-specific PIT or research evidence'],
    inputTruthClass: 'MARKET_OBSERVED_OR_MODELED_RESEARCH_WITH_FIREWALL', normalization: 'work-package-specific typed contract',
    units: 'work-package-specific', timestampSemantics: 'PIT and label-availability rules apply', freshnessRule: 'dataset or source governed',
    persistence: 'research receipt, dataset or source-only registry', consumer: 'research pipeline or Codex runtime handoff',
    runtimeCaller: state === 'RECONCILED_EXISTING' ? 'existing canonical implementation' : 'research CLI/test path',
    currentAuthority: 'RESEARCH_ONLY', realityLevel: state === 'BLOCKED_DATA' ? 'L1_TYPED_CONTRACT' : 'L3_DETERMINISTIC_TESTED',
    historicalRealData: wp === 24 || wp === 25 || wp === 67 || wp === 74 || wp === 84 || wp === 87,
    currentWorkerRealData: false, empiricalStatus: state === 'EMPIRICAL_INSUFFICIENT_SAMPLE' || state === 'BLOCKED_DATA'
      ? 'INSUFFICIENT_SAMPLE' : 'EMPIRICALLY_UNPROVEN', paperAuthority: 'NO', liveAuthority: 'NO',
    unknownFields: state === 'BLOCKED_DATA' ? ['required authorized source or resolved label'] : [],
    failureBehavior: 'research-only, cannot grant execution or promotion authority', replaySupport: 'deterministic test or research receipt',
    tests: [`bots/theta/tests/quant`], currentBlocker: state === 'BLOCKED_DATA' ? 'required data/provider absent'
      : state === 'EMPIRICAL_INSUFFICIENT_SAMPLE' ? 'insufficient independent resolved outcomes' : null,
    nextAction: state === 'COMPLETE_SOURCE' || state === 'RECONCILED_EXISTING' ? 'retain source truth and await real evidence where required'
      : 'collect the named missing evidence without fabrication',
  };
});

const command5aComponents = [
  ['SCHEDULER', 'src/research/command5a-local-scheduling.ts'],
  ['OBSERVATION_SOURCE', 'src/research/alpaca-command5a-observation-source.ts'],
  ['OBSERVATION_WORKER', 'src/research/command5a-local-observation-worker.ts'],
  ['MARK_SEMANTICS', 'src/research/command5a-mark-semantics.ts'],
  ['CANONICAL_ADAPTER', 'src/research/command5a-canonical-adapter.ts'],
  ['MATURATION', 'src/research/command5a-local-maturation.ts'],
  ['LOCAL_JOB_STORE', 'src/storage/local-observation-job-scheduler.ts'],
  ['LOCAL_HISTORY_SPOOL', 'src/storage/local-research-history-spool.ts'],
  ['ARCHIVE_HEALTH', 'src/storage/local-research-archive-health.ts'],
  ['WINDOWS_OWNER', 'tools/windows/theta-local-worker.ps1'],
] as const;

export const command5aInventory: readonly DeepSystemInventoryRow[] = command5aComponents.map(([id, sourceFile]) => ({
  id: `COMMAND5A_${id}`, category: 'COMMAND5A_COMPONENT', canonicalPhase: 'PHASE_6', sourceFiles: [sourceFile],
  producer: sourceFile, inputs: ['persisted subjects, calendar and physically GET-only provider evidence'],
  inputTruthClass: 'MARKET_OBSERVED_OR_CENSORED', normalization: 'typed local observation job/receipt', units: 'contract path and timestamps',
  timestampSemantics: 'scheduledAt, observedAt, availableAt and maturedAt stay distinct', freshnessRule: 'horizon and market-calendar governed',
  persistence: 'SQLite WAL, local archive and Parquet research tier', consumer: 'future outcome and management research',
  runtimeCaller: 'theta-command5a-runtime and locked Windows supervisor', currentAuthority: 'RESEARCH_ONLY',
  realityLevel: 'L6_RUNTIME_REACHABLE', historicalRealData: false, currentWorkerRealData: false, empiricalStatus: 'EMPIRICALLY_UNPROVEN',
  paperAuthority: 'NO', liveAuthority: 'NO', unknownFields: ['first integrated current-worker observation'],
  failureBehavior: 'typed noncritical deferral, never strategy WAIT', replaySupport: 'local archive and maturation replay',
  tests: ['tests/command5a-local-scheduling.test.ts', 'tests/command5a-local-observation-worker.test.ts'],
  currentBlocker: 'latest integration release is not deployed', nextAction: 'deploy only after controlled impact review, then observe without broker authority',
}));

export const providerInventory: readonly DeepSystemInventoryRow[] = providerCapabilityAuthorityMatrix.map((capability) => ({
  id: `${capability.provider}_${capability.logicalCapability}`, category: 'PROVIDER_CAPABILITY', canonicalPhase: 'PHASE_2',
  sourceFiles: ['src/theta/phase2-market-intelligence-registry.ts'], producer: capability.endpoint,
  inputs: [capability.requestSchema], inputTruthClass: capability.provider === 'ALPACA' ? 'BROKER_OR_MARKET_OBSERVED' : 'PROVIDER_ANALYTICS_CONTEXT',
  normalization: capability.responseSchema, units: capability.units, timestampSemantics: `${capability.timestamp}; retrieved=${capability.retrievedAt}`,
  freshnessRule: capability.freshness, persistence: capability.persistence, consumer: capability.consumer, runtimeCaller: capability.runtimeCaller,
  currentAuthority: capability.pricingSuitability === 'MASTER_PAPER_EXECUTABLE_REFERENCE' ? 'PRODUCTION_LOCKED'
    : capability.state === 'WIRED_PRODUCTION' ? 'OPERATIONAL' : 'RESEARCH_ONLY',
  realityLevel: capability.state === 'PROVIDER_LIMITED' ? 'L4_CANONICAL_INTEGRATED' : 'L6_RUNTIME_REACHABLE',
  historicalRealData: false, currentWorkerRealData: false, empiricalStatus: 'NOT_APPLICABLE',
  paperAuthority: capability.pricingSuitability === 'MASTER_PAPER_EXECUTABLE_REFERENCE' ? 'LOCKED_PAPER_PATH' : 'NO', liveAuthority: 'NO',
  unknownFields: capability.state === 'PROVIDER_LIMITED' ? [capability.entitlement] : [], failureBehavior: capability.fallback,
  replaySupport: 'provider receipt replay after persistence', tests: ['tests/phase2-market-intelligence-registry.test.ts'],
  currentBlocker: capability.state === 'PROVIDER_LIMITED' ? capability.entitlement : 'current-worker capability observation pending',
  nextAction: 'probe only the explicitly requested entitlement/feed and preserve typed failure',
}));

const infrastructureDefinitions = [
  ['POSTGRES_OPERATIONAL_TRUTH', 'src/theta/postgres-theta-cycle-store.ts', 'PostgreSQL', 'canonical trading state and audit receipts', 'PRODUCTION_LOCKED'],
  ['SQLITE_OUTAGE_SPOOL', 'src/storage/local-research-history-spool.ts', 'SQLite WAL', 'bounded outage and research spool', 'OPERATIONAL'],
  ['PARQUET_RESEARCH_ARCHIVE', 'tools/compact-local-research-spool.py', 'ZSTD Parquet', 'large immutable research history', 'RESEARCH_ONLY'],
  ['DUCKDB_RESEARCH_READBACK', 'tools/certify-cycle-archive-research-export.ts', 'DuckDB', 'analytical archive verification', 'RESEARCH_ONLY'],
  ['CONTENT_ADDRESSED_FRONTIER_ARCHIVE', 'src/storage/canonical-frontier-local-archive.ts', 'SHA256 archive', 'full canonical frontier evidence', 'OPERATIONAL'],
  ['POSTGRES_RECOVERY_BACKUP', 'tools/database-verify.mjs', 'pg_dump custom archive', 'database recovery evidence', 'OPERATIONAL'],
  ['WINDOWS_RESIDENT_SUPERVISOR', 'tools/windows/theta-local-worker.ps1', 'PowerShell process owner', 'single locked runtime owner', 'OPERATIONAL'],
  ['NODE_RESIDENT_WORKER', 'src/worker/resident-worker.ts', 'Node runtime', 'locked worker execution loop', 'PRODUCTION_LOCKED'],
  ['VERCEL_DECISION_RUNTIME', 'src/theta/autonomous-runtime-handler.ts', 'HTTP runtime', 'canonical cycle orchestration', 'PRODUCTION_LOCKED'],
  ['WORKER_LEASE_STORE', 'src/worker/postgres-worker-runtime-store.ts', 'PostgreSQL lease', 'single-owner enforcement and heartbeat', 'PRODUCTION_LOCKED'],
  ['COMMAND5A_SCHEDULER', 'src/research/command5a-local-scheduling.ts', 'local scheduler', 'future observation scheduling', 'RESEARCH_ONLY'],
  ['CANONICAL_JOB_SCHEDULER', 'src/theta/scheduler-engine.ts', 'typed job state machine', 'runtime job dispatch', 'PRODUCTION_LOCKED'],
  ['MASTER_BROKER_MUTATION_OWNER', 'src/execution/paper-order-coordinator.ts', 'PaperOrderCoordinator', 'idempotent broker mutation authority', 'PRODUCTION_LOCKED'],
  ['BROKER_RECONCILIATION_WORKER', 'src/execution/broker-reconciliation-worker.ts', 'Alpaca reconciliation', 'broker truth and local-state parity', 'PRODUCTION_LOCKED'],
  ['EMPIRICAL_MODEL_REGISTRY', 'src/research/empirical-model-registry.ts', 'versioned model metadata', 'research promotion governance', 'RESEARCH_ONLY'],
  ['RESEARCH_DATASET_BUILDER', 'tools/theta-research-dataset-cli.ts', 'PIT dataset runner', 'whole-chain and WAIT datasets', 'RESEARCH_ONLY'],
  ['RISK_POLICY_REGISTRY', 'src/theta/risk-policy-registry.ts', 'versioned policy metadata', 'risk-policy authority and gaps', 'PRODUCTION_LOCKED'],
  ['STORAGE_AUTHORITY_REGISTRY', 'src/storage/storage-authority-registry.ts', 'versioned storage policy', 'bounded placement and retention', 'OPERATIONAL'],
  ['PAPER_CANARY_GOVERNANCE', 'src/theta/paper-live-graduation-governance.ts', 'one order and one contract', 'owner-gated first Paper canary', 'PRODUCTION_LOCKED'],
  ['LIVE_GRADUATION_GOVERNANCE', 'src/theta/paper-live-graduation-governance.ts', 'empirical release criteria', 'owner-reviewed live graduation only', 'RESEARCH_ONLY'],
] as const;

export const infrastructureInventory: readonly DeepSystemInventoryRow[] = infrastructureDefinitions.map((definition) => {
  const [id, sourceFile, units, consumer, authority] = definition;
  return {
    id, category: 'INFRASTRUCTURE', canonicalPhase: id.includes('LIVE_GRADUATION') ? 'PHASE_9'
      : id.includes('PAPER_CANARY') ? 'PHASE_8'
        : id.includes('MODEL') || id.includes('DATASET') || id.includes('COMMAND5A') ? 'PHASE_6' : 'PHASE_1',
    sourceFiles: [sourceFile], producer: sourceFile,
    inputs: ['typed operational or research evidence'], inputTruthClass: 'OPERATIONAL_STATE_WITH_EXPLICIT_PROVENANCE',
    normalization: 'versioned bounded contract', units, timestampSemantics: 'observed, available, persisted and verified times remain distinct',
    freshnessRule: 'component-specific health or retention policy', persistence: consumer, consumer,
    runtimeCaller: sourceFile, currentAuthority: authority, realityLevel: authority === 'RESEARCH_ONLY'
      ? 'L4_CANONICAL_INTEGRATED' : 'L6_RUNTIME_REACHABLE', historicalRealData: false, currentWorkerRealData: false,
    empiricalStatus: authority === 'RESEARCH_ONLY' ? 'EMPIRICALLY_UNPROVEN' : 'NOT_APPLICABLE',
    paperAuthority: authority === 'PRODUCTION_LOCKED' ? 'LOCKED_PAPER_PATH' : 'NO', liveAuthority: 'NO', unknownFields: [],
    failureBehavior: 'typed failure or degraded state, never an empty opportunity or strategy WAIT', replaySupport: 'component receipt or recovery replay',
    tests: ['tests/storage-authority-registry.test.ts', 'tests/worker-runtime-store.test.ts'],
    currentBlocker: id === 'PAPER_CANARY_GOVERNANCE' ? 'Master Paper permission is granted; current-session technical activation and an eligible quantity-positive decision are still required'
      : id === 'LIVE_GRADUATION_GOVERNANCE' ? 'empirical thresholds, Paper outcomes and live owner permission are absent'
        : authority === 'RESEARCH_ONLY' ? 'empirical or current-worker evidence pending' : 'current integration release is not deployed',
    nextAction: 'preserve authority boundary and collect the next required runtime receipt',
  };
});

export function databaseRelationInventoryFromNames(qualifiedNames: readonly string[]): readonly DeepSystemInventoryRow[] {
  return [...new Set(qualifiedNames)].sort().map((qualifiedName) => {
    const separator = qualifiedName.indexOf('.');
    const schema = separator < 0 ? 'public' : qualifiedName.slice(0, separator);
    const relation = separator < 0 ? qualifiedName : qualifiedName.slice(separator + 1);
    const classification = classifyPostgresRelation(schema, relation);
    const authority = authorityForClassification(classification.classification);
    const productionAuthority = classification.classification === 'CANONICAL_TRADING_STATE'
      || classification.classification === 'CANONICAL_AUDIT';
    return {
      id: qualifiedName, category: 'INFRASTRUCTURE' as const, canonicalPhase: 'PHASE_1' as const,
      sourceFiles: ['migrations'], producer: 'migration ledger and canonical relation writer',
      inputs: ['relation-specific normalized records'], inputTruthClass: classification.classification,
      normalization: classification.rationale, units: 'PostgreSQL relation rows', timestampSemantics: 'relation-specific PIT or audit time',
      freshnessRule: authority?.retentionClass ?? 'UNKNOWN_REQUIRES_REVIEW', persistence: authority?.canonicalHome ?? 'UNCLASSIFIED',
      consumer: authority?.family ?? 'NO_GOVERNED_CONSUMER', runtimeCaller: 'relation-specific repository',
      currentAuthority: productionAuthority ? 'PRODUCTION_LOCKED' as const : authority === null ? 'NONE' as const : 'OPERATIONAL' as const,
      realityLevel: 'L5_PERSISTED' as const, historicalRealData: false, currentWorkerRealData: false,
      empiricalStatus: 'NOT_APPLICABLE' as const, paperAuthority: productionAuthority ? 'LOCKED_PAPER_PATH' as const : 'NO' as const,
      liveAuthority: 'NO' as const, unknownFields: classification.classification === 'UNKNOWN_REQUIRES_REVIEW'
        ? ['storage classification and governed consumer'] : [],
      failureBehavior: classification.classification === 'UNKNOWN_REQUIRES_REVIEW'
        ? 'blocks storage certification until classified' : 'preserve typed database error and canonical evidence',
      replaySupport: authority?.archiveHome ?? 'relation-specific backup/restore', tests: ['tests/storage-authority-registry.test.ts'],
      currentBlocker: classification.classification === 'UNKNOWN_REQUIRES_REVIEW' ? 'storage classification missing' : null,
      nextAction: classification.classification === 'UNKNOWN_REQUIRES_REVIEW' ? 'add explicit storage authority' : 'retain governed storage placement',
    };
  });
}

export const deepSystemInventory: readonly DeepSystemInventoryRow[] = [
  ...methodInventory, ...strategyInventory, ...actionInventory, ...featureInventory, ...hardRuleInventory,
  ...aegisInventory, ...brainLayerInventory, ...profitPolicyInventory, ...claudeWorkPackageInventory,
  ...command5aInventory, ...providerInventory, ...infrastructureInventory,
];

export function validateDeepSystemInventory(rows: readonly DeepSystemInventoryRow[] = deepSystemInventory): readonly string[] {
  const issues: string[] = [];
  const keys = new Set<string>();
  for (const row of rows) {
    const key = `${row.category}:${row.id}`;
    if (keys.has(key)) issues.push(`DUPLICATE:${key}`);
    keys.add(key);
    if (row.sourceFiles.length === 0 || row.inputs.length === 0 || row.tests.length === 0) issues.push(`INCOMPLETE:${key}`);
    for (const [field, value] of Object.entries(row)) {
      if (typeof value === 'string' && value.trim() === '') issues.push(`BLANK:${key}:${field}`);
    }
    if (row.currentWorkerRealData && row.realityLevel !== 'L7_CURRENT_WORKER_REAL_DATA'
      && row.realityLevel !== 'L8_EMPIRICALLY_VALIDATED' && row.realityLevel !== 'L9_BROKER_AUTHORIZED') {
      issues.push(`REALITY_CONTRADICTION:${key}`);
    }
    if (row.paperAuthority === 'NO' && row.realityLevel === 'L9_BROKER_AUTHORIZED') issues.push(`AUTHORITY_CONTRADICTION:${key}`);
  }
  const expectedCounts: Readonly<Record<string, number>> = {
    METHOD: 32, STRATEGY: 5, ACTION: 17, FEATURE: 20, HARD_RULE: 11, AEGIS_FAMILY: 12,
    BRAIN_LAYER: 21, PROFIT_POLICY: canonicalV7ProfitTakingPolicies.length, CLAUDE_WORK_PACKAGE: 100,
    INFRASTRUCTURE: infrastructureDefinitions.length,
  };
  for (const [category, count] of Object.entries(expectedCounts)) {
    const actual = rows.filter((row) => row.category === category).length;
    if (actual !== count) issues.push(`CARDINALITY:${category}:${actual}:${count}`);
  }
  return issues;
}

export function summarizeDeepSystemInventory(rows: readonly DeepSystemInventoryRow[] = deepSystemInventory) {
  const byCategory = Object.fromEntries([...new Set(rows.map((row) => row.category))].sort().map((category) => [
    category, rows.filter((row) => row.category === category).length,
  ]));
  const byLevel = Object.fromEntries([
    'L0_ABSENT', 'L1_TYPED_CONTRACT', 'L2_SOURCE_IMPLEMENTED', 'L3_DETERMINISTIC_TESTED',
    'L4_CANONICAL_INTEGRATED', 'L5_PERSISTED', 'L6_RUNTIME_REACHABLE', 'L7_CURRENT_WORKER_REAL_DATA',
    'L8_EMPIRICALLY_VALIDATED', 'L9_BROKER_AUTHORIZED',
  ].map((level) => [level, rows.filter((row) => row.realityLevel === level).length]));
  return {
    schemaVersion: deepSystemInventoryVersion,
    inventoryCoverage: validateDeepSystemInventory(rows).length === 0 ? 'COMPLETE' as const : 'INVALID' as const,
    inventoryCoverageMeaning: 'ROW_CARDINALITY_SCHEMA_AUTHORITY_AND_SOURCE_REFERENCE_VALIDATION_ONLY' as const,
    rowCount: rows.length, byCategory, byLevel,
    currentWorkerRealRows: rows.filter((row) => row.currentWorkerRealData).length,
    empiricallyValidatedRows: rows.filter((row) => row.empiricalStatus === 'VALIDATED').length,
    lockedPaperPathRows: rows.filter((row) => row.paperAuthority === 'LOCKED_PAPER_PATH').length,
    ownerPermissionRequiredRows: rows.filter((row) => row.paperAuthority === 'OWNER_PERMISSION_REQUIRED').length,
    liveAuthorizedRows: 0,
    issues: validateDeepSystemInventory(rows),
  };
}
