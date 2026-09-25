/**
 * COMMAND 5C-7 item 5. Machine-readable research completion registry.
 * Seeded from a real survey of `src/research/` (106 files) and
 * `bots/theta/quant/research/` at commit time -- NOT a narrative
 * checklist. This registry records the highest-priority capabilities this
 * directive named; it is a living registry, not an exhaustive catalogue of
 * every one of the 106+ files (that would be padding, not signal -- most
 * of those files are themselves the `sourceFiles` entries below).
 *
 * The registry must never claim `EMPIRICAL_VALIDATION`-equivalent states
 * merely because code exists -- every `implementationState` below tops
 * out at `INTEGRATED_RESEARCH`; nothing here is `WAITING_REAL_DATA`'s
 * downstream empirical claim.
 */

export const researchCompletionRegistryVersion = 'theta-research-completion-registry-v1' as const;

export type CapabilityImplementationState =
  | 'NOT_STARTED' | 'CONTRACT_ONLY' | 'IMPLEMENTED' | 'TESTED'
  | 'INTEGRATED_RESEARCH' | 'WAITING_RUNTIME_INPUT' | 'WAITING_REAL_DATA' | 'OWNER_GATED' | 'SUPERSEDED';

export interface ResearchCapabilityRecord {
  readonly contractVersion: typeof researchCompletionRegistryVersion;
  readonly capabilityId: string;
  readonly domain: string;
  readonly owner: 'CLAUDE' | 'CODEX' | 'SHARED';
  readonly sourceFiles: readonly string[];
  readonly consumerFiles: readonly string[];
  readonly implementationState: CapabilityImplementationState;
  readonly testState: 'NONE' | 'FIXTURE_TESTED' | 'ADVERSARIAL_TESTED';
  readonly runtimeDependency: string | null;
  readonly dataDependency: string | null;
  readonly promotionDependency: string | null;
  readonly knownUnknowns: readonly string[];
  readonly lastVerifiedSha: string;
}

const SHA = '9ad1c15d6596475af862d88fb35a637324050819';

export const RESEARCH_COMPLETION_REGISTRY: readonly ResearchCapabilityRecord[] = [
  {
    contractVersion: researchCompletionRegistryVersion, capabilityId: 'TRUTH_TAXONOMY', domain: 'IDENTIFIABILITY',
    owner: 'CLAUDE', sourceFiles: ['src/research/empirical-identifiability-taxonomy.ts'],
    consumerFiles: ['src/research/strategy-choice-outcome-builder.ts', 'src/research/contract-path-outcome-dataset.ts'],
    implementationState: 'INTEGRATED_RESEARCH', testState: 'ADVERSARIAL_TESTED', runtimeDependency: null, dataDependency: null,
    promotionDependency: null, knownUnknowns: [], lastVerifiedSha: SHA,
  },
  {
    contractVersion: researchCompletionRegistryVersion, capabilityId: 'UNKNOWN_VALUE_TAXONOMY', domain: 'UNKNOWN_CLOSURE',
    owner: 'CLAUDE', sourceFiles: ['src/research/unknown-value-taxonomy.ts'],
    consumerFiles: [], implementationState: 'IMPLEMENTED', testState: 'NONE', runtimeDependency: null, dataDependency: null,
    promotionDependency: null, knownUnknowns: ['no consumer wired into per-family unknown audits yet -- see UNKNOWN_AUDIT_FILTER_VALUE'], lastVerifiedSha: SHA,
  },
  {
    contractVersion: researchCompletionRegistryVersion, capabilityId: 'MODEL_REGISTRY_CONTRACT', domain: 'MODEL_LIFECYCLE',
    owner: 'CLAUDE', sourceFiles: ['src/research/empirical-model-registry.ts'],
    consumerFiles: ['src/storage/research-durable-store.ts'], implementationState: 'INTEGRATED_RESEARCH', testState: 'ADVERSARIAL_TESTED',
    runtimeDependency: null, dataDependency: null, promotionDependency: 'baselineModelId required for challenger tiers (already enforced in-module)',
    knownUnknowns: [], lastVerifiedSha: SHA,
  },
  {
    contractVersion: researchCompletionRegistryVersion, capabilityId: 'MODEL_REGISTRY_DURABLE_PERSISTENCE', domain: 'MODEL_LIFECYCLE',
    owner: 'CLAUDE', sourceFiles: ['src/storage/research-durable-store.ts'],
    consumerFiles: [], implementationState: 'IMPLEMENTED', testState: 'ADVERSARIAL_TESTED', runtimeDependency: null, dataDependency: null,
    promotionDependency: null, knownUnknowns: [], lastVerifiedSha: SHA,
  },
  {
    contractVersion: researchCompletionRegistryVersion, capabilityId: 'SELECTION_BIAS_DSR_PBO', domain: 'STATISTICAL_RIGOR',
    owner: 'CLAUDE', sourceFiles: ['bots/theta/quant/research/selection_bias.py', 'bots/theta/quant/research/selection_bias_runner.py', 'src/research/selection-bias-receipt.ts', 'src/research/return-normalization.ts'],
    consumerFiles: ['src/storage/research-durable-store.ts'], implementationState: 'INTEGRATED_RESEARCH', testState: 'ADVERSARIAL_TESTED',
    runtimeDependency: null, dataDependency: 'real per-trial return series (currently only synthetic fixtures exercised)',
    promotionDependency: null, knownUnknowns: [], lastVerifiedSha: SHA,
  },
  {
    contractVersion: researchCompletionRegistryVersion, capabilityId: 'RETURN_NORMALIZATION', domain: 'STATISTICAL_RIGOR',
    owner: 'CLAUDE', sourceFiles: ['src/research/return-normalization.ts'],
    consumerFiles: ['bots/theta/quant/research/selection_bias_runner.py'], implementationState: 'IMPLEMENTED', testState: 'NONE',
    runtimeDependency: null, dataDependency: null, promotionDependency: null, knownUnknowns: [], lastVerifiedSha: SHA,
  },
  {
    contractVersion: researchCompletionRegistryVersion, capabilityId: 'DEPENDENCE_GROUPING', domain: 'VALIDATION',
    owner: 'CLAUDE', sourceFiles: ['src/research/dependence-grouping-contract.ts'], consumerFiles: [],
    implementationState: 'INTEGRATED_RESEARCH', testState: 'ADVERSARIAL_TESTED', runtimeDependency: null, dataDependency: null,
    promotionDependency: null, knownUnknowns: [], lastVerifiedSha: SHA,
  },
  {
    contractVersion: researchCompletionRegistryVersion, capabilityId: 'PURGE_EMBARGO', domain: 'VALIDATION',
    owner: 'CLAUDE', sourceFiles: ['src/research/purge-embargo-contract.ts'], consumerFiles: [],
    implementationState: 'INTEGRATED_RESEARCH', testState: 'ADVERSARIAL_TESTED', runtimeDependency: null, dataDependency: null,
    promotionDependency: null, knownUnknowns: [], lastVerifiedSha: SHA,
  },
  {
    contractVersion: researchCompletionRegistryVersion, capabilityId: 'PIT_VALIDATION_LIBRARY', domain: 'VALIDATION',
    owner: 'CLAUDE', sourceFiles: ['src/research/point-in-time-evidence.ts', 'src/research/reconstructed-provenance.ts'],
    consumerFiles: ['src/research/entry-unit-separation.ts', 'src/storage/research-durable-store.ts'],
    implementationState: 'INTEGRATED_RESEARCH', testState: 'ADVERSARIAL_TESTED', runtimeDependency: null, dataDependency: null,
    promotionDependency: null, knownUnknowns: ['no single end-to-end whole-dataset leakage-firewall runner yet -- see PIT_LEAKAGE_FIREWALL_RUNNER'], lastVerifiedSha: SHA,
  },
  {
    contractVersion: researchCompletionRegistryVersion, capabilityId: 'DECISION_CANDIDATE_DATASET', domain: 'DATASET_CONTRACT',
    owner: 'CLAUDE', sourceFiles: ['src/research/entry-unit-separation.ts'], consumerFiles: [],
    implementationState: 'CONTRACT_ONLY', testState: 'ADVERSARIAL_TESTED', runtimeDependency: 'no adapter yet turning canonical export rows into this contract',
    dataDependency: null, promotionDependency: null, knownUnknowns: ['adapter from postgres-theta-cycle-store.ts export -> this contract not yet built'], lastVerifiedSha: SHA,
  },
  {
    contractVersion: researchCompletionRegistryVersion, capabilityId: 'WHOLE_CHAIN_OUTCOME_BUILDER', domain: 'DATASET_CONTRACT',
    owner: 'CLAUDE', sourceFiles: ['src/research/whole-chain-outcome-builder.ts'], consumerFiles: [],
    implementationState: 'INTEGRATED_RESEARCH', testState: 'ADVERSARIAL_TESTED', runtimeDependency: 'reuses whole-chain-economics.ts arithmetic (Codex-owned) read-only',
    dataDependency: 'zero real resolved whole chains exist yet', promotionDependency: null, knownUnknowns: [], lastVerifiedSha: SHA,
  },
  {
    contractVersion: researchCompletionRegistryVersion, capabilityId: 'MANAGEMENT_RETURN_TO_GO', domain: 'DATASET_CONTRACT',
    owner: 'CLAUDE', sourceFiles: ['src/research/management-return-to-go.ts'], consumerFiles: [],
    implementationState: 'INTEGRATED_RESEARCH', testState: 'ADVERSARIAL_TESTED', runtimeDependency: null,
    dataDependency: 'zero real management decisions resolved yet', promotionDependency: null, knownUnknowns: [], lastVerifiedSha: SHA,
  },
  {
    contractVersion: researchCompletionRegistryVersion, capabilityId: 'ASSIGNMENT_LABEL_BUILDER', domain: 'DATASET_CONTRACT',
    owner: 'CLAUDE', sourceFiles: ['src/research/assignment-label-builder.ts'], consumerFiles: [],
    implementationState: 'INTEGRATED_RESEARCH', testState: 'ADVERSARIAL_TESTED', runtimeDependency: null, dataDependency: 'zero real assignments observed yet',
    promotionDependency: null, knownUnknowns: [], lastVerifiedSha: SHA,
  },
  {
    contractVersion: researchCompletionRegistryVersion, capabilityId: 'RECOVERY_SURVIVAL_DATASET', domain: 'DATASET_CONTRACT',
    owner: 'CLAUDE', sourceFiles: ['src/research/recovery-survival-dataset.ts'], consumerFiles: [],
    implementationState: 'INTEGRATED_RESEARCH', testState: 'ADVERSARIAL_TESTED', runtimeDependency: null, dataDependency: 'zero real assigned-stock episodes exist yet',
    promotionDependency: null, knownUnknowns: ['no Kaplan-Meier baseline estimator wired to this dataset yet'], lastVerifiedSha: SHA,
  },
  {
    contractVersion: researchCompletionRegistryVersion, capabilityId: 'EXECUTION_DATASET', domain: 'DATASET_CONTRACT',
    owner: 'CLAUDE', sourceFiles: ['src/research/execution-dataset-contract.ts'], consumerFiles: [],
    implementationState: 'CONTRACT_ONLY', testState: 'NONE', runtimeDependency: 'no fill-probability baseline model wired yet',
    dataDependency: 'zero real fills exist yet', promotionDependency: null, knownUnknowns: [], lastVerifiedSha: SHA,
  },
  {
    contractVersion: researchCompletionRegistryVersion, capabilityId: 'WAIT_DATASET', domain: 'DATASET_CONTRACT',
    owner: 'CLAUDE', sourceFiles: ['src/research/wait-regret-dataset.ts', 'src/research/wait-strategy-alternatives-extension.ts', 'src/research/false-inactivity-taxonomy.ts'],
    consumerFiles: [], implementationState: 'INTEGRATED_RESEARCH', testState: 'ADVERSARIAL_TESTED', runtimeDependency: null,
    dataDependency: 'real WAIT decisions with observed-parallel outcomes remain rare', promotionDependency: null, knownUnknowns: [], lastVerifiedSha: SHA,
  },
  {
    contractVersion: researchCompletionRegistryVersion, capabilityId: 'STRATEGY_COMPARISON_DATASET', domain: 'DATASET_CONTRACT',
    owner: 'CLAUDE', sourceFiles: ['src/research/strategy-choice-outcome-builder.ts', 'src/research/cross-strategy-common-horizon-contract.ts', 'src/research/primary-common-horizon-utility.ts'],
    consumerFiles: [], implementationState: 'INTEGRATED_RESEARCH', testState: 'ADVERSARIAL_TESTED', runtimeDependency: null,
    dataDependency: 'zero real strategy-comparison episodes exist yet', promotionDependency: null, knownUnknowns: [], lastVerifiedSha: SHA,
  },
  {
    contractVersion: researchCompletionRegistryVersion, capabilityId: 'CONTRACT_PATH_DATASET', domain: 'DATASET_CONTRACT',
    owner: 'CLAUDE', sourceFiles: ['src/research/contract-path-outcome-dataset.ts'], consumerFiles: [],
    implementationState: 'WAITING_RUNTIME_INPUT', testState: 'ADVERSARIAL_TESTED',
    runtimeDependency: 'THETA-CONTRACT-PATH-RUNTIME-OBSERVATION-PRODUCER (Codex-owned, see handoff)',
    dataDependency: 'real 15M/1H/EOD/1D/3D/5D market observations do not exist yet', promotionDependency: null, knownUnknowns: [], lastVerifiedSha: SHA,
  },
  {
    contractVersion: researchCompletionRegistryVersion, capabilityId: 'Q_RESEARCH_PROGRAM', domain: 'STRATEGY_RESEARCH',
    owner: 'CLAUDE', sourceFiles: ['src/research/delta-cohort-research.ts', 'src/research/quote-quality-cohort.ts', 'src/research/qualified-soft-feature-evidence.ts'],
    consumerFiles: [], implementationState: 'INTEGRATED_RESEARCH', testState: 'FIXTURE_TESTED', runtimeDependency: null,
    dataDependency: 'zero real Q episodes resolved -- every delta/DTE conclusion is currently NOT_YET_POSSIBLE', promotionDependency: null,
    knownUnknowns: [], lastVerifiedSha: SHA,
  },
  {
    contractVersion: researchCompletionRegistryVersion, capabilityId: 'H_RESEARCH_PROGRAM', domain: 'STRATEGY_RESEARCH',
    owner: 'CLAUDE', sourceFiles: ['src/research/hold-strike-empirical-cohort.ts', 'src/research/hold-strike-shadow-candidate-generator.ts', 'src/research/hold-strike-terminal-valuation-pit-contract.ts', 'src/research/hold-the-strike-applicability.ts'],
    consumerFiles: [], implementationState: 'INTEGRATED_RESEARCH', testState: 'FIXTURE_TESTED', runtimeDependency: null,
    dataDependency: 'zero real H episodes resolved', promotionDependency: null, knownUnknowns: [], lastVerifiedSha: SHA,
  },
  {
    contractVersion: researchCompletionRegistryVersion, capabilityId: 'D_RESEARCH_PROGRAM', domain: 'STRATEGY_RESEARCH',
    owner: 'CLAUDE', sourceFiles: ['src/research/defined-risk-economics.ts', 'src/research/defined-risk-locked-plan.ts', 'src/research/defined-risk-management-replay.ts', 'src/research/defined-risk-vs-csp-economics.ts', 'src/research/defined-risk-vs-csp-paired-study.ts', 'src/research/defined-risk-shadow-candidate-generator.ts'],
    consumerFiles: [], implementationState: 'INTEGRATED_RESEARCH', testState: 'FIXTURE_TESTED', runtimeDependency: null,
    dataDependency: 'zero real D episodes resolved', promotionDependency: null, knownUnknowns: [], lastVerifiedSha: SHA,
  },
  {
    contractVersion: researchCompletionRegistryVersion, capabilityId: 'RECOVERY_CC_RESEARCH_PROGRAM', domain: 'STRATEGY_RESEARCH',
    owner: 'CLAUDE', sourceFiles: ['src/research/recovery-covered-call-cohort.ts', 'src/research/recovery-covered-call-experiment.ts'],
    consumerFiles: [], implementationState: 'INTEGRATED_RESEARCH', testState: 'FIXTURE_TESTED', runtimeDependency: null,
    dataDependency: 'zero real assigned/CC episodes exist', promotionDependency: null, knownUnknowns: [], lastVerifiedSha: SHA,
  },
  {
    contractVersion: researchCompletionRegistryVersion, capabilityId: 'FILTER_VALUE_ENGINE', domain: 'FILTER_VALUE',
    owner: 'CLAUDE', sourceFiles: ['src/research/filter-value-classification.ts'], consumerFiles: [],
    implementationState: 'INTEGRATED_RESEARCH', testState: 'ADVERSARIAL_TESTED', runtimeDependency: null,
    dataDependency: 'every one of the 20 canonical feature families is honestly INSUFFICIENT_DATA until real outcomes exist',
    promotionDependency: null, knownUnknowns: ['no interaction-analysis (feature x feature) module yet -- see FILTER_INTERACTION_ENGINE'], lastVerifiedSha: SHA,
  },
  {
    contractVersion: researchCompletionRegistryVersion, capabilityId: 'OPTIONOMICS_FLOW_ENGINE', domain: 'FILTER_VALUE',
    owner: 'CLAUDE', sourceFiles: ['src/research/optionomics-flow-value-study.ts'], consumerFiles: [],
    implementationState: 'CONTRACT_ONLY', testState: 'FIXTURE_TESTED', runtimeDependency: null,
    dataDependency: 'real BASE vs BASE+FLOW comparison requires real resolved episodes', promotionDependency: null,
    knownUnknowns: ['no runnable bootstrap/CI utility wired to this contract yet'], lastVerifiedSha: SHA,
  },
  {
    contractVersion: researchCompletionRegistryVersion, capabilityId: 'ADAPTIVE_STRATEGY_SELECTOR_SHADOW', domain: 'ADAPTIVE_SELECTOR',
    owner: 'CLAUDE', sourceFiles: ['src/research/adaptive-strategy-selector-shadow.ts'], consumerFiles: [],
    implementationState: 'CONTRACT_ONLY', testState: 'ADVERSARIAL_TESTED', runtimeDependency: 'no live-cycle integration (deliberately not built -- Codex-runtime-dependent per Command 5B)',
    dataDependency: 'zero real training data exists', promotionDependency: 'must clear baseline-first + complex-model gate before any real training', knownUnknowns: [], lastVerifiedSha: SHA,
  },
  {
    contractVersion: researchCompletionRegistryVersion, capabilityId: 'EXPERIENCE_MEMORY', domain: 'EXPERIENCE_MEMORY',
    owner: 'CLAUDE', sourceFiles: ['src/research/experience-memory-contract.ts'], consumerFiles: [],
    implementationState: 'CONTRACT_ONLY', testState: 'ADVERSARIAL_TESTED', runtimeDependency: null,
    dataDependency: 'no historical episode corpus to retrieve from yet', promotionDependency: null,
    knownUnknowns: ['no real retrieval implementation yet -- contract only'], lastVerifiedSha: SHA,
  },
  {
    contractVersion: researchCompletionRegistryVersion, capabilityId: 'THETA_IQ_DIMENSIONS', domain: 'READINESS',
    owner: 'CLAUDE', sourceFiles: ['src/research/theta-iq-readiness-dimensions.ts'], consumerFiles: [],
    implementationState: 'CONTRACT_ONLY', testState: 'ADVERSARIAL_TESTED', runtimeDependency: null, dataDependency: null,
    promotionDependency: null, knownUnknowns: ['no real derivation function computing dimensions from live evidence receipts yet'], lastVerifiedSha: SHA,
  },
  {
    contractVersion: researchCompletionRegistryVersion, capabilityId: 'SESSION_EXPERIENCE_REPORT', domain: 'READINESS',
    owner: 'CLAUDE', sourceFiles: ['src/research/session-experience-report.ts'], consumerFiles: [],
    implementationState: 'TESTED', testState: 'FIXTURE_TESTED', runtimeDependency: 'no canonical-export-backed real aggregator yet (verified only against empty-state fixture)',
    dataDependency: null, promotionDependency: null, knownUnknowns: [], lastVerifiedSha: SHA,
  },
  {
    contractVersion: researchCompletionRegistryVersion, capabilityId: 'CALIBRATION_CONTRACT', domain: 'CALIBRATION',
    owner: 'CLAUDE', sourceFiles: ['src/research/calibration-evaluation-contract.ts'], consumerFiles: [],
    implementationState: 'INTEGRATED_RESEARCH', testState: 'ADVERSARIAL_TESTED', runtimeDependency: null,
    dataDependency: 'reuses validation.py Platt/isotonic math (Codex/quant-owned, real) -- no real calibration data exists yet',
    promotionDependency: null, knownUnknowns: [], lastVerifiedSha: SHA,
  },
  {
    contractVersion: researchCompletionRegistryVersion, capabilityId: 'PROFIT_TAKING_CHALLENGER_GRID', domain: 'MANAGEMENT_RESEARCH',
    owner: 'CLAUDE', sourceFiles: ['src/research/profit-taking-experiment.ts', 'src/research/profit-taking-replay.ts'],
    consumerFiles: [], implementationState: 'INTEGRATED_RESEARCH', testState: 'FIXTURE_TESTED', runtimeDependency: null,
    dataDependency: 'zero real resolved episodes to evaluate the 17 challengers against', promotionDependency: null, knownUnknowns: [], lastVerifiedSha: SHA,
  },
  {
    contractVersion: researchCompletionRegistryVersion, capabilityId: 'PREDICTION_OUTCOME_JOIN', domain: 'MODEL_LIFECYCLE',
    owner: 'CLAUDE', sourceFiles: ['src/research/prediction-outcome-join.ts'], consumerFiles: [],
    implementationState: 'INTEGRATED_RESEARCH', testState: 'ADVERSARIAL_TESTED', runtimeDependency: null,
    dataDependency: 'no real predictions or outcomes to join yet', promotionDependency: null, knownUnknowns: [], lastVerifiedSha: SHA,
  },
];

export function listCapabilitiesByDomain(domain: string): readonly ResearchCapabilityRecord[] {
  return RESEARCH_COMPLETION_REGISTRY.filter((r) => r.domain === domain);
}

export function listCapabilitiesRequiringCodexRuntime(): readonly ResearchCapabilityRecord[] {
  return RESEARCH_COMPLETION_REGISTRY.filter((r) => r.runtimeDependency !== null);
}
