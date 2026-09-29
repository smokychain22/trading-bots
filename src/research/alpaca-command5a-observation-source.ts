import {
  AlpacaProviderError,
  fetchLatestStockTrade,
  fetchMarketClock,
  fetchOptionSnapshots,
  type AlpacaProviderConfig,
} from '../theta/alpaca-provider.js';
import type {
  Command5aObservedSubject,
  Command5aReadOnlyObservationSource,
} from './command5a-local-observation-worker.js';
import type { ContractPathQuoteObservation } from './contract-path-observation-runtime.js';

export const alpacaCommand5aObservationSourceVersion = 'theta-alpaca-command5a-observation-source-v2' as const;

function providerFailureReason(error: unknown): string {
  if (!(error instanceof AlpacaProviderError)) return 'PROVIDER_UNCLASSIFIED_ERROR';
  return error.errorClass === 'PROVIDER_TIMEOUT' ? 'PROVIDER_TIMEOUT' : `PROVIDER_${error.errorClass}`;
}

function quoteQuality(input: {
  readonly bid: number | null;
  readonly ask: number | null;
  readonly providerTimestamp: string | null;
  readonly receivedAt: string;
  readonly maximumResearchQuoteAgeSeconds: number;
}): Pick<ContractPathQuoteObservation, 'quality' | 'reasonCodes'> {
  const reasons: string[] = [];
  if (input.bid === null) reasons.push('BID_MISSING');
  if (input.ask === null) reasons.push('ASK_MISSING');
  if (input.bid !== null && input.ask !== null && input.bid > input.ask) reasons.push('CROSSED_MARKET');
  if (input.providerTimestamp === null) reasons.push('PROVIDER_TIMESTAMP_MISSING');
  else {
    const ageSeconds = (Date.parse(input.receivedAt) - Date.parse(input.providerTimestamp)) / 1_000;
    if (!Number.isFinite(ageSeconds) || ageSeconds < 0) reasons.push('PROVIDER_TIMESTAMP_INVALID');
    else if (ageSeconds > input.maximumResearchQuoteAgeSeconds) reasons.push('QUOTE_STALE');
  }
  const quality: ContractPathQuoteObservation['quality'] = reasons.includes('CROSSED_MARKET')
    || reasons.includes('PROVIDER_TIMESTAMP_INVALID') ? 'INVALID'
    : reasons.includes('QUOTE_STALE') ? 'STALE'
      : reasons.length > 0 ? 'PARTIAL' : 'GOOD';
  return { quality, reasonCodes: reasons };
}

/**
 * Alpaca-backed research observation source. The adapter uses current GET
 * endpoints only and does not receive a broker object, order store, or
 * mutation method. Alpaca remains the exact-contract and current-market
 * authority for these factual marks.
 */
export class AlpacaCommand5aObservationSource implements Command5aReadOnlyObservationSource {
  readonly brokerAuthority = false as const;

  constructor(
    private readonly alpaca: AlpacaProviderConfig,
    private readonly options: {
      readonly optionFeed: 'opra' | 'indicative';
      readonly stockFeed: 'iex' | 'sip';
      readonly maximumResearchQuoteAgeSeconds: number;
      readonly maximumTargetDelaySeconds: number;
    },
  ) {
    if (!Number.isFinite(options.maximumResearchQuoteAgeSeconds)
      || options.maximumResearchQuoteAgeSeconds <= 0
      || !Number.isFinite(options.maximumTargetDelaySeconds)
      || options.maximumTargetDelaySeconds <= 0) {
      throw new Error('COMMAND5A_RESEARCH_QUOTE_AGE_INVALID');
    }
  }

  async marketState(): Promise<{ readonly providerAvailable: boolean; readonly marketSessionOpen: boolean | null }> {
    try {
      const clock = await fetchMarketClock(this.alpaca, new Date().toISOString());
      return { providerAvailable: true, marketSessionOpen: clock.isOpen };
    } catch {
      return { providerAvailable: false, marketSessionOpen: null };
    }
  }

  async observe(input: Parameters<Command5aReadOnlyObservationSource['observe']>[0]): Promise<Command5aObservedSubject> {
    const requestStartedAt = new Date().toISOString();
    const targetAtMs = Date.parse(input.job.targetAt);
    const requestDelaySeconds = (Date.parse(requestStartedAt) - targetAtMs) / 1_000;
    if (!Number.isFinite(targetAtMs) || !Number.isFinite(requestDelaySeconds) || requestDelaySeconds < 0) {
      return { state: 'INVALID', quotes: [], underlying: null, observedAt: requestStartedAt,
        reasonCode: 'TARGET_OBSERVATION_TIME_INVALID' };
    }
    if (requestDelaySeconds > this.options.maximumTargetDelaySeconds) {
      return { state: 'MISSING', quotes: [], underlying: null, observedAt: requestStartedAt,
        reasonCode: 'TARGET_OBSERVATION_WINDOW_EXPIRED' };
    }
    try {
    const quotesBySymbol = new Map<string, ContractPathQuoteObservation>();
    const uniqueSymbols = new Set(input.subject.episode.legs.map((leg) => leg.optionSymbol));
    if (uniqueSymbols.size !== input.subject.episode.legs.length) return {
      state: 'INVALID', quotes: [], underlying: null, observedAt: new Date().toISOString(),
      reasonCode: 'DUPLICATE_CONTRACT_LEG',
    };
    const groups = new Map<string, typeof input.subject.episode.legs[number][]>();
    for (const leg of input.subject.episode.legs) {
      const key = `${leg.optionType}:${leg.expiration}`;
      const existing = groups.get(key) ?? [];
      existing.push(leg);
      groups.set(key, existing);
    }
    for (const legs of groups.values()) {
      const first = legs[0];
      if (first === undefined) continue;
      const strikes = legs.map((leg) => leg.strike);
      const response = await fetchOptionSnapshots(this.alpaca, {
        underlyingSymbol: input.subject.underlying,
        feed: this.options.optionFeed,
        optionType: first.optionType === 'PUT' ? 'put' : 'call',
        expirationDateGte: first.expiration,
        expirationDateLte: first.expiration,
        strikePriceGte: Math.min(...strikes),
        strikePriceLte: Math.max(...strikes),
        limit: 100,
        maxPages: 2,
      });
      const receivedAt = new Date().toISOString();
      if (!response.complete) return { state: 'INVALID', quotes: [], underlying: null,
        observedAt: receivedAt, reasonCode: 'EXACT_SNAPSHOT_ENUMERATION_INCOMPLETE' };
      for (const leg of legs) {
        const snapshot = response.snapshots.get(leg.optionSymbol);
        if (snapshot === undefined) return { state: 'MISSING', quotes: [], underlying: null,
          observedAt: receivedAt, reasonCode: 'EXACT_CONTRACT_SNAPSHOT_MISSING' };
        const assessment = quoteQuality({ bid: snapshot.bid, ask: snapshot.ask,
          providerTimestamp: snapshot.quoteTimestamp, receivedAt,
          maximumResearchQuoteAgeSeconds: this.options.maximumResearchQuoteAgeSeconds });
        if (assessment.quality !== 'GOOD') return {
          state: assessment.quality === 'INVALID' ? 'INVALID' : 'MISSING',
          quotes: [],
          underlying: null,
          observedAt: receivedAt,
          reasonCode: assessment.reasonCodes[0] ?? 'EXACT_CONTRACT_QUOTE_INCOMPLETE',
        };
        if (snapshot.quoteTimestamp !== null) {
          const quoteTargetDelaySeconds = (Date.parse(snapshot.quoteTimestamp) - targetAtMs) / 1_000;
          if (!Number.isFinite(quoteTargetDelaySeconds) || quoteTargetDelaySeconds < 0) return {
            state: 'MISSING', quotes: [], underlying: null, observedAt: receivedAt,
            reasonCode: 'EXACT_CONTRACT_QUOTE_PRE_TARGET',
          };
          if (quoteTargetDelaySeconds > this.options.maximumTargetDelaySeconds) return {
            state: 'MISSING', quotes: [], underlying: null, observedAt: receivedAt,
            reasonCode: 'EXACT_CONTRACT_QUOTE_TARGET_WINDOW_EXPIRED',
          };
        }
        quotesBySymbol.set(leg.optionSymbol, {
          optionSymbol: leg.optionSymbol,
          bid: snapshot.bid,
          ask: snapshot.ask,
          providerTimestamp: snapshot.quoteTimestamp,
          receivedAt,
          impliedVolatility: snapshot.impliedVolatility,
          delta: snapshot.greeks?.delta ?? null,
          gamma: snapshot.greeks?.gamma ?? null,
          theta: snapshot.greeks?.theta ?? null,
          vega: snapshot.greeks?.vega ?? null,
          provider: 'ALPACA',
          feed: this.options.optionFeed === 'opra' ? 'OPRA' : 'INDICATIVE',
          quality: assessment.quality,
          reasonCodes: assessment.reasonCodes,
        });
      }
    }
    const quotes = input.subject.episode.legs.map((leg) => quotesBySymbol.get(leg.optionSymbol))
      .filter((quote): quote is ContractPathQuoteObservation => quote !== undefined);
    if (quotes.length !== input.subject.episode.legs.length) return {
      state: 'INVALID', quotes: [], underlying: null, observedAt: new Date().toISOString(),
      reasonCode: 'EXACT_CONTRACT_QUOTE_COVERAGE_INVALID',
    };
    const trade = await fetchLatestStockTrade(this.alpaca, input.subject.underlying, this.options.stockFeed);
    const observedAt = new Date().toISOString();
    if (trade.price === null) return { state: 'MISSING', quotes: [], underlying: null,
      observedAt, reasonCode: 'UNDERLYING_TRADE_PRICE_MISSING' };
    if (trade.timestamp === null) return { state: 'MISSING', quotes: [], underlying: null,
      observedAt, reasonCode: 'UNDERLYING_TRADE_TIMESTAMP_MISSING' };
    const underlyingAgeSeconds = (Date.parse(observedAt) - Date.parse(trade.timestamp)) / 1_000;
    if (!Number.isFinite(underlyingAgeSeconds) || underlyingAgeSeconds < 0) {
      return { state: 'INVALID', quotes: [], underlying: null,
        observedAt, reasonCode: 'UNDERLYING_TRADE_TIMESTAMP_INVALID' };
    }
    if (underlyingAgeSeconds > this.options.maximumResearchQuoteAgeSeconds) {
      return { state: 'MISSING', quotes: [], underlying: null,
        observedAt, reasonCode: 'UNDERLYING_TRADE_STALE' };
    }
    const underlyingTargetDelaySeconds = (Date.parse(trade.timestamp) - targetAtMs) / 1_000;
    if (!Number.isFinite(underlyingTargetDelaySeconds) || underlyingTargetDelaySeconds < 0) {
      return { state: 'MISSING', quotes: [], underlying: null,
        observedAt, reasonCode: 'UNDERLYING_TRADE_PRE_TARGET' };
    }
    if (underlyingTargetDelaySeconds > this.options.maximumTargetDelaySeconds) {
      return { state: 'MISSING', quotes: [], underlying: null,
        observedAt, reasonCode: 'UNDERLYING_TRADE_TARGET_WINDOW_EXPIRED' };
    }
    return {
      state: 'READY',
      quotes,
      underlying: {
        symbol: input.subject.underlying,
        price: trade.price,
        providerTimestamp: trade.timestamp,
        receivedAt: observedAt,
        provider: 'ALPACA',
        purpose: 'RESEARCH_REFERENCE_ONLY',
      },
      observedAt,
      reasonCode: null,
    };
    } catch (error) {
      return { state: error instanceof AlpacaProviderError && error.errorClass === 'MALFORMED_RESPONSE' ? 'INVALID' : 'MISSING',
        quotes: [], underlying: null, observedAt: new Date().toISOString(), reasonCode: providerFailureReason(error) };
    }
  }
}
