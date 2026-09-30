import type { ManagementInputState } from './management-input-state.js';
import { buildLossStateVector, type LossStateVector } from './loss-state-vector.js';
import { riskStateSchema } from './aegis-contract.js';
import { ownershipEvaluationResponseSchema } from './ownership-contract.js';

export const thesisInvalidationVersion = 'theta-thesis-invalidation-v2' as const;

/**
 * Separates PRICE_LOSS (the position's current mark is unfavorable) from
 * THESIS_FAILURE (a structural reason the original trade rationale no
 * longer holds) -- a position can show either without the other. No single
 * indicator decides THESIS_FAILURE; this module only ever ACCUMULATES
 * named, individually-honest signals and reports uncertainty explicitly.
 * It produces no probability and no close/hold/roll recommendation --
 * classification is descriptive evidence for a management policy to weigh,
 * never a verdict.
 */
export type ThesisInvalidationClassification =
  | 'NO_KNOWN_LOSS' | 'PRICE_LOSS_ONLY' | 'THESIS_FAILURE_SUSPECTED'
  | 'THESIS_FAILURE_AND_PRICE_LOSS' | 'INSUFFICIENT_EVIDENCE';

export interface ThesisInvalidationAssessment {
  readonly contractVersion: typeof thesisInvalidationVersion;
  readonly asOf: string;
  readonly priceLossKnown: boolean;
  readonly priceLossDollars: number | null;
  /** True when the position is now ITM against its original short-premium
   * thesis (a known structural fact, never a probability). */
  readonly priceStructureBroken: boolean | null;
  readonly classification: ThesisInvalidationClassification;
  readonly thesisFailureSignals: readonly string[];
  /** Signals observed but NOT counted toward THESIS_FAILURE because their
   * upstream shape/meaning is not verified in this codebase -- named so a
   * reviewer knows what was deliberately left uninterpreted, not silently
   * dropped. */
  readonly uninterpretedSignals: readonly string[];
  readonly uncertaintyNote: string;
  readonly lossState: LossStateVector;
  readonly originalEntryThesisHash: string | null;
  readonly entryBreakEvenBreached: boolean | null;
  readonly thesisHealth: {
    readonly state: 'THESIS_VALID' | 'THESIS_WEAKENED' | 'THESIS_FAILED' | 'THESIS_UNKNOWN';
    readonly policyVersion: 'theta-management-thesis-health-v1';
    readonly scope: 'OBSERVED_STRUCTURAL_CONDITIONS_NOT_PROFITABILITY';
    readonly maxOwnershipAgeMs: 180000;
    readonly ownershipEvidenceState: 'QUALIFIED' | 'UNKNOWN';
    readonly reasons: readonly string[];
  };
}

function finite(value: number | null): value is number {
  return value !== null && Number.isFinite(value);
}

function eventStateLabel(eventState: unknown): string | null {
  if (typeof eventState === 'string') return eventState;
  if (eventState !== null && typeof eventState === 'object' && !Array.isArray(eventState) && 'state' in eventState) {
    const value = (eventState as Record<string, unknown>).state;
    return typeof value === 'string' ? value : null;
  }
  return null;
}

function priceLossDollars(state: ManagementInputState): number | null {
  const { optionBid, optionAsk } = state.market, { multiplier, contracts } = state.contract;
  const { entryCreditDebit, stockBasisPerShare, stockMarkPerShare, openStockShares } = state.economics;
  if (openStockShares > 0) {
    return finite(stockBasisPerShare) && finite(stockMarkPerShare)
      ? (stockBasisPerShare - stockMarkPerShare) * openStockShares : null;
  }
  if (finite(optionBid) && finite(optionAsk) && finite(multiplier) && finite(contracts) && finite(entryCreditDebit)) {
    const currentMark = ((optionBid + optionAsk) / 2) * multiplier * contracts;
    return currentMark - Math.abs(entryCreditDebit);
  }
  return null;
}

function priceStructureBroken(state: ManagementInputState): boolean | null {
  const { spot } = state.market, { strike, optionType } = state.contract;
  if (!finite(spot) || !finite(strike) || optionType === null) return null;
  return optionType === 'PUT' ? spot < strike : spot > strike;
}

export function assessThesisInvalidation(state: ManagementInputState): ThesisInvalidationAssessment {
  const lossState = buildLossStateVector(state);
  const originalThesis = state.originalEntryThesis?.state === 'VERIFIED' ? state.originalEntryThesis.receipt : null;
  const lossDollars = priceLossDollars(state);
  const priceLossKnown = lossDollars !== null;
  const structureBroken = priceStructureBroken(state);

  const thesisFailureSignals: string[] = [];
  const uninterpretedSignals: string[] = [];
  if (originalThesis === null) uninterpretedSignals.push(state.originalEntryThesis?.reason ?? 'ORIGINAL_ENTRY_THESIS_UNAVAILABLE');
  // Breaching original break-even is descriptive price evidence, never proof
  // of structural thesis failure and never an independent close instruction.
  const entryBreakEvenBreached = originalThesis !== null && finite(state.market.spot)
    ? state.market.spot < originalThesis.breakEven : null;

  if (structureBroken === true) thesisFailureSignals.push('PRICE_STRUCTURE_BREAK_ITM_AGAINST_SHORT_PREMIUM_THESIS');
  if (state.context.aegisState === 'HARD_VETO') thesisFailureSignals.push('AEGIS_HARD_VETO');
  else if (riskStateSchema.safeParse(state.context.aegisState).success
    && typeof state.context.aegisState === 'string' && !['ALLOW_FULL', 'ALLOW_REDUCED'].includes(state.context.aegisState)) {
    thesisFailureSignals.push(`AEGIS_STATE_ADVERSE_${state.context.aegisState}`);
  } else if (state.context.aegisState !== null && !riskStateSchema.safeParse(state.context.aegisState).success) {
    uninterpretedSignals.push('AEGIS_STATE_UNQUALIFIED');
  }
  // Presence of an event object/date is not a qualified adverse event. Use
  // the existing tri-state semantics, retaining unknown/opaque evidence.
  // The action frontier still enforces its own required-evidence safety.
  const safeLabels = new Set(['CLEAR', 'ABSENT_VERIFIED', 'NOT_APPLICABLE']);
  const dividendLabel = eventStateLabel(state.context.dividendExDateState);
  if (dividendLabel === 'PRESENT') thesisFailureSignals.push('DIVIDEND_EX_DATE_RISK_PRESENT');
  else if (state.context.dividendExDateState !== null && !safeLabels.has(dividendLabel ?? ''))
    uninterpretedSignals.push('DIVIDEND_STATE_UNQUALIFIED');
  const eventLabel = eventStateLabel(state.context.eventState);
  if (eventLabel === 'PRESENT' || eventLabel === 'EARNINGS_IMMINENT') thesisFailureSignals.push(`EVENT_STATE_${eventLabel}`);
  else if (state.context.eventState !== null && eventLabel === null) uninterpretedSignals.push('EVENT_STATE_SHAPE_UNRECOGNIZED');
  else if (eventLabel !== null && !safeLabels.has(eventLabel)) uninterpretedSignals.push('EVENT_STATE_UNQUALIFIED');

  // These context fields have no codebase-verified sub-schema this module
  // can safely interpret -- their presence is reported, never their
  // meaning, so they never silently count toward THESIS_FAILURE.
  if (state.context.ownershipQuality !== null) uninterpretedSignals.push('OWNERSHIP_QUALITY_PRESENT_UNINTERPRETED');
  if (state.context.regimeState !== null) uninterpretedSignals.push('REGIME_STATE_PRESENT_UNINTERPRETED');
  if (state.context.concentration !== null) uninterpretedSignals.push('PORTFOLIO_CONCENTRATION_PRESENT_UNINTERPRETED');
  if (state.context.sectorCorrelation !== null) uninterpretedSignals.push('SECTOR_CORRELATION_PRESENT_UNINTERPRETED');

  const ownership = ownershipEvaluationResponseSchema.safeParse(state.context.ownershipAssessment);
  const ownershipAge = ownership.success ? Date.parse(state.observedAt) - Date.parse(ownership.data.timestamp) : NaN;
  const ownershipQualified = ownership.success && ownership.data.underlyingSymbol === state.underlying
    && ownership.data.snapshotId === state.evidenceBundle.fusionSnapshotHash
    && Number.isFinite(ownershipAge) && ownershipAge >= 0 && ownershipAge <= 180_000
    && ownership.data.ownability !== null
    && ownership.data.thesisInvalidated === ownership.data.reasons.some(reason => reason.code === 'THESIS_INVALIDATED' && reason.polarity === -1);
  // A model's false default is not positive thesis assurance. Full structural
  // coverage is required for VALID. Explicit invalidation requires its named
  // model reason, not a low score, a loss, or an opaque expert-prior object.
  const invalidated = ownershipQualified && ownership.success && ownership.data.thesisInvalidated
    && ownership.data.reasons.some(reason => reason.code === 'THESIS_INVALIDATED' && reason.polarity === -1);
  if (invalidated) thesisFailureSignals.push('QUALIFIED_OWNERSHIP_THESIS_INVALIDATED');
  const hasThesisFailure = thesisFailureSignals.length > 0;
  const thesisHealthReasons = [
    ...(originalThesis === null ? ['ORIGINAL_THESIS_NOT_VERIFIED'] : []),
    ...(!ownershipQualified ? ['CURRENT_OWNERSHIP_EVIDENCE_UNQUALIFIED'] : []),
    ...(invalidated ? ['QUALIFIED_OWNERSHIP_THESIS_INVALIDATED'] : []),
    ...thesisFailureSignals,
  ];
  const coverageComplete = originalThesis !== null && ownershipQualified
    && safeLabels.has(eventLabel ?? '') && safeLabels.has(dividendLabel ?? '')
    && ['ALLOW_FULL', 'ALLOW_REDUCED'].includes(String(state.context.aegisState))
    && state.hardBlockers.length === 0 && state.evidenceBundle.timingState === 'VALID'
    && state.context.assignmentCapacityEvidence.state !== 'UNKNOWN';
  const thesisHealthState = originalThesis === null ? 'THESIS_UNKNOWN'
    : invalidated ? 'THESIS_FAILED'
      : hasThesisFailure ? 'THESIS_WEAKENED'
        : coverageComplete ? 'THESIS_VALID' : 'THESIS_UNKNOWN';
  if (!coverageComplete && thesisHealthState === 'THESIS_UNKNOWN') thesisHealthReasons.push('STRUCTURAL_THESIS_COVERAGE_INCOMPLETE');
  const classification: ThesisInvalidationClassification =
    !priceLossKnown && structureBroken === null && !hasThesisFailure ? 'INSUFFICIENT_EVIDENCE'
      : hasThesisFailure && priceLossKnown && (lossDollars as number) > 0 ? 'THESIS_FAILURE_AND_PRICE_LOSS'
        : hasThesisFailure ? 'THESIS_FAILURE_SUSPECTED'
          : priceLossKnown && (lossDollars as number) > 0 ? 'PRICE_LOSS_ONLY'
            : 'NO_KNOWN_LOSS';

  const uncertaintyNote = uninterpretedSignals.length === 0
    ? 'No additional context signals were present beyond what was interpreted.'
    : `Present but not interpreted (no verified schema): ${uninterpretedSignals.join(', ')}.`;

  return {
    contractVersion: thesisInvalidationVersion, asOf: state.observedAt,
    priceLossKnown, priceLossDollars: lossDollars, priceStructureBroken: structureBroken,
    classification, thesisFailureSignals, uninterpretedSignals, uncertaintyNote, lossState,
    originalEntryThesisHash: originalThesis?.immutableHash ?? null, entryBreakEvenBreached,
    thesisHealth: { state: thesisHealthState, policyVersion: 'theta-management-thesis-health-v1',
      scope: 'OBSERVED_STRUCTURAL_CONDITIONS_NOT_PROFITABILITY', maxOwnershipAgeMs: 180000,
      ownershipEvidenceState: ownershipQualified ? 'QUALIFIED' : 'UNKNOWN', reasons: thesisHealthReasons },
  };
}
