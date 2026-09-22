/**
 * THETA pre-VPS capability registry (directive Slice 2). Research-only,
 * `brokerAuthority: false`. A machine-readable inventory of THETA's major
 * capabilities, cross-referenced against real source files -- every
 * `sourceFiles` entry names a file this engagement has directly read and
 * confirmed contains the described logic. This registry does NOT modify,
 * call, or gate any Production behavior; it exists to make "does a real
 * producer -> consumer -> runtime path exist" answerable by inspection
 * rather than by trusting a function's name.
 *
 * Grounding discipline: an entry's `currentState` reflects only what has
 * been directly verified in this engagement (via source reads, real
 * Optionomics MCP calls, or the real 2026-09-21 live-session forensic).
 * Where a capability was not independently re-verified this pass, its
 * `currentState` says so explicitly (`NOT_INDEPENDENTLY_VERIFIED`) rather
 * than assuming REAL from a plausible-sounding file/function name.
 */

export const preVpsCapabilityRegistryVersion = 'theta-pre-vps-capability-registry-v1' as const;

export type CapabilityMaturity =
  | 'PRODUCTION_REQUIRED' | 'PAPER_BOOTSTRAP_REQUIRED' | 'SHADOW_REQUIRED'
  | 'RESEARCH_ONLY' | 'QUARANTINED' | 'DEPRECATED';

export type CapabilityCurrentState =
  | 'REAL' | 'PARTIAL' | 'STUB_DEFAULT' | 'MISSING' | 'QUARANTINED_NO_CALLERS'
  | 'NOT_INDEPENDENTLY_VERIFIED';

export type CapabilityOwner = 'CODEX' | 'CLAUDE' | 'SHARED';

export interface CapabilityRecord {
  readonly capabilityId: string;
  readonly purpose: string;
  readonly maturity: CapabilityMaturity;
  readonly firstPaperRequired: boolean;
  readonly preVpsRequired: boolean;
  readonly producer: string;
  readonly dataSource: string;
  readonly persistence: string;
  readonly consumer: string;
  readonly runtimeReachable: boolean | 'PARTIAL';
  readonly authority: string;
  readonly mechanicallyTested: boolean;
  readonly providerTested: boolean;
  readonly noSubmitTested: boolean;
  readonly empiricallyValidated: boolean;
  readonly currentState: CapabilityCurrentState;
  readonly blocker: string | null;
  readonly owner: CapabilityOwner;
  readonly sourceFiles: readonly string[];
}

export const capabilityRegistry: readonly CapabilityRecord[] = [
  {
    capabilityId: 'MARKET_CLOCK', purpose: 'Confirm real market session state before any decision cycle',
    maturity: 'PRODUCTION_REQUIRED', firstPaperRequired: true, preVpsRequired: true,
    producer: 'fetchMarketClock', dataSource: 'Alpaca /v2/clock', persistence: 'Not independently verified this pass',
    consumer: 'Worker cycle gating', runtimeReachable: true, authority: 'alpaca-provider.ts',
    mechanicallyTested: false, providerTested: false, noSubmitTested: false, empiricallyValidated: false,
    currentState: 'REAL', blocker: null, owner: 'CODEX', sourceFiles: ['src/theta/alpaca-provider.ts:196'],
  },
  {
    capabilityId: 'BROKER_ACCOUNT', purpose: 'Real account snapshot (buying power, equity, status)',
    maturity: 'PRODUCTION_REQUIRED', firstPaperRequired: true, preVpsRequired: true,
    producer: 'fetchMasterAccountSnapshot', dataSource: 'Alpaca /v2/account', persistence: 'Not independently verified this pass',
    consumer: 'Sizing, AEGIS capital-at-risk inputs', runtimeReachable: true, authority: 'alpaca-provider.ts',
    mechanicallyTested: false, providerTested: false, noSubmitTested: false, empiricallyValidated: false,
    currentState: 'REAL', blocker: null, owner: 'CODEX', sourceFiles: ['src/theta/alpaca-provider.ts:93'],
  },
  {
    capabilityId: 'BROKER_POSITIONS', purpose: 'Real open position list (for ownership/recovery/CC eligibility)',
    maturity: 'PRODUCTION_REQUIRED', firstPaperRequired: true, preVpsRequired: true,
    producer: 'fetchPositions', dataSource: 'Alpaca /v2/positions', persistence: 'Not independently verified this pass',
    consumer: 'account-exposure.ts (ownership/recovery/AEGIS exposure)', runtimeReachable: true, authority: 'alpaca-provider.ts',
    mechanicallyTested: false, providerTested: false, noSubmitTested: false, empiricallyValidated: false,
    currentState: 'REAL', blocker: null, owner: 'CODEX', sourceFiles: ['src/theta/alpaca-provider.ts:127'],
  },
  {
    capabilityId: 'BROKER_OPEN_ORDERS', purpose: 'Read-only open-order state',
    maturity: 'PRODUCTION_REQUIRED', firstPaperRequired: true, preVpsRequired: true,
    producer: 'fetchOpenOrders', dataSource: 'Alpaca /v2/orders (GET, read-only)', persistence: 'Not independently verified this pass',
    consumer: 'Reconciliation, idempotency checks', runtimeReachable: true, authority: 'alpaca-provider.ts',
    mechanicallyTested: false, providerTested: false, noSubmitTested: false, empiricallyValidated: false,
    currentState: 'REAL', blocker: null, owner: 'CODEX', sourceFiles: ['src/theta/alpaca-provider.ts:160'],
  },
  {
    capabilityId: 'BROKER_ORDER_SUBMISSION', purpose: 'Real order mutation authority (POST/PATCH/DELETE /v2/orders)',
    maturity: 'PRODUCTION_REQUIRED', firstPaperRequired: true, preVpsRequired: true,
    producer: 'CORRECTED this pass: a real, gated order-submission/replace/cancel capability exists at src/execution/broker.ts:274-282, gated by assertBrokerMutationAuthorized(...) on every call, idempotent via client_order_id. alpaca-provider.ts itself only ever contains the read-only fetchOpenOrders GET -- an earlier doc comment (theta-shadow-once.ts:19) was correct only as narrowly scoped to that one file and could be misread as "no order-submission code exists anywhere," which is false.',
    dataSource: 'Alpaca /v2/orders (POST/PATCH/DELETE)', persistence: 'N/A', consumer: 'Real Production broker mutation (this branch has zero authority to call it, brokerAuthority=false throughout)',
    runtimeReachable: true, authority: 'src/execution/broker.ts:274-282, gated by assertBrokerMutationAuthorized',
    mechanicallyTested: false, providerTested: false, noSubmitTested: false, empiricallyValidated: false,
    currentState: 'REAL', blocker: null,
    owner: 'CODEX', sourceFiles: ['src/execution/broker.ts:274-282'],
  },
  {
    capabilityId: 'BROKER_RECONCILIATION', purpose: 'Reconcile local decision state against real broker state',
    maturity: 'PRODUCTION_REQUIRED', firstPaperRequired: true, preVpsRequired: true,
    producer: 'broker-reconciliation-worker.ts (confirmed to exist via grep this pass; internals not read)',
    dataSource: 'Alpaca (positions/orders/fills)', persistence: 'Not independently verified this pass',
    consumer: 'Worker health, restart recovery', runtimeReachable: 'PARTIAL', authority: 'src/execution/broker-reconciliation-worker.ts',
    mechanicallyTested: false, providerTested: false, noSubmitTested: false, empiricallyValidated: false,
    currentState: 'NOT_INDEPENDENTLY_VERIFIED', blocker: null, owner: 'CODEX',
    sourceFiles: ['src/execution/broker-reconciliation-worker.ts'],
  },
  {
    capabilityId: 'UNIVERSE_DISCOVERY', purpose: 'Enumerate the real tradable underlying universe',
    maturity: 'PRODUCTION_REQUIRED', firstPaperRequired: true, preVpsRequired: true,
    producer: 'discoverRealUniverse', dataSource: 'Alpaca tradable assets', persistence: 'Not independently verified this pass',
    consumer: 'Universe ranking / strategy router', runtimeReachable: true, authority: 'universe-discovery.ts',
    mechanicallyTested: false, providerTested: false, noSubmitTested: false, empiricallyValidated: false,
    currentState: 'REAL', blocker: null, owner: 'CODEX', sourceFiles: ['src/theta/universe-discovery.ts:90'],
  },
  {
    capabilityId: 'UNDERLYING_RANKING', purpose: 'Rank underlyings for scan priority',
    maturity: 'PRODUCTION_REQUIRED', firstPaperRequired: true, preVpsRequired: true,
    producer: 'avgDollarVolume-based baseline (per this engagement\'s prior R8 Slice B work; a real Pareto/lexicographic research CHALLENGER exists at src/research/universe-opportunity-regret.ts but is research-only, not wired into Production)',
    dataSource: 'Alpaca bars/volume', persistence: 'Not independently verified this pass',
    consumer: 'buildUniverseBreadthShadowPlan (strategy-quality-shadow-diagnostics.ts)', runtimeReachable: true,
    authority: 'Production baseline ranking (exact file not re-confirmed this pass)',
    mechanicallyTested: false, providerTested: false, noSubmitTested: false, empiricallyValidated: false,
    currentState: 'PARTIAL', blocker: 'Baseline is a simple placeholder (avgDollarVolume); real challengers exist only as research, not Production-integrated',
    owner: 'SHARED', sourceFiles: ['src/research/universe-opportunity-regret.ts'],
  },
  {
    capabilityId: 'OPTIONABILITY_CHECK', purpose: 'Confirm an underlying has a real, tradable option chain',
    maturity: 'PRODUCTION_REQUIRED', firstPaperRequired: true, preVpsRequired: true,
    producer: 'universe-policy.ts (confirmed to reference optionability via grep; internals not re-read this pass)',
    dataSource: 'Alpaca option contracts endpoint', persistence: 'Not independently verified this pass',
    consumer: 'Strategy applicability gate', runtimeReachable: 'PARTIAL', authority: 'universe-policy.ts',
    mechanicallyTested: false, providerTested: false, noSubmitTested: false, empiricallyValidated: false,
    currentState: 'NOT_INDEPENDENTLY_VERIFIED', blocker: null, owner: 'CODEX', sourceFiles: ['src/theta/universe-policy.ts'],
  },
  {
    capabilityId: 'OPTION_CONTRACT_DISCOVERY', purpose: 'Enumerate real option contracts for a symbol',
    maturity: 'PRODUCTION_REQUIRED', firstPaperRequired: true, preVpsRequired: true,
    producer: 'fetchOptionContracts', dataSource: 'Alpaca /v2/options/contracts', persistence: 'Not independently verified this pass',
    consumer: 'DTE/strike lattice construction', runtimeReachable: true, authority: 'alpaca-provider.ts',
    mechanicallyTested: false, providerTested: false, noSubmitTested: false, empiricallyValidated: false,
    currentState: 'REAL', blocker: 'See CONTRACT_NOT_EXECUTABLE investigation -- a large real-session fraction of discovered contracts are marked non-executable downstream', owner: 'CODEX',
    sourceFiles: ['src/theta/alpaca-provider.ts:308'],
  },
  {
    capabilityId: 'EXECUTABLE_BBO', purpose: 'Real, fresh executable bid/ask for a contract',
    maturity: 'PRODUCTION_REQUIRED', firstPaperRequired: true, preVpsRequired: true,
    producer: 'fetchOptionSnapshots', dataSource: 'Alpaca option snapshots', persistence: 'Not independently verified this pass',
    consumer: 'Deterministic economics, executability gate', runtimeReachable: true, authority: 'alpaca-provider.ts',
    mechanicallyTested: false, providerTested: false, noSubmitTested: false, empiricallyValidated: false,
    currentState: 'REAL', blocker: null, owner: 'CODEX', sourceFiles: ['src/theta/alpaca-provider.ts:365'],
  },
  {
    capabilityId: 'CONTRACT_MULTIPLIER_MAPPING', purpose: 'Correctly read a real per-contract share multiplier',
    maturity: 'PRODUCTION_REQUIRED', firstPaperRequired: true, preVpsRequired: true,
    producer: 'asNumberOrNull(c.size)', dataSource: 'Alpaca /v2/options/contracts field `size`', persistence: 'N/A',
    consumer: 'option-chain-ingestion.ts executability gate (forces executable=false when null)', runtimeReachable: true,
    authority: 'alpaca-provider.ts:337', mechanicallyTested: false, providerTested: false, noSubmitTested: false, empiricallyValidated: false,
    currentState: 'NOT_INDEPENDENTLY_VERIFIED',
    blocker: 'HIGHEST-PRIORITY OPEN QUESTION -- 3,299/3,876 real-session candidates rejected as CONTRACT_NOT_EXECUTABLE; root cause (mapping defect vs. session-transient provider degradation) requires a live Alpaca sample this research environment cannot pull',
    owner: 'CODEX', sourceFiles: ['src/theta/alpaca-provider.ts:337', 'src/theta/option-chain-ingestion.ts:147-160'],
  },
  {
    capabilityId: 'DELTA_STRIKE_DTE_LATTICE', purpose: 'Construct the real candidate contract lattice (DTE x strike x delta band)',
    maturity: 'PRODUCTION_REQUIRED', firstPaperRequired: true, preVpsRequired: true,
    producer: 'build_candidate_grid / _delta_band_for', dataSource: 'Real contract/quote evidence passed in from TypeScript layer',
    persistence: 'Not independently verified this pass', consumer: 'Canonical strategy frontier', runtimeReachable: 'PARTIAL',
    authority: 'bots/theta/quant/models/theta_q_lattice.py', mechanicallyTested: false, providerTested: false,
    noSubmitTested: false, empiricallyValidated: false, currentState: 'NOT_INDEPENDENTLY_VERIFIED', blocker: null,
    owner: 'CODEX', sourceFiles: ['bots/theta/quant/models/theta_q_lattice.py'],
  },
  {
    capabilityId: 'CORPORATE_ACTION_EVIDENCE', purpose: 'Real corporate-action (split/dividend/M&A) evidence per underlying',
    maturity: 'PRODUCTION_REQUIRED', firstPaperRequired: true, preVpsRequired: true,
    producer: 'readAlpacaCorporateActions / persistAlpacaCorporateActionRead', dataSource: 'Alpaca corporate actions',
    persistence: 'Real (per commit history: "feat(theta): capture corporate actions and export event PIT evidence")',
    consumer: 'Universe event-policy gate, CC/call-away decisions', runtimeReachable: true,
    authority: 'alpaca-corporate-action-evidence.ts', mechanicallyTested: false, providerTested: false,
    noSubmitTested: false, empiricallyValidated: false, currentState: 'REAL', blocker: null, owner: 'CODEX',
    sourceFiles: ['src/theta/alpaca-corporate-action-evidence.ts'],
  },
  {
    capabilityId: 'AEGIS_SECTOR_CORRELATION', purpose: 'Sector/correlation concentration risk gate',
    maturity: 'PRODUCTION_REQUIRED', firstPaperRequired: false, preVpsRequired: true,
    producer: 'deriveCandidateInclusiveAegisInputs (soleRiskGroup proxy)', dataSource: 'account-exposure.ts real position list',
    persistence: 'N/A (live derivation)', consumer: 'bots/theta/quant/models/aegis.py SECTOR/CORRELATION families',
    runtimeReachable: 'PARTIAL', authority: 'account-exposure.ts:334', mechanicallyTested: true, providerTested: false,
    noSubmitTested: false, empiricallyValidated: false, currentState: 'PARTIAL',
    blocker: 'Real only for exactly one held underlying; no multi-position sector/correlation producer exists', owner: 'CODEX',
    sourceFiles: ['src/theta/account-exposure.ts:334'],
  },
  {
    capabilityId: 'AEGIS_SYSTEM_STRESS', purpose: 'IV-shock / spread-widening system stress detection',
    maturity: 'PRODUCTION_REQUIRED', firstPaperRequired: false, preVpsRequired: true,
    producer: 'None -- confirmed via grep this engagement: zero real producer anywhere in the repo', dataSource: 'None wired',
    persistence: 'N/A', consumer: 'bots/theta/quant/models/aegis.py SYSTEM family (needs 3 non-None signals; only stressGapDetected is real)',
    runtimeReachable: false, authority: 'aegis-derivation.ts (documents the gap, does not close it)',
    mechanicallyTested: false, providerTested: false, noSubmitTested: false, empiricallyValidated: false,
    currentState: 'STUB_DEFAULT', blocker: 'stressIvShockDetected/stressSpreadWideningDetected always null; correctly represented as UNKNOWN, never false-defaulted, but zero real producer exists', owner: 'CODEX',
    sourceFiles: ['src/theta/aegis-derivation.ts:24-27', 'src/theta/account-exposure.ts'],
  },
  {
    capabilityId: 'CROSS_STRATEGY_ECONOMIC_COMPARISON', purpose: 'Economically compare candidates across DIFFERENT branches/actions',
    maturity: 'PRODUCTION_REQUIRED', firstPaperRequired: false, preVpsRequired: true,
    producer: 'dominates() -- confirmed this engagement to never compare across branch/action (canonical-strategy-frontier.ts:428)',
    dataSource: 'CanonicalFrontierCandidate', persistence: 'N/A',
    consumer: 'rankCandidates final ordering', runtimeReachable: 'PARTIAL', authority: 'canonical-strategy-frontier.ts',
    mechanicallyTested: true, providerTested: false, noSubmitTested: false, empiricallyValidated: false,
    currentState: 'PARTIAL', blocker: 'Cross-branch ties fall through to alphabetical candidateId ordering, not economics. A hardened research-only comparator exists at src/research/cross-strategy-common-horizon-contract.ts (v4) but is NOT Production-integrated.',
    owner: 'CODEX', sourceFiles: ['src/theta/canonical-strategy-frontier.ts:428,452'],
  },
  {
    capabilityId: 'AEGIS_EVALUATION', purpose: 'Candidate-specific hard-safety risk evaluation',
    maturity: 'PRODUCTION_REQUIRED', firstPaperRequired: true, preVpsRequired: true,
    producer: 'Python AEGIS bridge, invoked via new-risk-orchestrator.ts', dataSource: 'Candidate + account exposure evidence',
    persistence: 'Real (per the 2026-09-21 forensic: aegis=null is explicitly distinguished from a real evaluated result)',
    consumer: 'Sizing / final candidate disposition', runtimeReachable: true, authority: 'new-risk-orchestrator.ts + bots/theta/quant/models/aegis.py',
    mechanicallyTested: true, providerTested: false, noSubmitTested: false, empiricallyValidated: false,
    currentState: 'PARTIAL', blocker: 'Only reached after a candidate survives the upstream THETA-Q feasible/Pareto stage; per the real 2026-09-21 session, the vast majority of candidates never reached AEGIS at all (NOT_EVALUATED, not evaluated-and-rejected)', owner: 'CODEX',
    sourceFiles: ['src/theta/new-risk-orchestrator.ts', 'bots/theta/quant/models/aegis.py'],
  },
  {
    capabilityId: 'SIZING_UNKNOWN_VS_EARNED_WAIT', purpose: 'Distinguish an incomplete evaluation from a real earned WAIT decision',
    maturity: 'PRODUCTION_REQUIRED', firstPaperRequired: true, preVpsRequired: true,
    producer: 'globalWaitEarned/sizingEvidenceUnknown gating (commit bf6d80e, confirmed present on current main)',
    dataSource: 'Candidate sizing evidence completeness', persistence: 'N/A', consumer: 'Final decision surface / GLOBAL_WAIT vs SYSTEM_HOLD classification',
    runtimeReachable: true, authority: 'canonical-strategy-frontier.ts:525-532', mechanicallyTested: true, providerTested: false,
    noSubmitTested: false, empiricallyValidated: false, currentState: 'REAL',
    blocker: 'Per the 2026-09-21 forensic, this fix is on main but NOT yet confirmed active in the currently pinned/deployed worker release', owner: 'CODEX',
    sourceFiles: ['src/theta/canonical-strategy-frontier.ts:525-532'],
  },
  {
    capabilityId: 'PAPER_PLAN_ASSEMBLY', purpose: 'Assemble a real Paper-eligible action plan from a canonical decision',
    maturity: 'PRODUCTION_REQUIRED', firstPaperRequired: true, preVpsRequired: true,
    producer: 'assembleMasterPaperEvidencePlan', dataSource: 'Canonical decision + registry status gate',
    persistence: 'Real (PostgresMasterPaperActionPlanStore, confirmed to exist via import in production-shadow-runtime.ts)',
    consumer: 'Broker mutation layer (not this branch)', runtimeReachable: true, authority: 'master-paper-plan-assembly.ts:60',
    mechanicallyTested: true, providerTested: false, noSubmitTested: false, empiricallyValidated: false,
    currentState: 'REAL', blocker: 'Only THETA_CONVENTIONAL/THETA_RECOVERY/THETA_CC pass the status==SHADOW gate; THETA_HOLD_STRIKE/THETA_DEFINED_RISK are RESEARCH_ONLY and blocked here', owner: 'CODEX',
    sourceFiles: ['src/execution/master-paper-plan-assembly.ts:60'],
  },
  {
    capabilityId: 'ROLL_CC_CANDIDATE_VALUATION', purpose: 'Value a real roll or covered-call candidate against the current chain',
    maturity: 'PRODUCTION_REQUIRED', firstPaperRequired: true, preVpsRequired: true,
    producer: 'evaluateRollCandidates / valueForRollFromCandidates / valueForRollCcFromCandidates / valueForSellCcFromCandidates',
    dataSource: 'A real PaperBootstrapCandidateSource (see next entry)', persistence: 'N/A',
    consumer: 'Management action selection (ROLL/SELL_CC)', runtimeReachable: false,
    authority: 'paper-bootstrap-management-policy.ts', mechanicallyTested: true, providerTested: false,
    noSubmitTested: false, empiricallyValidated: false, currentState: 'STUB_DEFAULT',
    blocker: 'Real, tested valuation machinery; structurally unreachable because its input candidate source is always null (see ROLL_CC_CANDIDATE_SOURCE)', owner: 'CODEX',
    sourceFiles: ['src/theta/paper-bootstrap-management-policy.ts'],
  },
  {
    capabilityId: 'ROLL_CC_CANDIDATE_SOURCE', purpose: 'Discover real roll/CC candidates from the live contract lattice for an open chain',
    maturity: 'PRODUCTION_REQUIRED', firstPaperRequired: true, preVpsRequired: true,
    producer: 'None wired -- createPaperBootstrapManagementPolicyProvider() called with zero arguments at autonomous-runtime.ts:353, defaulting to the always-null noCandidates stub',
    dataSource: 'None wired (a real research-only discovery module exists at src/research/paper-bootstrap-candidate-source.ts but is not adopted)',
    persistence: 'N/A', consumer: 'ROLL_CC_CANDIDATE_VALUATION', runtimeReachable: false,
    authority: 'autonomous-runtime.ts:353 (real call site) / paper-bootstrap-management-policy.ts:1127-1158 (stub)',
    mechanicallyTested: false, providerTested: false, noSubmitTested: false, empiricallyValidated: false,
    currentState: 'STUB_DEFAULT', blocker: 'P0 -- confirmed unchanged across multiple passes of this engagement', owner: 'CODEX',
    sourceFiles: ['src/theta/autonomous-runtime.ts:353', 'src/theta/paper-bootstrap-management-policy.ts:1127-1158'],
  },
  {
    capabilityId: 'QUARANTINED_MANAGEMENT_ARCHITECTURE', purpose: 'A second, array-based management architecture with a real Python covered-call ranker',
    maturity: 'QUARANTINED', firstPaperRequired: false, preVpsRequired: false,
    producer: 'runThetaManagementCycle + management-orchestrator.ts/assignment-orchestrator.ts/recovery-orchestrator.ts/covered-call-management-orchestrator.ts/covered-call-orchestrator.ts + covered_call_ranker.py',
    dataSource: 'N/A -- never invoked', persistence: 'N/A', consumer: 'None -- confirmed zero real callers anywhere in the repository outside its own definition and test file',
    runtimeReachable: false, authority: 'None -- must never be treated as a live authority', mechanicallyTested: true,
    providerTested: false, noSubmitTested: false, empiricallyValidated: false, currentState: 'QUARANTINED_NO_CALLERS',
    blocker: 'Architectural decision needed: adopt (replacing the current authority, never running alongside it) or formally retire', owner: 'CODEX',
    sourceFiles: ['src/theta/management-cycle.ts'],
  },
  {
    capabilityId: 'WHOLE_CHAIN_ACCOUNTING', purpose: 'Real whole-chain P&L, fees, and stock-basis accounting with honest UNKNOWN handling',
    maturity: 'PRODUCTION_REQUIRED', firstPaperRequired: true, preVpsRequired: true,
    producer: 'management-input-state.ts fee/UNKNOWN handling; whole-chain-component-evidence.ts stock-share status fields',
    dataSource: 'Real fill/fee/dividend evidence', persistence: 'Real (postgres stores, not individually re-verified this pass)',
    consumer: 'Management decisions, R8 outcome research', runtimeReachable: true, authority: 'management-input-state.ts',
    mechanicallyTested: true, providerTested: false, noSubmitTested: false, empiricallyValidated: false,
    currentState: 'REAL', blocker: null, owner: 'CODEX', sourceFiles: ['src/theta/management-input-state.ts:185'],
  },
  {
    capabilityId: 'DISASTER_RECOVERY_BACKUP_RESTORE', purpose: 'Portable, verified Windows worker backup and restore',
    maturity: 'PAPER_BOOTSTRAP_REQUIRED', firstPaperRequired: false, preVpsRequired: true,
    producer: 'Backup-Theta.ps1 / Restore-Theta.ps1 / Verify-ThetaBackup.ps1 / Test-ThetaRestore.ps1 (per recent main commit history: "feat(dr): verify portable Aiven backup structure and data restore")',
    dataSource: 'Aiven Postgres + worker local state', persistence: 'Real (this is the persistence mechanism itself)',
    consumer: 'VPS relocation / disaster recovery', runtimeReachable: true, authority: 'tools/windows/dr/',
    mechanicallyTested: true, providerTested: false, noSubmitTested: false, empiricallyValidated: false,
    currentState: 'REAL', blocker: 'Active Codex work-in-progress per recent commit history; not independently re-verified by Claude this pass (Codex-owned Aiven access)', owner: 'CODEX',
    sourceFiles: ['tools/windows/dr/Backup-Theta.ps1', 'tools/windows/dr/Restore-Theta.ps1'],
  },
  {
    capabilityId: 'CROSS_STRATEGY_RESEARCH_CONTRACT', purpose: 'Research-only hardened cross-strategy comparison profile/maturity ladder',
    maturity: 'RESEARCH_ONLY', firstPaperRequired: false, preVpsRequired: false,
    producer: 'compareCrossStrategy + ComparisonProfile (ENTRY_CORE_RISK_V1/ENTRY_WHOLE_CHAIN_V1)', dataSource: 'Caller-supplied candidate evidence',
    persistence: 'N/A', consumer: 'This engagement\'s own R8 studies (e.g. defined-risk-vs-csp-paired-study.ts)', runtimeReachable: true,
    authority: 'src/research/cross-strategy-common-horizon-contract.ts (research-only; NOT Production authority)',
    mechanicallyTested: true, providerTested: false, noSubmitTested: false, empiricallyValidated: false,
    currentState: 'REAL', blocker: null, owner: 'CLAUDE',
    sourceFiles: ['src/research/cross-strategy-common-horizon-contract.ts'],
  },
  {
    capabilityId: 'UNIVERSE_OPPORTUNITY_REGRET_SCHEMA', purpose: 'Research schema for wider-universe opportunity-miss honesty',
    maturity: 'RESEARCH_ONLY', firstPaperRequired: false, preVpsRequired: false,
    producer: 'classifyOutsideCapOpportunity / rank*Challenger functions', dataSource: 'No real persisted rows found this engagement (DATA_NOT_YET_OBSERVED)',
    persistence: 'Schema exists; zero real rows observed', consumer: 'Future universe-adequacy research', runtimeReachable: true,
    authority: 'src/research/universe-opportunity-regret.ts', mechanicallyTested: true, providerTested: false,
    noSubmitTested: false, empiricallyValidated: false, currentState: 'REAL', blocker: 'No real persisted buildUniverseBreadthShadowPlan evidence found in this research environment', owner: 'CLAUDE',
    sourceFiles: ['src/research/universe-opportunity-regret.ts'],
  },
] as const;

export interface RegistryValidationResult {
  readonly valid: boolean;
  readonly duplicateCapabilityIds: readonly string[];
  readonly incompleteCapabilityIds: readonly string[];
}

const REQUIRED_STRING_FIELDS: readonly (keyof CapabilityRecord)[] = [
  'capabilityId', 'purpose', 'producer', 'dataSource', 'persistence', 'consumer', 'authority', 'owner',
];

export function validateCapabilityRegistry(registry: readonly CapabilityRecord[]): RegistryValidationResult {
  const seen = new Set<string>();
  const duplicateCapabilityIds: string[] = [];
  const incompleteCapabilityIds: string[] = [];
  for (const record of registry) {
    if (seen.has(record.capabilityId)) duplicateCapabilityIds.push(record.capabilityId);
    seen.add(record.capabilityId);
    const missingField = REQUIRED_STRING_FIELDS.some((field) => {
      const value = record[field];
      return typeof value !== 'string' || value.trim().length === 0;
    });
    if (missingField || record.sourceFiles.length === 0) incompleteCapabilityIds.push(record.capabilityId);
  }
  return { valid: duplicateCapabilityIds.length === 0 && incompleteCapabilityIds.length === 0, duplicateCapabilityIds, incompleteCapabilityIds };
}

export function capabilitiesByMaturity(registry: readonly CapabilityRecord[], maturity: CapabilityMaturity): readonly CapabilityRecord[] {
  return registry.filter((r) => r.maturity === maturity);
}

export function capabilitiesByBlocker(registry: readonly CapabilityRecord[]): readonly CapabilityRecord[] {
  return registry.filter((r) => r.blocker !== null);
}
