import { normalizeOptionContract, type NormalizedOptionContract, type OptionType } from './option-contract.js';

// R1B production ingestion module: merges Alpaca (broker/execution truth --
// contracts, bid/ask, tradability) with Optionomics (supplementary
// features -- Greeks/OI/volume when Alpaca's own entitlement lacks them)
// into the canonical NormalizedOptionContract shape, WITH per-feature
// provenance (never a single top-level `source` implying every field came
// from one vendor).
//
// This module performs NO network I/O -- it is a pure transformation over
// already-fetched provider payloads, so it is fully testable without live
// credentials. The caller (a scheduler job, a CLI script, /ops) is
// responsible for the actual fetch() calls; this module never assumes a
// specific fetch client or endpoint shape beyond the minimal fields listed
// below, which is exactly what this session's real read-only proof against
// this environment's Alpaca PAPER + Optionomics accounts observed those two
// providers' actual response shapes to contain.
//
// Alpaca remains the ONLY source ever used for bid/ask/executability --
// Optionomics's own bid/ask fields (if present) are never substituted for
// an Alpaca executable quote, per this repo's non-negotiable "Alpaca is
// broker/execution truth" rule. Optionomics is consulted only as a
// fallback for Greeks/OI/volume when Alpaca's own snapshot omits them.

export interface AlpacaOptionContractListing {
  readonly symbol: string;
  readonly strikePrice: number;
  readonly expirationDate: string; // YYYY-MM-DD
  readonly optionType: OptionType;
}

export interface AlpacaOptionSnapshot {
  readonly bid: number | null;
  readonly ask: number | null;
  readonly bidSize: number | null;
  readonly askSize: number | null;
  readonly quoteTimestamp: string | null;
  readonly greeks: {
    readonly delta: number | null;
    readonly gamma: number | null;
    readonly theta: number | null;
    readonly vega: number | null;
    readonly rho: number | null;
  } | null;
  readonly impliedVolatility: number | null;
  readonly dailyVolume: number | null;
}

export interface OptionomicsChainEntry {
  readonly symbol: string;
  readonly delta: number | null;
  readonly gamma: number | null;
  readonly theta: number | null;
  readonly vega: number | null;
  readonly rho: number | null;
  readonly impliedVolatility: number | null;
  readonly volume: number | null;
  readonly openInterest: number | null;
}

export interface MergeOptionChainInput {
  readonly underlying: string;
  readonly asOfDate: string; // YYYY-MM-DD
  readonly contracts: readonly AlpacaOptionContractListing[];
  readonly snapshotsBySymbol: ReadonlyMap<string, AlpacaOptionSnapshot>;
  readonly optionomicsBySymbol: ReadonlyMap<string, OptionomicsChainEntry>;
  readonly requestedFeed: 'OPRA' | 'INDICATIVE';
  readonly multiplier: number; // standard contracts are 100; caller confirms via contractIsStandard upstream
  readonly receivedAt: string;
  readonly maxQuoteAgeSecondsForExecutable: number;
  readonly maxSpreadPctForExecutable: number;
}

/**
 * Merges one underlying's real Alpaca contract listing + option snapshot +
 * (optional) Optionomics chain entry into canonical NormalizedOptionContract
 * rows, one per contract. Greeks/volume/openInterest each independently
 * prefer Alpaca's own snapshot when present, falling back to Optionomics
 * only when Alpaca's own value for that specific feature is absent --
 * never the reverse, and never a blend of the two for the same feature.
 * A contract with no snapshot entry at all still produces a row (bid/ask/
 * Greeks/volume/OI all UNKNOWN, non-executable) -- never silently dropped.
 */
export function mergeOptionChain(input: MergeOptionChainInput): readonly NormalizedOptionContract[] {
  return input.contracts.map((contract) => {
    const snapshot = input.snapshotsBySymbol.get(contract.symbol) ?? null;
    const optionomics = input.optionomicsBySymbol.get(contract.symbol) ?? null;

    const alpacaGreeksKnown = snapshot?.greeks !== null && snapshot?.greeks !== undefined && snapshot.greeks.delta !== null;
    const greeksSource: 'ALPACA' | 'OPTIONOMICS' | null = alpacaGreeksKnown
      ? 'ALPACA'
      : optionomics !== null && optionomics.delta !== null
        ? 'OPTIONOMICS'
        : null;
    const greek = (field: 'delta' | 'gamma' | 'theta' | 'vega' | 'rho'): number | null =>
      greeksSource === 'ALPACA' ? (snapshot?.greeks?.[field] ?? null) : greeksSource === 'OPTIONOMICS' ? (optionomics?.[field] ?? null) : null;
    const iv = greeksSource === 'ALPACA' ? (snapshot?.impliedVolatility ?? null) : greeksSource === 'OPTIONOMICS' ? (optionomics?.impliedVolatility ?? null) : null;

    const alpacaVolumeKnown = snapshot?.dailyVolume !== null && snapshot?.dailyVolume !== undefined;
    const volumeSource: 'ALPACA' | 'OPTIONOMICS' | null = alpacaVolumeKnown
      ? 'ALPACA'
      : optionomics !== null && optionomics.volume !== null
        ? 'OPTIONOMICS'
        : null;
    const volume = volumeSource === 'ALPACA' ? (snapshot?.dailyVolume ?? null) : volumeSource === 'OPTIONOMICS' ? (optionomics?.volume ?? null) : null;

    // Alpaca's option-chain/snapshot endpoints do not guarantee open
    // interest (confirmed by this session's real read-only proof); this
    // module has no Alpaca OI field to prefer, so OI is sourced from
    // Optionomics whenever it supplies one, else UNKNOWN -- never zero.
    const openInterestSource: 'ALPACA' | 'OPTIONOMICS' | null = optionomics !== null && optionomics.openInterest !== null ? 'OPTIONOMICS' : null;
    const openInterest = openInterestSource === 'OPTIONOMICS' ? (optionomics?.openInterest ?? null) : null;

    return normalizeOptionContract(
      {
        source: 'ALPACA', // bid/ask/executability are always Alpaca's -- broker/execution truth
        underlying: input.underlying,
        optionSymbol: contract.symbol,
        occSymbol: contract.symbol,
        optionType: contract.optionType,
        strike: contract.strikePrice,
        expiration: contract.expirationDate,
        asOfDate: input.asOfDate,
        multiplier: input.multiplier,
        underlyingBid: null, underlyingAsk: null, underlyingLast: null, underlyingTimestamp: null,
        bid: snapshot?.bid ?? null, ask: snapshot?.ask ?? null, bidSize: snapshot?.bidSize ?? null, askSize: snapshot?.askSize ?? null,
        lastTradePrice: null, lastTradeSize: null,
        quoteTimestamp: snapshot?.quoteTimestamp ?? null, tradeTimestamp: null,
        volume, volumeSource,
        openInterest, openInterestSource,
        iv, delta: greek('delta'), gamma: greek('gamma'), theta: greek('theta'), vega: greek('vega'), rho: greek('rho'),
        greeksTimestamp: greeksSource !== null ? input.receivedAt : null,
        greeksSource,
        feed: input.requestedFeed,
        dataQuality: snapshot !== null ? 'GOOD' : 'UNKNOWN',
        maxQuoteAgeSecondsForExecutable: input.maxQuoteAgeSecondsForExecutable,
        maxSpreadPctForExecutable: input.maxSpreadPctForExecutable,
      },
      input.receivedAt,
    );
  });
}
