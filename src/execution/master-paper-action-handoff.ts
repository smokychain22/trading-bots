import { z } from 'zod';
import { decideAdaptiveLimit, type AdaptiveLimitDecision, type AdaptiveLimitPolicy } from './adaptive-limit-policy.js';
import { qualifyExecutionOptionQuote, type ExecutionOptionQuote } from './execution-option-quote.js';
import { assembleMasterPaperExecutionCommand } from './master-paper-command-assembly.js';
import { assembleDefinedRiskExecutionCommand } from './defined-risk-paper-order.js';
import { MasterPaperExecutionOrchestrator, type MasterPaperExecutionCommand,
  type MasterPaperExecutionResult } from './master-paper-execution-orchestrator.js';
import { thetaActionOpensNewRisk, type ThetaOrderAction } from './order-construction.js';
import { executionAuthorizationTiers, type ExecutionAuthorizationTier, type PaperEvidenceSizing } from './execution-authorization-tier.js';
import { paperEntrySafetyPolicyReceiptSchema, verifyPaperEntrySafetyPolicyReceipt, type PaperEntrySafetyPolicyReceipt } from '../theta/paper-entry-safety-policy.js';
import { aegisAssessmentIdentitySchema, verifyAegisAssessmentIdentity, type AegisAssessmentIdentity } from '../theta/aegis-assessment-identity.js';
import { paperBootstrapRuntimePolicy } from '../theta/paper-bootstrap-runtime-policy.js';
import { firstPaperCanaryQuantity } from './paper-execution-authorization.js';
import { parseOccOptionSymbol } from '../theta/account-exposure.js';
import { freeSellableShares, reconcileStockShares } from '../theta/stock-share-reconciliation.js';
import type { StockInventoryRead, StockInventorySource } from './alpaca-stock-inventory-source.js';

export const masterPaperActionPlanVersion = 'theta-master-paper-action-plan-v4' as const;

export type MasterPaperDecisionAuthority = 'NEW_RISK' | 'MANAGEMENT';

export interface DefinedRiskPlanLeg {
  readonly legIndex: 1 | 2;
  readonly optionContractId: string;
  readonly providerContractId: string;
  readonly occSymbol: string;
  readonly optionType: 'PUT';
  readonly positionIntent: 'sell_to_open' | 'buy_to_open';
  readonly ratioQuantity: 1;
  readonly expiration: string;
  readonly strike: number;
  readonly multiplier: number;
  readonly deliverableIdentity: string;
}
export interface DefinedRiskPlanPackage {
  readonly packageIdentity: string;
  /** structural net credit per share at decision time (short bid - long ask); the executable limit is re-derived from fresh quotes at handoff */
  readonly structuralNetCreditPerShare: number;
  readonly legs: readonly [DefinedRiskPlanLeg, DefinedRiskPlanLeg];
}

export interface ApprovedMasterPaperActionPlan {
  readonly contractVersion: typeof masterPaperActionPlanVersion;
  readonly actionPlanId: string;
  readonly decisionAuthority: MasterPaperDecisionAuthority;
  readonly managementInputSnapshotId: string | null;
  readonly managementActionFrontierId: string | null;
  readonly actionGroupId: string;
  readonly legSequence: number;
  readonly dependsOnActionPlanId: string | null;
  readonly executionAccountId: string;
  readonly decisionId: string;
  readonly candidateId: string;
  readonly strategyVersion: string;
  readonly strategyBranch?: 'THETA_CONVENTIONAL' | 'THETA_HOLD_STRIKE' | 'THETA_DEFINED_RISK' | 'THETA_RECOVERY' | 'THETA_CC';
  /** Present exactly when action is OPEN_DEFINED_RISK: the ONE native two-leg package (short first). Contract identity comes from the persisted candidate. */
  readonly definedRisk?: DefinedRiskPlanPackage;
  /** Required for a non-Q new-risk branch. This binds the plan to the
   * independently hashed owner, technical, risk, broker and lifecycle gates. */
  readonly strategyPaperAuthorityReceiptHash?: string;
  readonly chainId: string;
  readonly optionContractId: string | null;
  readonly underlyingId: string;
  readonly underlying: string;
  readonly optionType: 'PUT'|'CALL'|null;
  readonly symbol: string;
  readonly quantity: number;
  readonly canonicalQuantity: number;
  readonly paperEvidenceQuantity: number;
  readonly paperEvidenceRiskCap: number;
  readonly paperEvidenceCapReason: PaperEvidenceSizing['paperEvidenceCapReason'];
  readonly executionTier: ExecutionAuthorizationTier;
  readonly firstCanaryCompleted?:boolean;
  readonly multiplier: number;
  readonly confirmedCoveredShares?: number;
  /** HDAC-05: short-call contracts already committed on this underlying (net of a roll's own close). Required to open a call. */
  readonly committedShortCallContracts?: number;
  /** SELL_STOCK: broker-confirmed shares at plan time and shares free of short-call commitments. */
  readonly brokerConfirmedShares?: number;
  /** Ledger shares of the underlying across every chain of the account at plan time (equals brokerConfirmedShares when reconciled). */
  readonly accountLedgerShares?: number;
  readonly freeSellableShares?: number;
  readonly action: ThetaOrderAction;
  readonly economicBoundary: number;
  readonly economicsRemainPositive: boolean;
  readonly expectedAfterCostEv: number | null;
  readonly empiricalEconomicsReady: boolean;
  readonly selectedByCanonicalAuthority: boolean;
  readonly hardValidityPassed: boolean;
  readonly accountVerified: boolean;
  readonly optionsCapabilityVerified: boolean;
  readonly noEquivalentExposureConflict: boolean;
  readonly aegisState: 'ALLOW_FULL' | 'ALLOW_REDUCED' | 'HOLD_ONLY' | 'HARD_VETO';
  readonly aegisAssessmentIdentity?: AegisAssessmentIdentity;
  readonly killSwitchActive: boolean;
  readonly decisionExpiresAt: string;
  readonly pricingPolicy: AdaptiveLimitPolicy;
  readonly pricingAttempt: number;
  readonly previousLimit: number | null;
  readonly entrySafetyPolicy?: PaperEntrySafetyPolicyReceipt;
}

const definedRiskLegSchema=z.object({legIndex:z.union([z.literal(1),z.literal(2)]),optionContractId:z.string().uuid(),providerContractId:z.string().min(1),
  occSymbol:z.string().min(1).max(64),optionType:z.literal('PUT'),positionIntent:z.enum(['sell_to_open','buy_to_open']),ratioQuantity:z.literal(1),
  expiration:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),strike:z.number().positive().finite(),multiplier:z.number().int().positive(),deliverableIdentity:z.string().min(1)}).strict();

export const masterPaperActionPlanSchema = z.object({
  contractVersion:z.literal(masterPaperActionPlanVersion),actionPlanId:z.string().uuid(),executionAccountId:z.string().uuid(),
  decisionAuthority:z.enum(['NEW_RISK','MANAGEMENT']),managementInputSnapshotId:z.string().uuid().nullable(),
  managementActionFrontierId:z.string().uuid().nullable(),actionGroupId:z.string().uuid(),legSequence:z.number().int().positive(),
  dependsOnActionPlanId:z.string().uuid().nullable(),
  decisionId:z.string().uuid(),candidateId:z.string().min(1),strategyVersion:z.string().min(1),
  strategyBranch:z.enum(['THETA_CONVENTIONAL','THETA_HOLD_STRIKE','THETA_DEFINED_RISK','THETA_RECOVERY','THETA_CC']).optional(),chainId:z.string().uuid(),
  definedRisk:z.object({packageIdentity:z.string().min(1).max(256),structuralNetCreditPerShare:z.number().positive().finite(),
    legs:z.tuple([definedRiskLegSchema,definedRiskLegSchema])}).strict().optional(),
  strategyPaperAuthorityReceiptHash:z.string().regex(/^[a-f0-9]{64}$/).optional(),
  optionContractId:z.string().uuid().nullable(),underlyingId:z.string().uuid(),underlying:z.string().min(1).max(16),
  optionType:z.enum(['PUT','CALL']).nullable(),symbol:z.string().min(1).max(64),
  quantity:z.number().int().nonnegative(),canonicalQuantity:z.number().int().nonnegative(),
  paperEvidenceQuantity:z.number().int().nonnegative(),paperEvidenceRiskCap:z.number().int().nonnegative(),
  paperEvidenceCapReason:z.enum(['PAPER_EVIDENCE_RISK_CAP','CANONICAL_QUANTITY_LOWER','QUANTITY_ZERO']),
  executionTier:z.enum(executionAuthorizationTiers),multiplier:z.number().int().positive(),confirmedCoveredShares:z.number().int().nonnegative().optional(),
  committedShortCallContracts:z.number().int().nonnegative().optional(),
  brokerConfirmedShares:z.number().int().nonnegative().optional(),accountLedgerShares:z.number().int().nonnegative().optional(),freeSellableShares:z.number().int().nonnegative().optional(),
  firstCanaryCompleted:z.boolean().optional(),
  action:z.enum(['OPEN_CSP','CLOSE_CSP','ROLL_CSP_CLOSE','ROLL_CSP_OPEN','OPEN_CC','CLOSE_CC','ROLL_CC_CLOSE','ROLL_CC_OPEN','SELL_STOCK','OPEN_DEFINED_RISK']),
  economicBoundary:z.number().positive().finite(),economicsRemainPositive:z.boolean(),expectedAfterCostEv:z.number().finite().nullable(),
  empiricalEconomicsReady:z.boolean(),selectedByCanonicalAuthority:z.boolean(),hardValidityPassed:z.boolean(),
  accountVerified:z.boolean(),optionsCapabilityVerified:z.boolean(),noEquivalentExposureConflict:z.boolean(),
  aegisState:z.enum(['ALLOW_FULL','ALLOW_REDUCED','HOLD_ONLY','HARD_VETO']),killSwitchActive:z.boolean(),
  aegisAssessmentIdentity:aegisAssessmentIdentitySchema.optional(),
  decisionExpiresAt:z.string().datetime({offset:true}),pricingPolicy:z.object({waitIntervalMs:z.number().nonnegative(),
    maxAttempts:z.number().int().positive(),concessionFractions:z.array(z.number().min(0).max(1)),tickSize:z.number().positive()}),
  pricingAttempt:z.number().int().nonnegative(),previousLimit:z.number().positive().finite().nullable(),
  entrySafetyPolicy:paperEntrySafetyPolicyReceiptSchema.optional(),
}).strict().superRefine((plan,context)=>{
  if(plan.quantity!==plan.paperEvidenceQuantity)context.addIssue({code:'custom',message:'PAPER_EVIDENCE_QUANTITY_MISMATCH'});
  if(plan.paperEvidenceQuantity>plan.canonicalQuantity)context.addIssue({code:'custom',message:'PAPER_EVIDENCE_QUANTITY_MAY_NOT_INCREASE'});
  if(plan.paperEvidenceQuantity>plan.paperEvidenceRiskCap)context.addIssue({code:'custom',message:'PAPER_EVIDENCE_RISK_CAP_EXCEEDED'});
  if(plan.decisionAuthority==='NEW_RISK'&&plan.executionTier==='PAPER_EVIDENCE'&&plan.firstCanaryCompleted!==true&&plan.quantity>firstPaperCanaryQuantity)
    context.addIssue({code:'custom',message:'FIRST_PAPER_CANARY_QUANTITY_MUST_BE_ONE'});
  if(plan.decisionAuthority==='NEW_RISK'&&(plan.managementInputSnapshotId!==null||plan.managementActionFrontierId!==null))
    context.addIssue({code:'custom',message:'NEW_RISK_PLAN_MAY_NOT_REFERENCE_MANAGEMENT_AUTHORITY'});
  if(plan.decisionAuthority==='NEW_RISK'&&plan.aegisAssessmentIdentity===undefined)
    context.addIssue({code:'custom',message:'NEW_RISK_PLAN_REQUIRES_AEGIS_ASSESSMENT_IDENTITY'});
  if(plan.decisionAuthority==='NEW_RISK'&&plan.strategyBranch==='THETA_HOLD_STRIKE'
    &&plan.strategyPaperAuthorityReceiptHash===undefined)
    context.addIssue({code:'custom',message:'H_NEW_RISK_PLAN_REQUIRES_STRATEGY_AUTHORITY'});
  // D is one native two-leg package: the action, the branch and the typed package come together or not at all (no naked leg, no representative contract)
  const definedRiskAction=plan.action==='OPEN_DEFINED_RISK';
  if(definedRiskAction!==(plan.definedRisk!==undefined)||definedRiskAction!==(plan.strategyBranch==='THETA_DEFINED_RISK'))
    context.addIssue({code:'custom',message:'DEFINED_RISK_PLAN_IDENTITY_INCOHERENT'});
  if(definedRiskAction&&(plan.decisionAuthority!=='NEW_RISK'||plan.strategyPaperAuthorityReceiptHash===undefined))
    context.addIssue({code:'custom',message:'D_NEW_RISK_PLAN_REQUIRES_STRATEGY_AUTHORITY'});
  if(plan.definedRisk!==undefined){
    const [shortLeg,longLeg]=plan.definedRisk.legs;
    if(shortLeg.legIndex!==1||longLeg.legIndex!==2||shortLeg.positionIntent!=='sell_to_open'||longLeg.positionIntent!=='buy_to_open'
      ||shortLeg.expiration!==longLeg.expiration||shortLeg.multiplier!==longLeg.multiplier||!(shortLeg.strike>longLeg.strike)
      ||shortLeg.occSymbol===longLeg.occSymbol||plan.optionContractId!==null||plan.symbol!==shortLeg.occSymbol||plan.multiplier!==shortLeg.multiplier
      ||plan.definedRisk.structuralNetCreditPerShare>=shortLeg.strike-longLeg.strike)
      context.addIssue({code:'custom',message:'DEFINED_RISK_PLAN_GEOMETRY_INVALID'});
  }
  if(plan.decisionAuthority==='NEW_RISK'&&(plan.actionGroupId!==plan.actionPlanId||plan.legSequence!==1||plan.dependsOnActionPlanId!==null))
    context.addIssue({code:'custom',message:'NEW_RISK_PLAN_MUST_BE_SINGLE_LEG'});
  if(plan.decisionAuthority==='MANAGEMENT'&&(plan.managementInputSnapshotId===null||plan.managementActionFrontierId===null))
    context.addIssue({code:'custom',message:'MANAGEMENT_PLAN_AUTHORITY_REQUIRED'});
  if(plan.legSequence===1&&plan.dependsOnActionPlanId!==null)
    context.addIssue({code:'custom',message:'FIRST_ACTION_LEG_MAY_NOT_HAVE_DEPENDENCY'});
  if(plan.legSequence>1&&plan.dependsOnActionPlanId===null)
    context.addIssue({code:'custom',message:'DEPENDENT_ACTION_LEG_REQUIRES_PARENT'});
  if(plan.dependsOnActionPlanId===plan.actionPlanId)
    context.addIssue({code:'custom',message:'ACTION_PLAN_SELF_DEPENDENCY'});
});

export interface ExecutionOptionQuoteSource {
  getCurrentQuote(plan: ApprovedMasterPaperActionPlan, now: string): Promise<ExecutionOptionQuote | null>;
}

export interface PreSubmitQuoteAgePolicy {
  readonly policyVersion: string;
  readonly effectiveAt: string;
  readonly maximumAgeMs: number;
}

// This preserves the former 45-second upper bound created by the action-plan
// expiry window. It only separates pre-submit freshness from candidate-stage
// freshness so each stage can be measured and governed independently.
export const paperBootstrapPreSubmitQuoteAgePolicy: PreSubmitQuoteAgePolicy = {
  policyVersion: 'pre-submit-quote-age-v1-paper-bootstrap',
  effectiveAt: paperBootstrapRuntimePolicy.effectiveAt,
  maximumAgeMs: paperBootstrapRuntimePolicy.quoteAge.preSubmitMaximumMilliseconds,
};

export function preSubmitMaximumQuoteAgeMs(input: {
  readonly policy: PreSubmitQuoteAgePolicy;
  readonly now: string;
  readonly decisionExpiresAt: string;
}): number | null {
  const now = Date.parse(input.now);
  const effectiveAt = Date.parse(input.policy.effectiveAt);
  const expiresAt = Date.parse(input.decisionExpiresAt);
  if (!input.policy.policyVersion.trim() || !Number.isFinite(now) || !Number.isFinite(effectiveAt)
    || !Number.isFinite(expiresAt) || effectiveAt > now || expiresAt <= now
    || !Number.isFinite(input.policy.maximumAgeMs) || input.policy.maximumAgeMs <= 0) return null;
  return Math.min(input.policy.maximumAgeMs, expiresAt - now);
}

export interface MasterPaperActionHandoffResult {
  readonly actionPlanId: string;
  readonly state: 'BLOCKED' | 'NO_QUOTE' | 'QUOTE_REJECTED' | 'PRICE_REJECTED' | 'EXECUTED';
  readonly blockers: readonly string[];
  readonly execution: MasterPaperExecutionResult | null;
}

export interface MasterPaperActionPreparationResult {
  readonly actionPlanId: string;
  readonly evaluatedAt: string;
  readonly state: 'BLOCKED' | 'NO_QUOTE' | 'QUOTE_REJECTED' | 'PRICE_REJECTED' | 'READY_TO_SUBMIT';
  readonly blockers: readonly string[];
  readonly command: MasterPaperExecutionCommand | null;
  readonly quote: ExecutionOptionQuote | null;
  readonly quoteAgeMs: number | null;
  readonly pricing: AdaptiveLimitDecision | null;
  readonly quoteAgePolicyVersion: string;
}

export type MasterPaperActionDisposition = 'WAIT_RECONCILIATION' | 'SUBMITTED' | 'TERMINAL';

export function classifyMasterPaperActionExecution(result: MasterPaperExecutionResult): MasterPaperActionDisposition {
  if (result.state === 'BLOCKED_UNRESOLVED_ORDER' || result.state === 'PERSISTED') return 'WAIT_RECONCILIATION';
  if (result.state === 'TERMINAL') return 'TERMINAL';
  return 'SUBMITTED';
}

const sideFor = (action: ThetaOrderAction): 'BUY' | 'SELL' =>
  ['CLOSE_CSP','ROLL_CSP_CLOSE','CLOSE_CC','ROLL_CC_CLOSE'].includes(action) ? 'BUY' : 'SELL';

/**
 * Performs the complete read-only portion of the canonical Paper handoff.
 * It validates the immutable action plan, fetches the exact current Alpaca
 * quote, qualifies its timing and semantics, and constructs the deterministic
 * command. It has no coordinator or broker mutation dependency, so locked
 * runtime diagnostics can prove the pre-submit boundary without a POST-capable
 * object being present.
 */
export async function prepareMasterPaperAction(
  raw: ApprovedMasterPaperActionPlan,
  quoteSource: ExecutionOptionQuoteSource,
  now: string,
  marketOpen: boolean,
  quoteAgePolicy: PreSubmitQuoteAgePolicy = paperBootstrapPreSubmitQuoteAgePolicy,
  clock:()=>string=()=>new Date().toISOString(),
  stockInventory?:StockInventorySource,
): Promise<MasterPaperActionPreparationResult> {
  const plan=masterPaperActionPlanSchema.parse(raw) as ApprovedMasterPaperActionPlan;
  let evaluatedAt=now;
  const blocked=(state:Exclude<MasterPaperActionPreparationResult['state'],'READY_TO_SUBMIT'>,
    blockers:readonly string[],quote:ExecutionOptionQuote|null=null,quoteAgeMs:number|null=null,
    pricing:AdaptiveLimitDecision|null=null):MasterPaperActionPreparationResult=>({
    actionPlanId:plan.actionPlanId,evaluatedAt,state,blockers,command:null,quote,quoteAgeMs,pricing,
    quoteAgePolicyVersion:quoteAgePolicy.policyVersion,
  });
  const blockers:string[]=[];
  const opensNewRisk=thetaActionOpensNewRisk(plan.action);
  if(plan.executionTier==='LIVE_ELIGIBLE'||plan.executionTier==='LIVE_AUTHORIZED')blockers.push('LIVE_EXECUTION_NOT_AUTHORIZED');
  if(plan.quantity===0)blockers.push('QUANTITY_ZERO');
  if(!plan.selectedByCanonicalAuthority)blockers.push('CANONICAL_SELECTION_REQUIRED');
  if(!plan.hardValidityPassed)blockers.push('HARD_VALIDITY_FAILED');
  if(!plan.accountVerified)blockers.push('MASTER_ACCOUNT_NOT_VERIFIED');
  if(!plan.optionsCapabilityVerified&&plan.action!=='SELL_STOCK')blockers.push('OPTIONS_CAPABILITY_NOT_VERIFIED');
  if(!plan.noEquivalentExposureConflict)blockers.push('EQUIVALENT_EXPOSURE_CONFLICT');
  if((plan.action==='OPEN_CC'||plan.action==='ROLL_CC_OPEN')&&(plan.committedShortCallContracts===undefined
    ||(plan.confirmedCoveredShares??0)<(plan.quantity+plan.committedShortCallContracts)*plan.multiplier))
    blockers.push('COVERED_CALL_ACCOUNT_NET_COVERAGE_NOT_CONFIRMED');
  // Independent of plan assembly: a stock exit must carry proof that no short call is committed on the account's underlying.
  if(plan.action==='SELL_STOCK'&&plan.committedShortCallContracts===undefined)blockers.push('STOCK_SALE_SHORT_CALL_COVERAGE_NOT_CONFIRMED');
  // Two share truths: the plan must carry broker-confirmed shares covering the whole sale, and free-sellable shares (net of
  // committed calls) covering it too. Ledger quantity alone never reaches the broker.
  if(plan.action==='SELL_STOCK'&&(plan.accountLedgerShares===undefined||plan.brokerConfirmedShares!==plan.accountLedgerShares
    ||plan.brokerConfirmedShares<plan.quantity||(plan.freeSellableShares??-1)<plan.quantity))
    blockers.push('STOCK_SALE_SHARE_RECONCILIATION_NOT_CONFIRMED');
  if(plan.killSwitchActive)blockers.push('KILL_SWITCH_ACTIVE');
  if(!marketOpen)blockers.push('MARKET_CLOSED');
  if(!plan.economicsRemainPositive)blockers.push('FORWARD_ECONOMICS_NOT_POSITIVE');
  if(opensNewRisk&&plan.executionTier==='EMPIRICALLY_PROMOTED_PAPER'&&
    (!plan.empiricalEconomicsReady||plan.expectedAfterCostEv===null||plan.expectedAfterCostEv<=0))
    blockers.push('POSITIVE_AFTER_COST_EV_NOT_EMPIRICALLY_READY');
  if(opensNewRisk&&!['ALLOW_FULL','ALLOW_REDUCED'].includes(plan.aegisState))blockers.push('AEGIS_NOT_APPROVED');
  if(plan.decisionAuthority==='NEW_RISK'){
    const identity=verifyAegisAssessmentIdentity(plan.aegisAssessmentIdentity);
    if(identity===null||identity.persistedCandidateId!==plan.candidateId||identity.underlying!==plan.underlying
      ||identity.optionSymbol!==plan.symbol||identity.newRiskState!==plan.aegisState)
      blockers.push('AEGIS_ASSESSMENT_LINEAGE_INVALID');
  }
  const entrySafetyPolicy=plan.decisionAuthority==='NEW_RISK'?verifyPaperEntrySafetyPolicyReceipt(plan.entrySafetyPolicy):null;
  if(plan.decisionAuthority==='NEW_RISK'&&entrySafetyPolicy?.action!=='CLEAR')blockers.push('ENTRY_SAFETY_POLICY_NOT_CLEARED');
  let maximumQuoteAgeMs=preSubmitMaximumQuoteAgeMs({policy:quoteAgePolicy,now,
    decisionExpiresAt:plan.decisionExpiresAt});
  if(maximumQuoteAgeMs===null)blockers.push('PRE_SUBMIT_QUOTE_AGE_POLICY_INVALID');
  if(blockers.length>0)return blocked('BLOCKED',blockers);

  // SELL_STOCK: a FRESH broker inventory read at submit time must agree with the plan's whole-position quantity, and the live
  // broker must show no committed short calls on the underlying. The ledger count / scan-time snapshot is never enough.
  if(plan.action==='SELL_STOCK'){
    if(stockInventory===undefined)return blocked('BLOCKED',['STOCK_INVENTORY_SOURCE_UNAVAILABLE']);
    let read:StockInventoryRead;
    try{read=await stockInventory.readStockInventory(plan.symbol,now);}
    catch{return blocked('BLOCKED',['STOCK_INVENTORY_READ_FAILED']);}
    const fresh=reconcileStockShares({ledgerShares:plan.accountLedgerShares??null,broker:read.inventory,reconciliationQuality:'GOOD',now:clock()});
    if(fresh.state==='MISMATCH')return blocked('BLOCKED',[`STOCK_SHARES_LEDGER_BROKER_MISMATCH:${fresh.reason}`]);
    if(fresh.state!=='RECONCILED')return blocked('BLOCKED',[`STOCK_SHARES_BROKER_EVIDENCE_UNKNOWN:${fresh.reason}`]);
    // Account-net: all shares of the underlying, minus every live short call commitment, must still cover this sale.
    const live=freeSellableShares(read.inventory.quantity,read.committedShortCallContracts,100);
    if(live.state==='UNKNOWN')return blocked('BLOCKED',[live.reason==='OVERCOMMITTED_INVALID_STATE'
      ?'STOCK_SALE_WITH_SHORT_CALLS_COMMITTED':'COMMITTED_SHORT_CALLS_UNKNOWN']);
    if((live.freeShares as number)<plan.quantity)return blocked('BLOCKED',['STOCK_SALE_WITH_SHORT_CALLS_COMMITTED']);
  }

  // Covered-call opens: the sealed ledger cover must be confirmed by a FRESH broker read at submit time as well. The broker
  // position (account-wide) must equal the plan-time reconciled shares and still cover this call net of every committed call.
  if(plan.action==='OPEN_CC'||plan.action==='ROLL_CC_OPEN'){
    if(stockInventory===undefined)return blocked('BLOCKED',['COVER_INVENTORY_SOURCE_UNAVAILABLE']);
    let read:StockInventoryRead;
    try{read=await stockInventory.readStockInventory(plan.underlying,now);}
    catch{return blocked('BLOCKED',['COVER_INVENTORY_READ_FAILED']);}
    const fresh=reconcileStockShares({ledgerShares:plan.accountLedgerShares??null,broker:read.inventory,reconciliationQuality:'GOOD',now:clock()});
    if(fresh.state!=='RECONCILED')return blocked('BLOCKED',[`COVERED_CALL_SHARE_RECONCILIATION_BLOCKED:${fresh.state}:${fresh.reason}`]);
    const committed=Math.max(plan.committedShortCallContracts??0,read.committedShortCallContracts??0);
    if(read.committedShortCallContracts===null)return blocked('BLOCKED',['COMMITTED_SHORT_CALLS_UNKNOWN']);
    const freeCover=freeSellableShares(fresh.brokerShares,committed,plan.multiplier);
    if(freeCover.state!=='KNOWN'||(freeCover.freeShares as number)<plan.quantity*plan.multiplier)
      return blocked('BLOCKED',['COVERED_CALL_BROKER_SHARES_INSUFFICIENT']);
  }

  if(plan.action==='OPEN_DEFINED_RISK')return prepareDefinedRiskAction(plan,quoteSource,now,marketOpen,quoteAgePolicy,clock,blocked);

  const quote=await quoteSource.getCurrentQuote(plan,now);
  const completedAt=clock();
  if (!Number.isFinite(Date.parse(completedAt)) || Date.parse(completedAt)<Date.parse(now))
    return blocked('BLOCKED',['PRE_SUBMIT_CLOCK_INVALID'],quote);
  evaluatedAt=completedAt;
  maximumQuoteAgeMs=preSubmitMaximumQuoteAgeMs({policy:quoteAgePolicy,now:evaluatedAt,
    decisionExpiresAt:plan.decisionExpiresAt});
  if(maximumQuoteAgeMs===null)return blocked('BLOCKED',['DECISION_EXPIRED_DURING_QUOTE_REFRESH'],quote);
  if(quote===null)return blocked('NO_QUOTE',['FRESH_TRUSTED_TWO_SIDED_OPTION_QUOTE_NOT_YET_QUALIFIED']);
  const parsedIdentity=plan.optionType===null?null:parseOccOptionSymbol(plan.symbol);
  if(plan.optionType!==null&&(parsedIdentity===null||parsedIdentity.underlying!==plan.underlying
    ||parsedIdentity.optionType!==plan.optionType))return blocked('QUOTE_REJECTED',['OPTION_PLAN_IDENTITY_INVALID'],quote);
  const qualification=qualifyExecutionOptionQuote({quote,expectedContractId:plan.symbol,nowUtc:evaluatedAt,
    maximumAgeMs:maximumQuoteAgeMs as number,marketOpen,usage:'MASTER_PAPER',
    // D6: only a risk-reducing buy-to-close of an option may price against a zero bid (a valid ask is still required).
    allowZeroBid:sideFor(plan.action)==='BUY'&&plan.optionType!==null&&!opensNewRisk,
    expectedOptionIdentity:parsedIdentity===null?null:{underlying:parsedIdentity.underlying,optionSymbol:plan.symbol,
      expiration:parsedIdentity.expiration,strike:parsedIdentity.strike,optionType:parsedIdentity.optionType,
      multiplier:plan.multiplier}});
  if(!qualification.qualified)return blocked('QUOTE_REJECTED',qualification.blockers,quote,qualification.quoteAgeMs);
  const pricing=decideAdaptiveLimit({side:sideFor(plan.action),quote,attempt:plan.pricingAttempt,
    previousLimit:plan.previousLimit,economicBoundary:plan.economicBoundary,
    economicsRemainPositive:plan.economicsRemainPositive,policy:plan.pricingPolicy});
  if((pricing.action!=='PLACE'&&pricing.action!=='REPLACE')||pricing.limitPrice===null)
    return blocked('PRICE_REJECTED',[`ADAPTIVE_LIMIT_${pricing.reason}`],quote,qualification.quoteAgeMs,pricing);
  // Alpaca is the sole executable quote and broker authority. Optionomics
  // remains research/context evidence and cannot qualify an order handoff.
  if(quote.provider!=='ALPACA')
    return blocked('QUOTE_REJECTED',['EXECUTION_QUOTE_PROVIDER_NOT_APPROVED'],quote,qualification.quoteAgeMs,pricing);
  const alpaca=quote.sourceSemantics==='CONSOLIDATED_NBBO';
  const alpacaIndicative=quote.sourceSemantics==='PAPER_INDICATIVE_REFERENCE';
  if(plan.action!=='SELL_STOCK'&&!alpaca&&!alpacaIndicative)
    return blocked('QUOTE_REJECTED',['ORDER_PRICING_SEMANTICS_NOT_PROVEN'],quote,qualification.quoteAgeMs,pricing);
  const command=assembleMasterPaperExecutionCommand({action:plan.action,executionAccountId:plan.executionAccountId,
    decisionId:plan.decisionId,candidateId:plan.candidateId,strategyVersion:plan.strategyVersion,chainId:plan.chainId,
    optionContractId:plan.optionContractId,underlyingId:plan.underlyingId,symbol:plan.symbol,quantity:plan.quantity,
    multiplier:plan.multiplier,...(plan.confirmedCoveredShares===undefined?{}:{confirmedCoveredShares:plan.confirmedCoveredShares}),
    ...(plan.committedShortCallContracts===undefined?{}:{committedShortCallContracts:plan.committedShortCallContracts}),
    limitPrice:pricing.limitPrice,pricingPolicyVersion:pricing.policyVersion,
    quote:{source:'ALPACA',feed:plan.action==='SELL_STOCK'?'IEX':alpaca?'OPRA':'INDICATIVE',
      semantics:quote.sourceSemantics as 'CONSOLIDATED_NBBO'|'PAPER_INDICATIVE_REFERENCE',bid:quote.bid,ask:quote.ask,
      observedAt:quote.providerTimestamp as string,maximumAgeSeconds:(maximumQuoteAgeMs as number)/1000},
    accountVerified:plan.accountVerified,optionsCapabilityVerified:plan.optionsCapabilityVerified,aegisState:plan.aegisState,
    executionTier:plan.executionTier,canonicalQuantity:plan.canonicalQuantity,paperEvidenceQuantity:plan.paperEvidenceQuantity,
    empiricalEconomicsReady:plan.empiricalEconomicsReady,expectedAfterCostEv:plan.expectedAfterCostEv,
    now:evaluatedAt,decisionExpiresAt:plan.decisionExpiresAt,attempt:plan.pricingAttempt+1});
  return {actionPlanId:plan.actionPlanId,evaluatedAt,state:'READY_TO_SUBMIT',blockers:[],command,quote,
    quoteAgeMs:qualification.quoteAgeMs,pricing,quoteAgePolicyVersion:quoteAgePolicy.policyVersion};
}

/**
 * D handoff: each leg is quoted and qualified on its own exact contract identity (a quote for the short leg never prices
 * the long leg), the parent credit is priced by the same bounded adaptive policy over the package's natural/far credit,
 * and the ONE native mleg command is assembled. Any leg failing leaves the whole package unsent.
 */
async function prepareDefinedRiskAction(
  plan: ApprovedMasterPaperActionPlan,
  quoteSource: ExecutionOptionQuoteSource,
  now: string,
  marketOpen: boolean,
  quoteAgePolicy: PreSubmitQuoteAgePolicy,
  clock: () => string,
  blocked: (state: Exclude<MasterPaperActionPreparationResult['state'],'READY_TO_SUBMIT'>, blockers: readonly string[],
    quote?: ExecutionOptionQuote|null, quoteAgeMs?: number|null, pricing?: AdaptiveLimitDecision|null) => MasterPaperActionPreparationResult,
): Promise<MasterPaperActionPreparationResult> {
  const definedRisk=plan.definedRisk;
  if(definedRisk===undefined||plan.strategyPaperAuthorityReceiptHash===undefined)return blocked('BLOCKED',['DEFINED_RISK_PLAN_IDENTITY_INCOHERENT']);
  if(plan.aegisState!=='ALLOW_FULL'&&plan.aegisState!=='ALLOW_REDUCED')return blocked('BLOCKED',['AEGIS_NOT_APPROVED']);
  const legPlans=definedRisk.legs.map((leg)=>({...plan,symbol:leg.occSymbol,optionContractId:leg.optionContractId,optionType:leg.optionType,
    multiplier:leg.multiplier}) as ApprovedMasterPaperActionPlan);
  const quotes=await Promise.all(legPlans.map((legPlan)=>quoteSource.getCurrentQuote(legPlan,now)));
  const completedAt=clock();
  const shortQuote=quotes[0]??null;
  if(!Number.isFinite(Date.parse(completedAt))||Date.parse(completedAt)<Date.parse(now))return blocked('BLOCKED',['PRE_SUBMIT_CLOCK_INVALID'],shortQuote);
  const maximumQuoteAgeMs=preSubmitMaximumQuoteAgeMs({policy:quoteAgePolicy,now:completedAt,decisionExpiresAt:plan.decisionExpiresAt});
  if(maximumQuoteAgeMs===null)return blocked('BLOCKED',['DECISION_EXPIRED_DURING_QUOTE_REFRESH'],shortQuote);
  if(quotes.some((quote)=>quote===null))return blocked('NO_QUOTE',['DEFINED_RISK_LEG_QUOTE_NOT_YET_QUALIFIED'],shortQuote);
  const ages:number[]=[];
  for(const [index,leg] of definedRisk.legs.entries()){
    const quote=quotes[index] as ExecutionOptionQuote;
    const parsed=parseOccOptionSymbol(leg.occSymbol);
    if(parsed===null||parsed.underlying!==plan.underlying||parsed.optionType!==leg.optionType||parsed.expiration!==leg.expiration
      ||Math.abs(parsed.strike-leg.strike)>1e-9)return blocked('QUOTE_REJECTED',[`DEFINED_RISK_LEG_${leg.legIndex}_IDENTITY_INVALID`],shortQuote);
    const qualification=qualifyExecutionOptionQuote({quote,expectedContractId:leg.occSymbol,nowUtc:completedAt,
      maximumAgeMs:maximumQuoteAgeMs,marketOpen,usage:'MASTER_PAPER',allowZeroBid:false,
      expectedOptionIdentity:{underlying:parsed.underlying,optionSymbol:leg.occSymbol,expiration:parsed.expiration,
        strike:parsed.strike,optionType:parsed.optionType,multiplier:leg.multiplier}});
    if(!qualification.qualified)return blocked('QUOTE_REJECTED',qualification.blockers.map((item)=>`DEFINED_RISK_LEG_${leg.legIndex}:${item}`),
      shortQuote,qualification.quoteAgeMs);
    if(quote.provider!=='ALPACA')return blocked('QUOTE_REJECTED',['EXECUTION_QUOTE_PROVIDER_NOT_APPROVED'],shortQuote);
    ages.push(qualification.quoteAgeMs??0);
  }
  const [shortLegQuote,longLegQuote]=quotes as [ExecutionOptionQuote,ExecutionOptionQuote];
  // both legs must carry the SAME provenance class; a mixed OPRA/indicative package has no honest single label
  const semantics=new Set([shortLegQuote.sourceSemantics,longLegQuote.sourceSemantics]);
  const feed=semantics.size===1&&semantics.has('CONSOLIDATED_NBBO')?'OPRA' as const
    :semantics.size===1&&semantics.has('PAPER_INDICATIVE_REFERENCE')?'INDICATIVE' as const:null;
  if(feed===null)return blocked('QUOTE_REJECTED',['DEFINED_RISK_LEG_QUOTE_PROVENANCE_MIXED_OR_UNPROVEN'],shortQuote);
  // the package quote: natural credit (sell short at bid, buy long at ask) to far credit (short ask, long bid)
  const packageQuote={...shortLegQuote,contractId:definedRisk.packageIdentity,providerContractId:definedRisk.packageIdentity,
    bid:Number((shortLegQuote.bid-longLegQuote.ask).toFixed(8)),ask:Number((shortLegQuote.ask-longLegQuote.bid).toFixed(8)),
    bidSize:null,askSize:null} as ExecutionOptionQuote;
  const pricing=decideAdaptiveLimit({side:'SELL',quote:packageQuote,attempt:plan.pricingAttempt,previousLimit:plan.previousLimit,
    economicBoundary:plan.economicBoundary,economicsRemainPositive:plan.economicsRemainPositive,policy:plan.pricingPolicy});
  const quoteAgeMs=Math.max(...ages);
  if((pricing.action!=='PLACE'&&pricing.action!=='REPLACE')||pricing.limitPrice===null)
    return blocked('PRICE_REJECTED',[`ADAPTIVE_LIMIT_${pricing.reason}`],shortQuote,quoteAgeMs,pricing);
  let command:MasterPaperExecutionCommand;
  try{
    command=assembleDefinedRiskExecutionCommand({executionAccountId:plan.executionAccountId,decisionId:plan.decisionId,
      candidateId:plan.candidateId,strategyVersion:plan.strategyVersion,chainId:plan.chainId,underlyingId:plan.underlyingId,
      legs:definedRisk.legs,packageIdentity:definedRisk.packageIdentity,
      quotes:[{occSymbol:definedRisk.legs[0].occSymbol,bid:shortLegQuote.bid,ask:shortLegQuote.ask,observedAt:shortLegQuote.providerTimestamp as string},
        {occSymbol:definedRisk.legs[1].occSymbol,bid:longLegQuote.bid,ask:longLegQuote.ask,observedAt:longLegQuote.providerTimestamp as string}],
      quoteProvenance:{feed},quantity:plan.quantity,limitCreditPerShare:pricing.limitPrice,economicBoundary:plan.economicBoundary,
      maximumQuoteAgeSeconds:maximumQuoteAgeMs/1000,accountVerified:plan.accountVerified,optionsCapabilityVerified:plan.optionsCapabilityVerified,
      aegisState:plan.aegisState,executionTier:plan.executionTier as 'PAPER_EVIDENCE'|'EMPIRICALLY_PROMOTED_PAPER',
      canonicalQuantity:plan.canonicalQuantity,paperEvidenceQuantity:plan.paperEvidenceQuantity,
      empiricalEconomicsReady:plan.empiricalEconomicsReady,expectedAfterCostEv:plan.expectedAfterCostEv,
      now:completedAt,decisionExpiresAt:plan.decisionExpiresAt,attempt:plan.pricingAttempt+1});
  }catch(error){
    return blocked('PRICE_REJECTED',[error instanceof Error?error.message:'DEFINED_RISK_COMMAND_INVALID'],shortQuote,quoteAgeMs,pricing);
  }
  // the recorded reference quote is the SHORT leg's real quote; the package quote above is derived and never stored as a quote
  return {actionPlanId:plan.actionPlanId,evaluatedAt:completedAt,state:'READY_TO_SUBMIT',blockers:[],command,quote:shortLegQuote,
    quoteAgeMs,pricing,quoteAgePolicyVersion:quoteAgePolicy.policyVersion};
}

/**
 * The single typed seam between a canonical approved action and the existing
 * Paper coordinator. Strategy, sizing, and AEGIS facts arrive as immutable
 * evidence. This class only qualifies current price evidence and delegates
 * broker mechanics to MasterPaperExecutionOrchestrator.
 */
export class MasterPaperActionHandoff {
  constructor(
    private readonly quoteSource: ExecutionOptionQuoteSource,
    private readonly execution: MasterPaperExecutionOrchestrator,
    private readonly quoteAgePolicy: PreSubmitQuoteAgePolicy = paperBootstrapPreSubmitQuoteAgePolicy,
    private readonly clock:()=>string=()=>new Date().toISOString(),
    private readonly stockInventory?:StockInventorySource,
  ) {}

  async execute(raw: ApprovedMasterPaperActionPlan, now: string, marketOpen: boolean): Promise<MasterPaperActionHandoffResult> {
    const plan=masterPaperActionPlanSchema.parse(raw) as ApprovedMasterPaperActionPlan;
    const prepared=await prepareMasterPaperAction(plan,this.quoteSource,now,marketOpen,this.quoteAgePolicy,this.clock,this.stockInventory);
    if(prepared.state!=='READY_TO_SUBMIT'){
      return {actionPlanId:prepared.actionPlanId,state:prepared.state,blockers:prepared.blockers,execution:null};
    }
    if(prepared.command===null||prepared.quote===null||prepared.pricing===null)
      throw new Error('MASTER_PAPER_ACTION_PREPARATION_INVARIANT_FAILED');
    return {actionPlanId:plan.actionPlanId,state:'EXECUTED',blockers:[],execution:await this.execution.execute(prepared.command,{
      eventType:'INITIAL_LIMIT',eventTime:prepared.evaluatedAt,quote:prepared.quote,quoteAgeMs:prepared.quoteAgeMs,
      pricing:prepared.pricing,fillPrice:null,filledQuantity:null,attemptNo:plan.pricingAttempt+1,
      reasonCode:`ORDER_HANDOFF_REFERENCE:${this.quoteAgePolicy.policyVersion}`,
    })};
  }
}
