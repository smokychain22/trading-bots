import type { AlpacaProviderConfig } from '../theta/alpaca-provider.js';
import { fetchLatestStockQuote, fetchOptionContracts, fetchOptionSnapshots } from '../theta/alpaca-provider.js';
import { parseOccOptionSymbol } from '../theta/account-exposure.js';
import { executionOptionQuoteContractVersion, type ExecutionOptionQuote } from './execution-option-quote.js';
import type { ApprovedMasterPaperActionPlan, ExecutionOptionQuoteSource } from './master-paper-action-handoff.js';

function exactOptionSnapshotFilter(plan: ApprovedMasterPaperActionPlan): {
  underlyingSymbol: string; feed: 'indicative'; optionType: 'put' | 'call';
  expirationDateGte: string; expirationDateLte: string;
  strikePriceGte: number; strikePriceLte: number; limit: number; maxPages: number;
} | null {
  if (plan.optionContractId === null || plan.optionType === null) return null;
  const identity = parseOccOptionSymbol(plan.symbol);
  if (identity === null || identity.underlying !== plan.underlying || identity.optionType !== plan.optionType) return null;
  return { underlyingSymbol: plan.underlying, feed: 'indicative', optionType: plan.optionType.toLowerCase() as 'put' | 'call',
    expirationDateGte: identity.expiration, expirationDateLte: identity.expiration,
    strikePriceGte: identity.strike, strikePriceLte: identity.strike,
    limit: 1000, maxPages: 10 };
}

function classifyDeliverable(listing: Awaited<ReturnType<typeof fetchOptionContracts>>['items'][number], underlying: string) {
  if (listing.deliverables === null || listing.deliverables === undefined) return 'UNKNOWN' as const;
  return listing.deliverables.length === 1
    && listing.deliverables[0]?.type.toLowerCase() === 'equity'
    && listing.deliverables[0].symbol === underlying
    && listing.multiplier !== null
    && listing.deliverables[0].amount === listing.multiplier
    && listing.deliverables[0].allocationPercentage === 100
    ? 'STANDARD_EQUITY' as const : 'ADJUSTED' as const;
}

/** Fetches one exact current Alpaca quote. Options use Alpaca's Paper-only
 * indicative reference. A stock exit
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
    const filter=exactOptionSnapshotFilter(plan);
    if(filter===null)return null;
    const [result,contracts]=await Promise.all([
      fetchOptionSnapshots(this.alpaca,filter),
      fetchOptionContracts(this.alpaca,{underlyingSymbol:filter.underlyingSymbol,
        expirationDateGte:filter.expirationDateGte,expirationDateLte:filter.expirationDateLte,
        optionType:filter.optionType,showDeliverables:true,limit:1000,maxPages:10}),
    ]);
    if(!result.complete||!contracts.complete)return null;
    const quote=result.snapshots.get(plan.symbol);
    const listing=contracts.items.find((item)=>item.symbol===plan.symbol);
    if(quote===undefined||quote.bid===null||quote.ask===null||listing===undefined||listing.multiplier===null
      ||listing.tradable!==true||listing.exerciseStyle==null)return null;
    return {contractVersion:executionOptionQuoteContractVersion,contractId:plan.symbol,providerContractId:plan.symbol,
      optionIdentity:{underlying:listing.underlyingSymbol??plan.underlying,optionSymbol:listing.symbol,
        expiration:listing.expirationDate,strike:listing.strikePrice,optionType:listing.optionType,
        multiplier:listing.multiplier,contractTradable:listing.tradable,exerciseStyle:listing.exerciseStyle,
        deliverableClassification:classifyDeliverable(listing,plan.underlying)},
      bid:quote.bid,ask:quote.ask,bidSize:quote.bidSize,askSize:quote.askSize,providerTimestamp:quote.quoteTimestamp,
      receivedAtUtc:now,receivedAtMonotonic:performance.now(),sequence:this.sequence,provider:'ALPACA',
      source:'BROKER_INDICATIVE',entitlementState:'QUALIFIED',sourceSemantics:'PAPER_INDICATIVE_REFERENCE',
      connectionState:'CONNECTED',subscriptionState:'ACTIVE',provenance:{authenticated:true,exactContractMapping:true,
        documentedForOrderPricing:false,feed:'INDICATIVE',paperOnly:true,semanticUse:'MASTER_THETA_PAPER_LIMIT_REFERENCE'}};
  }
}

/**
 * Paper-only adapter for Alpaca's free indicative options feed. The distinct
 * semantic class prevents this reference from ever being represented as OPRA,
 * consolidated NBBO, or live-money price authority.
 */
export class AlpacaIndicativeOptionQuoteSource implements ExecutionOptionQuoteSource {
  private sequence=0;
  constructor(private readonly alpaca:AlpacaProviderConfig){}

  async getCurrentQuote(plan:ApprovedMasterPaperActionPlan,now:string):Promise<ExecutionOptionQuote|null>{
    if(plan.action==='SELL_STOCK')return null;
    const filter=exactOptionSnapshotFilter(plan);
    if(filter===null)return null;
    this.sequence+=1;
    const [result,contracts]=await Promise.all([
      fetchOptionSnapshots(this.alpaca,filter),
      fetchOptionContracts(this.alpaca,{underlyingSymbol:filter.underlyingSymbol,
        expirationDateGte:filter.expirationDateGte,expirationDateLte:filter.expirationDateLte,
        optionType:filter.optionType,showDeliverables:true,limit:1000,maxPages:10}),
    ]);
    if(!result.complete||!contracts.complete)return null;
    const quote=result.snapshots.get(plan.symbol);
    const listing=contracts.items.find((item)=>item.symbol===plan.symbol);
    if(quote===undefined||quote.bid===null||quote.ask===null||listing===undefined||listing.multiplier===null
      ||listing.tradable!==true||listing.exerciseStyle==null)return null;
    return {contractVersion:executionOptionQuoteContractVersion,contractId:plan.symbol,providerContractId:plan.symbol,
      optionIdentity:{underlying:listing.underlyingSymbol??plan.underlying,optionSymbol:listing.symbol,
        expiration:listing.expirationDate,strike:listing.strikePrice,optionType:listing.optionType,
        multiplier:listing.multiplier,contractTradable:listing.tradable,exerciseStyle:listing.exerciseStyle,
        deliverableClassification:classifyDeliverable(listing,plan.underlying)},
      bid:quote.bid,ask:quote.ask,bidSize:quote.bidSize,askSize:quote.askSize,providerTimestamp:quote.quoteTimestamp,
      receivedAtUtc:now,receivedAtMonotonic:performance.now(),sequence:this.sequence,provider:'ALPACA',
      source:'BROKER_INDICATIVE',entitlementState:'QUALIFIED',sourceSemantics:'PAPER_INDICATIVE_REFERENCE',
      connectionState:'CONNECTED',subscriptionState:'ACTIVE',provenance:{authenticated:true,exactContractMapping:true,
        documentedForOrderPricing:false,feed:'INDICATIVE',paperOnly:true,semanticUse:'MASTER_THETA_PAPER_LIMIT_REFERENCE'}};
  }
}
