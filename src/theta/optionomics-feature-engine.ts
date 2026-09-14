import { createHash } from 'node:crypto';
import type {
  NormalizedOptionomicsChain,
  NormalizedOptionomicsEntry,
  NormalizedOptionomicsFlowWindow,
} from './optionomics-provider.js';

export const optionomicsFeatureSchemaVersion = 'theta-optionomics-features-v1' as const;

export type FeatureState = 'KNOWN' | 'UNKNOWN' | 'INVALID';

export interface FeatureValue<T> {
  readonly value: T | null;
  readonly state: FeatureState;
  readonly reason: string | null;
}

export interface OptionomicsContractFeatureState {
  readonly contractSymbol: string | null;
  readonly identity: {
    readonly underlying: string | null;
    readonly expiration: string | null;
    readonly optionType: 'CALL' | 'PUT' | null;
    readonly strike: number | null;
  };
  readonly quote: {
    readonly bid: FeatureValue<number>;
    readonly ask: FeatureValue<number>;
    readonly bidSize: FeatureValue<number>;
    readonly askSize: FeatureValue<number>;
    readonly providerTimestamp: FeatureValue<string>;
    readonly semantics: 'SESSION_RECORDED_RESEARCH';
    readonly executable: false;
  };
  readonly greeks: Readonly<Record<'delta' | 'gamma' | 'theta' | 'vega' | 'rho', FeatureValue<number>>>;
  readonly volatility: {
    readonly impliedVolatility: FeatureValue<number>;
    readonly units: 'DECIMAL' | 'UNKNOWN';
    readonly rawValue: number | null;
  };
  readonly marketStructure: Readonly<Record<'gammaDollar' | 'deltaExposure' | 'gammaExposure' | 'notionalOpenInterest', FeatureValue<number>>>;
  readonly liquidity: Readonly<Record<'openInterest' | 'volume', FeatureValue<number>>>;
  readonly structuralEconomics: {
    readonly intrinsicPerShare: FeatureValue<number>;
    readonly extrinsicPerShare: FeatureValue<number>;
    readonly cspBreakeven: FeatureValue<number>;
    readonly securedCollateral: FeatureValue<number>;
    readonly grossBidPremiumCash: FeatureValue<number>;
  };
}

export interface OptionomicsFeatureSnapshot {
  readonly schemaVersion: typeof optionomicsFeatureSchemaVersion;
  readonly provider: 'OPTIONOMICS';
  readonly underlying: string;
  readonly observedAt: string;
  readonly responseHash: string;
  readonly contracts: readonly OptionomicsContractFeatureState[];
  readonly skew: FeatureValue<number>;
  readonly termStructure: FeatureValue<number>;
  readonly volatilitySurface: FeatureValue<Readonly<Record<string, number>>>;
  readonly flow: {
    readonly windows: readonly NormalizedOptionomicsFlowWindow[];
    readonly interpretation: 'UNMODELED_RESEARCH_CONTEXT';
  };
  readonly unavailableFamilies: readonly string[];
  readonly empiricalEvReady: false;
}

const known = <T>(value: T): FeatureValue<T> => ({ value, state: 'KNOWN', reason: null });
const unknown = <T>(reason: string): FeatureValue<T> => ({ value: null, state: 'UNKNOWN', reason });
const invalid = <T>(reason: string): FeatureValue<T> => ({ value: null, state: 'INVALID', reason });

function finite(value: number | null, reason: string): FeatureValue<number> {
  if (value === null) return unknown(reason);
  return Number.isFinite(value) ? known(value) : invalid('NON_FINITE_PROVIDER_VALUE');
}

function positive(value: number | null, reason: string): FeatureValue<number> {
  const parsed = finite(value, reason);
  if (parsed.state !== 'KNOWN') return parsed;
  return (parsed.value as number) >= 0 ? parsed : invalid('NEGATIVE_VALUE_INVALID_FOR_FIELD');
}

function timestamp(value: string | null): FeatureValue<string> {
  if (value === null) return unknown('PROVIDER_TIMESTAMP_ABSENT');
  return Number.isFinite(Date.parse(value)) ? known(new Date(value).toISOString()) : invalid('PROVIDER_TIMESTAMP_INVALID');
}

function structuralEconomics(entry: NormalizedOptionomicsEntry, stockPrice: number | null, multiplier: number | null) {
  if (stockPrice === null || !Number.isFinite(stockPrice) || stockPrice <= 0 || entry.strike === null || entry.optionType === null) {
    const reason = stockPrice === null ? 'UNDERLYING_PRICE_UNKNOWN' : 'CONTRACT_IDENTITY_INCOMPLETE';
    return {
      intrinsicPerShare: unknown<number>(reason), extrinsicPerShare: unknown<number>(reason),
      cspBreakeven: unknown<number>(reason), securedCollateral: unknown<number>(reason), grossBidPremiumCash: unknown<number>(reason),
    };
  }
  const intrinsic = entry.optionType === 'PUT'
    ? Math.max(entry.strike - stockPrice, 0)
    : Math.max(stockPrice - entry.strike, 0);
  const mark = entry.price ?? (entry.bid !== null && entry.ask !== null ? (entry.bid + entry.ask) / 2 : null);
  const extrinsic = mark === null ? unknown<number>('OPTION_MARK_UNKNOWN') : known(Math.max(mark - intrinsic, 0));
  const validMultiplier = multiplier !== null && Number.isFinite(multiplier) && multiplier > 0;
  const isPut = entry.optionType === 'PUT';
  return {
    intrinsicPerShare: known(intrinsic), extrinsicPerShare: extrinsic,
    cspBreakeven: isPut && entry.bid !== null ? known(entry.strike - entry.bid) : unknown<number>(isPut ? 'BID_UNKNOWN' : 'NOT_A_CSP'),
    securedCollateral: isPut && validMultiplier ? known(entry.strike * multiplier) : unknown<number>(isPut ? 'CONTRACT_MULTIPLIER_UNKNOWN' : 'NOT_A_CSP'),
    grossBidPremiumCash: entry.bid !== null && validMultiplier ? known(entry.bid * multiplier) : unknown<number>(entry.bid === null ? 'BID_UNKNOWN' : 'CONTRACT_MULTIPLIER_UNKNOWN'),
  };
}

function contractFeatures(entry: NormalizedOptionomicsEntry, stockPrice: number | null, multiplier: number | null): OptionomicsContractFeatureState {
  return {
    contractSymbol: entry.rawSymbol,
    identity: { underlying: entry.underlying, expiration: entry.expiration, optionType: entry.optionType, strike: entry.strike },
    quote: {
      bid: positive(entry.bid, 'BID_UNKNOWN'), ask: positive(entry.ask, 'ASK_UNKNOWN'),
      bidSize: positive(entry.bidSize, 'BID_SIZE_UNKNOWN'), askSize: positive(entry.askSize, 'ASK_SIZE_UNKNOWN'),
      providerTimestamp: timestamp(entry.asOf), semantics: entry.quoteSemantics, executable: false,
    },
    greeks: {
      delta: finite(entry.delta, 'DELTA_UNKNOWN'), gamma: finite(entry.gamma, 'GAMMA_UNKNOWN'),
      theta: finite(entry.theta, 'THETA_UNKNOWN'), vega: finite(entry.vega, 'VEGA_UNKNOWN'), rho: finite(entry.rho, 'RHO_UNKNOWN'),
    },
    volatility: { impliedVolatility: finite(entry.impliedVolatility, 'IV_UNKNOWN_OR_UNITS_UNVERIFIED'), units: entry.impliedVolatilityUnits, rawValue: entry.impliedVolatilityRaw },
    marketStructure: {
      gammaDollar: finite(entry.gammaDollar, 'GAMMA_DOLLAR_UNKNOWN'), deltaExposure: finite(entry.deltaExposure, 'DEX_UNKNOWN'),
      gammaExposure: finite(entry.gammaExposure, 'GEX_UNKNOWN'), notionalOpenInterest: positive(entry.notionalOpenInterest, 'NOTIONAL_OI_UNKNOWN'),
    },
    liquidity: { openInterest: positive(entry.openInterest, 'OPEN_INTEREST_UNKNOWN'), volume: positive(entry.volume, 'VOLUME_UNKNOWN') },
    structuralEconomics: structuralEconomics(entry, stockPrice, multiplier),
  };
}

function deriveSkew(entries: readonly NormalizedOptionomicsEntry[]): FeatureValue<number> {
  const put25 = entries.filter((entry) => entry.optionType === 'PUT' && entry.delta !== null && entry.impliedVolatility !== null)
    .toSorted((a, b) => Math.abs(Math.abs(a.delta as number) - 0.25) - Math.abs(Math.abs(b.delta as number) - 0.25))[0];
  const call25 = entries.filter((entry) => entry.optionType === 'CALL' && entry.delta !== null && entry.impliedVolatility !== null)
    .toSorted((a, b) => Math.abs(Math.abs(a.delta as number) - 0.25) - Math.abs(Math.abs(b.delta as number) - 0.25))[0];
  if (put25?.impliedVolatility === null || put25?.impliedVolatility === undefined || call25?.impliedVolatility === null || call25?.impliedVolatility === undefined) {
    return unknown('PUT_CALL_25_DELTA_IV_PAIR_UNAVAILABLE');
  }
  return known(put25.impliedVolatility - call25.impliedVolatility);
}

function deriveTerm(entries: readonly NormalizedOptionomicsEntry[]): FeatureValue<number> {
  const byExpiration = new Map<string, number[]>();
  for (const entry of entries) {
    if (entry.expiration === null || entry.impliedVolatility === null) continue;
    const values = byExpiration.get(entry.expiration) ?? [];
    values.push(entry.impliedVolatility);
    byExpiration.set(entry.expiration, values);
  }
  const points = [...byExpiration].map(([expiration, values]) => ({ expiration, iv: values.reduce((a, b) => a + b, 0) / values.length }))
    .toSorted((a, b) => a.expiration.localeCompare(b.expiration));
  if (points.length < 2) return unknown('TWO_EXPIRATIONS_WITH_IV_REQUIRED');
  const first = points[0];
  const last = points.at(-1);
  if (first === undefined || last === undefined) return unknown('TWO_EXPIRATIONS_WITH_IV_REQUIRED');
  return known(last.iv - first.iv);
}

function deriveSurface(entries: readonly NormalizedOptionomicsEntry[]): FeatureValue<Readonly<Record<string, number>>> {
  const points = entries.filter((entry) => entry.expiration !== null && entry.strike !== null && entry.impliedVolatility !== null);
  if (points.length < 3) return unknown('AT_LEAST_THREE_IV_SURFACE_POINTS_REQUIRED');
  return known(Object.fromEntries(points.map((entry) => [`${entry.expiration}:${entry.optionType}:${entry.strike}`, entry.impliedVolatility as number])));
}

export function buildOptionomicsFeatureSnapshot(input: {
  readonly chain: NormalizedOptionomicsChain;
  readonly flowWindows: readonly NormalizedOptionomicsFlowWindow[];
  readonly stockPrice: number | null;
  readonly multiplierByContract?: ReadonlyMap<string, number>;
}): OptionomicsFeatureSnapshot {
  const contracts = input.chain.entries.map((entry) => contractFeatures(
    entry, input.stockPrice, entry.rawSymbol === null ? null : input.multiplierByContract?.get(entry.rawSymbol) ?? null,
  ));
  const unavailableFamilies = [
    input.chain.entries.some((entry) => entry.impliedVolatility !== null) ? null : 'IV',
    input.flowWindows.length > 0 ? null : 'FLOW',
    'IV_RANK', 'IV_PERCENTILE', 'VANNA', 'CHARM', 'DARK_POOL', 'EVENTS',
  ].filter((value): value is string => value !== null);
  return {
    schemaVersion: optionomicsFeatureSchemaVersion, provider: 'OPTIONOMICS', underlying: input.chain.underlying,
    observedAt: input.chain.retrievedAt, responseHash: input.chain.responseHash,
    contracts, skew: deriveSkew(input.chain.entries), termStructure: deriveTerm(input.chain.entries),
    volatilitySurface: deriveSurface(input.chain.entries),
    flow: { windows: input.flowWindows, interpretation: 'UNMODELED_RESEARCH_CONTEXT' },
    unavailableFamilies, empiricalEvReady: false,
  };
}

export function hashOptionomicsRawPayload(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}
