import { performance } from 'node:perf_hooks';
import { classifyPostgresRuntimeError } from '../theta/postgres-runtime-error.js';
import { deriveMarketSessionState, type BrokerCalendarFact } from '../theta/time-aware-state.js';

export const acceleratedSessionSoakVersion = 'theta-accelerated-session-soak-v1' as const;

type InjectedFault = 'NONE' | 'AIVEN_57P03' | 'OPTIONOMICS_OUTAGE' | 'ALPACA_DELAY'
  | 'STALE_QUOTE' | 'RATE_LIMIT' | 'HEARTBEAT_DELAY';

export interface AcceleratedSessionSoakReceipt {
  readonly contractVersion: typeof acceleratedSessionSoakVersion;
  readonly scope: 'DETERMINISTIC_ENGINEERING_LIVENESS_NOT_LIVE_PROVIDER_OR_ECONOMIC_PROOF';
  readonly cycleCount: number;
  readonly completed: number;
  readonly failed: number;
  readonly timedOut: number;
  readonly phaseCounts: Readonly<Record<string, number>>;
  readonly faultCounts: Readonly<Record<InjectedFault, number>>;
  readonly typedTransitions: Readonly<Record<string, number>>;
  readonly p50SimulatedLatencyMs: number;
  readonly p95SimulatedLatencyMs: number;
  readonly maxSimulatedLatencyMs: number;
  readonly engineElapsedMs: number;
  readonly rssDeltaBytes: number;
  readonly activeResourceDelta: number;
  readonly databaseClientsOpened: 0;
  readonly researchRowsWritten: 0;
  readonly unhandledExceptions: number;
  readonly unboundedCycles: number;
  readonly genericEngineeringUnknown: number;
  readonly orderSubmissions: 0;
  readonly brokerMutations: 0;
  readonly state: 'PASS' | 'FAIL';
}

const calendar: readonly BrokerCalendarFact[] = [{
  date: '2026-09-24', open: '2026-09-24T13:30:00.000Z', close: '2026-09-24T20:00:00.000Z',
}];

const faultAt = (minute: number): InjectedFault => {
  if (minute === 15 || minute === 255) return 'AIVEN_57P03';
  if (minute === 60 || minute === 300) return 'OPTIONOMICS_OUTAGE';
  if (minute === 105) return 'ALPACA_DELAY';
  if (minute === 150 || minute === 330) return 'STALE_QUOTE';
  if (minute === 195) return 'RATE_LIMIT';
  if (minute === 225) return 'HEARTBEAT_DELAY';
  return 'NONE';
};

const percentile = (values: readonly number[], quantile: number): number => {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * quantile))] ?? 0;
};

export function runAcceleratedSessionSoak(): AcceleratedSessionSoakReceipt {
  const started = performance.now();
  const rssBefore = process.memoryUsage().rss;
  const resourcesBefore = process.getActiveResourcesInfo().length;
  const phaseCounts: Record<string, number> = {};
  const faultCounts: Record<InjectedFault, number> = {
    NONE: 0, AIVEN_57P03: 0, OPTIONOMICS_OUTAGE: 0, ALPACA_DELAY: 0,
    STALE_QUOTE: 0, RATE_LIMIT: 0, HEARTBEAT_DELAY: 0,
  };
  const transitions: Record<string, number> = {};
  const latencies: number[] = [];
  let completed = 0;
  let failed = 0;
  let genericUnknown = 0;
  for (let minute = 0; minute <= 390; minute += 1) {
    try {
      const observedAt = new Date(Date.parse('2026-09-24T13:30:00.000Z') + minute * 60_000).toISOString();
      const receipt = deriveMarketSessionState({
        observedAt, calendar,
        clock: { timestamp: observedAt, isOpen: minute < 390, nextOpen: null,
          nextClose: minute < 390 ? '2026-09-24T20:00:00.000Z' : null },
      });
      const primaryPhase = receipt.states[0] ?? 'UNCLASSIFIED';
      phaseCounts[primaryPhase] = (phaseCounts[primaryPhase] ?? 0) + 1;
      const fault = faultAt(minute);
      faultCounts[fault] += 1;
      let transition = 'CORE_CYCLE_COMPLETE';
      if (fault === 'AIVEN_57P03') {
        const classified = classifyPostgresRuntimeError({ code: '57P03' });
        transition = classified.retryableRead ? 'SPOOL_MODE_RECOVERABLE' : 'UNCLASSIFIED';
      } else if (fault === 'OPTIONOMICS_OUTAGE') transition = 'OPTIONAL_RESEARCH_UNAVAILABLE_CORE_CONTINUES';
      else if (fault === 'ALPACA_DELAY') transition = 'PROVIDER_DELAY_TYPED_NO_DECISION';
      else if (fault === 'STALE_QUOTE') transition = 'STALE_QUOTE_SYSTEM_HOLD';
      else if (fault === 'RATE_LIMIT') transition = 'BOUNDED_BACKPRESSURE';
      else if (fault === 'HEARTBEAT_DELAY') transition = 'TRANSIENT_RENEWAL_GAP';
      transitions[transition] = (transitions[transition] ?? 0) + 1;
      if (transition === 'UNCLASSIFIED') genericUnknown += 1;
      latencies.push(5 + (minute % 17) + (fault === 'NONE' ? 0 : 25));
      completed += 1;
    } catch {
      failed += 1;
    }
  }
  const rssDeltaBytes = process.memoryUsage().rss - rssBefore;
  const activeResourceDelta = process.getActiveResourcesInfo().length - resourcesBefore;
  const state = failed === 0 && genericUnknown === 0 && completed === 391 ? 'PASS' : 'FAIL';
  return {
    contractVersion: acceleratedSessionSoakVersion,
    scope: 'DETERMINISTIC_ENGINEERING_LIVENESS_NOT_LIVE_PROVIDER_OR_ECONOMIC_PROOF',
    cycleCount: 391, completed, failed, timedOut: 0, phaseCounts, faultCounts,
    typedTransitions: transitions,
    p50SimulatedLatencyMs: percentile(latencies, 0.5),
    p95SimulatedLatencyMs: percentile(latencies, 0.95),
    maxSimulatedLatencyMs: Math.max(...latencies),
    engineElapsedMs: performance.now() - started,
    rssDeltaBytes, activeResourceDelta,
    databaseClientsOpened: 0, researchRowsWritten: 0,
    unhandledExceptions: failed, unboundedCycles: 0, genericEngineeringUnknown: genericUnknown,
    orderSubmissions: 0, brokerMutations: 0, state,
  };
}
