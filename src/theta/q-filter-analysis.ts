import type { QEntryFunnelReceipt, QFunnelStageId } from './q-entry-funnel.js';

export const qFilterAnalysisVersion = 'theta-q-filter-analysis-v1' as const;

export type QGateRole =
  | 'HARD_CORRECTNESS'
  | 'HARD_SAFETY'
  | 'STRATEGY_BASELINE'
  | 'SOFT_RANKING_SIGNAL'
  | 'RESEARCH_ONLY'
  | 'NOT_APPLICABLE';

export interface QFilterOutcomeLabel {
  readonly candidateId: string;
  readonly decisionAt: string;
  readonly labelAvailableAt: string;
  readonly identifiability: 'OBSERVED_PARALLEL' | 'ESTIMABLE' | 'NOT_IDENTIFIABLE';
  readonly afterCostPnl: number | null;
  readonly tailLossAvoided: number | null;
}

export interface QGateRegistryEntry {
  readonly stageId: QFunnelStageId;
  readonly role: QGateRole;
  readonly rationale: string;
}

export interface QGateMarginalAnalysis {
  readonly stageId: QFunnelStageId;
  readonly independentlyFailedCount: number;
  readonly independentlyUnknownCount: number;
  /** Candidates for which this was the only independently failing or unknown gate.
   * This is a structural removal cohort, never a claim that the candidate would
   * have traded or made money. */
  readonly singleGateRemovalEligibleCount: number;
  readonly coFailingCandidateCount: number;
}

export interface QGateRegretAnalysis {
  readonly stageId: QFunnelStageId;
  readonly rejectedCount: number;
  readonly resolvedOutcomeCount: number;
  readonly profitableRejectedCount: number;
  readonly badRejectedCount: number;
  readonly unresolvedCount: number;
  readonly averageOpportunityCost: number | null;
  readonly tailRiskAvoidedTotal: number | null;
  readonly falseRejectRate: number | null;
  readonly modeledOutcomeCount: number;
}

export interface QFilterAnalysis {
  readonly contractVersion: typeof qFilterAnalysisVersion;
  readonly gateRegistry: readonly QGateRegistryEntry[];
  readonly firstFailingGateCounts: Readonly<Partial<Record<QFunnelStageId, number>>>;
  readonly marginalGates: readonly QGateMarginalAnalysis[];
  readonly gateInteractions: Readonly<Record<string, number>>;
  readonly regretByGate: readonly QGateRegretAnalysis[];
  readonly acceptedResolvedCount: number;
  readonly acceptedBadCount: number;
  readonly labelsSupplied: number;
  readonly labelsUsed: number;
  readonly labelsRejected: number;
  readonly empiricalState: 'READY_FOR_DATA' | 'DATA_ACCUMULATING';
  readonly brokerAuthority: false;
  readonly executionAuthorized: false;
}

export const qGateRegistry: readonly QGateRegistryEntry[] = [
  { stageId: 'PUT_CONTRACT_IDENTITY', role: 'HARD_CORRECTNESS', rationale: 'Exact put identity and multiplier are required.' },
  { stageId: 'INSTRUMENT_APPROVAL', role: 'HARD_SAFETY', rationale: 'Paper instrument approval is owner-governed.' },
  { stageId: 'EXECUTABLE_ALPACA_QUOTE', role: 'HARD_SAFETY', rationale: 'Alpaca executable BBO authority is required.' },
  { stageId: 'DELTA_KNOWN', role: 'STRATEGY_BASELINE', rationale: 'Q lattice construction currently requires observed delta.' },
  { stageId: 'QUOTE_FRESHNESS', role: 'HARD_SAFETY', rationale: 'Stale executable evidence cannot authorize action.' },
  { stageId: 'DTE_WINDOW', role: 'STRATEGY_BASELINE', rationale: 'Current Q strategy lattice definition.' },
  { stageId: 'DELTA_BAND', role: 'STRATEGY_BASELINE', rationale: 'Current Q strategy lattice definition.' },
  { stageId: 'SPREAD', role: 'STRATEGY_BASELINE', rationale: 'Calibratable liquidity threshold, separate from malformed BBO safety.' },
  { stageId: 'OPEN_INTEREST', role: 'STRATEGY_BASELINE', rationale: 'Calibratable Q liquidity baseline.' },
  { stageId: 'VOLUME', role: 'STRATEGY_BASELINE', rationale: 'Calibratable Q liquidity baseline.' },
  { stageId: 'PREMIUM_ECONOMICS', role: 'RESEARCH_ONLY', rationale: 'No Production minimum-premium gate is configured.' },
  { stageId: 'QUOTE_AGE_BUDGET', role: 'HARD_SAFETY', rationale: 'Executable quote age is a hard requirement.' },
  { stageId: 'EVENT_WINDOW', role: 'HARD_SAFETY', rationale: 'Required event evidence fails closed.' },
  { stageId: 'FINALIST_SHORTLIST', role: 'SOFT_RANKING_SIGNAL', rationale: 'Ranking narrows refresh work and cannot create safety clearance.' },
  { stageId: 'ENTRY_ELIGIBILITY', role: 'HARD_SAFETY', rationale: 'Only explicitly eligible entry bases may reach Paper planning.' },
  { stageId: 'CAPITAL_FIT', role: 'HARD_SAFETY', rationale: 'At least one whole secured contract must fit real buying power.' },
  { stageId: 'AEGIS', role: 'HARD_SAFETY', rationale: 'AEGIS is the canonical risk authority.' },
  { stageId: 'FINAL_QUANTITY', role: 'HARD_SAFETY', rationale: 'Canonical sizing must produce a positive whole quantity.' },
] as const;

function findingStage(value: string): QFunnelStageId | null {
  const prefix = value.split(':', 1)[0] as QFunnelStageId;
  return qGateRegistry.some((entry) => entry.stageId === prefix) ? prefix : null;
}

function validLabel(label: QFilterOutcomeLabel): boolean {
  const decision = Date.parse(label.decisionAt);
  const available = Date.parse(label.labelAvailableAt);
  if (!label.candidateId.trim() || !Number.isFinite(decision) || !Number.isFinite(available) || available < decision) return false;
  if (label.identifiability === 'NOT_IDENTIFIABLE') return label.afterCostPnl === null && label.tailLossAvoided === null;
  return (label.afterCostPnl === null || Number.isFinite(label.afterCostPnl))
    && (label.tailLossAvoided === null || Number.isFinite(label.tailLossAvoided));
}

/**
 * Builds masking-free gate diagnostics and, when future labels exist, a
 * denominator-safe regret table. The function never reruns candidate
 * selection and never treats a counterfactual as a broker-observed result.
 */
export function buildQFilterAnalysis(
  receipt: QEntryFunnelReceipt,
  labels: readonly QFilterOutcomeLabel[] = [],
): QFilterAnalysis {
  const valid = labels.filter(validLabel);
  const labelByCandidate = new Map<string, QFilterOutcomeLabel>();
  for (const label of valid) {
    if (labelByCandidate.has(label.candidateId)) throw new Error(`Q_FILTER_DUPLICATE_LABEL:${label.candidateId}`);
    labelByCandidate.set(label.candidateId, label);
  }
  const firstCounts = new Map<QFunnelStageId, number>();
  const stageSets = new Map<string, ReadonlySet<QFunnelStageId>>();
  for (const candidate of receipt.candidates) {
    if (candidate.terminalStage !== 'COMPLETED') {
      firstCounts.set(candidate.terminalStage, (firstCounts.get(candidate.terminalStage) ?? 0) + 1);
    }
    stageSets.set(candidate.candidateId, new Set(candidate.allFindings.map(findingStage)
      .filter((stage): stage is QFunnelStageId => stage !== null)));
  }
  const interactions = new Map<string, number>();
  for (const stages of stageSets.values()) {
    const ordered = [...stages].sort();
    for (let i = 0; i < ordered.length; i += 1) for (let j = i + 1; j < ordered.length; j += 1) {
      const key = `${ordered[i]}+${ordered[j]}`;
      interactions.set(key, (interactions.get(key) ?? 0) + 1);
    }
  }
  const marginalGates = qGateRegistry.map(({ stageId }): QGateMarginalAnalysis => {
    const independent = receipt.independentGates[stageId] ?? { FAIL_COUNT: 0, UNKNOWN_COUNT: 0 };
    const relevant = [...stageSets.values()].filter((set) => set.has(stageId));
    return {
      stageId,
      independentlyFailedCount: independent.FAIL_COUNT,
      independentlyUnknownCount: independent.UNKNOWN_COUNT,
      singleGateRemovalEligibleCount: relevant.filter((set) => set.size === 1).length,
      coFailingCandidateCount: relevant.filter((set) => set.size > 1).length,
    };
  });
  const regretByGate = qGateRegistry.map(({ stageId }): QGateRegretAnalysis => {
    const rejected = receipt.candidates.filter((candidate) => candidate.terminalStage === stageId);
    const labeled = rejected.flatMap((candidate) => {
      const label = labelByCandidate.get(candidate.candidateId);
      return label === undefined ? [] : [label];
    });
    const resolved = labeled.filter((label) => label.identifiability !== 'NOT_IDENTIFIABLE'
      && label.afterCostPnl !== null);
    const observed = resolved.filter((label) => label.identifiability === 'OBSERVED_PARALLEL');
    const opportunityCosts = resolved.map((label) => Math.max(0, label.afterCostPnl as number));
    const tailValues = resolved.flatMap((label) => label.tailLossAvoided === null ? [] : [label.tailLossAvoided]);
    return {
      stageId,
      rejectedCount: rejected.length,
      resolvedOutcomeCount: resolved.length,
      profitableRejectedCount: resolved.filter((label) => (label.afterCostPnl as number) > 0).length,
      badRejectedCount: resolved.filter((label) => (label.afterCostPnl as number) <= 0).length,
      unresolvedCount: rejected.length - resolved.length,
      averageOpportunityCost: opportunityCosts.length === 0 ? null
        : opportunityCosts.reduce((sum, value) => sum + value, 0) / opportunityCosts.length,
      tailRiskAvoidedTotal: tailValues.length === 0 ? null : tailValues.reduce((sum, value) => sum + value, 0),
      falseRejectRate: observed.length === 0 ? null
        : observed.filter((label) => (label.afterCostPnl as number) > 0).length / observed.length,
      modeledOutcomeCount: resolved.filter((label) => label.identifiability === 'ESTIMABLE').length,
    };
  });
  const accepted = receipt.candidates.filter((candidate) => candidate.terminalStage === 'COMPLETED')
    .flatMap((candidate) => {
      const label = labelByCandidate.get(candidate.candidateId);
      return label === undefined || label.identifiability === 'NOT_IDENTIFIABLE' || label.afterCostPnl === null ? [] : [label];
    });
  const labelsUsed = receipt.candidates.filter((candidate) => labelByCandidate.has(candidate.candidateId)).length;
  return {
    contractVersion: qFilterAnalysisVersion,
    gateRegistry: qGateRegistry,
    firstFailingGateCounts: Object.fromEntries([...firstCounts.entries()].sort(([a], [b]) => a.localeCompare(b))),
    marginalGates,
    gateInteractions: Object.fromEntries([...interactions.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))),
    regretByGate,
    acceptedResolvedCount: accepted.length,
    acceptedBadCount: accepted.filter((label) => (label.afterCostPnl as number) <= 0).length,
    labelsSupplied: labels.length,
    labelsUsed,
    labelsRejected: labels.length - valid.length,
    empiricalState: valid.some((label) => label.identifiability !== 'NOT_IDENTIFIABLE' && label.afterCostPnl !== null)
      ? 'DATA_ACCUMULATING' : 'READY_FOR_DATA',
    brokerAuthority: false,
    executionAuthorized: false,
  };
}
