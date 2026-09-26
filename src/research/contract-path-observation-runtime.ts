import { createHash } from 'node:crypto';
import { canonicalJson } from './point-in-time-evidence.js';
import type { StrategyLearningHorizonCode } from './strategy-learning-horizon.js';

export const contractPathObservationRuntimeVersion = 'theta-contract-path-observation-runtime-v1' as const;

export type ObservationJobState =
  | 'PENDING' | 'DUE' | 'IN_PROGRESS' | 'OBSERVED' | 'MISSED' | 'DEFERRED_PROVIDER'
  | 'DEFERRED_MARKET' | 'INVALIDATED' | 'CENSORED' | 'TERMINAL';
export type ExecutionTruthClass = 'MARKET_OBSERVED' | 'MODELED_RESEARCH' | 'BROKER_ACTUAL';

export interface ContractPathLegIdentity {
  readonly optionSymbol: string;
  readonly side: 'LONG' | 'SHORT';
  readonly optionType: 'PUT' | 'CALL';
  readonly expiration: string;
  readonly strike: number;
  readonly multiplier: number;
}

export interface ContractPathQuoteObservation {
  readonly optionSymbol: string;
  readonly bid: number | null;
  readonly ask: number | null;
  readonly providerTimestamp: string | null;
  readonly receivedAt: string;
  readonly impliedVolatility: number | null;
  readonly delta: number | null;
  readonly gamma: number | null;
  readonly theta: number | null;
  readonly vega: number | null;
  readonly provider: 'ALPACA';
  readonly feed: 'OPRA' | 'INDICATIVE';
  readonly quality: 'GOOD' | 'PARTIAL' | 'STALE' | 'INVALID';
  readonly reasonCodes: readonly string[];
}

export interface ContractPathObservationReceipt {
  readonly contractVersion: typeof contractPathObservationRuntimeVersion;
  readonly observationId: string;
  readonly observationJobId: string;
  readonly subjectId: string;
  readonly checkpoint: StrategyLearningHorizonCode;
  readonly targetAt: string;
  readonly actualObservedAt: string;
  readonly delaySeconds: number;
  readonly jobState: 'OBSERVED';
  readonly executionTruthClass: 'MARKET_OBSERVED';
  readonly legs: readonly ContractPathQuoteObservation[];
  readonly underlying: {
    readonly symbol: string;
    readonly price: number | null;
    readonly providerTimestamp: string | null;
    readonly receivedAt: string;
    readonly provider: 'ALPACA';
    readonly purpose: 'RESEARCH_REFERENCE_ONLY';
  };
  readonly marketMarkOnly: true;
  readonly hypotheticalFill: false;
  readonly brokerFill: false;
  readonly modeledExecutionPnl: null;
  readonly brokerActualPnl: null;
  readonly sourceSha: string;
  readonly workerSha: string;
  readonly contentHash: string;
  readonly brokerAuthority: false;
}

const SHA = /^[0-9a-f]{40}$/;
const SUBJECT = /^[0-9a-f]{64}$/;
const finiteOrNull = (value: number | null): boolean => value === null || Number.isFinite(value);

function validTimestamp(value: string | null): boolean {
  return value === null || Number.isFinite(Date.parse(value));
}

function validateLegIdentity(leg: ContractPathLegIdentity): void {
  if (leg.optionSymbol.trim() === '' || !Number.isFinite(leg.strike) || leg.strike <= 0
    || !Number.isFinite(leg.multiplier) || leg.multiplier <= 0 || !Number.isInteger(leg.multiplier)) {
    throw new Error('CONTRACT_PATH_LEG_IDENTITY_INVALID');
  }
}

function validateQuote(quote: ContractPathQuoteObservation, actualObservedAtMs: number): void {
  if (quote.optionSymbol.trim() === '' || !validTimestamp(quote.providerTimestamp)
    || !validTimestamp(quote.receivedAt)) throw new Error('CONTRACT_PATH_QUOTE_INVALID');
  const receivedAtMs = Date.parse(quote.receivedAt);
  if (receivedAtMs > actualObservedAtMs || (quote.providerTimestamp !== null
    && Date.parse(quote.providerTimestamp) > receivedAtMs)) throw new Error('CONTRACT_PATH_QUOTE_TIME_TRAVEL');
  for (const value of [quote.bid, quote.ask, quote.impliedVolatility, quote.delta, quote.gamma, quote.theta, quote.vega]) {
    if (!finiteOrNull(value)) throw new Error('CONTRACT_PATH_QUOTE_NUMERIC_INVALID');
  }
  if (quote.bid !== null && quote.bid < 0 || quote.ask !== null && quote.ask < 0) {
    throw new Error('CONTRACT_PATH_QUOTE_PRICE_INVALID');
  }
  if (quote.bid !== null && quote.ask !== null && quote.bid > quote.ask) {
    throw new Error('CONTRACT_PATH_QUOTE_CROSSED');
  }
}

/**
 * Freezes a factual future market observation. A quote can never become a
 * hypothetical fill or a realized P&L receipt through this boundary.
 */
export function buildContractPathObservationReceipt(input: {
  readonly observationJobId: string;
  readonly subjectId: string;
  readonly checkpoint: StrategyLearningHorizonCode;
  readonly targetAt: string;
  readonly actualObservedAt: string;
  readonly expectedLegs: readonly ContractPathLegIdentity[];
  readonly quotes: readonly ContractPathQuoteObservation[];
  readonly underlying: ContractPathObservationReceipt['underlying'];
  readonly sourceSha: string;
  readonly workerSha: string;
}): ContractPathObservationReceipt {
  if (input.observationJobId.trim() === '' || !SUBJECT.test(input.subjectId)
    || !SHA.test(input.sourceSha) || !SHA.test(input.workerSha)) throw new Error('CONTRACT_PATH_IDENTITY_INVALID');
  const targetAtMs = Date.parse(input.targetAt), actualObservedAtMs = Date.parse(input.actualObservedAt);
  if (!Number.isFinite(targetAtMs) || !Number.isFinite(actualObservedAtMs) || actualObservedAtMs < targetAtMs) {
    throw new Error('CONTRACT_PATH_OBSERVATION_TIME_INVALID');
  }
  if (input.expectedLegs.length === 0 || input.quotes.length !== input.expectedLegs.length) {
    throw new Error('CONTRACT_PATH_LEG_COVERAGE_INVALID');
  }
  input.expectedLegs.forEach(validateLegIdentity);
  input.quotes.forEach((quote) => validateQuote(quote, actualObservedAtMs));
  const expectedSymbols = input.expectedLegs.map((leg) => leg.optionSymbol);
  const observedSymbols = input.quotes.map((quote) => quote.optionSymbol);
  if (new Set(expectedSymbols).size !== expectedSymbols.length
    || new Set(observedSymbols).size !== observedSymbols.length
    || expectedSymbols.some((symbol, index) => observedSymbols[index] !== symbol)) {
    throw new Error('CONTRACT_PATH_EXACT_LEG_IDENTITY_MISMATCH');
  }
  if (input.underlying.symbol.trim() === '' || !finiteOrNull(input.underlying.price)
    || !validTimestamp(input.underlying.providerTimestamp) || !validTimestamp(input.underlying.receivedAt)
    || Date.parse(input.underlying.receivedAt) > actualObservedAtMs
    || (input.underlying.providerTimestamp !== null
      && Date.parse(input.underlying.providerTimestamp) > Date.parse(input.underlying.receivedAt))) {
    throw new Error('CONTRACT_PATH_UNDERLYING_OBSERVATION_INVALID');
  }
  const withoutHash = {
    contractVersion: contractPathObservationRuntimeVersion,
    observationJobId: input.observationJobId, subjectId: input.subjectId, checkpoint: input.checkpoint,
    targetAt: new Date(targetAtMs).toISOString(), actualObservedAt: new Date(actualObservedAtMs).toISOString(),
    delaySeconds: Math.floor((actualObservedAtMs - targetAtMs) / 1000), jobState: 'OBSERVED' as const,
    executionTruthClass: 'MARKET_OBSERVED' as const, legs: input.quotes,
    underlying: input.underlying, marketMarkOnly: true as const, hypotheticalFill: false as const,
    brokerFill: false as const, modeledExecutionPnl: null, brokerActualPnl: null,
    sourceSha: input.sourceSha, workerSha: input.workerSha, brokerAuthority: false as const,
  };
  const contentHash = createHash('sha256').update(canonicalJson(withoutHash)).digest('hex');
  return {
    ...withoutHash,
    observationId: createHash('sha256').update(`${input.observationJobId}:${contentHash}`).digest('hex'),
    contentHash,
  };
}

export function classifyObservationDeferral(input: {
  readonly providerAvailable: boolean;
  readonly marketSessionOpen: boolean | null;
}): 'DUE' | 'DEFERRED_PROVIDER' | 'DEFERRED_MARKET' {
  if (!input.providerAvailable) return 'DEFERRED_PROVIDER';
  if (input.marketSessionOpen !== true) return 'DEFERRED_MARKET';
  return 'DUE';
}
