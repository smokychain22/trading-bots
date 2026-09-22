import { buildCorrelationEvidence, type CorrelationEvidence } from '../theta/correlation-evidence.js';
import type { HistoricalBar } from '../theta/underlying-history.js';

/**
 * Research/shadow only. `brokerAuthority: false` always. Pre-VPS Wave 2,
 * Slice 17. Owns NO exposure-cap or cluster-threshold policy -- this module
 * answers a strictly narrower, prior question: is a symbol pair's pairwise
 * correlation (as computed by `correlation-evidence.ts`, the one real
 * Codex-owned computation, never re-derived here) STABLE across lookback
 * windows, or does it materially change (including changing sign) depending
 * on which window is chosen? A single-window correlation figure, on its own,
 * cannot answer that question -- this is the concrete "20/60/120-session
 * correlation... research tooling" gap this pass's dispatch named as still
 * missing (`docs/research/THETA_PRE_VPS_AUDIT_SCOPE_AND_PLAN.md`, "Still
 * explicitly deferred").
 *
 * This module calls the real `buildCorrelationEvidence` once per window and
 * never invents, interpolates, or backfills a correlation value: a window
 * with insufficient overlapping returns for a given pair is UNKNOWN for that
 * window, exactly as `correlation-evidence.ts` already represents it, and
 * that UNKNOWN is carried through into `windowValues` rather than dropped or
 * treated as zero/no-correlation.
 */
export const correlationWindowStabilityVersion = 'theta-correlation-window-stability-v1' as const;

export const DEFAULT_STABILITY_WINDOWS = [20, 60, 120] as const;

export interface WindowStabilityConfig {
  readonly asOf: string;
  readonly windows: readonly number[];
  readonly evidenceVersion: string;
  readonly dataVersion: string;
}

export interface PairWindowValue {
  readonly window: number;
  readonly correlation: number | null;
  readonly state: 'KNOWN' | 'UNKNOWN';
  readonly overlappingReturnCount: number;
  readonly missingReason: string | null;
}

export type StabilityClassification =
  /** Fewer than 2 windows produced a KNOWN value for this pair -- stability is itself UNKNOWN, not "stable by default." */
  | 'INSUFFICIENT_KNOWN_WINDOWS'
  /** All KNOWN windows agree in sign and the range between the max and min KNOWN correlation is < 0.30 (research default, not a Production threshold). */
  | 'STABLE'
  /** All KNOWN windows agree in sign but the range is >= 0.30. */
  | 'UNSTABLE_MAGNITUDE'
  /** At least one KNOWN window is positive and at least one is negative. */
  | 'SIGN_FLIP';

export interface PairWindowStability {
  readonly left: string;
  readonly right: string;
  readonly windowValues: readonly PairWindowValue[];
  readonly knownWindowCount: number;
  readonly minKnownCorrelation: number | null;
  readonly maxKnownCorrelation: number | null;
  readonly range: number | null;
  readonly classification: StabilityClassification;
}

export interface CorrelationWindowStabilityReport {
  readonly asOf: string;
  readonly windows: readonly number[];
  readonly evidenceVersion: string;
  readonly dataVersion: string;
  readonly symbols: readonly string[];
  readonly pairs: readonly PairWindowStability[];
  /** Pairs where every KNOWN-window value shares one sign but the range spans the STABLE/UNSTABLE_MAGNITUDE boundary purely due to which windows happened to be KNOWN vs UNKNOWN -- flagged for a human/future pass, not resolved automatically. */
  readonly partiallyKnownPairCount: number;
}

const STABLE_RANGE_THRESHOLD = 0.30;

function classify(known: readonly number[]): { classification: StabilityClassification; min: number | null; max: number | null; range: number | null } {
  if (known.length < 2) return { classification: 'INSUFFICIENT_KNOWN_WINDOWS', min: known[0] ?? null, max: known[0] ?? null, range: null };
  const min = Math.min(...known);
  const max = Math.max(...known);
  const range = max - min;
  if (min < 0 && max > 0) return { classification: 'SIGN_FLIP', min, max, range };
  return { classification: range >= STABLE_RANGE_THRESHOLD ? 'UNSTABLE_MAGNITUDE' : 'STABLE', min, max, range };
}

/**
 * `barsBySymbol` must already be point-in-time filtered by the caller for
 * `config.asOf` if the caller wants strict PIT discipline beyond what
 * `correlation-evidence.ts`'s own `barsAsOf` applies internally per window --
 * this module does not perform any additional PIT filtering itself.
 */
export function buildCorrelationWindowStabilityReport(
  bars: readonly HistoricalBar[],
  config: WindowStabilityConfig,
): CorrelationWindowStabilityReport {
  if (config.windows.length < 2) throw new Error('WINDOW_STABILITY_REQUIRES_AT_LEAST_TWO_WINDOWS');
  const sortedWindows = [...new Set(config.windows)].toSorted((a, b) => a - b);
  if (sortedWindows.length < 2) throw new Error('WINDOW_STABILITY_REQUIRES_AT_LEAST_TWO_DISTINCT_WINDOWS');

  const perWindowEvidence: readonly CorrelationEvidence[] = sortedWindows.map((lookbackBars) =>
    buildCorrelationEvidence(bars, {
      asOf: config.asOf,
      lookbackBars,
      evidenceVersion: config.evidenceVersion,
      dataVersion: config.dataVersion,
    }),
  );

  const symbols = [...new Set(perWindowEvidence.flatMap((evidence) => evidence.symbols))].sort();

  const pairKeys = new Set<string>();
  for (const evidence of perWindowEvidence) {
    for (const pair of evidence.pairs) pairKeys.add(`${pair.left}|${pair.right}`);
  }

  const pairs: PairWindowStability[] = [];
  let partiallyKnownPairCount = 0;
  for (const key of [...pairKeys].sort()) {
    const [left, right] = key.split('|') as [string, string];
    const windowValues: PairWindowValue[] = sortedWindows.map((window, index) => {
      const evidence = perWindowEvidence[index] as CorrelationEvidence;
      const match = evidence.pairs.find((pair) => pair.left === left && pair.right === right);
      if (match === undefined) {
        return { window, correlation: null, state: 'UNKNOWN', overlappingReturnCount: 0, missingReason: 'PAIR_NOT_PRESENT_IN_WINDOW' };
      }
      return { window, correlation: match.correlation, state: match.state, overlappingReturnCount: match.overlappingReturnCount, missingReason: match.missingReason };
    });
    const known = windowValues.filter((value) => value.state === 'KNOWN').map((value) => value.correlation as number);
    const { classification, min, max, range } = classify(known);
    if (known.length > 0 && known.length < windowValues.length) partiallyKnownPairCount += 1;
    pairs.push({ left, right, windowValues, knownWindowCount: known.length, minKnownCorrelation: min, maxKnownCorrelation: max, range, classification });
  }

  return {
    asOf: config.asOf, windows: sortedWindows, evidenceVersion: config.evidenceVersion, dataVersion: config.dataVersion,
    symbols, pairs, partiallyKnownPairCount,
  };
}
