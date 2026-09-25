export const paperBootstrapRuntimePolicyVersion = 'theta-paper-bootstrap-runtime-policy-v1' as const;

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
    earningsExclusionDays: 5,
  }),
  quoteAge: Object.freeze({
    candidateMaximumSeconds: 30,
    finalistMaximumSeconds: 30,
    preSubmitMaximumMilliseconds: 45_000,
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
    maximumTickerConcentrationPct: 0.15,
    maximumSectorConcentrationPct: 0.3,
    maximumCorrelationClusterPct: 0.3,
    maximumPortfolioCapitalAtRiskPct: 0.5,
    maximumInventoryCapacityPct: 0.5,
    maximumAssignmentCapacityPct: 0.5,
    maximumRecoveryCapacityPct: 0.3,
    stressGapThresholdAbsoluteReturn: 0.05,
  }),
});

export type PresessionConfigurationRole = 'HARD_SAFETY' | 'STRUCTURAL_FILTER' | 'SIZING_LIMIT';

export interface PresessionConfigurationEntry {
  readonly name: string;
  readonly value: number;
  readonly unit: 'SECONDS' | 'MILLISECONDS' | 'DAYS' | 'PERCENT_FRACTION' | 'COUNT' | 'MULTIPLIER';
  readonly role: PresessionConfigurationRole;
  readonly consumer: string;
  readonly authority: typeof paperBootstrapRuntimePolicy.authority;
  readonly policyVersion: typeof paperBootstrapRuntimePolicyVersion;
}

const entry = (name: string, value: number, unit: PresessionConfigurationEntry['unit'],
  role: PresessionConfigurationRole, consumer: string): PresessionConfigurationEntry => ({
  name, value, unit, role, consumer,
  authority: paperBootstrapRuntimePolicy.authority,
  policyVersion: paperBootstrapRuntimePolicyVersion,
});

export const presessionConfigurationRegistry: readonly PresessionConfigurationEntry[] = Object.freeze([
  entry('quote.candidateMaximumSeconds', paperBootstrapRuntimePolicy.quoteAge.candidateMaximumSeconds, 'SECONDS', 'HARD_SAFETY', 'ThetaShadowCycle'),
  entry('quote.finalistMaximumSeconds', paperBootstrapRuntimePolicy.quoteAge.finalistMaximumSeconds, 'SECONDS', 'HARD_SAFETY', 'FinalistQuoteRefresh'),
  entry('quote.preSubmitMaximumMilliseconds', paperBootstrapRuntimePolicy.quoteAge.preSubmitMaximumMilliseconds, 'MILLISECONDS', 'HARD_SAFETY', 'MasterPaperActionHandoff'),
  entry('quote.goodMaximumSeconds', paperBootstrapRuntimePolicy.quoteAge.goodMaximumSeconds, 'SECONDS', 'STRUCTURAL_FILTER', 'OptionQuoteFreshness'),
  entry('quote.staleMinimumSeconds', paperBootstrapRuntimePolicy.quoteAge.staleMinimumSeconds, 'SECONDS', 'HARD_SAFETY', 'OptionQuoteFreshness'),
  entry('conventional.minimumDte', paperBootstrapRuntimePolicy.conventional.minimumDte, 'DAYS', 'STRUCTURAL_FILTER', 'ThetaQCandidateLattice'),
  entry('conventional.maximumDte', paperBootstrapRuntimePolicy.conventional.maximumDte, 'DAYS', 'STRUCTURAL_FILTER', 'ThetaQCandidateLattice'),
  entry('conventional.minimumOpenInterest', paperBootstrapRuntimePolicy.conventional.minimumOpenInterest, 'COUNT', 'STRUCTURAL_FILTER', 'ThetaQCandidateLattice'),
  entry('conventional.minimumVolume', paperBootstrapRuntimePolicy.conventional.minimumVolume, 'COUNT', 'STRUCTURAL_FILTER', 'ThetaQCandidateLattice'),
  entry('conventional.maximumSpreadPct', paperBootstrapRuntimePolicy.conventional.maximumSpreadPct, 'PERCENT_FRACTION', 'HARD_SAFETY', 'ExecutionQuality'),
  entry('aegis.hardCapMultiplier', paperBootstrapRuntimePolicy.aegis.hardCapMultiplier, 'MULTIPLIER', 'HARD_SAFETY', 'Aegis'),
  entry('aegis.maximumTickerConcentrationPct', paperBootstrapRuntimePolicy.aegis.maximumTickerConcentrationPct, 'PERCENT_FRACTION', 'HARD_SAFETY', 'Aegis'),
  entry('aegis.maximumPortfolioCapitalAtRiskPct', paperBootstrapRuntimePolicy.aegis.maximumPortfolioCapitalAtRiskPct, 'PERCENT_FRACTION', 'HARD_SAFETY', 'Aegis'),
  entry('aegis.stressGapThresholdAbsoluteReturn', paperBootstrapRuntimePolicy.aegis.stressGapThresholdAbsoluteReturn, 'PERCENT_FRACTION', 'HARD_SAFETY', 'AegisGapStress'),
  entry('sizing.riskBudgetQuantityCap', paperBootstrapRuntimePolicy.sizing.riskBudgetQuantityCap, 'COUNT', 'SIZING_LIMIT', 'Sizing'),
  entry('sizing.collateralQuantityCap', paperBootstrapRuntimePolicy.sizing.collateralQuantityCap, 'COUNT', 'SIZING_LIMIT', 'Sizing'),
  entry('sizing.concentrationQuantityCap', paperBootstrapRuntimePolicy.sizing.concentrationQuantityCap, 'COUNT', 'SIZING_LIMIT', 'Sizing'),
  entry('sizing.assignmentCapacityQuantityCap', paperBootstrapRuntimePolicy.sizing.assignmentCapacityQuantityCap, 'COUNT', 'SIZING_LIMIT', 'Sizing'),
]);

export interface PresessionConfigurationAudit {
  readonly state: 'PASS' | 'FAIL';
  readonly entryCount: number;
  readonly duplicateNames: readonly string[];
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
    if (!Number.isFinite(item.value) || item.value < 0 || item.consumer.trim().length === 0) invalidEntries.push(item.name);
  }
  const invariants = {
    conventionalDteOrdered: paperBootstrapRuntimePolicy.conventional.minimumDte <= paperBootstrapRuntimePolicy.conventional.maximumDte,
    candidateQuoteAgePositive: paperBootstrapRuntimePolicy.quoteAge.candidateMaximumSeconds > 0,
    finalistQuoteAgePositive: paperBootstrapRuntimePolicy.quoteAge.finalistMaximumSeconds > 0,
    preSubmitQuoteAgePositive: paperBootstrapRuntimePolicy.quoteAge.preSubmitMaximumMilliseconds > 0,
    freshnessBandsOrdered: paperBootstrapRuntimePolicy.quoteAge.goodMaximumSeconds < paperBootstrapRuntimePolicy.quoteAge.staleMinimumSeconds,
    spreadBounded: paperBootstrapRuntimePolicy.conventional.maximumSpreadPct > 0 && paperBootstrapRuntimePolicy.conventional.maximumSpreadPct <= 1,
    concentrationBounded: paperBootstrapRuntimePolicy.aegis.maximumTickerConcentrationPct > 0 && paperBootstrapRuntimePolicy.aegis.maximumTickerConcentrationPct <= 1,
    reducedSizingBounded: paperBootstrapRuntimePolicy.sizing.reducedStateMultiplier > 0 && paperBootstrapRuntimePolicy.sizing.reducedStateMultiplier <= 1,
    deltaBandsOrdered: paperBootstrapRuntimePolicy.conventional.deltaBands.every(([low, high]) => low >= 0 && high <= 1 && low < high),
  } as const;
  const pass = duplicateNames.size === 0 && invalidEntries.length === 0 && Object.values(invariants).every(Boolean);
  return { state: pass ? 'PASS' : 'FAIL', entryCount: presessionConfigurationRegistry.length,
    duplicateNames: [...duplicateNames].sort(), invalidEntries, invariants };
}
