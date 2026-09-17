import type { AlpacaProviderConfig } from '../theta/alpaca-provider.js';
import { fetchLatestStockQuote, fetchOptionSnapshots } from '../theta/alpaca-provider.js';
import { executionOptionQuoteContractVersion, type ExecutionOptionQuote } from './execution-option-quote.js';
import type { ApprovedMasterPaperActionPlan, ExecutionOptionQuoteSource } from './master-paper-action-handoff.js';

/** Fetches one exact current Alpaca quote. Options require OPRA. A stock exit
 * uses IEX and remains subject to the same downstream freshness and provenance
 * qualification. Entitlement and missingness fail closed. */
export class AlpacaExecutionQuoteSource implements ExecutionOptionQuoteSource {
  private sequence=0;
  constructor(private readonly alpaca:AlpacaProviderConfig){}

  async getCurrentQuote(plan:ApprovedMasterPaperActionPlan,now:string):Promise<ExecutionOptionQuote|null>{
    this.sequence+=1;
    if(plan.action==='SELL_STOCK'){
      const quote=await fetchLatestStockQuote(this.alpaca,plan.symbol,'iex');
      if(quote.bid===null||quote.ask===null)return null;
      return {contractVersion:executionOptionQuoteContractVersion,contractId:plan.symbol,providerContractId:plan.symbol,
        bid:quote.bid,ask:quote.ask,bidSize:quote.bidSize,askSize:quote.askSize,providerTimestamp:quote.timestamp,
        receivedAtUtc:now,receivedAtMonotonic:performance.now(),sequence:this.sequence,provider:'ALPACA',
        sourceSemantics:'TRUSTED_TWO_SIDED_ORDER_PRICING',connectionState:'CONNECTED',subscriptionState:'ACTIVE',
        provenance:{authenticated:true,exactContractMapping:true,documentedForOrderPricing:true,feed:quote.feed}};
    }
    if(plan.optionContractId===null||plan.optionType===null)return null;
    const result=await fetchOptionSnapshots(this.alpaca,{underlyingSymbol:plan.underlying,feed:'opra',
      optionType:plan.optionType.toLowerCase() as 'put'|'call',limit:1000,maxPages:10});
    const quote=result.snapshots.get(plan.symbol);
    if(quote===undefined||quote.bid===null||quote.ask===null)return null;
    return {contractVersion:executionOptionQuoteContractVersion,contractId:plan.symbol,providerContractId:plan.symbol,
      bid:quote.bid,ask:quote.ask,bidSize:quote.bidSize,askSize:quote.askSize,providerTimestamp:quote.quoteTimestamp,
      receivedAtUtc:now,receivedAtMonotonic:performance.now(),sequence:this.sequence,provider:'ALPACA',
      sourceSemantics:'CONSOLIDATED_NBBO',connectionState:'CONNECTED',subscriptionState:'ACTIVE',
      provenance:{authenticated:true,exactContractMapping:true,documentedForOrderPricing:true,feed:'OPRA'}};
  }
}

/**
 * Read-only semantic adapter for Alpaca's free indicative options feed. It is
 * useful for cross-checking and degradation detection, but its explicit
 * INDICATIVE semantics guarantee that the execution qualifier rejects it.
 */
export class AlpacaIndicativeOptionQuoteSource implements ExecutionOptionQuoteSource {
  private sequence=0;
  constructor(private readonly alpaca:AlpacaProviderConfig){}

  async getCurrentQuote(plan:ApprovedMasterPaperActionPlan,now:string):Promise<ExecutionOptionQuote|null>{
    if(plan.action==='SELL_STOCK'||plan.optionContractId===null||plan.optionType===null)return null;
    this.sequence+=1;
    const result=await fetchOptionSnapshots(this.alpaca,{underlyingSymbol:plan.underlying,feed:'indicative',
      optionType:plan.optionType.toLowerCase() as 'put'|'call',limit:1000,maxPages:10});
    const quote=result.snapshots.get(plan.symbol);
    if(quote===undefined||quote.bid===null||quote.ask===null)return null;
    return {contractVersion:executionOptionQuoteContractVersion,contractId:plan.symbol,providerContractId:plan.symbol,
      bid:quote.bid,ask:quote.ask,bidSize:quote.bidSize,askSize:quote.askSize,providerTimestamp:quote.quoteTimestamp,
      receivedAtUtc:now,receivedAtMonotonic:performance.now(),sequence:this.sequence,provider:'ALPACA',
      source:'BROKER_INDICATIVE',entitlementState:'INDICATIVE_ONLY',sourceSemantics:'INDICATIVE',
      connectionState:'CONNECTED',subscriptionState:'ACTIVE',provenance:{authenticated:true,exactContractMapping:true,
        documentedForOrderPricing:false,feed:'INDICATIVE',semanticUse:'CROSS_CHECK_ONLY'}};
  }
}
