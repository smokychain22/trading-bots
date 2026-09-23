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
    currentState: 'REAL', blocker: 'Persisted September 21 evidence: 3,299 of 3,876 candidates were non-executable, with 2,014 stale+wide, 787 wide-only, and 498 stale-only quote reasons. This does not justify weakening the freshness or spread gate.', owner: 'CODEX', sourceFiles: ['src/theta/alpaca-provider.ts:365'],
  },
  {
    capabilityId: 'CONTRACT_MULTIPLIER_MAPPING', purpose: 'Correctly read a real per-contract share multiplier',
    maturity: 'PRODUCTION_REQUIRED', firstPaperRequired: true, preVpsRequired: true,
    producer: 'asNumberOrNull(c.size)', dataSource: 'Alpaca /v2/options/contracts field `size`', persistence: 'N/A',
    consumer: 'option-chain-ingestion.ts executability gate (forces executable=false when null)', runtimeReachable: true,
    authority: 'alpaca-provider.ts:337', mechanicallyTested: false, providerTested: false, noSubmitTested: false, empiricallyValidated: false,
    currentState: 'NOT_INDEPENDENTLY_VERIFIED',
    blocker: 'Direct live Alpaca multiplier metadata still needs verification. The persisted 3,299 CONTRACT_NOT_EXECUTABLE details identify stale and/or wide quotes, not multiplier failure; do not attribute that cohort to this mapping without new evidence.',
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
    capabilityId: 'AEGIS_SYSTEM_LIQUIDITY_STRESS', purpose: 'IV-shock / gap / spread-widening stress detection feeding the AEGIS SYSTEM and LIQUIDITY risk families',
    maturity: 'PRODUCTION_REQUIRED', firstPaperRequired: true, preVpsRequired: true,
    producer: 'stressGapDetected is real; aegis-iv-stress.ts produces stressIvShockDetected from exact-session Optionomics ATM IV; aegis-spread-stress.ts produces per-contract stressSpreadWideningDetected from persisted Alpaca BBO cohorts',
    dataSource: 'Optionomics METRICS atm_iv for IV stress; research.option_contract_risk_history Alpaca BBO observations for spread stress',
    persistence: 'market.optionomics_iv_session_observation + risk.aegis_iv_stress_assessment; spread assessment lineage is embedded in the immutable cycle FusionSnapshot', consumer: '_system() and _liquidity() in bots/theta/quant/models/aegis.py through candidate-specific overrides',
    runtimeReachable: 'PARTIAL',
    authority: 'assess_aegis() (:172-193) folds every family through worst-family-wins into new_risk_state; _NEW_RISK_ACTIONS_BY_STATE[HOLD_ONLY] = frozenset() (confirmed by direct read)',
    mechanicallyTested: true, providerTested: true, noSubmitTested: false, empiricallyValidated: false,
    currentState: 'PARTIAL',
    blocker: 'P0 runtime verification remains -- migration 065, authenticated IV backfill, spread-cohort maturity, current-main no-submit, and locked worker observation must pass. Source wiring no longer depends on null stress suppliers.',
    owner: 'CODEX',
    sourceFiles: ['bots/theta/quant/models/aegis.py', 'src/theta/aegis-iv-stress.ts', 'src/theta/aegis-spread-stress.ts', 'src/research/aegis-stress-baseline-maturity.ts', 'src/research/production-shadow-runtime.ts', 'src/theta/aegis-derivation.ts', 'src/theta/account-exposure.ts'],
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
    dataSource: 'ProductionPaperManagementCandidateSource, via ManagementInputState.managementCandidateDiscovery (real, array-based)', persistence: 'Real -- candidateDiscovery persisted on the management input state',
    consumer: 'Management action selection (ROLL/SELL_CC/ROLL_CC)', runtimeReachable: true,
    authority: 'paper-bootstrap-management-policy.ts', mechanicallyTested: true, providerTested: false,
    noSubmitTested: false, empiricallyValidated: false, currentState: 'REAL',
    blocker: 'CORRECTED (Wave 9 recheck, after this engagement\'s own earlier Q-9 finding was found to be a false positive on direct re-read): PaperBootstrapManagementPolicyProvider.evaluate() (paper-bootstrap-management-policy.ts:1136-1159) reads state.managementCandidateDiscovery independently of the constructor\'s noCandidates default, and prefers discovered?.rollCandidates/ccCandidates/rollCcCandidates ?? the singular fallback. Real array-based candidates DO reach valueForRollFromCandidates/valueForRollCcFromCandidates/valueForSellCcFromCandidates when discovery.state===READY and quotes are PIT-timely. Verified by direct source read, not assumed.', owner: 'CODEX',
    sourceFiles: ['src/theta/paper-bootstrap-management-policy.ts:1136-1159', 'src/theta/paper-bootstrap-management-policy.ts:422-580'],
  },
  {
    capabilityId: 'ROLL_CC_CANDIDATE_SOURCE', purpose: 'Discover real roll/CC candidates from the live contract lattice for an open chain',
    maturity: 'PRODUCTION_REQUIRED', firstPaperRequired: true, preVpsRequired: true,
    producer: 'REAL (corrected Wave 9): ProductionPaperManagementCandidateSource (autonomous-runtime.ts:429) discovers real candidates, feeds managementStore.assembleAndPersistOpenChains(), and the resulting ManagementInputState.managementCandidateDiscovery is read directly by PaperBootstrapManagementPolicyProvider.evaluate() -- a path independent of managementPolicyEvidenceProvider\'s constructor default. The earlier finding that createPaperBootstrapManagementPolicyProvider() being called with zero arguments (autonomous-runtime.ts:353-354) blocks the array-based candidates was a false positive: that default only governs the SINGULAR rollCandidate/ccCandidate fallback fields (used only when the array is empty/undefined or discovery is not READY/PIT-timely), not the real discovered arrays.',
    dataSource: 'Real -- ProductionPaperManagementCandidateSource', persistence: 'Real -- candidateDiscovery is persisted on the management input state',
    consumer: 'ROLL_CC_CANDIDATE_VALUATION (now real)', runtimeReachable: true,
    authority: 'autonomous-runtime.ts:429 (discovery) / management-input-state.ts (persistence) / paper-bootstrap-management-policy.ts:1136-1159 (consumption)',
    mechanicallyTested: true, providerTested: false, noSubmitTested: false, empiricallyValidated: false,
    currentState: 'REAL', blocker: 'No wiring defect. The one remaining real gap is narrower and different in kind: the SINGULAR rollCandidate/ccCandidate fallback (paper-bootstrap-management-policy.ts:365-420, 962-970) only activates when discovery legitimately found zero candidates or discovery/quotes were not READY/PIT-timely -- that fallback always resolves to UNKNOWN_VALUE given the unchanged noCandidates default, but this is the array path correctly taking priority, not a defect requiring a Codex task.', owner: 'CODEX',
    sourceFiles: ['src/theta/autonomous-runtime.ts:429', 'src/theta/management-input-state.ts', 'src/theta/paper-bootstrap-management-policy.ts:1136-1159'],
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
  {
    capabilityId: 'EVENT_RISK_STATE', purpose: 'Tri-state (PRESENT/ABSENT_VERIFIED/UNKNOWN) event/dividend/early-exercise risk flag consumed by management and covered-call lattice decisions -- UNKNOWN is structurally distinct from ABSENT_VERIFIED and never silently treated as safe',
    maturity: 'PRODUCTION_REQUIRED', firstPaperRequired: true, preVpsRequired: true,
    producer: 'eventRiskPenaltyContribution / isEventRiskUnknown (this module is a pure tri-state penalty/uncertainty helper; the actual PRESENT/ABSENT_VERIFIED determination must be supplied by the caller -- see CORPORATE_ACTION_EVIDENCE for the real underlying data producer)',
    dataSource: 'Caller-supplied (no independent data fetch inside this module)', persistence: 'N/A (pure function)',
    consumer: 'paper-bootstrap-management-policy.ts, covered-call-lattice.ts (Production management path); recovery-covered-call-cohort.ts, hold-the-strike-applicability.ts, hold-strike-empirical-cohort.ts (research); referenced by tools/theta-runtime-wiring-audit.ts',
    runtimeReachable: true, authority: 'src/theta/event-risk-state.ts',
    mechanicallyTested: false, providerTested: false, noSubmitTested: false, empiricallyValidated: false,
    currentState: 'PARTIAL',
    blocker: 'Reconciliation Slice 15 finding: was entirely absent from this registry despite two real Production consumers. No dedicated test file found (no tests/event-risk-state.test.ts); whether Production callers ever supply a real non-UNKNOWN determination (vs. always defaulting to UNKNOWN) was not independently re-derived this pass.',
    owner: 'CODEX', sourceFiles: ['src/theta/event-risk-state.ts', 'src/theta/paper-bootstrap-management-policy.ts', 'src/theta/covered-call-lattice.ts'],
  },
  {
    capabilityId: 'OWNERSHIP_CONTRACT', purpose: 'Ownability scoring contract (LiquidityQuality x StructuralQuality x RecoveryQuality x TailQuality x EventAdjustment, carried as individually visible component scores per TRD CAND-003) gating strike/underlying acceptability',
    maturity: 'PRODUCTION_REQUIRED', firstPaperRequired: true, preVpsRequired: true,
    producer: 'ownershipEvaluationResponseSchema bridge to bots/theta/quant/runtime/ownership_contract.py (ownership_v0.py model)',
    dataSource: 'Component scores computed by the Python ownership model, bridged via ownership-contract.ts', persistence: 'Not independently verified this pass',
    consumer: 'universe-discovery.ts, paper-entry-bootstrap.ts, new-risk-orchestrator.ts, decision-assembly.ts (Production); hold-strike-empirical-cohort.ts, evidence-completeness-diagnostic.ts (research); referenced by tools/theta-runtime-wiring-audit.ts',
    runtimeReachable: true, authority: 'src/theta/ownership-contract.ts + bots/theta/quant/runtime/ownership_contract.py',
    mechanicallyTested: true, providerTested: false, noSubmitTested: false, empiricallyValidated: false,
    currentState: 'NOT_INDEPENDENTLY_VERIFIED',
    blocker: 'Reconciliation Slice 15 finding: was entirely absent from this registry despite being a real, multi-site Production consumer with its own test file (tests/ownership-contract.test.ts, tests/decision-assembly.test.ts, tests/paper-entry-bootstrap.test.ts). A registry completeness gap, not a known capability defect -- component-score numerical correctness not re-derived this pass.',
    owner: 'CODEX', sourceFiles: ['src/theta/ownership-contract.ts', 'src/theta/new-risk-orchestrator.ts', 'src/theta/decision-assembly.ts', 'bots/theta/quant/runtime/ownership_contract.py'],
  },
  {
    capabilityId: 'CORRELATION_EVIDENCE', purpose: 'Pairwise historical-bar correlation evidence between underlyings (KNOWN/UNKNOWN per pair, honest missing-overlap handling) -- a DIFFERENT capability from AEGIS_SECTOR_CORRELATION\'s production sector-proxy and must not be conflated with it',
    maturity: 'RESEARCH_ONLY', firstPaperRequired: false, preVpsRequired: false,
    producer: 'CorrelationEvidence builder (src/theta/correlation-evidence.ts, reads Alpaca bars via underlying-history.ts)',
    dataSource: 'Alpaca historical bars', persistence: 'Not independently verified this pass',
    consumer: 'src/research/correlation-cluster-research.ts, src/research/correlation-cluster-real-data-runner.ts, src/research/risk-policy-empirical-study.ts -- ALL research-only; zero Production or AEGIS callers found this pass',
    runtimeReachable: 'PARTIAL', authority: 'src/theta/correlation-evidence.ts',
    mechanicallyTested: true, providerTested: false, noSubmitTested: false, empiricallyValidated: false,
    currentState: 'REAL',
    blocker: 'Reconciliation Slice 15 finding: was entirely absent from this registry. Risk of being mistaken for closing the real multi-position AEGIS_SECTOR_CORRELATION gap documented elsewhere in this registry -- it does NOT close that gap; that producer (account-exposure.ts soleRiskGroup proxy) is a separate module with no dependency on this one.',
    owner: 'CLAUDE', sourceFiles: ['src/theta/correlation-evidence.ts', 'src/research/correlation-cluster-research.ts'],
  },
  {
    capabilityId: 'HAR_RV_CONTRACT', purpose: 'HAR-RV (Heterogeneous Autoregressive Realized Volatility) 1-day-horizon forecast contract -- self-documented in-file as research/shadow only, no live Production caller, no broker authority',
    maturity: 'RESEARCH_ONLY', firstPaperRequired: false, preVpsRequired: false,
    producer: 'har_rv_contract.py via harRvRequestSchema/harRvResponseSchema bridge (JSON boundary around realized_volatility.py)',
    dataSource: 'Caller-supplied realized variance series', persistence: 'N/A',
    consumer: 'src/research/har-rv-shadow.ts only', runtimeReachable: true,
    authority: 'src/theta/har-rv-contract.ts + bots/theta/quant/runtime/har_rv_contract.py',
    mechanicallyTested: true, providerTested: false, noSubmitTested: false, empiricallyValidated: false,
    currentState: 'REAL',
    blocker: 'Reconciliation Slice 15 finding: was entirely absent from this registry; otherwise matches its own documented research/shadow-only scope with no discrepancy found.',
    owner: 'CLAUDE', sourceFiles: ['src/theta/har-rv-contract.ts', 'src/research/har-rv-shadow.ts'],
  },
  {
    capabilityId: 'OPTIONOMICS_FEATURE_ENGINE', purpose: 'Normalizes real Optionomics chain/context/flow observations into typed KNOWN/UNKNOWN/INVALID feature states (IV, RV, VRP-adjacent, Greeks, flow) -- the primary feature-normalization surface for the TRD\'s second sanctioned provider',
    maturity: 'SHADOW_REQUIRED', firstPaperRequired: false, preVpsRequired: true,
    producer: 'optionomics-feature-engine.ts (FeatureValue<T> KNOWN/UNKNOWN/INVALID normalization of NormalizedOptionomicsChain/ContextObservation/FlowWindow)',
    dataSource: 'Optionomics API via optionomics-provider.ts', persistence: 'postgres-theta-cycle-store.ts references it; not independently verified this pass whether it persists engine output itself or only cycle metadata',
    consumer: 'theta-shadow-cycle.ts (confirmed shadow), options-chain-decision-intelligence.ts, postgres-theta-cycle-store.ts; src/research/volatility-risk-premium.ts (research)',
    runtimeReachable: 'PARTIAL', authority: 'src/theta/optionomics-feature-engine.ts',
    mechanicallyTested: true, providerTested: false, noSubmitTested: false, empiricallyValidated: false,
    currentState: 'NOT_INDEPENDENTLY_VERIFIED',
    blocker: 'Reconciliation Slice 15 finding: entirely absent from this registry despite being the primary Optionomics IV/RV/VRP/Greeks/flow surface. Whether options-chain-decision-intelligence.ts is itself a live Production decision path or a shadow/diagnostic-only path was NOT independently re-verified this pass -- flagged for Codex confirmation rather than asserted either way; maturity/preVpsRequired set from the confirmed theta-shadow-cycle.ts consumer only.',
    owner: 'CODEX', sourceFiles: ['src/theta/optionomics-feature-engine.ts', 'src/theta/theta-shadow-cycle.ts', 'src/theta/options-chain-decision-intelligence.ts'],
  },
  {
    capabilityId: 'CORRELATION_WINDOW_STABILITY', purpose: 'Classifies whether a symbol pair\'s pairwise correlation (from CORRELATION_EVIDENCE) is stable across multiple lookback windows (20/60/120-session default) or regime-dependent (sign flip / unstable magnitude) -- answers a question single-window correlation cannot',
    maturity: 'RESEARCH_ONLY', firstPaperRequired: false, preVpsRequired: false,
    producer: 'buildCorrelationWindowStabilityReport (composes the existing buildCorrelationEvidence once per window; never recomputes a correlation value itself)',
    dataSource: 'CorrelationEvidence output (src/theta/correlation-evidence.ts) at multiple lookbackBars values', persistence: 'N/A',
    consumer: 'None yet -- new this pass, zero real callers', runtimeReachable: true,
    authority: 'src/research/correlation-window-stability.ts', mechanicallyTested: true, providerTested: false,
    noSubmitTested: false, empiricallyValidated: false, currentState: 'REAL',
    blocker: 'Zero real callers as of introduction (Wave 2 Slice 17); not yet exercised against real multi-year bar history -- see THETA_CORRELATION_SEVERE_DOWNSIDE_TOOLING_2026-09-22.md',
    owner: 'CLAUDE', sourceFiles: ['src/research/correlation-window-stability.ts', 'src/theta/correlation-evidence.ts'],
  },
  // --- Wave 6 Batch 2 additions: real coverage gaps found against the
  // directive's named decision-capability domain list (routing, execution
  // quality, assignment capacity, recovery lifecycle, copy engine,
  // volatility, empirical learning), closed by extending THIS registry --
  // no second/third registry created.
  {
    capabilityId: 'STRATEGY_ROUTING', purpose: 'Per-cycle eligibility for all 6 real strategy families (THETA_Q/H/R/A/C/D)',
    maturity: 'PRODUCTION_REQUIRED', firstPaperRequired: true, preVpsRequired: true,
    producer: 'route_strategies (Python)', dataSource: 'Real cycle inputs assembled by new-risk-orchestrator.ts',
    persistence: 'Full routing.results persisted on the cycle row (postgres-theta-cycle-store.ts)',
    consumer: 'new-risk-orchestrator.ts (only thetaQEligible acted on for real control flow today); shadow-strategy-orchestrator.ts (research, all 6 families)',
    runtimeReachable: true, authority: 'bots/theta/quant/models/strategy_router.py via strategy-router-contract.ts',
    mechanicallyTested: true, providerTested: false, noSubmitTested: false, empiricallyValidated: false,
    currentState: 'REAL', blocker: 'Only THETA_Q eligibility drives real control flow; H/A/C/D eligibility is real and persisted but not acted on by Production today',
    owner: 'SHARED', sourceFiles: ['src/theta/strategy-router-contract.ts', 'src/theta/new-risk-orchestrator.ts', 'bots/theta/quant/models/strategy_router.py'],
  },
  {
    capabilityId: 'EXECUTION_QUALITY', purpose: 'Real spread/slippage/fill-quality assessment feeding sizing and AEGIS',
    maturity: 'PRODUCTION_REQUIRED', firstPaperRequired: true, preVpsRequired: true,
    producer: 'execution_quality_contract.py (Python bridge)', dataSource: 'Real BBO/spread evidence',
    persistence: 'Not independently verified this pass', consumer: 'AEGIS liquidity/execution-quality inputs',
    runtimeReachable: true, authority: 'bots/theta/quant/runtime/execution_quality_contract.py',
    mechanicallyTested: true, providerTested: false, noSubmitTested: false, empiricallyValidated: false,
    currentState: 'REAL', blocker: null,
    owner: 'CODEX', sourceFiles: ['bots/theta/quant/runtime/execution_quality_contract.py', 'src/theta/theta-shadow-once.ts'],
  },
  {
    capabilityId: 'ASSIGNMENT_CAPACITY', purpose: 'Real contract-count capacity gating entry sizing and ACCEPT_ASSIGNMENT',
    maturity: 'PRODUCTION_REQUIRED', firstPaperRequired: true, preVpsRequired: true,
    producer: 'CLOSED (Wave 9, verified against main 1ca3e27): canonical-strategy-frontier.ts (entry-time, real fallback derivation); management-input-state.ts now computes real assignmentCapacity/assignmentCapacityEvidence directly (broker-backed, PIT-gated via accountFreshForCapacity) -- main b9cd49a/e64d554/6a359a0/52e6ea5.',
    dataSource: 'Buying power / collateral', persistence: 'Persisted per-candidate (postgres-theta-cycle-store.ts)',
    consumer: 'Entry sizing (canonical-strategy-frontier.ts); management-action-frontier.ts ACCEPT_ASSIGNMENT gate',
    runtimeReachable: true, authority: 'src/theta/canonical-strategy-frontier.ts / src/theta/management-input-state.ts',
    mechanicallyTested: true, providerTested: false, noSubmitTested: false, empiricallyValidated: false,
    currentState: 'REAL',
    blocker: null,
    owner: 'CODEX', sourceFiles: ['src/theta/canonical-strategy-frontier.ts', 'src/theta/management-input-state.ts', 'src/theta/management-action-frontier.ts'],
  },
  {
    capabilityId: 'RECOVERY_LIFECYCLE', purpose: 'RECOVERY_WAIT / SELL_STOCK / SELL_CC transitions after assignment',
    maturity: 'PRODUCTION_REQUIRED', firstPaperRequired: true, preVpsRequired: false,
    producer: 'canonicalThetaStrategyRegistry (THETA_RECOVERY branch, status SHADOW)', dataSource: 'Real stock position + ownership context',
    persistence: 'Not independently verified this pass', consumer: 'management-action-frontier.ts (RECOVERY_WAIT/SELL_STOCK/SELL_CC allowedActions)',
    runtimeReachable: 'PARTIAL', authority: 'src/theta/strategy-package.ts (THETA_RECOVERY lattice) / recovery_contract.py (Python, UNWIRED per THETA_METHOD_USAGE_CENSUS.md)',
    mechanicallyTested: true, providerTested: false, noSubmitTested: false, empiricallyValidated: false,
    currentState: 'PARTIAL',
    blocker: 'recovery_contract.py exists but is never referenced by the TS Python bridge allowlist in either real wiring site (theta-shadow-once.ts, production-shadow-runtime.ts) -- real file-level finding from the Wave 6 method census.',
    owner: 'SHARED', sourceFiles: ['src/theta/strategy-package.ts', 'bots/theta/quant/runtime/recovery_contract.py', 'src/theta/management-action-frontier.ts'],
  },
  {
    capabilityId: 'COPY_ENGINE', purpose: 'Follower account risk-capacity mirroring for future multi-account copy execution',
    maturity: 'PAPER_BOOTSTRAP_REQUIRED', firstPaperRequired: false, preVpsRequired: false,
    producer: 'copy-engine-contract.ts', dataSource: 'Follower account risk-capacity fields (assignmentCapacityContracts, tailCapacityContracts)',
    persistence: 'Not independently verified this pass', consumer: 'Not independently verified this pass -- follower execution stays locked per docs/operations/THETA_IMPLEMENTATION_BOARD.md',
    runtimeReachable: false, authority: 'src/customer/copy-engine-contract.ts',
    mechanicallyTested: false, providerTested: false, noSubmitTested: false, empiricallyValidated: false,
    currentState: 'NOT_INDEPENDENTLY_VERIFIED', blocker: 'Follower execution is explicitly locked (no live-money authority) -- this capability is pre-graduation infrastructure, not currently exercised',
    owner: 'CODEX', sourceFiles: ['src/customer/copy-engine-contract.ts'],
  },
  {
    capabilityId: 'VOLATILITY_SURFACE', purpose: 'IV/RV/VRP/skew/term-structure features feeding candidate soft evidence',
    maturity: 'PRODUCTION_REQUIRED', firstPaperRequired: true, preVpsRequired: true,
    producer: 'optionomics-feature-engine.ts; har_rv_contract.py (UNWIRED per method census)', dataSource: 'Optionomics MCP IV/RV/GEX endpoints',
    persistence: 'Not independently verified this pass', consumer: 'Candidate soft-feature evidence (canonical-strategy-frontier.ts softFeatureFamilies: IV, SKEW, TERM_STRUCTURE, REALIZED_VOLATILITY)',
    runtimeReachable: 'PARTIAL', authority: 'src/theta/optionomics-feature-engine.ts',
    mechanicallyTested: true, providerTested: true, noSubmitTested: false, empiricallyValidated: false,
    currentState: 'PARTIAL',
    blocker: 'RV5/RV10/RV30/RV60 derivation methodology vs. native rv20, expected-move derivation, and historical GEX PIT status remain unresolved open questions (Batch 7/M -- not yet re-addressed this pass)',
    owner: 'CLAUDE', sourceFiles: ['src/theta/optionomics-feature-engine.ts', 'bots/theta/quant/runtime/har_rv_contract.py'],
  },
  {
    capabilityId: 'EMPIRICAL_LEARNING_GOVERNANCE', purpose: 'R8 data-sufficiency and model-promotion governance -- the gate between research and any empirical claim',
    maturity: 'RESEARCH_ONLY', firstPaperRequired: false, preVpsRequired: false,
    producer: 'R8 metric catalog / data sufficiency / model governance docs', dataSource: 'Real matured Paper cycle outcomes (not yet sufficient)',
    persistence: 'Not independently verified this pass', consumer: 'Any future model-promotion decision',
    runtimeReachable: false, authority: 'docs/research/THETA_R8_* (metric catalog, data sufficiency, model governance)',
    mechanicallyTested: false, providerTested: false, noSubmitTested: false, empiricallyValidated: false,
    currentState: 'NOT_INDEPENDENTLY_VERIFIED', blocker: 'Real matured, independent-N Paper outcome data does not yet exist in sufficient quantity -- this is expected at this phase, not a defect',
    owner: 'CLAUDE', sourceFiles: ['docs/research/'],
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
