import { createHash } from 'node:crypto';
import { auditPresessionConfiguration } from '../theta/paper-bootstrap-runtime-policy.js';
import { decisionDataRoutes, softFeatureUsageRegistry, unresolvedSystemState } from './v18-final-acceptance.js';
import { v19ScenarioEvidence } from './v19-evidence-certification.js';

export const v20EvidenceClosureVersion = 'theta-v20-evidence-closure-v1' as const;

export interface ExecutedNamedTest {
  readonly testFile: string;
  readonly testId: string;
  readonly exists: boolean;
  readonly executed: boolean;
  readonly passed: boolean;
  readonly skipped: boolean;
}

export interface EvidenceProbeSpec {
  readonly id: string;
  readonly sourceFile: string;
  readonly testFile: string;
  readonly testId: string;
}

const probe = (id: string, sourceFile: string, testFile: string, testId: string): EvidenceProbeSpec =>
  ({ id, sourceFile, testFile, testId });

export const realDataRouteProbeSpecs: readonly EvidenceProbeSpec[] = Object.freeze([
  probe('IV', 'src/theta/option-chain-ingestion.ts', 'tests/option-chain-ingestion.test.ts', 'full Alpaca snapshot (bid/ask/Greeks/volume) uses Alpaca for every feature'),
  probe('RV', 'src/research/volatility-risk-premium.ts', 'tests/volatility-risk-premium.test.ts', 'defaults to the rv21 horizon and names its source explicitly'),
  probe('IV-RV', 'src/research/volatility-risk-premium.ts', 'tests/volatility-risk-premium.test.ts', 'computes IV-RV, ratio, and variance-space VRP'),
  probe('skew', 'src/theta/optionomics-feature-engine.ts', 'tests/optionomics-feature-engine.test.ts', 'builds layered contract features and contract-multiplier-safe structural economics'),
  probe('term', 'src/theta/optionomics-feature-engine.ts', 'tests/strategy-quality-shadow-diagnostics.test.ts', 'DTE-edge and capital-day challengers remain observational'),
  probe('trend', 'src/theta/regime-contract.ts', 'tests/regime-contract.test.ts', 'never collapses the five axes into one field'),
  probe('momentum', 'src/theta/optionomics-provider.ts', 'tests/optionomics-provider.test.ts', 'GEX zero sentinel and documented legacy-null metric stay unknown for different reasons'),
  probe('flow', 'src/theta/optionomics-provider.ts', 'tests/optionomics-provider.test.ts', 'net-flow evidence uses documented 8h/24h/48h window parameters'),
  probe('GEX', 'src/theta/optionomics-provider.ts', 'tests/optionomics-provider.test.ts', 'GEX zero sentinel and documented legacy-null metric stay unknown for different reasons'),
  probe('vanna', 'src/theta/optionomics-feature-engine.ts', 'tests/optionomics-feature-engine.test.ts', 'routes documented Vanna and Charm grids separately'),
  probe('charm', 'src/theta/optionomics-feature-engine.ts', 'tests/optionomics-feature-engine.test.ts', 'routes documented Vanna and Charm grids separately'),
  probe('events', 'src/theta/normalized-event-evidence.ts', 'tests/normalized-event-evidence.test.ts', 'normalizes a PIT-valid provider event'),
  probe('liquidity', 'src/theta/aegis-derivation.ts', 'tests/aegis-derivation.test.ts', 'deriveLiquidityAcceptable is true when at least one candidate'),
  probe('delta', 'src/theta/option-chain-ingestion.ts', 'tests/option-chain-ingestion.test.ts', 'full Alpaca snapshot (bid/ask/Greeks/volume) uses Alpaca for every feature'),
  probe('moneyness', 'src/theta/option-chain-ingestion.ts', 'tests/option-chain-ingestion.test.ts', 'fresh IEX trade supplies moneyness'),
  probe('spread', 'src/theta/aegis-spread-stress.ts', 'tests/aegis-spread-stress.test.ts', 'mature same-cohort Alpaca history produces a real spread-widening boolean'),
  probe('OI', 'src/theta/option-chain-ingestion.ts', 'tests/option-chain-ingestion.test.ts', 'full Alpaca snapshot (bid/ask/Greeks/volume) uses Alpaca for every feature'),
  probe('volume', 'src/theta/option-chain-ingestion.ts', 'tests/option-chain-ingestion.test.ts', 'full Alpaca snapshot (bid/ask/Greeks/volume) uses Alpaca for every feature'),
  probe('capital', 'src/theta/account-exposure.ts', 'tests/account-exposure.test.ts', 'first CSP risk includes the proposed trade'),
  probe('max loss', 'src/research/defined-risk-economics.ts', 'tests/defined-risk-economics.test.ts', 'positionNetCredit and positionMaxLoss scale correctly'),
  probe('correlation', 'src/theta/portfolio-correlation-evidence.ts', 'tests/portfolio-correlation-evidence.test.ts', 'synchronized completed daily bars produce weighted signed and maximum absolute correlation'),
]);

export const crossStrategyProbeSpecs: readonly EvidenceProbeSpec[] = Object.freeze([
  probe('Q_AND_D_FEASIBLE', 'src/theta/canonical-strategy-frontier.ts', 'tests/canonical-strategy-frontier.test.ts', 'defined-risk frontier prices both legs'),
  probe('Q_INFEASIBLE_D_FEASIBLE', 'src/theta/strategy-account-policy-compatibility.ts', 'tests/strategy-account-policy-compatibility.test.ts', 'defined-risk minimum capital can be account feasible'),
  probe('Q_FEASIBLE_D_INFEASIBLE', 'src/theta/canonical-strategy-frontier.ts', 'tests/canonical-strategy-frontier.test.ts', 'research branches remain visible but cannot win'),
  probe('Q_AND_D_INFEASIBLE', 'src/theta/canonical-strategy-frontier.ts', 'tests/canonical-strategy-frontier.test.ts', 'GLOBAL_WAIT is earned only after'),
  probe('H_RESEARCH_APPLICABLE', 'src/research/hold-strike-shadow-candidate-generator.ts', 'tests/hold-strike-shadow-candidate-generator.test.ts', 'accepts a real, structurally sound 2-5 DTE contract'),
  probe('ALL_POOR_WAIT', 'src/theta/canonical-strategy-frontier.ts', 'tests/canonical-strategy-frontier.test.ts', 'quantity zero is authoritative GLOBAL_WAIT'),
  probe('D_CAPITAL_LIQUIDITY_TRADEOFF', 'src/research/cross-strategy-common-horizon-contract.ts', 'tests/cross-strategy-common-horizon-contract.test.ts', 'genuine Pareto trade-off reports BOTH candidates'),
  probe('Q_CAPITAL_ECONOMICS_TRADEOFF', 'src/research/cross-strategy-common-horizon-contract.ts', 'tests/cross-strategy-common-horizon-contract.test.ts', 'full risk-adjusted economics for all candidates'),
  probe('EVENT_BLOCK', 'src/theta/master-paper-plan-assembly.ts', 'tests/master-paper-plan-assembly.test.ts', 'company-event and corporate-action policy failures'),
  probe('AEGIS_VETO', 'src/theta/canonical-strategy-frontier.ts', 'tests/canonical-strategy-frontier.test.ts', 'candidate-specific AEGIS veto cannot be bypassed'),
  probe('MIXED_REGIME_UNCERTAINTY', 'src/theta/regime-contract.ts', 'tests/regime-contract.test.ts', 'correctly computed partial-confidence snapshot'),
]);

const criticalDimensions = ['CANDIDATE_GENERATOR', 'ACCOUNT_FEASIBILITY', 'AEGIS', 'SIZING', 'LOCKED_PLAN',
  'PROFIT_MANAGEMENT', 'LOSS_MANAGEMENT', 'ROLL', 'EXPIRATION', 'ASSIGNMENT', 'RECOVERY',
  'WHOLE_CHAIN_ACCOUNTING', 'OUTCOME_RESOLVER'] as const;
const strategies = ['Q', 'H', 'D', 'A', 'C'] as const;
export const strategyCapabilityProbeIds = Object.freeze(strategies.flatMap((strategy) =>
  criticalDimensions.map((dimension) => `${strategy}_${dimension}`)));

export const strategyIdentityProbeSpecs: Readonly<Record<(typeof strategies)[number], EvidenceProbeSpec>> = Object.freeze({
  Q: probe('Q', 'src/theta/theta-q-contract.ts', 'tests/theta-q-contract.test.ts', 'accepts a THETA-Q result tied to the expected FusionSnapshot'),
  H: probe('H', 'src/research/hold-strike-shadow-candidate-generator.ts', 'tests/hold-strike-shadow-candidate-generator.test.ts', 'accepts a real, structurally sound 2-5 DTE contract'),
  D: probe('D', 'src/research/defined-risk-shadow-candidate-generator.ts', 'tests/defined-risk-shadow-candidate-generator.test.ts', 'accepts a real, structurally valid credit spread pair'),
  A: probe('A', 'src/theta/canonical-strategy-frontier.ts', 'tests/canonical-strategy-frontier.test.ts', 'recovery and covered-call frontiers require confirmed stock'),
  C: probe('C', 'src/theta/canonical-strategy-frontier.ts', 'tests/canonical-strategy-frontier.test.ts', 'recovery and covered-call frontiers require confirmed stock'),
});

export const criticalDimensionProbeSpecs: Readonly<Record<(typeof criticalDimensions)[number], EvidenceProbeSpec>> = Object.freeze({
  CANDIDATE_GENERATOR: probe('CANDIDATE_GENERATOR', 'src/theta/canonical-strategy-frontier.ts', 'tests/canonical-strategy-frontier.test.ts', 'evaluates all five canonical branches exactly once'),
  ACCOUNT_FEASIBILITY: probe('ACCOUNT_FEASIBILITY', 'src/theta/strategy-account-policy-compatibility.ts', 'tests/strategy-account-policy-compatibility.test.ts', 'missing account evidence remains unknown'),
  AEGIS: probe('AEGIS', 'src/theta/aegis-contract.ts', 'tests/aegis-contract.test.ts', 'newRiskState must equal the strictest family state'),
  SIZING: probe('SIZING', 'src/theta/sizing-contract.ts', 'tests/canonical-strategy-frontier.test.ts', 'candidate-specific real broker capacity is preserved'),
  LOCKED_PLAN: probe('LOCKED_PLAN', 'src/theta/master-paper-plan-assembly.ts', 'tests/master-paper-plan-assembly.test.ts', 'global WAIT creates no action plan'),
  PROFIT_MANAGEMENT: probe('PROFIT_MANAGEMENT', 'src/research/profit-taking-replay.ts', 'tests/profit-taking-replay.test.ts', 'all 17 registered challengers execute offline'),
  LOSS_MANAGEMENT: probe('LOSS_MANAGEMENT', 'src/research/loss-roll-experiment.ts', 'tests/loss-roll-experiment.test.ts', 'all required management alternatives are represented'),
  ROLL: probe('ROLL', 'src/theta/paper-bootstrap-management-policy.ts', 'tests/paper-bootstrap-management-policy.test.ts', 'positive-net-credit roll candidate rolls'),
  EXPIRATION: probe('EXPIRATION', 'src/theta/p2g-lifecycle-simulator.ts', 'tests/p2g-lifecycle-simulator.test.ts', 'closed-market lifecycle library covers close, expiry, assignment'),
  ASSIGNMENT: probe('ASSIGNMENT', 'src/theta/paper-bootstrap-management-policy.ts', 'tests/paper-bootstrap-management-policy.test.ts', 'broker-truth ACCEPT_ASSIGNMENT wins'),
  RECOVERY: probe('RECOVERY', 'src/theta/paper-bootstrap-management-policy.ts', 'tests/paper-bootstrap-management-policy.test.ts', 'RECOVERY_WAIT/SELL_STOCK/SELL_CC can EACH win rationally'),
  WHOLE_CHAIN_ACCOUNTING: probe('WHOLE_CHAIN_ACCOUNTING', 'src/theta/whole-chain-economics.ts', 'tests/whole-chain-economics.test.ts', 'computeWholeChainPnl sums every known leg'),
  OUTCOME_RESOLVER: probe('OUTCOME_RESOLVER', 'src/research/outcome-resolver.ts', 'tests/outcome-resolver.test.ts', 'whole-chain resolver includes option, stock, dividend, and fee economics'),
});

export const v18CoverageProbeSpecs: readonly EvidenceProbeSpec[] = Object.freeze([
  probe('CONFIG_CONFLICTS', 'src/theta/paper-bootstrap-runtime-policy.ts', 'tests/presession-configuration-registry.test.ts', 'pre-session configuration registry has one valid typed authority'),
  probe('CONFIG_DUPLICATE_AUTHORITIES', 'src/theta/paper-bootstrap-runtime-policy.ts', 'tests/presession-configuration-registry.test.ts', 'pre-session configuration registry has one valid typed authority'),
  probe('CONFIG_UNUSED_SETTINGS', 'src/theta/paper-bootstrap-runtime-policy.ts', 'tests/presession-configuration-registry.test.ts', 'candidate, finalist, and pre-submit stages consume the shared quote-age authority'),
  probe('DECLARED_BUT_UNUSED_DECISION_DATA', 'src/operations/v18-final-acceptance.ts', 'tests/v18-final-acceptance.test.ts', 'every decision data family has provenance, a consumer, a role, and explicit authority'),
  probe('DATA_WITHOUT_PROVENANCE', 'src/operations/v18-final-acceptance.ts', 'tests/v18-final-acceptance.test.ts', 'every decision data family has provenance, a consumer, a role, and explicit authority'),
  probe('DATA_WITHOUT_CONSUMER', 'src/operations/v18-final-acceptance.ts', 'tests/v18-final-acceptance.test.ts', 'every decision data family has provenance, a consumer, a role, and explicit authority'),
  probe('FILTER_ROLE_AUDIT', 'src/operations/v18-final-acceptance.ts', 'tests/v18-final-acceptance.test.ts', 'every decision data family has provenance, a consumer, a role, and explicit authority'),
  probe('FILTER_ABLATION_FRAMEWORK', 'bots/theta/quant/research/ablation.py', 'bots/theta/tests/quant/test_ablation.py', 'test_feature_taxonomy_matches_the_canonical_experiment_registry'),
  probe('THRESHOLD_SENSITIVITY_FRAMEWORK', 'src/research/risk-policy-empirical-study.ts', 'tests/risk-policy-empirical-study.test.ts', 'publication contract exposes all seven sensitivity cells'),
  probe('FALSE_REJECT_FRAMEWORK', 'src/research/wait-regret-dataset.ts', 'tests/wait-regret-dataset.test.ts', 'genuine HARD_SAFETY_REJECT never contributes to safetyRejectRate as regret'),
  probe('FALSE_ACCEPT_FRAMEWORK', 'src/research/wait-regret-dataset.ts', 'tests/wait-regret-dataset.test.ts', 'falseAcceptRate and conversion remain unavailable'),
  probe('REGIME_BRAIN', 'src/theta/regime-contract.ts', 'tests/regime-contract.test.ts', 'never collapses the five axes'),
  probe('COMMON_COMPARATOR', 'src/research/cross-strategy-common-horizon-contract.ts', 'tests/cross-strategy-common-horizon-contract.test.ts', 'Pareto set, never a single manufactured winner'),
  probe('WAIT_AS_COMPETITOR', 'src/research/wait-economic-contract.ts', 'tests/wait-economic-contract.test.ts', 'WAIT is now actually reachable'),
  probe('DECISION_EXPLAINABILITY', 'src/research/wait-regret-dataset.ts', 'tests/wait-regret-dataset.test.ts', 'rates are reported separately, never combined into one score'),
  probe('PROVIDER_FAILURE_MATRIX', 'src/theta/database-resilient-observation-cycle.ts', 'tests/database-resilient-observation-cycle.test.ts', 'mixed-cycle evidence fails closed at the exact stage'),
  probe('DATABASE_FAILURE_MATRIX', 'src/theta/database-resilient-observation-cycle.ts', 'tests/database-resilient-observation-cycle.test.ts', 'database loss at every observed failure boundary'),
  probe('SQLITE_FAILURE_MATRIX', 'src/theta/local-evidence-spool.ts', 'tests/local-evidence-spool.test.ts', 'spool returns bounded typed history without treating corrupt rows as evidence'),
  probe('PARQUET_DUCKDB_FAILURE_MATRIX', 'src/storage/local-research-archive-health.ts', 'tests/local-research-archive-health.test.ts', 'archive failure classification keeps quota, transient, and integrity failures distinct'),
  probe('RESOURCE_SOAK', 'src/operations/accelerated-session-soak.ts', 'tests/accelerated-session-soak.test.ts', 'accelerated full-session soak'),
  probe('RACE_CONDITION_SOAK', 'src/worker/resident-worker.ts', 'tests/runtime-request-lease.test.ts', 'primary worker lease outlives the bounded server request'),
  probe('PROCESS_DEADLINE_COVERAGE', 'src/theta/database-independent-shadow-observation.ts', 'tests/database-independent-shadow-observation.test.ts', 'stalled canonical cycle becomes typed partial evidence'),
  probe('Q_LIFECYCLE', 'src/theta/p2g-lifecycle-simulator.ts', 'tests/p2g-lifecycle-simulator.test.ts', 'closed-market lifecycle library covers'),
  probe('H_LIFECYCLE', 'src/theta/p2g-lifecycle-simulator.ts', 'tests/hold-strike-empirical-cohort.test.ts', 'assignment can coexist'),
  probe('D_LIFECYCLE', 'src/research/defined-risk-management-replay.ts', 'tests/defined-risk-management-replay.test.ts', 'defined-risk expiration preserves short assignment loss'),
  probe('A_LIFECYCLE', 'src/theta/p2g-lifecycle-simulator.ts', 'tests/p2g-lifecycle-simulator.test.ts', 'closed-market lifecycle library covers close, expiry, assignment, stock sale'),
  probe('C_LIFECYCLE', 'src/theta/p2g-lifecycle-simulator.ts', 'tests/p2g-lifecycle-simulator.test.ts', 'full synthetic wheel chain preserves the old roll loss'),
  probe('AEGIS', 'src/theta/aegis-derivation.ts', 'tests/aegis-derivation.test.ts', 'candidate A cannot lend good execution evidence'),
  probe('SIZING', 'src/theta/sizing-contract.ts', 'tests/canonical-strategy-frontier.test.ts', 'AEGIS zero sizing preserves the exact binding family and reason'),
  probe('MANAGEMENT', 'src/theta/management-action-frontier.ts', 'tests/management-action-frontier.test.ts', 'CSP management enumerates the full required action surface'),
  probe('WHOLE_CHAIN_ACCOUNTING', 'src/theta/whole-chain-economics.ts', 'tests/p2g-lifecycle-simulator.test.ts', 'full synthetic wheel chain preserves the old roll loss'),
]);

const key = (file: string, id: string) => `${file}#${id}`;
const passed = (tests: Readonly<Record<string, ExecutedNamedTest>>, item: EvidenceProbeSpec) =>
  tests[key(item.testFile, item.testId)]?.passed === true;
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export interface V20EvidenceInput {
  readonly sourceSha: string;
  readonly workerSha: string;
  readonly exactCi: string;
  readonly sourceClean: boolean;
  readonly namedTests: Readonly<Record<string, ExecutedNamedTest>>;
  readonly v19MatrixProbePass: Readonly<Record<string, boolean>>;
  readonly genericEngineeringUnknown: number;
  readonly genericDecisionUnknown: number;
  readonly genericWait: number;
  readonly runtimeAligned: boolean;
  readonly liveValuesCurrent: boolean;
  readonly ownerPaperAuthorized: boolean;
}

export function buildV20EvidenceClosure(input: V20EvidenceInput) {
  const scenarioTests = v19ScenarioEvidence.map((item) => input.namedTests[key(item.testFile, item.testId)]);
  const routeProofs = realDataRouteProbeSpecs.map((item) => ({ ...item, state: passed(input.namedTests, item) ? 'PASS' : 'FAIL' }));
  const crossStrategy = crossStrategyProbeSpecs.map((item) => ({ ...item, state: passed(input.namedTests, item) ? 'PASS' : 'FAIL' }));
  const capability = strategyCapabilityProbeIds.map((id) => ({ id, state: input.v19MatrixProbePass[id] === true ? 'PASS' : 'FAIL' }));
  const coverageMap = v18CoverageProbeSpecs.map((item) => ({ REQUIREMENT_ID: item.id,
    V19_EVIDENCE: `${item.testFile}#${item.testId}`, TEST_OR_RUNTIME_PROOF: input.namedTests[key(item.testFile, item.testId)] ?? null,
    STATE: passed(input.namedTests, item) ? 'PASS' : 'NOT_COVERED', SOURCE_FILE: item.sourceFile, TEST_FILE: item.testFile }));
  const config = auditPresessionConfiguration();
  const paperCriticalProviderLimitations = unresolvedSystemState.PROVIDER_LIMITED;
  const optionalProviderLimitations = softFeatureUsageRegistry.filter((item) => item.use === 'PROVIDER_LIMITED').map((item) => item.family);
  const structuralPolicy = unresolvedSystemState.STRUCTURAL_POLICY_INCOMPATIBILITY;
  const codeSolvable = [
    ...(input.sourceClean ? [] : ['SOURCE_WORKTREE_DIRTY']),
    ...(input.exactCi === 'UNVERIFIED' ? ['EXACT_CI_UNVERIFIED'] : []),
    ...(config.state === 'PASS' ? [] : ['CONFIGURATION_AUDIT_FAILED']),
    ...routeProofs.filter((item) => item.state === 'FAIL').map((item) => `REAL_DATA_ROUTE_UNPROVEN:${item.id}`),
    ...crossStrategy.filter((item) => item.state === 'FAIL').map((item) => `CROSS_STRATEGY_PROBE_UNPROVEN:${item.id}`),
    ...capability.filter((item) => item.state === 'FAIL').map((item) => `STRATEGY_CAPABILITY_UNPROVEN:${item.id}`),
    ...coverageMap.filter((item) => item.STATE !== 'PASS').map((item) => `V18_REQUIREMENT_NOT_COVERED:${item.REQUIREMENT_ID}`),
    ...scenarioTests.flatMap((item, index) => item?.passed === true ? [] : [`SCENARIO_TEST_UNPROVEN:${v19ScenarioEvidence[index]?.id ?? index}`]),
    ...(input.genericEngineeringUnknown === 0 ? [] : [`GENERIC_ENGINEERING_UNKNOWN:${input.genericEngineeringUnknown}`]),
    ...(input.genericDecisionUnknown === 0 ? [] : [`GENERIC_DECISION_UNKNOWN:${input.genericDecisionUnknown}`]),
    ...(input.genericWait === 0 ? [] : [`GENERIC_WAIT:${input.genericWait}`]),
  ];
  const engineeringPass = codeSolvable.length === 0;
  const paperProviderReady = paperCriticalProviderLimitations.length === 0;
  const receiptCore = { sourceSha: input.sourceSha, workerSha: input.workerSha, routeProofs, crossStrategy, capability,
    coverageMap, scenarioTests, codeSolvable };
  return {
    contractVersion: v20EvidenceClosureVersion, MAIN_SHA: input.sourceSha, WORKER_SHA: input.workerSha, EXACT_CI: input.exactCi,
    receiptHash: hash(receiptCore),
    SELF_DECLARED_TRUTH_FIELDS: coverageMap.filter((item) => item.TEST_OR_RUNTIME_PROOF === null).length,
    SYNTHETIC_ONLY_ROUTE_PROOFS: routeProofs.filter((item) => item.state !== 'PASS').length,
    REAL_DATA_ROUTES_TOTAL: routeProofs.length, REAL_DATA_ROUTES_PASS: routeProofs.filter((item) => item.state === 'PASS').length,
    REAL_DATA_ROUTES_FAIL: routeProofs.filter((item) => item.state === 'FAIL').length,
    SCENARIO_TEST_IDS_TOTAL: scenarioTests.length,
    SCENARIO_TEST_IDS_EXECUTED: scenarioTests.filter((item) => item?.executed).length,
    SCENARIO_TEST_IDS_SKIPPED: scenarioTests.filter((item) => item?.skipped).length,
    SCENARIO_TEST_IDS_MISSING: scenarioTests.filter((item) => !item?.exists).length,
    SCENARIO_TEST_IDS_FAILED: scenarioTests.filter((item) => item?.exists && !item.passed && !item.skipped).length,
    STRATEGY_CAPABILITY_PROBES_TOTAL: capability.length,
    STRATEGY_CAPABILITY_PROBES_PASS: capability.filter((item) => item.state === 'PASS').length,
    STRATEGY_CAPABILITY_PROBES_FAIL: capability.filter((item) => item.state === 'FAIL').length,
    CROSS_STRATEGY_PROBES: crossStrategy.length,
    CROSS_STRATEGY_PROBES_PASS: crossStrategy.filter((item) => item.state === 'PASS').length,
    CROSS_STRATEGY_PROBES_FAIL: crossStrategy.filter((item) => item.state === 'FAIL').length,
    GENERIC_ENGINEERING_UNKNOWN: input.genericEngineeringUnknown,
    GENERIC_DECISION_UNKNOWN: input.genericDecisionUnknown, GENERIC_WAIT: input.genericWait,
    CONFIG_CONFLICTS: config.invalidEntries, CONFIG_DUPLICATE_AUTHORITIES: config.duplicateNames,
    CONFIG_UNUSED_SETTINGS: config.unregisteredFields,
    DECLARED_BUT_UNUSED_DECISION_DATA: decisionDataRoutes.filter((item) => !item.consumer).map((item) => item.feature),
    DATA_WITHOUT_PROVENANCE: decisionDataRoutes.filter((item) => !item.source || !item.producer || !item.normalizer).map((item) => item.feature),
    DATA_WITHOUT_CONSUMER: decisionDataRoutes.filter((item) => !item.consumer).map((item) => item.feature),
    coverageMap, routeProofs, crossStrategy, capability,
    CODE_SOLVABLE: [...new Set(codeSolvable)].sort(),
    FORWARD_DATA_REQUIRED: unresolvedSystemState.FORWARD_DATA_REQUIRED,
    PROVIDER_LIMITED: { PAPER_CRITICAL: paperCriticalProviderLimitations, OPTIONAL_RESEARCH: optionalProviderLimitations },
    EMPIRICALLY_UNPROVEN: unresolvedSystemState.EMPIRICALLY_UNPROVEN,
    STRUCTURAL_POLICY_INCOMPATIBILITY: structuralPolicy,
    OWNER_PERMISSION_REQUIRED: unresolvedSystemState.OWNER_PERMISSION_REQUIRED,
    ENGINEERING_CERTIFICATION: engineeringPass ? 'PASS' : 'FAIL',
    CURRENT_LIVE_VALUE_READINESS: input.liveValuesCurrent ? 'READY' : 'FORWARD_DATA_REQUIRED',
    PAPER_CRITICAL_PROVIDER_READINESS: paperProviderReady ? 'READY' : 'PROVIDER_LIMITED',
    EMPIRICAL_MODEL_READINESS: 'EMPIRICALLY_UNPROVEN',
    OWNER_AUTHORIZATION: input.ownerPaperAuthorized ? 'AUTHORIZED' : 'NOT_AUTHORIZED',
    READY_FOR_LOCKED_LIVE_OBSERVATION: engineeringPass && input.runtimeAligned ? 'YES' : 'NO',
    READY_FOR_FIRST_PAPER: engineeringPass && input.liveValuesCurrent && paperProviderReady && input.ownerPaperAuthorized ? 'YES' : 'NO',
    READY_FOR_LIVE_MONEY: 'NO',
    V20_FINAL_EVIDENCE_CERTIFICATION: engineeringPass ? 'PASS' : 'FAIL',
    ORDER_SUBMISSIONS: 0, BROKER_MUTATIONS: 0, MASTER_PAPER_EXECUTION_ENABLED: false,
    FOLLOWERS: 'LOCKED', LIVE_MONEY: 'NOT_AUTHORIZED',
  } as const;
}
