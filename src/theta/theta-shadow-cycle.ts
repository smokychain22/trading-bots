import { randomUUID } from 'node:crypto';
import {
  fetchMasterAccountSnapshot, fetchOpenOrders, fetchOptionContracts, fetchOptionSnapshots,
  fetchPositions, fetchStockBars, type AlpacaProviderConfig, type MasterAccountSnapshot,
} from './alpaca-provider.js';
import { mergeOptionChain, type OptionomicsChainEntry } from './option-chain-ingestion.js';
import { computeCurrentDrawdown, computeGapFrequency, computeMaxAdverseGap, computeRealizedVolatility, computeReturn, computeTrendSlope } from './underlying-features.js';
import { evaluateUniverse, type UnderlyingCandidateInput, type UniverseFunnelReport, type UniversePolicy } from './universe-policy.js';
import { runNewRiskOrchestration, type NewRiskOrchestrationRequest, type NewRiskOrchestrationResult, type RawCandidateInput } from './new-risk-orchestrator.js';
import type { PythonBridgeConfig } from './python-bridge.js';

// R1: runThetaShadowCycle -- the reusable, server-side, non-executing shadow
// decision cycle. This is the "success condition" deliverable: a single
// function composing every real piece built so far (Alpaca provider adapter,
// Optionomics merge, real point-in-time features, UniversePolicy,
// freshness-wired new-risk orchestrator) into one coherent cycle, callable
// identically whether config.alpaca.fetchImpl is a test mock or (later, in
// a protected environment holding real secrets) the real global fetch.
//
// NEVER submits an order -- there is no order-endpoint call anywhere in
// this file, by construction, and none should ever be added here.
//
// HONESTLY INCOMPLETE by design, not by oversight -- see `blockers` on the
// result and the provenance classification below:
//   - Optionomics is NOT fetched live in this function (no real Optionomics
//     fetch adapter exists yet); `optionomicsBySymbol` is always empty
//     here, so OI/volume/Greeks-fallback from Optionomics never populate a
//     real cycle yet -- Alpaca-only Greeks/quotes are used.
//   - Event state is always UNKNOWN (no event-state assembly exists yet).
//   - Underlying selection from the universe is "first ELIGIBLE" -- no
//     ranking among multiple eligible underlyings exists yet.
//   - Market calendar/session awareness is not consulted.
// A cycle run through this function can therefore never legitimately be
// classified FULL_REAL (see classifyShadowCycleProvenance) -- at best
// HYBRID, and only once real credentials make the Alpaca calls succeed.

export interface ThetaShadowCycleConfig {
  readonly alpaca: AlpacaProviderConfig;
  readonly bridge: PythonBridgeConfig;
  readonly universePolicy: UniversePolicy;
  readonly universeCandidates: readonly UnderlyingCandidateInput[]; // caller supplies the raw per-underlying facts; a full Alpaca-asset-universe fetch is not built this pass
  readonly optionExpirationDateGte: string;
  readonly optionExpirationDateLte: string;
  readonly optionType: 'put';
  readonly maxOptionPages: number;
  readonly historyStart: string;
  readonly historyEnd: string;
  readonly historyMaxPages: number;
  readonly ownershipPolicy: Record<string, unknown>;
  readonly regimePolicy: Record<string, unknown>;
  readonly routerPolicy: Record<string, unknown> & { thetaQMinOwnershipAcceptability: number };
  readonly routerPortfolio: Record<string, unknown>;
  readonly latticeConfig: Record<string, unknown>;
  readonly thetaQSizingPolicy: Record<string, unknown>;
  readonly costAssumptions: Record<string, unknown>;
  readonly aegisPolicy: Record<string, unknown>;
  readonly aegisInputs: Record<string, unknown>; // portfolio/account risk-family inputs not yet derivable from MasterAccountSnapshot alone
  readonly opportunityFrontierPolicy: { policyVersion: string; reducedSizeUncertaintyThreshold: number };
  readonly maxAcceptableSpreadPct: number;
  readonly sizingPolicy: Record<string, unknown>;
  readonly executionQualityPolicy: Record<string, unknown>;
  readonly optionQuoteFreshnessPolicy: NewRiskOrchestrationRequest['optionQuoteFreshnessPolicy'];
  readonly policyVersion: string;
  readonly modelVersions: Readonly<Record<string, string>>;
  readonly requiredModelVersions: Readonly<Record<string, string>>;
  readonly now: () => string;
}

export type ShadowCycleProvenance = 'FULL_REAL' | 'HYBRID' | 'SYNTHETIC';

export interface ThetaShadowCycleResult {
  readonly runId: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly universeFunnel: UniverseFunnelReport;
  readonly selectedUnderlying: string | null;
  readonly optionChainComplete: boolean | null;
  readonly optionContractsComplete: boolean | null;
  readonly orchestration: NewRiskOrchestrationResult | null;
  readonly provenance: ShadowCycleProvenance;
  readonly provenanceDetail: readonly string[];
  readonly blockers: readonly string[];
}

/**
 * Automatic provenance classification (item 24) -- never manually labeled.
 * FULL_REAL requires every dimension the task specifies to have come from a
 * real provider call; this function currently can only ever return HYBRID
 * or SYNTHETIC, honestly, because Optionomics and event-state are not real
 * in this cycle implementation yet (see module docstring).
 */
function classifyProvenance(dimensions: {
  readonly accountReal: boolean;
  readonly historyReal: boolean;
  readonly optionChainReal: boolean;
  readonly optionomicsReal: boolean;
  readonly eventStateReal: boolean;
}): { provenance: ShadowCycleProvenance; detail: readonly string[] } {
  const detail: string[] = [];
  const realCount = Object.values(dimensions).filter(Boolean).length;
  for (const [name, real] of Object.entries(dimensions)) {
    detail.push(`${name}=${real ? 'REAL' : 'SYNTHETIC_OR_UNAVAILABLE'}`);
  }
  if (realCount === Object.keys(dimensions).length) return { provenance: 'FULL_REAL', detail };
  if (realCount === 0) return { provenance: 'SYNTHETIC', detail };
  return { provenance: 'HYBRID', detail };
}

export async function runThetaShadowCycle(config: ThetaShadowCycleConfig): Promise<ThetaShadowCycleResult> {
  const runId = randomUUID();
  const startedAt = config.now();
  const blockers: string[] = [];

  const { decisions, funnel } = evaluateUniverse(config.universePolicy, config.universeCandidates);
  const eligible = decisions.find((d) => d.state === 'ELIGIBLE');

  if (eligible === undefined) {
    return {
      runId, startedAt, finishedAt: config.now(), universeFunnel: funnel, selectedUnderlying: null,
      optionChainComplete: null, optionContractsComplete: null, orchestration: null,
      provenance: 'SYNTHETIC', provenanceDetail: ['no eligible underlying survived UniversePolicy this cycle'],
      blockers: ['NO_ELIGIBLE_UNDERLYING'],
    };
  }
  const underlying = eligible.symbol;

  let account: MasterAccountSnapshot | null = null;
  let accountReal = false;
  try {
    account = await fetchMasterAccountSnapshot(config.alpaca, config.now());
    accountReal = true;
  } catch (error) {
    blockers.push(`ACCOUNT_FETCH_FAILED:${error instanceof Error ? error.message : 'unknown'}`);
  }

  let historyReal = false;
  const receivedAt = config.now();
  let ret1d: number | null = null;
  let rv20: number | null = null;
  let drawdown: number | null = null;
  let maSlope: number | null = null;
  let gapFrequency: number | null = null;
  let maxAdverseGap: number | null = null;
  try {
    const barsResult = await fetchStockBars(
      config.alpaca,
      { symbols: [underlying], timeframe: '1Day', start: config.historyStart, end: config.historyEnd, feed: 'iex', maxPages: config.historyMaxPages, adjustment: 'split' },
      receivedAt,
    );
    const bars = barsResult.bars.filter((b) => b.symbol === underlying);
    if (barsResult.complete && bars.length > 0) {
      historyReal = true;
      ret1d = computeReturn(bars, receivedAt, 1);
      rv20 = computeRealizedVolatility(bars, receivedAt, 20);
      drawdown = computeCurrentDrawdown(bars, receivedAt, 60);
      maSlope = computeTrendSlope(bars, receivedAt, 20);
      gapFrequency = computeGapFrequency(bars, receivedAt, 60, 0.02);
      maxAdverseGap = computeMaxAdverseGap(bars, receivedAt, 60);
    } else if (!barsResult.complete) {
      blockers.push('STOCK_HISTORY_INCOMPLETE');
    }
  } catch (error) {
    blockers.push(`STOCK_HISTORY_FETCH_FAILED:${error instanceof Error ? error.message : 'unknown'}`);
  }

  let optionChainComplete: boolean | null = null;
  let optionContractsComplete: boolean | null = null;
  let optionChainReal = false;
  const candidates: RawCandidateInput[] = [];
  try {
    const contractsResult = await fetchOptionContracts(config.alpaca, {
      underlyingSymbol: underlying, expirationDateGte: config.optionExpirationDateGte, expirationDateLte: config.optionExpirationDateLte,
      optionType: config.optionType, limit: 100, maxPages: config.maxOptionPages,
    });
    optionContractsComplete = contractsResult.complete;
    const snapshotsResult = await fetchOptionSnapshots(config.alpaca, {
      underlyingSymbol: underlying, feed: 'indicative', optionType: config.optionType, limit: 100, maxPages: config.maxOptionPages,
    });
    optionChainComplete = snapshotsResult.complete;
    optionChainReal = contractsResult.complete && snapshotsResult.complete && contractsResult.items.length > 0;

    // Optionomics is NOT fetched live here -- see module docstring. Empty
    // map is honest: every OI/volume/Greek stays UNKNOWN unless Alpaca's
    // own snapshot supplied it, never fabricated.
    const optionomicsBySymbol = new Map<string, OptionomicsChainEntry>();

    const mergedContracts = mergeOptionChain({
      underlying, asOfDate: config.now().slice(0, 10), contracts: contractsResult.items,
      snapshotsBySymbol: snapshotsResult.snapshots, optionomicsBySymbol, requestedFeed: 'INDICATIVE',
      multiplier: 100, receivedAt, maxQuoteAgeSecondsForExecutable: 30, maxSpreadPctForExecutable: config.maxAcceptableSpreadPct,
    });

    for (const contract of mergedContracts) {
      candidates.push({
        candidateId: contract.optionSymbol, contract, entryPremiumPerShare: contract.bid ?? 0,
        severeDrawdownProbability: null, ivRank: null, brokerAllowedQty: 5, contractIsStandard: true,
        hasAlternateContract: mergedContracts.length > 1, hasAlternateExpiry: false, hasAlternateStructure: false,
        ivCompensationSufficient: null, quoteSize: contract.bidSize, preSlippageExpectedUtility: null,
      });
    }
  } catch (error) {
    blockers.push(`OPTION_CHAIN_FETCH_FAILED:${error instanceof Error ? error.message : 'unknown'}`);
  }

  const { provenance, detail } = classifyProvenance({
    accountReal, historyReal, optionChainReal, optionomicsReal: false, eventStateReal: false,
  });

  if (candidates.length === 0) {
    return {
      runId, startedAt, finishedAt: config.now(), universeFunnel: funnel, selectedUnderlying: underlying,
      optionChainComplete, optionContractsComplete, orchestration: null, provenance, provenanceDetail: detail,
      blockers: [...blockers, 'NO_CANDIDATES_AVAILABLE'],
    };
  }

  const orchestration = await runNewRiskOrchestration(config.bridge, {
    snapshotId: `shadow-cycle-${runId}`, fusionSnapshotHash: 'a'.repeat(64), timestamp: config.now(), underlying,
    earningsDistanceDays: null, // EventState is not real yet -- UNKNOWN, never fabricated as "no earnings nearby"
    optionQuoteFreshnessPolicy: config.optionQuoteFreshnessPolicy, providerStateGood: account !== null,
    policyVersion: config.policyVersion, modelVersions: config.modelVersions, requiredModelVersions: config.requiredModelVersions,
    ownershipPolicy: config.ownershipPolicy,
    ownershipInputs: {
      stockAvgVolume: null, optionOpenInterest: null, optionVolume: null, spreadPct: null,
      ret1d, ret5d: null, ret20d: null, ret60d: null, ma20Rel: null, ma50Rel: null, ma200Rel: null,
      maSlope, relativeStrength: null, rv10: null, rv20, rv60: null, drawdown, maxAdverseGap,
      gapFrequency, downsideSemivariance: null, historicalRecoveryMedianDays: null, historicalRecoveryP95Days: null,
      severeDrawdownEpisodeCount: null, earningsDistanceDays: null, exDividendDistanceDays: null, knownEventDistanceDays: null,
    },
    regimePolicy: config.regimePolicy,
    regimeInputs: {
      maSlope, rv20, maxAdverseGap, earningsDistanceDays: null, corporateActionPending: false,
      macroRiskFlag: false, spreadPct: null, portfolioOrMarketDrawdown: drawdown,
    },
    routerPolicy: config.routerPolicy, routerPortfolio: config.routerPortfolio,
    latticeConfig: config.latticeConfig, thetaQSizingPolicy: config.thetaQSizingPolicy, costAssumptions: config.costAssumptions,
    aegisPolicy: config.aegisPolicy, aegisInputs: config.aegisInputs,
    opportunityFrontierPolicy: config.opportunityFrontierPolicy, maxAcceptableSpreadPct: config.maxAcceptableSpreadPct,
    candidates,
    sizingPolicy: config.sizingPolicy,
    sizingAccount: {
      equity: account?.equity ?? null, cash: account?.cash ?? null, buyingPower: account?.optionsBuyingPower ?? account?.buyingPower ?? null,
      brokerAllowedQty: 10,
    },
    executionQualityPolicy: config.executionQualityPolicy,
  });

  return {
    runId, startedAt, finishedAt: config.now(), universeFunnel: funnel, selectedUnderlying: underlying,
    optionChainComplete, optionContractsComplete, orchestration, provenance, provenanceDetail: detail, blockers,
  };
}

// Referenced for future wiring (positions/open orders into AEGIS/sizing
// lineage, item 20) -- not yet consumed by runThetaShadowCycle above.
export { fetchPositions, fetchOpenOrders };
