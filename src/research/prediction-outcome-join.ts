/**
 * COMMAND 4 item 16 (COMMAND 3 §16). Offline research joiner attaching real
 * factual outcomes to earlier immutable shadow predictions. Research-only,
 * `brokerAuthority: false`. Never mutates the original prediction receipt
 * -- produces a separate, append-only join record.
 */
import type { ShadowPredictionReceipt } from './shadow-prediction-receipt.js';

export const predictionOutcomeJoinVersion = 'theta-prediction-outcome-join-v1' as const;

export type JoinStatus = 'JOINED' | 'PENDING' | 'CENSORED';

export interface OutcomeEvidence {
  readonly entityId: string;
  readonly decisionId: string;
  readonly wholeChainId: string | null;
  readonly targetId: string;
  readonly modelVersionAtOutcomeTime: string;
  readonly featureSnapshotHash: string;
  readonly observedOutcome: number | null;
  readonly resolvedAt: string | null;
  readonly isResolved: boolean;
}

export interface PredictionOutcomeJoinRecord {
  readonly contractVersion: typeof predictionOutcomeJoinVersion;
  readonly predictionId: string;
  readonly status: JoinStatus;
  readonly outcome: number | null;
  readonly joinedAt: string;
}

/**
 * Validates prediction-existed-before-outcome, feature hash, decision
 * identity, target compatibility, and temporal ordering before ever
 * joining. Throws on any real integrity violation rather than silently
 * joining mismatched records.
 */
export function joinPredictionToOutcome(
  prediction: ShadowPredictionReceipt, outcome: OutcomeEvidence, joinedAt: string,
): PredictionOutcomeJoinRecord {
  if (prediction.entityId !== outcome.entityId) throw new Error('JOIN_ENTITY_MISMATCH');
  if (prediction.decisionId !== outcome.decisionId) throw new Error('JOIN_DECISION_IDENTITY_MISMATCH');
  if (prediction.targetId !== outcome.targetId) throw new Error('JOIN_TARGET_INCOMPATIBLE');
  if (prediction.featureSnapshotHash !== outcome.featureSnapshotHash) throw new Error('JOIN_FEATURE_HASH_MISMATCH');
  if (outcome.resolvedAt !== null && Date.parse(outcome.resolvedAt) < Date.parse(prediction.predictedAt)) {
    throw new Error('JOIN_OUTCOME_RESOLVED_BEFORE_PREDICTION');
  }
  if (!outcome.isResolved) {
    return { contractVersion: predictionOutcomeJoinVersion, predictionId: prediction.predictionId, status: 'PENDING', outcome: null, joinedAt };
  }
  if (outcome.observedOutcome === null) {
    return { contractVersion: predictionOutcomeJoinVersion, predictionId: prediction.predictionId, status: 'CENSORED', outcome: null, joinedAt };
  }
  return { contractVersion: predictionOutcomeJoinVersion, predictionId: prediction.predictionId, status: 'JOINED', outcome: outcome.observedOutcome, joinedAt };
}
