import { randomUUID } from 'node:crypto';
import {
  fetchMasterAccountSnapshot, fetchOpenOrders, fetchOptionContracts, fetchOptionSnapshots,
  fetchPositions, fetchStockBars, type AlpacaProviderConfig, type MasterAccountSnapshot,
} from './alpaca-provider.js';
import { mergeOptionChain, type OptionomicsChainEntry } from './option-chain-ingestion.js';
import { computeCurrentDrawdown, computeGapFrequency, computeMaxAdverseGap, computeRealizedVolatility, computeReturn, computeTrendSlope } from './underlying-features.js';
import { evaluateUniverse, rankEligibleUnderlyings, type RankedUnderlying, type UnderlyingCandidateInput, type UniverseFunnelReport, type UniversePolicy } from './universe-policy.js';
import { runNewRiskOrchestration, type NewRiskOrchestrationRequest, type NewRiskOrchestrationResult, type RawCandidateInput } from './new-risk-orchestrator.js';
import type { PythonBridgeConfig } from './python-bridge.js';
import { buildFusionSnapshot, hashJson, type FusionSnapshotInput, type JsonValue } from '../market/fusion-snapshot.js';

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
//   - Underlying selection ranks eligible underlyings transparently (see
//     universe-policy.ts's rankEligibleUnderlyings) rather than picking
//     input order, but v1's ranking feature (avgDollarVolume) is itself an
//     honest placeholder, not real economic ranking -- see that function's
//     own docstring.
//   - Market calendar/session awareness is not consulted.
// A cycle run through this function can therefore never legitimately be
// classified FULL_REAL (see classifyShadowCycleProvenance) -- at best
// HYBRID, and only once real credentials make the Alpaca calls succeed.

export interface ThetaShadowCycleConfig {
  readonly alpaca: AlpacaProviderConfig;
  readonly bridge: PythonBridgeConfig;
  readonly universePolicy: UniversePolicy;
  readonly universeCandidates: readonly UnderlyingCandidateInput[]; // caller supplies the raw per-underlying facts; a full Alpaca-asset-universe fetch is not built this pass
  readonly universeCandidatesOrigin: ProvenanceOrigin; // caller must honestly declare whether these facts came from a real asset-discovery call or a fixture/manual list -- drives automatic provenance, never guessed
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
  readonly aegisInputsOrigin: ProvenanceOrigin; // honest declaration -- today this is always CALLER_MANUAL since real position/order-derived exposure isn't wired yet
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
  readonly underlyingRanking: readonly RankedUnderlying[]; // full ranked-eligible list + why each rank -- selection is never "first in the input array"
  readonly optionChainComplete: boolean | null;
  readonly optionContractsComplete: boolean | null;
  readonly snapshotContentHash: string | null; // the REAL, deterministic FusionSnapshot content hash -- never a placeholder
  readonly snapshotValidForNewRisk: boolean | null;
  readonly orchestration: NewRiskOrchestrationResult | null;
  readonly provenance: ShadowCycleProvenance;
  readonly provenanceDetail: readonly string[];
  readonly blockers: readonly string[];
}

const evidenceStateFor = (real: boolean): 'GOOD' | 'UNKNOWN' => (real ? 'GOOD' : 'UNKNOWN');

/**
 * Assembles the canonical FusionSnapshotInput (src/market/fusion-snapshot.ts,
 * reused -- never duplicated) from the actual observations this cycle
 * gathered. The three Alpaca provenance entries (ACCOUNT/CONTRACT/QUOTE)
 * are ALWAYS present -- buildFusionSnapshot() requires their presence
 * structurally -- but their `state` honestly reflects whether that
 * specific fetch actually succeeded this cycle, never asserted GOOD when
 * it wasn't.
 */
function assembleFusionSnapshotInput(params: {
  readonly now: string;
  readonly underlying: string;
  readonly account: MasterAccountSnapshot | null;
  readonly accountReal: boolean;
  readonly contractsReal: boolean;
  readonly quotesReal: boolean;
  readonly mergedContracts: FusionSnapshotInput['contractCandidates'];
  readonly ownershipFeatures: JsonValue;
  readonly regimeFeatures: JsonValue;
  readonly policyVersion: string;
  readonly modelVersions: Readonly<Record<string, string>>;
}): FusionSnapshotInput {
  const accountJson: JsonValue = params.account === null ? { fetched: false } : { ...params.account };
  const contractsJson: JsonValue = params.mergedContracts as unknown as JsonValue;

  return {
    botId: 'THETA',
    decisionTimeUtc: params.now,
    triggerType: 'SHADOW_CYCLE',
    marketSession: null, // OPRA/options-aware calendar not wired yet -- UNKNOWN, never fabricated as "regular session"
    underlyingState: { symbol: params.underlying },
    contractCandidates: params.mergedContracts,
    accountState: accountJson,
    positionState: null, // positions not yet folded into the cycle's snapshot -- future work
    portfolioExposure: null,
    alpacaQuoteState: null,
    optionomicsFeatureState: null, // Optionomics is not fetched live in this cycle yet -- honestly absent, not fabricated
    eventState: null, // no event-state assembly exists yet -- UNKNOWN, never "no event nearby"
    regimeState: params.regimeFeatures,
    expertPriorState: null,
    riskState: null,
    strategyRouterState: null, // the router runs downstream of this snapshot in the current architecture
    versions: {
      strategyVersion: params.policyVersion, featureVersion: params.policyVersion, riskLimitVersion: params.policyVersion,
      executionVersion: params.policyVersion, costModelVersion: params.policyVersion, dataVersion: params.policyVersion,
      modelVersions: params.modelVersions,
    },
    sourceProvenance: [
      {
        provider: 'ALPACA', operationAlias: 'alpaca.get_account', asOf: params.accountReal ? params.now : null, retrievedAt: params.now,
        state: evidenceStateFor(params.accountReal), contentHash: hashJson(accountJson), feed: null,
        contractVersion: 'alpaca-account-v1', truthRole: 'ACCOUNT', requiredForNewRisk: true,
      },
      {
        provider: 'ALPACA', operationAlias: 'alpaca.get_option_contracts', asOf: params.contractsReal ? params.now : null, retrievedAt: params.now,
        state: evidenceStateFor(params.contractsReal), contentHash: hashJson(contractsJson), feed: null,
        contractVersion: 'alpaca-option-contracts-v1', truthRole: 'CONTRACT', requiredForNewRisk: true,
      },
      {
        provider: 'ALPACA', operationAlias: 'alpaca.get_option_snapshots', asOf: params.quotesReal ? params.now : null, retrievedAt: params.now,
        state: evidenceStateFor(params.quotesReal), contentHash: hashJson(contractsJson), feed: 'indicative',
        contractVersion: 'alpaca-option-snapshots-v1', truthRole: 'QUOTE', requiredForNewRisk: true,
      },
    ],
    providerHealth: [
      { provider: 'ALPACA', state: evidenceStateFor(params.accountReal && params.contractsReal && params.quotesReal), asOf: params.now, retrievedAt: params.now },
      { provider: 'OPTIONOMICS', state: 'UNKNOWN', asOf: null, retrievedAt: params.now },
    ],
    freshnessFlags: [],
    unknownFeatures: [
      { feature: 'optionOpenInterest', reasonCode: 'OPTIONOMICS_NOT_FETCHED', provider: null },
      { feature: 'optionVolume', reasonCode: 'OPTIONOMICS_NOT_FETCHED_ALPACA_DAILY_BAR_FALLBACK_ONLY', provider: null },
      { feature: 'eventState', reasonCode: 'EVENT_STATE_NOT_IMPLEMENTED', provider: null },
    ],
    executableTruth: {
      account: evidenceStateFor(params.accountReal),
      contract: evidenceStateFor(params.contractsReal),
      quote: evidenceStateFor(params.quotesReal),
    },
  };
}

// Provenance semantics correction (this session): FULL_REAL means "the
// required state came through the real runtime/provider CODE PATH" -- it
// does NOT mean "every field has a non-null value." A real provider query
// that genuinely returns no value for a field (e.g. Optionomics has no OI
// for a far-OTM contract) is still REAL provenance for that dimension --
// UNKNOWN is a valid real-world observation, not evidence of a fixture.
// What makes a dimension NOT real is that it was never queried at all, or
// that its value was supplied by the CALLER/config as a literal (a test
// fixture, a hardcoded synthetic account) rather than obtained by calling
// a provider function. This distinction is per-dimension origin, not a
// boolean "did we get a number back."
export type ProvenanceOrigin =
  | 'REAL_PROVIDER' // obtained by actually calling a real provider function this cycle, with a usable result
  | 'UNAVAILABLE_AFTER_REAL_QUERY' // a real provider function was actually called this cycle, but it (honestly) had nothing to report
  | 'SYNTHETIC_FIXTURE' // a test/development fixture value, never a real call
  | 'CALLER_MANUAL' // the caller supplied this directly in config (e.g. aegisInputs, universeCandidates) -- not fetched at all
  | 'NOT_ATTEMPTED'; // no code path for this dimension exists yet

const REAL_ORIGINS: ReadonlySet<ProvenanceOrigin> = new Set(['REAL_PROVIDER', 'UNAVAILABLE_AFTER_REAL_QUERY']);

/**
 * Automatic provenance classification -- never manually labeled. A run is
 * FULL_REAL only when every required dimension's ORIGIN is real (REAL_PROVIDER
 * or UNAVAILABLE_AFTER_REAL_QUERY -- both count, since UNKNOWN-after-a-real-
 * query is authentic reality, not a placeholder). SYNTHETIC only when every
 * dimension is non-real. Otherwise HYBRID. The classification is driven by
 * ORIGIN, never by whether the cycle happened to produce zero eligible
 * underlyings or any other RESULT -- a real scan legitimately finding
 * nothing is still real.
 */
function classifyProvenance(dimensions: Readonly<Record<string, ProvenanceOrigin>>): { provenance: ShadowCycleProvenance; detail: readonly string[] } {
  const detail: string[] = [];
  let realCount = 0;
  for (const [name, origin] of Object.entries(dimensions)) {
    detail.push(`${name}=${origin}`);
    if (REAL_ORIGINS.has(origin)) realCount += 1;
  }
  const total = Object.keys(dimensions).length;
  if (realCount === total) return { provenance: 'FULL_REAL', detail };
  if (realCount === 0) return { provenance: 'SYNTHETIC', detail };
  return { provenance: 'HYBRID', detail };
}

export async function runThetaShadowCycle(config: ThetaShadowCycleConfig): Promise<ThetaShadowCycleResult> {
  const runId = randomUUID();
  const startedAt = config.now();
  const blockers: string[] = [];

  const { decisions, funnel } = evaluateUniverse(config.universePolicy, config.universeCandidates);
  const inputsBySymbol = new Map(config.universeCandidates.map((c) => [c.symbol, c]));
  const ranked = rankEligibleUnderlyings(decisions, inputsBySymbol);
  const topRanked = ranked[0];

  if (topRanked === undefined) {
    // Provenance is classified from ORIGIN, never from this RESULT -- a
    // genuinely real universe scan that legitimately finds zero eligible
    // underlyings is still real; what actually makes this SYNTHETIC today
    // is that universe discovery itself is caller-supplied, not that the
    // scan came up empty (see classifyProvenance's own docstring).
    const { provenance: noUnderlyingProvenance, detail: noUnderlyingDetail } = classifyProvenance({
      universeCandidates: config.universeCandidatesOrigin,
    });
    return {
      runId, startedAt, finishedAt: config.now(), universeFunnel: funnel, selectedUnderlying: null, underlyingRanking: ranked,
      optionChainComplete: null, optionContractsComplete: null, snapshotContentHash: null, snapshotValidForNewRisk: null,
      orchestration: null,
      provenance: noUnderlyingProvenance, provenanceDetail: ['no eligible underlying survived UniversePolicy this cycle', ...noUnderlyingDetail],
      blockers: ['NO_ELIGIBLE_UNDERLYING'],
    };
  }
  const underlying = topRanked.symbol;

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
  let contractsReal = false;
  let quotesReal = false;
  const candidates: RawCandidateInput[] = [];
  let mergedContractsForSnapshot: ReturnType<typeof mergeOptionChain> = [];
  try {
    const contractsResult = await fetchOptionContracts(config.alpaca, {
      underlyingSymbol: underlying, expirationDateGte: config.optionExpirationDateGte, expirationDateLte: config.optionExpirationDateLte,
      optionType: config.optionType, limit: 100, maxPages: config.maxOptionPages,
    });
    optionContractsComplete = contractsResult.complete;
    contractsReal = contractsResult.complete;
    const snapshotsResult = await fetchOptionSnapshots(config.alpaca, {
      underlyingSymbol: underlying, feed: 'indicative', optionType: config.optionType, limit: 100, maxPages: config.maxOptionPages,
    });
    optionChainComplete = snapshotsResult.complete;
    quotesReal = snapshotsResult.complete;

    // Optionomics is NOT fetched live here -- see module docstring. Empty
    // map is honest: every OI/volume/Greek stays UNKNOWN unless Alpaca's
    // own snapshot supplied it, never fabricated.
    const optionomicsBySymbol = new Map<string, OptionomicsChainEntry>();

    const mergedContracts = mergeOptionChain({
      underlying, asOfDate: config.now().slice(0, 10), contracts: contractsResult.items,
      snapshotsBySymbol: snapshotsResult.snapshots, optionomicsBySymbol, requestedFeed: 'INDICATIVE',
      multiplier: 100, receivedAt, maxQuoteAgeSecondsForExecutable: 30, maxSpreadPctForExecutable: config.maxAcceptableSpreadPct,
    });
    mergedContractsForSnapshot = mergedContracts;

    for (const contract of mergedContracts) {
      if (contract.bid === null) {
        blockers.push(`CANDIDATE_BID_UNKNOWN:${contract.optionSymbol}`);
        continue;
      }
      candidates.push({
        candidateId: contract.optionSymbol, contract, entryPremiumPerShare: contract.bid,
        severeDrawdownProbability: null, ivRank: null, brokerAllowedQty: 5, contractIsStandard: true,
        hasAlternateContract: mergedContracts.length > 1, hasAlternateExpiry: false, hasAlternateStructure: false,
        ivCompensationSufficient: null, quoteSize: contract.bidSize, preSlippageExpectedUtility: null,
      });
    }
  } catch (error) {
    blockers.push(`OPTION_CHAIN_FETCH_FAILED:${error instanceof Error ? error.message : 'unknown'}`);
  }

  const { provenance, detail } = classifyProvenance({
    universeCandidates: config.universeCandidatesOrigin,
    account: accountReal ? 'REAL_PROVIDER' : 'UNAVAILABLE_AFTER_REAL_QUERY', // fetchMasterAccountSnapshot was always actually called this cycle -- a failure is still a real query attempt, never a fixture
    underlyingHistory: historyReal ? 'REAL_PROVIDER' : 'UNAVAILABLE_AFTER_REAL_QUERY',
    optionChain: (contractsReal && quotesReal) ? 'REAL_PROVIDER' : 'UNAVAILABLE_AFTER_REAL_QUERY',
    optionomics: 'NOT_ATTEMPTED', // no real Optionomics fetch adapter exists yet -- honestly not attempted, not a fixture
    eventState: 'NOT_ATTEMPTED', // no event-state assembly exists yet
    aegisInputs: config.aegisInputsOrigin,
  });

  // Canonical FusionSnapshot -- ALWAYS built, even on a no-candidates path,
  // so every returned run (successful or not) carries a genuine,
  // deterministic snapshot identity. NEVER a placeholder hash.
  const snapshotInput = assembleFusionSnapshotInput({
    now: config.now(), underlying, account, accountReal, contractsReal, quotesReal,
    mergedContracts: [...mergedContractsForSnapshot],
    ownershipFeatures: { ret1d, rv20, drawdown, maSlope, gapFrequency, maxAdverseGap } as unknown as JsonValue,
    regimeFeatures: { maSlope, rv20, maxAdverseGap, drawdown } as unknown as JsonValue,
    policyVersion: config.policyVersion, modelVersions: config.modelVersions,
  });
  const fusionSnapshot = buildFusionSnapshot(snapshotInput);

  if (candidates.length === 0) {
    return {
      runId, startedAt, finishedAt: config.now(), universeFunnel: funnel, selectedUnderlying: underlying, underlyingRanking: ranked,
      optionChainComplete, optionContractsComplete, snapshotContentHash: fusionSnapshot.contentHash,
      snapshotValidForNewRisk: fusionSnapshot.validForNewRisk, orchestration: null, provenance, provenanceDetail: detail,
      blockers: [...blockers, 'NO_CANDIDATES_AVAILABLE'],
    };
  }

  const orchestration = await runNewRiskOrchestration(config.bridge, {
    snapshotId: fusionSnapshot.contentHash, fusionSnapshotHash: fusionSnapshot.contentHash, timestamp: config.now(), underlying,
    earningsDistanceDays: null, // EventState is not real yet -- UNKNOWN, never fabricated as "no earnings nearby"
    optionQuoteFreshnessPolicy: config.optionQuoteFreshnessPolicy,
    providerCapabilities: {
      ALPACA_ACCOUNT: accountReal ? 'GOOD' : 'UNKNOWN',
      ALPACA_OPTION_CONTRACTS: contractsReal ? 'GOOD' : 'UNKNOWN',
      ALPACA_OPTION_CHAIN: quotesReal ? 'GOOD' : 'UNKNOWN',
      ALPACA_POSITIONS: 'UNKNOWN', // fetchPositions exists but is not yet called inside the cycle -- honestly not attempted
      ALPACA_OPEN_ORDERS: 'UNKNOWN', // same -- fetchOpenOrders exists but is not yet called inside the cycle
      OPTIONOMICS: 'UNKNOWN', // no real Optionomics adapter exists yet -- not attempted, not a documented entitlement gap
      EVENT_DATA: 'UNKNOWN', // no event-state assembly exists yet
    },
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
    runId, startedAt, finishedAt: config.now(), universeFunnel: funnel, selectedUnderlying: underlying, underlyingRanking: ranked,
    optionChainComplete, optionContractsComplete, snapshotContentHash: fusionSnapshot.contentHash,
    snapshotValidForNewRisk: fusionSnapshot.validForNewRisk, orchestration, provenance, provenanceDetail: detail, blockers,
  };
}

// Referenced for future wiring (positions/open orders into AEGIS/sizing
// lineage, item 20) -- not yet consumed by runThetaShadowCycle above.
export { fetchPositions, fetchOpenOrders };
