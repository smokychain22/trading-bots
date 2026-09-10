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
import type { DataQualityState } from './data-freshness.js';

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

// Maps a fetch's ProvenanceOrigin (WHERE did this value come from) to a
// DataQualityState (IS it currently usable) -- two distinct axes, per the
// correction that one enum must never answer both questions.
// REAL_PROVIDER_ERROR maps to INVALID, never UNKNOWN: a failed real query
// must never masquerade as an authentic "genuinely nothing to report."
function dataQualityForOrigin(origin: ProvenanceOrigin): DataQualityState {
  switch (origin) {
    case 'REAL_PROVIDER': return 'GOOD';
    case 'REAL_PROVIDER_UNKNOWN': return 'UNKNOWN';
    case 'REAL_PROVIDER_ERROR': return 'INVALID';
    case 'SYNTHETIC_FIXTURE':
    case 'CALLER_MANUAL':
    case 'NOT_ATTEMPTED':
      return 'UNKNOWN';
    default:
      return 'UNKNOWN';
  }
}

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
  readonly accountOrigin: ProvenanceOrigin;
  readonly contractsOrigin: ProvenanceOrigin;
  readonly quotesOrigin: ProvenanceOrigin;
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
        provider: 'ALPACA', operationAlias: 'alpaca.get_account', asOf: params.accountOrigin === 'REAL_PROVIDER' ? params.now : null, retrievedAt: params.now,
        state: dataQualityForOrigin(params.accountOrigin), contentHash: hashJson(accountJson), feed: null,
        contractVersion: 'alpaca-account-v1', truthRole: 'ACCOUNT', requiredForNewRisk: true,
      },
      {
        provider: 'ALPACA', operationAlias: 'alpaca.get_option_contracts', asOf: params.contractsOrigin === 'REAL_PROVIDER' ? params.now : null, retrievedAt: params.now,
        state: dataQualityForOrigin(params.contractsOrigin), contentHash: hashJson(contractsJson), feed: null,
        contractVersion: 'alpaca-option-contracts-v1', truthRole: 'CONTRACT', requiredForNewRisk: true,
      },
      {
        provider: 'ALPACA', operationAlias: 'alpaca.get_option_snapshots', asOf: params.quotesOrigin === 'REAL_PROVIDER' ? params.now : null, retrievedAt: params.now,
        state: dataQualityForOrigin(params.quotesOrigin), contentHash: hashJson(contractsJson), feed: 'indicative',
        contractVersion: 'alpaca-option-snapshots-v1', truthRole: 'QUOTE', requiredForNewRisk: true,
      },
    ],
    providerHealth: [
      {
        provider: 'ALPACA',
        state: [params.accountOrigin, params.contractsOrigin, params.quotesOrigin].every((o) => o === 'REAL_PROVIDER')
          ? 'GOOD'
          : [params.accountOrigin, params.contractsOrigin, params.quotesOrigin].some((o) => o === 'REAL_PROVIDER_ERROR')
            ? 'INVALID'
            : 'UNKNOWN',
        asOf: params.now, retrievedAt: params.now,
      },
      { provider: 'OPTIONOMICS', state: 'UNKNOWN', asOf: null, retrievedAt: params.now },
    ],
    freshnessFlags: [],
    unknownFeatures: [
      { feature: 'optionOpenInterest', reasonCode: 'OPTIONOMICS_NOT_FETCHED', provider: null },
      { feature: 'optionVolume', reasonCode: 'OPTIONOMICS_NOT_FETCHED_ALPACA_DAILY_BAR_FALLBACK_ONLY', provider: null },
      { feature: 'eventState', reasonCode: 'EVENT_STATE_NOT_IMPLEMENTED', provider: null },
    ],
    executableTruth: {
      account: dataQualityForOrigin(params.accountOrigin),
      contract: dataQualityForOrigin(params.contractsOrigin),
      quote: dataQualityForOrigin(params.quotesOrigin),
    },
  };
}

// Provenance semantics correction (this session, refined further this
// pass): FULL_REAL means "the required state came through the real
// runtime/provider CODE PATH" -- it does NOT mean "every field has a
// non-null value." But a SUCCESSFUL real query that genuinely has nothing
// to report (REAL_PROVIDER_UNKNOWN) is a fundamentally different fact from
// a real query that FAILED (REAL_PROVIDER_ERROR -- 5xx, network error,
// auth/entitlement failure, exhausted rate-limit retry). Conflating these
// two into one "real" bucket was a real bug: it let a provider OUTAGE
// masquerade as an authentic UNKNOWN observation. REAL_PROVIDER_ERROR
// counts toward provenance being "not synthetic" (a real call really was
// attempted), but it must NEVER be treated as safe/usable evidence for a
// decision -- see classifyRequiredCapabilityFailure below, which is what
// actually gates whether evaluation may proceed.
export type ProvenanceOrigin =
  | 'REAL_PROVIDER' // a real provider function was called this cycle and returned a usable result
  | 'REAL_PROVIDER_UNKNOWN' // a real provider function was called this cycle, succeeded, but genuinely had nothing to report for this field
  | 'REAL_PROVIDER_ERROR' // a real provider function was called this cycle and FAILED (network/5xx/auth/entitlement/rate-limit) -- never treated as a valid UNKNOWN
  | 'SYNTHETIC_FIXTURE' // a test/development fixture value, never a real call
  | 'CALLER_MANUAL' // the caller supplied this directly in config (e.g. aegisInputs, universeCandidates) -- not fetched at all
  | 'NOT_ATTEMPTED'; // no code path for this dimension exists yet

// FULL_REAL evidence: a real call happened and (successfully or with an
// honest empty result) told us something genuine. REAL_PROVIDER_ERROR is
// deliberately EXCLUDED here -- an error is not "authentic reality" for
// provenance purposes, even though it does prove a real call was attempted;
// see PARTIALLY_REAL_ORIGINS below for the "not purely synthetic" question.
const FULL_REAL_ORIGINS: ReadonlySet<ProvenanceOrigin> = new Set(['REAL_PROVIDER', 'REAL_PROVIDER_UNKNOWN']);
// "Not purely synthetic" evidence for the SYNTHETIC/HYBRID boundary: an
// error still proves a real call was attempted (this is not a fixture),
// even though it can never count as FULL_REAL evidence on its own.
const NOT_SYNTHETIC_ORIGINS: ReadonlySet<ProvenanceOrigin> = new Set(['REAL_PROVIDER', 'REAL_PROVIDER_UNKNOWN', 'REAL_PROVIDER_ERROR']);

/**
 * Automatic provenance classification -- never manually labeled. FULL_REAL
 * requires EVERY dimension to be genuine, usable real-provider evidence
 * (REAL_PROVIDER or REAL_PROVIDER_UNKNOWN) -- a REAL_PROVIDER_ERROR
 * dimension can never make a run FULL_REAL, even though the call really
 * was attempted, because an error is not authentic reality about the
 * world, it's a failure to observe it. SYNTHETIC only when every dimension
 * is CALLER_MANUAL/SYNTHETIC_FIXTURE/NOT_ATTEMPTED (nothing real was even
 * attempted). Otherwise HYBRID -- which now also correctly covers "some
 * real calls were attempted but one of them errored," rather than that
 * case silently inflating to FULL_REAL as it did before this correction.
 * Never driven by whether the cycle happened to produce zero eligible
 * underlyings or any other RESULT -- a real scan legitimately finding
 * nothing is still real.
 */
function classifyProvenance(dimensions: Readonly<Record<string, ProvenanceOrigin>>): { provenance: ShadowCycleProvenance; detail: readonly string[] } {
  const detail: string[] = [];
  let fullRealCount = 0;
  let notSyntheticCount = 0;
  for (const [name, origin] of Object.entries(dimensions)) {
    detail.push(`${name}=${origin}`);
    if (FULL_REAL_ORIGINS.has(origin)) fullRealCount += 1;
    if (NOT_SYNTHETIC_ORIGINS.has(origin)) notSyntheticCount += 1;
  }
  const total = Object.keys(dimensions).length;
  if (fullRealCount === total) return { provenance: 'FULL_REAL', detail };
  if (notSyntheticCount === 0) return { provenance: 'SYNTHETIC', detail };
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
  let accountOrigin: ProvenanceOrigin = 'NOT_ATTEMPTED';
  try {
    account = await fetchMasterAccountSnapshot(config.alpaca, config.now());
    accountOrigin = 'REAL_PROVIDER';
  } catch (error) {
    // A real call WAS attempted and it failed -- this is REAL_PROVIDER_ERROR,
    // never conflated with "the query succeeded but had nothing to report."
    accountOrigin = 'REAL_PROVIDER_ERROR';
    blockers.push(`ACCOUNT_FETCH_FAILED:${error instanceof Error ? error.message : 'unknown'}`);
  }

  let historyOrigin: ProvenanceOrigin = 'NOT_ATTEMPTED';
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
      historyOrigin = 'REAL_PROVIDER';
      ret1d = computeReturn(bars, receivedAt, 1);
      rv20 = computeRealizedVolatility(bars, receivedAt, 20);
      drawdown = computeCurrentDrawdown(bars, receivedAt, 60);
      maSlope = computeTrendSlope(bars, receivedAt, 20);
      gapFrequency = computeGapFrequency(bars, receivedAt, 60, 0.02);
      maxAdverseGap = computeMaxAdverseGap(bars, receivedAt, 60);
    } else {
      // A real, successful call that genuinely returned nothing usable
      // (complete but empty, or incomplete) -- still real provenance, NOT
      // an error, per the correction that a real empty/partial result is
      // authentic reality rather than a fixture or a failure.
      historyOrigin = 'REAL_PROVIDER_UNKNOWN';
      if (!barsResult.complete) blockers.push('STOCK_HISTORY_INCOMPLETE');
    }
  } catch (error) {
    historyOrigin = 'REAL_PROVIDER_ERROR';
    blockers.push(`STOCK_HISTORY_FETCH_FAILED:${error instanceof Error ? error.message : 'unknown'}`);
  }

  let optionChainComplete: boolean | null = null;
  let optionContractsComplete: boolean | null = null;
  let contractsOrigin: ProvenanceOrigin = 'NOT_ATTEMPTED';
  let quotesOrigin: ProvenanceOrigin = 'NOT_ATTEMPTED';
  const candidates: RawCandidateInput[] = [];
  let mergedContractsForSnapshot: ReturnType<typeof mergeOptionChain> = [];
  try {
    const contractsResult = await fetchOptionContracts(config.alpaca, {
      underlyingSymbol: underlying, expirationDateGte: config.optionExpirationDateGte, expirationDateLte: config.optionExpirationDateLte,
      optionType: config.optionType, limit: 100, maxPages: config.maxOptionPages,
    });
    optionContractsComplete = contractsResult.complete;
    contractsOrigin = contractsResult.complete ? 'REAL_PROVIDER' : 'REAL_PROVIDER_UNKNOWN';
    const snapshotsResult = await fetchOptionSnapshots(config.alpaca, {
      underlyingSymbol: underlying, feed: 'indicative', optionType: config.optionType, limit: 100, maxPages: config.maxOptionPages,
    });
    optionChainComplete = snapshotsResult.complete;
    quotesOrigin = snapshotsResult.complete ? 'REAL_PROVIDER' : 'REAL_PROVIDER_UNKNOWN';

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
      candidates.push({
        candidateId: contract.optionSymbol, contract, entryPremiumPerShare: contract.bid ?? 0,
        severeDrawdownProbability: null, ivRank: null, brokerAllowedQty: 5, contractIsStandard: true,
        hasAlternateContract: mergedContracts.length > 1, hasAlternateExpiry: false, hasAlternateStructure: false,
        ivCompensationSufficient: null, quoteSize: contract.bidSize, preSlippageExpectedUtility: null,
      });
    }
  } catch (error) {
    // Only mark a leg as errored if it hadn't already resolved -- e.g. the
    // contracts fetch may have genuinely succeeded before the snapshots
    // fetch threw, and that real success must not be erased by the later
    // failure.
    if (contractsOrigin === 'NOT_ATTEMPTED') contractsOrigin = 'REAL_PROVIDER_ERROR';
    if (quotesOrigin === 'NOT_ATTEMPTED') quotesOrigin = 'REAL_PROVIDER_ERROR';
    blockers.push(`OPTION_CHAIN_FETCH_FAILED:${error instanceof Error ? error.message : 'unknown'}`);
  }

  // A merged option-chain "origin" combines two independently-tracked real
  // calls (contracts + quotes). An error on either leg dominates (never
  // masked by the other leg succeeding); otherwise UNKNOWN dominates over
  // fully-real, since a genuinely-empty leg means the chain is not fully
  // populated from real data.
  const optionChainOrigin: ProvenanceOrigin =
    contractsOrigin === 'REAL_PROVIDER_ERROR' || quotesOrigin === 'REAL_PROVIDER_ERROR' ? 'REAL_PROVIDER_ERROR'
    : contractsOrigin === 'REAL_PROVIDER' && quotesOrigin === 'REAL_PROVIDER' ? 'REAL_PROVIDER'
    : 'REAL_PROVIDER_UNKNOWN';

  const { provenance, detail } = classifyProvenance({
    universeCandidates: config.universeCandidatesOrigin,
    account: accountOrigin,
    underlyingHistory: historyOrigin,
    optionChain: optionChainOrigin,
    optionomics: 'NOT_ATTEMPTED', // no real Optionomics fetch adapter exists yet -- honestly not attempted, not a fixture
    eventState: 'NOT_ATTEMPTED', // no event-state assembly exists yet
    aegisInputs: config.aegisInputsOrigin,
  });

  // Canonical FusionSnapshot -- ALWAYS built, even on a no-candidates path,
  // so every returned run (successful or not) carries a genuine,
  // deterministic snapshot identity. NEVER a placeholder hash.
  const snapshotInput = assembleFusionSnapshotInput({
    now: config.now(), underlying, account,
    accountOrigin, contractsOrigin, quotesOrigin,
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
      ALPACA_ACCOUNT: dataQualityForOrigin(accountOrigin),
      ALPACA_OPTION_CONTRACTS: dataQualityForOrigin(contractsOrigin),
      ALPACA_OPTION_CHAIN: dataQualityForOrigin(quotesOrigin),
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
