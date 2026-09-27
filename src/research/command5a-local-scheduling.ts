import type { CanonicalStrategyFrontier } from '../theta/canonical-strategy-frontier.js';
import { LocalObservationJobScheduler } from '../storage/local-observation-job-scheduler.js';
import {
  defaultSeriousSubjectPolicy,
  selectSeriousResearchSubjects,
  type SeriousSubjectPolicy,
} from './serious-subject-policy.js';
import { buildShadowEpisodeContract } from './shadow-episode-contract.js';
import type { ShadowEpisodeContract } from './shadow-episode-contract.js';
import {
  buildStrategyLearningObservationSchedule,
  type StrategyLearningHorizonPolicy,
  type StrategyLearningSession,
} from './strategy-learning-horizon.js';
import { canonicalJson } from './point-in-time-evidence.js';
import { createHash } from 'node:crypto';

export const command5aLocalSchedulingVersion = 'theta-command5a-local-scheduling-v1' as const;

export interface Command5aLocalSchedulingReceipt {
  readonly contractVersion: typeof command5aLocalSchedulingVersion;
  readonly subjectCount: number;
  readonly candidateSubjectCount: number;
  readonly waitSubjectCount: number;
  readonly existingSubjectCount: number;
  readonly scheduledJobCount: number;
  readonly existingJobCount: number;
  readonly unscheduledJobCount: number;
  readonly subjectIds: readonly string[];
  readonly brokerAuthority: false;
  readonly orderSubmissions: 0;
  readonly brokerMutations: 0;
}

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

/**
 * Resolves the cycle underlying without requiring at least one candidate.
 * A complete WAIT frontier may legitimately contain zero candidates, while
 * the immutable fusion snapshot still carries the exact scanned symbol.
 */
export function resolveCommand5aFrontierUnderlying(
  frontier: CanonicalStrategyFrontier,
  snapshot: unknown,
): string | null {
  const snapshotSymbolValue = object(object(snapshot).underlyingState).symbol;
  const snapshotSymbol = typeof snapshotSymbolValue === 'string'
    && /^[A-Z][A-Z0-9.-]{0,31}$/.test(snapshotSymbolValue)
    ? snapshotSymbolValue : null;
  const candidateSymbols = new Set(frontier.branches
    .flatMap((branch) => branch.candidates.map((candidate) => candidate.underlying)));
  if (candidateSymbols.size > 1) return null;
  const candidateSymbol = [...candidateSymbols][0] ?? null;
  if (snapshotSymbol !== null && candidateSymbol !== null && snapshotSymbol !== candidateSymbol) return null;
  return snapshotSymbol ?? candidateSymbol;
}

/**
 * Registers bounded serious subjects and their exchange-calendar-derived
 * future observation jobs in the local restart-safe WAL. WAIT is preserved
 * as a T0 subject but receives no contract observation jobs because it has no
 * exact leg identity.
 */
export function scheduleCommand5aFromCanonicalFrontier(input: {
  readonly scheduler: LocalObservationJobScheduler;
  readonly frontier: CanonicalStrategyFrontier;
  readonly decisionCycleId: string;
  readonly decisionId: string;
  readonly underlying: string;
  readonly featureSnapshotHash: string;
  readonly riskVersion: string;
  readonly costVersion: string;
  readonly executionModelVersion: string;
  readonly sourceSha: string;
  readonly workerSha: string;
  readonly sessions: readonly StrategyLearningSession[];
  readonly horizonPolicy: StrategyLearningHorizonPolicy;
  readonly subjectPolicy?: SeriousSubjectPolicy;
}): Command5aLocalSchedulingReceipt {
  const selection = selectSeriousResearchSubjects(input.frontier, input.subjectPolicy ?? defaultSeriousSubjectPolicy);
  let scheduledJobCount = 0;
  let unscheduledJobCount = 0;
  let candidateSubjectCount = 0;
  let waitSubjectCount = 0;
  let existingSubjectCount = 0;
  let existingJobCount = 0;
  for (const subject of selection.subjects) {
    let subjectExisted = false;
    let episode: ShadowEpisodeContract;
    try {
      episode = input.scheduler.getSubject(subject.subjectId).episode;
      subjectExisted = true;
      existingSubjectCount += 1;
    } catch (error) {
      if (!(error instanceof Error) || error.message !== 'LOCAL_OBSERVATION_SUBJECT_NOT_FOUND') throw error;
      episode = buildShadowEpisodeContract({
        subject,
        decisionId: input.decisionId,
        featureSnapshotHash: input.featureSnapshotHash,
        frontierContentHash: input.frontier.contentHash,
        optionomicsContextHash: createHash('sha256')
          .update(canonicalJson(input.frontier.optionomicsContext)).digest('hex'),
        strategyVersion: input.frontier.strategyVersion,
        riskVersion: input.riskVersion,
        costVersion: input.costVersion,
        executionModelVersion: input.executionModelVersion,
        sourceSha: input.sourceSha,
        workerSha: input.workerSha,
      });
      if (subject.kind === 'CANDIDATE' && subject.candidate.underlying !== input.underlying) {
        throw new Error('COMMAND5A_SUBJECT_UNDERLYING_MISMATCH');
      }
      input.scheduler.registerSubject({ decisionCycleId: input.decisionCycleId,
        underlying: input.underlying, episode });
    }
    if (subject.kind === 'WAIT') {
      waitSubjectCount += 1;
      continue;
    }
    candidateSubjectCount += 1;
    const expirations = new Set(episode.legs.map((leg) => leg.expiration));
    if (expirations.size !== 1) throw new Error('COMMAND5A_SUBJECT_EXPIRATION_AMBIGUOUS');
    const expirationDate = episode.legs[0]?.expiration ?? null;
    const schedule = buildStrategyLearningObservationSchedule({
      subjectId: subject.subjectId,
      decisionAt: episode.decisionAt,
      decisionSessionDate: episode.decisionAt.slice(0, 10),
      expirationDate,
      sessions: input.sessions,
      policy: input.horizonPolicy,
    });
    for (const job of schedule) {
      if (job.targetState !== 'SCHEDULED') {
        unscheduledJobCount += 1;
        continue;
      }
      let jobExisted = false;
      if (subjectExisted) {
        try { input.scheduler.get(job.observationJobId); jobExisted = true; }
        catch (error) {
          if (!(error instanceof Error) || error.message !== 'LOCAL_OBSERVATION_JOB_NOT_FOUND') throw error;
        }
      }
      input.scheduler.schedule({ job, sourceSha: input.sourceSha, workerSha: input.workerSha });
      if (jobExisted) existingJobCount += 1;
      else scheduledJobCount += 1;
    }
  }
  return {
    contractVersion: command5aLocalSchedulingVersion,
    subjectCount: selection.subjects.length,
    candidateSubjectCount,
    waitSubjectCount,
    existingSubjectCount,
    scheduledJobCount,
    existingJobCount,
    unscheduledJobCount,
    subjectIds: selection.subjects.map((subject) => subject.subjectId),
    brokerAuthority: false,
    orderSubmissions: 0,
    brokerMutations: 0,
  };
}
