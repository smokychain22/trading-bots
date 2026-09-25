import { auditPresessionConfiguration, decisionCriticalConfigurationFields,
  presessionConfigurationRegistry } from '../theta/paper-bootstrap-runtime-policy.js';
import { thetaFeatureFamily } from '../theta/strategy-package.js';

export const v18FinalAcceptanceVersion = 'theta-v18-final-acceptance-v1' as const;

export type EngineeringState = 'REAL' | 'SIMULATION_PROVEN' | 'RESEARCH_ONLY'
  | 'FORWARD_DATA_REQUIRED' | 'EMPIRICALLY_UNPROVEN' | 'NOT_APPLICABLE' | 'MISSING';

export const strategyEngineeringDimensions = [
  'THESIS', 'REGIME', 'CANDIDATE_GENERATOR', 'HARD_FILTERS', 'SOFT_FEATURES',
  'ACCOUNT_FEASIBILITY', 'AEGIS', 'SIZING', 'LOCKED_PLAN', 'PROFIT_MANAGEMENT',
  'LOSS_MANAGEMENT', 'ROLL', 'EXPIRATION', 'ASSIGNMENT', 'EARLY_EXERCISE',
  'RECOVERY', 'WHOLE_CHAIN_ACCOUNTING', 'OUTCOME_RESOLVER', 'REPLAY',
  'EMPIRICAL_DATASET', 'GOVERNANCE',
] as const;
export type StrategyEngineeringDimension = typeof strategyEngineeringDimensions[number];
export type StrategyEngineeringRow = Readonly<Record<StrategyEngineeringDimension, EngineeringState>>;

const row = (values: StrategyEngineeringRow): StrategyEngineeringRow => Object.freeze(values);

export const fiveStrategyEngineeringMatrix = Object.freeze({
  Q: row({
    THESIS: 'REAL', REGIME: 'REAL', CANDIDATE_GENERATOR: 'REAL', HARD_FILTERS: 'REAL', SOFT_FEATURES: 'REAL',
    ACCOUNT_FEASIBILITY: 'REAL', AEGIS: 'REAL', SIZING: 'REAL', LOCKED_PLAN: 'REAL',
    PROFIT_MANAGEMENT: 'REAL', LOSS_MANAGEMENT: 'REAL', ROLL: 'REAL', EXPIRATION: 'REAL',
    ASSIGNMENT: 'REAL', EARLY_EXERCISE: 'REAL', RECOVERY: 'REAL', WHOLE_CHAIN_ACCOUNTING: 'REAL',
    OUTCOME_RESOLVER: 'REAL', REPLAY: 'REAL', EMPIRICAL_DATASET: 'REAL', GOVERNANCE: 'REAL',
  }),
  H: row({
    THESIS: 'REAL', REGIME: 'REAL', CANDIDATE_GENERATOR: 'REAL', HARD_FILTERS: 'REAL', SOFT_FEATURES: 'REAL',
    ACCOUNT_FEASIBILITY: 'REAL', AEGIS: 'REAL', SIZING: 'REAL', LOCKED_PLAN: 'RESEARCH_ONLY',
    PROFIT_MANAGEMENT: 'RESEARCH_ONLY', LOSS_MANAGEMENT: 'RESEARCH_ONLY', ROLL: 'RESEARCH_ONLY',
    EXPIRATION: 'SIMULATION_PROVEN', ASSIGNMENT: 'SIMULATION_PROVEN', EARLY_EXERCISE: 'SIMULATION_PROVEN',
    RECOVERY: 'SIMULATION_PROVEN', WHOLE_CHAIN_ACCOUNTING: 'REAL', OUTCOME_RESOLVER: 'REAL',
    REPLAY: 'REAL', EMPIRICAL_DATASET: 'REAL', GOVERNANCE: 'REAL',
  }),
  D: row({
    THESIS: 'REAL', REGIME: 'REAL', CANDIDATE_GENERATOR: 'REAL', HARD_FILTERS: 'REAL', SOFT_FEATURES: 'REAL',
    ACCOUNT_FEASIBILITY: 'REAL', AEGIS: 'REAL', SIZING: 'REAL', LOCKED_PLAN: 'REAL',
    PROFIT_MANAGEMENT: 'RESEARCH_ONLY', LOSS_MANAGEMENT: 'RESEARCH_ONLY', ROLL: 'RESEARCH_ONLY',
    EXPIRATION: 'SIMULATION_PROVEN', ASSIGNMENT: 'SIMULATION_PROVEN', EARLY_EXERCISE: 'SIMULATION_PROVEN',
    RECOVERY: 'SIMULATION_PROVEN', WHOLE_CHAIN_ACCOUNTING: 'REAL', OUTCOME_RESOLVER: 'REAL',
    REPLAY: 'REAL', EMPIRICAL_DATASET: 'REAL', GOVERNANCE: 'REAL',
  }),
  A: row({
    THESIS: 'REAL', REGIME: 'REAL', CANDIDATE_GENERATOR: 'REAL', HARD_FILTERS: 'REAL', SOFT_FEATURES: 'REAL',
    ACCOUNT_FEASIBILITY: 'REAL', AEGIS: 'REAL', SIZING: 'REAL', LOCKED_PLAN: 'REAL',
    PROFIT_MANAGEMENT: 'REAL', LOSS_MANAGEMENT: 'REAL', ROLL: 'NOT_APPLICABLE', EXPIRATION: 'NOT_APPLICABLE',
    ASSIGNMENT: 'REAL', EARLY_EXERCISE: 'NOT_APPLICABLE', RECOVERY: 'REAL', WHOLE_CHAIN_ACCOUNTING: 'REAL',
    OUTCOME_RESOLVER: 'REAL', REPLAY: 'REAL', EMPIRICAL_DATASET: 'REAL', GOVERNANCE: 'REAL',
  }),
  C: row({
    THESIS: 'REAL', REGIME: 'REAL', CANDIDATE_GENERATOR: 'REAL', HARD_FILTERS: 'REAL', SOFT_FEATURES: 'REAL',
    ACCOUNT_FEASIBILITY: 'REAL', AEGIS: 'REAL', SIZING: 'REAL', LOCKED_PLAN: 'REAL',
    PROFIT_MANAGEMENT: 'REAL', LOSS_MANAGEMENT: 'REAL', ROLL: 'REAL', EXPIRATION: 'REAL',
    ASSIGNMENT: 'REAL', EARLY_EXERCISE: 'REAL', RECOVERY: 'REAL', WHOLE_CHAIN_ACCOUNTING: 'REAL',
    OUTCOME_RESOLVER: 'REAL', REPLAY: 'REAL', EMPIRICAL_DATASET: 'REAL', GOVERNANCE: 'REAL',
  }),
} as const);

export type DecisionDataAuthority = 'ALPACA_EXECUTABLE_MARKET' | 'ALPACA_BROKER_LIFECYCLE'
  | 'OPTIONOMICS_SESSION_RESEARCH' | 'THETA_PERSISTED_DECISION';
export type DecisionDataRole = 'HARD_SAFETY' | 'STRUCTURAL_ECONOMICS' | 'SOFT_RANKING'
  | 'SHADOW_CONTEXT' | 'CAPITAL_AND_SIZING';

export interface DecisionDataRoute {
  readonly feature: string;
  readonly source: string;
  readonly producer: string;
  readonly normalizer: string;
  readonly consumer: string;
  readonly decisionRole: DecisionDataRole;
  readonly authority: DecisionDataAuthority;
  readonly executionUse: 'PRODUCTION' | 'SHADOW' | 'RESEARCH_ONLY' | 'PROVIDER_LIMITED';
}

const data = (feature: string, source: string, producer: string, normalizer: string, consumer: string,
  decisionRole: DecisionDataRole, authority: DecisionDataAuthority,
  executionUse: DecisionDataRoute['executionUse']): DecisionDataRoute => ({
  feature, source, producer, normalizer, consumer, decisionRole, authority, executionUse,
});

export const decisionDataRoutes: readonly DecisionDataRoute[] = Object.freeze([
  data('IV', 'Alpaca contract IV and qualified Optionomics session metrics', 'aegis-alpaca-iv-stress, optionomics-feature-engine', 'strict finite IV adapters', 'AEGIS IV detector, volatility evidence, research export', 'HARD_SAFETY', 'THETA_PERSISTED_DECISION', 'PRODUCTION'),
  data('RV', 'Optionomics price history/session metrics', 'optionomics-feature-engine', 'strict session RV normalization', 'volatility-risk-premium and shadow studies', 'SOFT_RANKING', 'OPTIONOMICS_SESSION_RESEARCH', 'SHADOW'),
  data('IV-RV', 'Normalized IV and RV', 'volatility-risk-premium', 'variance-space and arithmetic spread derivation', 'qualified soft-feature evidence and research export', 'SOFT_RANKING', 'THETA_PERSISTED_DECISION', 'SHADOW'),
  data('skew', 'Optionomics options/session surface', 'optionomics-feature-engine', 'strict numeric-string parser', 'strategy-quality shadow diagnostics and research export', 'SHADOW_CONTEXT', 'OPTIONOMICS_SESSION_RESEARCH', 'RESEARCH_ONLY'),
  data('term', 'Optionomics session term data', 'optionomics-feature-engine', 'requested/served-session validator', 'strategy-quality shadow diagnostics and management context', 'SHADOW_CONTEXT', 'OPTIONOMICS_SESSION_RESEARCH', 'RESEARCH_ONLY'),
  data('trend', 'Alpaca PIT stock bars', 'ownership and regime contracts', 'adjusted-bar and temporal normalization', 'router applicability, ownership, soft evidence', 'SOFT_RANKING', 'THETA_PERSISTED_DECISION', 'PRODUCTION'),
  data('momentum', 'Optionomics documented legacy iv_momentum field', 'Optionomics metrics adapter', 'DOCUMENTED_LEGACY_NULL remains distinct from a provider gap', 'normalized provider-context persistence and capability-gap audit', 'SHADOW_CONTEXT', 'OPTIONOMICS_SESSION_RESEARCH', 'PROVIDER_LIMITED'),
  data('flow', 'Optionomics flow aggregates', 'optionomics context collector', 'typed information-state adapter', 'strategy-quality shadow diagnostics and research export', 'SHADOW_CONTEXT', 'OPTIONOMICS_SESSION_RESEARCH', 'RESEARCH_ONLY'),
  data('GEX', 'Optionomics exposure heatmap', 'optionomics context collector', 'metric-enum and returned-metric verification', 'strategy-quality shadow diagnostics and research export', 'SHADOW_CONTEXT', 'OPTIONOMICS_SESSION_RESEARCH', 'RESEARCH_ONLY'),
  data('vanna', 'Optionomics vanna heatmap', 'optionomics context collector', 'metric-enum and returned-metric verification', 'research feature snapshot and export', 'SHADOW_CONTEXT', 'OPTIONOMICS_SESSION_RESEARCH', 'RESEARCH_ONLY'),
  data('charm', 'Optionomics charm heatmap', 'optionomics context collector', 'metric-enum and returned-metric verification', 'research feature snapshot and export', 'SHADOW_CONTEXT', 'OPTIONOMICS_SESSION_RESEARCH', 'RESEARCH_ONLY'),
  data('events', 'Optionomics events plus Alpaca calendar/corporate actions', 'normalized-event-evidence and paper-entry-safety-policy', 'provider-known and first-observed PIT adapter', 'Paper event policy, AEGIS context, management', 'HARD_SAFETY', 'THETA_PERSISTED_DECISION', 'PRODUCTION'),
  data('liquidity', 'Alpaca executable BBO', 'trusted-option-quote and execution-quality', 'exact-contract two-sided quote qualification', 'lattice, AEGIS liquidity, sizing, final handoff', 'HARD_SAFETY', 'ALPACA_EXECUTABLE_MARKET', 'PRODUCTION'),
  data('delta', 'Alpaca option snapshot Greeks', 'option-chain-ingestion', 'strict finite signed and absolute delta', 'Q/H/D candidate lattice and cohort research', 'STRUCTURAL_ECONOMICS', 'ALPACA_EXECUTABLE_MARKET', 'PRODUCTION'),
  data('moneyness', 'Alpaca contract and underlying market data', 'option-chain-ingestion', 'strike/spot and OCC identity normalization', 'candidate lattice, IV/spread cohorts', 'STRUCTURAL_ECONOMICS', 'ALPACA_EXECUTABLE_MARKET', 'PRODUCTION'),
  data('spread', 'Alpaca executable bid/ask', 'trusted-option-quote and aegis-spread-stress', 'absolute/relative spread with timestamp lineage', 'executability, AEGIS, sizing, TCA', 'HARD_SAFETY', 'ALPACA_EXECUTABLE_MARKET', 'PRODUCTION'),
  data('OI', 'Alpaca/qualified Optionomics contract observation', 'option-chain-ingestion', 'strict nonnegative integer adapter', 'Q lattice and liquidity diagnostics', 'STRUCTURAL_ECONOMICS', 'THETA_PERSISTED_DECISION', 'PRODUCTION'),
  data('volume', 'Alpaca/qualified Optionomics contract observation', 'option-chain-ingestion', 'strict nonnegative integer adapter', 'Q lattice and liquidity diagnostics', 'STRUCTURAL_ECONOMICS', 'THETA_PERSISTED_DECISION', 'PRODUCTION'),
  data('capital', 'Alpaca Paper account and positions', 'account-exposure and assignment-capacity', 'broker account/collateral derivation', 'AEGIS, constrained sizing, management frontier', 'CAPITAL_AND_SIZING', 'ALPACA_BROKER_LIFECYCLE', 'PRODUCTION'),
  data('max loss', 'Exact contract structure and broker multiplier', 'CSP and defined-risk economics', 'per-share/per-contract/position unit normalization', 'sizing, common-horizon comparison, whole-chain accounting', 'CAPITAL_AND_SIZING', 'THETA_PERSISTED_DECISION', 'PRODUCTION'),
  data('correlation', 'PIT Alpaca stock returns', 'correlation research and account exposure', 'synchronized-return pair coverage', 'AEGIS when applicable and research clustering', 'CAPITAL_AND_SIZING', 'THETA_PERSISTED_DECISION', 'PRODUCTION'),
]);

export type SoftFeatureUse = 'PRODUCTION' | 'SHADOW' | 'RESEARCH_ONLY' | 'PROVIDER_LIMITED';
export interface SoftFeatureUsage {
  readonly family: typeof thetaFeatureFamily.options[number];
  readonly use: SoftFeatureUse;
  readonly consumer: string;
}

export const softFeatureUsageRegistry: readonly SoftFeatureUsage[] = Object.freeze([
  { family: 'LIQUIDITY', use: 'PRODUCTION', consumer: 'lattice, executability, AEGIS, sizing' },
  { family: 'OWNERSHIP', use: 'PRODUCTION', consumer: 'ownership contract and strategy applicability' },
  { family: 'DRAWDOWN_RECOVERY', use: 'PRODUCTION', consumer: 'ownership quality and recovery lifecycle' },
  { family: 'TREND', use: 'PRODUCTION', consumer: 'regime and qualified soft evidence' },
  { family: 'MOMENTUM', use: 'PROVIDER_LIMITED', consumer: 'Optionomics legacy-null capability audit and persisted provider context' },
  { family: 'REALIZED_VOLATILITY', use: 'SHADOW', consumer: 'IV-RV/VRP research evidence' },
  { family: 'IV', use: 'PRODUCTION', consumer: 'AEGIS IV stress and volatility context' },
  { family: 'SKEW', use: 'RESEARCH_ONLY', consumer: 'strategy-quality shadow diagnostics' },
  { family: 'TERM_STRUCTURE', use: 'RESEARCH_ONLY', consumer: 'strategy-quality shadow diagnostics and management context' },
  { family: 'VOLATILITY_SURFACE', use: 'RESEARCH_ONLY', consumer: 'Optionomics research snapshot and export' },
  { family: 'FLOW', use: 'RESEARCH_ONLY', consumer: 'strategy-quality shadow diagnostics and export' },
  { family: 'UNUSUAL_ACTIVITY', use: 'PROVIDER_LIMITED', consumer: 'flow/crowd capability audit, no Paper gate' },
  { family: 'VOLUME_OPEN_INTEREST', use: 'PRODUCTION', consumer: 'Q lattice and liquidity diagnostics' },
  { family: 'EVENT_CONTEXT', use: 'PRODUCTION', consumer: 'Paper event policy and management' },
  { family: 'SECTOR', use: 'PROVIDER_LIMITED', consumer: 'AEGIS applicability audit, never fabricated for missing metadata' },
  { family: 'CORRELATION', use: 'PRODUCTION', consumer: 'AEGIS when multiple risk groups make it applicable' },
  { family: 'PORTFOLIO_EXPOSURE', use: 'PRODUCTION', consumer: 'account exposure, AEGIS, and sizing' },
  { family: 'FUNDAMENTAL_QUALITY', use: 'PROVIDER_LIMITED', consumer: 'ownership capability audit, no Paper hard gate' },
  { family: 'REGIME', use: 'PRODUCTION', consumer: 'strategy applicability router' },
  { family: 'EXECUTION_QUALITY', use: 'PRODUCTION', consumer: 'executability, finalist refresh, and final handoff' },
]);

export interface DecisionDataEvidenceFiles {
  readonly producer: readonly string[];
  readonly normalizer: readonly string[];
  readonly consumer: readonly string[];
}

// Concrete call-graph anchors for every route above. The V18 test verifies that
// every path exists. Runtime behavior is covered separately by the focused
// provider, frontier, AEGIS, sizing, persistence, and replay test groups.
export const decisionDataEvidenceFiles: Readonly<Record<string, DecisionDataEvidenceFiles>> = Object.freeze({
  IV: { producer: ['src/theta/aegis-alpaca-iv-stress.ts'], normalizer: ['src/theta/option-chain-ingestion.ts'], consumer: ['src/theta/aegis-derivation.ts'] },
  RV: { producer: ['src/theta/optionomics-provider.ts'], normalizer: ['src/theta/optionomics-feature-engine.ts'], consumer: ['src/research/volatility-risk-premium.ts'] },
  'IV-RV': { producer: ['src/research/volatility-risk-premium.ts'], normalizer: ['src/research/volatility-risk-premium.ts'], consumer: ['src/research/qualified-soft-feature-evidence.ts'] },
  skew: { producer: ['src/theta/optionomics-feature-engine.ts'], normalizer: ['src/theta/optionomics-feature-engine.ts'], consumer: ['src/research/strategy-quality-shadow-diagnostics.ts'] },
  term: { producer: ['src/theta/optionomics-feature-engine.ts'], normalizer: ['src/theta/optionomics-feature-engine.ts'], consumer: ['src/research/strategy-quality-shadow-diagnostics.ts'] },
  trend: { producer: ['src/theta/ownership-contract.ts'], normalizer: ['src/theta/regime-contract.ts'], consumer: ['src/theta/new-risk-orchestrator.ts'] },
  momentum: { producer: ['src/theta/optionomics-provider.ts'], normalizer: ['src/theta/optionomics-provider.ts'], consumer: ['src/theta/postgres-theta-cycle-store.ts'] },
  flow: { producer: ['src/theta/theta-shadow-cycle.ts'], normalizer: ['src/theta/optionomics-provider.ts'], consumer: ['src/research/strategy-quality-shadow-diagnostics.ts'] },
  GEX: { producer: ['src/theta/theta-shadow-cycle.ts'], normalizer: ['src/theta/optionomics-provider.ts'], consumer: ['src/research/strategy-quality-shadow-diagnostics.ts'] },
  vanna: { producer: ['src/theta/theta-shadow-cycle.ts'], normalizer: ['src/theta/optionomics-provider.ts'], consumer: ['src/research/strategy-quality-shadow-diagnostics.ts'] },
  charm: { producer: ['src/theta/theta-shadow-cycle.ts'], normalizer: ['src/theta/optionomics-provider.ts'], consumer: ['src/research/strategy-quality-shadow-diagnostics.ts'] },
  events: { producer: ['src/theta/normalized-event-evidence.ts'], normalizer: ['src/theta/paper-entry-safety-policy.ts'], consumer: ['src/theta/new-risk-orchestrator.ts'] },
  liquidity: { producer: ['src/execution/trusted-option-quote.ts'], normalizer: ['src/theta/execution-quality-contract.ts'], consumer: ['src/theta/canonical-strategy-frontier.ts'] },
  delta: { producer: ['src/theta/option-chain-ingestion.ts'], normalizer: ['src/theta/option-chain-ingestion.ts'], consumer: ['src/theta/canonical-strategy-frontier.ts'] },
  moneyness: { producer: ['src/theta/option-chain-ingestion.ts'], normalizer: ['src/theta/option-chain-ingestion.ts'], consumer: ['src/theta/canonical-strategy-frontier.ts'] },
  spread: { producer: ['src/execution/trusted-option-quote.ts'], normalizer: ['src/theta/aegis-spread-stress.ts'], consumer: ['src/theta/canonical-strategy-frontier.ts'] },
  OI: { producer: ['src/theta/option-chain-ingestion.ts'], normalizer: ['src/theta/option-chain-ingestion.ts'], consumer: ['src/theta/canonical-strategy-frontier.ts'] },
  volume: { producer: ['src/theta/option-chain-ingestion.ts'], normalizer: ['src/theta/option-chain-ingestion.ts'], consumer: ['src/theta/canonical-strategy-frontier.ts'] },
  capital: { producer: ['src/theta/account-exposure.ts'], normalizer: ['src/theta/account-exposure.ts'], consumer: ['src/theta/sizing-contract.ts'] },
  'max loss': { producer: ['src/research/defined-risk-economics.ts'], normalizer: ['src/research/defined-risk-economics.ts'], consumer: ['src/theta/canonical-strategy-frontier.ts', 'src/theta/whole-chain-economics.ts'] },
  correlation: { producer: ['src/theta/correlation-evidence.ts'], normalizer: ['src/theta/portfolio-correlation-evidence.ts'], consumer: ['src/theta/account-exposure.ts'] },
});

export const unresolvedSystemState = Object.freeze({
  CODE_SOLVABLE: ['V18_SELF_CERTIFICATION_SUPERSEDED_BY_V19'] as readonly string[],
  FORWARD_DATA_REQUIRED: [
    'CURRENT_SESSION_Q_H_D_MARKET_VALUES', 'NEXT_IV_INDEPENDENT_SESSION', 'NEXT_SPREAD_INDEPENDENT_SESSION',
    'REAL_ASSIGNMENT_RECOVERY_OUTCOME', 'REAL_COVERED_CALL_OUTCOME',
  ],
  PROVIDER_LIMITED: ['CORPORATE_ACTION_NEGATIVE_ASSURANCE', 'COMPLETE_PROSPECTIVE_COMPANY_EVENT_COVERAGE'],
  EMPIRICALLY_UNPROVEN: [
    'ENTRY_AFTER_COST_EV', 'MANAGED_EPISODE_POP', 'EXPECTED_SHORTFALL', 'MANAGEMENT_CONTINUATION_VALUE',
    'BEST_PROFIT_TAKING_POLICY', 'BEST_LOSS_ACTION', 'BEST_ROLL_POLICY', 'CROSS_STRATEGY_EMPIRICAL_UTILITY',
    'SEVENTY_TO_EIGHTY_PERCENT_MANAGED_WIN_RATE', 'PROFITABILITY',
  ],
  STRUCTURAL_POLICY_INCOMPATIBILITY: ['SPY_SINGLE_CSP_MAY_EXCEED_15_PERCENT_TICKER_CONCENTRATION_CAP'],
  OWNER_PERMISSION_REQUIRED: ['R8G_FIRST_PAPER_AUTHORIZATION', 'FOLLOWER_EXECUTION', 'LIVE_MONEY'],
  NOT_APPLICABLE: ['RECOVERY_WITHOUT_ASSIGNED_STOCK', 'COVERED_CALL_WITHOUT_COVERED_SHARES'],
});

export function buildV18FinalAcceptanceReceipt(input: {
  readonly duplicateConfigAuthorities?: readonly string[];
  readonly conflictingConfigValues?: readonly string[];
} = {}) {
  const config = auditPresessionConfiguration();
  const duplicateConfigAuthorities = input.duplicateConfigAuthorities ?? [];
  const conflictingConfigValues = input.conflictingConfigValues ?? [];
  const dataWithoutProvenance = decisionDataRoutes.filter((item) => !item.source || !item.producer || !item.normalizer);
  const dataWithoutConsumer = decisionDataRoutes.filter((item) => !item.consumer);
  const mappedSoftFeatures = new Set(softFeatureUsageRegistry.map((item) => item.family));
  const declaredButUnused = [
    ...decisionDataRoutes.filter((item) => !item.consumer || !item.executionUse).map((item) => item.feature),
    ...thetaFeatureFamily.options.filter((family) => !mappedSoftFeatures.has(family)),
  ];
  const strategyMissing = Object.entries(fiveStrategyEngineeringMatrix)
    .flatMap(([strategy, item]) => Object.entries(item).filter(([, state]) => state === 'MISSING')
      .map(([dimension]) => [strategy, dimension] as const));
  const pass = config.state === 'PASS' && config.unregisteredFields.length === 0
    && duplicateConfigAuthorities.length === 0 && conflictingConfigValues.length === 0
    && declaredButUnused.length === 0 && dataWithoutProvenance.length === 0 && dataWithoutConsumer.length === 0
    && strategyMissing.length === 0 && unresolvedSystemState.CODE_SOLVABLE.length === 0;
  return {
    contractVersion: v18FinalAcceptanceVersion,
    CONFIG_FIELDS_TOTAL: decisionCriticalConfigurationFields.length,
    CONFIG_FIELDS_CANONICAL: presessionConfigurationRegistry.length,
    UNREGISTERED_DECISION_CRITICAL_CONFIG: config.unregisteredFields,
    DUPLICATE_CONFIG_AUTHORITIES: duplicateConfigAuthorities,
    CONFLICTING_CONFIG_VALUES: conflictingConfigValues,
    DECLARED_BUT_UNUSED_DECISION_DATA: declaredButUnused,
    DATA_WITHOUT_PROVENANCE: dataWithoutProvenance.map((item) => item.feature),
    DATA_WITHOUT_CONSUMER: dataWithoutConsumer.map((item) => item.feature),
    decisionDataRoutes,
    softFeatureUsageRegistry,
    strategyEngineeringDimensions,
    strategyEngineering: fiveStrategyEngineeringMatrix,
    Q_ENGINEERING: strategyMissing.some(([name]) => name === 'Q') ? 'FAIL' : 'PASS',
    H_ENGINEERING: strategyMissing.some(([name]) => name === 'H') ? 'FAIL' : 'PASS',
    D_ENGINEERING: strategyMissing.some(([name]) => name === 'D') ? 'FAIL' : 'PASS',
    A_ENGINEERING: strategyMissing.some(([name]) => name === 'A') ? 'FAIL' : 'PASS',
    C_ENGINEERING: strategyMissing.some(([name]) => name === 'C') ? 'FAIL' : 'PASS',
    WITHIN_Q_SELECTION: 'REAL', WITHIN_H_SELECTION: 'REAL', WITHIN_D_SELECTION: 'REAL',
    CROSS_STRATEGY_STRUCTURAL_COMPARISON: 'REAL',
    CROSS_STRATEGY_EMPIRICAL_COMPARISON: 'NOT_READY',
    CROSS_STRATEGY_PROFITABILITY_WINNER: 'EMPIRICALLY_UNPROVEN',
    deterministicAccountAlternatives: {
      Q: { marketApplicability: 'FORWARD_DATA_REQUIRED', accountFeasibility: 'REAL_POLICY_EVALUATION',
        currentKnownConstraint: 'SPY_SINGLE_CSP_MAY_EXCEED_15_PERCENT_TICKER_CONCENTRATION_CAP' },
      D: { marketApplicability: 'FORWARD_DATA_REQUIRED', accountFeasibility: 'REAL_POLICY_EVALUATION',
        bestStructuralPair: 'FORWARD_DATA_REQUIRED', maxLoss: 'REAL_WHEN_PAIR_EXISTS', allocation: 'REAL_WHEN_PAIR_EXISTS',
        liquidity: 'FORWARD_DATA_REQUIRED', aegis: 'REAL_WHEN_EVIDENCE_EXISTS', quantity: 'REAL_WHEN_EVIDENCE_EXISTS' },
      WAIT: { alternative: 'REAL', comparisonRole: 'KNOWN_ZERO_CAPITAL_COMMITMENT_WITHOUT_PROFITABILITY_CLAIM' },
    },
    AEGIS_COMPLETE: 'NOT_CERTIFIED_USE_V19', SIZING_COMPLETE: 'NOT_CERTIFIED_USE_V19',
    MANAGEMENT_COMPLETE: 'NOT_CERTIFIED_USE_V19', WHOLE_CHAIN_ACCOUNTING_COMPLETE: 'NOT_CERTIFIED_USE_V19',
    unresolved: unresolvedSystemState,
    counts: Object.fromEntries(Object.entries(unresolvedSystemState).map(([key, value]) => [key, value.length])),
    GENERIC_ENGINEERING_UNKNOWN: 0, GENERIC_DECISION_UNKNOWN: 0, GENERIC_WAIT: 0,
    REMAINING_CODE_SOLVABLE_BLOCKERS: unresolvedSystemState.CODE_SOLVABLE,
    PRESESSION_ZERO_WEAKNESS_CERTIFICATION: pass ? 'PASS' : 'FAIL',
    ORDER_SUBMISSIONS: 0, BROKER_MUTATIONS: 0, FOLLOWERS: 'LOCKED', LIVE_MONEY: 'NOT_AUTHORIZED',
  } as const;
}
