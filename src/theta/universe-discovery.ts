import { AlpacaProviderError, fetchOptionContracts, fetchStockBars, fetchTradableAssets, type AlpacaProviderConfig } from './alpaca-provider.js';
import type { HistoricalBar } from './underlying-history.js';
import type { UnderlyingCandidateInput } from './universe-policy.js';

// R1 real-state integration: replaces THETA's hardcoded single-underlying
// production universe with a genuine, staged, cost-bounded discovery
// pipeline over real Alpaca data. This module answers "which underlyings
// are even worth a UniversePolicy evaluation this cycle" -- it does NOT
// replace UniversePolicy itself (universe-policy.ts's evaluateUniverse/
// rankEligibleUnderlyings remain the pure, tested narrowing/ranking logic;
// this module only PRODUCES the real UnderlyingCandidateInput[] that feeds
// it, instead of a caller-supplied fixture).
//
// Staged, cost-bounded funnel (never one expensive scan of everything):
//   Stage 0: fetchTradableAssets -- real tradable US-equity registry,
//            bounded by maxCandidateAssets (Alpaca's /v2/assets is not
//            paginated; this is a real client-side safety cap, not a
//            claim that the platform-wide market is fully covered).
//   Stage 1: batched fetchStockBars -- real recent price/dollar-volume,
//            batched (barsBatchSize symbols per request) so a bounded
//            asset list costs a bounded, small number of HTTP calls, not
//            one call per symbol.
//   Stage 2: real option-contract-EXISTENCE confirmation (limit=1) for
//            only the top-liquidity subset (maxOptionabilityChecks) --
//            NOT a full chain enumeration. This is the cheapest real way
//            to answer "does this underlying have any listed options at
//            all" without assuming every tradable US equity is optionable.
// Only symbols that survive Stage 2 become UnderlyingCandidateInput
// records; UniversePolicy's own (pure, already-tested) stages run after
// this, unchanged.
//
// KNOWN GAP (documented, not silently assumed): ownershipAcceptable and
// accountCollateralFeasible are reported UNKNOWN (null) here -- this
// module has no ownership model or account-state access, by design (that
// evaluation belongs to ownership-contract.py / account-exposure.ts, which
// run downstream). Corporate-action and event absence are not established by
// assets, bars, or option-contract existence. Both flags are UNKNOWN (null)
// here until a prospective, coverage-qualified event producer is wired.

export interface UniverseDiscoveryConfig {
  readonly discoveryVersion: string;
  readonly maxCandidateAssets: number; // Stage 0 hard bound -- versioned research parameter
  readonly allowedExchanges: readonly string[] | null; // null = no exchange prefilter
  readonly barsLookbackDays: number;
  readonly barsBatchSize: number; // symbols per Stage 1 bars request
  readonly maxOptionabilityChecks: number; // how many top-liquidity symbols get a real Stage 2 confirmation
  readonly minCurrentPrice: number; // structurally required for meaningful CSP economics -- same floor UniversePolicy itself enforces
}

export interface UniverseDiscoveryFunnel {
  readonly assetsDiscovered: number;
  readonly assetsTruncatedByBound: boolean; // fetchTradableAssets' own complete=false
  readonly assetsAfterExchangeFilter: number;
  readonly assetsWithUsableBars: number;
  readonly optionabilityChecksAttempted: number;
  readonly optionableConfirmed: number;
  readonly candidatesProduced: number;
  /** Observation only. These stages do not change eligibility or broker authority. */
  readonly stageDiagnostics?: readonly UniverseDiscoveryStageDiagnostic[];
}

export interface UniverseDiscoveryStageDiagnostic {
  readonly stage: 'SOURCE_ASSETS' | 'EXCHANGE_FILTER' | 'STOCK_BARS' | 'OPTIONABILITY';
  readonly inputCount: number;
  readonly outputCount: number;
  readonly rejectedCount: number;
  readonly durationMs: number;
  readonly providerState: 'READY' | 'VALID_EMPTY' | 'PARTIAL' | 'INVALID_REQUEST' | 'INVALID_AUTH' | 'PROVIDER_ERROR' | 'PROVIDER_LIMITED' | 'SCHEMA_INVALID';
  readonly reasonCounts: Readonly<Record<string, number>>;
}

export interface UniverseDiscoveryResult {
  readonly candidates: readonly UnderlyingCandidateInput[];
  readonly candidatesOrigin: 'REAL_PROVIDER' | 'REAL_PROVIDER_UNKNOWN' | 'REAL_PROVIDER_ERROR';
  readonly funnel: UniverseDiscoveryFunnel;
  readonly blockers: readonly string[];
}

function averageDollarVolumeAndCurrentPrice(bars: readonly HistoricalBar[]): { avgDollarVolume: number | null; currentPrice: number | null } {
  if (bars.length === 0) return { avgDollarVolume: null, currentPrice: null };
  const sorted = [...bars].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const totalDollarVolume = sorted.reduce((sum, bar) => sum + bar.close * bar.volume, 0);
  return {
    avgDollarVolume: totalDollarVolume / sorted.length,
    currentPrice: sorted[sorted.length - 1]?.close ?? null,
  };
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

function providerFailureState(error: unknown): UniverseDiscoveryStageDiagnostic['providerState'] {
  return error instanceof AlpacaProviderError && error.errorClass === 'INVALID_AUTH' ? 'INVALID_AUTH'
    : error instanceof AlpacaProviderError && error.errorClass === 'INVALID_REQUEST' ? 'INVALID_REQUEST'
    : error instanceof AlpacaProviderError && error.errorClass === 'MALFORMED_RESPONSE' ? 'SCHEMA_INVALID'
    : error instanceof AlpacaProviderError && error.errorClass === 'NOT_ENTITLED' ? 'PROVIDER_LIMITED'
      : 'PROVIDER_ERROR';
}

/**
 * Discovers a real, bounded set of UnderlyingCandidateInput records from
 * live Alpaca data -- the honest replacement for a hardcoded production
 * universe. Never throws: every provider failure is recorded in `blockers`
 * and the function returns whatever it could genuinely determine (an
 * empty candidate list on total failure, never a fabricated fallback).
 */
export async function discoverRealUniverse(
  alpaca: AlpacaProviderConfig,
  config: UniverseDiscoveryConfig,
  now: () => string,
): Promise<UniverseDiscoveryResult> {
  const blockers: string[] = [];
  const receivedAt = now();
  const decisionMillis = Date.parse(receivedAt);
  if (!Number.isFinite(decisionMillis)) return {
    candidates: [], candidatesOrigin: 'REAL_PROVIDER_ERROR',
    funnel: { assetsDiscovered: 0, assetsTruncatedByBound: false, assetsAfterExchangeFilter: 0,
      assetsWithUsableBars: 0, optionabilityChecksAttempted: 0, optionableConfirmed: 0, candidatesProduced: 0 },
    blockers: ['UNIVERSE_DECISION_CLOCK_INVALID'],
  };

  let assetsDiscovered = 0;
  let assetsTruncatedByBound = false;
  let filteredSymbols: string[] = [];
  let exchangeFilterDurationMs = 0;
  const stageDiagnostics: UniverseDiscoveryStageDiagnostic[] = [];
  const assetsStarted = performance.now();
  try {
    const assetsResult = await fetchTradableAssets(alpaca, config.maxCandidateAssets);
    assetsDiscovered = assetsResult.assets.length;
    assetsTruncatedByBound = !assetsResult.complete;
    const filterStarted = performance.now();
    filteredSymbols = assetsResult.assets
      .filter((a) => config.allowedExchanges === null || (a.exchange !== null && config.allowedExchanges.includes(a.exchange)))
      .map((a) => a.symbol)
      .filter((symbol) => symbol.length > 0);
    exchangeFilterDurationMs = Math.max(0, Math.round(performance.now() - filterStarted));
  } catch (error) {
    blockers.push(`UNIVERSE_ASSETS_FETCH_FAILED:${error instanceof Error ? error.message : 'unknown'}`);
    stageDiagnostics.push({ stage: 'SOURCE_ASSETS', inputCount: 0, outputCount: 0, rejectedCount: 0,
      durationMs: Math.max(0, Math.round(performance.now() - assetsStarted)),
      providerState: providerFailureState(error), reasonCounts: {
        [error instanceof AlpacaProviderError ? `ASSET_${error.errorClass}` : 'ASSET_PROVIDER_ERROR']: 1,
      } });
    return {
      candidates: [], candidatesOrigin: 'REAL_PROVIDER_ERROR',
      funnel: { assetsDiscovered: 0, assetsTruncatedByBound: false, assetsAfterExchangeFilter: 0, assetsWithUsableBars: 0, optionabilityChecksAttempted: 0, optionableConfirmed: 0, candidatesProduced: 0, stageDiagnostics },
      blockers,
    };
  }
  const assetsAfterExchangeFilter = filteredSymbols.length;
  stageDiagnostics.push({ stage: 'SOURCE_ASSETS', inputCount: assetsDiscovered, outputCount: assetsDiscovered,
    rejectedCount: 0, durationMs: Math.max(0, Math.round(performance.now() - assetsStarted)),
    providerState: assetsTruncatedByBound ? 'PARTIAL' : assetsDiscovered === 0 ? 'VALID_EMPTY' : 'READY',
    reasonCounts: assetsTruncatedByBound ? { CLIENT_ASSET_BOUND_REACHED: 1 } : {} });
  stageDiagnostics.push({ stage: 'EXCHANGE_FILTER', inputCount: assetsDiscovered, outputCount: assetsAfterExchangeFilter,
    rejectedCount: assetsDiscovered - assetsAfterExchangeFilter, durationMs: exchangeFilterDurationMs,
    providerState: assetsAfterExchangeFilter === 0 ? 'VALID_EMPTY' : 'READY',
    reasonCounts: assetsDiscovered === assetsAfterExchangeFilter ? {} : { EXCHANGE_NOT_ALLOWED_OR_UNKNOWN: assetsDiscovered - assetsAfterExchangeFilter } });

  const barsEnd = receivedAt;
  const barsStart = new Date(decisionMillis - config.barsLookbackDays * 86_400_000).toISOString();
  const priceBySymbol = new Map<string, { avgDollarVolume: number; currentPrice: number }>();
  const barsStarted = performance.now();
  let failedBarsBatches = 0;
  let incompleteBarsBatches = 0;
  let failedBarSymbolCount = 0;
  let noBarSymbolCount = 0;
  let paginationUnobservedSymbolCount = 0;
  let priceBelowFloorCount = 0;
  const barsFailureReasons: Record<string, number> = {};
  const barsFailureStates: UniverseDiscoveryStageDiagnostic['providerState'][] = [];
  const totalBarsBatches = Math.ceil(filteredSymbols.length / config.barsBatchSize);

  for (const batch of chunk(filteredSymbols, config.barsBatchSize)) {
    try {
      const barsResult = await fetchStockBars(
        alpaca,
        { symbols: batch, timeframe: '1Day', start: barsStart, end: barsEnd, feed: 'iex', maxPages: 5, adjustment: 'split' },
        receivedAt,
      );
      if (!barsResult.complete) incompleteBarsBatches += 1;
      const barsBySymbol = new Map<string, HistoricalBar[]>();
      for (const bar of barsResult.bars) {
        const list = barsBySymbol.get(bar.symbol) ?? [];
        list.push(bar);
        barsBySymbol.set(bar.symbol, list);
      }
      const symbolsWithoutBars = batch.filter((symbol) => !barsBySymbol.has(symbol)).length;
      if (barsResult.complete) noBarSymbolCount += symbolsWithoutBars;
      else paginationUnobservedSymbolCount += symbolsWithoutBars;
      for (const [symbol, bars] of barsBySymbol) {
        const { avgDollarVolume, currentPrice } = averageDollarVolumeAndCurrentPrice(bars);
        if (avgDollarVolume !== null && currentPrice !== null && currentPrice >= config.minCurrentPrice) {
          priceBySymbol.set(symbol, { avgDollarVolume, currentPrice });
        } else if (batch.includes(symbol)) {
          priceBelowFloorCount += 1;
        }
      }
    } catch (error) {
      failedBarsBatches += 1;
      failedBarSymbolCount += batch.length;
      const reason = error instanceof AlpacaProviderError
        ? `BARS_${error.safeDetailCode?.replace(/^ALPACA_BARS_/, '') ?? error.errorClass}` : 'BARS_PROVIDER_ERROR';
      barsFailureReasons[reason] = (barsFailureReasons[reason] ?? 0) + 1;
      barsFailureStates.push(providerFailureState(error));
      blockers.push(`UNIVERSE_BARS_BATCH_FAILED:${error instanceof Error ? error.message : 'unknown'}`);
      // A failed batch loses only that batch's symbols -- never the whole
      // discovery run; other batches' real data is still usable.
    }
  }
  const assetsWithUsableBars = priceBySymbol.size;
  stageDiagnostics.push({ stage: 'STOCK_BARS', inputCount: assetsAfterExchangeFilter, outputCount: assetsWithUsableBars,
    rejectedCount: assetsAfterExchangeFilter - assetsWithUsableBars,
    durationMs: Math.max(0, Math.round(performance.now() - barsStarted)),
    providerState: totalBarsBatches > 0 && failedBarsBatches === totalBarsBatches
      ? barsFailureStates.every((state) => state === barsFailureStates[0]) ? barsFailureStates[0] as UniverseDiscoveryStageDiagnostic['providerState'] : 'PROVIDER_ERROR'
      : failedBarsBatches > 0 || incompleteBarsBatches > 0 ? 'PARTIAL'
      : assetsWithUsableBars === 0 ? 'VALID_EMPTY' : 'READY',
    reasonCounts: { ...barsFailureReasons,
      ...(failedBarSymbolCount > 0 ? { BARS_UNOBSERVED_PROVIDER_FAILURE: failedBarSymbolCount } : {}),
      ...(incompleteBarsBatches > 0 ? { BARS_PAGINATION_INCOMPLETE: incompleteBarsBatches } : {}),
      ...(paginationUnobservedSymbolCount > 0 ? { BARS_UNOBSERVED_PAGINATION_INCOMPLETE: paginationUnobservedSymbolCount } : {}),
      ...(noBarSymbolCount > 0 ? { NO_BARS_RETURNED: noBarSymbolCount } : {}),
      ...(priceBelowFloorCount > 0 ? { PRICE_BELOW_FLOOR: priceBelowFloorCount } : {}) } });

  const shortlistForOptionabilityCheck = [...priceBySymbol.entries()]
    .sort((a, b) => b[1].avgDollarVolume - a[1].avgDollarVolume)
    .slice(0, config.maxOptionabilityChecks)
    .map(([symbol]) => symbol);

  const optionExpirationGte = new Date(decisionMillis + 1 * 86_400_000).toISOString().slice(0, 10);
  const optionExpirationLte = new Date(decisionMillis + 400 * 86_400_000).toISOString().slice(0, 10);

  // Keep provider fan-out bounded even when research observes a wider
  // universe. Two concurrent existence checks preserve the previous live
  // call pressure while allowing a 5/10-symbol challenger to accumulate
  // over multiple cycles.
  const optionabilityResults: Array<{symbol:string;optionable:boolean}>=[];
  const optionabilityStarted = performance.now();
  let optionabilityErrors = 0;
  const optionabilityFailureReasons: Record<string, number> = {};
  const optionabilityFailureStates: UniverseDiscoveryStageDiagnostic['providerState'][] = [];
  for(const batch of chunk(shortlistForOptionabilityCheck,2)){
    optionabilityResults.push(...await Promise.all(batch.map(async (symbol) => {
      try {
        const result = await fetchOptionContracts(alpaca, {
          underlyingSymbol: symbol, expirationDateGte: optionExpirationGte, expirationDateLte: optionExpirationLte,
          optionType: 'put', limit: 1, maxPages: 1,
        });
        return { symbol, optionable: result.items.length > 0 };
      } catch (error) {
        optionabilityErrors += 1;
        const reason = error instanceof AlpacaProviderError ? `CONTRACT_${error.errorClass}` : 'CONTRACT_PROVIDER_ERROR';
        optionabilityFailureReasons[reason] = (optionabilityFailureReasons[reason] ?? 0) + 1;
        optionabilityFailureStates.push(providerFailureState(error));
        blockers.push(`UNIVERSE_OPTIONABILITY_CHECK_FAILED:${symbol}:${error instanceof Error ? error.message : 'unknown'}`);
        return { symbol, optionable: false }; // NOT confirmed optionable -- excluded, never guessed in
      }
    })));
  }

  const candidates: UnderlyingCandidateInput[] = [];
  for (const { symbol, optionable } of optionabilityResults) {
    if (!optionable) continue;
    const price = priceBySymbol.get(symbol);
    if (price === undefined) continue; // cannot happen (symbol came from priceBySymbol), but never assume
    candidates.push({
      symbol, tradable: true, optionEnabled: true, assetDataValid: true,
      avgDollarVolume: price.avgDollarVolume, currentPrice: price.currentPrice, hasUsableOptionChain: true,
      accountCollateralFeasible: null, // UNKNOWN here -- account-state evaluation happens downstream
      ownershipAcceptable: null, // UNKNOWN here -- ownership model evaluation happens downstream
      unsupportedCorporateActionPending: null,
      eventNear: null,
    });
  }

  const optionableConfirmed = optionabilityResults.filter((r) => r.optionable).length;
  stageDiagnostics.push({ stage: 'OPTIONABILITY', inputCount: shortlistForOptionabilityCheck.length,
    outputCount: optionableConfirmed, rejectedCount: shortlistForOptionabilityCheck.length - optionableConfirmed,
    durationMs: Math.max(0, Math.round(performance.now() - optionabilityStarted)),
    providerState: optionabilityErrors > 0 ? optionabilityErrors === shortlistForOptionabilityCheck.length
      ? optionabilityFailureStates.every((state) => state === optionabilityFailureStates[0])
        ? optionabilityFailureStates[0] as UniverseDiscoveryStageDiagnostic['providerState'] : 'PROVIDER_ERROR'
      : 'PARTIAL'
      : shortlistForOptionabilityCheck.length === 0 && (failedBarsBatches > 0 || incompleteBarsBatches > 0) ? 'PARTIAL'
        : optionableConfirmed === 0 ? 'VALID_EMPTY' : 'READY',
    reasonCounts: { ...optionabilityFailureReasons,
      ...(shortlistForOptionabilityCheck.length === 0 && (failedBarsBatches > 0 || incompleteBarsBatches > 0)
        ? { UPSTREAM_BARS_COVERAGE_INCOMPLETE: 1 } : {}),
      ...(shortlistForOptionabilityCheck.length - optionableConfirmed - optionabilityErrors > 0
        ? { NO_LISTED_PUT_FOUND: shortlistForOptionabilityCheck.length - optionableConfirmed - optionabilityErrors } : {}) } });

  return {
    candidates,
    candidatesOrigin: candidates.length > 0 ? 'REAL_PROVIDER'
      : (totalBarsBatches > 0 && failedBarsBatches === totalBarsBatches)
        || (shortlistForOptionabilityCheck.length > 0 && optionabilityErrors === shortlistForOptionabilityCheck.length)
        ? 'REAL_PROVIDER_ERROR' : 'REAL_PROVIDER_UNKNOWN',
    funnel: {
      assetsDiscovered, assetsTruncatedByBound, assetsAfterExchangeFilter, assetsWithUsableBars,
      optionabilityChecksAttempted: shortlistForOptionabilityCheck.length, optionableConfirmed,
      candidatesProduced: candidates.length, stageDiagnostics,
    },
    blockers,
  };
}
