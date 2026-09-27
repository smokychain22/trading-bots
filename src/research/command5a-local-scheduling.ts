import type { CanonicalStrategyFrontier } from '../theta/canonical-strategy-frontier.js';
import { LocalObservationJobScheduler } from '../storage/local-observation-job-scheduler.js';
import {
  defaultSeriousSubjectPolicy,
  selectSeriousResearchSubjects,
  type SeriousSubjectPolicy,
} from './serious-subject-policy.js';
import { buildShadowEpisodeContract } from './shadow-episode-contract.js';
import {
  buildStrategyLearningObservationSchedule,
  type StrategyLearningHorizonPolicy,
  type StrategyLearningSession,
} from './strategy-learning-horizon.js';

export const command5aLocalSchedulingVersion = 'theta-command5a-local-scheduling-v1' as const;

export interface Command5aLocalSchedulingReceipt {
  readonly contractVersion: typeof command5aLocalSchedulingVersion;
  readonly subjectCount: number;
  readonly candidateSubjectCount: number;
  readonly waitSubjectCount: number;
  readonly existingSubjectCount: number;
  readonly scheduledJobCount: number;
  readonly unscheduledJobCount: number;
  readonly subjectIds: readonly string[];
  readonly brokerAuthority: false;
  readonly orderSubmissions: 0;
  readonly brokerMutations: 0;
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
  for (const subject of selection.subjects) {
    try {
      input.scheduler.getSubject(subject.subjectId);
      existingSubjectCount += 1;
      if (subject.kind === 'WAIT') waitSubjectCount += 1;
      else candidateSubjectCount += 1;
      continue;
    } catch (error) {
      if (!(error instanceof Error) || error.message !== 'LOCAL_OBSERVATION_SUBJECT_NOT_FOUND') throw error;
    }
    const episode = buildShadowEpisodeContract({
      subject,
      decisionId: input.decisionId,
      featureSnapshotHash: input.featureSnapshotHash,
      strategyVersion: input.frontier.strategyVersion,
      riskVersion: input.riskVersion,
      costVersion: input.costVersion,
      executionModelVersion: input.executionModelVersion,
      sourceSha: input.sourceSha,
      workerSha: input.workerSha,
    });
    input.scheduler.registerSubject({ decisionCycleId: input.decisionCycleId,
      underlying: input.underlying, episode });
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
      decisionAt: subject.decisionAt,
      decisionSessionDate: subject.decisionAt.slice(0, 10),
      expirationDate,
      sessions: input.sessions,
      policy: input.horizonPolicy,
    });
    for (const job of schedule) {
      if (job.targetState !== 'SCHEDULED') {
        unscheduledJobCount += 1;
        continue;
      }
      input.scheduler.schedule({ job, sourceSha: input.sourceSha, workerSha: input.workerSha });
      scheduledJobCount += 1;
    }
  }
  return {
    contractVersion: command5aLocalSchedulingVersion,
    subjectCount: selection.subjects.length,
    candidateSubjectCount,
    waitSubjectCount,
    existingSubjectCount,
    scheduledJobCount,
    unscheduledJobCount,
    subjectIds: selection.subjects.map((subject) => subject.subjectId),
    brokerAuthority: false,
    orderSubmissions: 0,
    brokerMutations: 0,
  };
}
