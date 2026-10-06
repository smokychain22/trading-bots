import { createHash } from 'node:crypto';
import type { DurableMultiLegOrderEvidence } from './paper-order-coordinator.js';

export const definedRiskLifecycleVersion='theta-defined-risk-lifecycle-v1' as const;
export type DefinedRiskExpiryState='SAFE_TO_EXPIRE'|'CLOSE_REQUIRED'|'PIN_RISK'|'ASSIGNMENT_RISK'|'EXERCISE_RELEVANT'|'UNKNOWN';

export interface DefinedRiskQuote{readonly symbol:string;readonly bid:number;readonly ask:number;readonly observedAt:string;}
export interface DefinedRiskClosePlan{
  readonly contractVersion:typeof definedRiskLifecycleVersion; readonly action:'CLOSE_DEFINED_RISK';
  readonly parentIntentId:string; readonly packageIdentity:string; readonly quantity:number;
  readonly legs:readonly [{readonly symbol:string;readonly positionIntent:'buy_to_close'},
    {readonly symbol:string;readonly positionIntent:'sell_to_close'}];
  readonly netDebitPerShare:number; readonly quoteObservedAt:string; readonly contentHash:string;
}

export function buildDefinedRiskClosePlan(input:{parentIntentId:string;evidence:DurableMultiLegOrderEvidence;quantity:number;
  shortQuote:DefinedRiskQuote;longQuote:DefinedRiskQuote;now:string;maximumQuoteAgeSeconds:number}):DefinedRiskClosePlan{
  if(input.evidence.legs.length!==2||input.evidence.creditDebitDirection!=='CREDIT')throw new Error('DEFINED_RISK_CLOSE_STRUCTURE_INVALID');
  const [shortLeg,longLeg]=input.evidence.legs;
  if(shortLeg===undefined||longLeg===undefined||shortLeg.positionIntent!=='sell_to_open'||longLeg.positionIntent!=='buy_to_open'
    ||shortLeg.expiration!==longLeg.expiration||shortLeg.multiplier!==longLeg.multiplier||shortLeg.strike<=longLeg.strike)
    throw new Error('DEFINED_RISK_CLOSE_STRUCTURE_INVALID');
  if(input.shortQuote.symbol!==shortLeg.occSymbol||input.longQuote.symbol!==longLeg.occSymbol)
    throw new Error('DEFINED_RISK_CLOSE_QUOTE_IDENTITY_MISMATCH');
  const now=Date.parse(input.now);
  for(const quote of [input.shortQuote,input.longQuote]){
    const age=(now-Date.parse(quote.observedAt))/1000;
    if(!Number.isFinite(age)||age<0||age>input.maximumQuoteAgeSeconds||quote.bid<0||quote.ask<=0||quote.ask<quote.bid)
      throw new Error('DEFINED_RISK_CLOSE_QUOTE_NOT_EXECUTABLE');
  }
  if(!Number.isSafeInteger(input.quantity)||input.quantity<=0)throw new Error('DEFINED_RISK_CLOSE_QUANTITY_INVALID');
  const netDebit=Math.max(0,input.shortQuote.ask-input.longQuote.bid);
  const unsigned={contractVersion:definedRiskLifecycleVersion,action:'CLOSE_DEFINED_RISK' as const,parentIntentId:input.parentIntentId,
    packageIdentity:input.evidence.packageIdentity,quantity:input.quantity,legs:[
      {symbol:shortLeg.occSymbol,positionIntent:'buy_to_close' as const},
      {symbol:longLeg.occSymbol,positionIntent:'sell_to_close' as const}] as const,
    netDebitPerShare:Number(netDebit.toFixed(2)),quoteObservedAt:[input.shortQuote.observedAt,input.longQuote.observedAt]
      .sort((a,b)=>Date.parse(b)-Date.parse(a))[0]??input.now};
  return{...unsigned,contentHash:createHash('sha256').update(JSON.stringify(unsigned)).digest('hex')};
}

export function classifyDefinedRiskExpiry(input:{spot:number|null;shortStrike:number;longStrike:number;dte:number|null;
  marketOpen:boolean;pinBandPct:number;shortAssignmentConfirmed:boolean;longExerciseConfirmed:boolean}):DefinedRiskExpiryState{
  if(input.spot===null||input.dte===null||input.dte<0||input.shortStrike<=input.longStrike||input.pinBandPct<0)return'UNKNOWN';
  if(input.shortAssignmentConfirmed&&input.longExerciseConfirmed)return'EXERCISE_RELEVANT';
  if(input.shortAssignmentConfirmed)return'ASSIGNMENT_RISK';
  if(input.dte>1)return'SAFE_TO_EXPIRE';
  const pinDistance=Math.abs(input.spot-input.shortStrike)/input.shortStrike;
  if(pinDistance<=input.pinBandPct)return'PIN_RISK';
  if(input.spot<input.longStrike)return'EXERCISE_RELEVANT';
  if(input.spot<input.shortStrike)return'ASSIGNMENT_RISK';
  return input.marketOpen?'CLOSE_REQUIRED':'SAFE_TO_EXPIRE';
}

export interface DefinedRiskWholeChainAccounting{
  /** null = UNKNOWN (never coerced to zero): the actual per-leg fill prices were not reported */
  readonly openingNetCredit:number|null; readonly openingFees:number|null; readonly closingNetDebit:number|null;
  readonly closingFees:number|null; readonly assignmentExerciseCashFlow:number;
  /** after-fee realized P&L: UNKNOWN (null) until every fee is known */
  readonly realizedPnl:number|null;
  /** realized P&L before fees: known as soon as the opening credit and closing debit are known */
  readonly realizedPnlBeforeFees:number|null;
  readonly pnlState:'OPEN'|'REALIZED'|'REALIZED_BEFORE_FEES'|'UNKNOWN_INPUT';
  readonly remainingUnrealizedExposure:'NONE'|'OPEN_SPREAD'|'STOCK_INVENTORY'|'UNKNOWN';
}

/** Whole-chain economics of the ONE spread, from actual per-leg fills. Any unknown component keeps realized P&L unknown; it is never treated as zero. */
export function computeDefinedRiskWholeChainAccounting(input:{quantity:number;multiplier:number;openingNetCreditPerShare:number|null;
  openingFees:number|null;closingNetDebitPerShare:number|null;closingFees:number|null;assignmentExerciseCashFlow:number;
  lifecycle:'OPEN'|'CLOSED'|'STOCK_INVENTORY'|'UNKNOWN'}):DefinedRiskWholeChainAccounting{
  const known=(value:number|null):boolean=>value===null||(Number.isFinite(value)&&value>=0);
  if(!Number.isSafeInteger(input.quantity)||!Number.isSafeInteger(input.multiplier)||input.quantity<=0||input.multiplier<=0
    ||!known(input.openingNetCreditPerShare)||!known(input.openingFees)||!known(input.closingFees)||!known(input.closingNetDebitPerShare)
    ||!Number.isFinite(input.assignmentExerciseCashFlow))
    throw new Error('DEFINED_RISK_ACCOUNTING_INPUT_INVALID');
  const openingNetCredit=input.openingNetCreditPerShare===null?null:input.quantity*input.multiplier*input.openingNetCreditPerShare;
  const closingNetDebit=input.closingNetDebitPerShare===null?null:input.quantity*input.multiplier*input.closingNetDebitPerShare;
  const closed=input.lifecycle==='CLOSED';
  const realizedPnlBeforeFees=closed&&openingNetCredit!==null&&closingNetDebit!==null
    ?Number((openingNetCredit-closingNetDebit+input.assignmentExerciseCashFlow).toFixed(8)):null;
  const realizedPnl=realizedPnlBeforeFees!==null&&input.openingFees!==null&&input.closingFees!==null
    ?Number((realizedPnlBeforeFees-input.openingFees-input.closingFees).toFixed(8)):null;
  return{openingNetCredit,openingFees:input.openingFees,closingNetDebit,closingFees:input.closingFees,
    assignmentExerciseCashFlow:input.assignmentExerciseCashFlow,realizedPnl,realizedPnlBeforeFees,
    pnlState:realizedPnl!==null?'REALIZED':realizedPnlBeforeFees!==null?'REALIZED_BEFORE_FEES':closed?'UNKNOWN_INPUT':'OPEN',
    remainingUnrealizedExposure:closed?'NONE':input.lifecycle==='OPEN'?'OPEN_SPREAD':input.lifecycle==='STOCK_INVENTORY'?'STOCK_INVENTORY':'UNKNOWN'};
}
