import type { InstrumentClassificationEvidence } from './paper-entry-safety-policy.js';
import { securedContractCapacity } from './secured-contract-capacity.js';

// Phase 2 (offline deterministic correctness): pure classifier that keeps four facts separate that are easy to blur:
//   1. a symbol was DISCOVERED (tradable, optionable, liquid)           -> says nothing about approval;
//   2. a symbol is APPROVED for Alpaca Paper bootstrap                  -> only an owner-approved versioned manifest says so;
//   3. an approved symbol FITS the account's capital                    -> a separate, mechanical fact;
//   4. an approved symbol's promotion evidence is COMPLETE              -> every contract slot is typed, never defaulted.
// This module approves nothing, authorizes no execution, and does NOT define a relative-strength formula: the
// relative-strength slot is OWNER_POLICY_REQUIRED until an owner-supplied policy reference exists.

export const instrumentEligibilityPolicyVersion = 'theta-instrument-eligibility-state-v1' as const;

export type InstrumentEligibilityState =
  | 'DISCOVERED_NOT_APPROVED'
  | 'APPROVED_NOT_CAPITAL_FIT'
  | 'APPROVED_CAPITAL_FIT'
  | 'APPROVED_DATA_INCOMPLETE'
  | 'RESEARCH_ONLY';

export const instrumentEligibilityStates: readonly InstrumentEligibilityState[] = [
  'DISCOVERED_NOT_APPROVED', 'APPROVED_NOT_CAPITAL_FIT', 'APPROVED_CAPITAL_FIT', 'APPROVED_DATA_INCOMPLETE', 'RESEARCH_ONLY',
];

export type PromotionSlotState = 'KNOWN' | 'UNKNOWN' | 'REQUIRED_NOT_PROVIDED' | 'OWNER_POLICY_REQUIRED';

/** A typed slot. KNOWN needs a non-null value AND a non-empty evidence reference; anything else is not known. */
export interface PromotionSlot<T = unknown> {
  readonly state: PromotionSlotState;
  readonly value: T | null;
  readonly evidenceRef: string | null;
}

/** Every field the instrument promotion contract must carry before an approved instrument may be treated as data-complete. */
export const instrumentPromotionContractFields = [
  'identity', 'assetClass', 'exchange', 'optionability', 'standardDeliverable', 'issuerProductAuthority',
  'fundOrCompanyClassification', 'leveragedInverse', 'earningsApplicability', 'corporateActionHandling',
  'relativeStrengthAvailability', 'stockLiquidity', 'optionLiquidity', 'spreadQuality', 'assignmentSuitability',
  'recoverySuitability', 'capitalFit', 'eventCoverage', 'policyVersion',
] as const;
export type InstrumentPromotionField = (typeof instrumentPromotionContractFields)[number];
export type InstrumentPromotionContract = { readonly [K in InstrumentPromotionField]: PromotionSlot };

const unknownSlot = (): PromotionSlot => ({ state: 'UNKNOWN', value: null, evidenceRef: null });

/** Every slot UNKNOWN; relative strength is explicitly OWNER_POLICY_REQUIRED; policy version REQUIRED_NOT_PROVIDED. */
export function emptyInstrumentPromotionContract(): InstrumentPromotionContract {
  const slots = Object.fromEntries(instrumentPromotionContractFields.map((field) => [field, unknownSlot()])) as
    { -readonly [K in InstrumentPromotionField]: PromotionSlot };
  slots.relativeStrengthAvailability = { state: 'OWNER_POLICY_REQUIRED', value: null, evidenceRef: null };
  slots.policyVersion = { state: 'REQUIRED_NOT_PROVIDED', value: null, evidenceRef: null };
  return slots;
}

const isKnown = (slot: PromotionSlot | undefined): boolean => slot !== undefined && slot.state === 'KNOWN'
  && slot.value !== null && slot.value !== undefined && typeof slot.evidenceRef === 'string' && slot.evidenceRef.trim().length > 0;

export interface InstrumentApprovalAuthority {
  /** True only for an owner-approved versioned manifest entry. Discovery, liquidity, optionability never set this. */
  readonly paperBootstrapApproved: boolean;
  readonly authorityRef: string | null;
}

/** Derive approval strictly from the existing classification evidence; unqualified, conflicting, or Optionomics-only
 * evidence (company applicability proof) is never an approval. */
export function approvalAuthorityFromClassification(evidence: Pick<InstrumentClassificationEvidence,
  'state' | 'paperBootstrapApproved' | 'authority' | 'evidenceIds'>): InstrumentApprovalAuthority {
  const approved = evidence.paperBootstrapApproved === true && evidence.authority === 'VERSIONED_MANIFEST'
    && (evidence.state === 'NON_COMPANY_FUND' || evidence.state === 'OPERATING_COMPANY') && evidence.evidenceIds.length > 0;
  return { paperBootstrapApproved: approved, authorityRef: approved ? (evidence.evidenceIds[0] ?? null) : null };
}

export interface InstrumentEligibilityInput {
  readonly symbol: string;
  readonly discovered: boolean;
  /** Explicit research-only label (e.g. a row in a research file). Stricter than approval if both are set. */
  readonly researchOnly?: boolean;
  readonly approval: InstrumentApprovalAuthority | null;
  readonly capital: { readonly availableCapitalUsd: number | null; readonly collateralPerContractUsd: number | null };
  /** Caller-supplied evidence slots; any omitted slot is UNKNOWN. capitalFit is always derived here, never supplied. */
  readonly promotion?: Partial<Record<Exclude<InstrumentPromotionField, 'capitalFit'>, PromotionSlot>>;
}

export interface InstrumentEligibilityReceipt {
  readonly policyVersion: typeof instrumentEligibilityPolicyVersion;
  readonly symbol: string;
  readonly state: InstrumentEligibilityState;
  readonly approvedForPaperBootstrap: boolean;
  /** Always false: this classifier grants no execution authority. */
  readonly executionAuthorized: false;
  readonly capacityContracts: number | null;
  readonly blockers: readonly string[];
  readonly incompleteSlots: readonly InstrumentPromotionField[];
  readonly reviewFlags: readonly string[];
  readonly slots: InstrumentPromotionContract;
}

export function classifyInstrumentEligibility(input: InstrumentEligibilityInput): InstrumentEligibilityReceipt {
  const symbol = input.symbol.trim().toUpperCase();
  const approved = input.approval !== null && input.approval.paperBootstrapApproved === true
    && typeof input.approval.authorityRef === 'string' && input.approval.authorityRef.trim().length > 0;

  const capacity = securedContractCapacity(input.capital.availableCapitalUsd, input.capital.collateralPerContractUsd ?? Number.NaN);
  const base = emptyInstrumentPromotionContract();
  const slots = { ...base, ...(input.promotion ?? {}) } as { -readonly [K in InstrumentPromotionField]: PromotionSlot };
  // Relative strength can be KNOWN only against an owner-supplied policy reference; otherwise the policy is missing.
  const rs = slots.relativeStrengthAvailability;
  if (!isKnown(rs)) slots.relativeStrengthAvailability = { state: 'OWNER_POLICY_REQUIRED', value: null, evidenceRef: null };
  slots.capitalFit = capacity === null
    ? unknownSlot()
    : { state: 'KNOWN', value: { fits: capacity >= 1, capacityContracts: capacity }, evidenceRef: 'derived:secured-contract-capacity' };

  const incompleteSlots = instrumentPromotionContractFields.filter((field) => !isKnown(slots[field]));
  const reviewFlags: string[] = [];
  if (isKnown(slots.leveragedInverse) && slots.leveragedInverse.value === true) reviewFlags.push('LEVERAGED_OR_INVERSE_REQUIRES_OWNER_REVIEW');
  if (input.researchOnly === true && approved) reviewFlags.push('RESEARCH_ONLY_LABEL_CONFLICTS_WITH_APPROVAL');

  const receipt = (state: InstrumentEligibilityState, blockers: readonly string[]): InstrumentEligibilityReceipt => ({
    policyVersion: instrumentEligibilityPolicyVersion, symbol, state, approvedForPaperBootstrap: approved && state.startsWith('APPROVED'),
    executionAuthorized: false, capacityContracts: capacity, blockers, incompleteSlots, reviewFlags, slots,
  });

  if (input.researchOnly === true) return receipt('RESEARCH_ONLY', ['RESEARCH_ONLY_LABEL']);
  if (!approved) return receipt('DISCOVERED_NOT_APPROVED', [input.discovered ? 'NOT_OWNER_APPROVED' : 'NOT_DISCOVERED_AND_NOT_APPROVED']);

  // Approved. A KNOWN capital shortfall cannot be repaired by more data, so it is reported first; unknowns come next.
  if (capacity !== null && capacity < 1) return receipt('APPROVED_NOT_CAPITAL_FIT', ['CAPITAL_BELOW_ONE_CONTRACT_COLLATERAL']);
  if (incompleteSlots.length > 0) return receipt('APPROVED_DATA_INCOMPLETE', incompleteSlots.map((field) => `PROMOTION_SLOT_${field}_NOT_KNOWN`));
  return receipt('APPROVED_CAPITAL_FIT', []);
}
