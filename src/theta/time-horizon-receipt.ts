import type { CanonicalStrategyFrontier, CanonicalFrontierCandidate } from './canonical-strategy-frontier.js';

export const timeHorizonReceiptVersion = 'theta-time-horizon-shadow-v1' as const;
export type TimeHorizonCode = 'T0' | 'T1' | 'T2' | 'T3' | 'T4' | 'T5';
const CODES: readonly TimeHorizonCode[] = ['T0', 'T1', 'T2', 'T3', 'T4', 'T5'];
const ENTRY_BRANCHES = new Set(['THETA_CONVENTIONAL', 'THETA_HOLD_STRIKE', 'THETA_DEFINED_RISK']);

/** Contractual expiry bucket only. Expected holding time is separate and unknown. */
export function expiryHorizon(dte: number | null): TimeHorizonCode | null {
  if (dte === null || !Number.isInteger(dte) || dte < 0) return null;
  return dte === 0 ? 'T0' : dte <= 3 ? 'T1' : dte <= 7 ? 'T2'
    : dte <= 21 ? 'T3' : dte <= 60 ? 'T4' : 'T5';
}

export interface TimeHorizonCandidateReference {
  readonly candidateId: string;
  readonly strategy: CanonicalFrontierCandidate['branch'];
  readonly dte: number;
  readonly riskFeasible: boolean;
  readonly quantity: number;
  readonly hardBlockers: readonly string[];
}

export interface TimeHorizonReceipt {
  readonly version: typeof timeHorizonReceiptVersion;
  readonly snapshotId: string;
  readonly observedAt: string;
  readonly basis: 'CONTRACT_EXPIRY_NOT_EXPECTED_HOLDING_PERIOD';
  readonly horizons: readonly {
    readonly code: TimeHorizonCode;
    readonly candidates: readonly TimeHorizonCandidateReference[];
    readonly candidateCount: number;
    readonly feasibleCount: number;
    readonly strategiesRepresented: readonly string[];
    readonly bestStrategy: null;
    readonly bestStrategyReason: 'EMPIRICAL_CROSS_STRATEGY_UTILITY_NOT_READY';
  }[];
  readonly unknownDteCandidateIds: readonly string[];
  readonly enumerationComplete: boolean;
  readonly bestCrossHorizonCandidateId: null;
  readonly crossHorizonReason: 'EMPIRICAL_CROSS_HORIZON_UTILITY_NOT_READY';
  readonly currentPolicySelectedHorizon: TimeHorizonCode | null;
  readonly whyThisHorizon: 'CURRENT_SOVEREIGN_POLICY_SELECTION_NOT_CROSS_HORIZON_OPTIMALITY'
    | 'NO_CURRENT_ENTRY_SELECTION' | 'SELECTED_CANDIDATE_HORIZON_UNKNOWN';
  readonly brokerAuthority: false;
}

/** Observes the existing sovereign frontier. It never re-ranks, sizes, or authorizes a candidate. */
export function buildTimeHorizonReceipt(frontier: Pick<CanonicalStrategyFrontier,
  'snapshotId' | 'timestamp' | 'branches' | 'selectedCandidateId'>): TimeHorizonReceipt {
  const branches = frontier.branches.filter((branch) => ENTRY_BRANCHES.has(branch.branch));
  const candidates = branches.flatMap((branch) => branch.candidates);
  const unknownDteCandidateIds = candidates.filter((candidate) => expiryHorizon(candidate.dte) === null)
    .map((candidate) => candidate.candidateId).sort();
  const horizons = CODES.map((code) => {
    const references = candidates.filter((candidate) => expiryHorizon(candidate.dte) === code)
      .map((candidate): TimeHorizonCandidateReference => ({
        candidateId: candidate.candidateId, strategy: candidate.branch, dte: candidate.dte as number,
        riskFeasible: candidate.riskFeasible, quantity: candidate.sizing.quantity,
        hardBlockers: [...candidate.hardBlockers].sort(),
      })).sort((left, right) => left.candidateId.localeCompare(right.candidateId));
    return {
      code, candidates: references, candidateCount: references.length,
      feasibleCount: references.filter((candidate) => candidate.riskFeasible && candidate.quantity > 0).length,
      strategiesRepresented: [...new Set(references.map((candidate) => candidate.strategy))].sort(),
      bestStrategy: null, bestStrategyReason: 'EMPIRICAL_CROSS_STRATEGY_UTILITY_NOT_READY' as const,
    };
  });
  const selected = candidates.find((candidate) => candidate.candidateId === frontier.selectedCandidateId);
  const selectedHorizon = selected === undefined ? null : expiryHorizon(selected.dte);
  return {
    version: timeHorizonReceiptVersion, snapshotId: frontier.snapshotId, observedAt: frontier.timestamp,
    basis: 'CONTRACT_EXPIRY_NOT_EXPECTED_HOLDING_PERIOD', horizons, unknownDteCandidateIds,
    enumerationComplete: branches.filter((branch) => branch.applicable)
      .every((branch) => branch.evaluated && !branch.enumerationTruncated),
    bestCrossHorizonCandidateId: null, crossHorizonReason: 'EMPIRICAL_CROSS_HORIZON_UTILITY_NOT_READY',
    currentPolicySelectedHorizon: selectedHorizon,
    whyThisHorizon: frontier.selectedCandidateId === null ? 'NO_CURRENT_ENTRY_SELECTION'
      : selectedHorizon === null ? 'SELECTED_CANDIDATE_HORIZON_UNKNOWN'
        : 'CURRENT_SOVEREIGN_POLICY_SELECTION_NOT_CROSS_HORIZON_OPTIMALITY',
    brokerAuthority: false,
  };
}
