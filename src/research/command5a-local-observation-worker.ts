import {
  buildContractPathObservationReceipt,
  classifyObservationDeferral,
  type ContractPathObservationReceipt,
  type ContractPathQuoteObservation,
} from './contract-path-observation-runtime.js';
import { archiveContractPathObservation } from '../storage/contract-path-local-archive.js';
import {
  LocalObservationJobScheduler,
  type LocalObservationJobReceipt,
  type LocalObservationSubjectReceipt,
} from '../storage/local-observation-job-scheduler.js';

export const command5aLocalObservationWorkerVersion = 'theta-command5a-local-observation-worker-v1' as const;

export interface Command5aObservedSubject {
  readonly state: 'READY' | 'MISSING' | 'INVALID';
  readonly quotes: readonly ContractPathQuoteObservation[];
  readonly underlying: ContractPathObservationReceipt['underlying'] | null;
  readonly observedAt: string;
  readonly reasonCode: string | null;
}

export interface Command5aReadOnlyObservationSource {
  readonly brokerAuthority: false;
  marketState(): Promise<{ readonly providerAvailable: boolean; readonly marketSessionOpen: boolean | null }>;
  observe(input: {
    readonly job: LocalObservationJobReceipt;
    readonly subject: LocalObservationSubjectReceipt;
  }): Promise<Command5aObservedSubject>;
}

export interface Command5aObservationWorkerReport {
  readonly contractVersion: typeof command5aLocalObservationWorkerVersion;
  readonly claimed: number;
  readonly observed: number;
  readonly missed: number;
  readonly invalidated: number;
  readonly deferredProvider: number;
  readonly deferredMarket: number;
  readonly failedRetryable: number;
  readonly censoredRetryExhausted: number;
  readonly observationIds: readonly string[];
  readonly reasonCounts: Readonly<Record<string, number>>;
  readonly brokerAuthority: false;
  readonly orderSubmissions: 0;
  readonly brokerMutations: 0;
}

function count(reasons: Map<string, number>, reason: string): void {
  reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
}

function expectedLegs(subject: LocalObservationSubjectReceipt) {
  return subject.episode.legs.map((leg) => {
    if (leg.positionIntent !== 'SELL_TO_OPEN' && leg.positionIntent !== 'BUY_TO_OPEN') {
      throw new Error('COMMAND5A_OBSERVATION_LEG_INTENT_INVALID');
    }
    return {
      optionSymbol: leg.optionSymbol,
      side: leg.positionIntent === 'SELL_TO_OPEN' ? 'SHORT' as const : 'LONG' as const,
      optionType: leg.optionType,
      expiration: leg.expiration,
      strike: leg.strike,
      multiplier: leg.multiplier,
    };
  });
}

function safeReason(value: string | null, fallback: string): string {
  return value !== null && /^[A-Z0-9_:-]{1,128}$/.test(value) ? value : fallback;
}

const sessionCloseHorizons = new Set([
  'EOD', '1_TRADING_DAY', '3_TRADING_DAYS', '5_TRADING_DAYS', 'EXPIRATION',
]);

/** A post-close latest mark can represent only a target defined at session
 * close. Intraday targets must never be backfilled with a later close mark. */
export function command5aClosedSessionLatestMarkEligible(job: LocalObservationJobReceipt): boolean {
  const factualHorizon = job.horizonCode === 'PRIMARY_COMMON_HORIZON'
    ? job.derivedFromHorizonCode : job.horizonCode;
  return factualHorizon !== null && sessionCloseHorizons.has(factualHorizon);
}

/**
 * Claims and resolves bounded local Command-5A observation jobs. This worker
 * receives a read-only market source and never imports a mutation-capable
 * broker. An archive write must verify before a job can become OBSERVED.
 */
export async function runCommand5aLocalObservationWorker(input: {
  readonly scheduler: LocalObservationJobScheduler;
  readonly source: Command5aReadOnlyObservationSource;
  readonly spoolPath: string;
  readonly claimedBy: string;
  readonly asOf: string;
  readonly claimTtlSeconds: number;
  readonly limit?: number;
  /**
   * Session-close targets become due exactly when the exchange clock closes.
   * When enabled, the source may fetch Alpaca's latest mark after close. Its
   * ordinary quote-age checks still decide whether that mark is factual and
   * fresh enough. Unknown market state remains deferred.
   */
  readonly allowClosedSessionLatestMark?: boolean;
  readonly maximumAttempts?: number;
}): Promise<Command5aObservationWorkerReport> {
  if (input.source.brokerAuthority !== false) throw new Error('COMMAND5A_OBSERVATION_SOURCE_AUTHORITY_INVALID');
  const maximumAttempts = input.maximumAttempts ?? 3;
  if (!Number.isInteger(maximumAttempts) || maximumAttempts < 1 || maximumAttempts > 100) {
    throw new Error('COMMAND5A_OBSERVATION_MAXIMUM_ATTEMPTS_INVALID');
  }
  const claimed = input.scheduler.claimDue({
    asOf: input.asOf,
    claimedBy: input.claimedBy,
    claimTtlSeconds: input.claimTtlSeconds,
    limit: input.limit,
  });
  const reasons = new Map<string, number>();
  const observationIds: string[] = [];
  let observed = 0, missed = 0, invalidated = 0, deferredProvider = 0, deferredMarket = 0;
  let failedRetryable = 0, censoredRetryExhausted = 0;
  if (claimed.length === 0) return {
    contractVersion: command5aLocalObservationWorkerVersion,
    claimed: 0, observed, missed, invalidated, deferredProvider, deferredMarket, failedRetryable,
    censoredRetryExhausted,
    observationIds, reasonCounts: {}, brokerAuthority: false, orderSubmissions: 0, brokerMutations: 0,
  };

  let market: Awaited<ReturnType<Command5aReadOnlyObservationSource['marketState']>>;
  try {
    market = await input.source.marketState();
  } catch {
    market = { providerAvailable: false, marketSessionOpen: null };
  }
  for (const job of claimed) {
    const closedSessionEligible = input.allowClosedSessionLatestMark === true
      && command5aClosedSessionLatestMarkEligible(job);
    const dueState = classifyObservationDeferral({ ...market,
      allowClosedSessionLatestMark: closedSessionEligible });
    if (dueState !== 'DUE') {
      const reason = dueState === 'DEFERRED_PROVIDER'
        ? 'MARKET_PROVIDER_UNAVAILABLE'
        : market.marketSessionOpen === false && input.allowClosedSessionLatestMark === true
          ? 'CLOSED_SESSION_MARK_NOT_VALID_FOR_INTRADAY_TARGET'
          : 'MARKET_SESSION_NOT_OPEN';
      if (job.attempts >= maximumAttempts) {
        const exhaustedReason = `${reason}_RETRY_LIMIT_EXHAUSTED`;
        input.scheduler.resolve({ observationJobId: job.observationJobId, claimedBy: input.claimedBy,
          state: 'CENSORED', resolvedAt: input.asOf, reasonCode: exhaustedReason });
        censoredRetryExhausted += 1;
        count(reasons, exhaustedReason);
      } else {
        input.scheduler.defer({ observationJobId: job.observationJobId, claimedBy: input.claimedBy,
          state: dueState, asOf: input.asOf, reasonCode: reason });
        count(reasons, reason);
        if (dueState === 'DEFERRED_PROVIDER') deferredProvider += 1;
        else deferredMarket += 1;
      }
      continue;
    }
    let subject: LocalObservationSubjectReceipt;
    try {
      subject = input.scheduler.getSubject(job.subjectId);
    } catch {
      const reason = 'SUBJECT_MANIFEST_MISSING';
      input.scheduler.resolve({ observationJobId: job.observationJobId, claimedBy: input.claimedBy,
        state: 'INVALIDATED', resolvedAt: input.asOf, reasonCode: reason });
      invalidated += 1;
      count(reasons, reason);
      continue;
    }
    if (subject.episode.legs.length === 0) {
      const reason = 'SUBJECT_HAS_NO_CONTRACT_LEGS';
      input.scheduler.resolve({ observationJobId: job.observationJobId, claimedBy: input.claimedBy,
        state: 'INVALIDATED', resolvedAt: input.asOf, reasonCode: reason });
      invalidated += 1;
      count(reasons, reason);
      continue;
    }
    try {
      const result = await input.source.observe({ job, subject });
      const reason = safeReason(result.reasonCode,
        result.state === 'MISSING' ? 'EXACT_MARKET_OBSERVATION_MISSING' : 'MARKET_OBSERVATION_INVALID');
      if (result.state !== 'READY' || result.underlying === null) {
        input.scheduler.resolve({ observationJobId: job.observationJobId, claimedBy: input.claimedBy,
          state: result.state === 'INVALID' ? 'INVALIDATED' : 'MISSED',
          resolvedAt: result.observedAt, reasonCode: reason });
        if (result.state === 'INVALID') invalidated += 1;
        else missed += 1;
        count(reasons, reason);
        continue;
      }
      const receipt = buildContractPathObservationReceipt({
        observationJobId: job.observationJobId,
        subjectId: job.subjectId,
        checkpoint: job.horizonCode,
        targetAt: job.targetAt,
        actualObservedAt: result.observedAt,
        expectedLegs: expectedLegs(subject),
        quotes: result.quotes,
        underlying: result.underlying,
        sourceSha: job.sourceSha,
        workerSha: job.workerSha,
      });
      archiveContractPathObservation({
        spoolPath: input.spoolPath,
        decisionCycleId: subject.decisionCycleId,
        observation: receipt,
      });
      input.scheduler.resolve({ observationJobId: job.observationJobId, claimedBy: input.claimedBy,
        state: 'OBSERVED', resolvedAt: result.observedAt, reasonCode: null });
      observationIds.push(receipt.observationId);
      observed += 1;
    } catch {
      if (job.attempts >= maximumAttempts) {
        const reason = 'OBSERVATION_RETRY_LIMIT_EXHAUSTED';
        input.scheduler.resolve({ observationJobId: job.observationJobId, claimedBy: input.claimedBy,
          state: 'CENSORED', resolvedAt: input.asOf, reasonCode: reason });
        censoredRetryExhausted += 1;
        count(reasons, reason);
      } else {
        // Leave IN_PROGRESS so the scheduler's claim TTL provides deterministic
        // crash/archive/provider recovery. Never mark OBSERVED before archive
        // verification succeeds.
        failedRetryable += 1;
        count(reasons, 'OBSERVATION_ATTEMPT_FAILED_RETRYABLE');
      }
    }
  }
  return {
    contractVersion: command5aLocalObservationWorkerVersion,
    claimed: claimed.length, observed, missed, invalidated, deferredProvider, deferredMarket, failedRetryable,
    censoredRetryExhausted,
    observationIds, reasonCounts: Object.fromEntries(reasons), brokerAuthority: false,
    orderSubmissions: 0, brokerMutations: 0,
  };
}
