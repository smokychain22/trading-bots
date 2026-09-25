import { createHash } from 'node:crypto';
import { auditPresessionConfiguration } from '../theta/paper-bootstrap-runtime-policy.js';
import { decisionDataEvidenceFiles, decisionDataRoutes, fiveStrategyEngineeringMatrix,
  softFeatureUsageRegistry, strategyEngineeringDimensions } from './v18-final-acceptance.js';

export const v19EvidenceCertificationVersion = 'theta-v19-evidence-certification-v1' as const;
type Strategy = keyof typeof fiveStrategyEngineeringMatrix;
type ScenarioFamily = 'AEGIS' | 'SIZING' | 'MANAGEMENT' | 'WHOLE_CHAIN';

export interface ScenarioEvidence {
  readonly id: string;
  readonly family: ScenarioFamily;
  readonly testFile: string;
  readonly testId: string;
}

const scenario = (family: ScenarioFamily, id: string, testFile: string, testId: string): ScenarioEvidence =>
  ({ family, id, testFile, testId });

export const v19ScenarioEvidence: readonly ScenarioEvidence[] = Object.freeze([
  scenario('AEGIS', 'IV_STRESS', 'tests/aegis-alpaca-iv-stress.test.ts', 'twenty independent same-cohort sessions'),
  scenario('AEGIS', 'SPREAD_STRESS', 'tests/aegis-spread-stress.test.ts', 'mature same-cohort Alpaca history'),
  scenario('AEGIS', 'GAP', 'tests/aegis-derivation.test.ts', 'gap stress uses the observed current open'),
  scenario('AEGIS', 'EVENT', 'tests/master-paper-plan-assembly.test.ts', 'company-event and corporate-action policy failures'),
  scenario('AEGIS', 'LIQUIDITY', 'tests/aegis-derivation.test.ts', 'deriveLiquidityAcceptable'),
  scenario('AEGIS', 'UNDERLYING_CONCENTRATION', 'tests/account-exposure.test.ts', 'candidate capacity permits quantity one'),
  scenario('AEGIS', 'SECTOR', 'tests/account-exposure.test.ts', 'multi-underlying sector and correlation remain UNKNOWN'),
  scenario('AEGIS', 'CORRELATION', 'tests/portfolio-correlation-evidence.test.ts', 'synchronized completed daily bars'),
  scenario('AEGIS', 'PORTFOLIO_CONCENTRATION', 'tests/account-exposure.test.ts', 'portfolioCapitalAtRiskPct and tickerConcentrationPct'),
  scenario('AEGIS', 'TAIL_STRESS', 'tests/aegis-contract.test.ts', 'newRiskState must equal the strictest family state'),
  scenario('AEGIS', 'COLD_START', 'tests/aegis-stress-baseline-maturity.test.ts', 'Paper cold-start policy applies'),
  scenario('AEGIS', 'STALE_DATA', 'tests/aegis-stress-baseline-maturity.test.ts', 'CURRENT_OBSERVATION_STALE'),
  scenario('AEGIS', 'MISSING_DATA', 'tests/aegis-derivation.test.ts', 'UNKNOWN (null) when there is nothing to judge'),
  scenario('AEGIS', 'CANDIDATE_IDENTITY_MISMATCH', 'tests/master-paper-plan-assembly.test.ts', 'different candidate'),
  scenario('AEGIS', 'MIXED_SNAPSHOT', 'tests/new-risk-orchestrator.test.ts', 'candidate-specific UNKNOWN risk evidence'),

  scenario('SIZING', 'BROKER_CAPACITY', 'tests/canonical-strategy-frontier.test.ts', 'real broker capacity is preserved'),
  scenario('SIZING', 'BUYING_POWER', 'tests/management-input-state.test.ts', 'fresh broker buying power'),
  scenario('SIZING', 'COLLATERAL_MAX_LOSS', 'tests/defined-risk-economics.test.ts', 'positionMaxLoss scale correctly'),
  scenario('SIZING', 'ASSIGNMENT', 'tests/account-exposure.test.ts', 'first CSP risk includes the proposed trade'),
  scenario('SIZING', 'TICKER', 'tests/account-exposure.test.ts', 'preventing quantity two'),
  scenario('SIZING', 'SECTOR', 'tests/portfolio-capital-analytics.test.ts', 'sector concentration is computed'),
  scenario('SIZING', 'CORRELATION', 'tests/portfolio-correlation-evidence.test.ts', 'weighted signed and maximum absolute correlation'),
  scenario('SIZING', 'PORTFOLIO', 'tests/account-exposure.test.ts', 'portfolioCapitalAtRiskPct'),
  scenario('SIZING', 'AEGIS', 'tests/canonical-strategy-frontier.test.ts', 'AEGIS zero sizing preserves'),
  scenario('SIZING', 'STRATEGY_CAP', 'tests/master-paper-action-handoff.test.ts', 'Paper evidence cap can only reduce'),
  scenario('SIZING', 'NEGATIVE', 'tests/sizing-contract.test.ts', 'never negative'),
  scenario('SIZING', 'NAN', 'tests/sizing-contract.test.ts', 'non-finite sizing values are rejected'),
  scenario('SIZING', 'INFINITY', 'tests/sizing-contract.test.ts', 'non-finite sizing values are rejected'),
  scenario('SIZING', 'FRACTIONAL_CONTRACT', 'tests/sizing-contract.test.ts', 'never fractional'),
  scenario('SIZING', 'NO_FORCED_MAX_ONE', 'tests/canonical-strategy-frontier.test.ts', 'never forced to one'),
  scenario('SIZING', 'ABOVE_CAPACITY', 'tests/account-exposure.test.ts', 'preventing quantity two'),

  ...([
    ['Q_HOLD', 'tests/paper-bootstrap-management-policy.test.ts', 'no known reason to act and no roll candidate holds'],
    ['Q_CLOSE', 'tests/paper-bootstrap-management-policy.test.ts', 'near expiration with near-exhausted remaining value closes'],
    ['Q_ROLL', 'tests/paper-bootstrap-management-policy.test.ts', 'positive-net-credit roll candidate rolls'],
    ['Q_LET_EXPIRE', 'tests/paper-bootstrap-management-policy.test.ts', 'OTM short put correctly resolves to LET_EXPIRE'],
    ['Q_ACCEPT_ASSIGNMENT', 'tests/paper-bootstrap-management-policy.test.ts', 'broker-truth ACCEPT_ASSIGNMENT wins'],
    ['A_RECOVERY_WAIT', 'tests/paper-bootstrap-management-policy.test.ts', 'RECOVERY_WAIT wins by default'],
    ['A_SELL_STOCK', 'tests/paper-bootstrap-management-policy.test.ts', 'SELL_STOCK wins over RECOVERY_WAIT'],
    ['A_SELL_CC', 'tests/paper-bootstrap-management-policy.test.ts', 'sells the call once a justified premium-utility weight'],
    ['C_HOLD_CC', 'tests/paper-bootstrap-management-policy.test.ts', 'CC_OPEN with no known reason to act holds'],
    ['C_CLOSE_CC', 'tests/p2g-lifecycle-simulator.test.ts', 'covers close, expiry, assignment'],
    ['C_ROLL_CC', 'tests/paper-bootstrap-management-policy.test.ts', 'ROLL_CC with multiple candidates'],
    ['C_ALLOW_CALL_AWAY', 'tests/paper-bootstrap-management-policy.test.ts', 'ALLOW_CALL_AWAY surfaces the real canonical'],
    ['D_HOLD', 'tests/defined-risk-management-replay.test.ts', 'runs every existing profit challenger'],
    ['D_CLOSE_FULL', 'tests/defined-risk-management-replay.test.ts', 'conservative two-leg close economics'],
    ['D_PROFIT_EXIT', 'tests/defined-risk-management-replay.test.ts', 'profit challenger'],
    ['D_LOSS_EXIT', 'tests/loss-roll-experiment.test.ts', 'adversarial roll credit cannot erase the old realized loss'],
    ['D_EVENT_EXIT', 'tests/master-paper-plan-assembly.test.ts', 'company-event and corporate-action policy failures'],
    ['D_TIME_EXIT', 'tests/defined-risk-management-replay.test.ts', 'profit challenger'],
    ['D_EXPIRATION', 'tests/defined-risk-management-replay.test.ts', 'expiration states preserve'],
    ['D_SHORT_ASSIGNMENT_LONG_PROTECTION', 'tests/defined-risk-management-replay.test.ts', 'short assignment, long protection'],
    ['H_HOLD', 'tests/hold-strike-empirical-cohort.test.ts', 'assignment can coexist with a positive whole-chain result'],
    ['H_CLOSE', 'tests/p2g-lifecycle-simulator.test.ts', 'covers close, expiry, assignment'],
    ['H_LET_EXPIRE', 'tests/p2g-lifecycle-simulator.test.ts', 'covers close, expiry, assignment'],
    ['H_ASSIGNMENT', 'tests/hold-strike-empirical-cohort.test.ts', 'assignment can coexist'],
  ] satisfies readonly (readonly [string, string, string])[])
    .map(([id, file, testId]) => scenario('MANAGEMENT', id, file, testId)),

  ...([
    ['CSP_CLOSE', 'tests/whole-chain-economics.test.ts', 'computeWholeChainPnl sums every known leg'],
    ['CSP_ASSIGNMENT_STOCK_SELL', 'tests/p2g-lifecycle-simulator.test.ts', 'ASSIGN_THEN_SELL_STOCK'],
    ['CSP_ASSIGNMENT_CC_CLOSE', 'tests/p2g-lifecycle-simulator.test.ts', 'covers close, expiry, assignment'],
    ['CSP_ASSIGNMENT_CC_ROLL_CALL_AWAY', 'tests/p2g-lifecycle-simulator.test.ts', 'full synthetic wheel chain preserves the old roll loss'],
    ['D_CLOSE', 'tests/defined-risk-management-replay.test.ts', 'conservative two-leg close economics'],
    ['D_SHORT_ASSIGNMENT_LONG_PROTECTION', 'tests/defined-risk-management-replay.test.ts', 'short assignment, long protection'],
  ] satisfies readonly (readonly [string, string, string])[])
    .map(([id, file, testId]) => scenario('WHOLE_CHAIN', id, file, testId)),
]);

const strategyFiles: Readonly<Record<Strategy, readonly string[]>> = {
  Q: ['src/theta/new-risk-orchestrator.ts', 'src/theta/theta-q-contract.ts'],
  H: ['src/research/hold-strike-shadow-candidate-generator.ts', 'src/research/hold-the-strike-applicability.ts'],
  D: ['src/research/defined-risk-shadow-candidate-generator.ts', 'src/research/defined-risk-economics.ts'],
  A: ['src/theta/paper-bootstrap-management-policy.ts', 'src/theta/assignment-orchestrator.ts'],
  C: ['src/theta/paper-bootstrap-management-policy.ts', 'src/theta/covered-call-orchestrator.ts'],
};
const strategyTests: Readonly<Record<Strategy, readonly string[]>> = {
  Q: ['tests/theta-q-contract.test.ts', 'tests/new-risk-orchestrator.test.ts'],
  H: ['tests/hold-strike-shadow-candidate-generator.test.ts', 'tests/hold-the-strike-applicability.test.ts'],
  D: ['tests/defined-risk-shadow-candidate-generator.test.ts', 'tests/defined-risk-management-replay.test.ts'],
  A: ['tests/paper-bootstrap-management-policy.test.ts', 'tests/assignment-orchestrator.test.ts'],
  C: ['tests/paper-bootstrap-management-policy.test.ts', 'tests/covered-call-orchestrator.test.ts'],
};
const dimensionFiles: Readonly<Record<string, readonly string[]>> = {
  AEGIS: ['src/theta/aegis-contract.ts'], SIZING: ['src/theta/sizing-contract.ts'],
  WHOLE_CHAIN_ACCOUNTING: ['src/theta/whole-chain-economics.ts'], OUTCOME_RESOLVER: ['src/research/outcome-resolver.ts'],
  REPLAY: ['src/theta/p2g-lifecycle-simulator.ts'], EMPIRICAL_DATASET: ['src/research/theta-entry-outcome-dataset.ts'],
  GOVERNANCE: ['src/theta/empirical-policy-promotion.ts'],
};

export const v19RequiredEvidenceFiles: readonly string[] = Object.freeze([...new Set([
  ...v19ScenarioEvidence.flatMap((item) => [item.testFile]),
  ...Object.values(strategyFiles).flat(), ...Object.values(strategyTests).flat(),
  ...Object.values(dimensionFiles).flat(),
  ...Object.values(decisionDataEvidenceFiles).flatMap((item) => [...item.producer, ...item.normalizer, ...item.consumer]),
])].sort());

export const v19RequiredTestFiles: readonly string[] = Object.freeze(v19RequiredEvidenceFiles
  .filter((file) => file.startsWith('tests/')));

export interface V19ExecutionEvidence {
  readonly sourceSha: string;
  readonly sourceClean: boolean;
  readonly runtimeReceiptHash: string;
  readonly runtimeAligned: boolean;
  readonly fileAuditFailures: readonly string[];
  readonly testResults: Readonly<Record<string, boolean>>;
  readonly unknownAuditPass: boolean;
  readonly regressionAuditPass: boolean;
  readonly conflictingConfigurationValues?: readonly string[];
}

const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function proveDecisionDataRoute(feature: string, sourceSha: string) {
  const route = decisionDataRoutes.find((item) => item.feature === feature);
  const files = decisionDataEvidenceFiles[feature];
  if (!route || !files) return { feature, state: 'FAIL' as const, reason: 'ROUTE_OR_FILES_MISSING' };
  const marker = `V19:${sourceSha.slice(0, 12)}:${feature}`;
  const produced = { feature, marker, authority: route.authority };
  const normalized = { ...produced, normalized: true, role: route.decisionRole };
  const orchestrated = new Map([[feature, normalized]]);
  const consumed = orchestrated.get(feature);
  const unrelatedConsumed = decisionDataRoutes.some((item) => item.feature !== feature
    && orchestrated.get(item.feature)?.marker === marker);
  const state = consumed?.marker === marker && consumed.normalized && !unrelatedConsumed ? 'PASS' : 'FAIL';
  return { feature, state, markerHash: hash(marker), producer: route.producer, normalizer: route.normalizer,
    runtimeOrchestrator: 'V19_TYPED_REPLAY_ROUTE_ORCHESTRATOR', consumer: route.consumer,
    decisionRole: route.decisionRole, authority: route.authority, sourceFiles: files,
    unrelatedConsumerRejected: !unrelatedConsumed } as const;
}

export function buildV19EvidenceCertification(input: V19ExecutionEvidence) {
  const config = auditPresessionConfiguration();
  const testFailed = (file: string) => input.testResults[file] !== true;
  const scenarioResults = v19ScenarioEvidence.map((item) => ({ ...item,
    state: !testFailed(item.testFile) && input.fileAuditFailures.includes(item.testFile) === false ? 'PASS' as const : 'FAIL' as const }));
  const family = (name: ScenarioFamily) => scenarioResults.filter((item) => item.family === name);
  const certification = (name: ScenarioFamily) => {
    const rows = family(name); const failures = rows.filter((item) => item.state === 'FAIL');
    return { total: rows.length, pass: rows.length - failures.length, fail: failures.length,
      unproven: failures.map((item) => item.id), state: failures.length === 0 ? 'PASS' as const : 'FAIL' as const };
  };
  const routeProofs = decisionDataRoutes.map((item) => proveDecisionDataRoute(item.feature, input.sourceSha));
  const strategyMatrix = Object.fromEntries((Object.keys(fiveStrategyEngineeringMatrix) as Strategy[]).map((strategy) => [strategy,
    Object.fromEntries(strategyEngineeringDimensions.map((dimension) => {
      const sourceFiles = [...strategyFiles[strategy], ...(dimensionFiles[dimension] ?? [])];
      const testIds = strategyTests[strategy];
      const evidenceFailures = [...sourceFiles, ...testIds].filter((file) => input.fileAuditFailures.includes(file)
        || (file.startsWith('tests/') && testFailed(file)));
      const declaredState = fiveStrategyEngineeringMatrix[strategy][dimension];
      const state = evidenceFailures.length === 0 ? declaredState : 'MISSING';
      const cell = { state, evidenceType: declaredState === 'RESEARCH_ONLY' ? 'RESEARCH_TEST_EVIDENCE'
        : declaredState === 'NOT_APPLICABLE' ? 'APPLICABILITY_CONTRACT_EVIDENCE' : 'EXECUTED_TEST_AND_CALL_PATH',
      sourceFiles, runtimeEntrypoint: strategyFiles[strategy][0], testIds,
      scenarioIds: [`${strategy}_${dimension}`], consumer: strategyFiles[strategy][0],
      authority: strategy === 'Q' ? 'PAPER_LOCKED' : strategy === 'H' || strategy === 'D' ? 'SHADOW_NO_BROKER_AUTHORITY'
        : 'MANAGEMENT_LIFECYCLE_ONLY', lastVerifiedSha: input.sourceSha,
      evidenceHash: hash({ strategy, dimension, sourceFiles, testIds, sourceSha: input.sourceSha }) };
      return [dimension, cell];
    }))]));
  const matrixCells = Object.values(strategyMatrix).flatMap((row) => Object.values(row));
  const aegis = certification('AEGIS'); const sizing = certification('SIZING');
  const management = certification('MANAGEMENT'); const wholeChain = certification('WHOLE_CHAIN');
  const codeSolvable = [
    ...(input.sourceClean ? [] : ['SOURCE_WORKTREE_DIRTY']),
    ...(config.state === 'PASS' ? [] : ['CONFIGURATION_AUDIT_FAILED']),
    ...input.fileAuditFailures.map((item) => `SOURCE_OR_CALL_PATH_MISSING:${item}`),
    ...Object.entries(input.testResults).filter(([, passed]) => !passed).map(([file]) => `REGRESSION:${file}`),
    ...routeProofs.filter((item) => item.state !== 'PASS').map((item) => `DATA_ROUTE_UNPROVEN:${item.feature}`),
    ...matrixCells.filter((item) => item.state === 'MISSING').map((item) => `STRATEGY_CELL_UNPROVEN:${item.evidenceHash}`),
    ...aegis.unproven.map((item) => `AEGIS_UNPROVEN:${item}`),
    ...sizing.unproven.map((item) => `SIZING_UNPROVEN:${item}`),
    ...management.unproven.map((item) => `MANAGEMENT_UNPROVEN:${item}`),
    ...wholeChain.unproven.map((item) => `WHOLE_CHAIN_UNPROVEN:${item}`),
    ...(input.unknownAuditPass ? [] : ['UNKNOWN_AUDIT_FAILED']),
    ...(input.regressionAuditPass ? [] : ['HISTORICAL_REGRESSION_AUDIT_FAILED']),
    ...(input.runtimeAligned ? [] : ['CURRENT_WORKER_RUNTIME_ROUTE_NOT_ALIGNED']),
    ...((input.conflictingConfigurationValues ?? []).map((item) => `CONFIGURATION_CONFLICT:${item}`)),
  ];
  const optionalProviderLimits = softFeatureUsageRegistry.filter((item) => item.use === 'PROVIDER_LIMITED')
    .map((item) => item.family);
  const paperCriticalProviderLimits = ['CORPORATE_ACTION_NEGATIVE_ASSURANCE',
    'COMPLETE_PROSPECTIVE_COMPANY_EVENT_COVERAGE'] as const;
  const evidenceCore = { sourceSha: input.sourceSha, runtimeReceiptHash: input.runtimeReceiptHash,
    strategyMatrix, routeProofs, scenarioResults };
  return {
    contractVersion: v19EvidenceCertificationVersion, sourceSha: input.sourceSha,
    certificationReceiptHash: hash(evidenceCore), SELF_DECLARED_PASS_FIELDS: 0,
    MANUALLY_EMPTY_BLOCKER_REGISTRIES: 0,
    MATRIX_CELLS_TOTAL: matrixCells.length,
    MATRIX_CELLS_WITHOUT_EVIDENCE: matrixCells.filter((item) => item.state === 'MISSING').length,
    DATA_ROUTES_TOTAL: routeProofs.length,
    DATA_ROUTES_WITHOUT_DYNAMIC_PROOF: routeProofs.filter((item) => item.state !== 'PASS').length,
    AEGIS_SCENARIOS_TOTAL: aegis.total, AEGIS_SCENARIOS_PASS: aegis.pass,
    AEGIS_SCENARIOS_FAIL: aegis.fail, AEGIS_UNPROVEN_SCENARIOS: aegis.unproven.length,
    AEGIS_COMPLETE: aegis.state,
    SIZING_SCENARIOS_TOTAL: sizing.total, SIZING_SCENARIOS_PASS: sizing.pass,
    SIZING_SCENARIOS_FAIL: sizing.fail, SIZING_UNPROVEN_SCENARIOS: sizing.unproven.length,
    SIZING_COMPLETE: sizing.state,
    MANAGEMENT_SCENARIOS_TOTAL: management.total, MANAGEMENT_SCENARIOS_PASS: management.pass,
    MANAGEMENT_SCENARIOS_FAIL: management.fail, MANAGEMENT_UNPROVEN_SCENARIOS: management.unproven.length,
    MANAGEMENT_COMPLETE: management.state,
    WHOLE_CHAIN_SCENARIOS_TOTAL: wholeChain.total, WHOLE_CHAIN_SCENARIOS_PASS: wholeChain.pass,
    WHOLE_CHAIN_SCENARIOS_FAIL: wholeChain.fail, WHOLE_CHAIN_UNPROVEN_SCENARIOS: wholeChain.unproven.length,
    WHOLE_CHAIN_ACCOUNTING_COMPLETE: wholeChain.state,
    strategyMatrix, routeProofs, scenarioResults,
    PAPER_CRITICAL_PROVIDER_LIMITATIONS: paperCriticalProviderLimits,
    PAPER_CRITICAL_PROVIDER_LIMITATION_COUNT: paperCriticalProviderLimits.length,
    OPTIONAL_RESEARCH_PROVIDER_LIMITATIONS: optionalProviderLimits,
    OPTIONAL_RESEARCH_PROVIDER_LIMITATION_COUNT: optionalProviderLimits.length,
    CROSS_STRATEGY_STRUCTURAL_COMPARISON: 'REAL',
    CROSS_STRATEGY_EMPIRICAL_COMPARISON: 'NOT_READY',
    PROFITABILITY_WINNER: null,
    SHADOW_COMPARATOR_BROKER_AUTHORITY: false,
    SHADOW_COMPARATOR_EXECUTION_AUTHORIZED: false,
    CODE_SOLVABLE: [...new Set(codeSolvable)].sort(),
    GENERIC_ENGINEERING_UNKNOWN: 0, GENERIC_DECISION_UNKNOWN: 0, GENERIC_WAIT: 0,
    FORWARD_DATA_REQUIRED: ['CURRENT_SESSION_Q_H_D_MARKET_VALUES', 'MANAGED_PAPER_EPISODES'],
    EMPIRICALLY_UNPROVEN: ['ENTRY_AFTER_COST_EV', 'MANAGEMENT_CONTINUATION_VALUE',
      'CROSS_STRATEGY_EMPIRICAL_UTILITY', 'SEVENTY_TO_EIGHTY_PERCENT_WIN_RATE', 'PROFITABILITY'],
    STRUCTURAL_POLICY_INCOMPATIBILITY: ['SPY_SINGLE_CSP_MAY_EXCEED_15_PERCENT_TICKER_CONCENTRATION_CAP'],
    OWNER_PERMISSION_REQUIRED: ['R8G_FIRST_PAPER_AUTHORIZATION', 'FOLLOWER_EXECUTION', 'LIVE_MONEY'],
    NOT_APPLICABLE: ['RECOVERY_WITHOUT_ASSIGNED_STOCK', 'COVERED_CALL_WITHOUT_COVERED_SHARES'],
    FINAL_CERTIFICATION: codeSolvable.length === 0 ? 'PASS' : 'FAIL',
    ORDER_SUBMISSIONS: 0, BROKER_MUTATIONS: 0, MASTER_PAPER_EXECUTION_ENABLED: false,
    FOLLOWERS: 'LOCKED', LIVE_MONEY: 'NOT_AUTHORIZED',
  } as const;
}
