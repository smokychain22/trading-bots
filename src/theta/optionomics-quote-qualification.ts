import { createHash, randomUUID } from 'node:crypto';
import type { NormalizedOptionomicsChain } from './optionomics-provider.js';

export const optionomicsQuoteQualificationVersion = 'theta-optionomics-quote-qualification-v1' as const;

export interface OptionomicsQuoteQualificationSample {
  readonly symbol: string;
  readonly requestedAt: string;
  readonly chain: NormalizedOptionomicsChain | null;
  readonly failureCode: string | null;
}

export interface OptionomicsQuoteQualificationReport {
  readonly qualificationRunId: string;
  readonly contractVersion: typeof optionomicsQuoteQualificationVersion;
  readonly runAt: string;
  readonly marketSession: 'OPEN' | 'CLOSED' | 'UNKNOWN';
  readonly symbols: readonly string[];
  readonly samplesRequested: number;
  readonly samplesObserved: number;
  readonly twoSidedObservations: number;
  readonly freshObservations: number;
  readonly semanticAuthority: 'RESEARCH_ONLY';
  readonly readinessState: 'BLOCKED_ON_QUOTE_PROOF' | 'BLOCKED_ON_MARKET_SESSION' | 'BLOCKED_ON_DATA';
  readonly ready: false;
  readonly blockers: readonly string[];
  readonly sampleEvidence: readonly {
    symbol: string; responseHash: string | null; observationCount: number;
    twoSidedCount: number; freshCount: number; failureCode: string | null;
  }[];
  readonly contentHash: string;
}

const positive = (value: number | null): value is number => value !== null && Number.isFinite(value) && value > 0;
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value !== null && typeof value === 'object') return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)]),
  );
  return value;
}
const canonical = (value: unknown): string => JSON.stringify(stable(value));

/**
 * Measures repeated authenticated observations without upgrading their
 * documented meaning. Current Optionomics chain responses remain research
 * observations, even when their shape and timestamps look quote-like.
 */
export function assessOptionomicsQuoteQualification(input: {
  readonly runAt: string;
  readonly marketSession: 'OPEN' | 'CLOSED' | 'UNKNOWN';
  readonly maximumAgeMs: number;
  readonly samples: readonly OptionomicsQuoteQualificationSample[];
}): OptionomicsQuoteQualificationReport {
  const now = Date.parse(input.runAt);
  const evidence = input.samples.map((sample) => {
    const entries = sample.chain?.entries ?? [];
    const twoSided = entries.filter((entry) => positive(entry.bid) && positive(entry.ask) && entry.bid <= entry.ask);
    const fresh = twoSided.filter((entry) => {
      const timestamp = Date.parse(entry.asOf ?? '');
      return Number.isFinite(now) && Number.isFinite(timestamp) && timestamp <= now && now - timestamp <= input.maximumAgeMs;
    });
    return {
      symbol: sample.symbol, responseHash: sample.chain?.responseHash ?? null,
      observationCount: entries.length, twoSidedCount: twoSided.length, freshCount: fresh.length,
      failureCode: sample.failureCode,
    };
  });
  const samplesObserved = evidence.filter((item) => item.responseHash !== null).length;
  const twoSidedObservations = evidence.reduce((sum, item) => sum + item.twoSidedCount, 0);
  const freshObservations = evidence.reduce((sum, item) => sum + item.freshCount, 0);
  const blockers = [
    input.marketSession !== 'OPEN' ? `MARKET_SESSION_${input.marketSession}` : null,
    samplesObserved < input.samples.length ? 'REPEATED_SAMPLE_COVERAGE_INCOMPLETE' : null,
    twoSidedObservations === 0 ? 'NO_TWO_SIDED_OBSERVATIONS' : null,
    freshObservations === 0 ? 'NO_FRESH_PROVIDER_TIMESTAMPS' : null,
    'PROVIDER_DOCUMENTS_SESSION_INGESTION_NOT_EXECUTION_FEED',
    'ORDER_PRICING_USE_NOT_DOCUMENTED',
  ].filter((value): value is string => value !== null);
  const readinessState: OptionomicsQuoteQualificationReport['readinessState'] = input.marketSession !== 'OPEN' ? 'BLOCKED_ON_MARKET_SESSION'
    : samplesObserved === 0 ? 'BLOCKED_ON_DATA' : 'BLOCKED_ON_QUOTE_PROOF';
  const unsigned = {
    contractVersion: optionomicsQuoteQualificationVersion, runAt: input.runAt, marketSession: input.marketSession,
    symbols: [...new Set(input.samples.map((sample) => sample.symbol))].sort(), samplesRequested: input.samples.length,
    samplesObserved, twoSidedObservations, freshObservations, semanticAuthority: 'RESEARCH_ONLY' as const,
    readinessState, ready: false as const, blockers, sampleEvidence: evidence,
  };
  return {
    qualificationRunId: randomUUID(), ...unsigned,
    contentHash: createHash('sha256').update(canonical(unsigned)).digest('hex'),
  };
}
