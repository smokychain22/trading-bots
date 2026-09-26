import { createHash } from 'node:crypto';
import { canonicalJson } from './point-in-time-evidence.js';
import type { ContractPathMaturationReceipt } from './contract-path-label-maturation.js';
import type { ContractPathObservationReceipt } from './contract-path-observation-runtime.js';
import type { ShadowEpisodeContract } from './shadow-episode-contract.js';

export const contractPathHandoffVersion = 'theta-contract-path-handoff-v1' as const;

export interface ContractPathResearchHandoff {
  readonly contractVersion: typeof contractPathHandoffVersion;
  readonly producer: 'CODEX';
  readonly consumers: readonly ['CLAUDE_CONTRACT_PATH', 'STRATEGY_RESEARCH', 'FILTER_VALUE', 'EXPERIENCE_MEMORY', 'SESSION_REPORT'];
  readonly sourceSha: string;
  readonly workerSha: string;
  readonly sourceWindow: { readonly start: string; readonly end: string };
  readonly episodeCount: number;
  readonly observationCount: number;
  readonly maturationCount: number;
  readonly episodes: readonly ShadowEpisodeContract[];
  readonly observations: readonly ContractPathObservationReceipt[];
  readonly maturations: readonly ContractPathMaturationReceipt[];
  readonly contentHash: string;
  readonly brokerAuthority: false;
}

const SHA40 = /^[0-9a-f]{40}$/;

export function buildContractPathResearchHandoff(input: {
  readonly sourceSha: string;
  readonly workerSha: string;
  readonly sourceWindow: { readonly start: string; readonly end: string };
  readonly episodes: readonly ShadowEpisodeContract[];
  readonly observations: readonly ContractPathObservationReceipt[];
  readonly maturations: readonly ContractPathMaturationReceipt[];
}): ContractPathResearchHandoff {
  if (!SHA40.test(input.sourceSha) || !SHA40.test(input.workerSha)) throw new Error('CONTRACT_PATH_HANDOFF_SHA_INVALID');
  const startMs = Date.parse(input.sourceWindow.start), endMs = Date.parse(input.sourceWindow.end);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) {
    throw new Error('CONTRACT_PATH_HANDOFF_WINDOW_INVALID');
  }
  const subjects = new Set(input.episodes.map((episode) => episode.subjectId));
  if (subjects.size !== input.episodes.length) throw new Error('CONTRACT_PATH_HANDOFF_EPISODE_DUPLICATE');
  for (const episode of input.episodes) {
    const decisionAtMs = Date.parse(episode.decisionAt);
    if (episode.sourceSha !== input.sourceSha || episode.workerSha !== input.workerSha
      || !Number.isFinite(decisionAtMs) || decisionAtMs < startMs || decisionAtMs > endMs) {
      throw new Error('CONTRACT_PATH_HANDOFF_EPISODE_LINEAGE_MISMATCH');
    }
  }
  const observationIds = new Set<string>();
  for (const observation of input.observations) {
    const observedAtMs = Date.parse(observation.actualObservedAt);
    if (!subjects.has(observation.subjectId) || observation.sourceSha !== input.sourceSha
      || observation.workerSha !== input.workerSha || observationIds.has(observation.observationId)
      || !Number.isFinite(observedAtMs) || observedAtMs < startMs || observedAtMs > endMs) {
      throw new Error('CONTRACT_PATH_HANDOFF_OBSERVATION_LINEAGE_MISMATCH');
    }
    observationIds.add(observation.observationId);
  }
  const maturationSubjects = new Set<string>();
  for (const maturation of input.maturations) {
    const labelAvailableAtMs = maturation.labelAvailableAt === null ? null : Date.parse(maturation.labelAvailableAt);
    if (!subjects.has(maturation.subjectId)
      || maturationSubjects.has(maturation.subjectId)
      || labelAvailableAtMs !== null && (!Number.isFinite(labelAvailableAtMs)
        || labelAvailableAtMs < startMs || labelAvailableAtMs > endMs)
      || maturation.evidenceIds.some((evidenceId) => !observationIds.has(evidenceId))) {
      throw new Error('CONTRACT_PATH_HANDOFF_MATURATION_LINEAGE_MISMATCH');
    }
    maturationSubjects.add(maturation.subjectId);
  }
  const withoutHash = {
    contractVersion: contractPathHandoffVersion,
    producer: 'CODEX' as const,
    consumers: ['CLAUDE_CONTRACT_PATH', 'STRATEGY_RESEARCH', 'FILTER_VALUE', 'EXPERIENCE_MEMORY', 'SESSION_REPORT'] as const,
    sourceSha: input.sourceSha,
    workerSha: input.workerSha,
    sourceWindow: { start: new Date(startMs).toISOString(), end: new Date(endMs).toISOString() },
    episodeCount: input.episodes.length,
    observationCount: input.observations.length,
    maturationCount: input.maturations.length,
    episodes: input.episodes,
    observations: input.observations,
    maturations: input.maturations,
    brokerAuthority: false as const,
  };
  return { ...withoutHash, contentHash: createHash('sha256').update(canonicalJson(withoutHash)).digest('hex') };
}
