import { randomUUID } from 'node:crypto';
import {
  AlpacaProviderError,
  fetchMarketCalendar, fetchMarketClock, fetchMasterAccountSnapshot, fetchOpenOrders, fetchOptionContracts, fetchOptionSnapshots,
  fetchPositions, fetchStockBars, fetchLatestStockQuote, type AlpacaCalendarSession, type AlpacaMarketClock, type AlpacaOpenOrderSnapshot, type AlpacaPositionSnapshot,
  type AlpacaProviderConfig, type MasterAccountSnapshot,
} from './alpaca-provider.js';
import type { HistoricalBar } from './underlying-history.js';
import { mergeOptionChain, type AlpacaOptionContractListing, type AlpacaOptionSnapshot, type OptionomicsChainEntry } from './option-chain-ingestion.js';
import { computeAverageVolume, computeCurrentDrawdown, computeDownsideSemivariance, computeGapFrequency, computeMaxAdverseGap,
  computeMovingAverageRelative, computeRealizedVolatility, computeReturn, computeTrendSlope } from './underlying-features.js';
import { evaluateUniverse, rankEligibleUnderlyings, type RankedUnderlying, type UnderlyingCandidateInput, type UnderlyingDecision, type UniverseFunnelReport, type UniversePolicy } from './universe-policy.js';
import { runNewRiskOrchestration, type NewRiskOrchestrationRequest, type NewRiskOrchestrationResult, type RawCandidateInput } from './new-risk-orchestrator.js';
import { assembleNoCandidateDecision, assembleRuntimePreconditionHold } from './decision-assembly.js';
import { checkTemporalConsistency, DEFAULT_TEMPORAL_CONSISTENCY_POLICIES } from './temporal-consistency.js';
import type { PythonBridgeConfig } from './python-bridge.js';
import { buildFusionSnapshot, hashJson, type FusionSnapshot, type FusionSnapshotInput, type JsonValue } from '../market/fusion-snapshot.js';
import type { AegisIvStressAssessment } from './aegis-iv-stress.js';
import { compareIvStressSignals, type AlpacaContractIvAssessment,
  type AlpacaContractIvAssessmentMap } from './aegis-alpaca-iv-stress.js';
import type { AegisSpreadStressAssessment, AegisSpreadStressAssessmentMap } from './aegis-spread-stress.js';
import type { NormalizedOptionContract } from './option-contract.js';
import type { DataQualityState } from './data-freshness.js';
import {
  fetchOptionomicsContextObservation, fetchOptionomicsMacroEventCoverage, fetchOptionomicsNetFlowWindow, fetchOptionomicsOptionChain, matchOptionomicsContractIdentity,
  type AlpacaContractIdentity, type NormalizedOptionomicsChain, type NormalizedOptionomicsContextObservation, type NormalizedOptionomicsEntry,
  type NormalizedOptionomicsFlowWindow, type OptionomicsContextFamily, type OptionomicsProviderConfig,
} from './optionomics-provider.js';
import { buildOptionomicsFeatureSnapshot } from './optionomics-feature-engine.js';
import {
  deriveAccountExposure,
  deriveCandidateCapacityAssessment,
  mergeDerivedExposureIntoAegisInputs,
  type CandidateCapacityPolicy,
  type DerivedAccountExposure,
  deriveRecoveryInventoryValue,
} from './account-exposure.js';
import { assessAegisGapStress, deriveCandidateMarketQuality, deriveExecutionQualityAcceptable, deriveLiquidityAcceptable, deriveProviderState } from './aegis-derivation.js';
import { buildCanonicalStrategyFrontier, type CanonicalStrategyFrontier } from './canonical-strategy-frontier.js';
import { canonicalThetaStrategySources } from './strategy-package.js';
import {
  buildStrategyQualityShadowDiagnostic,
  type StrategyQualityShadowDiagnostic,
} from '../research/strategy-quality-shadow-diagnostics.js';
import type { PaperEntryBootstrapAssessment } from './paper-entry-bootstrap.js';
import type { RecoveryHistoryEvidence } from './recovery-history-loader.js';
import { paperBootstrapStressApplicability, paperBootstrapStressColdStartPolicy } from '../research/aegis-stress-baseline-maturity.js';
import {
  buildFinalistQuoteRefreshReceipt,
  finalistQuoteRefreshMaxAgeSeconds,
  selectFinalistContractsForRefresh,
  type FinalistQuoteRefreshObservation,
  type FinalistQuoteRefreshPolicy,
  type FinalistQuoteRefreshReceipt,
} from './finalist-quote-refresh.js';
import { deriveOptionomicsEarningsEvidence, type OptionomicsEarningsEvidence } from './earnings-event-evidence.js';
import { deriveMacroRiskEvidence, type MacroRiskEvidence } from './macro-event-policy.js';
import { assessPortfolioCorrelation, type PortfolioCorrelationObservation } from './portfolio-correlation-evidence.js';

/** Never relabel a Conventional assessment as Hold-Strike risk evidence. */
export function conventionalFrontierRiskLookups(
  candidates: readonly { readonly optionSymbol: string; readonly brokerAllowedQty: number }[],
  aegisByOptionSymbol?: Readonly<Record<string, {
    readonly newRiskState: NonNullable<NewRiskOrchestrationResult['aegis']>['newRiskState'];
    readonly families?: readonly { readonly family: string; readonly state: string;
      readonly reasons: readonly { readonly code: string }[] }[];
  }>>,
): {
  readonly brokerAllowedQtyByCandidateId: Readonly<Record<string, number>>;
  readonly aegisNewRiskStateByCandidateId: Readonly<Record<string, NonNullable<NewRiskOrchestrationResult['aegis']>['newRiskState']>> | undefined;
  readonly aegisBindingReasonsByCandidateId: Readonly<Record<string, readonly string[]>> | undefined;
} {
  return {
    brokerAllowedQtyByCandidateId: Object.fromEntries(candidates.map((candidate) => [
      `THETA_CONVENTIONAL:${candidate.optionSymbol}`, candidate.brokerAllowedQty,
    ])),
    aegisNewRiskStateByCandidateId: aegisByOptionSymbol === undefined ? undefined : Object.fromEntries(
      Object.entries(aegisByOptionSymbol).map(([optionSymbol, assessment]) => [
        `THETA_CONVENTIONAL:${optionSymbol}`, assessment.newRiskState,
      ]),
    ),
    aegisBindingReasonsByCandidateId: aegisByOptionSymbol === undefined ? undefined : Object.fromEntries(
      Object.entries(aegisByOptionSymbol).map(([optionSymbol, assessment]) => [
        `THETA_CONVENTIONAL:${optionSymbol}`,
        (assessment.families ?? []).flatMap((family) => ['ALLOW_FULL','ALLOW_REDUCED'].includes(family.state)
          ? [] : family.reasons.map((reason) => `${family.family}:${reason.code}`)),
      ]),
    ),
  };
}

/** The single Production mapping from persisted detector results into the
 * candidate-specific Python AEGIS contract. An accumulating baseline stays
 * null and gains only the explicit Paper cold-start applicability marker.
 * Invalid or stale current evidence remains REQUIRED. */
export function candidateStressAegisOverrides(input: {
  readonly spread: AegisSpreadStressAssessment | undefined;
  readonly alpacaIv: AlpacaContractIvAssessment | undefined;
  readonly alpacaIvProducerConfigured: boolean;
}): Readonly<Record<string, unknown>> {
  return {
    stressSpreadWideningDetected: input.spread?.stressSpreadWideningDetected ?? null,
    stressSpreadWideningApplicability: paperBootstrapStressApplicability(input.spread?.maturity.state ?? null),
    ...(input.alpacaIvProducerConfigured ? {
      stressIvShockDetected: input.alpacaIv?.stressIvShockDetected ?? null,
      stressIvShockApplicability: input.alpacaIv?.currentState === 'QUALIFIED'
        ? paperBootstrapStressApplicability(input.alpacaIv.maturity.state) : 'REQUIRED',
    } : {}),
  };
}

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
//   - Positions and open orders are fetched inside every cycle. The
//     account ratios derivable from them feed AEGIS. IV shock is supplied
//     from the Production Optionomics baseline and spread widening is
//     assessed per contract from persisted Alpaca BBO history. Sector and
//     multi-position correlation can still remain incomplete.
//   - Event state is always UNKNOWN (no event-state assembly exists yet).
//   - Underlying selection ranks eligible underlyings transparently (see
//     universe-policy.ts's rankEligibleUnderlyings) rather than picking
//     input order, but v1's ranking feature (avgDollarVolume) is itself an
//     honest placeholder, not real economic ranking -- see that function's
//     own docstring.
//   - Event state is still UNKNOWN. Market calendar/session truth is now
//     required alongside the clock before an open-session new-risk scan.
// A cycle run through this function can therefore never legitimately be
// classified FULL_REAL (see classifyShadowCycleProvenance) -- at best
// HYBRID, and only once real credentials make the Alpaca calls succeed.

export interface ThetaShadowCycleConfig {
  readonly alpaca: AlpacaProviderConfig;
  readonly optionomics: OptionomicsProviderConfig | null; // null when Optionomics credentials are not configured -- honestly NOT_ATTEMPTED, never a fixture
  readonly optionomicsContextPolicy?: {
    readonly policyVersion: string;
    readonly families: readonly OptionomicsContextFamily[];
    readonly maxRequestsPerCycle: number;
    readonly cadenceMinutesByFamily?: Readonly<Partial<Record<OptionomicsContextFamily, number>>>;
    readonly eventLookaheadDays: number;
  };
  readonly bridge: PythonBridgeConfig;
  readonly universePolicy: UniversePolicy;
  readonly universeCandidates: readonly UnderlyingCandidateInput[]; // caller supplies the raw per-underlying facts; a full Alpaca-asset-universe fetch is not built this pass
  readonly universeCandidatesOrigin: ProvenanceOrigin; // caller must honestly declare whether these facts came from a real asset-discovery call or a fixture/manual list -- drives automatic provenance, never guessed
  readonly evaluationMode?: 'STANDARD' | 'SHADOW_EVIDENCE';
  readonly optionExpirationDateGte: string;
  readonly optionExpirationDateLte: string;
  // Additional contract coverage for research branches only. It never
  // changes the Conventional lattice or grants a branch Paper authority.
  readonly shadowResearchExpirationDateGte?: string;
  readonly shadowResearchExpirationDateLte?: string;
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
  readonly aegisIvStressEvidence?: AegisIvStressAssessment | null;
  readonly aegisAlpacaIvStressAssessor?: (input: {
    readonly contracts: readonly NormalizedOptionContract[];
    readonly decisionAsOf: string;
  }) => Promise<AlpacaContractIvAssessmentMap>;
  readonly aegisSpreadStressAssessor?: (input: {
    readonly contracts: readonly NormalizedOptionContract[];
    readonly decisionAsOf: string;
  }) => Promise<AegisSpreadStressAssessmentMap>;
  readonly aegisInputsOrigin: ProvenanceOrigin; // Production passes real-derived observations or explicit UNKNOWN
  readonly opportunityFrontierPolicy: { policyVersion: string; reducedSizeUncertaintyThreshold: number };
  readonly maxAcceptableSpreadPct: number;
  readonly stressGapThresholdAbsReturn: number; // existing Paper bootstrap threshold, not empirically optimal
  readonly sizingPolicy: Record<string, unknown>;
  readonly executionQualityPolicy: Record<string, unknown>;
  /** Candidate-stage Alpaca BBO age. This is independent of the later
   * execution-quality and pre-submit quote qualifications. */
  readonly candidateQuoteAgePolicy: {
    readonly policyVersion: string;
    readonly effectiveAt: string;
    readonly maxAgeSeconds: number;
  };
  /** Bounded exact-contract quote refresh performed after structural
   * candidate construction and before FusionSnapshot/AEGIS. */
  readonly finalistQuoteRefreshPolicy: FinalistQuoteRefreshPolicy;
  readonly optionQuoteFreshnessPolicy: NewRiskOrchestrationRequest['optionQuoteFreshnessPolicy'];
  readonly policyVersion: string;
  readonly modelVersions: Readonly<Record<string, string>>;
  readonly requiredModelVersions: Readonly<Record<string, string>>;
  readonly now: () => string;
  readonly paperEntryBootstrap?: PaperEntryBootstrapAssessment;
  readonly recoveryHistory?: RecoveryHistoryEvidence;
  readonly recoveryInventoryUnderlyings?: readonly string[];
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
  readonly fusionSnapshot: FusionSnapshot | null; // complete immutable evidence required by durable persistence and replay
  readonly snapshotValidForNewRisk: boolean | null;
  readonly orchestration: NewRiskOrchestrationResult | null;
  readonly strategyFrontier: CanonicalStrategyFrontier | null;
  readonly strategyQualityDiagnostics: StrategyQualityShadowDiagnostic | null;
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

export function candidateQuoteAgeSeconds(config: Pick<ThetaShadowCycleConfig, 'candidateQuoteAgePolicy'>, asOf: string): number {
  const { policyVersion, effectiveAt, maxAgeSeconds } = config.candidateQuoteAgePolicy;
  const effectiveMs = Date.parse(effectiveAt);
  const asOfMs = Date.parse(asOf);
  if (policyVersion.trim() === '' || !Number.isFinite(effectiveMs) || !Number.isFinite(asOfMs)
    || effectiveMs > asOfMs || !Number.isFinite(maxAgeSeconds) || maxAgeSeconds <= 0) {
    throw new Error('CANDIDATE_QUOTE_AGE_POLICY_INVALID');
  }
  return maxAgeSeconds;
}

function dueOptionomicsContextFamilies(config: ThetaShadowCycleConfig, decisionTime: string): readonly OptionomicsContextFamily[] {
  const policy = config.optionomicsContextPolicy;
  if (policy === undefined || policy.maxRequestsPerCycle <= 0) return [];
  const minute = Math.floor(Date.parse(decisionTime) / 60_000);
  if (!Number.isFinite(minute)) return [];
  const due = [...new Set(policy.families)].filter((family) => {
    const cadence = policy.cadenceMinutesByFamily?.[family] ?? 1;
    return Number.isInteger(cadence) && cadence > 0 && minute % cadence === 0;
  });
  // A bounded event search can require four pages/requests, so count that
  // reservation against the shared provider budget before choosing families.
  due.sort((a, b) => Number(b === 'EVENTS') - Number(a === 'EVENTS'));
  let remaining = Math.floor(policy.maxRequestsPerCycle);
  return due.filter((family) => {
    const cost = family === 'EVENTS' ? 4 : 1;
    if (cost > remaining) return false;
    remaining -= cost;
    return true;
  });
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
  readonly universeEventEvidence: Pick<UnderlyingCandidateInput, 'unsupportedCorporateActionPending' | 'eventNear'> | null;
  readonly universeDecision: UnderlyingDecision | null;
  readonly account: MasterAccountSnapshot | null;
  readonly accountOrigin: ProvenanceOrigin;
  readonly accountQuality: DataQualityState;
  readonly contractsOrigin: ProvenanceOrigin;
  readonly contractsQuality: DataQualityState;
  readonly quotesOrigin: ProvenanceOrigin;
  readonly quotesQuality: DataQualityState;
  readonly optionomicsOrigin: ProvenanceOrigin;
  readonly optionomicsQuality: DataQualityState;
  readonly optionomicsChain: NormalizedOptionomicsChain | null;
  readonly optionomicsEntries: readonly NormalizedOptionomicsEntry[];
  readonly optionomicsFlowWindows: readonly NormalizedOptionomicsFlowWindow[];
  readonly optionomicsContextObservations: readonly NormalizedOptionomicsContextObservation[];
  readonly macroEventCoverage: Awaited<ReturnType<typeof fetchOptionomicsMacroEventCoverage>> | null;
  readonly optionomicsContextOrigin: ProvenanceOrigin;
  readonly optionomicsContextQuality: DataQualityState;
  readonly optionomicsFlowOrigin: ProvenanceOrigin;
  readonly optionomicsFlowQuality: DataQualityState;
  readonly positions: readonly AlpacaPositionSnapshot[];
  readonly positionsOrigin: ProvenanceOrigin;
  readonly positionsQuality: DataQualityState;
  readonly openOrders: readonly AlpacaOpenOrderSnapshot[];
  readonly openOrdersOrigin: ProvenanceOrigin;
  readonly openOrdersQuality: DataQualityState;
  readonly clock: AlpacaMarketClock | null;
  readonly clockOrigin: ProvenanceOrigin;
  readonly clockQuality: DataQualityState;
  readonly calendar: readonly AlpacaCalendarSession[];
  readonly calendarOrigin: ProvenanceOrigin;
  readonly calendarQuality: DataQualityState;
  readonly derivedExposure: DerivedAccountExposure;
  readonly portfolioCorrelation: PortfolioCorrelationObservation | null;
  readonly mergedContracts: FusionSnapshotInput['contractCandidates'];
  readonly ownershipFeatures: JsonValue;
  readonly regimeFeatures: JsonValue;
  readonly policyVersion: string;
  readonly modelVersions: Readonly<Record<string, string>>;
  readonly aegisIvStressEvidence: AegisIvStressAssessment | null;
  readonly aegisAlpacaIvStressEvidence: AlpacaContractIvAssessmentMap;
  readonly aegisSpreadStressEvidence: AegisSpreadStressAssessmentMap;
  readonly finalistQuoteRefresh: FinalistQuoteRefreshReceipt | null;
  readonly earningsEvidence: OptionomicsEarningsEvidence;
  readonly macroRiskEvidence: MacroRiskEvidence;
}): FusionSnapshotInput {
  const accountJson: JsonValue = params.account === null ? { fetched: false } : { ...params.account };
  const contractsJson: JsonValue = params.mergedContracts as unknown as JsonValue;
  const optionomicsAttempted = params.optionomicsOrigin !== 'NOT_ATTEMPTED';
  const optionomicsFeatures = params.optionomicsChain === null ? null : buildOptionomicsFeatureSnapshot({
    chain: params.optionomicsChain,
    flowWindows: params.optionomicsFlowWindows,
    contextObservations: params.optionomicsContextObservations,
    stockPrice: params.mergedContracts[0]?.underlyingLast ?? null,
    multiplierByContract: new Map(params.mergedContracts
      .filter((contract): contract is typeof contract & { occSymbol: string } => contract.occSymbol !== null)
      .map((contract) => [contract.occSymbol, contract.multiplier])),
  });
  const optionomicsProviderTimestamp = params.optionomicsChain?.entries.map((entry) => entry.asOf)
    .filter((value): value is string => value !== null && Number.isFinite(Date.parse(value)) && Date.parse(value) <= Date.parse(params.now))
    .toSorted((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null;
  const spreadStressBaselines: Record<string, JsonValue> = {};
  const spreadStressByContract: Record<string, JsonValue> = {};
  for (const [optionSymbol, assessment] of Object.entries(params.aegisSpreadStressEvidence)) {
    const cohortKey = [assessment.underlying, assessment.dteBucket, assessment.moneynessBucket ?? 'UNKNOWN'].join(':');
    if (spreadStressBaselines[cohortKey] === undefined) spreadStressBaselines[cohortKey] = {
      baselineEvidenceIds: assessment.baselineEvidenceIds,
      baselineEvidenceHash: hashJson(assessment.baselineEvidenceIds as unknown as JsonValue),
      evidenceCount: assessment.baselineEvidenceIds.length,
    } as unknown as JsonValue;
    const compact = { ...assessment } as Record<string, unknown>;
    delete compact.baselineEvidenceIds;
    spreadStressByContract[optionSymbol] = { ...compact, baselineCohortKey: cohortKey } as unknown as JsonValue;
  }
  const optionomicsJson: JsonValue = optionomicsAttempted
    ? ({
        rawObservation: params.optionomicsChain === null ? null : {
          responseHash: params.optionomicsChain.responseHash,
          requestedAt: params.optionomicsChain.requestedAt,
          retrievedAt: params.optionomicsChain.retrievedAt,
          providerTimestamp: optionomicsProviderTimestamp,
          requestPath: params.optionomicsChain.requestPath,
          requestParameters: params.optionomicsChain.requestParameters,
          httpStatus: params.optionomicsChain.httpStatus,
          rateLimit: params.optionomicsChain.rateLimit,
          documentationReference: params.optionomicsChain.documentationReference,
          contractVersion: params.optionomicsChain.contractVersion,
          credentialIdentityRefHash: params.optionomicsChain.credentialIdentityRefHash,
          sessionDate: params.optionomicsChain.sessionDate,
          payload: params.optionomicsChain.rawPayload,
        },
        rawObservations: [
          ...(params.optionomicsChain === null ? [] : [{
            operationAlias: 'optionomics.get_option_chain', responseHash: params.optionomicsChain.responseHash,
            requestedAt: params.optionomicsChain.requestedAt, retrievedAt: params.optionomicsChain.retrievedAt,
            providerTimestamp: optionomicsProviderTimestamp, requestPath: params.optionomicsChain.requestPath,
            requestParameters: params.optionomicsChain.requestParameters, httpStatus: params.optionomicsChain.httpStatus,
            rateLimit: params.optionomicsChain.rateLimit, documentationReference: params.optionomicsChain.documentationReference,
            contractVersion: params.optionomicsChain.contractVersion, credentialIdentityRefHash: params.optionomicsChain.credentialIdentityRefHash,
            sessionDate: params.optionomicsChain.sessionDate, payload: params.optionomicsChain.rawPayload,
          }]),
          ...params.optionomicsContextObservations.map((observation) => ({
            operationAlias: observation.operationAlias, responseHash: observation.responseHash,
            requestedAt: observation.requestedAt, retrievedAt: observation.retrievedAt,
            providerTimestamp: observation.providerTimestamp, requestPath: observation.requestPath,
            requestParameters: observation.requestParameters, httpStatus: observation.httpStatus,
            rateLimit: observation.rateLimit, documentationReference: observation.documentationReference,
            contractVersion: observation.contractVersion, credentialIdentityRefHash: observation.credentialIdentityRefHash,
            sessionDate: observation.sessionDate, payload: observation.rawPayload,
          })),
        ],
        optionChain: params.optionomicsEntries,
        netFlowWindows: params.optionomicsFlowWindows,
        features: optionomicsFeatures,
      } as unknown as JsonValue)
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
  if (!optionomicsAttempted) {
    unknownFeatures.push({ feature: 'optionFlowTrajectory', reasonCode: 'OPTIONOMICS_NOT_CONFIGURED', provider: null });
  } else if (params.optionomicsFlowQuality !== 'GOOD') {
    unknownFeatures.push({ feature: 'optionFlowTrajectory', reasonCode: `OPTIONOMICS_${params.optionomicsFlowQuality}`, provider: 'OPTIONOMICS' });
  }
  const eventContextObservations = params.optionomicsContextObservations.filter((observation) =>
    observation.family === 'EVENTS' || observation.family === 'EARNINGS_FILINGS' || observation.family === 'SYMBOL_NEWS');
  const eventContextPopulated = eventContextObservations.some((observation) => observation.populated);
  if (!eventContextPopulated) {
    unknownFeatures.push({ feature: 'eventState', reasonCode: 'OPTIONOMICS_EVENT_CONTEXT_NOT_OBSERVED_THIS_CYCLE', provider: 'OPTIONOMICS' });
  }

  const positionsJson: JsonValue = params.positions as unknown as JsonValue;
  const openOrdersJson: JsonValue = params.openOrders as unknown as JsonValue;

  return {
    botId: 'THETA',
    decisionTimeUtc: params.now,
    triggerType: 'SHADOW_CYCLE',
    marketSession: params.clock !== null
      ? ({ isOpen: params.clock.isOpen, nextOpen: params.clock.nextOpen, nextClose: params.clock.nextClose, asOf: params.clock.timestamp, calendar: params.calendar } as unknown as JsonValue)
      : null, // honestly absent when the clock fetch never returned a usable value -- never fabricated as "regular session"
    underlyingState: { symbol: params.underlying, eventEvidence: params.universeEventEvidence,
      universeDecision: params.universeDecision },
    contractCandidates: params.mergedContracts,
    accountState: accountJson,
    positionState: { positions: positionsJson, openOrders: openOrdersJson },
    portfolioExposure: { ...params.derivedExposure,
      correlationObservation: params.portfolioCorrelation } as unknown as JsonValue,
    alpacaQuoteState: params.finalistQuoteRefresh,
    optionomicsFeatureState: optionomicsAttempted ? optionomicsJson : null, // honestly absent when not configured, never fabricated
    eventState: eventContextObservations.length > 0 || params.macroEventCoverage !== null
      ? ({ provider: 'OPTIONOMICS', observations: eventContextObservations,
          populated: eventContextPopulated,
          macroFedCoverage: params.macroEventCoverage === null ? null : {
            state: params.macroEventCoverage.state, reason: params.macroEventCoverage.reason,
            from: params.macroEventCoverage.from, to: params.macroEventCoverage.to,
            families: params.macroEventCoverage.families,
            providerEventCount: params.macroEventCoverage.providerEventCount,
            negativeQualified: params.macroEventCoverage.negativeQualified,
          },
          macroRisk: params.macroRiskEvidence,
          earningsDistance: params.earningsEvidence,
          earningsDistanceDays: null, exDividendState: null,
          missingSemantics: ['EARNINGS_CALENDAR_DAY_DISTANCE_NOT_PROVEN',
            'EARNINGS_NEGATIVE_ASSURANCE_UNAVAILABLE', 'EX_DIVIDEND_STATE_UNAVAILABLE'] } as unknown as JsonValue)
      : null,
    regimeState: params.regimeFeatures,
    expertPriorState: null,
    riskState: { ivStress: params.aegisIvStressEvidence,
      alpacaContractIvStress: { methodology: 'ALPACA_CONTRACT_IV_COHORT_SHOCK',
        assessmentsByContract: params.aegisAlpacaIvStressEvidence },
      ivStressShadowComparison: compareIvStressSignals({ alpacaByContract: params.aegisAlpacaIvStressEvidence,
        optionomics: params.aegisIvStressEvidence }),
      stressColdStartPolicy: paperBootstrapStressColdStartPolicy,
      spreadStress: { assessmentsByContract: spreadStressByContract, baselinesByCohort: spreadStressBaselines } } as unknown as JsonValue,
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
        state: optionomicsAttempted ? params.optionomicsQuality : 'UNKNOWN', contentHash: hashJson(params.optionomicsEntries as unknown as JsonValue), feed: null,
        contractVersion: 'optionomics-option-chain-v1', truthRole: 'CONTEXT', requiredForNewRisk: false,
      },
      {
        provider: 'OPTIONOMICS', operationAlias: 'optionomics.get_flow_net', asOf: params.optionomicsFlowOrigin === 'REAL_PROVIDER' ? params.now : null, retrievedAt: params.now,
        state: optionomicsAttempted ? params.optionomicsFlowQuality : 'UNKNOWN', contentHash: hashJson(params.optionomicsFlowWindows as unknown as JsonValue), feed: null,
        contractVersion: 'optionomics-net-flow-windows-v1', truthRole: 'CONTEXT', requiredForNewRisk: false,
      },
      ...params.optionomicsContextObservations.map((observation) => ({
        provider: 'OPTIONOMICS' as const, operationAlias: observation.operationAlias,
        asOf: observation.providerTimestamp ?? (observation.sessionDate === null ? null : `${observation.sessionDate}T00:00:00.000Z`), retrievedAt: observation.retrievedAt,
        state: observation.populated ? 'GOOD' as const : 'UNKNOWN' as const, contentHash: observation.responseHash,
        feed: null, contractVersion: observation.contractVersion, truthRole: 'CONTEXT' as const, requiredForNewRisk: false,
      })),
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
        state: params.calendarQuality, contentHash: hashJson(params.calendar as unknown as JsonValue), feed: null,
        contractVersion: 'alpaca-calendar-v1', truthRole: 'CONTEXT', requiredForNewRisk: false,
      },
    ],
    providerHealth: [
      {
        provider: 'ALPACA',
        state: aggregateProviderQuality([params.accountQuality, params.contractsQuality, params.quotesQuality, params.positionsQuality, params.openOrdersQuality, params.clockQuality, params.calendarQuality]),
        asOf: params.now, retrievedAt: params.now,
      },
      { provider: 'OPTIONOMICS', state: optionomicsAttempted ? aggregateProviderQuality([params.optionomicsQuality, params.optionomicsFlowQuality, params.optionomicsContextQuality]) : 'UNKNOWN', asOf: optionomicsAttempted ? params.now : null, retrievedAt: params.now },
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

function validContractDateRange(gte: string, lte: string): boolean {
  const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  return validDate(gte) && validDate(lte) && gte <= lte;
}

function traceShadowStage(symbol: string, stage: string, detail: Readonly<Record<string, string | number | boolean>>): void {
  if (process.env.VERCEL_ENV !== 'production') return;
  // Counts and timings only. Never log provider payloads, URLs or credentials.
  console.info(JSON.stringify({ event: 'THETA_SHADOW_STAGE_V1', symbol, stage, ...detail,
    rssMb: Math.round(process.memoryUsage().rss / 1_048_576) }));
}

export async function runThetaShadowCycle(config: ThetaShadowCycleConfig): Promise<ThetaShadowCycleResult> {
  if (!validContractDateRange(config.optionExpirationDateGte, config.optionExpirationDateLte)) {
    throw new Error('PRIMARY_CONTRACT_DATE_RANGE_INVALID');
  }
  const researchGte = config.shadowResearchExpirationDateGte;
  const researchLte = config.shadowResearchExpirationDateLte;
  if ((researchGte === undefined) !== (researchLte === undefined)
    || (researchGte !== undefined && researchLte !== undefined && !validContractDateRange(researchGte, researchLte))) {
    throw new Error('SHADOW_RESEARCH_CONTRACT_DATE_RANGE_INVALID');
  }
  const runId = randomUUID();
  const startedAt = config.now();
  // The cycle start bounds the provider requests. The immutable decision
  // timestamp is finalized after observations are collected, so a quote
  // produced during this cycle can never appear to come from the future.
  let decisionTime = startedAt;
  const blockers: string[] = [];

  const { decisions, funnel } = evaluateUniverse(config.universePolicy, config.universeCandidates);
  const inputsBySymbol = new Map(config.universeCandidates.map((c) => [c.symbol, c]));
  const ranked = config.evaluationMode === 'SHADOW_EVIDENCE'
    ? decisions.filter((decision) => decision.state !== 'REJECTED').map((decision) => inputsBySymbol.get(decision.symbol))
      .filter((input): input is UnderlyingCandidateInput => input !== undefined && input.currentPrice !== null
        && input.avgDollarVolume !== null && input.hasUsableOptionChain !== false)
      .sort((a,b) => (b.avgDollarVolume as number)-(a.avgDollarVolume as number) || a.symbol.localeCompare(b.symbol))
      .map((input,index) => ({symbol:input.symbol,rank:index+1,rankingFeature:'avgDollarVolume' as const,
        rankingValue:input.avgDollarVolume as number,
        reason:`shadow-evidence lattice rank ${index+1}; soft UNKNOWN/DEFERRED evidence is retained without promoting eligibility`}))
    : rankEligibleUnderlyings(decisions, inputsBySymbol);
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
      optionChainComplete: null, optionContractsComplete: null, snapshotContentHash: null, fusionSnapshot: null, snapshotValidForNewRisk: null,
      orchestration: null, strategyFrontier: null, strategyQualityDiagnostics: null,
      provenance: noUnderlyingProvenance, provenanceDetail: ['no eligible underlying survived UniversePolicy this cycle', ...noUnderlyingDetail],
      blockers: ['NO_ELIGIBLE_UNDERLYING'],
    };
  }
  const underlying = topRanked.symbol;

  let account: MasterAccountSnapshot | null = null;
  let accountEvidence = notAttemptedEvidence();
  let accountFetchedAt: string | null = null;
  try {
    // Keep the decision timestamp stable across the cycle, while recording
    // when each external observation was actually requested. Reusing the
    // cycle start here would hide a slow/stalled provider sequence from the
    // temporal-consistency gate.
    accountFetchedAt = config.now();
    account = await fetchMasterAccountSnapshot(config.alpaca, decisionTime);
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
    positions = await fetchPositions(config.alpaca, decisionTime);
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
    openOrders = await fetchOpenOrders(config.alpaca, decisionTime);
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
    clock = await fetchMarketClock(config.alpaca, decisionTime);
    clockEvidence = clock.isOpen !== null
      ? { origin: 'REAL_PROVIDER', quality: 'GOOD' }
      : { origin: 'REAL_PROVIDER_UNKNOWN', quality: 'UNKNOWN' };
  } catch (error) {
    clockEvidence = failedProviderEvidence(error);
    blockers.push(`MARKET_CLOCK_FETCH_FAILED:${error instanceof Error ? error.message : 'unknown'}`);
  }

  const marketDate = /^\d{4}-\d{2}-\d{2}/.test(clock?.timestamp ?? '')
    ? (clock?.timestamp ?? decisionTime).slice(0, 10)
    : decisionTime.slice(0, 10);
  const calendarEndDate = new Date(`${marketDate}T00:00:00.000Z`);
  calendarEndDate.setUTCDate(calendarEndDate.getUTCDate() + 7);
  const configuredExpirationEnd = Date.parse(`${config.optionExpirationDateLte}T00:00:00.000Z`);
  if (Number.isFinite(configuredExpirationEnd) && configuredExpirationEnd > calendarEndDate.getTime()) {
    calendarEndDate.setTime(configuredExpirationEnd);
  }
  let calendar: readonly AlpacaCalendarSession[] = [];
  let calendarEvidence = notAttemptedEvidence();
  try {
    calendar = await fetchMarketCalendar(config.alpaca, marketDate, calendarEndDate.toISOString().slice(0, 10));
    calendarEvidence = calendar.length > 0
      ? { origin: 'REAL_PROVIDER', quality: 'GOOD' }
      : { origin: 'REAL_PROVIDER_UNKNOWN', quality: 'UNKNOWN' };
  } catch (error) {
    calendarEvidence = failedProviderEvidence(error);
    blockers.push(`MARKET_CALENDAR_FETCH_FAILED:${error instanceof Error ? error.message : 'unknown'}`);
  }

  let historyOrigin: ProvenanceOrigin = 'NOT_ATTEMPTED';
  let historyBars: readonly HistoricalBar[] = [];
  let receivedAt = decisionTime;
  let ret1d: number | null = null;
  let ret5d: number | null = null;
  let ret20d: number | null = null;
  let ret60d: number | null = null;
  let stockAvgVolume: number | null = null;
  let ma20Rel: number | null = null;
  let ma50Rel: number | null = null;
  let ma200Rel: number | null = null;
  let rv10: number | null = null;
  let rv20: number | null = null;
  let rv60: number | null = null;
  let downsideSemivariance: number | null = null;
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
    historyBars = bars;
    if (barsResult.complete && bars.length > 0) {
      historyOrigin = 'REAL_PROVIDER';
      ret1d = computeReturn(bars, receivedAt, 1);
      ret5d = computeReturn(bars, receivedAt, 5);
      ret20d = computeReturn(bars, receivedAt, 20);
      ret60d = computeReturn(bars, receivedAt, 60);
      stockAvgVolume = computeAverageVolume(bars, receivedAt, 20);
      ma20Rel = computeMovingAverageRelative(bars, receivedAt, 20);
      ma50Rel = computeMovingAverageRelative(bars, receivedAt, 50);
      ma200Rel = computeMovingAverageRelative(bars, receivedAt, 200);
      rv10 = computeRealizedVolatility(bars, receivedAt, 10);
      rv20 = computeRealizedVolatility(bars, receivedAt, 20);
      rv60 = computeRealizedVolatility(bars, receivedAt, 60);
      downsideSemivariance = computeDownsideSemivariance(bars, receivedAt, 60);
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
  let optionomicsChain: NormalizedOptionomicsChain | null = null;
  let optionomicsFlowWindows: readonly NormalizedOptionomicsFlowWindow[] = [];
  let optionomicsContextObservations: readonly NormalizedOptionomicsContextObservation[] = [];
  let macroEventCoverage: Awaited<ReturnType<typeof fetchOptionomicsMacroEventCoverage>> | null = null;
  let optionomicsEvidence = notAttemptedEvidence();
  let optionomicsFlowEvidence = notAttemptedEvidence();
  let optionomicsContextEvidence = notAttemptedEvidence();
  if (config.optionomics !== null) {
    const outcome = await fetchOptionomicsOptionChain(config.optionomics, underlying);
    if (outcome.kind === 'VALUE_PRESENT') {
      optionomicsChain = outcome.value;
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

    const flowOutcomes = await Promise.all(
      ([8, 24, 48] as const).map((hours) => fetchOptionomicsNetFlowWindow(config.optionomics as OptionomicsProviderConfig, underlying, hours, decisionTime)),
    );
    optionomicsFlowWindows = flowOutcomes.flatMap((outcome) => outcome.kind === 'VALUE_PRESENT' ? [outcome.value] : []);
    const flowPointCount = optionomicsFlowWindows.reduce((total, window) => total + window.netCalls.length + window.netPuts.length, 0);
    const flowError = flowOutcomes.find((outcome) => outcome.kind === 'REQUEST_ERROR');
    const flowUnknown = flowOutcomes.find((outcome) => outcome.kind === 'VALUE_UNKNOWN_AFTER_SUCCESS');
    if (flowError?.kind === 'REQUEST_ERROR') {
      const quality: DataQualityState =
        flowError.errorClass === 'AUTHENTICATION_FAILED' || flowError.errorClass === 'INVALID_PROVIDER_RESPONSE' ? 'INVALID'
        : flowError.errorClass === 'SUBSCRIPTION_REQUIRED' || flowError.errorClass === 'NOT_ENTITLED' ? 'NOT_ENTITLED'
        : 'DEGRADED';
      optionomicsFlowEvidence = { origin: 'REAL_PROVIDER_ERROR', quality };
      blockers.push(`OPTIONOMICS_FLOW_FETCH_FAILED:${flowError.errorClass}:${flowError.detail}`);
    } else if (flowUnknown?.kind === 'VALUE_UNKNOWN_AFTER_SUCCESS' || optionomicsFlowWindows.length !== 3 || flowPointCount === 0) {
      optionomicsFlowEvidence = { origin: 'REAL_PROVIDER_UNKNOWN', quality: 'UNKNOWN' };
      if (flowUnknown?.kind === 'VALUE_UNKNOWN_AFTER_SUCCESS') blockers.push(`OPTIONOMICS_FLOW_RESPONSE_UNRECOGNIZED:${flowUnknown.detail}`);
    } else {
      optionomicsFlowEvidence = { origin: 'REAL_PROVIDER', quality: 'GOOD' };
    }

    const contextFamilies = dueOptionomicsContextFamilies(config, decisionTime);
    if (contextFamilies.length > 0) {
      const eventTo = new Date(decisionTime);
      eventTo.setUTCDate(eventTo.getUTCDate() + (config.optionomicsContextPolicy?.eventLookaheadDays ?? 0));
      const contextOutcomes: Awaited<ReturnType<typeof fetchOptionomicsContextObservation>>[] = [];
      // Sequential calls respect the provider's shared account allowance.
      // Each GET still has its own bounded 429 policy in the adapter.
      for (const family of contextFamilies) {
        if (family === 'EVENTS') {
          macroEventCoverage = await fetchOptionomicsMacroEventCoverage(config.optionomics, underlying,
            decisionTime.slice(0, 10), eventTo.toISOString().slice(0, 10), 4);
        } else {
          contextOutcomes.push(await fetchOptionomicsContextObservation(config.optionomics, family, underlying));
        }
      }
      optionomicsContextObservations = [
        ...contextOutcomes.flatMap((outcome) => outcome.kind === 'VALUE_PRESENT' ? [outcome.value] : []),
        ...(macroEventCoverage?.observations ?? []),
      ];
      if (macroEventCoverage?.state === 'INCOMPLETE') blockers.push(`OPTIONOMICS_MACRO_EVENT_COVERAGE_INCOMPLETE:${macroEventCoverage.reason}`);
      const contextError = contextOutcomes.find((outcome) => outcome.kind === 'REQUEST_ERROR');
      const contextUnknown = contextOutcomes.find((outcome) => outcome.kind === 'VALUE_UNKNOWN_AFTER_SUCCESS');
      if (contextError?.kind === 'REQUEST_ERROR') {
        const quality: DataQualityState =
          contextError.errorClass === 'AUTHENTICATION_FAILED' || contextError.errorClass === 'INVALID_PROVIDER_RESPONSE' ? 'INVALID'
          : contextError.errorClass === 'SUBSCRIPTION_REQUIRED' || contextError.errorClass === 'NOT_ENTITLED' ? 'NOT_ENTITLED'
          : 'DEGRADED';
        optionomicsContextEvidence = { origin: 'REAL_PROVIDER_ERROR', quality };
        blockers.push(`OPTIONOMICS_CONTEXT_FETCH_FAILED:${contextError.errorClass}:${contextError.detail}`);
      } else if (contextUnknown?.kind === 'VALUE_UNKNOWN_AFTER_SUCCESS'
        || macroEventCoverage?.state === 'INCOMPLETE'
        || contextOutcomes.filter((outcome) => outcome.kind === 'VALUE_PRESENT').length !== contextFamilies.length - (macroEventCoverage === null ? 0 : 1)
        || optionomicsContextObservations.every((observation) => !observation.populated)) {
        optionomicsContextEvidence = { origin: 'REAL_PROVIDER_UNKNOWN', quality: 'UNKNOWN' };
        if (contextUnknown?.kind === 'VALUE_UNKNOWN_AFTER_SUCCESS') blockers.push(`OPTIONOMICS_CONTEXT_RESPONSE_UNRECOGNIZED:${contextUnknown.detail}`);
      } else {
        optionomicsContextEvidence = { origin: 'REAL_PROVIDER', quality: 'GOOD' };
      }
    }
  }

  let optionChainComplete: boolean | null = null;
  let optionContractsComplete: boolean | null = null;
  let contractsEvidence = notAttemptedEvidence();
  let quotesEvidence = notAttemptedEvidence();
  const candidates: RawCandidateInput[] = [];
  let mergedContractsForSnapshot: ReturnType<typeof mergeOptionChain> = [];
  let aegisSpreadStressEvidence: AegisSpreadStressAssessmentMap = {};
  let aegisAlpacaIvStressEvidence: AlpacaContractIvAssessmentMap = {};
  let finalistQuoteRefresh: FinalistQuoteRefreshReceipt | null = null;
  const underlyingStockPosition = positions.find((position) => position.symbol === underlying
    && position.assetClass === 'us_equity') ?? null;
  const hasPotentialCoveredStock = underlyingStockPosition !== null
    && (underlyingStockPosition.quantity === null || underlyingStockPosition.quantity > 0);
  if (underlyingStockPosition?.quantity === null) blockers.push(`STOCK_QUANTITY_UNKNOWN:${underlying}`);
  // A covered-call frontier cannot be evaluated from a put-only chain. A real
  // stock row with UNKNOWN quantity still causes calls to be fetched so the
  // management branch and its missing quantity remain visible. The frontier
  // blocks sizing until covered shares are proven.
  const optionTypes: readonly ('put' | 'call')[] = hasPotentialCoveredStock ? ['put', 'call'] : ['put'];
  const contractItems: AlpacaOptionContractListing[] = [];
  const snapshotsBySymbol = new Map<string, AlpacaOptionSnapshot>();
  const snapshotReceivedAtBySymbol = new Map<string, string>();
  const contractEvidenceByType: ProviderEvidence[] = [];
  const quoteEvidenceByType: ProviderEvidence[] = [];
  // Snapshot discovery must cover the same expirations as contract discovery.
  // An unbounded underlying snapshot request can page through unrelated
  // expirations before reaching the contracts this cycle can actually use.
  const snapshotExpirationGte = config.evaluationMode === 'SHADOW_EVIDENCE' && researchGte !== undefined
    ? (researchGte < config.optionExpirationDateGte ? researchGte : config.optionExpirationDateGte)
    : config.optionExpirationDateGte;
  const snapshotExpirationLte = config.evaluationMode === 'SHADOW_EVIDENCE' && researchLte !== undefined
    ? (researchLte > config.optionExpirationDateLte ? researchLte : config.optionExpirationDateLte)
    : config.optionExpirationDateLte;
  for (const optionType of optionTypes) {
    const contractWindows = [
      { name: 'PRIMARY', gte: config.optionExpirationDateGte, lte: config.optionExpirationDateLte },
      ...(config.evaluationMode === 'SHADOW_EVIDENCE'
        && config.shadowResearchExpirationDateGte !== undefined
        && config.shadowResearchExpirationDateLte !== undefined
        ? [{ name: 'SHADOW_RESEARCH', gte: config.shadowResearchExpirationDateGte, lte: config.shadowResearchExpirationDateLte }]
        : []),
    ];
    for (const window of contractWindows) {
      const contractFetchStartedAt = Date.now();
      try {
        const result = await fetchOptionContracts(config.alpaca, {
          underlyingSymbol: underlying, expirationDateGte: window.gte,
          expirationDateLte: window.lte, optionType, showDeliverables: true, limit: 100, maxPages: config.maxOptionPages,
        });
        const seen = new Set(contractItems.map((item) => item.symbol));
        for (const item of result.items) if (!seen.has(item.symbol)) {
          contractItems.push(item);
          seen.add(item.symbol);
        }
        // Primary contracts qualify the Paper-facing Conventional route.
        // A failed or partial research-only fetch cannot downgrade them.
        if (window.name === 'PRIMARY') {
          optionContractsComplete = optionContractsComplete !== false && result.complete;
          contractEvidenceByType.push(result.complete
            ? { origin: 'REAL_PROVIDER', quality: 'GOOD' }
            : { origin: 'REAL_PROVIDER_UNKNOWN', quality: 'UNKNOWN' });
        }
        if (!result.complete) blockers.push(`OPTION_CONTRACTS_INCOMPLETE:${window.name}:${optionType.toUpperCase()}`);
        traceShadowStage(underlying, 'CONTRACTS_COMPLETE', { optionType, window: window.name,
          elapsedMs: Date.now() - contractFetchStartedAt, count: result.items.length,
          pagesFetched: result.pagesFetched, complete: result.complete });
      } catch (error) {
        if (window.name === 'PRIMARY') {
          contractEvidenceByType.push(failedProviderEvidence(error));
          optionContractsComplete = false;
        }
        blockers.push(`OPTION_CONTRACTS_FETCH_FAILED:${window.name}:${optionType.toUpperCase()}:${error instanceof Error ? error.message : 'unknown'}`);
        traceShadowStage(underlying, 'CONTRACTS_FAILED', { optionType, window: window.name,
          elapsedMs: Date.now() - contractFetchStartedAt });
      }
    }
    const snapshotFetchStartedAt = Date.now();
    traceShadowStage(underlying, 'SNAPSHOTS_STARTED', { optionType, contractsEnumerated: contractItems.length });
    try {
      const result = await fetchOptionSnapshots(config.alpaca, {
        // The provider adapter documents a 1,000-observation page maximum.
        // Use it to reduce serial page latency and the risk of excluding the
        // newly enumerated research expirations under the bounded page cap.
        underlyingSymbol: underlying, feed: 'indicative', optionType,
        expirationDateGte: snapshotExpirationGte, expirationDateLte: snapshotExpirationLte,
        limit: 1_000, maxPages: config.maxOptionPages,
      });
      const snapshotReceivedAt = config.now();
      for (const [symbol, snapshot] of result.snapshots) {
        snapshotsBySymbol.set(symbol, snapshot);
        snapshotReceivedAtBySymbol.set(symbol, snapshotReceivedAt);
      }
      optionChainComplete = optionChainComplete !== false && result.complete;
      quoteEvidenceByType.push(result.complete
        ? { origin: 'REAL_PROVIDER', quality: 'GOOD' }
        : { origin: 'REAL_PROVIDER_UNKNOWN', quality: 'UNKNOWN' });
      traceShadowStage(underlying, 'SNAPSHOTS_COMPLETE', { optionType,
        elapsedMs: Date.now() - snapshotFetchStartedAt, count: result.snapshots.size,
        pagesFetched: result.pagesFetched, complete: result.complete });
    } catch (error) {
      quoteEvidenceByType.push(failedProviderEvidence(error));
      optionChainComplete = false;
      blockers.push(`OPTION_SNAPSHOTS_FETCH_FAILED:${optionType.toUpperCase()}:${error instanceof Error ? error.message : 'unknown'}`);
      traceShadowStage(underlying, 'SNAPSHOTS_FAILED', { optionType,
        elapsedMs: Date.now() - snapshotFetchStartedAt });
    }
  }
  const evidenceFor = (evidence: readonly ProviderEvidence[]): ProviderEvidence => ({
    origin: evidence.some((item) => item.origin === 'REAL_PROVIDER_ERROR') ? 'REAL_PROVIDER_ERROR'
      : evidence.every((item) => item.origin === 'REAL_PROVIDER') ? 'REAL_PROVIDER' : 'REAL_PROVIDER_UNKNOWN',
    quality: aggregateProviderQuality(evidence.map((item) => item.quality)),
  });
  contractsEvidence = evidenceFor(contractEvidenceByType);
  quotesEvidence = evidenceFor(quoteEvidenceByType);

  // Build the preliminary structural lattice from the broad chain, then
  // refresh only a bounded finalist set by exact contract before freezing
  // the decision evidence. Candidate, finalist and pre-submit quote-age
  // policies are independent and versioned. No threshold is relaxed here.
  const candidateBuiltAt = config.now();
  decisionTime = candidateBuiltAt;
  receivedAt = candidateBuiltAt;
  const candidateMaxQuoteAgeSeconds = candidateQuoteAgeSeconds(config, candidateBuiltAt);
  const finalistMaxQuoteAgeSeconds = finalistQuoteRefreshMaxAgeSeconds(
    config.finalistQuoteRefreshPolicy,
    candidateBuiltAt,
  );

  if (contractItems.length > 0 && snapshotsBySymbol.size > 0) {

    // Exact identity only (OCC symbol, then exact underlying+expiration+
    // type+strike) -- never fuzzy. An Optionomics entry that cannot be
    // proven to match a specific Alpaca contract contributes nothing;
    // that contract's OI/volume/Greeks-fallback simply stay UNKNOWN.
    const alpacaIdentities: readonly AlpacaContractIdentity[] = contractItems.map((c) => ({
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

    const initialMergedContracts = mergeOptionChain({
      underlying, asOfDate: candidateBuiltAt.slice(0, 10), contracts: contractItems,
      snapshotsBySymbol, optionomicsBySymbol, requestedFeed: 'INDICATIVE',
      defaultMultiplierForUnknownContracts: 100, receivedAt: candidateBuiltAt,
      receivedAtBySymbol: snapshotReceivedAtBySymbol,
      maxQuoteAgeSecondsForExecutable: candidateMaxQuoteAgeSeconds,
      maxSpreadPctForExecutable: config.maxAcceptableSpreadPct,
    });
    traceShadowStage(underlying, 'CONTRACTS_MERGED', { count: initialMergedContracts.length,
      snapshots: snapshotsBySymbol.size });

    const finalistChosenAt = config.now();
    const finalists = selectFinalistContractsForRefresh({
      contracts: initialMergedContracts,
      latticeConfig: config.latticeConfig,
      policy: config.finalistQuoteRefreshPolicy,
      asOf: finalistChosenAt,
    });
    const finalistSymbols = new Set(finalists.map((contract) => contract.optionSymbol));
    const refreshObservations: FinalistQuoteRefreshObservation[] = [];
    const refreshFailedSymbols = new Set<string>();
    const listingBySymbol = new Map(contractItems.map((contract) => [contract.symbol, contract]));

    for (const finalist of finalists) {
      const listing = listingBySymbol.get(finalist.optionSymbol);
      const refreshRequestedAt = config.now();
      let refreshReceivedAt = refreshRequestedAt;
      if (listing === undefined) {
        refreshFailedSymbols.add(finalist.optionSymbol);
        refreshObservations.push({
          optionSymbol: finalist.optionSymbol,
          initialProviderTimestamp: finalist.quoteTimestamp,
          initialReceivedAt: finalist.receivedAt,
          refreshRequestedAt,
          refreshReceivedAt,
          refreshedProviderTimestamp: null,
          state: 'MISSING_EXACT_CONTRACT',
          sanitizedErrorCode: 'CONTRACT_LISTING_MISSING',
        });
        continue;
      }
      try {
        const exact = await fetchOptionSnapshots(config.alpaca, {
          underlyingSymbol: underlying,
          feed: 'indicative',
          optionType: listing.optionType.toLowerCase() as 'put' | 'call',
          expirationDateGte: listing.expirationDate,
          expirationDateLte: listing.expirationDate,
          strikePriceGte: listing.strikePrice,
          strikePriceLte: listing.strikePrice,
          limit: 1_000,
          maxPages: Math.min(config.maxOptionPages, 10),
        });
        refreshReceivedAt = config.now();
        const refreshed = exact.snapshots.get(finalist.optionSymbol);
        if (!exact.complete) {
          refreshFailedSymbols.add(finalist.optionSymbol);
          refreshObservations.push({
            optionSymbol: finalist.optionSymbol,
            initialProviderTimestamp: finalist.quoteTimestamp,
            initialReceivedAt: finalist.receivedAt,
            refreshRequestedAt,
            refreshReceivedAt,
            refreshedProviderTimestamp: refreshed?.quoteTimestamp ?? null,
            state: 'INCOMPLETE_PAGINATION',
            sanitizedErrorCode: 'FINALIST_REFRESH_INCOMPLETE',
          });
        } else if (refreshed === undefined) {
          refreshFailedSymbols.add(finalist.optionSymbol);
          refreshObservations.push({
            optionSymbol: finalist.optionSymbol,
            initialProviderTimestamp: finalist.quoteTimestamp,
            initialReceivedAt: finalist.receivedAt,
            refreshRequestedAt,
            refreshReceivedAt,
            refreshedProviderTimestamp: null,
            state: 'MISSING_EXACT_CONTRACT',
            sanitizedErrorCode: 'FINALIST_EXACT_CONTRACT_MISSING',
          });
        } else {
          snapshotsBySymbol.set(finalist.optionSymbol, refreshed);
          refreshObservations.push({
            optionSymbol: finalist.optionSymbol,
            initialProviderTimestamp: finalist.quoteTimestamp,
            initialReceivedAt: finalist.receivedAt,
            refreshRequestedAt,
            refreshReceivedAt,
            refreshedProviderTimestamp: refreshed.quoteTimestamp,
            state: 'REFRESHED',
            sanitizedErrorCode: null,
          });
        }
      } catch (error) {
        refreshReceivedAt = config.now();
        refreshFailedSymbols.add(finalist.optionSymbol);
        refreshObservations.push({
          optionSymbol: finalist.optionSymbol,
          initialProviderTimestamp: finalist.quoteTimestamp,
          initialReceivedAt: finalist.receivedAt,
          refreshRequestedAt,
          refreshReceivedAt,
          refreshedProviderTimestamp: null,
          state: 'PROVIDER_ERROR',
          sanitizedErrorCode: error instanceof AlpacaProviderError
            ? `ALPACA_${error.errorClass}` : 'ALPACA_UNEXPECTED_PROVIDER_ERROR',
        });
      }
    }

    // The IEX stock quote is only the moneyness/cohort reference. It never
    // substitutes for the option BBO. Missing/stale stock evidence leaves
    // moneyness UNKNOWN and the IV cohort detector fail-closed.
    let underlyingQuote: { bid: number; ask: number; timestamp: string; receivedAt: string } | undefined;
    try {
      const quote = await fetchLatestStockQuote(config.alpaca, underlying, 'iex');
      const quoteReceivedAt = config.now();
      const quoteMs = quote.timestamp === null ? Number.NaN : Date.parse(quote.timestamp);
      const receivedMs = Date.parse(quoteReceivedAt);
      if (quote.bid !== null && quote.ask !== null && quote.bid > 0 && quote.ask >= quote.bid
        && Number.isFinite(quoteMs) && quoteMs <= receivedMs
        && (receivedMs - quoteMs) / 1000 <= finalistMaxQuoteAgeSeconds) {
        underlyingQuote = { bid: quote.bid, ask: quote.ask, timestamp: quote.timestamp as string,
          receivedAt: quoteReceivedAt };
      } else blockers.push('ALPACA_UNDERLYING_IEX_QUOTE_UNQUALIFIED');
    } catch {
      blockers.push('ALPACA_UNDERLYING_IEX_QUOTE_PROVIDER_ERROR');
    }
    // This is the actual PIT decision cutoff. Every exact finalist and
    // underlying quote refresh above was observed no later than this instant.
    decisionTime = config.now();
    receivedAt = decisionTime;
    const finalistReceivedAtBySymbol = new Map(snapshotReceivedAtBySymbol);
    for (const [symbol, observedAt] of refreshObservations
      .filter((observation) => observation.state === 'REFRESHED')
      .map((observation) => [observation.optionSymbol, observation.refreshReceivedAt] as const))
      finalistReceivedAtBySymbol.set(symbol, observedAt);
    const candidateAgeContracts = mergeOptionChain({
      underlying, asOfDate: decisionTime.slice(0, 10), contracts: contractItems,
      snapshotsBySymbol, optionomicsBySymbol, requestedFeed: 'INDICATIVE',
      defaultMultiplierForUnknownContracts: 100, receivedAt, receivedAtBySymbol: finalistReceivedAtBySymbol,
      underlyingQuote,
      maxQuoteAgeSecondsForExecutable: candidateMaxQuoteAgeSeconds,
      maxSpreadPctForExecutable: config.maxAcceptableSpreadPct,
    });
    const finalistAgeContracts = mergeOptionChain({
      underlying, asOfDate: decisionTime.slice(0, 10), contracts: contractItems,
      snapshotsBySymbol, optionomicsBySymbol, requestedFeed: 'INDICATIVE',
      defaultMultiplierForUnknownContracts: 100, receivedAt, receivedAtBySymbol: finalistReceivedAtBySymbol,
      underlyingQuote,
      maxQuoteAgeSecondsForExecutable: finalistMaxQuoteAgeSeconds,
      maxSpreadPctForExecutable: config.maxAcceptableSpreadPct,
    });
    const finalistAgeBySymbol = new Map(finalistAgeContracts.map((contract) => [contract.optionSymbol, contract]));
    const mergedContracts = candidateAgeContracts.map((contract) => {
      if (!finalistSymbols.has(contract.optionSymbol)) return contract;
      const refreshed = finalistAgeBySymbol.get(contract.optionSymbol) ?? contract;
      if (!refreshFailedSymbols.has(contract.optionSymbol)) return refreshed;
      return {
        ...refreshed,
        executable: false,
        nonExecutableReason: refreshed.nonExecutableReason === null
          ? 'finalist refresh failed'
          : `${refreshed.nonExecutableReason}; finalist refresh failed`,
      };
    });
    mergedContractsForSnapshot = mergedContracts;
    finalistQuoteRefresh = buildFinalistQuoteRefreshReceipt({
      policy: config.finalistQuoteRefreshPolicy,
      candidateBuiltAt,
      finalistChosenAt,
      decisionAsOf: decisionTime,
      initialCandidateCount: initialMergedContracts.filter((contract) => contract.bid !== null).length,
      observations: refreshObservations,
    });
    for (const observation of refreshObservations) {
      if (observation.state !== 'REFRESHED') {
        blockers.push(`FINALIST_QUOTE_REFRESH_${observation.state}:${observation.optionSymbol}:${observation.sanitizedErrorCode ?? 'UNKNOWN'}`);
      }
    }
    traceShadowStage(underlying, 'FINALIST_QUOTES_REFRESHED', {
      selected: finalistQuoteRefresh.selectedCount,
      refreshed: finalistQuoteRefresh.refreshedCount,
      failed: finalistQuoteRefresh.failedCount,
    });

    for (const contract of mergedContracts) {
      if (!finalistSymbols.has(contract.optionSymbol)) continue;
      if (contract.bid === null) {
        blockers.push(`CANDIDATE_BID_UNKNOWN:${contract.optionSymbol}`);
        continue;
      }
      const availableOptionBuyingPower = account?.optionsBuyingPower ?? account?.buyingPower ?? null;
      const collateralPerContract = contract.strike * contract.multiplier;
      const brokerAllowedQty = availableOptionBuyingPower !== null && availableOptionBuyingPower >= 0
        && collateralPerContract > 0 ? Math.floor(availableOptionBuyingPower / collateralPerContract) : 0;
      candidates.push({
        candidateId: contract.optionSymbol, contract, entryPremiumPerShare: contract.bid,
        severeDrawdownProbability: null, ivRank: null, brokerAllowedQty,
        contractIsStandard: contract.multiplier === 100 && contract.occSymbol !== null,
        hasAlternateContract: mergedContracts.length > 1, hasAlternateExpiry: false, hasAlternateStructure: false,
        ivCompensationSufficient: null, quoteSize: contract.bidSize, preSlippageExpectedUtility: null,
      });
    }
    if (config.aegisSpreadStressAssessor !== undefined) {
      try {
        aegisSpreadStressEvidence = await config.aegisSpreadStressAssessor({
          contracts: candidates.map((candidate) => candidate.contract),
          decisionAsOf: decisionTime,
        });
      } catch (error) {
        blockers.push(`AEGIS_SPREAD_STRESS_PROVIDER_ERROR:${error instanceof Error ? error.message : 'unknown'}`);
      }
    }
  }

  // Real account exposure -- pure arithmetic over the account/positions/
  // open-orders state already fetched above. Always computed (an empty
  // account is a valid, common, real-zero-exposure state); whether any of
  // it is safe to MERGE into aegisInputs below depends on the underlying
  // fetches' quality, checked separately.
  const derivedExposure: DerivedAccountExposure = deriveAccountExposure(account, positions, openOrders);
  const recoveryInventoryValue = deriveRecoveryInventoryValue(derivedExposure, config.recoveryInventoryUnderlyings);
  const exposureDerivationTrustworthy = accountEvidence.quality === 'GOOD' && positionsEvidence.quality === 'GOOD' && openOrdersEvidence.quality === 'GOOD';

  // Observe portfolio correlation from broker-owned exposure and completed
  // Alpaca daily bars. This is stored for research and risk diagnostics only.
  // Bars fetched after cycle-start decisionTime are never promoted backward
  // into AEGIS or sizing; usableForDecision records that PIT boundary.
  let portfolioCorrelation: PortfolioCorrelationObservation | null = null;
  if (exposureDerivationTrustworthy) {
    const heldSymbols = Object.entries(derivedExposure.exposureByUnderlying)
      .filter(([, value]) => value > 0).map(([symbol]) => symbol);
    if (heldSymbols.length <= 20) {
      const otherSymbols = heldSymbols.filter((symbol) => symbol !== underlying);
      let otherBars: readonly HistoricalBar[] = [];
      let correlationProviderState: 'COMPLETE' | 'INCOMPLETE' | 'ERROR' = historyOrigin === 'REAL_PROVIDER'
        ? 'COMPLETE' : 'INCOMPLETE';
      if (otherSymbols.length > 0 && correlationProviderState === 'COMPLETE') {
        try {
          const fetched = await fetchStockBars(config.alpaca, {
            symbols: otherSymbols, timeframe: '1Day', start: config.historyStart,
            end: config.historyEnd, feed: 'iex', maxPages: config.historyMaxPages, adjustment: 'split',
          }, config.now());
          otherBars = fetched.bars;
          if (!fetched.complete) correlationProviderState = 'INCOMPLETE';
        } catch {
          correlationProviderState = 'ERROR';
          blockers.push('PORTFOLIO_CORRELATION_BARS_PROVIDER_ERROR');
        }
      }
      const observedAt = config.now();
      try {
        portfolioCorrelation = assessPortfolioCorrelation({
          candidateUnderlying: underlying,
          currentExposureByUnderlying: derivedExposure.exposureByUnderlying,
          // The source adapter stamps request time. Use the later completion
          // time here so the observation can never masquerade as earlier PIT.
          bars: [...historyBars, ...otherBars].map((bar) => ({ ...bar, receivedAt: observedAt })),
          providerState: correlationProviderState, decisionAsOf: decisionTime,
          evaluatedAt: observedAt, lookbackSessions: 60,
          minimumOverlappingReturns: 20, maxBarAgeCalendarDays: 5,
        });
      } catch {
        blockers.push('PORTFOLIO_CORRELATION_OBSERVATION_INVALID');
      }
    } else {
      blockers.push('PORTFOLIO_CORRELATION_SYMBOL_BOUND_EXCEEDED');
    }
    if (config.aegisAlpacaIvStressAssessor !== undefined) {
      try {
        aegisAlpacaIvStressEvidence = await config.aegisAlpacaIvStressAssessor({
          contracts: candidates.map((candidate) => candidate.contract), decisionAsOf: decisionTime,
        });
      } catch (error) {
        blockers.push(`AEGIS_ALPACA_IV_STRESS_PROVIDER_ERROR:${error instanceof Error ? error.message : 'unknown'}`);
      }
    }
  } else {
    blockers.push('PORTFOLIO_CORRELATION_ACCOUNT_STATE_UNKNOWN');
  }

  const eventContextObservations = optionomicsContextObservations.filter((observation) =>
    observation.family === 'EVENTS' || observation.family === 'EARNINGS_FILINGS' || observation.family === 'SYMBOL_NEWS');
  const eventContextPopulated = eventContextObservations.some((observation) => observation.populated);
  const eventContextOrigin: ProvenanceOrigin = eventContextPopulated
    ? 'REAL_PROVIDER'
    : eventContextObservations.length > 0 ? 'REAL_PROVIDER_UNKNOWN' : 'NOT_ATTEMPTED';
  const eventContextQuality: DataQualityState = eventContextPopulated ? 'GOOD' : 'UNKNOWN';
  const earningsEvidence = deriveOptionomicsEarningsEvidence(optionomicsContextObservations);
  const macroRiskEvidence = deriveMacroRiskEvidence({ coverage: macroEventCoverage, decisionAsOf: decisionTime });

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
    optionomicsChain: optionomicsEvidence.origin,
    optionomicsFlow: optionomicsFlowEvidence.origin,
    optionomicsContext: optionomicsContextEvidence.origin,
    eventState: eventContextOrigin,
    aegisInputs: config.aegisInputsOrigin,
  });

  const gapAssessment = assessAegisGapStress({
    bars: historyBars, decisionAsOf: decisionTime, currentSession: marketDate,
    currentSessionConfirmed: clockEvidence.quality === 'GOOD' && clock?.isOpen === true
      && calendar.some((session) => session.date === marketDate && session.open != null && session.close != null),
    policy: {
      policyVersion: 'aegis-gap-paper-bootstrap-v1', authority: 'PAPER_BOOTSTRAP_NOT_EMPIRICALLY_OPTIMAL',
      absoluteReturnThreshold: config.stressGapThresholdAbsReturn,
      returnHorizon: 'CURRENT_SESSION_OPEN_VS_PREVIOUS_COMPLETED_CLOSE',
      barSource: 'ALPACA_1DAY_SPLIT_ADJUSTED_IEX', barUnit: 'DECIMAL_RETURN',
      requiredCompletedSessions: 1, maxPreviousBarAgeDays: 5,
      sessionCalendarAuthority: 'ALPACA_CLOCK_AND_CURRENT_CALENDAR',
    },
  });

  // Canonical FusionSnapshot -- ALWAYS built, even on a no-candidates path,
  // so every returned run (successful or not) carries a genuine,
  // deterministic snapshot identity. NEVER a placeholder hash.
  const snapshotInput = assembleFusionSnapshotInput({
    now: decisionTime, underlying, account,
    universeEventEvidence: (() => {
      const input = inputsBySymbol.get(underlying);
      return input === undefined ? null : {
        unsupportedCorporateActionPending: input.unsupportedCorporateActionPending,
        eventNear: input.eventNear,
      };
    })(),
    universeDecision: decisions.find((decision) => decision.symbol === underlying) ?? null,
    accountOrigin: accountEvidence.origin, accountQuality: accountEvidence.quality,
    contractsOrigin: contractsEvidence.origin, contractsQuality: contractsEvidence.quality,
    quotesOrigin: quotesEvidence.origin, quotesQuality: quotesEvidence.quality,
    optionomicsOrigin: optionomicsEvidence.origin, optionomicsQuality: optionomicsEvidence.quality, optionomicsChain, optionomicsEntries,
    optionomicsFlowWindows, optionomicsFlowOrigin: optionomicsFlowEvidence.origin, optionomicsFlowQuality: optionomicsFlowEvidence.quality,
    optionomicsContextObservations, macroEventCoverage, optionomicsContextOrigin: optionomicsContextEvidence.origin,
    optionomicsContextQuality: optionomicsContextEvidence.quality,
    positions, positionsOrigin: positionsEvidence.origin, positionsQuality: positionsEvidence.quality,
    openOrders, openOrdersOrigin: openOrdersEvidence.origin, openOrdersQuality: openOrdersEvidence.quality,
    clock, clockOrigin: clockEvidence.origin, clockQuality: clockEvidence.quality,
    calendar, calendarOrigin: calendarEvidence.origin, calendarQuality: calendarEvidence.quality,
    derivedExposure,
    portfolioCorrelation,
    mergedContracts: [...mergedContractsForSnapshot],
    ownershipFeatures: { stockAvgVolume,ret1d,ret5d,ret20d,ret60d,ma20Rel,ma50Rel,ma200Rel,
      rv10,rv20,rv60,downsideSemivariance,drawdown,maSlope,gapFrequency,maxAdverseGap,
      recoveryHistory:config.recoveryHistory??null } as unknown as JsonValue,
    regimeFeatures: { maSlope, rv20, maxAdverseGap, drawdown,
      aegisGapStressAssessment: gapAssessment } as unknown as JsonValue,
    policyVersion: config.policyVersion,
    modelVersions: {
      ...config.modelVersions,
      candidateQuoteAgePolicy: config.candidateQuoteAgePolicy.policyVersion,
      finalistQuoteRefreshPolicy: config.finalistQuoteRefreshPolicy.policyVersion,
    },
    aegisIvStressEvidence: config.aegisIvStressEvidence ?? null,
    aegisAlpacaIvStressEvidence,
    aegisSpreadStressEvidence,
    finalistQuoteRefresh,
    earningsEvidence,
    macroRiskEvidence,
  });
  const fusionSnapshot = buildFusionSnapshot(snapshotInput);
  const stockPosition = underlyingStockPosition !== null
    && (underlyingStockPosition.quantity === null || underlyingStockPosition.quantity > 0)
    ? underlyingStockPosition : null;
  const stockState = stockPosition === null ? null : {
    underlying,
    shares: stockPosition.quantity,
    currentPrice: stockPosition.marketValue !== null && stockPosition.quantity !== null && stockPosition.quantity > 0
      ? stockPosition.marketValue / stockPosition.quantity : null,
    brokerCostBasisPerShare: stockPosition.avgEntryPrice,
    // Whole-chain basis must come from the immutable economic ledger. The
    // broker position snapshot cannot establish it, so this remains UNKNOWN
    // until the chain is resolved by the lifecycle/accounting integration.
    wholeChainEconomicBasisPerShare: null,
  };
  const optionomicsSnapshotState = fusionSnapshot.snapshot.optionomicsFeatureState;
  const optionomicsDerivedContext = optionomicsSnapshotState !== null && typeof optionomicsSnapshotState === 'object'
    && !Array.isArray(optionomicsSnapshotState)
    ? optionomicsSnapshotState.features ?? null : null;
  const strategyFrontierFor = (
    routing: NewRiskOrchestrationResult['routing'],
    aegis: NewRiskOrchestrationResult['aegis'],
    aegisByCandidateId?: NewRiskOrchestrationResult['aegisByCandidateId'],
    candidatesWithCapacity: readonly RawCandidateInput[] = candidates,
    thetaQ: NewRiskOrchestrationResult['thetaQ'] = null,
  ): CanonicalStrategyFrontier => {
    const conventionalRisk = conventionalFrontierRiskLookups(candidatesWithCapacity.map((candidate) => ({
      optionSymbol: candidate.contract.optionSymbol, brokerAllowedQty: candidate.brokerAllowedQty,
    })), aegisByCandidateId);
    return buildCanonicalStrategyFrontier({
    snapshotId: fusionSnapshot.contentHash, timestamp: decisionTime, strategyVersion: config.policyVersion,
    contracts: mergedContractsForSnapshot, routing, stock: stockState, assignmentCapacityQty: null,
    buyingPower: account?.optionsBuyingPower ?? account?.buyingPower ?? null,
    sizingPolicy: config.sizingPolicy,
    brokerAllowedQtyByCandidateId: conventionalRisk.brokerAllowedQtyByCandidateId,
    aegisNewRiskState: aegis?.newRiskState ?? null, eventState: eventContextPopulated ? 'OBSERVED' : null,
    aegisNewRiskStateByCandidateId: conventionalRisk.aegisNewRiskStateByCandidateId,
    aegisBindingReasonsByCandidateId: conventionalRisk.aegisBindingReasonsByCandidateId,
    unmanagedBrokerPositionCount: positions.filter((position) => position.assetClass === 'us_option').length,
    unevaluatedUnderlyingCount: Math.max(0, ranked.length - 1),
    // The frontier stores normalized/derived feature state only. Immutable
    // raw provider payloads already have their own table and are not copied
    // into every strategy candidate record.
    optionomicsContext: optionomicsDerivedContext,
    entryEligibilityByOptionSymbol: Object.fromEntries((thetaQ?.candidates ?? []).map((candidate) => [candidate.candidateId, {
      basis: candidate.eligibilityBasis,
      paperBootstrapPolicyVersion: candidate.paperBootstrapPolicyVersion,
      paperBootstrapAllowedUnknownComponents: candidate.paperBootstrapAllowedUnknownComponents,
      paperBootstrapReasonCodes: candidate.paperBootstrapReasonCodes,
    }])),
    });
  };
  const conventionalSource = canonicalThetaStrategySources.find((source) => source.branch === 'THETA_CONVENTIONAL');
  if (conventionalSource === undefined) throw new Error('THETA_CONVENTIONAL_SOURCE_MISSING');
  const strategyDecisionFor = (
    routing: NewRiskOrchestrationResult['routing'],
    aegis: NewRiskOrchestrationResult['aegis'],
    aegisByCandidateId?: NewRiskOrchestrationResult['aegisByCandidateId'],
    candidatesWithCapacity: readonly RawCandidateInput[] = candidates,
    thetaQ: NewRiskOrchestrationResult['thetaQ'] = null,
  ): Pick<ThetaShadowCycleResult, 'strategyFrontier' | 'strategyQualityDiagnostics'> => {
    const strategyFrontier = strategyFrontierFor(routing, aegis, aegisByCandidateId, candidatesWithCapacity, thetaQ);
    return {
      strategyFrontier,
      strategyQualityDiagnostics: buildStrategyQualityShadowDiagnostic({
        contracts: mergedContractsForSnapshot,
        frontier: strategyFrontier,
        optionomicsContext: optionomicsDerivedContext,
        historicalBars: historyBars,
        asOf: decisionTime,
        conventionalDteMin: conventionalSource.lattice.dteMin,
        conventionalDteMax: conventionalSource.lattice.dteMax,
      }),
    };
  };

  if (candidates.length === 0) {
    const receipt = assembleNoCandidateDecision({
      snapshotId: fusionSnapshot.contentHash,
      fusionSnapshotHash: fusionSnapshot.contentHash,
      timestamp: decisionTime,
      underlying,
      snapshotValidForNewRisk: fusionSnapshot.validForNewRisk,
      policyVersion: config.policyVersion,
      modelVersions: config.modelVersions,
    });
    return {
      runId, startedAt, finishedAt: config.now(), universeFunnel: funnel, selectedUnderlying: underlying, underlyingRanking: ranked,
      optionChainComplete, optionContractsComplete, snapshotContentHash: fusionSnapshot.contentHash, fusionSnapshot,
      snapshotValidForNewRisk: fusionSnapshot.validForNewRisk,
      orchestration: { receipt, ownership: null, regime: null, routing: null, thetaQ: null, candidateEconomics: null, aegis: null, paretoSurvivorIds: null, opportunityBook: null, shadowOpportunities: [] },
      ...strategyDecisionFor(null, null),
      provenance, provenanceDetail: detail,
      blockers: [...blockers, 'NO_CANDIDATES_AVAILABLE'],
    };
  }

  const runtimePreconditionHoldResult = (reasonCode: string, holdDetail: string): ThetaShadowCycleResult => {
    const receipt = assembleRuntimePreconditionHold({
      snapshotId: fusionSnapshot.contentHash, fusionSnapshotHash: fusionSnapshot.contentHash, timestamp: decisionTime, underlying,
      reasonCode, detail: holdDetail, policyVersion: config.policyVersion, modelVersions: config.modelVersions,
    });
    const orchestration: NewRiskOrchestrationResult = {
      receipt, ownership: null, regime: null, routing: null, thetaQ: null, candidateEconomics: null, aegis: null, paretoSurvivorIds: null, opportunityBook: null, shadowOpportunities: [],
    };
    return {
      runId, startedAt, finishedAt: config.now(), universeFunnel: funnel, selectedUnderlying: underlying, underlyingRanking: ranked,
      optionChainComplete, optionContractsComplete, snapshotContentHash: fusionSnapshot.contentHash, fusionSnapshot,
      snapshotValidForNewRisk: fusionSnapshot.validForNewRisk, orchestration, ...strategyDecisionFor(null, null),
      provenance, provenanceDetail: detail, blockers,
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

  // A confirmed-closed market is a real, known VALUE -- an operational
  // precondition, never a strategy WAIT/PASS and never a provider-quality
  // SYSTEM_HOLD. Only short-circuits on a TRUSTWORTHY confirmation
  // (clockEvidence.quality === 'GOOD', i.e. the clock call actually
  // succeeded and returned isOpen) -- an unreachable/unknown clock still
  // falls through to the normal provider-capability gate below, which
  // already handles genuine data-quality uncertainty correctly.
  if (clockEvidence.quality === 'GOOD' && clock?.isOpen === false) {
    return runtimePreconditionHoldResult('MARKET_CLOSED', `Market is confirmed closed (nextOpen=${clock.nextOpen ?? 'UNKNOWN'}); new-risk evaluation deferred to the next session.`);
  }


  const currentCalendarSession = calendar.find((session) => session.date === marketDate);
  if (clockEvidence.quality === 'GOOD' && clock?.isOpen === true &&
      (calendarEvidence.quality !== 'GOOD' || currentCalendarSession?.open == null || currentCalendarSession.close == null)) {
    const receipt = assembleRuntimePreconditionHold({
      snapshotId: fusionSnapshot.contentHash, fusionSnapshotHash: fusionSnapshot.contentHash, timestamp: decisionTime, underlying,
      reasonCode: 'MARKET_SESSION_UNCONFIRMED', detail: 'The broker clock reports open, but the exchange calendar session could not be confirmed. New risk is held.',
      policyVersion: config.policyVersion, modelVersions: config.modelVersions,
    });
    return {
      runId, startedAt, finishedAt: config.now(), universeFunnel: funnel, selectedUnderlying: underlying, underlyingRanking: ranked,
      optionChainComplete, optionContractsComplete, snapshotContentHash: fusionSnapshot.contentHash, fusionSnapshot,
      snapshotValidForNewRisk: fusionSnapshot.validForNewRisk,
      orchestration: { receipt, ownership: null, regime: null, routing: null, thetaQ: null, candidateEconomics: null, aegis: null, paretoSurvivorIds: null, opportunityBook: null, shadowOpportunities: [] },
      ...strategyDecisionFor(null, null),
      provenance, provenanceDetail: detail, blockers,
    };
  }

  // Merge the real, derived exposure ratios into aegisInputs -- see
  // mergeDerivedExposureIntoAegisInputs's own docstring for the honesty
  // rules (partial merge only; sector/correlation/stress remain exactly
  // what the caller supplied).
  let effectiveAegisInputs = mergeDerivedExposureIntoAegisInputs(config.aegisInputs, derivedExposure, exposureDerivationTrustworthy);

  // Additional real AEGIS-input derivations (item E) -- each independently
  // null/UNKNOWN (never overwriting the caller's value with a guess) when
  // its own required evidence is missing. See aegis-derivation.ts's own
  // docstring for exactly which fields remain caller-supplied. The
  // Production runtime injects the separate IV and per-contract spread
  // detector evidence without converting immature baselines to false.
  const derivedProviderState = deriveProviderState([accountEvidence.quality, contractsEvidence.quality, quotesEvidence.quality]);
  const derivedLiquidityAcceptable = deriveLiquidityAcceptable(mergedContractsForSnapshot, config.maxAcceptableSpreadPct);
  const derivedExecutionQualityAcceptable = deriveExecutionQualityAcceptable(mergedContractsForSnapshot);
  effectiveAegisInputs = {
    ...effectiveAegisInputs,
    ...(derivedProviderState !== null ? { providerState: derivedProviderState } : {}),
    ...(derivedLiquidityAcceptable !== null ? { liquidityAcceptable: derivedLiquidityAcceptable } : {}),
    ...(derivedExecutionQualityAcceptable !== null ? { executionQualityAcceptable: derivedExecutionQualityAcceptable } : {}),
    stressGapDetected: gapAssessment.stressGapDetected,
  };

  const candidateCapacityPolicyKeys: ReadonlyArray<keyof CandidateCapacityPolicy> = [
    'hardCapMultiplier',
    'maxTickerConcentrationPct', 'maxSectorConcentrationPct', 'maxCorrelationClusterPct',
    'maxPortfolioCapitalAtRiskPct', 'maxInventoryCapacityPct', 'maxAssignmentCapacityPct',
    'maxRecoveryCapacityPct',
  ];
  const capacityPolicyComplete = candidateCapacityPolicyKeys.every((key) =>
    typeof config.aegisPolicy[key] === 'number' && Number.isFinite(config.aegisPolicy[key]) && (config.aegisPolicy[key] as number) > 0)
    && typeof config.aegisPolicy.hardCapMultiplier === 'number' && config.aegisPolicy.hardCapMultiplier > 1;
  const candidateCapacityPolicy = capacityPolicyComplete
    ? Object.fromEntries(candidateCapacityPolicyKeys.map((key) => [key, config.aegisPolicy[key]])) as unknown as CandidateCapacityPolicy
    : null;
  const runtimeCandidates: RawCandidateInput[] = candidates.map((candidate) => {
    const spreadAssessment = aegisSpreadStressEvidence[candidate.contract.optionSymbol];
    const alpacaIvAssessment = aegisAlpacaIvStressEvidence[candidate.contract.optionSymbol];
    const candidateMarketQuality = deriveCandidateMarketQuality(candidate.contract, config.maxAcceptableSpreadPct);
    const candidateOverrides: Record<string, unknown> = {
      liquidityAcceptable: candidateMarketQuality.liquidityAcceptable,
      executionQualityAcceptable: candidateMarketQuality.executionQualityAcceptable,
      ...candidateStressAegisOverrides({spread:spreadAssessment,alpacaIv:alpacaIvAssessment,
        alpacaIvProducerConfigured:config.aegisAlpacaIvStressAssessor!==undefined}),
    };
    if (!exposureDerivationTrustworthy || candidateCapacityPolicy === null) return {
      ...candidate,
      aegisInputOverrides: candidateOverrides,
    };
    const capacity = deriveCandidateCapacityAssessment(
      derivedExposure,
      openOrders,
      {
        underlying: candidate.contract.underlying,
        securedCollateralPerContract: candidate.contract.strike * candidate.contract.multiplier,
      },
      candidate.brokerAllowedQty,
      candidateCapacityPolicy,
      recoveryInventoryValue,
    );
    const derived = capacity.inputsAtQuantityCap;
    // Preserve nulls. They are canonical UNKNOWN inputs and must override
    // any pre-trade/global value so candidate-specific AEGIS fails closed.
    Object.assign(candidateOverrides, Object.fromEntries([
      ['tickerConcentrationPct', derived.tickerConcentrationPct],
      ['sectorConcentrationPct', derived.sectorConcentrationPct],
      ['correlationClusterExposurePct', derived.correlationClusterExposurePct],
      ['portfolioCapitalAtRiskPct', derived.portfolioCapitalAtRiskPct],
      ['inventoryCapacityUsedPct', derived.inventoryCapacityUsedPct],
      ['assignmentCapacityUsedPct', derived.assignmentCapacityUsedPct],
      ['recoveryCapacityUsedPct', derived.recoveryCapacityUsedPct],
    ]));
    return {
      ...candidate,
      brokerAllowedQty: Math.min(candidate.brokerAllowedQty, capacity.quantityCap),
      aegisInputOverrides: candidateOverrides,
    };
  });

  const orchestrationStartedAt = Date.now();
  traceShadowStage(underlying, 'ORCHESTRATION_STARTED', { candidates: runtimeCandidates.length });
  const orchestration = await runNewRiskOrchestration(config.bridge, {
    snapshotId: fusionSnapshot.contentHash, fusionSnapshotHash: fusionSnapshot.contentHash, timestamp: decisionTime, underlying,
    earningsDistanceDays: null, // EventState is not real yet -- UNKNOWN, never fabricated as "no earnings nearby"
    optionQuoteFreshnessPolicy: config.optionQuoteFreshnessPolicy,
    providerCapabilities: {
      ALPACA_ACCOUNT: accountEvidence.quality,
      ALPACA_OPTION_CONTRACTS: contractsEvidence.quality,
      ALPACA_OPTION_CHAIN: quotesEvidence.quality,
      ALPACA_POSITIONS: positionsEvidence.quality,
      ALPACA_OPEN_ORDERS: openOrdersEvidence.quality,
      OPTIONOMICS: optionomicsEvidence.quality,
      EVENT_DATA: eventContextQuality,
    },
    policyVersion: config.policyVersion, modelVersions: config.modelVersions, requiredModelVersions: config.requiredModelVersions,
    ownershipPolicy: config.ownershipPolicy,
    ownershipInputs: {
      stockAvgVolume, optionOpenInterest: null, optionVolume: null, spreadPct: null,
      ret1d, ret5d, ret20d, ret60d, ma20Rel, ma50Rel, ma200Rel,
      maSlope, relativeStrength: null, rv10, rv20, rv60, drawdown, maxAdverseGap,
      gapFrequency, downsideSemivariance,
      historicalRecoveryMedianDays: config.recoveryHistory?.historicalRecoveryMedianDays??null,
      historicalRecoveryP95Days: config.recoveryHistory?.historicalRecoveryP95Days??null,
      severeDrawdownEpisodeCount: null, earningsDistanceDays: null, exDividendDistanceDays: null, knownEventDistanceDays: null,
    },
    regimePolicy: config.regimePolicy,
    regimeInputs: {
      maSlope, rv20, maxAdverseGap, earningsDistanceDays: null, corporateActionPending: null,
      macroRiskFlag: macroRiskEvidence.macroRiskFlag, spreadPct: null, portfolioOrMarketDrawdown: drawdown,
    },
    routerPolicy: config.routerPolicy, routerPortfolio: config.routerPortfolio,
    latticeConfig: config.latticeConfig, thetaQSizingPolicy: config.thetaQSizingPolicy, costAssumptions: config.costAssumptions,
    aegisPolicy: config.aegisPolicy, aegisInputs: effectiveAegisInputs,
    opportunityFrontierPolicy: config.opportunityFrontierPolicy, maxAcceptableSpreadPct: config.maxAcceptableSpreadPct,
    candidates: runtimeCandidates,
    sizingPolicy: config.sizingPolicy,
    sizingAccount: {
      equity: account?.equity ?? null, cash: account?.cash ?? null, buyingPower: account?.optionsBuyingPower ?? account?.buyingPower ?? null,
    },
    executionQualityPolicy: config.executionQualityPolicy,
    paperEntryBootstrap: config.paperEntryBootstrap,
  });
  traceShadowStage(underlying, 'ORCHESTRATION_COMPLETE', { elapsedMs: Date.now() - orchestrationStartedAt,
    candidates: runtimeCandidates.length });

  return {
    runId, startedAt, finishedAt: config.now(), universeFunnel: funnel, selectedUnderlying: underlying, underlyingRanking: ranked,
    optionChainComplete, optionContractsComplete, snapshotContentHash: fusionSnapshot.contentHash, fusionSnapshot,
    snapshotValidForNewRisk: fusionSnapshot.validForNewRisk, orchestration,
    ...strategyDecisionFor(orchestration.routing, orchestration.aegis, orchestration.aegisByCandidateId, runtimeCandidates, orchestration.thetaQ),
    provenance, provenanceDetail: detail, blockers,
  };
}
