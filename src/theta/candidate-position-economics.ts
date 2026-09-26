import type { CanonicalFrontierCandidate } from './canonical-strategy-frontier.js';

// Phase 3 Final Closure B (directive items 2-8, 38-41): the canonical,
// reusable position-total aggregator for a CanonicalFrontierCandidate.
// `CanonicalFrontierCandidate.economics` fields (grossPremium, collateral,
// maxProfit, maxLoss) are PER-CONTRACT values -- proven by tracing every
// formula in canonical-strategy-frontier.ts (singleLegPutCandidate /
// definedRiskCandidate): none of them multiply by `sizing.quantity`. This
// was previously implicit (no compile-time or runtime signal distinguished
// "per contract" from "position total"), which is exactly the ambiguity
// the owner's directive says Phase 4 must never have to resolve by
// re-deriving formulas itself. This module is the single place Phase 4 (or
// any other position-total consumer) should call -- it does not
// reimplement Q/D/H's payoff formulas, only scales their already-computed
// per-contract outputs by a validated quantity.
//
// A parallel, heavier-weight module (defined-risk-vs-csp-economics.ts) already
// exists for paired Defined-Risk-vs-CSP RESEARCH comparison, with its own
// OCC-symbol reparsing and validity/reason-code machinery -- deliberately
// not reused here, since it takes a different raw input shape (not a real
// CanonicalFrontierCandidate) and serves a different purpose (a two-
// structure comparison record, not a general position-total adapter for
// the live decision path). Both use the identical per-contract-to-position
// scaling rule (multiply monetary per-contract fields by quantity; never
// scale break-even/rate fields) -- no duplicate formula, same rule applied
// to a different real input type.

export const candidatePositionEconomicsVersion = 'theta-candidate-position-economics-v1' as const;

export type CandidatePositionEconomicsValidity = 'VALID' | 'INVALID_QUANTITY';

export interface CandidatePositionEconomics {
  readonly contractVersion: typeof candidatePositionEconomicsVersion;
  readonly candidateId: string;
  readonly quantity: number;
  readonly validity: CandidatePositionEconomicsValidity;
  readonly invalidReason: string | null;
  /** Per-contract values, carried through unchanged for traceability --
   * never recomputed here, always read from the same candidate this
   * position economics was built from. */
  readonly perContract: CanonicalFrontierCandidate['economics'];
  /** Position-total monetary fields. `null` whenever the corresponding
   * per-contract field is `null` (an UNKNOWN per-contract value can never
   * produce a known position total) or when `validity !== 'VALID'`. */
  readonly positionGrossPremium: number | null;
  readonly positionCollateral: number | null;
  readonly positionMaxProfit: number | null;
  readonly positionMaxLoss: number | null;
  /** Break-even is a per-share PRICE, never scaled by quantity -- carried
   * through unchanged to make this explicit to any consumer that might
   * otherwise assume every field here scales. */
  readonly breakEvenPerShare: number | null;
  /** capitalDayYield is a RATE (return per unit collateral per day), not a
   * dollar amount -- never scaled by quantity, carried through unchanged. */
  readonly capitalDayYieldRate: number | null;
}

function scaledOrNull(perContract: number | null, quantity: number): number | null {
  return perContract === null ? null : perContract * quantity;
}

/**
 * Scales a CanonicalFrontierCandidate's per-contract economics into
 * position totals for a given quantity. `quantity` is validated
 * independently of the candidate's own `sizing.quantity` (which is always
 * a safe non-negative integer internally) because this function is a
 * public, reusable boundary a future caller (Phase 4's sizer) may invoke
 * with its own quantity value -- never assume the caller's input is
 * already safe.
 */
export function computeCandidatePositionEconomics(
  candidate: Pick<CanonicalFrontierCandidate, 'candidateId' | 'economics'>,
  quantity: number,
): CandidatePositionEconomics {
  const perContract = candidate.economics;
  const invalidReason = !Number.isFinite(quantity)
    ? 'QUANTITY_NOT_FINITE'
    : !Number.isInteger(quantity)
      ? 'QUANTITY_NOT_INTEGER'
      : quantity < 0
        ? 'QUANTITY_NEGATIVE'
        : null;

  if (invalidReason !== null) {
    return {
      contractVersion: candidatePositionEconomicsVersion, candidateId: candidate.candidateId, quantity,
      validity: 'INVALID_QUANTITY', invalidReason, perContract,
      positionGrossPremium: null, positionCollateral: null, positionMaxProfit: null, positionMaxLoss: null,
      breakEvenPerShare: perContract.breakEven, capitalDayYieldRate: perContract.capitalDayYield,
    };
  }

  return {
    contractVersion: candidatePositionEconomicsVersion, candidateId: candidate.candidateId, quantity,
    validity: 'VALID', invalidReason: null, perContract,
    positionGrossPremium: scaledOrNull(perContract.grossPremium, quantity),
    positionCollateral: scaledOrNull(perContract.collateral, quantity),
    positionMaxProfit: scaledOrNull(perContract.maxProfit, quantity),
    positionMaxLoss: scaledOrNull(perContract.maxLoss, quantity),
    // Never scaled -- per-share price and a dimensionless-per-day rate.
    breakEvenPerShare: perContract.breakEven,
    capitalDayYieldRate: perContract.capitalDayYield,
  };
}

// Phase 3 Final Closure B (directive items 31-36): contractual assignment
// entry-exposure facts for a short PUT (Q/H). Never an assignment
// PROBABILITY (that remains genuinely UNKNOWN/EMPIRICAL, per directive
// item 37) -- only the deterministic contractual consequence IF assigned,
// using known strike/multiplier/quantity/premium, exactly as the owner's
// TRD-aligned "assignment is a modeled lifecycle transition, not automatic
// failure" rule requires: expose the facts, never the probability, never
// treat this as itself a max-loss claim.
export interface ShortPutAssignmentEntryExposure {
  readonly validity: 'VALID' | 'UNKNOWN_MULTIPLIER' | 'INVALID_QUANTITY';
  readonly invalidReason: string | null;
  /** `multiplier * quantity`, the real share count if assigned -- never
   * assumed 100; `null` if multiplier or quantity is not a known,
   * standard-deliverable positive integer. */
  readonly assignedShareCount: number | null;
  /** `strike * multiplier * quantity`, the gross cash purchase obligation
   * at assignment. Standard equity deliverables only -- an
   * ADJUSTED/UNKNOWN deliverable classification must fail closed to
   * `null`, never apply this formula naively. */
  readonly assignmentCashRequirement: number | null;
  /** `strike - premiumPerShare` -- identical to the candidate's own
   * `breakEven` (documented relationship, not a duplicate independent
   * formula): the gross per-share basis if assigned, before costs. */
  readonly effectiveAssignedBasisPerShare: number | null;
}

export function computeShortPutAssignmentEntryExposure(input: {
  readonly strike: number;
  readonly premiumPerShare: number | null;
  readonly multiplier: number;
  readonly quantity: number;
  readonly deliverableClassification?: 'STANDARD_EQUITY' | 'ADJUSTED' | 'UNKNOWN';
}): ShortPutAssignmentEntryExposure {
  if (!Number.isFinite(input.quantity) || !Number.isInteger(input.quantity) || input.quantity < 0) {
    return { validity: 'INVALID_QUANTITY', invalidReason: 'QUANTITY_NOT_A_NONNEGATIVE_INTEGER', assignedShareCount: null, assignmentCashRequirement: null, effectiveAssignedBasisPerShare: null };
  }
  const deliverable = input.deliverableClassification ?? 'STANDARD_EQUITY';
  const standardMultiplier = deliverable === 'STANDARD_EQUITY' && Number.isFinite(input.multiplier) && Number.isInteger(input.multiplier) && input.multiplier > 0;
  if (!standardMultiplier) {
    return { validity: 'UNKNOWN_MULTIPLIER', invalidReason: `DELIVERABLE_${deliverable}_NOT_NAIVELY_CALCULABLE`, assignedShareCount: null, assignmentCashRequirement: null, effectiveAssignedBasisPerShare: null };
  }
  return {
    validity: 'VALID', invalidReason: null,
    assignedShareCount: input.multiplier * input.quantity,
    assignmentCashRequirement: input.strike * input.multiplier * input.quantity,
    effectiveAssignedBasisPerShare: input.premiumPerShare === null ? null : input.strike - input.premiumPerShare,
  };
}
