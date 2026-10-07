import { createHash } from 'node:crypto';
import type { CanonicalFrontierCandidate, CanonicalStrategyFrontier } from './canonical-strategy-frontier.js';

export const strategyEdgeReceiptVersion = 'theta-strategy-edge-receipt-v1' as const;

export type EdgeEvidenceValue = {
  readonly state: 'KNOWN';
  readonly value: number | string | boolean;
  readonly source: string;
} | {
  readonly state: 'UNKNOWN';
  readonly value: null;
  readonly source: string;
  readonly reason: string;
};

export interface StrategyEdgeReceipt {
  readonly contractVersion: typeof strategyEdgeReceiptVersion;
  readonly receiptId: string;
  readonly snapshotId: string;
  readonly observedAt: string;
  readonly candidateId: string;
  readonly strategy: 'THETA_CONVENTIONAL' | 'THETA_HOLD_STRIKE' | 'THETA_DEFINED_RISK';
  readonly edgeId: 'OWNERSHIP_PREMIUM' | 'SHORT_DTE_THETA' | 'BOUNDED_RISK_CAPITAL_EFFICIENCY';
  readonly mechanism: string;
  readonly whyEdgeShouldExist: string;
  readonly whoPaysForEdge: string;
  readonly currentEvidence: Readonly<Record<string, EdgeEvidenceValue>>;
  readonly evidenceState: 'STRUCTURAL_EVIDENCE_PRESENT' | 'INSUFFICIENT_CURRENT_EVIDENCE';
  readonly edgeStrength: null;
  readonly edgeStrengthState: 'EMPIRICALLY_UNCALIBRATED';
  readonly falsificationCriteria: readonly string[];
  readonly confidence: null;
  readonly confidenceState: 'EMPIRICALLY_UNCALIBRATED';
  readonly researchVersion: typeof strategyEdgeReceiptVersion;
  readonly authority: 'SHADOW_EVIDENCE_ONLY';
  readonly executionAuthorized: false;
}

const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  return JSON.stringify(value);
};

const known = (value: number | string | boolean, source: string): EdgeEvidenceValue => ({ state: 'KNOWN', value, source });
const measured = (value: number | null, source: string, reason: string): EdgeEvidenceValue =>
  value === null || !Number.isFinite(value) ? { state: 'UNKNOWN', value: null, source, reason } : known(value, source);

function edgeDefinition(candidate: CanonicalFrontierCandidate): Pick<StrategyEdgeReceipt,
  'edgeId' | 'mechanism' | 'whyEdgeShouldExist' | 'whoPaysForEdge' | 'falsificationCriteria'> {
  if (candidate.branch === 'THETA_HOLD_STRIKE') return {
    edgeId: 'SHORT_DTE_THETA',
    mechanism: 'Collect short-dated option time decay only while gamma, move speed, event, assignment, and execution burdens remain controlled.',
    whyEdgeShouldExist: 'Near-expiry option buyers pay for convexity and immediacy. The premium is useful only when realized path risk and execution costs do not consume it.',
    whoPaysForEdge: 'Buyers of short-dated downside convexity and immediacy.',
    falsificationCriteria: ['REALIZED_MOVE_AND_GAMMA_BURDEN_EXCEED_COLLECTED_PREMIUM', 'AFTER_COST_EXPECTANCY_NON_POSITIVE',
      'SHORT_DTE_TAIL_LOSS_EXCEEDS_GOVERNED_LIMIT'],
  };
  if (candidate.branch === 'THETA_DEFINED_RISK') return {
    edgeId: 'BOUNDED_RISK_CAPITAL_EFFICIENCY',
    mechanism: 'Express a bullish short-volatility thesis with a purchased lower-strike put that bounds loss and reduces capital at the cost of premium and two-leg friction.',
    whyEdgeShouldExist: 'A vertical can dominate an uncovered cash-secured expression when bounded tail loss and released capital are worth more than wing cost and execution friction.',
    whoPaysForEdge: 'Buyers of downside protection, offset by the long wing purchased by THETA.',
    falsificationCriteria: ['TWO_LEG_FRICTION_CONSUMES_STRUCTURAL_ADVANTAGE', 'DEFINED_RISK_AFTER_COST_EXPECTANCY_NON_POSITIVE',
      'Q_DOMINATES_ON_COMMON_HORIZON_AFTER_COST_UTILITY'],
  };
  return {
    edgeId: 'OWNERSHIP_PREMIUM',
    mechanism: 'Collect put premium on an underlying THETA is willing and able to own, while accepting bounded-by-cash downside and assignment burden.',
    whyEdgeShouldExist: 'Put buyers pay for downside transfer and liquidity. The premium is useful only when it compensates for downside, capital-days, assignment, and execution costs.',
    whoPaysForEdge: 'Buyers transferring downside and assignment risk.',
    falsificationCriteria: ['IV_RV_PREMIUM_NOT_PRESENT_OVER_VALIDATED_SAMPLE', 'COMPLETE_CHAIN_AFTER_COST_EXPECTANCY_NON_POSITIVE',
      'ASSIGNMENT_AND_RECOVERY_BURDEN_EXCEEDS_PREMIUM'],
  };
}

function evidence(candidate: CanonicalFrontierCandidate): Readonly<Record<string, EdgeEvidenceValue>> {
  const economics = candidate.economics;
  // Archived and deliberately minimal test frontiers can predate the
  // additive modeled-opening-cost object. Absence remains UNKNOWN and must
  // never be interpreted as zero cost.
  const openingCostState = economics.modeledOpeningCosts?.state;
  const base: Record<string, EdgeEvidenceValue> = {
    grossPremium: measured(economics.grossPremium, 'canonicalFrontierCandidate.economics.grossPremium', 'GROSS_PREMIUM_UNKNOWN'),
    capitalRequired: measured(economics.collateral, 'canonicalFrontierCandidate.economics.collateral', 'CAPITAL_REQUIREMENT_UNKNOWN'),
    grossReturnOnCollateral: measured(economics.grossReturnOnCollateral,
      'canonicalFrontierCandidate.economics.grossReturnOnCollateral', 'GROSS_RETURN_ON_COLLATERAL_UNKNOWN'),
    capitalDayYield: measured(economics.capitalDayYield,
      'canonicalFrontierCandidate.economics.capitalDayYield', 'CAPITAL_DAY_YIELD_UNKNOWN'),
    downsideCushion: measured(economics.downsideCushion,
      'canonicalFrontierCandidate.economics.downsideCushion', 'DOWNSIDE_CUSHION_UNKNOWN'),
    maxLoss: measured(economics.maxLoss, 'canonicalFrontierCandidate.economics.maxLoss', 'MAX_LOSS_UNKNOWN'),
    openingCostState: openingCostState === undefined
      ? { state: 'UNKNOWN', value: null, source: 'canonicalFrontierCandidate.economics.modeledOpeningCosts.state',
        reason: 'MODELED_OPENING_COST_STATE_ABSENT' }
      : known(openingCostState, 'canonicalFrontierCandidate.economics.modeledOpeningCosts.state'),
    expectedAfterCostEv: { state: 'UNKNOWN', value: null, source: 'canonicalFrontierCandidate.economics.expectedAfterCostEv',
      reason: 'EV_MODEL_NOT_EMPIRICALLY_READY' },
    ivMinusRv: { state: 'UNKNOWN', value: null, source: 'candidate-bound volatility evidence',
      reason: 'CANDIDATE_BOUND_IV_RV_NOT_AVAILABLE_IN_CANONICAL_FRONTIER' },
  };
  if (candidate.branch === 'THETA_HOLD_STRIKE') {
    base.gamma = measured(candidate.shortDteRiskEvidence?.gamma ?? null,
      'canonicalFrontierCandidate.shortDteRiskEvidence.gamma', 'GAMMA_UNKNOWN');
    base.theta = measured(candidate.shortDteRiskEvidence?.theta ?? null,
      'canonicalFrontierCandidate.shortDteRiskEvidence.theta', 'THETA_UNKNOWN');
    base.maxAdverseGap60d = measured(candidate.shortDteRiskEvidence?.maxAdverseGap60d ?? null,
      'canonicalFrontierCandidate.shortDteRiskEvidence.maxAdverseGap60d', 'GAP_HISTORY_UNKNOWN');
  }
  if (candidate.branch === 'THETA_DEFINED_RISK') {
    base.twoLegExecutionState = known(candidate.multiLegRiskEvidence?.state ?? 'NOT_AVAILABLE',
      'canonicalFrontierCandidate.multiLegRiskEvidence.state');
    base.combinedSpreadPct = measured(candidate.multiLegRiskEvidence?.combinedSpreadPct ?? null,
      'canonicalFrontierCandidate.multiLegRiskEvidence.combinedSpreadPct', 'COMBINED_SPREAD_UNKNOWN');
  }
  return base;
}

export function buildStrategyEdgeReceipts(frontier: Pick<CanonicalStrategyFrontier,
  'snapshotId' | 'timestamp' | 'branches'>): readonly StrategyEdgeReceipt[] {
  return frontier.branches.flatMap((branch) => branch.candidates)
    .filter((candidate): candidate is CanonicalFrontierCandidate & {
      branch: StrategyEdgeReceipt['strategy'];
    } => ['THETA_CONVENTIONAL', 'THETA_HOLD_STRIKE', 'THETA_DEFINED_RISK'].includes(candidate.branch))
    .toSorted((left, right) => left.candidateId.localeCompare(right.candidateId))
    .map((candidate) => {
      const definition = edgeDefinition(candidate);
      const currentEvidence = evidence(candidate);
      const evidenceState = Object.values(currentEvidence).some((item) => item.state === 'KNOWN')
        ? 'STRUCTURAL_EVIDENCE_PRESENT' as const : 'INSUFFICIENT_CURRENT_EVIDENCE' as const;
      const payload = {
        contractVersion: strategyEdgeReceiptVersion,
        snapshotId: frontier.snapshotId,
        observedAt: frontier.timestamp,
        candidateId: candidate.candidateId,
        strategy: candidate.branch,
        ...definition,
        currentEvidence,
        evidenceState,
        edgeStrength: null,
        edgeStrengthState: 'EMPIRICALLY_UNCALIBRATED' as const,
        confidence: null,
        confidenceState: 'EMPIRICALLY_UNCALIBRATED' as const,
        researchVersion: strategyEdgeReceiptVersion,
        authority: 'SHADOW_EVIDENCE_ONLY' as const,
        executionAuthorized: false as const,
      };
      return { ...payload, receiptId: createHash('sha256').update(canonicalJson(payload)).digest('hex') };
    });
}
