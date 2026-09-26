import { entryModelFamilies } from '../research/theta-entry-model-readiness.js';
import { canonicalV7ProfitTakingPolicies } from '../research/profit-taking-experiment.js';
import { canonicalThetaStrategySources, thetaFeatureFamily, thetaHardRule, thetaStrategyAction } from './strategy-package.js';

export const profitabilityBrainRealityVersion = 'theta-profitability-brain-reality-v4' as const;

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

export interface FiveStrategyRealityRow {
  readonly branch: 'THETA_CONVENTIONAL' | 'THETA_HOLD_STRIKE' | 'THETA_DEFINED_RISK' | 'THETA_RECOVERY' | 'THETA_CC';
  readonly role: 'NEW_RISK' | 'INVENTORY_LIFECYCLE';
  readonly authority: BrainMethodAuthority;
  readonly candidateProducer: string;
  readonly canonicalConsumer: string;
  readonly persistence: string;
  readonly lockedPlan: string;
  readonly management: string;
  readonly outcomeLinkage: string;
  readonly level: RealityLevel;
  readonly currentLimitation: string;
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
  method('DEFINED_RISK_LOCKED_MULTI_LEG_PLAN', 'EXECUTION', 'RESEARCH_ONLY', 6,
    ['src/research/defined-risk-locked-plan.ts', 'src/theta/canonical-strategy-frontier.ts',
      'src/theta/postgres-theta-cycle-store.ts'],
    'The exact two-leg plan is persisted and runtime-reachable but remains structurally non-submittable. Alpaca Level 3 MLeg capability is classified, while a THETA mutation adapter is intentionally absent.'),
  method('DEFINED_RISK_MANAGEMENT_REPLAY', 'MANAGEMENT', 'RESEARCH_ONLY', 3,
    ['src/research/defined-risk-management-replay.ts', 'src/research/profit-taking-replay.ts'],
    'All 17 challenger policies run on conservative two-leg close quotes. Real spread episodes and strategy-specific policy promotion remain absent.'),
  method('RECOVERY_CANDIDATE_ENUMERATION', 'CANDIDATE_ENUMERATION', 'PRODUCTION_LOCKED', 6,
    ['src/theta/canonical-strategy-frontier.ts', 'src/theta/production-paper-management-candidate-source.ts']),
  method('COVERED_CALL_CANDIDATE_ENUMERATION', 'CANDIDATE_ENUMERATION', 'PRODUCTION_LOCKED', 6,
    ['src/theta/covered-call-lattice.ts', 'src/theta/production-paper-management-candidate-source.ts']),
  method('Q_STRUCTURAL_ECONOMIC_DECISION', 'ECONOMICS', 'PRODUCTION_LOCKED', 6,
    ['bots/theta/quant/models/theta_q_baseline.py', 'src/theta/decision-assembly.ts'],
    'Expected after-cost EV remains unavailable until resolved whole-chain outcomes exist.'),
  method('CROSS_STRATEGY_COMMON_HORIZON_COMPARATOR', 'ECONOMICS', 'SHADOW', 6,
    ['src/research/cross-strategy-common-horizon-contract.ts', 'src/theta/canonical-shadow-comparison.ts',
      'src/theta/canonical-strategy-frontier.ts', 'src/theta/postgres-theta-cycle-store.ts'],
    'No calibrated common-horizon Q/H/D utility or sufficient independent OOS outcomes.'),
  method('ADAPTIVE_SHADOW_STRUCTURE_COMPARISON', 'SELECTION', 'SHADOW', 6,
    ['src/theta/adaptive-decision-brain.ts', 'src/theta/canonical-shadow-comparison.ts', 'src/theta/postgres-theta-cycle-store.ts'],
    'Structural Pareto comparison is reachable and persistence-tested, but not a learned economic strategy switch.'),
  method('ADAPTIVE_ECONOMIC_STRATEGY_SWITCHING', 'SELECTION', 'RESEARCH_ONLY', 1,
    ['src/theta/adaptive-decision-brain.ts'],
    'Only an applicability router and a non-authoritative utility contract exist. No adaptive switching policy is implemented.'),
  method('AEGIS_RISK_PERMISSION', 'RISK', 'PRODUCTION_LOCKED', 6,
    ['bots/theta/quant/models/aegis.py', 'src/theta/aegis-derivation.ts']),
  method('CONSTRAINED_QUANTITY_SIZING', 'SIZING', 'PRODUCTION_LOCKED', 6,
    ['bots/theta/quant/models/sizing.py', 'src/theta/canonical-strategy-frontier.ts']),
  // Phase 1 Zero-Unknown Reclosure Pass 2: sourceEvidence corrected after
  // exact call-graph trace. The REAL, actual selector is
  // buildCanonicalStrategyFrontier's own internal `structuralSelection`
  // computation (canonical-strategy-frontier.ts:740,
  // `selectedCandidateId: structuralSelection?.candidateId ?? null`) --
  // computed unconditionally, synchronously, every time the frontier is
  // built, with zero Postgres/network dependency. master-paper-plan-
  // assembly.ts:59 confirms this by reading `frontier.selectedCandidateId`
  // directly, never through any intermediary. `canonical-decision-
  // authority.ts`'s `resolveCanonicalDecisionAuthority` was previously
  // listed here too, but traced this pass to have exactly one real caller
  // (`postgres-theta-cycle-store.ts:598`) -- it runs ONLY during Postgres
  // persistence, reconciling the frontier's already-made selection against
  // the separate subordinate/legacy receipt. It is a downstream validation/
  // handoff step, not independent selection logic, and it did NOT execute
  // during the real Sep24 cycles (Postgres was down that day,
  // `postgres_state: SPOOLED_LOCAL_PENDING_DB` throughout). Conflating the
  // two under one methodId would have let a frontier-only cycle (no
  // Postgres reached) wrongly claim L7 proof for a persistence-time-only
  // function that never ran. See CANONICAL_DECISION_HANDOFF_VALIDATION
  // below for that function's own, correctly-scoped entry.
  method('CANONICAL_ENTRY_SELECTION', 'SELECTION', 'PRODUCTION_LOCKED', 6,
    ['src/theta/canonical-strategy-frontier.ts', 'src/execution/master-paper-plan-assembly.ts']),
  method('CANONICAL_DECISION_HANDOFF_VALIDATION', 'SELECTION', 'PRODUCTION_LOCKED', 6,
    ['src/theta/canonical-decision-authority.ts', 'src/theta/postgres-theta-cycle-store.ts'],
    'Persistence-time reconciliation only -- runs solely inside postgres-theta-cycle-store.ts, requires a live Postgres write; never independently selects, only confirms the frontier\'s own selection is not silently overridden by the subordinate/legacy receipt.'),
  method('MANAGEMENT_CANDIDATE_DISCOVERY', 'MANAGEMENT', 'PRODUCTION_LOCKED', 6,
    ['src/theta/production-paper-management-candidate-source.ts']),
  method('MANAGEMENT_ACTION_FRONTIER', 'MANAGEMENT', 'PRODUCTION_LOCKED', 6,
    ['src/theta/management-action-frontier.ts', 'src/theta/paper-bootstrap-management-policy.ts'],
    'Forward continuation EV, tail distribution, and opportunity-cost coefficients are empirically unproven.'),
  method('LOSS_ACTION_COMMON_HORIZON_COMPARATOR', 'MANAGEMENT', 'RESEARCH_ONLY', 3,
    ['src/research/loss-roll-experiment.ts']),
  method('PROFIT_TAKING_CHALLENGER_GRID', 'MANAGEMENT', 'RESEARCH_ONLY', 4,
    ['src/research/profit-taking-experiment.ts', 'src/research/profit-taking-replay.ts', 'tools/theta-profit-taking-replay.ts'],
    'Offline dispatcher executes all 17 policies. Real managed episodes and calibrated continuation forecasts remain required.'),
  method('WHOLE_CHAIN_RESEARCH_DATASET', 'LEARNING', 'RESEARCH_ONLY', 5,
    ['bots/theta/quant/research/whole_chain_dataset.py', 'bots/theta/quant/research/empirical_pipeline.py'],
    'Explicit CSP entry links and bounded BBO feature joins are persisted. Real resolved episodes and richer qualified features remain required.'),
  method('SELECTED_CSP_ENTRY_BASELINE_AND_ABLATION', 'LEARNING', 'RESEARCH_ONLY', 5,
    ['bots/theta/quant/research/entry_episode_training.py', 'bots/theta/quant/research/entry_baseline_experiment.py',
      'bots/theta/quant/research/entry_feature_ablation.py', 'bots/theta/quant/research/empirical_pipeline.py'],
    'Offline selected-entry fitting, calibration and paired predictive ablation are integrated. No real fitted model, OOS economic proof or promotion.'),
  method('CONTROLLED_OUTCOME_EXPERIMENT_EXECUTION', 'LEARNING', 'RESEARCH_ONLY', 5,
    ['bots/theta/quant/research/controlled_experiment.py', 'bots/theta/quant/research/empirical_pipeline.py'],
    'Paired outcome analysis is executable and persisted. Treatment replay and real paired exports are not yet automatic.'),
  method('PURGED_CALIBRATION_VALIDATION_EXECUTION', 'LEARNING', 'RESEARCH_ONLY', 5,
    ['bots/theta/quant/research/validation.py', 'bots/theta/quant/research/validation_experiment.py'],
    'Offline calibration and forward metrics execute from identified predictions. Base-model training and dataset-bound joins remain separate.'),
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

/**
 * One source-level row for each product strategy. This is intentionally a
 * reality map, not an authorization list. L7 and above require runtime or
 * empirical evidence and are never inferred from source files.
 */
export const fiveStrategyRealityMatrix: readonly FiveStrategyRealityRow[] = [
  {
    branch: 'THETA_CONVENTIONAL', role: 'NEW_RISK', authority: 'PRODUCTION_LOCKED',
    candidateProducer: 'theta_q_lattice.py + canonical-strategy-frontier.ts',
    canonicalConsumer: 'canonical-decision-authority.ts',
    persistence: 'canonical frontier, relational candidate evidence, decision receipt',
    lockedPlan: 'master-paper-plan-assembly.ts, single-leg OPEN_CSP only',
    management: 'PaperBootstrapManagementPolicyProvider via canonical management frontier',
    outcomeLinkage: 'whole-chain ledger and outcome resolver', level: 'L6_RUNTIME_REACHABLE',
    currentLimitation: 'Current-worker open-session proof and resolved empirical profitability remain required.',
  },
  {
    branch: 'THETA_HOLD_STRIKE', role: 'NEW_RISK', authority: 'RESEARCH_ONLY',
    candidateProducer: '2-5 DTE canonical frontier plus hold-strike shadow generator',
    canonicalConsumer: 'shadow common-horizon comparator only',
    persistence: 'canonical frontier and relational candidate evidence',
    lockedPlan: 'No broker-authorized plan. Candidate receipt remains shadow-only.',
    management: 'Replay challengers only, no promoted strategy-specific management policy',
    outcomeLinkage: 'research outcome subject and whole-chain dataset when future labels resolve',
    level: 'L6_RUNTIME_REACHABLE',
    currentLimitation: 'Independent real-session outcomes and OOS promotion evidence are absent.',
  },
  {
    branch: 'THETA_DEFINED_RISK', role: 'NEW_RISK', authority: 'RESEARCH_ONLY',
    candidateProducer: 'same-expiry put-pair enumeration with real two-leg BBO and bounded economics',
    canonicalConsumer: 'shadow common-horizon comparator only',
    persistence: 'canonical frontier includes one bounded locked-plan receipt plus relational leg/economics evidence',
    lockedPlan: 'defined-risk-locked-plan.ts, exact two-leg, brokerAuthority=false, submissionAllowed=false',
    management: 'All 17 profit challengers run on two-leg close economics. Expiry, pin, and short-assignment states are typed.',
    outcomeLinkage: 'defined-risk paired-study and whole-chain research datasets', level: 'L6_RUNTIME_REACHABLE',
    currentLimitation: 'The runtime mutation adapter is intentionally absent. Live two-leg episode proof, empirically governed loss actions, and promotion are unresolved.',
  },
  {
    branch: 'THETA_RECOVERY', role: 'INVENTORY_LIFECYCLE', authority: 'PRODUCTION_LOCKED',
    candidateProducer: 'broker-confirmed stock state plus ProductionPaperManagementCandidateSource',
    canonicalConsumer: 'PaperBootstrapManagementPolicyProvider and management-action-frontier',
    persistence: 'management snapshots, candidates, decisions, plans, and whole-chain ledger',
    lockedPlan: 'SELL_STOCK or SELL_CC management plan only when broker-confirmed inventory makes it applicable',
    management: 'RECOVERY_WAIT versus SELL_STOCK versus SELL_CC',
    outcomeLinkage: 'whole-chain realized and unresolved lifecycle accounting', level: 'L6_RUNTIME_REACHABLE',
    currentLimitation: 'No current inventory exists, so current-worker lifecycle proof is forward-state dependent.',
  },
  {
    branch: 'THETA_CC', role: 'INVENTORY_LIFECYCLE', authority: 'PRODUCTION_LOCKED',
    candidateProducer: 'broker-confirmed covered shares plus ProductionPaperManagementCandidateSource',
    canonicalConsumer: 'PaperBootstrapManagementPolicyProvider and management-action-frontier',
    persistence: 'management snapshots, candidates, grouped plans, and whole-chain ledger',
    lockedPlan: 'OPEN_CC, CLOSE_CC, ROLL_CC, or call-away lifecycle receipt when applicable',
    management: 'HOLD_CC versus CLOSE_CC versus ROLL_CC versus ALLOW_CALL_AWAY',
    outcomeLinkage: 'whole-chain covered-call and call-away accounting', level: 'L6_RUNTIME_REACHABLE',
    currentLimitation: 'No current covered inventory exists, so current-worker lifecycle proof is forward-state dependent.',
  },
] as const;

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
  readonly fiveStrategyRealityMatrix: readonly FiveStrategyRealityRow[];
}

// Phase 1 reclosure (THETA-BRAIN-L7-CALLER-GAP): buildProfitabilityBrainRealityReceipt
// has always accepted real evidence as input (currentWorkerRealData: readonly
// string[]) -- the gap was never that this function couldn't express L7, it
// was that no production caller ever derived and supplied that evidence
// list. This function is that real, evidence-conservative derivation: it
// inspects an ACTUAL ThetaShadowCycleResult-shaped object (the canonical
// brain's own real output type, imported structurally here via a minimal
// Pick to avoid a circular import with theta-shadow-cycle.ts) and returns
// only methodIds it can positively justify from real, present fields --
// never from an absence, and never a methodId whose family the frontier
// doesn't actually show evidence for. This is deliberately conservative:
// under-claiming (a real method that ran but isn't detected) is safe;
// over-claiming (a methodId marked real when it didn't run) is not.
export interface RealCycleEvidenceShape {
  readonly strategyFrontier: {
    readonly branches: readonly {
      readonly branch: string;
      readonly evaluated: boolean;
      readonly candidates: readonly { readonly aegisState: unknown; readonly sizing: { readonly quantity: number } }[];
    }[];
    readonly selectedCandidateId: string | null;
  } | null;
}

export function deriveRealCurrentWorkerEvidence(result: RealCycleEvidenceShape): readonly string[] {
  const frontier = result.strategyFrontier;
  if (frontier === null) return [];
  const found = new Set<string>();
  // The frontier itself only exists once routing/applicability and the
  // current decision state have genuinely been evaluated for this cycle.
  found.add('CURRENT_DECISION_STATE');
  found.add('STRATEGY_APPLICABILITY_ROUTER');
  // Selection authority (resolveCanonicalDecisionAuthority) always runs
  // once a real frontier exists -- its result may be null (no candidate),
  // which is itself real evidence the selection method executed.
  found.add('CANONICAL_ENTRY_SELECTION');
  for (const branch of frontier.branches) {
    if (!branch.evaluated) continue;
    if (branch.branch === 'THETA_CONVENTIONAL') {
      found.add('CONVENTIONAL_CANDIDATE_ENUMERATION');
      if (branch.candidates.length > 0) found.add('Q_STRUCTURAL_ECONOMIC_DECISION');
    }
    if (branch.branch === 'THETA_RECOVERY') found.add('RECOVERY_CANDIDATE_ENUMERATION');
    if (branch.branch === 'THETA_CC') found.add('COVERED_CALL_CANDIDATE_ENUMERATION');
    for (const candidate of branch.candidates) {
      if (candidate.aegisState !== null && candidate.aegisState !== undefined) found.add('AEGIS_RISK_PERMISSION');
      if (typeof candidate.sizing?.quantity === 'number') found.add('CONSTRAINED_QUANTITY_SIZING');
    }
  }
  // Only ever return methodIds that are actually registered -- a defensive
  // guard against this function's own logic ever inventing an unregistered
  // methodId string by typo.
  const registered = new Set(profitabilityBrainMethodRegistry.map((item) => item.methodId));
  return [...found].filter((id) => registered.has(id)).toSorted();
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
    fiveStrategyRealityMatrix,
  };
}
