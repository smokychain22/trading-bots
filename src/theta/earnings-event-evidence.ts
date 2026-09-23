import type { NormalizedOptionomicsContextObservation } from './optionomics-provider.js';

export const optionomicsEarningsEvidenceVersion = 'theta-optionomics-earnings-evidence-v1' as const;

export interface OptionomicsEarningsEvidence {
  readonly version: typeof optionomicsEarningsEvidenceVersion;
  readonly authority: 'OPTIONOMICS_SESSION_RESEARCH';
  readonly state: 'KNOWN_POSITIVE_DISTANCE' | 'UNKNOWN' | 'INVALID' | 'NOT_OBSERVED';
  readonly distanceTradingSessions: number | null;
  readonly distanceCalendarDays: null;
  readonly coverageAuthority: 'POSITIVE_DISTANCE_ONLY_NO_NEGATIVE_ASSURANCE';
  readonly providerTimestamp: string | null;
  readonly thetaObservedAt: string | null;
  readonly thetaFirstObservedAt: null;
  readonly sessionDate: string | null;
  readonly evidenceId: string | null;
  readonly reason: string;
  readonly paperEntryNegativeAssurance: false;
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

export function deriveOptionomicsEarningsEvidence(
  observations: readonly NormalizedOptionomicsContextObservation[],
): OptionomicsEarningsEvidence {
  const metrics = observations.filter((observation) => observation.family === 'METRICS')
    .toSorted((left, right) => right.retrievedAt.localeCompare(left.retrievedAt))[0];
  const base = {
    version: optionomicsEarningsEvidenceVersion,
    authority: 'OPTIONOMICS_SESSION_RESEARCH' as const,
    distanceCalendarDays: null,
    coverageAuthority: 'POSITIVE_DISTANCE_ONLY_NO_NEGATIVE_ASSURANCE' as const,
    thetaFirstObservedAt: null,
    paperEntryNegativeAssurance: false as const,
  };
  if (metrics === undefined) return {
    ...base, state: 'NOT_OBSERVED', distanceTradingSessions: null, providerTimestamp: null,
    thetaObservedAt: null, sessionDate: null, evidenceId: null, reason: 'METRICS_NOT_OBSERVED_THIS_CYCLE',
  };
  const field = object(metrics.normalized.earningsInSessions);
  const providerState = field?.state;
  const value = field?.value;
  const common = {
    ...base,
    providerTimestamp: metrics.providerTimestamp,
    thetaObservedAt: metrics.retrievedAt,
    sessionDate: metrics.sessionDate,
    evidenceId: metrics.responseHash,
  };
  if (providerState === 'KNOWN' && typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return {
    ...common, state: 'KNOWN_POSITIVE_DISTANCE', distanceTradingSessions: value,
    reason: 'PROVIDER_REPORTED_TRADING_SESSION_DISTANCE',
  };
  if (providerState === 'INVALID') return {
    ...common, state: 'INVALID', distanceTradingSessions: null,
    reason: typeof field?.reason === 'string' ? field.reason : 'EARNINGS_DISTANCE_INVALID',
  };
  return {
    ...common, state: 'UNKNOWN', distanceTradingSessions: null,
    reason: typeof field?.reason === 'string' ? field.reason : 'EARNINGS_DISTANCE_UNKNOWN',
  };
}
