/**
 * Current-source truth inventory. This is an operator/research receipt, never
 * trading authority. Historical research documents remain historical even
 * when they contain superseded statements.
 */
export const canonicalSystemTruthVersion = 'theta-canonical-system-truth-v1' as const;
export const truthSourceBaselineSha = 'a5f57fc4adf88436d2fc568511705c191da56663';
// A worker SHA is operational state. Read it from the current worker lease,
// never from this source-controlled architectural inventory.
export const truthLastVerifiedAt = '2026-09-24';

export type TruthProof = 'YES' | 'NO' | 'UNVERIFIED' | 'NOT_APPLICABLE';
export type TruthDisposition =
  | 'FIXED_AND_PROVEN' | 'BUILT_AWAITING_RUNTIME_PROOF' | 'SAFE_FALLBACK_GOVERNED'
  | 'PROVIDER_LIMITED_WITH_GOVERNED_POLICY' | 'EMPIRICAL_DATA_REQUIRED_WITH_COLLECTION_ACTIVE'
  | 'RESEARCH_ONLY_NOT_AUTHORIZED' | 'EXTERNAL_INFRA_DEGRADED'
  | 'DEFERRED_NON_BLOCKING' | 'TRUE_HARD_BLOCKER';

export interface SystemCapabilityTruth {
  readonly capabilityId: string;
  readonly layerIds: readonly number[];
  readonly sourceImplemented: TruthProof;
  readonly testsPassed: TruthProof;
  readonly providerAuthenticated: TruthProof;
  readonly realDataObserved: TruthProof;
  readonly persisted: TruthProof;
  readonly runtimeReachable: TruthProof;
  readonly lockedWorkerObserved: TruthProof;
  readonly paperAuthorized: 'PAPER_ONLY_LOCKED' | 'NO' | 'NOT_APPLICABLE';
  readonly empiricallyValidated: TruthProof;
  readonly oosValidated: TruthProof;
  readonly sourceFiles: readonly string[];
  readonly currentBlocker: string;
  readonly safeCurrentBehavior: string;
  readonly closureTest: string;
  readonly disposition: TruthDisposition;
  readonly lastVerifiedSha: string;
  readonly lastVerifiedAt: string;
  readonly supersededClaims: readonly string[];
}

type CapabilityInput = Omit<SystemCapabilityTruth,
  'providerAuthenticated' | 'realDataObserved' | 'persisted' | 'runtimeReachable'
  | 'lockedWorkerObserved' | 'empiricallyValidated' | 'oosValidated'
  | 'lastVerifiedSha' | 'lastVerifiedAt' | 'supersededClaims'>
  & Partial<Pick<SystemCapabilityTruth,
    'providerAuthenticated' | 'realDataObserved' | 'persisted' | 'runtimeReachable'
    | 'lockedWorkerObserved' | 'empiricallyValidated' | 'oosValidated' | 'supersededClaims'>>;

function capability(input: CapabilityInput): SystemCapabilityTruth {
  return {
    providerAuthenticated: 'UNVERIFIED', realDataObserved: 'UNVERIFIED', persisted: 'UNVERIFIED',
    runtimeReachable: 'UNVERIFIED', lockedWorkerObserved: 'NO', empiricallyValidated: 'NO',
    oosValidated: 'NO', supersededClaims: [], ...input,
    lastVerifiedSha: truthSourceBaselineSha, lastVerifiedAt: truthLastVerifiedAt,
  };
}

export const canonicalSystemCapabilities: readonly SystemCapabilityTruth[] = [
  capability({ capabilityId: 'ALPACA_BROKER_STATE', layerIds: [0, 1, 15], sourceImplemented: 'YES', testsPassed: 'YES',
    providerAuthenticated: 'YES', realDataObserved: 'YES', persisted: 'YES', runtimeReachable: 'YES',
    paperAuthorized: 'PAPER_ONLY_LOCKED', sourceFiles: ['src/theta/alpaca-provider.ts', 'src/execution/broker-reconciliation-worker.ts'],
    currentBlocker: 'Current-release broker reconciliation needs a fresh runtime observation.',
    safeCurrentBehavior: 'Read and reconcile broker truth; do not unlock new risk.',
    closureTest: 'Locked current-release cycles show authenticated account, positions, orders and zero blocking reconciliation facts.',
    disposition: 'BUILT_AWAITING_RUNTIME_PROOF' }),
  capability({ capabilityId: 'OPTIONOMICS_RESEARCH_DATA', layerIds: [0, 5, 7], sourceImplemented: 'YES', testsPassed: 'YES',
    providerAuthenticated: 'YES', realDataObserved: 'YES', persisted: 'YES', runtimeReachable: 'YES',
    paperAuthorized: 'NOT_APPLICABLE', sourceFiles: ['src/theta/optionomics-provider.ts', 'src/theta/optionomics-feature-engine.ts', 'src/theta/optionomics-event-observation.ts'],
    currentBlocker: 'Historical/session analytics are not executable BBO and prospective company coverage remains unproved.',
    safeCurrentBehavior: 'Use qualified PIT research features; never substitute Optionomics session quotes for Alpaca execution prices.',
    closureTest: 'Observe normalized feature and event lineage in locked current-release cycles, with served-session checks.',
    disposition: 'BUILT_AWAITING_RUNTIME_PROOF' }),
  capability({ capabilityId: 'UNIVERSE_AND_UNDERLYING', layerIds: [1, 2, 3], sourceImplemented: 'YES', testsPassed: 'YES',
    providerAuthenticated: 'YES', realDataObserved: 'YES', persisted: 'YES', runtimeReachable: 'YES',
    paperAuthorized: 'PAPER_ONLY_LOCKED', sourceFiles: ['src/theta/universe-discovery.ts', 'src/theta/universe-policy.ts', 'src/research/production-shadow-runtime.ts'],
    currentBlocker: 'The owner-approved SPY cohort is now retained across client bounds, but the running worker predates this source change.',
    safeCurrentBehavior: 'Only provider-confirmed, manifest-approved symbols receive bounded Paper authority. Other scanned symbols remain research-only.',
    closureTest: 'A locked current-release open-session scan includes SPY, persists its universe stages and records exact exclusion reasons.',
    disposition: 'BUILT_AWAITING_RUNTIME_PROOF',
    supersededClaims: ['Approved SPY could rely on incidental top-two liquidity rank to reach the Paper-authority cohort'] }),
  capability({ capabilityId: 'STRATEGY_ROUTER_Q', layerIds: [2, 3, 11], sourceImplemented: 'YES', testsPassed: 'YES',
    realDataObserved: 'YES', persisted: 'YES', runtimeReachable: 'YES', paperAuthorized: 'PAPER_ONLY_LOCKED',
    sourceFiles: ['src/theta/canonical-strategy-frontier.ts', 'bots/theta/quant/models/strategy_router.py'],
    currentBlocker: 'Only Conventional can enter the bounded Paper path, which remains new-risk locked pending full evidence.',
    safeCurrentBehavior: 'Persist Q applicability and candidates without allowing an order from an incomplete scan.',
    closureTest: 'Current locked cycle persists Q candidates, exact reasons and the no-submit decision path.',
    disposition: 'BUILT_AWAITING_RUNTIME_PROOF' }),
  capability({ capabilityId: 'STRATEGY_H_D_SHADOW', layerIds: [2, 3, 11], sourceImplemented: 'YES', testsPassed: 'YES',
    realDataObserved: 'UNVERIFIED', persisted: 'UNVERIFIED', runtimeReachable: 'UNVERIFIED', paperAuthorized: 'NO',
    sourceFiles: ['src/theta/canonical-strategy-frontier.ts', 'src/theta/theta-shadow-cycle.ts'],
    currentBlocker: 'Authenticated H/D shadow candidate persistence and common-horizon OOS comparison are not yet proved.',
    safeCurrentBehavior: 'H/D may be enumerated for shadow research but have no broker authority.',
    closureTest: 'Current locked cycle persists eligible 2-5 DTE H and both-leg D candidates with shadow-only authority.',
    disposition: 'RESEARCH_ONLY_NOT_AUTHORIZED',
    supersededClaims: ['THETA_BRAIN_CAPABILITY_MATRIX: no H/D candidate-construction path'] }),
  capability({ capabilityId: 'CONTRACT_AND_QUOTE_VALIDITY', layerIds: [4, 6, 13], sourceImplemented: 'YES', testsPassed: 'YES',
    providerAuthenticated: 'YES', realDataObserved: 'YES', persisted: 'YES', runtimeReachable: 'YES',
    paperAuthorized: 'PAPER_ONLY_LOCKED', sourceFiles: ['src/theta/option-contract.ts', 'src/theta/finalist-quote-refresh.ts', 'src/execution/alpaca-execution-quote-source.ts'],
    currentBlocker: 'Open-session current-worker finalist and pre-submit latency/age distributions are unavailable.',
    safeCurrentBehavior: 'Stale, missing, crossed or unqualified quotes remain non-executable.',
    closureTest: 'Natural locked no-submit scan proves exact finalist refresh before AEGIS and final exact-contract refresh after selection.',
    disposition: 'BUILT_AWAITING_RUNTIME_PROOF' }),
  capability({ capabilityId: 'AEGIS_STRESS_AND_PORTFOLIO', layerIds: [8, 9], sourceImplemented: 'YES', testsPassed: 'YES',
    providerAuthenticated: 'YES', realDataObserved: 'YES', persisted: 'UNVERIFIED', runtimeReachable: 'YES',
    paperAuthorized: 'PAPER_ONLY_LOCKED', sourceFiles: ['src/theta/aegis-iv-stress.ts', 'src/theta/aegis-spread-stress.ts', 'bots/theta/quant/models/aegis.py'],
    currentBlocker: 'Schema-064 Alpaca IV cohort and spread baselines need real session maturity and locked runtime proof. Migration 065 is deferred.',
    safeCurrentBehavior: 'AEGIS fails closed on missing required evidence; current quote safety is never waived by cold start.',
    closureTest: 'Persisted real schema-064 assessments and a locked no-submit cycle with full per-family reasons.',
    disposition: 'TRUE_HARD_BLOCKER',
    supersededClaims: ['THETA_BRAIN_CAPABILITY_MATRIX: both stress producers permanently null'] }),
  capability({ capabilityId: 'COMPANY_EVENT_AND_CORPORATE_ACTION', layerIds: [7, 9], sourceImplemented: 'YES', testsPassed: 'YES',
    providerAuthenticated: 'YES', realDataObserved: 'YES', persisted: 'YES', runtimeReachable: 'YES',
    paperAuthorized: 'PAPER_ONLY_LOCKED', sourceFiles: ['src/theta/earnings-event-evidence.ts', 'src/theta/alpaca-corporate-action-evidence.ts'],
    currentBlocker: 'SPY is approved as the sole bounded bootstrap instrument. Current-release locked runtime policy evidence remains forward-session dependent.',
    safeCurrentBehavior: 'Positive PIT evidence is honored, absent rows stay unqualified, and the bounded fallback cannot clear any instrument other than approved SPY.',
    closureTest: 'Observe SPY company-event and corporate-action policy receipts in a locked current-release open-session cycle.',
    disposition: 'BUILT_AWAITING_RUNTIME_PROOF',
    supersededClaims: ['The approved first-Paper instrument manifest has no entries'] }),
  capability({ capabilityId: 'SIZING_AND_ACTION', layerIds: [10, 12], sourceImplemented: 'YES', testsPassed: 'YES',
    realDataObserved: 'YES', persisted: 'YES', runtimeReachable: 'YES', paperAuthorized: 'PAPER_ONLY_LOCKED',
    sourceFiles: ['bots/theta/quant/models/sizing.py', 'src/theta/canonical-decision-authority.ts'],
    currentBlocker: 'Natural positive quantity and complete first-Paper evidence have not been observed on current source.',
    safeCurrentBehavior: 'Quantity zero and SYSTEM_HOLD remain valid; no forced one-contract minimum.',
    closureTest: 'Real-provider no-submit reaches positive quantity only for a naturally qualified candidate, or a fully explained economic WAIT.',
    disposition: 'BUILT_AWAITING_RUNTIME_PROOF' }),
  capability({ capabilityId: 'CROSS_STRATEGY_ECONOMICS', layerIds: [5, 11], sourceImplemented: 'YES', testsPassed: 'YES',
    realDataObserved: 'NO', persisted: 'NO', runtimeReachable: 'NO', paperAuthorized: 'NO',
    sourceFiles: ['src/research/cross-strategy-common-horizon-contract.ts', 'src/theta/canonical-strategy-frontier.ts'],
    currentBlocker: 'Q/H/D common-horizon outcomes, after-cost EV, tail risk and capital-days are not empirically comparable.',
    safeCurrentBehavior: 'Conventional-only Paper scope; H/D comparisons remain non-authoritative research.',
    closureTest: 'Same PIT horizon/cost/risk basis, sufficient independent outcomes and untouched OOS comparison.',
    disposition: 'RESEARCH_ONLY_NOT_AUTHORIZED' }),
  capability({ capabilityId: 'CANONICAL_MANAGEMENT', layerIds: [16], sourceImplemented: 'YES', testsPassed: 'YES',
    persisted: 'YES', runtimeReachable: 'YES', paperAuthorized: 'PAPER_ONLY_LOCKED',
    sourceFiles: ['src/theta/paper-bootstrap-management-policy.ts', 'src/theta/production-paper-management-candidate-source.ts'],
    currentBlocker: 'Roll, CC and roll-CC source arrays have not been observed in a locked current-worker lifecycle.',
    safeCurrentBehavior: 'One canonical policy manages broker-confirmed exposure; quarantined Pipeline B has no broker authority.',
    closureTest: 'Current locked worker persists candidate/rejection arrays and no-submit action plans for each applicable lifecycle.',
    disposition: 'BUILT_AWAITING_RUNTIME_PROOF',
    supersededClaims: ['THETA_BRAIN_CAPABILITY_MATRIX: no roll or covered-call candidate source'] }),
  capability({ capabilityId: 'BROKER_EXECUTION_AND_RECONCILIATION', layerIds: [14, 15], sourceImplemented: 'YES', testsPassed: 'YES',
    providerAuthenticated: 'YES', runtimeReachable: 'YES', paperAuthorized: 'PAPER_ONLY_LOCKED',
    sourceFiles: ['src/execution/broker.ts', 'src/execution/paper-order-coordinator.ts', 'src/execution/broker-reconciliation-worker.ts'],
    currentBlocker: 'Current diagnostic wave prohibits order submission; current worker state must be read at runtime.',
    safeCurrentBehavior: 'Read-only broker checks and reconciliation only; zero order mutation in this wave.',
    closureTest: 'Separate authorized Paper canary, broker acknowledgement, fills, idempotency and reconciliation.',
    disposition: 'BUILT_AWAITING_RUNTIME_PROOF' }),
  capability({ capabilityId: 'WHOLE_CHAIN_ACCOUNTING', layerIds: [17], sourceImplemented: 'YES', testsPassed: 'YES',
    persisted: 'YES', runtimeReachable: 'YES', paperAuthorized: 'NOT_APPLICABLE',
    sourceFiles: ['src/theta/whole-chain-economics.ts', 'src/theta/postgres-whole-chain-components-repository.ts'],
    currentBlocker: 'No broker-confirmed resolved THETA Paper chain is available for empirical reconciliation.',
    safeCurrentBehavior: 'Preserve unknown fees/basis/legs, do not fabricate realized P&L.',
    closureTest: 'Reconcile every actual Paper fill, assignment, stock and CC leg to broker cash flows and fees.',
    disposition: 'EMPIRICAL_DATA_REQUIRED_WITH_COLLECTION_ACTIVE' }),
  capability({ capabilityId: 'OUTCOME_AND_POLICY_LEARNING', layerIds: [18, 19, 20], sourceImplemented: 'YES', testsPassed: 'YES',
    realDataObserved: 'YES', persisted: 'YES', runtimeReachable: 'NO', paperAuthorized: 'NO',
    sourceFiles: ['src/research/wait-regret-dataset.ts', 'src/research/theta-entry-outcome-dataset.ts', 'src/theta/empirical-policy-promotion.ts'],
    currentBlocker: '8,605 historical candidates lack resolved whole-chain counterfactuals and enough independent Paper episodes.',
    safeCurrentBehavior: 'Keep regret, EV and model promotion unavailable where labels cannot be identified.',
    closureTest: 'Accumulate independent broker-confirmed outcomes, apply PIT-safe chronological OOS evaluation and governance.',
    disposition: 'EMPIRICAL_DATA_REQUIRED_WITH_COLLECTION_ACTIVE' }),
  capability({ capabilityId: 'UNKNOWN_READINESS_GOVERNANCE', layerIds: [0, 20], sourceImplemented: 'YES', testsPassed: 'YES',
    persisted: 'YES', runtimeReachable: 'NO', paperAuthorized: 'NOT_APPLICABLE',
    sourceFiles: ['src/theta/pre-vps-unknown-register.ts', 'docs/operations/THETA_UNKNOWN_REGISTER_PRE_VPS.json'],
    currentBlocker: 'The denominator is complete with zero avoidable UNKNOWNs. SPY policy and stress evidence still need current-release locked runtime observation.',
    safeCurrentBehavior: 'Provider limitations remain explicit, SPY is the only approved bootstrap instrument, and missing runtime evidence blocks new risk.',
    closureTest: 'Observe the typed SPY safety and AEGIS receipts on the locked current release.',
    disposition: 'BUILT_AWAITING_RUNTIME_PROOF',
    supersededClaims: ['An explicit owner decision remains for approved instrument classification'] }),
  capability({ capabilityId: 'FIRST_PAPER_READINESS', layerIds: [12, 20], sourceImplemented: 'YES', testsPassed: 'YES',
    persisted: 'NO', runtimeReachable: 'YES', paperAuthorized: 'NOT_APPLICABLE',
    sourceFiles: ['src/theta/first-paper-blocker-budget.ts', 'src/execution/master-paper-plan-assembly.ts', 'src/customer/api.ts'],
    currentBlocker: 'Audit coverage and SPY approval are complete. A current-release natural open-session no-submit proof remains required.',
    safeCurrentBehavior: 'The operator readiness receipt names audit and safety blockers; it cannot emit READY from zero avoidable count alone.',
    closureTest: 'Complete the UNKNOWN sweep, clear all independent release checks and observe the current locked release before any Paper unlock.',
    disposition: 'TRUE_HARD_BLOCKER' }),
];

export const canonicalBrainLayers = [
  'DATA_VALIDITY', 'MARKET_ACCOUNT_STATE', 'STRATEGY_APPLICABILITY', 'CANDIDATE_GENERATION',
  'MECHANICAL_VALIDATION', 'ECONOMIC_FEATURES', 'EXECUTION_QUALITY', 'EVENT_OWNERSHIP_REGIME',
  'PORTFOLIO_RISK', 'AEGIS', 'SIZING', 'COMMON_HORIZON_FRONTIER', 'CANONICAL_ACTION',
  'PRE_SUBMIT_VALIDATION', 'BROKER_EXECUTION', 'RECONCILIATION', 'MANAGEMENT',
  'WHOLE_CHAIN_ACCOUNTING', 'OUTCOME_REGRET_LABELING', 'EMPIRICAL_LEARNING', 'POLICY_PROMOTION',
] as const;

export const canonicalSystemTruthRegister = {
  schemaVersion: canonicalSystemTruthVersion,
  auditCoverage: 'COMPLETE' as const,
  sourceBaselineSha: truthSourceBaselineSha,
  lastVerifiedAt: truthLastVerifiedAt,
  brokerMutationsAuthorized: false,
  followerExecutionAuthorized: false,
  liveMoneyAuthorized: false,
  brainLayers: canonicalBrainLayers.map((name, layerId) => ({
    layerId, name,
    capabilityIds: canonicalSystemCapabilities.filter((item) => item.layerIds.includes(layerId)).map((item) => item.capabilityId),
  })),
  capabilities: canonicalSystemCapabilities,
} as const;
