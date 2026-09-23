import type { CanonicalStrategyFrontier } from '../theta/canonical-strategy-frontier.js';
import { deterministicRuntimeUuid } from '../theta/postgres-theta-cycle-store.js';
import { applyPaperEvidenceRiskCap } from './execution-authorization-tier.js';
import { masterPaperActionPlanVersion, type ApprovedMasterPaperActionPlan } from './master-paper-action-handoff.js';
import { paperBootstrapAllowedUnknownComponent, paperBootstrapAllowedUnknownReason, paperEntryBootstrapPolicyVersion } from '../theta/paper-entry-bootstrap.js';
import { verifyPaperEntrySafetyPolicyReceipt, type PaperEntrySafetyPolicyReceipt } from '../theta/paper-entry-safety-policy.js';

export const masterPaperPlanAssemblyVersion = 'theta-master-paper-plan-assembly-v1' as const;

export interface MasterPaperPlanAssemblyInput {
  readonly frontier: CanonicalStrategyFrontier;
  readonly executionAccountId: string | null;
  readonly decisionId: string;
  readonly persistedCandidateId: string | null;
  readonly optionContractId: string | null;
  readonly underlyingId: string | null;
  readonly accountStatus: string | null;
  readonly optionsApprovedLevel: number | null;
  readonly optionsTradingLevel: number | null;
  readonly aegisState: 'ALLOW_FULL' | 'ALLOW_REDUCED' | 'HOLD_ONLY' | 'HARD_VETO' | 'DEFINED_RISK_ONLY' | 'EMERGENCY_EXIT_ONLY' | null;
  readonly aegisInputOrigin: 'DERIVED_FROM_REAL' | 'CALLER_MANUAL' | 'SYNTHETIC_FIXTURE' | 'UNKNOWN' | null;
  readonly entrySafetyPolicy: PaperEntrySafetyPolicyReceipt;
  readonly openPositionSymbols: readonly string[];
  readonly openOrderSymbols: readonly string[];
  readonly paperEvidenceRiskCap: number;
  readonly modeledRoundTripCostPerContract: number | null;
  readonly now: string;
  readonly decisionExpiresAt: string;
}

export type MasterPaperPlanAssemblyResult =
  | { readonly state: 'READY'; readonly plan: ApprovedMasterPaperActionPlan; readonly blockers: readonly [] }
  | { readonly state: 'NO_ACTION' | 'BLOCKED'; readonly plan: null; readonly blockers: readonly string[] };

const adaptivePricingPolicy = Object.freeze({
  waitIntervalMs: 5_000,
  maxAttempts: 3,
  concessionFractions: [0, 0.5, 1] as const,
  tickSize: 0.01,
});

const finite = (value: number | null): value is number => value !== null && Number.isFinite(value);
const ceilToTick = (value: number, tick: number): number => Number((Math.ceil(value / tick - 1e-10) * tick).toFixed(8));

/**
 * Turns one canonical, persisted OPEN_CSP selection into a bounded Paper
 * evidence plan. This function never decides what to trade and never treats
 * structural credit as empirical expectancy. Missing proof returns blockers.
 */
export function assembleMasterPaperEvidencePlan(input: MasterPaperPlanAssemblyInput): MasterPaperPlanAssemblyResult {
  const frontier = input.frontier;
  if (frontier.primaryAction === 'GLOBAL_WAIT' || frontier.primaryAction === 'SYSTEM_HOLD'
    || frontier.primaryAction === 'MANAGEMENT_AUTHORITY') {
    return { state: 'NO_ACTION', plan: null, blockers: [`CANONICAL_ACTION_${frontier.primaryAction}`] };
  }
  const selected = frontier.branches.flatMap((branch) => branch.candidates)
    .find((candidate) => candidate.candidateId === frontier.selectedCandidateId);
  const selectedBranch = selected === undefined ? undefined : frontier.branches.find((branch) => branch.branch === selected.branch);
  const blockers: string[] = [];
  const entrySafetyPolicy = verifyPaperEntrySafetyPolicyReceipt(input.entrySafetyPolicy);
  if (entrySafetyPolicy === null) blockers.push('ENTRY_SAFETY_POLICY_RECEIPT_INVALID');
  else if (entrySafetyPolicy.action !== 'CLEAR') {
    if (entrySafetyPolicy.companyEvent.action !== 'CLEAR') blockers.push(`COMPANY_EVENT_POLICY_${entrySafetyPolicy.companyEvent.state}`);
    if (entrySafetyPolicy.corporateAction.action !== 'CLEAR') blockers.push(`CORPORATE_ACTION_POLICY_${entrySafetyPolicy.corporateAction.state}`);
  }
  if (selected === undefined) blockers.push('CANONICAL_SELECTED_CANDIDATE_NOT_FOUND');
  if (frontier.primaryAction !== 'OPEN_CSP') blockers.push(`ACTION_NOT_YET_CONNECTED:${frontier.primaryAction}`);
  if (selected?.action !== 'OPEN_CSP') blockers.push('SELECTED_ACTION_NOT_OPEN_CSP');
  if (selected?.branch !== 'THETA_CONVENTIONAL') blockers.push('BRANCH_NOT_AUTHORIZED_FOR_MASTER_PAPER_ENTRY');
  if (selectedBranch?.status !== 'SHADOW') blockers.push('STRATEGY_BRANCH_NOT_PAPER_EVIDENCE_ELIGIBLE');
  if (selected?.legs.length !== 1) blockers.push('SINGLE_LEG_CSP_REQUIRED');
  const selectedLeg = selected?.legs[0];
  if (selectedLeg?.positionIntent !== 'SELL_TO_OPEN' || selectedLeg?.optionType !== 'PUT') blockers.push('CSP_LEG_IDENTITY_INVALID');
  if (!selected?.structurallyFeasible || !selected.riskFeasible || selected.hardBlockers.length > 0) blockers.push('HARD_VALIDITY_FAILED');
  if (frontier.selectedQuantity <= 0) blockers.push('CANONICAL_QUANTITY_ZERO');
  if (input.executionAccountId === null) blockers.push('MASTER_EXECUTION_ACCOUNT_NOT_CREATED');
  if (input.persistedCandidateId === null) blockers.push('SELECTED_CANDIDATE_NOT_PERSISTED');
  if (input.optionContractId === null || input.underlyingId === null) blockers.push('PERSISTED_CONTRACT_IDENTITY_MISSING');
  if (input.accountStatus !== 'ACTIVE') blockers.push('MASTER_ACCOUNT_NOT_ACTIVE');
  const optionsLevel = Math.max(input.optionsApprovedLevel ?? 0, input.optionsTradingLevel ?? 0);
  if (optionsLevel < 1) blockers.push('OPTIONS_CAPABILITY_NOT_VERIFIED');
  const symbol = selectedLeg?.optionSymbol ?? '';
  if (input.openPositionSymbols.includes(symbol) || input.openOrderSymbols.includes(symbol)) blockers.push('EQUIVALENT_EXPOSURE_CONFLICT');
  if (!finite(input.modeledRoundTripCostPerContract) || input.modeledRoundTripCostPerContract < 0) blockers.push('COST_MODEL_INCOMPLETE');
  if (!Number.isFinite(Date.parse(input.now)) || !Number.isFinite(Date.parse(input.decisionExpiresAt))
    || Date.parse(input.decisionExpiresAt) <= Date.parse(input.now)) blockers.push('DECISION_EXPIRY_INVALID');
  const multiplier = selectedLeg?.multiplier ?? 0;
  if (!Number.isInteger(multiplier) || multiplier <= 0) blockers.push('CONTRACT_MULTIPLIER_INVALID');
  const structuralCredit = selected?.economics.premiumPerShare ?? null;
  if (!finite(structuralCredit) || structuralCredit <= 0) blockers.push('STRUCTURAL_CREDIT_UNKNOWN');
  const sizing = applyPaperEvidenceRiskCap(frontier.selectedQuantity, input.paperEvidenceRiskCap);
  if (sizing.paperEvidenceQuantity === 0) blockers.push('PAPER_EVIDENCE_QUANTITY_ZERO');
  if (input.aegisState === null) blockers.push('AEGIS_SELECTION_LINEAGE_MISSING');
  else if (!['ALLOW_FULL', 'ALLOW_REDUCED'].includes(input.aegisState)) blockers.push('AEGIS_NOT_APPROVED');
  if (input.aegisInputOrigin !== 'DERIVED_FROM_REAL') blockers.push('AEGIS_REAL_INPUT_LINEAGE_MISSING');
  if (selected !== undefined && input.aegisState !== selected.aegisState) blockers.push('AEGIS_SELECTION_LINEAGE_MISMATCH');
  const entryEligibility = selected?.entryEligibility;
  if (entryEligibility === undefined) blockers.push('ENTRY_ELIGIBILITY_LINEAGE_MISSING');
  else if (entryEligibility.basis === 'INELIGIBLE') blockers.push('ENTRY_ELIGIBILITY_FAILED');
  else if (entryEligibility.basis === 'PAPER_ENTRY_BOOTSTRAP_UNCALIBRATED') {
    if (entryEligibility.paperBootstrapPolicyVersion !== paperEntryBootstrapPolicyVersion
      || entryEligibility.paperBootstrapAllowedUnknownComponents.length !== 1
      || entryEligibility.paperBootstrapAllowedUnknownComponents[0] !== paperBootstrapAllowedUnknownComponent
      || entryEligibility.paperBootstrapReasonCodes.length !== 1
      || entryEligibility.paperBootstrapReasonCodes[0] !== paperBootstrapAllowedUnknownReason) {
      blockers.push('PAPER_BOOTSTRAP_ELIGIBILITY_LINEAGE_INVALID');
    }
  }

  if (blockers.length > 0 || selected === undefined || selectedLeg === undefined
    || input.executionAccountId === null || input.persistedCandidateId === null
    || input.optionContractId === null || input.underlyingId === null
    || !finite(input.modeledRoundTripCostPerContract) || !finite(structuralCredit) || multiplier <= 0
    || input.aegisState === null || !['ALLOW_FULL', 'ALLOW_REDUCED'].includes(input.aegisState)) {
    return { state: 'BLOCKED', plan: null, blockers: [...new Set(blockers)] };
  }

  const economicBoundary = ceilToTick(Math.max(
    adaptivePricingPolicy.tickSize,
    input.modeledRoundTripCostPerContract / multiplier + adaptivePricingPolicy.tickSize,
  ), adaptivePricingPolicy.tickSize);
  const economicsRemainPositive = structuralCredit >= economicBoundary;
  if (!economicsRemainPositive) return { state: 'BLOCKED', plan: null, blockers: ['FORWARD_STRUCTURAL_ECONOMICS_NOT_POSITIVE'] };
  const chainId = deterministicRuntimeUuid(`paper-evidence-chain:${input.decisionId}:${selected.underlying}`);
  const actionPlanId = deterministicRuntimeUuid(`paper-evidence-plan:${input.decisionId}:${input.persistedCandidateId}`);
  return {
    state: 'READY', blockers: [],
    plan: {
      contractVersion: masterPaperActionPlanVersion,
      actionPlanId,
      decisionAuthority: 'NEW_RISK',
      managementInputSnapshotId: null,
      managementActionFrontierId: null,
      actionGroupId: actionPlanId,
      legSequence: 1,
      dependsOnActionPlanId: null,
      executionAccountId: input.executionAccountId,
      decisionId: input.decisionId,
      candidateId: input.persistedCandidateId,
      strategyVersion: frontier.strategyVersion,
      chainId,
      optionContractId: input.optionContractId,
      underlyingId: input.underlyingId,
      underlying: selected.underlying,
      optionType: 'PUT',
      symbol: selectedLeg.optionSymbol,
      quantity: sizing.paperEvidenceQuantity,
      ...sizing,
      executionTier: 'PAPER_EVIDENCE',
      multiplier,
      action: 'OPEN_CSP',
      economicBoundary,
      economicsRemainPositive,
      expectedAfterCostEv: null,
      empiricalEconomicsReady: false,
      selectedByCanonicalAuthority: true,
      hardValidityPassed: true,
      accountVerified: true,
      optionsCapabilityVerified: true,
      noEquivalentExposureConflict: true,
      aegisState: input.aegisState as 'ALLOW_FULL' | 'ALLOW_REDUCED',
      killSwitchActive: false,
      decisionExpiresAt: input.decisionExpiresAt,
      pricingPolicy: adaptivePricingPolicy,
      pricingAttempt: 0,
      previousLimit: null,
      entrySafetyPolicy: entrySafetyPolicy as PaperEntrySafetyPolicyReceipt,
    },
  };
}
