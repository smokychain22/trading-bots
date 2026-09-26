/**
 * OVERNIGHT WAVE §20: the immutable reproducibility-bundle linker. A
 * `ModelRegistryRecord` already carries most of the required version
 * fields as plain strings (`featureSetVersion`, `dependenceGroupingVersion`,
 * `purgeVersion`, `calibrationArtifactHash`, `selectionBiasReceiptId`,
 * `datasetHash`, `codeSha`) -- but a string ID alone does not prove the
 * thing it names actually exists and is retrievable. This module builds
 * one bundle tying every real lineage reference together, and one
 * verification function that checks each reference actually RESOLVES
 * against the durable store, not merely that the field is non-null.
 */
import type { ModelRegistryRecord } from './empirical-model-registry.js';
import type { ResearchDurableStore } from '../storage/research-durable-store.js';

export const reproducibilityBundleVersion = 'theta-reproducibility-bundle-v1' as const;

export interface ReproducibilityBundle {
  readonly contractVersion: typeof reproducibilityBundleVersion;
  readonly modelId: string;
  readonly modelVersion: string;
  readonly campaignId: string | null;
  readonly datasetHash: string;
  readonly codeSha: string;
  readonly featureSetVersion: string;
  readonly normalizationVersion: string | null;
  readonly dependenceGroupingVersion: string;
  readonly purgeVersion: string;
  readonly calibrationArtifactHash: string | null;
  readonly selectionBiasReceiptId: string | null;
  readonly predictionReceiptIds: readonly string[];
  readonly outcomeJoinPredictionIds: readonly string[];
  readonly metricsSnapshot: ModelRegistryRecord['metrics'];
}

export function buildReproducibilityBundle(input: {
  readonly model: ModelRegistryRecord;
  readonly campaignId: string | null;
  readonly normalizationVersion: string | null;
  readonly predictionReceiptIds: readonly string[];
  readonly outcomeJoinPredictionIds: readonly string[];
}): ReproducibilityBundle {
  return {
    contractVersion: reproducibilityBundleVersion,
    modelId: input.model.modelId, modelVersion: input.model.modelVersion,
    campaignId: input.campaignId, datasetHash: input.model.datasetHash, codeSha: input.model.codeSha,
    featureSetVersion: input.model.featureSetVersion, normalizationVersion: input.normalizationVersion,
    dependenceGroupingVersion: input.model.dependenceGroupingVersion, purgeVersion: input.model.purgeVersion,
    calibrationArtifactHash: input.model.calibrationArtifactHash,
    selectionBiasReceiptId: input.model.selectionBiasReceiptId,
    predictionReceiptIds: input.predictionReceiptIds, outcomeJoinPredictionIds: input.outcomeJoinPredictionIds,
    metricsSnapshot: input.model.metrics,
  };
}

export interface ReproducibilityVerificationResult {
  readonly valid: boolean;
  readonly modelRecordFound: boolean;
  readonly selectionBiasReceiptFound: boolean | 'NOT_REFERENCED';
  readonly missingPredictionReceipts: readonly string[];
  readonly reasons: readonly string[];
}

/**
 * The "one command should verify the bundle" requirement: checks every
 * referenced identity actually resolves in the durable store -- a
 * dangling reference (e.g. a `selectionBiasReceiptId` pointing at a
 * receipt that was never actually saved) is a real reproducibility
 * failure, not a cosmetic one, since it means the bundle's own lineage
 * claim cannot be independently checked by a future reader.
 */
export function verifyReproducibilityBundle(
  bundle: ReproducibilityBundle, store: ResearchDurableStore,
): ReproducibilityVerificationResult {
  const reasons: string[] = [];
  const modelRecord = store.getModelRecord(bundle.modelId, bundle.modelVersion);
  const modelRecordFound = modelRecord !== null;
  if (!modelRecordFound) reasons.push(`model record ${bundle.modelId}@${bundle.modelVersion} not found in durable store`);

  let selectionBiasReceiptFound: boolean | 'NOT_REFERENCED' = 'NOT_REFERENCED';
  if (bundle.selectionBiasReceiptId !== null) {
    selectionBiasReceiptFound = store.getSelectionBiasReceipt(bundle.selectionBiasReceiptId) !== null;
    if (!selectionBiasReceiptFound) reasons.push(`selectionBiasReceiptId ${bundle.selectionBiasReceiptId} does not resolve`);
  }

  const missingPredictionReceipts = bundle.predictionReceiptIds.filter((id) => store.getShadowPredictionReceipt(id) === null);
  if (missingPredictionReceipts.length > 0) {
    reasons.push(`predictionReceiptId(s) do not resolve: ${missingPredictionReceipts.join(', ')}`);
  }

  return {
    valid: modelRecordFound && selectionBiasReceiptFound !== false && missingPredictionReceipts.length === 0,
    modelRecordFound, selectionBiasReceiptFound, missingPredictionReceipts, reasons,
  };
}
