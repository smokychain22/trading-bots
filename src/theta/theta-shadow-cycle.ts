import { randomUUID } from 'node:crypto';
import {
  AlpacaProviderError,
  fetchCorporateActions, fetchMarketCalendar, fetchMarketClock, fetchMasterAccountSnapshot, fetchOpenOrders, fetchOptionContracts, fetchOptionSnapshots,
  fetchPositions, fetchStockBars, type AlpacaMarketClock, type AlpacaOpenOrderSnapshot, type AlpacaPositionSnapshot,
  type AlpacaProviderConfig, type MasterAccountSnapshot, type RawCorporateAction,
} from './alpaca-provider.js';
import { mergeOptionChain, type OptionomicsChainEntry } from './option-chain-ingestion.js';
import { computeCurrentDrawdown, computeGapFrequency, computeMaxAdverseGap, computeRealizedVolatility, computeReturn, computeTrendSlope } from './underlying-features.js';
import { evaluateUniverse, rankEligibleUnderlyings, type RankedUnderlying, type UnderlyingCandidateInput, type UniverseFunnelReport, type UniversePolicy } from './universe-policy.js';
import { runNewRiskOrchestration, type NewRiskOrchestrationRequest, type NewRiskOrchestrationResult, type RawCandidateInput } from './new-risk-orchestrator.js';
import { assembleRuntimePreconditionHold } from './decision-assembly.js';
import { checkTemporalConsistency, DEFAULT_TEMPORAL_CONSISTENCY_POLICIES } from './temporal-consistency.js';
import { assembleEventState, knownDate, unknownDate, type EventStateAssessment } from './event-state.js';
import type { PythonBridgeConfig } from './python-bridge.js';
import { buildFusionSnapshot, hashJson, type FusionSnapshotInput, type JsonValue } from '../market/fusion-snapshot.js';
import type { DataQualityState } from './data-freshness.js';
import {
  fetchOptionomicsOptionChain, matchOptionomicsContractIdentity,
  type AlpacaContractIdentity, type NormalizedOptionomicsEntry, type OptionomicsProviderConfig,
} from './optionomics-provider.js';
import { deriveAccountExposure, mergeDerivedExposureIntoAegisInputs, type DerivedAccountExposure } from './account-exposure.js';
import { deriveExecutionQualityAcceptable, deriveLiquidityAcceptable, deriveProviderState, deriveStressGapDetected } from './aegis-derivation.js';
import { computeUnderlyingReturnProxy, rankUnderlyingsByReturnProxy, type UnderlyingReturnProxy } from './cross-symbol-selection.js';

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
//   - Optionomics IS fetched live (fetchOptionomicsOptionChain) when
//     config.optionomics is non-null, matched to specific Alpaca contracts
//     by exact identity only, and merged for OI/volume/Greeks-fallback.
//     When config.optionomics is null (no credentials configured), it is
//     honestly NOT_ATTEMPTED -- never a fixture standing in for a real call.
//   - Positions and open orders are NOT yet fetched inside this cycle
//     (fetchPositions/fetchOpenOrders exist in alpaca-provider.ts but are
//     not called here) -- account exposure/AEGIS inputs remain caller-
//     supplied until that wiring lands.
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
  readonly optionomics: OptionomicsProviderConfig | null; // null when Optionomics credentials are not configured -- honestly NOT_ATTEMPTED, never a fixture
  readonly bridge: PythonBridgeConfig;
  readonly universePolicy: UniversePolicy;
  readonly universeCandidates: readonly UnderlyingCandidateInput[]; // caller supplies the raw per-underlying facts; a full Alpaca-asset-universe fetch is not built this pass
  readonly universeCandidatesOrigin: ProvenanceOrigin; // caller must honestly declare whether these facts came from a real asset-discovery call or a fixture/manual list -- drives automatic provenance, never guessed
  readonly optionExpirationDateGte: string;
  readonly optionExpirationDateLte: string;
  readonly optionType: 'put';
  readonly maxOptionPages: number;
  // Item H: how many of the liquidity-ranked eligible underlyings get a
  // real (cheap, Alpaca-only) option-chain probe for cross-symbol economic
  // comparison before final selection -- versioned research parameter,
  // never a permanent magic number. 1 reproduces the old "liquidity-#1
  // only" behavior; the real comparison only has an effect when >1.
  readonly crossSymbolShortlistSize: number;
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
  readonly stressGapThresholdAbsReturn: number; // versioned research placeholder -- see aegis-derivation.ts's deriveStressGapDetected
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
  // Item H: the real, cheap, per-underlying economic comparison across
  // the shortlist (see cross-symbol-selection.ts). `null` only when the
  // shortlist probe itself never ran (no eligible underlying at all).
  // `selectedUnderlying` is chosen from THIS ranking when it produced at
  // least one real candidate, never from underlyingRanking's liquidity
  // order alone.
  readonly crossSymbolComparison: readonly UnderlyingReturnProxy[] | null;
  readonly optionChainComplete: boolean | null;
  readonly optionContractsComplete: boolean | null;
  readonly snapshotContentHash: string | null; // the REAL, deterministic FusionSnapshot content hash -- never a placeholder
  readonly snapshotValidForNewRisk: boolean | null;
  readonly orchestration: NewRiskOrchestrationResult | null;
  readonly provenance: ShadowCycleProvenance;
  readonly provenanceDetail: readonly string[];
  readonly blockers: readonly string[];
}

interface ProviderEvidence {
  readonly origin: ProvenanceOrigin;
  readonly quality: DataQualityState;
}

const notAttemptedEvidence = (): ProviderEvidence => ({ origin: 'NOT_ATTEMPTED', quality: 'UNKNOWN' });

// Origin records what happened. Quality records whether the resulting state
// is usable. A transport outage is real provider ERROR provenance but only a
// transient DEGRADED capability. Authentication, entitlement, and malformed
// payload failures are genuine prohibitions and remain INVALID/NOT_ENTITLED.
function failedProviderEvidence(error: unknown): ProviderEvidence {
  if (error instanceof AlpacaProviderError) {
    if (error.errorClass === 'INVALID_AUTH' || error.errorClass === 'MALFORMED_RESPONSE') {
      return { origin: 'REAL_PROVIDER_ERROR', quality: 'INVALID' };
    }
    if (error.errorClass === 'NOT_ENTITLED') {
      return { origin: 'REAL_PROVIDER_ERROR', quality: 'NOT_ENTITLED' };
    }
  }
  return { origin: 'REAL_PROVIDER_ERROR', quality: 'DEGRADED' };
}

function aggregateProviderQuality(states: readonly DataQualityState[]): DataQualityState {
  for (const state of ['INVALID', 'NOT_ENTITLED', 'STALE', 'DEGRADED', 'UNKNOWN'] as const) {
    if (states.includes(state)) return state;
  }
  return 'GOOD';
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
  readonly accountQuality: DataQualityState;
  readonly contractsOrigin: ProvenanceOrigin;
  readonly contractsQuality: DataQualityState;
  readonly quotesOrigin: ProvenanceOrigin;
  readonly quotesQuality: DataQualityState;
  readonly optionomicsOrigin: ProvenanceOrigin;
  readonly optionomicsQuality: DataQualityState;
  readonly optionomicsEntries: readonly NormalizedOptionomicsEntry[];
  readonly positions: readonly AlpacaPositionSnapshot[];
  readonly positionsOrigin: ProvenanceOrigin;
  readonly positionsQuality: DataQualityState;
  readonly openOrders: readonly AlpacaOpenOrderSnapshot[];
  readonly openOrdersOrigin: ProvenanceOrigin;
  readonly openOrdersQuality: DataQualityState;
  readonly clock: AlpacaMarketClock | null;
  readonly clockOrigin: ProvenanceOrigin;
  readonly clockQuality: DataQualityState;
  readonly todaysCalendar: readonly Awaited<ReturnType<typeof fetchMarketCalendar>>[number][];
  readonly calendarOrigin: ProvenanceOrigin;
  readonly calendarQuality: DataQualityState;
  readonly eventState: EventStateAssessment | null;
  readonly eventStateQuality: DataQualityState;
  readonly derivedExposure: DerivedAccountExposure;
  readonly mergedContracts: FusionSnapshotInput['contractCandidates'];
  readonly ownershipFeatures: JsonValue;
  readonly regimeFeatures: JsonValue;
  readonly policyVersion: string;
  readonly modelVersions: Readonly<Record<string, string>>;
}): FusionSnapshotInput {
  const accountJson: JsonValue = params.account === null ? { fetched: false } : { ...params.account };
  const contractsJson: JsonValue = params.mergedContracts as unknown as JsonValue;
  const optionomicsAttempted = params.optionomicsOrigin !== 'NOT_ATTEMPTED';
  const optionomicsJson: JsonValue = optionomicsAttempted
    ? (params.optionomicsEntries as unknown as JsonValue)
    : { attempted: false };

  // unknownFeatures reflects what actually happened THIS cycle -- when
  // Optionomics genuinely was not attempted (no config), the reason is
  // honestly "not configured", never silently omitted; when it WAS
  // attempted and succeeded, these two entries are dropped entirely
  // (per-contract OI/volume provenance is already carried on each
  // NormalizedOptionContract via openInterestSource/volumeSource).
  const unknownFeatures: FusionSnapshotInput['unknownFeatures'] = [];
  if (!optionomicsAttempted) {
    unknownFeatures.push({ feature: 'optionOpenInterest', reasonCode: 'OPTIONOMICS_NOT_CONFIGURED', provider: null });
    unknownFeatures.push({ feature: 'optionVolume', reasonCode: 'OPTIONOMICS_NOT_CONFIGURED_ALPACA_DAILY_BAR_FALLBACK_ONLY', provider: null });
  } else if (params.optionomicsQuality !== 'GOOD') {
    unknownFeatures.push({ feature: 'optionOpenInterest', reasonCode: `OPTIONOMICS_${params.optionomicsQuality}`, provider: 'OPTIONOMICS' });
    unknownFeatures.push({ feature: 'optionVolume', reasonCode: `OPTIONOMICS_${params.optionomicsQuality}`, provider: 'OPTIONOMICS' });
  }
  if (params.eventState === null) {
    unknownFeatures.push({ feature: 'eventState', reasonCode: 'EVENT_STATE_NOT_ATTEMPTED', provider: null });
  } else if (params.eventState.earnings.known === false) {
    unknownFeatures.push({ feature: 'earningsDistance', reasonCode: 'EARNINGS_DATE_SOURCE_NOT_WIRED', provider: null });
  }

  const positionsJson: JsonValue = params.positions as unknown as JsonValue;
  const openOrdersJson: JsonValue = params.openOrders as unknown as JsonValue;

  return {
    botId: 'THETA',
    decisionTimeUtc: params.now,
    triggerType: 'SHADOW_CYCLE',
    marketSession: params.clock !== null
      ? ({
          isOpen: params.clock.isOpen, nextOpen: params.clock.nextOpen, nextClose: params.clock.nextClose, asOf: params.clock.timestamp,
          todaysSessions: params.todaysCalendar,
        } as unknown as JsonValue)
      : null, // honestly absent when the clock fetch never returned a usable value -- never fabricated as "regular session"
    underlyingState: { symbol: params.underlying },
    contractCandidates: params.mergedContracts,
    accountState: accountJson,
    positionState: { positions: positionsJson, openOrders: openOrdersJson },
    portfolioExposure: params.derivedExposure as unknown as JsonValue, // real, pure arithmetic over account/positions/orders -- see account-exposure.ts
    alpacaQuoteState: null,
    optionomicsFeatureState: optionomicsAttempted ? optionomicsJson : null, // honestly absent when not configured, never fabricated
    eventState: params.eventState as unknown as JsonValue, // real assembled event state (see event-state.ts) -- null only when genuinely never attempted
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
        state: params.accountQuality, contentHash: hashJson(accountJson), feed: null,
        contractVersion: 'alpaca-account-v1', truthRole: 'ACCOUNT', requiredForNewRisk: true,
      },
      {
        provider: 'ALPACA', operationAlias: 'alpaca.get_option_contracts', asOf: params.contractsOrigin === 'REAL_PROVIDER' ? params.now : null, retrievedAt: params.now,
        state: params.contractsQuality, contentHash: hashJson(contractsJson), feed: null,
        contractVersion: 'alpaca-option-contracts-v1', truthRole: 'CONTRACT', requiredForNewRisk: true,
      },
      {
        provider: 'ALPACA', operationAlias: 'alpaca.get_option_snapshots', asOf: params.quotesOrigin === 'REAL_PROVIDER' ? params.now : null, retrievedAt: params.now,
        state: params.quotesQuality, contentHash: hashJson(contractsJson), feed: 'indicative',
        contractVersion: 'alpaca-option-snapshots-v1', truthRole: 'QUOTE', requiredForNewRisk: true,
      },
      {
        provider: 'OPTIONOMICS', operationAlias: 'optionomics.get_option_chain', asOf: params.optionomicsOrigin === 'REAL_PROVIDER' ? params.now : null, retrievedAt: params.now,
        state: optionomicsAttempted ? params.optionomicsQuality : 'UNKNOWN', contentHash: hashJson(optionomicsJson), feed: null,
        contractVersion: 'optionomics-option-chain-v1', truthRole: 'CONTEXT', requiredForNewRisk: false,
      },
      {
        provider: 'ALPACA', operationAlias: 'alpaca.get_positions', asOf: params.positionsOrigin === 'REAL_PROVIDER' ? params.now : null, retrievedAt: params.now,
        state: params.positionsQuality, contentHash: hashJson(positionsJson), feed: null,
        contractVersion: 'alpaca-positions-v1', truthRole: 'CONTEXT', requiredForNewRisk: false,
      },
      {
        provider: 'ALPACA', operationAlias: 'alpaca.get_open_orders', asOf: params.openOrdersOrigin === 'REAL_PROVIDER' ? params.now : null, retrievedAt: params.now,
        state: params.openOrdersQuality, contentHash: hashJson(openOrdersJson), feed: null,
        contractVersion: 'alpaca-open-orders-v1', truthRole: 'CONTEXT', requiredForNewRisk: false,
      },
      {
        provider: 'ALPACA', operationAlias: 'alpaca.get_clock', asOf: params.clockOrigin === 'REAL_PROVIDER' ? params.now : null, retrievedAt: params.now,
        state: params.clockQuality, contentHash: hashJson((params.clock as unknown as JsonValue) ?? { fetched: false }), feed: null,
        contractVersion: 'alpaca-clock-v1', truthRole: 'CONTEXT', requiredForNewRisk: false,
      },
      {
        provider: 'ALPACA', operationAlias: 'alpaca.get_calendar', asOf: params.calendarOrigin === 'REAL_PROVIDER' ? params.now : null, retrievedAt: params.now,
        state: params.calendarQuality, contentHash: hashJson(params.todaysCalendar as unknown as JsonValue), feed: null,
        contractVersion: 'alpaca-calendar-v1', truthRole: 'CONTEXT', requiredForNewRisk: false,
      },
      {
        provider: 'ALPACA', operationAlias: 'alpaca.get_corporate_actions', asOf: params.eventState !== null ? params.now : null, retrievedAt: params.now,
        state: params.eventStateQuality, contentHash: hashJson(params.eventState as unknown as JsonValue), feed: null,
        contractVersion: 'alpaca-corporate-actions-v1', truthRole: 'CONTEXT', requiredForNewRisk: false,
      },
    ],
    providerHealth: [
      {
        provider: 'ALPACA',
        state: aggregateProviderQuality([params.accountQuality, params.contractsQuality, params.quotesQuality, params.positionsQuality, params.openOrdersQuality, params.clockQuality, params.calendarQuality]),
        asOf: params.now, retrievedAt: params.now,
      },
      { provider: 'OPTIONOMICS', state: optionomicsAttempted ? params.optionomicsQuality : 'UNKNOWN', asOf: optionomicsAttempted ? params.now : null, retrievedAt: params.now },
    ],
    freshnessFlags: [],
    unknownFeatures,
    executableTruth: {
      account: params.accountQuality,
      contract: params.contractsQuality,
      quote: params.quotesQuality,
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
// decision. The orchestration capability gate uses the separate quality
// state to decide whether evaluation may proceed.
export type ProvenanceOrigin =
  | 'REAL_PROVIDER' // a real provider function was called this cycle and returned a usable result
  | 'REAL_PROVIDER_UNKNOWN' // a real provider function was called this cycle, succeeded, but genuinely had nothing to report for this field
  | 'REAL_PROVIDER_ERROR' // a real provider function was called this cycle and FAILED (network/5xx/auth/entitlement/rate-limit) -- never treated as a valid UNKNOWN
  | 'DERIVED_FROM_REAL' // deterministic output computed only from real provider observations
  | 'SYNTHETIC_FIXTURE' // a test/development fixture value, never a real call
  | 'CALLER_MANUAL' // the caller supplied this directly in config (e.g. aegisInputs, universeCandidates) -- not fetched at all
  | 'NOT_ATTEMPTED'; // no code path for this dimension exists yet

// FULL_REAL evidence: a real call happened and (successfully or with an
// honest empty result) told us something genuine. REAL_PROVIDER_ERROR is
// deliberately EXCLUDED here -- an error is not "authentic reality" for
// provenance purposes, even though it does prove a real call was attempted;
// see NOT_SYNTHETIC_ORIGINS below for the "not purely synthetic" question.
const FULL_REAL_ORIGINS: ReadonlySet<ProvenanceOrigin> = new Set(['REAL_PROVIDER', 'REAL_PROVIDER_UNKNOWN', 'DERIVED_FROM_REAL']);
// "Not purely synthetic" evidence for the SYNTHETIC/HYBRID boundary: an
// error still proves a real call was attempted (this is not a fixture),
// even though it can never count as FULL_REAL evidence on its own.
const NOT_SYNTHETIC_ORIGINS: ReadonlySet<ProvenanceOrigin> = new Set(['REAL_PROVIDER', 'REAL_PROVIDER_UNKNOWN', 'REAL_PROVIDER_ERROR', 'DERIVED_FROM_REAL']);

/**
 * Automatic provenance classification -- never manually labeled. FULL_REAL
 * requires EVERY dimension to be genuine, usable real-provider evidence
 * (REAL_PROVIDER, REAL_PROVIDER_UNKNOWN, or DERIVED_FROM_REAL) -- a REAL_PROVIDER_ERROR
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
export function classifyShadowCycleProvenance(dimensions: Readonly<Record<string, ProvenanceOrigin>>): { provenance: ShadowCycleProvenance; detail: readonly string[] } {
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
    // scan came up empty (see classifyShadowCycleProvenance's own docstring).
    const { provenance: noUnderlyingProvenance, detail: noUnderlyingDetail } = classifyShadowCycleProvenance({
      universeCandidates: config.universeCandidatesOrigin,
    });
    return {
      runId, startedAt, finishedAt: config.now(), universeFunnel: funnel, selectedUnderlying: null, underlyingRanking: ranked,
      crossSymbolComparison: null,
      optionChainComplete: null, optionContractsComplete: null, snapshotContentHash: null, snapshotValidForNewRisk: null,
      orchestration: null,
      provenance: noUnderlyingProvenance, provenanceDetail: ['no eligible underlying survived UniversePolicy this cycle', ...noUnderlyingDetail],
      blockers: ['NO_ELIGIBLE_UNDERLYING'],
    };
  }

  // Item H: real, cheap, per-underlying economic comparison across the
  // liquidity-ranked shortlist -- replaces "select liquidity-#1" as final
  // trade ranking. Only Alpaca contracts+snapshots are probed here (no
  // Optionomics, no full Python pipeline) to keep this stage bounded; the
  // expensive full pipeline still runs exactly once per cycle, on
  // whichever underlying wins this comparison. Falls back to the
  // liquidity-#1 underlying (topRanked.symbol) when the shortlist probe
  // produces no usable candidate at all -- `underlying` is never left
  // unselected.
  const shortlist = ranked.slice(0, Math.max(1, config.crossSymbolShortlistSize));
  const shortlistProxies: UnderlyingReturnProxy[] = [];
  for (const candidate of shortlist) {
    try {
      const contractsProbe = await fetchOptionContracts(config.alpaca, {
        underlyingSymbol: candidate.symbol, expirationDateGte: config.optionExpirationDateGte, expirationDateLte: config.optionExpirationDateLte,
        optionType: config.optionType, limit: 100, maxPages: config.maxOptionPages,
      });
      const snapshotsProbe = await fetchOptionSnapshots(config.alpaca, {
        underlyingSymbol: candidate.symbol, feed: 'indicative', optionType: config.optionType, limit: 100, maxPages: config.maxOptionPages,
      });
      const mergedProbe = mergeOptionChain({
        underlying: candidate.symbol, asOfDate: config.now().slice(0, 10), contracts: contractsProbe.items,
        snapshotsBySymbol: snapshotsProbe.snapshots, optionomicsBySymbol: new Map(), requestedFeed: 'INDICATIVE',
        defaultMultiplierForUnknownContracts: 100, receivedAt: config.now(), maxQuoteAgeSecondsForExecutable: 30, maxSpreadPctForExecutable: config.maxAcceptableSpreadPct,
      });
      shortlistProxies.push(computeUnderlyingReturnProxy(candidate.symbol, mergedProbe));
    } catch (error) {
      blockers.push(`CROSS_SYMBOL_PROBE_FAILED:${candidate.symbol}:${error instanceof Error ? error.message : 'unknown'}`);
      shortlistProxies.push({ underlying: candidate.symbol, bestCandidateSymbol: null, returnProxy: null });
    }
  }
  const { ranked: crossSymbolRanked } = rankUnderlyingsByReturnProxy(shortlistProxies);
  const underlying = crossSymbolRanked[0]?.underlying ?? topRanked.symbol;

  let account: MasterAccountSnapshot | null = null;
  let accountEvidence = notAttemptedEvidence();
  let accountFetchedAt: string | null = null;
  try {
    accountFetchedAt = config.now();
    account = await fetchMasterAccountSnapshot(config.alpaca, accountFetchedAt);
    const accountRequiredValuesPresent = account.accountStatus !== null
      && account.equity !== null
      && account.cash !== null
      && (account.optionsBuyingPower !== null || account.buyingPower !== null)
      && account.optionsApprovedLevel !== null
      && account.optionsTradingLevel !== null;
    accountEvidence = accountRequiredValuesPresent
      ? { origin: 'REAL_PROVIDER', quality: 'GOOD' }
      : { origin: 'REAL_PROVIDER_UNKNOWN', quality: 'UNKNOWN' };
  } catch (error) {
    // A real call WAS attempted and it failed -- this is REAL_PROVIDER_ERROR,
    // never conflated with "the query succeeded but had nothing to report."
    accountEvidence = failedProviderEvidence(error);
    blockers.push(`ACCOUNT_FETCH_FAILED:${error instanceof Error ? error.message : 'unknown'}`);
  }

  // Positions and open orders are fetched every cycle -- both are real
  // account-truth calls, independent of the account snapshot itself and of
  // each other. A genuinely empty account (no positions, no open orders)
  // is a real, valid, common state -- distinguished from a fetch failure
  // by evidence origin, never inferred from an empty array being "probably
  // fine."
  let positions: readonly AlpacaPositionSnapshot[] = [];
  let positionsEvidence = notAttemptedEvidence();
  let positionsFetchedAt: string | null = null;
  try {
    positionsFetchedAt = config.now();
    positions = await fetchPositions(config.alpaca, positionsFetchedAt);
    positionsEvidence = { origin: 'REAL_PROVIDER', quality: 'GOOD' };
  } catch (error) {
    positionsEvidence = failedProviderEvidence(error);
    blockers.push(`POSITIONS_FETCH_FAILED:${error instanceof Error ? error.message : 'unknown'}`);
  }

  let openOrders: readonly AlpacaOpenOrderSnapshot[] = [];
  let openOrdersEvidence = notAttemptedEvidence();
  let openOrdersFetchedAt: string | null = null;
  try {
    openOrdersFetchedAt = config.now();
    openOrders = await fetchOpenOrders(config.alpaca, openOrdersFetchedAt);
    openOrdersEvidence = { origin: 'REAL_PROVIDER', quality: 'GOOD' };
  } catch (error) {
    openOrdersEvidence = failedProviderEvidence(error);
    blockers.push(`OPEN_ORDERS_FETCH_FAILED:${error instanceof Error ? error.message : 'unknown'}`);
  }

  // Market clock -- a confirmed real VALUE (open/closed), never a data-
  // quality question. A closed market is an operational precondition
  // (handled below, right before new-risk orchestration would run), not a
  // provider capability failure.
  let clock: AlpacaMarketClock | null = null;
  let clockEvidence = notAttemptedEvidence();
  try {
    clock = await fetchMarketClock(config.alpaca, config.now());
    clockEvidence = clock.isOpen !== null
      ? { origin: 'REAL_PROVIDER', quality: 'GOOD' }
      : { origin: 'REAL_PROVIDER_UNKNOWN', quality: 'UNKNOWN' };
  } catch (error) {
    clockEvidence = failedProviderEvidence(error);
    blockers.push(`MARKET_CLOCK_FETCH_FAILED:${error instanceof Error ? error.message : 'unknown'}`);
  }

  // Market calendar -- distinguishes a genuine holiday (no scheduled
  // session at all) from ordinary after-hours/weekend closure, and lets a
  // clock/calendar disagreement be caught explicitly rather than trusted
  // blindly. Known limitation: this compares only "is there a session
  // scheduled today at all", not exact HH:MM exchange-local open/close
  // boundaries against the clock's UTC timestamp (that requires exchange-
  // timezone conversion this pass does not implement) -- documented here,
  // not silently assumed correct down to the minute.
  const todayDate = config.now().slice(0, 10);
  let todaysCalendar: readonly Awaited<ReturnType<typeof fetchMarketCalendar>>[number][] = [];
  let calendarEvidence = notAttemptedEvidence();
  try {
    todaysCalendar = await fetchMarketCalendar(config.alpaca, todayDate, todayDate);
    calendarEvidence = { origin: 'REAL_PROVIDER', quality: 'GOOD' };
  } catch (error) {
    calendarEvidence = failedProviderEvidence(error);
    blockers.push(`MARKET_CALENDAR_FETCH_FAILED:${error instanceof Error ? error.message : 'unknown'}`);
  }

  // Honest event-state assembly (item D) -- see event-state.ts's own
  // docstring for why "earnings" stays permanently UNKNOWN this pass (no
  // real earnings-date source is wired: Alpaca's corporate-actions
  // endpoint covers splits/dividends/mergers, never earnings
  // announcements, and Optionomics's /api/v1/events shape/per-symbol
  // support was never verified). exDividend and corporateEvent DO use the
  // real corporate-actions fetch when its response shape is recognized.
  let eventStateEvidence = notAttemptedEvidence();
  let eventState: EventStateAssessment | null = null;
  {
    const eventWindowStart = new Date(new Date(config.now()).getTime() - 5 * 86_400_000).toISOString().slice(0, 10);
    const eventWindowEnd = new Date(new Date(config.now()).getTime() + 60 * 86_400_000).toISOString().slice(0, 10);
    try {
      const corporateActionsResult = await fetchCorporateActions(config.alpaca, [underlying], eventWindowStart, eventWindowEnd);
      if (!corporateActionsResult.recognized) {
        eventStateEvidence = { origin: 'REAL_PROVIDER_UNKNOWN', quality: 'UNKNOWN' };
      } else {
        eventStateEvidence = { origin: 'REAL_PROVIDER', quality: 'GOOD' };
      }
      const asOfDate = config.now().slice(0, 10);
      const relevantActions = corporateActionsResult.actions.filter((a) => a.symbol === null || a.symbol === underlying);
      const dividendActions = relevantActions.filter((a) => a.category === 'cash_dividends' || a.category === 'stock_dividends');
      const otherActions = relevantActions.filter((a) => a.category !== 'cash_dividends' && a.category !== 'stock_dividends');

      const nearestDateFrom = (items: readonly RawCorporateAction[]): { date: string; category: string } | null => {
        let nearest: { date: string; category: string; distance: number } | null = null;
        for (const item of items) {
          const dateStr = item.exDate ?? item.processDate ?? item.payableDate ?? item.recordDate;
          if (dateStr === null) continue;
          const distance = Math.abs(new Date(`${dateStr}T00:00:00Z`).getTime() - new Date(`${asOfDate}T00:00:00Z`).getTime());
          if (!Number.isFinite(distance)) continue;
          if (nearest === null || distance < nearest.distance) nearest = { date: dateStr, category: item.category, distance };
        }
        return nearest === null ? null : { date: nearest.date, category: nearest.category };
      };

      const nearestDividend = corporateActionsResult.recognized ? nearestDateFrom(dividendActions) : null;
      const nearestOther = corporateActionsResult.recognized ? nearestDateFrom(otherActions) : null;

      eventState = assembleEventState(
        asOfDate,
        unknownDate(), // earnings -- honestly never wired this pass, see comment above
        nearestDividend !== null ? knownDate(nearestDividend.date, asOfDate, 'ALPACA') : (corporateActionsResult.recognized ? unknownDate() : unknownDate('UNRECOGNIZED_RESPONSE_SHAPE')),
        nearestOther !== null ? { known: true, category: nearestOther.category, effectiveDate: nearestOther.date, provenance: 'ALPACA' } : { known: false, category: null, effectiveDate: null, provenance: 'UNKNOWN' },
      );
    } catch (error) {
      eventStateEvidence = failedProviderEvidence(error);
      blockers.push(`CORPORATE_ACTIONS_FETCH_FAILED:${error instanceof Error ? error.message : 'unknown'}`);
    }
  }
  const corporateEventDistanceDays: number | null =
    eventState?.corporateEvent.known === true && eventState.corporateEvent.effectiveDate !== null
      ? Math.round((new Date(`${eventState.corporateEvent.effectiveDate}T00:00:00Z`).getTime() - new Date(`${eventState.asOfDate}T00:00:00Z`).getTime()) / 86_400_000)
      : null;

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

  // Optionomics is fetched independently of Alpaca's option-chain calls --
  // its own success/failure is a genuinely separate fact from Alpaca's.
  // Matching its entries to specific Alpaca contracts (exact identity only)
  // happens below, once Alpaca's contract list is known.
  let optionomicsEntries: readonly NormalizedOptionomicsEntry[] = [];
  let optionomicsEvidence = notAttemptedEvidence();
  if (config.optionomics !== null) {
    const outcome = await fetchOptionomicsOptionChain(config.optionomics, underlying);
    if (outcome.kind === 'VALUE_PRESENT') {
      optionomicsEntries = outcome.value.entries;
      optionomicsEvidence = optionomicsEntries.length > 0
        ? { origin: 'REAL_PROVIDER', quality: 'GOOD' }
        : { origin: 'REAL_PROVIDER_UNKNOWN', quality: 'UNKNOWN' };
    } else if (outcome.kind === 'VALUE_UNKNOWN_AFTER_SUCCESS') {
      optionomicsEvidence = { origin: 'REAL_PROVIDER_UNKNOWN', quality: 'UNKNOWN' };
      blockers.push(`OPTIONOMICS_RESPONSE_UNRECOGNIZED:${outcome.detail}`);
    } else {
      const quality: DataQualityState =
        outcome.errorClass === 'AUTHENTICATION_FAILED' || outcome.errorClass === 'INVALID_PROVIDER_RESPONSE' ? 'INVALID'
        : outcome.errorClass === 'SUBSCRIPTION_REQUIRED' || outcome.errorClass === 'NOT_ENTITLED' ? 'NOT_ENTITLED'
        : 'DEGRADED';
      optionomicsEvidence = { origin: 'REAL_PROVIDER_ERROR', quality };
      blockers.push(`OPTIONOMICS_FETCH_FAILED:${outcome.errorClass}:${outcome.detail}`);
    }
  }

  let optionChainComplete: boolean | null = null;
  let optionContractsComplete: boolean | null = null;
  let contractsEvidence = notAttemptedEvidence();
  let quotesEvidence = notAttemptedEvidence();
  const candidates: RawCandidateInput[] = [];
  let mergedContractsForSnapshot: ReturnType<typeof mergeOptionChain> = [];
  const contractsResult = await (async () => {
    try {
      const result = await fetchOptionContracts(config.alpaca, {
        underlyingSymbol: underlying, expirationDateGte: config.optionExpirationDateGte, expirationDateLte: config.optionExpirationDateLte,
        optionType: config.optionType, limit: 100, maxPages: config.maxOptionPages,
      });
      optionContractsComplete = result.complete;
      contractsEvidence = result.complete
        ? { origin: 'REAL_PROVIDER', quality: 'GOOD' }
        : { origin: 'REAL_PROVIDER_UNKNOWN', quality: 'UNKNOWN' };
      return result;
    } catch (error) {
      contractsEvidence = failedProviderEvidence(error);
      blockers.push(`OPTION_CONTRACTS_FETCH_FAILED:${error instanceof Error ? error.message : 'unknown'}`);
      return null;
    }
  })();

  const snapshotsResult = contractsResult === null ? null : await (async () => {
    try {
      const result = await fetchOptionSnapshots(config.alpaca, {
        underlyingSymbol: underlying, feed: 'indicative', optionType: config.optionType, limit: 100, maxPages: config.maxOptionPages,
      });
      optionChainComplete = result.complete;
      quotesEvidence = result.complete
        ? { origin: 'REAL_PROVIDER', quality: 'GOOD' }
        : { origin: 'REAL_PROVIDER_UNKNOWN', quality: 'UNKNOWN' };
      return result;
    } catch (error) {
      quotesEvidence = failedProviderEvidence(error);
      blockers.push(`OPTION_SNAPSHOTS_FETCH_FAILED:${error instanceof Error ? error.message : 'unknown'}`);
      return null;
    }
  })();

  if (contractsResult !== null && snapshotsResult !== null) {

    // Exact identity only (OCC symbol, then exact underlying+expiration+
    // type+strike) -- never fuzzy. An Optionomics entry that cannot be
    // proven to match a specific Alpaca contract contributes nothing;
    // that contract's OI/volume/Greeks-fallback simply stay UNKNOWN.
    const alpacaIdentities: readonly AlpacaContractIdentity[] = contractsResult.items.map((c) => ({
      symbol: c.symbol, underlying, expiration: c.expirationDate, optionType: c.optionType, strike: c.strikePrice,
    }));
    const optionomicsBySymbol = new Map<string, OptionomicsChainEntry>();
    for (const entry of optionomicsEntries) {
      const match = matchOptionomicsContractIdentity(entry, alpacaIdentities);
      if (match.alpacaSymbol === null) continue; // UNMATCHED -- never merged on a guess
      optionomicsBySymbol.set(match.alpacaSymbol, {
        symbol: match.alpacaSymbol, delta: entry.delta, gamma: entry.gamma, theta: entry.theta, vega: entry.vega, rho: entry.rho,
        impliedVolatility: entry.impliedVolatility, volume: entry.volume, openInterest: entry.openInterest,
      });
    }

    const mergedContracts = mergeOptionChain({
      underlying, asOfDate: config.now().slice(0, 10), contracts: contractsResult.items,
      snapshotsBySymbol: snapshotsResult.snapshots, optionomicsBySymbol, requestedFeed: 'INDICATIVE',
      defaultMultiplierForUnknownContracts: 100, receivedAt, maxQuoteAgeSecondsForExecutable: 30, maxSpreadPctForExecutable: config.maxAcceptableSpreadPct,
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
  }

  // Real account exposure -- pure arithmetic over the account/positions/
  // open-orders state already fetched above. Always computed (an empty
  // account is a valid, common, real-zero-exposure state); whether any of
  // it is safe to MERGE into aegisInputs below depends on the underlying
  // fetches' quality, checked separately.
  const derivedExposure: DerivedAccountExposure = deriveAccountExposure(account, positions, openOrders);
  const exposureDerivationTrustworthy = accountEvidence.quality === 'GOOD' && positionsEvidence.quality === 'GOOD' && openOrdersEvidence.quality === 'GOOD';

  const { provenance, detail } = classifyShadowCycleProvenance({
    universeCandidates: config.universeCandidatesOrigin,
    account: accountEvidence.origin,
    positions: positionsEvidence.origin,
    openOrders: openOrdersEvidence.origin,
    marketClock: clockEvidence.origin,
    marketCalendar: calendarEvidence.origin,
    underlyingHistory: historyOrigin,
    optionContracts: contractsEvidence.origin,
    optionSnapshots: quotesEvidence.origin,
    optionomics: optionomicsEvidence.origin,
    eventState: eventStateEvidence.origin,
    aegisInputs: config.aegisInputsOrigin,
  });

  // Canonical FusionSnapshot -- ALWAYS built, even on a no-candidates path,
  // so every returned run (successful or not) carries a genuine,
  // deterministic snapshot identity. NEVER a placeholder hash.
  const snapshotInput = assembleFusionSnapshotInput({
    now: config.now(), underlying, account,
    accountOrigin: accountEvidence.origin, accountQuality: accountEvidence.quality,
    contractsOrigin: contractsEvidence.origin, contractsQuality: contractsEvidence.quality,
    quotesOrigin: quotesEvidence.origin, quotesQuality: quotesEvidence.quality,
    optionomicsOrigin: optionomicsEvidence.origin, optionomicsQuality: optionomicsEvidence.quality, optionomicsEntries,
    positions, positionsOrigin: positionsEvidence.origin, positionsQuality: positionsEvidence.quality,
    openOrders, openOrdersOrigin: openOrdersEvidence.origin, openOrdersQuality: openOrdersEvidence.quality,
    clock, clockOrigin: clockEvidence.origin, clockQuality: clockEvidence.quality,
    todaysCalendar, calendarOrigin: calendarEvidence.origin, calendarQuality: calendarEvidence.quality,
    eventState, eventStateQuality: eventStateEvidence.quality,
    derivedExposure,
    mergedContracts: [...mergedContractsForSnapshot],
    ownershipFeatures: { ret1d, rv20, drawdown, maSlope, gapFrequency, maxAdverseGap } as unknown as JsonValue,
    regimeFeatures: { maSlope, rv20, maxAdverseGap, drawdown } as unknown as JsonValue,
    policyVersion: config.policyVersion, modelVersions: config.modelVersions,
  });
  const fusionSnapshot = buildFusionSnapshot(snapshotInput);

  if (candidates.length === 0) {
    return {
      runId, startedAt, finishedAt: config.now(), universeFunnel: funnel, selectedUnderlying: underlying, underlyingRanking: ranked,
      crossSymbolComparison: shortlistProxies,
      optionChainComplete, optionContractsComplete, snapshotContentHash: fusionSnapshot.contentHash,
      snapshotValidForNewRisk: fusionSnapshot.validForNewRisk, orchestration: null, provenance, provenanceDetail: detail,
      blockers: [...blockers, 'NO_CANDIDATES_AVAILABLE'],
    };
  }

  const runtimePreconditionHoldResult = (reasonCode: string, holdDetail: string): ThetaShadowCycleResult => {
    const receipt = assembleRuntimePreconditionHold({
      snapshotId: fusionSnapshot.contentHash, fusionSnapshotHash: fusionSnapshot.contentHash, timestamp: config.now(), underlying,
      reasonCode, detail: holdDetail, policyVersion: config.policyVersion, modelVersions: config.modelVersions,
    });
    const orchestration: NewRiskOrchestrationResult = {
      receipt, ownership: null, regime: null, routing: null, thetaQ: null, aegis: null, paretoSurvivorIds: null, opportunityBook: null, shadowOpportunities: [],
      candidateEconomics: null,
    };
    return {
      runId, startedAt, finishedAt: config.now(), universeFunnel: funnel, selectedUnderlying: underlying, underlyingRanking: ranked,
      crossSymbolComparison: shortlistProxies,
      optionChainComplete, optionContractsComplete, snapshotContentHash: fusionSnapshot.contentHash,
      snapshotValidForNewRisk: fusionSnapshot.validForNewRisk, orchestration, provenance, provenanceDetail: detail, blockers,
    };
  };

  // Cross-observation temporal consistency (item B): each required real
  // observation must be individually fresh for ITS OWN class, AND the
  // required observations together must describe close-enough-to-the-same
  // moment to be treated as one coherent decision state -- see
  // temporal-consistency.ts. OPTION_QUOTE itself is deliberately NOT
  // checked here -- it remains the existing PER-CANDIDATE freshness gate
  // inside new-risk-orchestrator.ts, which already produces WAIT_LIQUIDITY
  // per candidate; duplicating it at the cycle level would double-gate the
  // same fact under two different vocabularies.
  const temporalCheck = checkTemporalConsistency(
    [
      { observationClass: 'ACCOUNT', observedAt: accountFetchedAt, required: true, valuePresent: account !== null, providerReachable: accountEvidence.quality !== 'UNKNOWN' || accountEvidence.origin === 'REAL_PROVIDER_UNKNOWN', providerEntitlement: accountEvidence.quality === 'NOT_ENTITLED' ? 'NOT_ENTITLED' : 'ENTITLED' },
      { observationClass: 'POSITIONS', observedAt: positionsFetchedAt, required: true, valuePresent: positionsEvidence.origin !== 'NOT_ATTEMPTED', providerReachable: positionsEvidence.origin !== 'NOT_ATTEMPTED', providerEntitlement: 'ENTITLED' },
      { observationClass: 'ORDERS', observedAt: openOrdersFetchedAt, required: true, valuePresent: openOrdersEvidence.origin !== 'NOT_ATTEMPTED', providerReachable: openOrdersEvidence.origin !== 'NOT_ATTEMPTED', providerEntitlement: 'ENTITLED' },
      { observationClass: 'MARKET_CLOCK', observedAt: clock?.timestamp ?? null, required: true, valuePresent: clock !== null, providerReachable: clockEvidence.origin !== 'NOT_ATTEMPTED', providerEntitlement: 'ENTITLED' },
    ],
    config.now(),
    DEFAULT_TEMPORAL_CONSISTENCY_POLICIES.NEW_RISK,
  );
  if (!temporalCheck.ok) {
    return runtimePreconditionHoldResult(temporalCheck.reasonCode, temporalCheck.detail);
  }

  // A confirmed clock/calendar DISAGREEMENT is caught before trusting
  // either one alone: the calendar has no scheduled session today at all,
  // yet the clock reports the market open right now. This is an
  // inconsistent session state, not an ordinary closed-market precondition
  // -- it gets its own reason so it is never silently treated as either
  // "market open, proceed" or "market closed, MARKET_CLOSED".
  if (clockEvidence.quality === 'GOOD' && calendarEvidence.quality === 'GOOD' && clock?.isOpen === true && todaysCalendar.length === 0) {
    return runtimePreconditionHoldResult(
      'SYSTEM_HOLD_SESSION_INCONSISTENT',
      `Alpaca's clock reports the market open, but the calendar has no scheduled session for ${todayDate} -- clock/calendar disagreement, never trusted blindly.`,
    );
  }

  // A confirmed-closed market is a real, known VALUE -- an operational
  // precondition, never a strategy WAIT/PASS and never a provider-quality
  // SYSTEM_HOLD. Only short-circuits on a TRUSTWORTHY confirmation
  // (clockEvidence.quality === 'GOOD', i.e. the clock call actually
  // succeeded and returned isOpen) -- an unreachable/unknown clock still
  // falls through to the normal provider-capability gate below, which
  // already handles genuine data-quality uncertainty correctly.
  if (clockEvidence.quality === 'GOOD' && clock?.isOpen === false) {
    // A genuine holiday (no scheduled session today at all, on what would
    // otherwise be a trading weekday) is distinguished from ordinary
    // after-hours/weekend closure -- both are real operational facts, but
    // a holiday is worth naming precisely for scheduler/ops visibility.
    const dayOfWeek = new Date(`${todayDate}T00:00:00Z`).getUTCDay(); // 0=Sun, 6=Sat -- UTC approximation, not exchange-local
    const isWeekday = dayOfWeek !== 0 && dayOfWeek !== 6;
    if (calendarEvidence.quality === 'GOOD' && isWeekday && todaysCalendar.length === 0) {
      return runtimePreconditionHoldResult('MARKET_HOLIDAY', `No scheduled session for ${todayDate} despite being a weekday -- treated as a market holiday; nextOpen=${clock.nextOpen ?? 'UNKNOWN'}.`);
    }
    return runtimePreconditionHoldResult('MARKET_CLOSED', `Market is confirmed closed (nextOpen=${clock.nextOpen ?? 'UNKNOWN'}); new-risk evaluation deferred to the next session.`);
  }

  // Merge the real, derived exposure ratios into aegisInputs -- see
  // mergeDerivedExposureIntoAegisInputs's own docstring for the honesty
  // rules (partial merge only; sector/correlation/stress remain exactly
  // what the caller supplied).
  let effectiveAegisInputs = mergeDerivedExposureIntoAegisInputs(config.aegisInputs, derivedExposure, exposureDerivationTrustworthy);

  // Additional real AEGIS-input derivations (item E) -- each independently
  // null/UNKNOWN (never overwriting the caller's value with a guess) when
  // its own required evidence is missing. See aegis-derivation.ts's own
  // docstring for exactly which fields remain caller-supplied and why
  // (sector concentration, correlation clusters, IV-shock/spread-widening
  // detection all lack a real data source this pass).
  const derivedProviderState = deriveProviderState([accountEvidence.quality, contractsEvidence.quality, quotesEvidence.quality]);
  const derivedLiquidityAcceptable = deriveLiquidityAcceptable(mergedContractsForSnapshot, config.maxAcceptableSpreadPct);
  const derivedExecutionQualityAcceptable = deriveExecutionQualityAcceptable(mergedContractsForSnapshot);
  effectiveAegisInputs = {
    ...effectiveAegisInputs,
    ...(derivedProviderState !== null ? { providerState: derivedProviderState } : {}),
    ...(derivedLiquidityAcceptable !== null ? { liquidityAcceptable: derivedLiquidityAcceptable } : {}),
    ...(derivedExecutionQualityAcceptable !== null ? { executionQualityAcceptable: derivedExecutionQualityAcceptable } : {}),
    stressGapDetected: deriveStressGapDetected(ret1d, config.stressGapThresholdAbsReturn),
  };

  const orchestration = await runNewRiskOrchestration(config.bridge, {
    snapshotId: fusionSnapshot.contentHash, fusionSnapshotHash: fusionSnapshot.contentHash, timestamp: config.now(), underlying,
    earningsDistanceDays: eventState?.earnings.distanceDays ?? null, // always null this pass -- no real earnings-date source is wired yet, never fabricated as "no earnings nearby"
    optionQuoteFreshnessPolicy: config.optionQuoteFreshnessPolicy,
    providerCapabilities: {
      ALPACA_ACCOUNT: accountEvidence.quality,
      ALPACA_OPTION_CONTRACTS: contractsEvidence.quality,
      ALPACA_OPTION_CHAIN: quotesEvidence.quality,
      ALPACA_POSITIONS: positionsEvidence.quality,
      ALPACA_OPEN_ORDERS: openOrdersEvidence.quality,
      OPTIONOMICS: optionomicsEvidence.quality,
      EVENT_DATA: eventStateEvidence.quality,
    },
    policyVersion: config.policyVersion, modelVersions: config.modelVersions, requiredModelVersions: config.requiredModelVersions,
    ownershipPolicy: config.ownershipPolicy,
    ownershipInputs: {
      stockAvgVolume: null, optionOpenInterest: null, optionVolume: null, spreadPct: null,
      ret1d, ret5d: null, ret20d: null, ret60d: null, ma20Rel: null, ma50Rel: null, ma200Rel: null,
      maSlope, relativeStrength: null, rv10: null, rv20, rv60: null, drawdown, maxAdverseGap,
      gapFrequency, downsideSemivariance: null, historicalRecoveryMedianDays: null, historicalRecoveryP95Days: null,
      severeDrawdownEpisodeCount: null, earningsDistanceDays: eventState?.earnings.distanceDays ?? null,
      exDividendDistanceDays: eventState?.exDividend.distanceDays ?? null,
      knownEventDistanceDays: corporateEventDistanceDays,
    },
    regimePolicy: config.regimePolicy,
    regimeInputs: {
      maSlope, rv20, maxAdverseGap, earningsDistanceDays: eventState?.earnings.distanceDays ?? null,
      corporateActionPending: corporateEventDistanceDays !== null && Math.abs(corporateEventDistanceDays) <= 10,
      macroRiskFlag: false, spreadPct: null, portfolioOrMarketDrawdown: drawdown,
    },
    routerPolicy: config.routerPolicy, routerPortfolio: config.routerPortfolio,
    latticeConfig: config.latticeConfig, thetaQSizingPolicy: config.thetaQSizingPolicy, costAssumptions: config.costAssumptions,
    aegisPolicy: config.aegisPolicy, aegisInputs: effectiveAegisInputs,
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
    crossSymbolComparison: shortlistProxies,
    optionChainComplete, optionContractsComplete, snapshotContentHash: fusionSnapshot.contentHash,
    snapshotValidForNewRisk: fusionSnapshot.validForNewRisk, orchestration, provenance, provenanceDetail: detail, blockers,
  };
}
