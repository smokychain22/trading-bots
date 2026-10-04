export const masterPaperInstrumentPromotionVersion = 'theta-master-paper-instrument-promotion-v1' as const;

export type MasterPaperPromotionState =
  | 'PAPER_ONLY_APPROVED'
  | 'QUALIFIED_NOT_SELECTED_CAPACITY_BOUND'
  | 'NOT_QUALIFIED';

export interface MasterPaperPromotionEvidence {
  readonly symbol: string;
  readonly instrumentClass: 'NON_COMPANY_FUND' | 'OPERATING_COMPANY';
  readonly officialIssuerEvidenceRef: string | null;
  readonly alpacaTradable: boolean;
  readonly optionable: boolean;
  readonly activeChainComplete: boolean;
  readonly quoteEnumerationComplete: boolean;
  readonly standardContractCount: number;
  readonly quotedContractCount: number;
  readonly qEvidenceQualifiedCount: number;
  readonly qSoftCapCompatibleCount: number;
  readonly qHardCapCompatibleCount: number;
  readonly lowestQualifiedCollateralUsd: number | null;
  readonly averageUnderlyingDollarVolumeUsd: number | null;
  readonly leveragedOrInverse: boolean | null;
  readonly assignmentOwnershipStructurallySuitable: boolean | null;
  readonly pendingUnsupportedCorporateAction: boolean | null;
  readonly providerEvidenceObservedAt: string;
}

export interface MasterPaperPromotionCapacity {
  /** Proven safe full-chain count, including already-approved instruments. */
  readonly maximumApprovedFullChainSymbols: number;
  readonly capacityEvidenceRef: string;
}

export interface MasterPaperPromotionDecision {
  readonly symbol: string;
  readonly state: MasterPaperPromotionState;
  readonly qualified: boolean;
  readonly selected: boolean;
  readonly executionAuthorized: false;
  readonly blockers: readonly string[];
}

function finiteNonnegative(value: number | null): boolean {
  return value !== null && Number.isFinite(value) && value >= 0;
}

/**
 * Pure evidence gate for the owner-authorized Alpaca Paper universe expansion.
 * Discovery never grants approval. Price alone never grants approval. At least
 * one actual Q contract must clear the normal evidence screen and fit the
 * unchanged soft concentration cap before the instrument can be selected.
 */
export function qualifyMasterPaperPromotion(evidence: MasterPaperPromotionEvidence): {
  readonly qualified: boolean;
  readonly blockers: readonly string[];
} {
  const blockers: string[] = [];
  if (evidence.instrumentClass !== 'NON_COMPANY_FUND') blockers.push('OPERATING_COMPANY_REQUIRES_SEPARATE_OWNERSHIP_AND_EVENT_REVIEW');
  if (evidence.officialIssuerEvidenceRef === null || evidence.officialIssuerEvidenceRef.trim().length === 0)
    blockers.push('OFFICIAL_ISSUER_CLASSIFICATION_MISSING');
  if (!evidence.alpacaTradable) blockers.push('ALPACA_TRADABILITY_NOT_CONFIRMED');
  if (!evidence.optionable) blockers.push('OPTIONABILITY_NOT_CONFIRMED');
  if (!evidence.activeChainComplete) blockers.push('ACTIVE_CHAIN_INCOMPLETE');
  if (!evidence.quoteEnumerationComplete) blockers.push('QUOTE_ENUMERATION_INCOMPLETE');
  if (evidence.standardContractCount < 1) blockers.push('STANDARD_100_SHARE_CONTRACT_NOT_CONFIRMED');
  if (evidence.quotedContractCount < 1) blockers.push('REAL_ALPACA_BBO_NOT_OBSERVED');
  if (evidence.qEvidenceQualifiedCount < 1) blockers.push('NO_Q_EVIDENCE_QUALIFIED_CONTRACT');
  if (evidence.qSoftCapCompatibleCount < 1) blockers.push('NO_Q_CONTRACT_FITS_SOFT_TICKER_CAP');
  if (evidence.qHardCapCompatibleCount < 1) blockers.push('NO_Q_CONTRACT_FITS_HARD_TICKER_CAP');
  if (!finiteNonnegative(evidence.lowestQualifiedCollateralUsd) || evidence.lowestQualifiedCollateralUsd === 0)
    blockers.push('QUALIFIED_COLLATERAL_UNKNOWN');
  if (!finiteNonnegative(evidence.averageUnderlyingDollarVolumeUsd) || evidence.averageUnderlyingDollarVolumeUsd === 0)
    blockers.push('UNDERLYING_LIQUIDITY_UNKNOWN');
  if (evidence.leveragedOrInverse !== false) blockers.push('LEVERAGED_OR_INVERSE_STATUS_NOT_CLEAR');
  if (evidence.assignmentOwnershipStructurallySuitable !== true)
    blockers.push('ASSIGNMENT_OWNERSHIP_SUITABILITY_NOT_PROVEN');
  if (evidence.pendingUnsupportedCorporateAction === true)
    blockers.push('PENDING_UNSUPPORTED_CORPORATE_ACTION');
  if (!Number.isFinite(Date.parse(evidence.providerEvidenceObservedAt))) blockers.push('PROVIDER_EVIDENCE_TIME_INVALID');
  return { qualified: blockers.length === 0, blockers };
}

/** Selects only as many newly qualified symbols as the proven full-chain
 * runtime capacity permits. Ranking uses observable opportunity breadth and
 * underlying liquidity. It never uses ticker popularity or premium size. */
export function selectBoundedMasterPaperPromotions(input: {
  readonly existingApprovedSymbols: readonly string[];
  readonly candidates: readonly MasterPaperPromotionEvidence[];
  readonly capacity: MasterPaperPromotionCapacity;
}): readonly MasterPaperPromotionDecision[] {
  if (!Number.isInteger(input.capacity.maximumApprovedFullChainSymbols)
    || input.capacity.maximumApprovedFullChainSymbols < 1
    || input.capacity.capacityEvidenceRef.trim().length === 0) throw new Error('PAPER_PROMOTION_RUNTIME_CAPACITY_INVALID');
  const existing = new Set(input.existingApprovedSymbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean));
  const available = Math.max(0, input.capacity.maximumApprovedFullChainSymbols - existing.size);
  const qualified = input.candidates.map((evidence) => ({ evidence, result: qualifyMasterPaperPromotion(evidence) }));
  const selected = new Set(qualified.filter((item) => item.result.qualified)
    .sort((left, right) => right.evidence.qEvidenceQualifiedCount - left.evidence.qEvidenceQualifiedCount
      || (right.evidence.averageUnderlyingDollarVolumeUsd ?? -1) - (left.evidence.averageUnderlyingDollarVolumeUsd ?? -1)
      || left.evidence.symbol.localeCompare(right.evidence.symbol))
    .slice(0, available).map((item) => item.evidence.symbol));
  return qualified.map((item): MasterPaperPromotionDecision => ({
    symbol: item.evidence.symbol,
    state: !item.result.qualified ? 'NOT_QUALIFIED'
      : selected.has(item.evidence.symbol) ? 'PAPER_ONLY_APPROVED' : 'QUALIFIED_NOT_SELECTED_CAPACITY_BOUND',
    qualified: item.result.qualified,
    selected: selected.has(item.evidence.symbol),
    executionAuthorized: false,
    blockers: item.result.blockers,
  }));
}
