import type { ManagementInputState } from './management-input-state.js';
import { buildLossStateVector, type LossStateVector } from './loss-state-vector.js';

export const thesisInvalidationVersion = 'theta-thesis-invalidation-v1' as const;

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
}

function finite(value: number | null): value is number {
  return value !== null && Number.isFinite(value);
}

function eventStateLabel(eventState: unknown): string | null {
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
  const lossDollars = priceLossDollars(state);
  const priceLossKnown = lossDollars !== null;
  const structureBroken = priceStructureBroken(state);

  const thesisFailureSignals: string[] = [];
  const uninterpretedSignals: string[] = [];

  if (structureBroken === true) thesisFailureSignals.push('PRICE_STRUCTURE_BREAK_ITM_AGAINST_SHORT_PREMIUM_THESIS');
  if (state.context.aegisState === 'HARD_VETO') thesisFailureSignals.push('AEGIS_HARD_VETO');
  else if (typeof state.context.aegisState === 'string' && !['ALLOW_FULL', 'ALLOW_REDUCED'].includes(state.context.aegisState)) {
    thesisFailureSignals.push(`AEGIS_STATE_ADVERSE_${state.context.aegisState}`);
  }
  if (state.context.dividendExDateState !== null) thesisFailureSignals.push('DIVIDEND_EX_DATE_RISK_PRESENT');
  const eventLabel = eventStateLabel(state.context.eventState);
  if (eventLabel !== null && eventLabel !== 'CLEAR') thesisFailureSignals.push(`EVENT_STATE_${eventLabel}`);
  else if (state.context.eventState !== null && eventLabel === null) uninterpretedSignals.push('EVENT_STATE_SHAPE_UNRECOGNIZED');

  // These context fields have no codebase-verified sub-schema this module
  // can safely interpret -- their presence is reported, never their
  // meaning, so they never silently count toward THESIS_FAILURE.
  if (state.context.ownershipQuality !== null) uninterpretedSignals.push('OWNERSHIP_QUALITY_PRESENT_UNINTERPRETED');
  if (state.context.regimeState !== null) uninterpretedSignals.push('REGIME_STATE_PRESENT_UNINTERPRETED');
  if (state.context.concentration !== null) uninterpretedSignals.push('PORTFOLIO_CONCENTRATION_PRESENT_UNINTERPRETED');
  if (state.context.sectorCorrelation !== null) uninterpretedSignals.push('SECTOR_CORRELATION_PRESENT_UNINTERPRETED');

  const hasThesisFailure = thesisFailureSignals.length > 0;
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
  };
}
