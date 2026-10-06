import type { CanonicalStrategyFrontier } from '../theta/canonical-strategy-frontier.js';
import { deterministicRuntimeUuid } from '../theta/postgres-theta-cycle-store.js';
import { applyPaperEvidenceRiskCap } from './execution-authorization-tier.js';
import { masterPaperActionPlanVersion, type ApprovedMasterPaperActionPlan, type DefinedRiskPlanLeg } from './master-paper-action-handoff.js';
import { definedRiskOpenPackageIdentity } from './defined-risk-paper-order.js';
import { verifyPaperEntrySafetyPolicyReceipt, type PaperEntrySafetyPolicyReceipt } from '../theta/paper-entry-safety-policy.js';
import { verifyAegisAssessmentIdentity, type AegisAssessmentIdentity } from '../theta/aegis-assessment-identity.js';
import { assertStrategyPaperOrderAllowed, type StrategyPaperAuthorityReceipt } from '../theta/strategy-paper-authority.js';

export const definedRiskPlanAssemblyVersion = 'theta-defined-risk-plan-assembly-v1' as const;

/** the persisted contract identity of each leg of the selected D candidate (trade.candidate.metrics_json.strategyCandidate.legs) */
export interface PersistedDefinedRiskLegIdentity { readonly legIndex: number; readonly occSymbol: string; readonly optionContractId: string }

export interface DefinedRiskPlanAssemblyInput {
  readonly frontier: CanonicalStrategyFrontier;
  readonly executionAccountId: string | null;
  readonly decisionId: string;
  readonly persistedCandidateId: string | null;
  readonly persistedLegs: readonly PersistedDefinedRiskLegIdentity[] | null;
  readonly underlyingId: string | null;
  readonly accountStatus: string | null;
  readonly optionsApprovedLevel: number | null;
  readonly optionsTradingLevel: number | null;
  readonly aegisState: string | null;
  readonly aegisInputOrigin: string | null;
  readonly aegisAssessmentIdentity: AegisAssessmentIdentity | null;
  readonly entrySafetyPolicy: PaperEntrySafetyPolicyReceipt;
  readonly openPositionSymbols: readonly string[];
  readonly openOrderSymbols: readonly string[];
  readonly paperEvidenceRiskCap: number;
  readonly firstCanaryCompleted: boolean;
  /** modeled round-trip cost per contract PER LEG (the same cost model Q uses); a spread pays it on both legs */
  readonly modeledRoundTripCostPerContract: number | null;
  readonly now: string;
  readonly decisionExpiresAt: string;
  readonly strategyPaperAuthority?: StrategyPaperAuthorityReceipt;
}

export type DefinedRiskPlanAssemblyResult =
  | { readonly state: 'READY'; readonly plan: ApprovedMasterPaperActionPlan; readonly blockers: readonly [] }
  | { readonly state: 'NO_ACTION' | 'BLOCKED'; readonly plan: null; readonly blockers: readonly string[] };

const pricingPolicy = Object.freeze({ waitIntervalMs: 5_000, maxAttempts: 3, concessionFractions: [0, 0.5, 1] as const, tickSize: 0.01 });
const finite = (value: number | null | undefined): value is number => value !== null && value !== undefined && Number.isFinite(value);
const ceilToTick = (value: number, tick: number): number => Number((Math.ceil(value / tick - 1e-10) * tick).toFixed(8));

/**
 * Turns ONE canonical, persisted D selection into a bounded Paper evidence plan for a native two-leg package. Exactly the gates the Q/H assembly applies, plus the
 * D-only ones: both legs' persisted contract identity, standard deliverables only, Options Level 3 (native multi-leg) and a governed THETA_DEFINED_RISK receipt
 * bound to the frontier. It never decides what to trade, never prices from one leg and never treats structural credit as expectancy.
 */
export function assembleDefinedRiskPaperEvidencePlan(input: DefinedRiskPlanAssemblyInput): DefinedRiskPlanAssemblyResult {
  const frontier = input.frontier;
  if (frontier.primaryAction !== 'OPEN_DEFINED_RISK' || frontier.selectedBranch !== 'THETA_DEFINED_RISK') {
    return { state: 'NO_ACTION', plan: null, blockers: [`CANONICAL_ACTION_${frontier.primaryAction}`] };
  }
  const blockers: string[] = [];
  const selected = frontier.branches.flatMap((branch) => branch.candidates).find((candidate) => candidate.candidateId === frontier.selectedCandidateId);
  if (selected === undefined) blockers.push('CANONICAL_SELECTED_CANDIDATE_NOT_FOUND');
  if (frontier.entrySelectionBasis !== 'THETA_D_DECISION_BOUND') blockers.push('CANONICAL_SELECTION_NOT_STRATEGY_DECISION_BOUND');
  if (selected?.branch !== 'THETA_DEFINED_RISK' || selected.action !== 'OPEN_DEFINED_RISK' || frontier.globalWaitEarned) blockers.push('CANONICAL_SELECTION_LINEAGE_INVALID');
  try {
    if (input.strategyPaperAuthority === undefined) throw new Error('MISSING');
    assertStrategyPaperOrderAllowed(input.strategyPaperAuthority, 'THETA_DEFINED_RISK');
    if (frontier.paperEntryAuthorityReceiptHash !== input.strategyPaperAuthority.receiptHash) throw new Error('MISMATCH');
    if (Date.parse(input.strategyPaperAuthority.observedAt) > Date.parse(input.now)) throw new Error('FUTURE');
  } catch { blockers.push('D_STRATEGY_PAPER_AUTHORITY_INVALID'); }
  const entrySafetyPolicy = verifyPaperEntrySafetyPolicyReceipt(input.entrySafetyPolicy);
  if (entrySafetyPolicy === null) blockers.push('ENTRY_SAFETY_POLICY_RECEIPT_INVALID');
  else if (entrySafetyPolicy.action !== 'CLEAR') blockers.push('ENTRY_SAFETY_POLICY_NOT_CLEARED');
  const [shortLeg, longLeg] = selected?.legs ?? [];
  if (selected?.legs.length !== 2 || shortLeg === undefined || longLeg === undefined) blockers.push('EXACTLY_TWO_LEGS_REQUIRED');
  else {
    if (shortLeg.positionIntent !== 'SELL_TO_OPEN' || longLeg.positionIntent !== 'BUY_TO_OPEN' || shortLeg.optionType !== 'PUT' || longLeg.optionType !== 'PUT')
      blockers.push('PUT_CREDIT_SPREAD_LEG_IDENTITY_INVALID');
    if (shortLeg.expiration !== longLeg.expiration || shortLeg.multiplier !== longLeg.multiplier || !(shortLeg.strike > longLeg.strike))
      blockers.push('SPREAD_GEOMETRY_INVALID');
    // an adjusted or unknown deliverable changes what assignment/exercise would deliver: never in a defined-risk Paper package
    if (shortLeg.deliverableClassification !== 'STANDARD_EQUITY' || longLeg.deliverableClassification !== 'STANDARD_EQUITY') blockers.push('NON_STANDARD_DELIVERABLE');
    if (shortLeg.contractTradable !== true || longLeg.contractTradable !== true) blockers.push('LEG_NOT_TRADABLE');
  }
  if (selected !== undefined && (!selected.structurallyFeasible || !selected.riskFeasible || selected.hardBlockers.length > 0)) blockers.push('HARD_VALIDITY_FAILED');
  if (!Number.isSafeInteger(frontier.selectedQuantity) || frontier.selectedQuantity <= 0) blockers.push('CANONICAL_QUANTITY_ZERO');
  if (selected !== undefined && (!Number.isSafeInteger(selected.sizing.quantity) || selected.sizing.quantity < frontier.selectedQuantity)) blockers.push('CANONICAL_SIZING_LINEAGE_INVALID');
  if (input.executionAccountId === null) blockers.push('MASTER_EXECUTION_ACCOUNT_NOT_CREATED');
  if (input.persistedCandidateId === null || input.underlyingId === null) blockers.push('SELECTED_CANDIDATE_NOT_PERSISTED');
  const persisted = (index: number, symbol: string | undefined) => input.persistedLegs?.find((leg) => leg.legIndex === index && leg.occSymbol === symbol)?.optionContractId;
  const shortContractId = persisted(1, shortLeg?.occSymbol ?? shortLeg?.optionSymbol), longContractId = persisted(2, longLeg?.occSymbol ?? longLeg?.optionSymbol);
  if (shortContractId === undefined || longContractId === undefined) blockers.push('PERSISTED_LEG_CONTRACT_IDENTITY_MISSING');
  if (input.accountStatus !== 'ACTIVE') blockers.push('MASTER_ACCOUNT_NOT_ACTIVE');
  const optionsLevel = Math.max(input.optionsApprovedLevel ?? 0, input.optionsTradingLevel ?? 0);
  if (optionsLevel < 3) blockers.push('OPTIONS_LEVEL_3_REQUIRED_FOR_NATIVE_MULTI_LEG');
  for (const symbol of [shortLeg?.optionSymbol, longLeg?.optionSymbol]) {
    if (symbol !== undefined && (input.openPositionSymbols.includes(symbol) || input.openOrderSymbols.includes(symbol))) blockers.push('EQUIVALENT_EXPOSURE_CONFLICT');
  }
  if (!finite(input.modeledRoundTripCostPerContract) || input.modeledRoundTripCostPerContract < 0) blockers.push('COST_MODEL_INCOMPLETE');
  if (!Number.isFinite(Date.parse(input.now)) || !Number.isFinite(Date.parse(input.decisionExpiresAt)) || Date.parse(input.decisionExpiresAt) <= Date.parse(input.now)) blockers.push('DECISION_EXPIRY_INVALID');
  const netCredit = selected?.economics.premiumPerShare;
  if (!finite(netCredit) || netCredit <= 0) blockers.push('STRUCTURAL_NET_CREDIT_UNKNOWN');
  if (!Number.isSafeInteger(input.paperEvidenceRiskCap) || input.paperEvidenceRiskCap < 0) blockers.push('PAPER_EVIDENCE_RISK_CAP_INVALID');
  if (input.aegisState === null) blockers.push('AEGIS_SELECTION_LINEAGE_MISSING');
  else if (!['ALLOW_FULL', 'ALLOW_REDUCED'].includes(input.aegisState)) blockers.push('AEGIS_NOT_APPROVED');
  if (input.aegisInputOrigin !== 'DERIVED_FROM_REAL') blockers.push('AEGIS_REAL_INPUT_LINEAGE_MISSING');
  if (selected !== undefined && input.aegisState !== selected.aegisState) blockers.push('AEGIS_SELECTION_LINEAGE_MISMATCH');
  const aegisIdentity = verifyAegisAssessmentIdentity(input.aegisAssessmentIdentity);
  if (aegisIdentity === null || selected === undefined || shortLeg === undefined || aegisIdentity.strategyBranch !== 'THETA_DEFINED_RISK'
    || aegisIdentity.runtimeCandidateRef !== selected.candidateId || aegisIdentity.assessmentCandidateId !== selected.candidateId
    || aegisIdentity.persistedCandidateId !== input.persistedCandidateId || aegisIdentity.underlying !== selected.underlying
    || aegisIdentity.optionSymbol !== shortLeg.optionSymbol || aegisIdentity.newRiskState !== input.aegisState
    || Date.parse(aegisIdentity.decisionAsOf) !== Date.parse(frontier.timestamp)) blockers.push('AEGIS_ASSESSMENT_LINEAGE_INVALID');

  if (blockers.length > 0 || selected === undefined || shortLeg === undefined || longLeg === undefined || shortContractId === undefined || longContractId === undefined
    || input.executionAccountId === null || input.persistedCandidateId === null || input.underlyingId === null || !finite(netCredit)
    || !finite(input.modeledRoundTripCostPerContract) || aegisIdentity === null || input.strategyPaperAuthority === undefined) {
    return { state: 'BLOCKED', plan: null, blockers: [...new Set(blockers)] };
  }
  const sizing = applyPaperEvidenceRiskCap(frontier.selectedQuantity, input.firstCanaryCompleted ? input.paperEvidenceRiskCap : Math.min(input.paperEvidenceRiskCap, 1));
  if (sizing.paperEvidenceQuantity === 0) return { state: 'BLOCKED', plan: null, blockers: ['PAPER_EVIDENCE_QUANTITY_ZERO'] };
  // both legs pay the modeled round-trip cost; the net credit must stay above it (per share) or the plan is not economically positive
  const economicBoundary = ceilToTick(Math.max(pricingPolicy.tickSize, (2 * input.modeledRoundTripCostPerContract) / shortLeg.multiplier + pricingPolicy.tickSize), pricingPolicy.tickSize);
  if (!(netCredit >= economicBoundary)) return { state: 'BLOCKED', plan: null, blockers: ['FORWARD_STRUCTURAL_ECONOMICS_NOT_POSITIVE'] };
  const legPlan = (index: 1 | 2, leg: typeof shortLeg, contractId: string): DefinedRiskPlanLeg => {
    const symbol = leg.occSymbol ?? leg.optionSymbol;
    return { legIndex: index, optionContractId: contractId, providerContractId: symbol, occSymbol: symbol, optionType: 'PUT', positionIntent: index === 1 ? 'sell_to_open' : 'buy_to_open',
      ratioQuantity: 1, expiration: leg.expiration, strike: leg.strike, multiplier: leg.multiplier, deliverableIdentity: `STANDARD:${selected.underlying}:${leg.multiplier}` };
  };
  const legs = [legPlan(1, shortLeg, shortContractId), legPlan(2, longLeg, longContractId)] as const;
  const packageIdentity = definedRiskOpenPackageIdentity(legs[0].occSymbol, legs[1].occSymbol);
  const chainId = deterministicRuntimeUuid(`paper-evidence-chain:${input.decisionId}:${selected.underlying}:THETA_DEFINED_RISK`);
  const actionPlanId = deterministicRuntimeUuid(`paper-evidence-plan:${input.decisionId}:${input.persistedCandidateId}`);
  return { state: 'READY', blockers: [], plan: {
    contractVersion: masterPaperActionPlanVersion, actionPlanId, decisionAuthority: 'NEW_RISK', managementInputSnapshotId: null, managementActionFrontierId: null,
    actionGroupId: actionPlanId, legSequence: 1, dependsOnActionPlanId: null, executionAccountId: input.executionAccountId, decisionId: input.decisionId,
    candidateId: input.persistedCandidateId, strategyVersion: frontier.strategyVersion, strategyBranch: 'THETA_DEFINED_RISK',
    strategyPaperAuthorityReceiptHash: input.strategyPaperAuthority.receiptHash, chainId, optionContractId: null, underlyingId: input.underlyingId,
    underlying: selected.underlying, optionType: 'PUT', symbol: legs[0].occSymbol, quantity: sizing.paperEvidenceQuantity, ...sizing, executionTier: 'PAPER_EVIDENCE',
    firstCanaryCompleted: input.firstCanaryCompleted, multiplier: shortLeg.multiplier, action: 'OPEN_DEFINED_RISK',
    definedRisk: { packageIdentity, structuralNetCreditPerShare: netCredit, legs },
    economicBoundary, economicsRemainPositive: true, expectedAfterCostEv: null, empiricalEconomicsReady: false, selectedByCanonicalAuthority: true, hardValidityPassed: true,
    accountVerified: true, optionsCapabilityVerified: true, noEquivalentExposureConflict: true, aegisState: input.aegisState as 'ALLOW_FULL' | 'ALLOW_REDUCED',
    aegisAssessmentIdentity: aegisIdentity, killSwitchActive: false, decisionExpiresAt: input.decisionExpiresAt, pricingPolicy, pricingAttempt: 0, previousLimit: null,
    entrySafetyPolicy: entrySafetyPolicy as PaperEntrySafetyPolicyReceipt,
  } };
}
