import type { JsonValue } from '../market/fusion-snapshot.js';
import type { CanonicalStrategyFrontier } from './canonical-strategy-frontier.js';

export const firstPaperRuntimeTelemetryVersion = 'theta-first-paper-runtime-telemetry-v1' as const;

export interface FirstPaperRuntimeTelemetry {
  readonly version: typeof firstPaperRuntimeTelemetryVersion;
  readonly candidateCount: number;
  readonly conventionalCandidateCount: number;
  readonly positiveSizeCandidateCount: number;
  readonly zeroSizeCandidateCount: number;
  readonly bindingConstraintCounts: Readonly<Record<string, number>>;
  readonly aegisStateCounts: Readonly<Record<string, number>>;
  readonly finalistRefresh: {
    readonly state: 'OBSERVED' | 'NOT_OBSERVED';
    readonly policyVersion: string | null;
    readonly initialCandidateCount: number | null;
    readonly selectedCount: number | null;
    readonly refreshedCount: number | null;
    readonly failedCount: number | null;
    readonly candidateBuiltAt: string | null;
    readonly finalistChosenAt: string | null;
    readonly decisionAsOf: string | null;
    readonly candidateToDecisionMs: number | null;
    readonly refreshRoundTripMsP50: number | null;
    readonly refreshRoundTripMsP95: number | null;
    readonly refreshedQuoteAgeAtDecisionSecondsP50: number | null;
    readonly refreshedQuoteAgeAtDecisionSecondsP95: number | null;
    readonly refreshedQuoteTimestampUnavailableCount: number | null;
  };
  readonly brokerAuthority: false;
}

function increment(target: Record<string, number>, value: string): void {
  target[value] = (target[value] ?? 0) + 1;
}

function object(value: JsonValue | undefined): Record<string, JsonValue> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, JsonValue> : null;
}

function stringOrNull(value: JsonValue | undefined): string | null {
  return typeof value === 'string' ? value : null;
}

function nonnegativeIntegerOrNull(value: JsonValue | undefined): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function nonnegativeNumberOrNull(value: JsonValue | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

export function buildFirstPaperRuntimeTelemetry(input: {
  readonly frontier: CanonicalStrategyFrontier | null;
  readonly alpacaQuoteState: JsonValue | undefined;
}): FirstPaperRuntimeTelemetry {
  const candidates = input.frontier?.branches.flatMap((branch) => branch.candidates) ?? [];
  const bindingConstraintCounts: Record<string, number> = {};
  const aegisStateCounts: Record<string, number> = {};
  for (const candidate of candidates) {
    increment(bindingConstraintCounts, candidate.sizing.bindingConstraint);
    increment(aegisStateCounts, candidate.aegisState ?? 'UNKNOWN');
  }
  const refresh = object(input.alpacaQuoteState);
  const refreshObserved = refresh !== null
    && refresh.contractVersion === 'theta-finalist-quote-refresh-v1';
  const latency = refresh === null ? null : object(refresh.latency);
  return {
    version: firstPaperRuntimeTelemetryVersion,
    candidateCount: candidates.length,
    conventionalCandidateCount: candidates.filter((candidate) => candidate.branch === 'THETA_CONVENTIONAL').length,
    positiveSizeCandidateCount: candidates.filter((candidate) => candidate.sizing.quantity > 0).length,
    zeroSizeCandidateCount: candidates.filter((candidate) => candidate.sizing.quantity === 0).length,
    bindingConstraintCounts,
    aegisStateCounts,
    finalistRefresh: refreshObserved ? {
      state: 'OBSERVED',
      policyVersion: stringOrNull(refresh.policyVersion),
      initialCandidateCount: nonnegativeIntegerOrNull(refresh.initialCandidateCount),
      selectedCount: nonnegativeIntegerOrNull(refresh.selectedCount),
      refreshedCount: nonnegativeIntegerOrNull(refresh.refreshedCount),
      failedCount: nonnegativeIntegerOrNull(refresh.failedCount),
      candidateBuiltAt: stringOrNull(refresh.candidateBuiltAt),
      finalistChosenAt: stringOrNull(refresh.finalistChosenAt),
      decisionAsOf: stringOrNull(refresh.decisionAsOf),
      candidateToDecisionMs: nonnegativeNumberOrNull(latency?.candidateToDecisionMs),
      refreshRoundTripMsP50: nonnegativeNumberOrNull(latency?.refreshRoundTripMsP50),
      refreshRoundTripMsP95: nonnegativeNumberOrNull(latency?.refreshRoundTripMsP95),
      refreshedQuoteAgeAtDecisionSecondsP50: nonnegativeNumberOrNull(latency?.refreshedQuoteAgeAtDecisionSecondsP50),
      refreshedQuoteAgeAtDecisionSecondsP95: nonnegativeNumberOrNull(latency?.refreshedQuoteAgeAtDecisionSecondsP95),
      refreshedQuoteTimestampUnavailableCount: nonnegativeIntegerOrNull(latency?.refreshedQuoteTimestampUnavailableCount),
    } : {
      state: 'NOT_OBSERVED', policyVersion: null, initialCandidateCount: null,
      selectedCount: null, refreshedCount: null, failedCount: null,
      candidateBuiltAt: null, finalistChosenAt: null, decisionAsOf: null,
      candidateToDecisionMs: null, refreshRoundTripMsP50: null, refreshRoundTripMsP95: null,
      refreshedQuoteAgeAtDecisionSecondsP50: null, refreshedQuoteAgeAtDecisionSecondsP95: null,
      refreshedQuoteTimestampUnavailableCount: null,
    },
    brokerAuthority: false,
  };
}
