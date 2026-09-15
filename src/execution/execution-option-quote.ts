export const executionOptionQuoteContractVersion = 'execution-option-quote-v1' as const;

export type ExecutionQuoteSemantics =
  | 'CONSOLIDATED_NBBO'
  | 'TRUSTED_TWO_SIDED_ORDER_PRICING'
  | 'INDICATIVE'
  | 'SESSION_RECORDED_RESEARCH'
  | 'UNKNOWN';

export type ExecutionQuoteSource = 'BROKER_CONSOLIDATED_OPRA'|'BROKER_INDICATIVE'|'EXTERNAL_MARKET_DATA_PROVIDER'|'SESSION_RECORDED_RESEARCH'|'UNKNOWN';
export type QuoteEntitlementState = 'NOT_CONFIGURED'|'NO_ENTITLEMENT'|'INDICATIVE_ONLY'|'ENTITLED_UNVERIFIED'|'QUALIFIED'|'STALE'|'PROVIDER_ERROR';

export interface ExecutionOptionQuote {
  readonly contractVersion: typeof executionOptionQuoteContractVersion;
  readonly contractId: string;
  readonly providerContractId: string;
  readonly bid: number;
  readonly ask: number;
  readonly bidSize: number | null;
  readonly askSize: number | null;
  readonly providerTimestamp: string | null;
  readonly receivedAtUtc: string;
  readonly receivedAtMonotonic: number;
  readonly sequence: number | null;
  readonly provider: string;
  readonly source?: ExecutionQuoteSource;
  readonly entitlementState?: QuoteEntitlementState;
  readonly sourceSemantics: ExecutionQuoteSemantics;
  readonly connectionState: 'CONNECTED' | 'RECONNECTING' | 'DISCONNECTED' | 'UNKNOWN';
  readonly subscriptionState: 'ACTIVE' | 'RESTORING' | 'INACTIVE' | 'UNKNOWN';
  readonly provenance: Readonly<Record<string, unknown>>;
}

export interface AggregatedExecutionQuote {
  readonly contractId:string; readonly bid:number; readonly ask:number;
  readonly bidProvider:string; readonly askProvider:string; readonly sourceCount:number;
  readonly semantics:Extract<ExecutionQuoteSemantics,'CONSOLIDATED_NBBO'|'TRUSTED_TWO_SIDED_ORDER_PRICING'>;
}

export function aggregateCompatibleExecutionQuotes(quotes:readonly ExecutionOptionQuote[],input:{expectedContractId:string;nowUtc:string;maximumAgeMs:number;marketOpen:boolean}):AggregatedExecutionQuote|null{
  const valid=quotes.filter((quote)=>qualifyExecutionOptionQuote({quote,expectedContractId:input.expectedContractId,
    nowUtc:input.nowUtc,maximumAgeMs:input.maximumAgeMs,marketOpen:input.marketOpen}).qualified);
  if(valid.length===0)return null;
  const first=valid[0];if(first===undefined)return null;
  const semantics=first.sourceSemantics;
  if(!valid.every((quote)=>quote.sourceSemantics===semantics))return null;
  const bestBid=valid.reduce((best,quote)=>quote.bid>best.bid?quote:best,first);
  const bestAsk=valid.reduce((best,quote)=>quote.ask<best.ask?quote:best,first);
  if(bestBid.bid>bestAsk.ask)return null;
  return {contractId:input.expectedContractId,bid:bestBid.bid,ask:bestAsk.ask,bidProvider:bestBid.provider,
    askProvider:bestAsk.provider,sourceCount:valid.length,semantics:semantics as AggregatedExecutionQuote['semantics']};
}

export interface ExecutionQuoteQualification {
  readonly qualified: boolean;
  readonly quoteAgeMs: number | null;
  readonly blockers: readonly string[];
}

const validTime = (value: string | null): number | null => {
  if (value === null) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export function qualifyExecutionOptionQuote(input: {
  readonly quote: ExecutionOptionQuote;
  readonly expectedContractId: string;
  readonly nowUtc: string;
  readonly maximumAgeMs: number;
  readonly previousSequence?: number | null;
  readonly marketOpen: boolean;
}): ExecutionQuoteQualification {
  const blockers: string[] = [];
  const now = validTime(input.nowUtc);
  const received = validTime(input.quote.receivedAtUtc);
  const provider = validTime(input.quote.providerTimestamp);
  const authoritativeTime = provider ?? received;
  const agePolicyValid = Number.isFinite(input.maximumAgeMs) && input.maximumAgeMs >= 0;
  if (!input.quote.contractId.trim() || input.quote.contractId !== input.expectedContractId
    || !input.quote.providerContractId.trim()) blockers.push('CONTRACT_IDENTITY_MISMATCH');
  if (!Number.isFinite(input.quote.bid) || !Number.isFinite(input.quote.ask)
    || input.quote.bid <= 0 || input.quote.ask <= 0) blockers.push('TWO_SIDED_QUOTE_INVALID');
  else if (input.quote.bid > input.quote.ask) blockers.push('QUOTE_CROSSED');
  if (!Number.isFinite(input.quote.receivedAtMonotonic) || input.quote.receivedAtMonotonic < 0) blockers.push('MONOTONIC_RECEIPT_INVALID');
  if (!input.quote.provider.trim()) blockers.push('PROVIDER_MISSING');
  if (input.quote.connectionState !== 'CONNECTED') blockers.push('QUOTE_CONNECTION_NOT_STABLE');
  if (input.quote.subscriptionState !== 'ACTIVE') blockers.push('QUOTE_SUBSCRIPTION_NOT_ACTIVE');
  if (!input.marketOpen) blockers.push('MARKET_CLOSED');
  if (!agePolicyValid) blockers.push('QUOTE_AGE_POLICY_INVALID');
  if (now === null || received === null || authoritativeTime === null) blockers.push('QUOTE_TIMESTAMP_INVALID');
  else {
    if (received > now || (provider !== null && (provider > received || provider > now))) blockers.push('QUOTE_TIMESTAMP_SEQUENCE_INVALID');
    if (agePolicyValid && now - authoritativeTime > input.maximumAgeMs) blockers.push('QUOTE_STALE');
  }
  if (!['CONSOLIDATED_NBBO', 'TRUSTED_TWO_SIDED_ORDER_PRICING'].includes(input.quote.sourceSemantics)) {
    blockers.push('ORDER_PRICING_SEMANTICS_NOT_PROVEN');
  }
  if (input.quote.provenance.authenticated !== true
    || input.quote.provenance.exactContractMapping !== true
    || input.quote.provenance.documentedForOrderPricing !== true) blockers.push('QUOTE_PROVENANCE_NOT_PROVEN');
  if (input.previousSequence !== undefined && input.previousSequence !== null && input.quote.sequence !== null
    && input.quote.sequence <= input.previousSequence) blockers.push('QUOTE_OUT_OF_ORDER');
  return {
    qualified: blockers.length === 0,
    quoteAgeMs: now === null || authoritativeTime === null ? null : now - authoritativeTime,
    blockers,
  };
}
