export const paperBootstrapRuntimePolicyVersion = 'theta-paper-bootstrap-runtime-policy-v3' as const;

// One source of truth for the deterministic Paper-bootstrap controls that are
// shared by candidate construction, risk, sizing, and the final read-only
// pre-submit qualification. These are engineering/bootstrap settings. They do
// not claim empirical optimality or profitability.
export const paperBootstrapRuntimePolicy = Object.freeze({
  policyVersion: paperBootstrapRuntimePolicyVersion,
  effectiveAt: '2026-09-01T00:00:00.000Z',
  authority: 'PAPER_BOOTSTRAP_ENGINEERING' as const,
  empiricalStatus: 'BOOTSTRAP_NOT_EMPIRICALLY_OPTIMAL' as const,
  conventional: Object.freeze({
    minimumDte: 25,
    maximumDte: 60,
    deltaBands: Object.freeze([[0, 0.25], [0.25, 0.5]] as const),
    minimumOpenInterest: 50,
    minimumVolume: 10,
    maximumSpreadPct: 0.15,
    // Q-EARN-UNIT-001 (OWNER_POLICY): the runtime compares this against earningsEvidence.distanceTradingSessions (Optionomics
    // expected_moves.earnings_in_sessions), i.e. TRADING SESSIONS. The frozen TRD says only "earnings exclusion default" and "days to
    // event" with no number or calendar/session unit, so the unit is an owner decision; no calendar-day conversion is established.
    earningsExclusionDays: 5,
  }),
  // Q-OWN-FLOOR-001: the THETA-Q ownership-acceptability floor (router eligibility and Q candidate-stage floor). The value 0.3 is
  // unchanged from the former inline literals in theta-shadow-once.ts; v3 only registers it.
  ownership: Object.freeze({
    thetaQAcceptabilityFloor: 0.3,
  }),
  /**
   * QUOTE_FRESHNESS_CONTRACT (theta-quote-freshness-contract-v1). Three DIFFERENT, deliberately separate clocks:
   *  - DECISION_EVIDENCE_MAX_AGE: candidate/finalist/management stock quotes used to DECIDE (30 s).
   *  - PLAN_WINDOW: how long a published plan authorizes a broker action after its evidence was frozen. New-risk plans (shadow
   *    runtime) get 45 s, management plans 30 s (the reconciliation snapshot is the evidence time and management never trades
   *    on older evidence than it decides on).
   *  - SUBMIT_EVIDENCE_MAX_AGE (`preSubmitMaximumMilliseconds`): the cap on the age of the BBO used to PRICE the order at submit.
   *    The handoff applies min(cap, time left in the plan window), so a fresh decision can never justify a stale submit, and the
   *    cap equals the longest plan window (45 s) so it is never the looser of the two for any plan.
   */
  quoteAge: Object.freeze({
    candidateMaximumSeconds: 30,
    finalistMaximumSeconds: 30,
    preSubmitMaximumMilliseconds: 45_000,
    planWindowNewRiskMilliseconds: 45_000,
    planWindowManagementMilliseconds: 30_000,
    goodMaximumSeconds: 10,
    staleMinimumSeconds: 60,
  }),
  sizing: Object.freeze({
    riskBudgetQuantityCap: 4,
    collateralQuantityCap: 3,
    concentrationQuantityCap: 5,
    assignmentCapacityQuantityCap: 6,
    tailRiskQuantityCap: 3,
    correlationQuantityCap: 3,
    liquidityQuantityCap: 3,
    reducedStateMultiplier: 0.5,
  }),
  aegis: Object.freeze({
    hardCapMultiplier: 1.5,
    compoundStressHoldCount: 2,
    maximumTickerConcentrationPct: 0.15,
    maximumSectorConcentrationPct: 0.3,
    maximumCorrelationClusterPct: 0.3,
    maximumPortfolioCapitalAtRiskPct: 0.5,
    maximumInventoryCapacityPct: 0.5,
    maximumAssignmentCapacityPct: 0.5,
    maximumRecoveryCapacityPct: 0.3,
    stressGapThresholdAbsoluteReturn: 0.05,
  }),
  portfolioCorrelation: Object.freeze({
    policyVersion: 'theta-portfolio-correlation-paper-bootstrap-v1',
    maximumHeldSymbols: 20,
    lookbackSessions: 60,
    minimumOverlappingReturns: 20,
    maxBarAgeCalendarDays: 5,
  }),
});

export type PresessionConfigurationRole = 'HARD_SAFETY' | 'STRUCTURAL_FILTER' | 'SIZING_LIMIT';

export interface PresessionConfigurationEntry {
  readonly name: string;
  readonly value: number | readonly (readonly [number, number])[];
  readonly unit: 'SECONDS' | 'MILLISECONDS' | 'DAYS' | 'PERCENT_FRACTION' | 'COUNT' | 'MULTIPLIER' | 'DELTA_BANDS';
  readonly role: PresessionConfigurationRole;
  readonly consumer: string;
  readonly authority: typeof paperBootstrapRuntimePolicy.authority;
  readonly policyVersion: typeof paperBootstrapRuntimePolicyVersion;
}

const entry = (name: string, value: PresessionConfigurationEntry['value'], unit: PresessionConfigurationEntry['unit'],
  role: PresessionConfigurationRole, consumer: string): PresessionConfigurationEntry => ({
  name, value, unit, role, consumer,
  authority: paperBootstrapRuntimePolicy.authority,
  policyVersion: paperBootstrapRuntimePolicyVersion,
});

export const presessionConfigurationRegistry: readonly PresessionConfigurationEntry[] = Object.freeze([
  entry('quote.candidateMaximumSeconds', paperBootstrapRuntimePolicy.quoteAge.candidateMaximumSeconds, 'SECONDS', 'HARD_SAFETY', 'ThetaShadowCycle'),
  entry('quote.finalistMaximumSeconds', paperBootstrapRuntimePolicy.quoteAge.finalistMaximumSeconds, 'SECONDS', 'HARD_SAFETY', 'FinalistQuoteRefresh'),
  entry('quote.preSubmitMaximumMilliseconds', paperBootstrapRuntimePolicy.quoteAge.preSubmitMaximumMilliseconds, 'MILLISECONDS', 'HARD_SAFETY', 'MasterPaperActionHandoff'),
  entry('quote.planWindowNewRiskMilliseconds', paperBootstrapRuntimePolicy.quoteAge.planWindowNewRiskMilliseconds, 'MILLISECONDS', 'HARD_SAFETY', 'ProductionShadowRuntime'),
  entry('quote.planWindowManagementMilliseconds', paperBootstrapRuntimePolicy.quoteAge.planWindowManagementMilliseconds, 'MILLISECONDS', 'HARD_SAFETY', 'AutonomousRuntimeManagement'),
  entry('quote.goodMaximumSeconds', paperBootstrapRuntimePolicy.quoteAge.goodMaximumSeconds, 'SECONDS', 'STRUCTURAL_FILTER', 'OptionQuoteFreshness'),
  entry('quote.staleMinimumSeconds', paperBootstrapRuntimePolicy.quoteAge.staleMinimumSeconds, 'SECONDS', 'HARD_SAFETY', 'OptionQuoteFreshness'),
  entry('conventional.minimumDte', paperBootstrapRuntimePolicy.conventional.minimumDte, 'DAYS', 'STRUCTURAL_FILTER', 'ThetaQCandidateLattice'),
  entry('conventional.maximumDte', paperBootstrapRuntimePolicy.conventional.maximumDte, 'DAYS', 'STRUCTURAL_FILTER', 'ThetaQCandidateLattice'),
  entry('conventional.deltaBands', paperBootstrapRuntimePolicy.conventional.deltaBands, 'DELTA_BANDS', 'STRUCTURAL_FILTER', 'ThetaQCandidateLattice'),
  entry('conventional.minimumOpenInterest', paperBootstrapRuntimePolicy.conventional.minimumOpenInterest, 'COUNT', 'STRUCTURAL_FILTER', 'ThetaQCandidateLattice'),
  entry('conventional.minimumVolume', paperBootstrapRuntimePolicy.conventional.minimumVolume, 'COUNT', 'STRUCTURAL_FILTER', 'ThetaQCandidateLattice'),
  entry('conventional.maximumSpreadPct', paperBootstrapRuntimePolicy.conventional.maximumSpreadPct, 'PERCENT_FRACTION', 'HARD_SAFETY', 'ExecutionQuality'),
  entry('conventional.earningsExclusionDays', paperBootstrapRuntimePolicy.conventional.earningsExclusionDays, 'DAYS', 'HARD_SAFETY', 'CompanyEventPaperPolicy'),
  entry('ownership.thetaQAcceptabilityFloor', paperBootstrapRuntimePolicy.ownership.thetaQAcceptabilityFloor, 'PERCENT_FRACTION', 'STRUCTURAL_FILTER', 'ThetaQOwnershipFloor'),
  entry('aegis.hardCapMultiplier', paperBootstrapRuntimePolicy.aegis.hardCapMultiplier, 'MULTIPLIER', 'HARD_SAFETY', 'Aegis'),
  entry('aegis.compoundStressHoldCount', paperBootstrapRuntimePolicy.aegis.compoundStressHoldCount, 'COUNT', 'HARD_SAFETY', 'Aegis'),
  entry('aegis.maximumTickerConcentrationPct', paperBootstrapRuntimePolicy.aegis.maximumTickerConcentrationPct, 'PERCENT_FRACTION', 'HARD_SAFETY', 'Aegis'),
  entry('aegis.maximumSectorConcentrationPct', paperBootstrapRuntimePolicy.aegis.maximumSectorConcentrationPct, 'PERCENT_FRACTION', 'HARD_SAFETY', 'Aegis'),
  entry('aegis.maximumCorrelationClusterPct', paperBootstrapRuntimePolicy.aegis.maximumCorrelationClusterPct, 'PERCENT_FRACTION', 'HARD_SAFETY', 'Aegis'),
  entry('aegis.maximumPortfolioCapitalAtRiskPct', paperBootstrapRuntimePolicy.aegis.maximumPortfolioCapitalAtRiskPct, 'PERCENT_FRACTION', 'HARD_SAFETY', 'Aegis'),
  entry('aegis.maximumInventoryCapacityPct', paperBootstrapRuntimePolicy.aegis.maximumInventoryCapacityPct, 'PERCENT_FRACTION', 'HARD_SAFETY', 'Aegis'),
  entry('aegis.maximumAssignmentCapacityPct', paperBootstrapRuntimePolicy.aegis.maximumAssignmentCapacityPct, 'PERCENT_FRACTION', 'HARD_SAFETY', 'Aegis'),
  entry('aegis.maximumRecoveryCapacityPct', paperBootstrapRuntimePolicy.aegis.maximumRecoveryCapacityPct, 'PERCENT_FRACTION', 'HARD_SAFETY', 'Aegis'),
  entry('aegis.stressGapThresholdAbsoluteReturn', paperBootstrapRuntimePolicy.aegis.stressGapThresholdAbsoluteReturn, 'PERCENT_FRACTION', 'HARD_SAFETY', 'AegisGapStress'),
  entry('portfolioCorrelation.maximumHeldSymbols', paperBootstrapRuntimePolicy.portfolioCorrelation.maximumHeldSymbols, 'COUNT', 'HARD_SAFETY', 'PortfolioCorrelationEvidence'),
  entry('portfolioCorrelation.lookbackSessions', paperBootstrapRuntimePolicy.portfolioCorrelation.lookbackSessions, 'COUNT', 'HARD_SAFETY', 'PortfolioCorrelationEvidence'),
  entry('portfolioCorrelation.minimumOverlappingReturns', paperBootstrapRuntimePolicy.portfolioCorrelation.minimumOverlappingReturns, 'COUNT', 'HARD_SAFETY', 'PortfolioCorrelationEvidence'),
  entry('portfolioCorrelation.maxBarAgeCalendarDays', paperBootstrapRuntimePolicy.portfolioCorrelation.maxBarAgeCalendarDays, 'DAYS', 'HARD_SAFETY', 'PortfolioCorrelationEvidence'),
  entry('sizing.riskBudgetQuantityCap', paperBootstrapRuntimePolicy.sizing.riskBudgetQuantityCap, 'COUNT', 'SIZING_LIMIT', 'Sizing'),
  entry('sizing.collateralQuantityCap', paperBootstrapRuntimePolicy.sizing.collateralQuantityCap, 'COUNT', 'SIZING_LIMIT', 'Sizing'),
  entry('sizing.concentrationQuantityCap', paperBootstrapRuntimePolicy.sizing.concentrationQuantityCap, 'COUNT', 'SIZING_LIMIT', 'Sizing'),
  entry('sizing.assignmentCapacityQuantityCap', paperBootstrapRuntimePolicy.sizing.assignmentCapacityQuantityCap, 'COUNT', 'SIZING_LIMIT', 'Sizing'),
  entry('sizing.tailRiskQuantityCap', paperBootstrapRuntimePolicy.sizing.tailRiskQuantityCap, 'COUNT', 'SIZING_LIMIT', 'Sizing'),
  entry('sizing.correlationQuantityCap', paperBootstrapRuntimePolicy.sizing.correlationQuantityCap, 'COUNT', 'SIZING_LIMIT', 'Sizing'),
  entry('sizing.liquidityQuantityCap', paperBootstrapRuntimePolicy.sizing.liquidityQuantityCap, 'COUNT', 'SIZING_LIMIT', 'Sizing'),
  entry('sizing.reducedStateMultiplier', paperBootstrapRuntimePolicy.sizing.reducedStateMultiplier, 'MULTIPLIER', 'SIZING_LIMIT', 'Sizing'),
]);

export const decisionCriticalConfigurationFields: readonly string[] = Object.freeze([
  'conventional.minimumDte', 'conventional.maximumDte', 'conventional.deltaBands',
  'conventional.minimumOpenInterest', 'conventional.minimumVolume', 'conventional.maximumSpreadPct',
  'conventional.earningsExclusionDays', 'ownership.thetaQAcceptabilityFloor', 'quote.candidateMaximumSeconds', 'quote.finalistMaximumSeconds',
  'quote.preSubmitMaximumMilliseconds', 'quote.planWindowNewRiskMilliseconds', 'quote.planWindowManagementMilliseconds',
  'quote.goodMaximumSeconds', 'quote.staleMinimumSeconds',
  'sizing.riskBudgetQuantityCap', 'sizing.collateralQuantityCap', 'sizing.concentrationQuantityCap',
  'sizing.assignmentCapacityQuantityCap', 'sizing.tailRiskQuantityCap', 'sizing.correlationQuantityCap',
  'sizing.liquidityQuantityCap', 'sizing.reducedStateMultiplier', 'aegis.hardCapMultiplier',
  'aegis.compoundStressHoldCount',
  'aegis.maximumTickerConcentrationPct', 'aegis.maximumSectorConcentrationPct',
  'aegis.maximumCorrelationClusterPct', 'aegis.maximumPortfolioCapitalAtRiskPct',
  'aegis.maximumInventoryCapacityPct', 'aegis.maximumAssignmentCapacityPct',
  'aegis.maximumRecoveryCapacityPct', 'aegis.stressGapThresholdAbsoluteReturn',
  'portfolioCorrelation.maximumHeldSymbols', 'portfolioCorrelation.lookbackSessions',
  'portfolioCorrelation.minimumOverlappingReturns', 'portfolioCorrelation.maxBarAgeCalendarDays',
]);

export interface PresessionConfigurationAudit {
  readonly state: 'PASS' | 'FAIL';
  readonly entryCount: number;
  readonly duplicateNames: readonly string[];
  readonly unregisteredFields: readonly string[];
  readonly invalidEntries: readonly string[];
  readonly invariants: Readonly<Record<string, boolean>>;
}

export function auditPresessionConfiguration(): PresessionConfigurationAudit {
  const names = new Set<string>();
  const duplicateNames = new Set<string>();
  const invalidEntries: string[] = [];
  for (const item of presessionConfigurationRegistry) {
    if (names.has(item.name)) duplicateNames.add(item.name);
    names.add(item.name);
    const validValue = typeof item.value === 'number'
      ? Number.isFinite(item.value) && item.value >= 0
      : item.value.length > 0 && item.value.every(([low, high]) => Number.isFinite(low) && Number.isFinite(high)
        && low >= 0 && high <= 1 && low < high);
    if (!validValue || item.consumer.trim().length === 0) invalidEntries.push(item.name);
  }
  const unregisteredFields = decisionCriticalConfigurationFields.filter((name) => !names.has(name));
  const invariants = {
    conventionalDteOrdered: paperBootstrapRuntimePolicy.conventional.minimumDte <= paperBootstrapRuntimePolicy.conventional.maximumDte,
    candidateQuoteAgePositive: paperBootstrapRuntimePolicy.quoteAge.candidateMaximumSeconds > 0,
    finalistQuoteAgePositive: paperBootstrapRuntimePolicy.quoteAge.finalistMaximumSeconds > 0,
    preSubmitQuoteAgePositive: paperBootstrapRuntimePolicy.quoteAge.preSubmitMaximumMilliseconds > 0,
    // The submit cap is never looser than the longest plan window, and no plan window outlives the decision-evidence age plus its
    // own execution step: management plans may not outlive decision evidence.
    submitCapCoversPlanWindows: paperBootstrapRuntimePolicy.quoteAge.preSubmitMaximumMilliseconds
      >= Math.max(paperBootstrapRuntimePolicy.quoteAge.planWindowNewRiskMilliseconds,
        paperBootstrapRuntimePolicy.quoteAge.planWindowManagementMilliseconds),
    managementPlanWindowWithinDecisionEvidenceAge: paperBootstrapRuntimePolicy.quoteAge.planWindowManagementMilliseconds
      <= paperBootstrapRuntimePolicy.quoteAge.candidateMaximumSeconds * 1000,
    freshnessBandsOrdered: paperBootstrapRuntimePolicy.quoteAge.goodMaximumSeconds < paperBootstrapRuntimePolicy.quoteAge.staleMinimumSeconds,
    spreadBounded: paperBootstrapRuntimePolicy.conventional.maximumSpreadPct > 0 && paperBootstrapRuntimePolicy.conventional.maximumSpreadPct <= 1,
    concentrationBounded: paperBootstrapRuntimePolicy.aegis.maximumTickerConcentrationPct > 0 && paperBootstrapRuntimePolicy.aegis.maximumTickerConcentrationPct <= 1,
    compoundStressHoldCountValid: Number.isInteger(paperBootstrapRuntimePolicy.aegis.compoundStressHoldCount)
      && paperBootstrapRuntimePolicy.aegis.compoundStressHoldCount >= 2,
    reducedSizingBounded: paperBootstrapRuntimePolicy.sizing.reducedStateMultiplier > 0 && paperBootstrapRuntimePolicy.sizing.reducedStateMultiplier <= 1,
    portfolioCorrelationPolicyValid: Number.isInteger(paperBootstrapRuntimePolicy.portfolioCorrelation.maximumHeldSymbols)
      && paperBootstrapRuntimePolicy.portfolioCorrelation.maximumHeldSymbols > 0
      && Number.isInteger(paperBootstrapRuntimePolicy.portfolioCorrelation.lookbackSessions)
      && paperBootstrapRuntimePolicy.portfolioCorrelation.lookbackSessions >= 2
      && Number.isInteger(paperBootstrapRuntimePolicy.portfolioCorrelation.minimumOverlappingReturns)
      && paperBootstrapRuntimePolicy.portfolioCorrelation.minimumOverlappingReturns >= 2
      && paperBootstrapRuntimePolicy.portfolioCorrelation.minimumOverlappingReturns
        <= paperBootstrapRuntimePolicy.portfolioCorrelation.lookbackSessions
      && Number.isInteger(paperBootstrapRuntimePolicy.portfolioCorrelation.maxBarAgeCalendarDays)
      && paperBootstrapRuntimePolicy.portfolioCorrelation.maxBarAgeCalendarDays > 0,
    ownershipFloorBounded: paperBootstrapRuntimePolicy.ownership.thetaQAcceptabilityFloor > 0
      && paperBootstrapRuntimePolicy.ownership.thetaQAcceptabilityFloor <= 1,
    deltaBandsOrdered: paperBootstrapRuntimePolicy.conventional.deltaBands.every(([low, high]) => low >= 0 && high <= 1 && low < high),
  } as const;
  const pass = duplicateNames.size === 0 && unregisteredFields.length === 0
    && invalidEntries.length === 0 && Object.values(invariants).every(Boolean);
  return { state: pass ? 'PASS' : 'FAIL', entryCount: presessionConfigurationRegistry.length,
    duplicateNames: [...duplicateNames].sort(), unregisteredFields, invalidEntries, invariants };
}
