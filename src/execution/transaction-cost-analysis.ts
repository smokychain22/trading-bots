export const transactionCostAnalysisVersion = 'theta-tca-v1' as const;

export interface TransactionCostAnalysis {
  readonly contractVersion: typeof transactionCostAnalysisVersion;
  readonly decisionMid: number;
  readonly arrivalMid: number;
  readonly fillPrice: number | null;
  readonly spreadAtDecision: number;
  readonly spreadAtArrival: number;
  readonly spreadAtFill: number | null;
  readonly limitAttempts: number;
  readonly latencyMs: number | null;
  readonly slippageDollars: number | null;
  readonly slippageBps: number | null;
  readonly spreadCapture: number | null;
  readonly fees: number | null;
  readonly estimatedMarketImpact: number | null;
  readonly postFillMove: Readonly<Record<string, number | null>>;
  readonly quoteProvider: string;
  readonly quoteSemantics: string;
  readonly benchmarkClass: 'ALPACA_INDICATIVE_TCA' | 'CONSOLIDATED_NBBO_TCA' | 'TRUSTED_TWO_SIDED_TCA' | 'UNCLASSIFIED_TCA';
  readonly providerTimestamp: string | null;
  readonly receivedAt: string;
  readonly quoteAgeMs: number | null;
  readonly unknownReasons: readonly string[];
}

const mid = (bid: number, ask: number): number => {
  if (![bid, ask].every(Number.isFinite) || bid <= 0 || ask <= 0 || bid > ask) throw new Error('TCA_QUOTE_INVALID');
  return (bid + ask) / 2;
};

export function buildTransactionCostAnalysis(input: {
  readonly side: 'BUY' | 'SELL';
  readonly quantity: number;
  readonly multiplier: number;
  readonly decision: { bid: number; ask: number; at: string };
  readonly arrival: { bid: number; ask: number; at: string };
  readonly fill: { price: number; bid: number | null; ask: number | null; at: string } | null;
  readonly limitAttempts: number;
  readonly fees: number | null;
  readonly feeMissingReason?: string;
  readonly estimatedMarketImpact: number | null;
  readonly marketImpactMissingReason?: string;
  readonly postFillMove: Readonly<Record<string, number | null>>;
  readonly quoteProvider: string;
  readonly quoteSemantics: string;
  readonly providerTimestamp: string | null;
  readonly receivedAt: string;
  readonly quoteAgeMs: number | null;
}): TransactionCostAnalysis {
  if (!Number.isInteger(input.quantity) || input.quantity <= 0 || !Number.isFinite(input.multiplier) || input.multiplier <= 0
    || !Number.isInteger(input.limitAttempts) || input.limitAttempts <= 0) throw new Error('TCA_INPUT_INVALID');
  const decisionMid = mid(input.decision.bid, input.decision.ask);
  const arrivalMid = mid(input.arrival.bid, input.arrival.ask);
  const unknownReasons: string[] = [];
  if (input.fees === null) unknownReasons.push(input.feeMissingReason?.trim() || 'FEES_UNKNOWN');
  if (input.estimatedMarketImpact === null) unknownReasons.push(input.marketImpactMissingReason?.trim() || 'MARKET_IMPACT_UNKNOWN');
  let fillPrice: number | null = null;
  let spreadAtFill: number | null = null;
  let latencyMs: number | null = null;
  let slippageDollars: number | null = null;
  let slippageBps: number | null = null;
  let spreadCapture: number | null = null;
  if (input.fill === null) unknownReasons.push('NO_FILL');
  else {
    if (!Number.isFinite(input.fill.price) || input.fill.price <= 0) throw new Error('TCA_FILL_INVALID');
    if ([input.fill.bid, input.fill.ask].some(value => value !== null && (!Number.isFinite(value) || value <= 0))) {
      throw new Error('TCA_QUOTE_INVALID');
    }
    fillPrice = input.fill.price;
    if (input.fill.bid === null || input.fill.ask === null) unknownReasons.push('FILL_BBO_UNKNOWN');
    else {
      mid(input.fill.bid, input.fill.ask);
      spreadAtFill = input.fill.ask - input.fill.bid;
      spreadCapture = spreadAtFill > 0
        ? (input.side === 'SELL' ? fillPrice - input.fill.bid : input.fill.ask - fillPrice) / spreadAtFill
        : null;
    }
    const decisionTime = Date.parse(input.decision.at);
    const fillTime = Date.parse(input.fill.at);
    if (!Number.isFinite(decisionTime) || !Number.isFinite(fillTime) || fillTime < decisionTime) throw new Error('TCA_TIME_INVALID');
    latencyMs = fillTime - decisionTime;
    const perShareCost = input.side === 'BUY' ? fillPrice - decisionMid : decisionMid - fillPrice;
    slippageDollars = perShareCost * input.quantity * input.multiplier;
    slippageBps = decisionMid > 0 ? perShareCost / decisionMid * 10_000 : null;
  }
  return {
    contractVersion: transactionCostAnalysisVersion, decisionMid, arrivalMid, fillPrice,
    spreadAtDecision: input.decision.ask - input.decision.bid,
    spreadAtArrival: input.arrival.ask - input.arrival.bid,
    spreadAtFill, limitAttempts: input.limitAttempts, latencyMs, slippageDollars,
    slippageBps, spreadCapture, fees: input.fees,
    estimatedMarketImpact: input.estimatedMarketImpact, postFillMove: input.postFillMove,
    quoteProvider: input.quoteProvider, quoteSemantics: input.quoteSemantics,
    benchmarkClass: input.quoteProvider === 'ALPACA' && input.quoteSemantics === 'PAPER_INDICATIVE_REFERENCE'
      ? 'ALPACA_INDICATIVE_TCA'
      : input.quoteSemantics === 'CONSOLIDATED_NBBO' ? 'CONSOLIDATED_NBBO_TCA'
      : input.quoteSemantics === 'TRUSTED_TWO_SIDED_ORDER_PRICING' ? 'TRUSTED_TWO_SIDED_TCA' : 'UNCLASSIFIED_TCA',
    providerTimestamp: input.providerTimestamp, receivedAt: input.receivedAt,
    quoteAgeMs: input.quoteAgeMs, unknownReasons,
  };
}
