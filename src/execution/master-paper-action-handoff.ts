import { z } from 'zod';
import { decideAdaptiveLimit, type AdaptiveLimitPolicy } from './adaptive-limit-policy.js';
import { qualifyExecutionOptionQuote, type ExecutionOptionQuote } from './execution-option-quote.js';
import { assembleMasterPaperExecutionCommand } from './master-paper-command-assembly.js';
import { MasterPaperExecutionOrchestrator, type MasterPaperExecutionResult } from './master-paper-execution-orchestrator.js';
import { thetaActionOpensNewRisk, type ThetaOrderAction } from './order-construction.js';

export const masterPaperActionPlanVersion = 'theta-master-paper-action-plan-v1' as const;

export interface ApprovedMasterPaperActionPlan {
  readonly contractVersion: typeof masterPaperActionPlanVersion;
  readonly actionPlanId: string;
  readonly executionAccountId: string;
  readonly decisionId: string;
  readonly candidateId: string;
  readonly strategyVersion: string;
  readonly chainId: string;
  readonly optionContractId: string | null;
  readonly underlyingId: string;
  readonly underlying: string;
  readonly optionType: 'PUT'|'CALL'|null;
  readonly symbol: string;
  readonly quantity: number;
  readonly multiplier: number;
  readonly confirmedCoveredShares?: number;
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
  readonly killSwitchActive: boolean;
  readonly decisionExpiresAt: string;
  readonly pricingPolicy: AdaptiveLimitPolicy;
  readonly pricingAttempt: number;
  readonly previousLimit: number | null;
}

export const masterPaperActionPlanSchema = z.object({
  contractVersion:z.literal(masterPaperActionPlanVersion),actionPlanId:z.string().uuid(),executionAccountId:z.string().uuid(),
  decisionId:z.string().uuid(),candidateId:z.string().min(1),strategyVersion:z.string().min(1),chainId:z.string().uuid(),
  optionContractId:z.string().uuid().nullable(),underlyingId:z.string().uuid(),underlying:z.string().min(1).max(16),
  optionType:z.enum(['PUT','CALL']).nullable(),symbol:z.string().min(1).max(64),
  quantity:z.number().int().positive(),multiplier:z.number().int().positive(),confirmedCoveredShares:z.number().int().nonnegative().optional(),
  action:z.enum(['OPEN_CSP','CLOSE_CSP','ROLL_CSP_CLOSE','ROLL_CSP_OPEN','OPEN_CC','CLOSE_CC','ROLL_CC_CLOSE','ROLL_CC_OPEN','SELL_STOCK']),
  economicBoundary:z.number().positive().finite(),economicsRemainPositive:z.boolean(),expectedAfterCostEv:z.number().finite().nullable(),
  empiricalEconomicsReady:z.boolean(),selectedByCanonicalAuthority:z.boolean(),hardValidityPassed:z.boolean(),
  accountVerified:z.boolean(),optionsCapabilityVerified:z.boolean(),noEquivalentExposureConflict:z.boolean(),
  aegisState:z.enum(['ALLOW_FULL','ALLOW_REDUCED','HOLD_ONLY','HARD_VETO']),killSwitchActive:z.boolean(),
  decisionExpiresAt:z.string().datetime({offset:true}),pricingPolicy:z.object({waitIntervalMs:z.number().nonnegative(),
    maxAttempts:z.number().int().positive(),concessionFractions:z.array(z.number().min(0).max(1)),tickSize:z.number().positive()}),
  pricingAttempt:z.number().int().nonnegative(),previousLimit:z.number().positive().finite().nullable(),
}).strict();

export interface ExecutionOptionQuoteSource {
  getCurrentQuote(plan: ApprovedMasterPaperActionPlan, now: string): Promise<ExecutionOptionQuote | null>;
}

export interface MasterPaperActionHandoffResult {
  readonly actionPlanId: string;
  readonly state: 'BLOCKED' | 'NO_QUOTE' | 'QUOTE_REJECTED' | 'PRICE_REJECTED' | 'EXECUTED';
  readonly blockers: readonly string[];
  readonly execution: MasterPaperExecutionResult | null;
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
 * The single typed seam between a canonical approved action and the existing
 * Paper coordinator. Strategy, sizing, and AEGIS facts arrive as immutable
 * evidence. This class only qualifies current price evidence and delegates
 * broker mechanics to MasterPaperExecutionOrchestrator.
 */
export class MasterPaperActionHandoff {
  constructor(
    private readonly quoteSource: ExecutionOptionQuoteSource,
    private readonly execution: MasterPaperExecutionOrchestrator,
  ) {}

  async execute(raw: ApprovedMasterPaperActionPlan, now: string, marketOpen: boolean): Promise<MasterPaperActionHandoffResult> {
    const plan=masterPaperActionPlanSchema.parse(raw) as ApprovedMasterPaperActionPlan;
    const blockers:string[]=[];
    const opensNewRisk=thetaActionOpensNewRisk(plan.action);
    if(!plan.selectedByCanonicalAuthority)blockers.push('CANONICAL_SELECTION_REQUIRED');
    if(!plan.hardValidityPassed)blockers.push('HARD_VALIDITY_FAILED');
    if(!plan.accountVerified)blockers.push('MASTER_ACCOUNT_NOT_VERIFIED');
    if(!plan.optionsCapabilityVerified&&plan.action!=='SELL_STOCK')blockers.push('OPTIONS_CAPABILITY_NOT_VERIFIED');
    if(!plan.noEquivalentExposureConflict)blockers.push('EQUIVALENT_EXPOSURE_CONFLICT');
    if(plan.killSwitchActive)blockers.push('KILL_SWITCH_ACTIVE');
    if(!marketOpen)blockers.push('MARKET_CLOSED');
    if(!plan.economicsRemainPositive)blockers.push('FORWARD_ECONOMICS_NOT_POSITIVE');
    if(opensNewRisk&&(!plan.empiricalEconomicsReady||plan.expectedAfterCostEv===null||plan.expectedAfterCostEv<=0))
      blockers.push('POSITIVE_AFTER_COST_EV_NOT_EMPIRICALLY_READY');
    if(opensNewRisk&&!['ALLOW_FULL','ALLOW_REDUCED'].includes(plan.aegisState))blockers.push('AEGIS_NOT_APPROVED');
    if(blockers.length>0)return {actionPlanId:plan.actionPlanId,state:'BLOCKED',blockers,execution:null};

    const quote=await this.quoteSource.getCurrentQuote(plan,now);
    if(quote===null)return {actionPlanId:plan.actionPlanId,state:'NO_QUOTE',blockers:['FRESH_TRUSTED_TWO_SIDED_OPTION_QUOTE_NOT_YET_QUALIFIED'],execution:null};
    const qualification=qualifyExecutionOptionQuote({quote,expectedContractId:plan.symbol,nowUtc:now,
      maximumAgeMs:Math.max(0,Date.parse(plan.decisionExpiresAt)-Date.parse(now)),marketOpen});
    if(!qualification.qualified)return {actionPlanId:plan.actionPlanId,state:'QUOTE_REJECTED',blockers:qualification.blockers,execution:null};
    const pricing=decideAdaptiveLimit({side:sideFor(plan.action),quote,attempt:plan.pricingAttempt,
      previousLimit:plan.previousLimit,economicBoundary:plan.economicBoundary,
      economicsRemainPositive:plan.economicsRemainPositive,policy:plan.pricingPolicy});
    if((pricing.action!=='PLACE'&&pricing.action!=='REPLACE')||pricing.limitPrice===null)
      return {actionPlanId:plan.actionPlanId,state:'PRICE_REJECTED',blockers:[`ADAPTIVE_LIMIT_${pricing.reason}`],execution:null};
    if(!['ALPACA','OPTIONOMICS'].includes(quote.provider))
      return {actionPlanId:plan.actionPlanId,state:'QUOTE_REJECTED',blockers:['EXECUTION_QUOTE_PROVIDER_NOT_APPROVED'],execution:null};
    const alpaca=quote.provider==='ALPACA'&&quote.sourceSemantics==='CONSOLIDATED_NBBO';
    const optionomics=quote.provider==='OPTIONOMICS'&&quote.sourceSemantics==='TRUSTED_TWO_SIDED_ORDER_PRICING';
    if(plan.action!=='SELL_STOCK'&&!alpaca&&!optionomics)
      return {actionPlanId:plan.actionPlanId,state:'QUOTE_REJECTED',blockers:['ORDER_PRICING_SEMANTICS_NOT_PROVEN'],execution:null};
    const command=assembleMasterPaperExecutionCommand({action:plan.action,executionAccountId:plan.executionAccountId,
      decisionId:plan.decisionId,candidateId:plan.candidateId,strategyVersion:plan.strategyVersion,chainId:plan.chainId,
      optionContractId:plan.optionContractId,underlyingId:plan.underlyingId,symbol:plan.symbol,quantity:plan.quantity,
      multiplier:plan.multiplier,...(plan.confirmedCoveredShares===undefined?{}:{confirmedCoveredShares:plan.confirmedCoveredShares}),
      limitPrice:pricing.limitPrice,pricingPolicyVersion:pricing.policyVersion,
      quote:{source:quote.provider as 'ALPACA'|'OPTIONOMICS',feed:plan.action==='SELL_STOCK'?'IEX':alpaca?'OPRA':'TRUSTED_TWO_SIDED',
        semantics:quote.sourceSemantics as 'CONSOLIDATED_NBBO'|'TRUSTED_TWO_SIDED_ORDER_PRICING',bid:quote.bid,ask:quote.ask,
        observedAt:quote.providerTimestamp??quote.receivedAtUtc,maximumAgeSeconds:Math.max(0.001,(Date.parse(plan.decisionExpiresAt)-Date.parse(now))/1000)},
      accountVerified:plan.accountVerified,optionsCapabilityVerified:plan.optionsCapabilityVerified,aegisState:plan.aegisState,
      now,decisionExpiresAt:plan.decisionExpiresAt,attempt:plan.pricingAttempt+1});
    return {actionPlanId:plan.actionPlanId,state:'EXECUTED',blockers:[],execution:await this.execution.execute(command)};
  }
}
