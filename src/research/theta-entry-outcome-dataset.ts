/**
 * THETA entry/why-now outcome dataset (Wave 17 section 2). Research-only,
 * `brokerAuthority: false`. Connects what THETA knew at entry-candidate
 * time to what the full managed economic chain eventually produced --
 * the shared row schema future entry-model baselines
 * (`theta-entry-model-readiness.ts`) will train/evaluate against. The
 * outcome label is the MANAGED WHOLE-CHAIN after-cost result
 * (`ManagedEpisodeOutcomeDistribution`), never "option expired
 * worthless" or any other single-leg proxy.
 *
 * Every feature carries its own `SourcedFeature<T>` envelope (value,
 * unit, state, source, observedAt, availableAt, methodologyVersion, PIT
 * status) -- this module never collapses a missing/unqualified feature
 * into a default number, and never accepts a feature whose `observedAt`
 * is after the row's own `decisionAt` (a real PIT violation, rejected at
 * construction, not silently absorbed).
 */
import type { ManagedEpisodeOutcomeDistribution } from './managed-episode-outcome-distribution.js';

export const thetaEntryOutcomeDatasetVersion = 'theta-entry-outcome-dataset-v1' as const;

export type FeatureState = 'KNOWN' | 'UNKNOWN' | 'PROVIDER_LIMITED' | 'STALE' | 'NOT_APPLICABLE';

export interface SourcedFeature<T> {
  readonly value: T | null;
  readonly unit: string;
  readonly state: FeatureState;
  readonly source: string;
  readonly observedAt: string | null;
  readonly availableAt: string | null;
  readonly methodologyVersion: string;
  readonly pitStatus: 'PIT_SAFE' | 'CURRENT_ONLY' | 'PIT_UNSAFE' | 'UNKNOWN_PIT';
}

export type EarningsEvidenceState = 'KNOWN_EVENT_DISTANCE' | 'KNOWN_EVENT_NEAR' | 'PARTIAL_COVERAGE' | 'PROVIDER_LIMITED' | 'STALE' | 'PROVIDER_ERROR' | 'UNKNOWN';

export interface ThetaEntryOutcomeRow {
  readonly contractVersion: typeof thetaEntryOutcomeDatasetVersion;
  readonly datasetRowId: string;
  readonly cycleId: string;
  readonly decisionId: string;
  readonly candidateId: string;
  readonly chainId: string | null;

  readonly candidateObservedAt: string;
  readonly featureAvailableAt: string;
  readonly decisionAt: string;
  readonly labelAvailableAt: string | null;

  readonly canonicalSourceSha: string;
  readonly releaseSha: string | null;
  readonly policyVersion: string;
  readonly featureSchemaVersion: string;

  readonly underlying: {
    readonly symbol: string;
    readonly underlyingPrice: SourcedFeature<number>;
    readonly dollarVolume: SourcedFeature<number>;
    readonly liquidityState: SourcedFeature<string>;
    readonly trendState: SourcedFeature<string>;
    readonly regimeState: SourcedFeature<string>;
    readonly ownershipState: SourcedFeature<string>;
  };

  readonly contract: {
    readonly optionType: 'PUT' | 'CALL';
    readonly expiration: string;
    readonly calendarDte: number;
    /** Distinct from calendarDte -- a trading-session count, only
     * populated when separately derived from a real session calendar.
     * Never assumed equal to calendarDte (weekends/holidays differ). */
    readonly tradingSessionHorizon: SourcedFeature<number>;
    readonly strike: number;
    readonly signedDelta: SourcedFeature<number>;
    readonly absoluteDelta: SourcedFeature<number>;
    readonly moneyness: SourcedFeature<number>;
    /** Real broker contract metadata -- never defaulted to 100. */
    readonly multiplier: SourcedFeature<number>;
  };

  readonly execution: {
    readonly bid: SourcedFeature<number>;
    readonly ask: SourcedFeature<number>;
    readonly mid: SourcedFeature<number>;
    readonly absoluteSpread: SourcedFeature<number>;
    readonly relativeSpread: SourcedFeature<number>;
    readonly quoteProviderTimestamp: string | null;
    readonly quoteReceivedAt: string | null;
    readonly quoteAgeAtDecisionSeconds: number | null;
    readonly feed: string | null;
    readonly quoteQuality: string | null;
    readonly executabilityState: 'EXECUTABLE' | 'NOT_EXECUTABLE' | 'UNKNOWN';
  };

  readonly volatility: {
    readonly atmIv: SourcedFeature<number>;
    readonly rv20: SourcedFeature<number>;
    readonly vrp20: SourcedFeature<number>;
    readonly skew: SourcedFeature<number>;
    readonly termStructure: SourcedFeature<number>;
    readonly derivedExpectedMoveV1: SourcedFeature<number>;
    readonly gex: SourcedFeature<number>;
    readonly flow: SourcedFeature<number>;
  };

  readonly economics: {
    readonly executableCredit: SourcedFeature<number>;
    readonly collateral: SourcedFeature<number>;
    readonly premiumToCollateral: SourcedFeature<number>;
    readonly breakeven: SourcedFeature<number>;
    readonly downsideCushion: SourcedFeature<number>;
    readonly estimatedCapitalDays: SourcedFeature<number>;
  };

  readonly events: {
    readonly macroEventState: SourcedFeature<string>;
    readonly earningsDistanceInSessions: SourcedFeature<number>;
    readonly earningsEvidenceState: EarningsEvidenceState;
    /** Never derived from an empty/absent earnings feed -- per the
     * standing rule this module enforces, coverage completeness is a
     * separate, explicit claim from having observed a positive distance. */
    readonly earningsCoverageState: 'PARTIAL_COVERAGE' | 'PROVIDER_LIMITED' | 'UNKNOWN';
    readonly corporateActionState: SourcedFeature<string>;
    readonly corporateActionCoverageState: 'PROVIDER_LIMITED' | 'UNKNOWN';
  };

  readonly portfolio: {
    readonly buyingPower: SourcedFeature<number>;
    readonly assignmentCapacity: SourcedFeature<number>;
    readonly concentration: SourcedFeature<number>;
    readonly correlationState: SourcedFeature<string>;
    readonly severeDownsideState: SourcedFeature<string>;
    readonly aegisState: SourcedFeature<string>;
    readonly selectedQty: number | null;
    readonly bindingSizingConstraint: string | null;
  };

  readonly censoredEpisode: boolean;
  readonly outcome: ManagedEpisodeOutcomeDistribution | null;
}

function assertNotFutureRelativeToDecision(fieldPath: string, observedAt: string | null, decisionAt: string): void {
  if (observedAt === null) return;
  const observedMs = Date.parse(observedAt);
  const decisionMs = Date.parse(decisionAt);
  if (!Number.isFinite(observedMs) || !Number.isFinite(decisionMs)) throw new Error(`ENTRY_ROW_TIMESTAMP_UNPARSEABLE:${fieldPath}`);
  if (observedMs > decisionMs) throw new Error(`ENTRY_ROW_FUTURE_FEATURE_TIMESTAMP:${fieldPath}`);
}

function collectSourcedFeatures(row: Pick<ThetaEntryOutcomeRow, 'underlying' | 'contract' | 'execution' | 'volatility' | 'economics' | 'events' | 'portfolio'>):
  readonly [string, SourcedFeature<unknown>][] {
  const out: [string, SourcedFeature<unknown>][] = [];
  const visit = (obj: Record<string, unknown>, prefix: string): void => {
    for (const [key, value] of Object.entries(obj)) {
      if (value !== null && typeof value === 'object' && 'state' in (value as object) && 'observedAt' in (value as object)) {
        out.push([`${prefix}.${key}`, value as SourcedFeature<unknown>]);
      }
    }
  };
  visit(row.underlying as unknown as Record<string, unknown>, 'underlying');
  visit(row.contract as unknown as Record<string, unknown>, 'contract');
  visit(row.execution as unknown as Record<string, unknown>, 'execution');
  visit(row.volatility as unknown as Record<string, unknown>, 'volatility');
  visit(row.economics as unknown as Record<string, unknown>, 'economics');
  visit(row.events as unknown as Record<string, unknown>, 'events');
  visit(row.portfolio as unknown as Record<string, unknown>, 'portfolio');
  return out;
}

/**
 * Builds and validates one real entry-outcome row. Throws on any real
 * PIT violation (a feature's `observedAt` after `decisionAt`, or
 * `labelAvailableAt` before `decisionAt`) rather than silently accepting
 * leaked future information.
 */
export function buildThetaEntryOutcomeRow(input: Omit<ThetaEntryOutcomeRow, 'contractVersion'>): ThetaEntryOutcomeRow {
  if (!Number.isFinite(Date.parse(input.decisionAt))) throw new Error('ENTRY_ROW_INVALID_DECISION_AT');
  if (!Number.isFinite(Date.parse(input.candidateObservedAt))) throw new Error('ENTRY_ROW_INVALID_CANDIDATE_OBSERVED_AT');
  if (Date.parse(input.candidateObservedAt) > Date.parse(input.decisionAt)) throw new Error('ENTRY_ROW_FUTURE_CANDIDATE_OBSERVED_AT');
  if (input.labelAvailableAt !== null) {
    const labelMs = Date.parse(input.labelAvailableAt);
    if (!Number.isFinite(labelMs)) throw new Error('ENTRY_ROW_INVALID_LABEL_AVAILABLE_AT');
    if (labelMs < Date.parse(input.decisionAt)) throw new Error('ENTRY_ROW_LABEL_AVAILABLE_BEFORE_DECISION');
  }
  if (!input.censoredEpisode && input.outcome !== null && input.labelAvailableAt === null) {
    throw new Error('ENTRY_ROW_OUTCOME_WITHOUT_LABEL_AVAILABLE_AT');
  }
  if (input.censoredEpisode && input.outcome !== null) {
    // A censored episode may still carry a real (all-CENSORED) outcome
    // distribution object -- but every field within it must itself
    // report CENSORED, never a resolved number. Spot-check the most
    // decision-relevant field rather than re-validating the whole object
    // (that object's own constructor already enforces this).
    if (input.outcome.expectedNetPnl.state !== 'CENSORED') throw new Error('ENTRY_ROW_CENSORED_BUT_OUTCOME_NOT_CENSORED');
  }

  const featureCollections = collectSourcedFeatures(input);
  for (const [path, feature] of featureCollections) {
    assertNotFutureRelativeToDecision(path, feature.observedAt, input.decisionAt);
    if (feature.state === 'KNOWN' && feature.value === null) throw new Error(`ENTRY_ROW_KNOWN_FEATURE_WITH_NULL_VALUE:${path}`);
  }

  // Earnings coverage can never become "clear" -- a structural guarantee,
  // not just documentation: EarningsEvidenceState's own type has no
  // CLEAR/KNOWN_ABSENT value at all, so no caller can construct one.

  return { contractVersion: thetaEntryOutcomeDatasetVersion, ...input };
}
