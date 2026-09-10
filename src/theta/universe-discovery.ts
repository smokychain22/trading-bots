import { fetchOptionContracts, fetchStockBars, fetchTradableAssets, type AlpacaProviderConfig } from './alpaca-provider.js';
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
// run downstream). unsupportedCorporateActionPending and eventNear are
// reported false -- ABSENCE OF CONFIRMED EVIDENCE, not proof of absence --
// because no real corporate-action/event-state source is wired into this
// cheap discovery stage yet (real event-state assembly is a separate,
// still-UNKNOWN-by-default concern elsewhere in the cycle). This is a
// known limitation, not a claim of certainty.

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

  let assetsDiscovered = 0;
  let assetsTruncatedByBound = false;
  let filteredSymbols: string[] = [];
  try {
    const assetsResult = await fetchTradableAssets(alpaca, config.maxCandidateAssets);
    assetsDiscovered = assetsResult.assets.length;
    assetsTruncatedByBound = !assetsResult.complete;
    filteredSymbols = assetsResult.assets
      .filter((a) => config.allowedExchanges === null || (a.exchange !== null && config.allowedExchanges.includes(a.exchange)))
      .map((a) => a.symbol)
      .filter((symbol) => symbol.length > 0);
  } catch (error) {
    blockers.push(`UNIVERSE_ASSETS_FETCH_FAILED:${error instanceof Error ? error.message : 'unknown'}`);
    return {
      candidates: [], candidatesOrigin: 'REAL_PROVIDER_ERROR',
      funnel: { assetsDiscovered: 0, assetsTruncatedByBound: false, assetsAfterExchangeFilter: 0, assetsWithUsableBars: 0, optionabilityChecksAttempted: 0, optionableConfirmed: 0, candidatesProduced: 0 },
      blockers,
    };
  }
  const assetsAfterExchangeFilter = filteredSymbols.length;

  const receivedAt = now();
  const barsEnd = receivedAt;
  const barsStart = new Date(new Date(receivedAt).getTime() - config.barsLookbackDays * 86_400_000).toISOString();
  const priceBySymbol = new Map<string, { avgDollarVolume: number; currentPrice: number }>();

  for (const batch of chunk(filteredSymbols, config.barsBatchSize)) {
    try {
      const barsResult = await fetchStockBars(
        alpaca,
        { symbols: batch, timeframe: '1Day', start: barsStart, end: barsEnd, feed: 'iex', maxPages: 5, adjustment: 'split' },
        receivedAt,
      );
      const barsBySymbol = new Map<string, HistoricalBar[]>();
      for (const bar of barsResult.bars) {
        const list = barsBySymbol.get(bar.symbol) ?? [];
        list.push(bar);
        barsBySymbol.set(bar.symbol, list);
      }
      for (const [symbol, bars] of barsBySymbol) {
        const { avgDollarVolume, currentPrice } = averageDollarVolumeAndCurrentPrice(bars);
        if (avgDollarVolume !== null && currentPrice !== null && currentPrice >= config.minCurrentPrice) {
          priceBySymbol.set(symbol, { avgDollarVolume, currentPrice });
        }
      }
    } catch (error) {
      blockers.push(`UNIVERSE_BARS_BATCH_FAILED:${error instanceof Error ? error.message : 'unknown'}`);
      // A failed batch loses only that batch's symbols -- never the whole
      // discovery run; other batches' real data is still usable.
    }
  }
  const assetsWithUsableBars = priceBySymbol.size;

  const shortlistForOptionabilityCheck = [...priceBySymbol.entries()]
    .sort((a, b) => b[1].avgDollarVolume - a[1].avgDollarVolume)
    .slice(0, config.maxOptionabilityChecks)
    .map(([symbol]) => symbol);

  const optionExpirationGte = new Date(Date.now() + 1 * 86_400_000).toISOString().slice(0, 10);
  const optionExpirationLte = new Date(Date.now() + 400 * 86_400_000).toISOString().slice(0, 10);

  const optionabilityResults = await Promise.all(shortlistForOptionabilityCheck.map(async (symbol) => {
    try {
      const result = await fetchOptionContracts(alpaca, {
        underlyingSymbol: symbol, expirationDateGte: optionExpirationGte, expirationDateLte: optionExpirationLte,
        optionType: 'put', limit: 1, maxPages: 1,
      });
      return { symbol, optionable: result.items.length > 0 };
    } catch (error) {
      blockers.push(`UNIVERSE_OPTIONABILITY_CHECK_FAILED:${symbol}:${error instanceof Error ? error.message : 'unknown'}`);
      return { symbol, optionable: false }; // NOT confirmed optionable -- excluded, never guessed in
    }
  }));

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
      unsupportedCorporateActionPending: false, // absence of confirmed evidence, not proof of absence -- see module docstring
      eventNear: false, // same caveat
    });
  }

  const optionableConfirmed = optionabilityResults.filter((r) => r.optionable).length;

  return {
    candidates,
    candidatesOrigin: candidates.length > 0 ? 'REAL_PROVIDER' : 'REAL_PROVIDER_UNKNOWN',
    funnel: {
      assetsDiscovered, assetsTruncatedByBound, assetsAfterExchangeFilter, assetsWithUsableBars,
      optionabilityChecksAttempted: shortlistForOptionabilityCheck.length, optionableConfirmed,
      candidatesProduced: candidates.length,
    },
    blockers,
  };
}
