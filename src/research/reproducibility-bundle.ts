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
import { canonicalJson } from './point-in-time-evidence.js';

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
  return structuredClone({
    contractVersion: reproducibilityBundleVersion,
    modelId: input.model.modelId, modelVersion: input.model.modelVersion,
    campaignId: input.campaignId, datasetHash: input.model.datasetHash, codeSha: input.model.codeSha,
    featureSetVersion: input.model.featureSetVersion, normalizationVersion: input.normalizationVersion,
    dependenceGroupingVersion: input.model.dependenceGroupingVersion, purgeVersion: input.model.purgeVersion,
    calibrationArtifactHash: input.model.calibrationArtifactHash,
    selectionBiasReceiptId: input.model.selectionBiasReceiptId,
    predictionReceiptIds: input.predictionReceiptIds, outcomeJoinPredictionIds: input.outcomeJoinPredictionIds,
    metricsSnapshot: input.model.metrics,
  });
}

export interface ReproducibilityVerificationResult {
  readonly scope: 'DURABLE_METADATA_AND_REFERENCES_NOT_EXTERNAL_ARTIFACT_BYTES';
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
  if (bundle.contractVersion !== reproducibilityBundleVersion) reasons.push('bundle contract version mismatch');
  if (modelRecord !== null) {
    for (const field of ['datasetHash', 'codeSha', 'featureSetVersion', 'dependenceGroupingVersion', 'purgeVersion', 'calibrationArtifactHash', 'selectionBiasReceiptId'] as const) {
      if (bundle[field] !== modelRecord[field]) reasons.push(`model lineage mismatch: ${field}`);
    }
    if (canonicalJson(bundle.metricsSnapshot) !== canonicalJson(modelRecord.metrics)) reasons.push('model metrics mismatch');
  }

  let selectionBiasReceiptFound: boolean | 'NOT_REFERENCED' = 'NOT_REFERENCED';
  if (bundle.selectionBiasReceiptId !== null) {
    const receipt = store.getSelectionBiasReceipt(bundle.selectionBiasReceiptId);
    selectionBiasReceiptFound = receipt !== null;
    if (!selectionBiasReceiptFound) reasons.push(`selectionBiasReceiptId ${bundle.selectionBiasReceiptId} does not resolve`);
    if (receipt !== null && (receipt.inputDatasetHash !== bundle.datasetHash || receipt.codeSha !== bundle.codeSha ||
      receipt.dependencyGroupingVersion !== bundle.dependenceGroupingVersion || receipt.returnNormalizationVersion !== bundle.normalizationVersion ||
      receipt.numberOfTrials !== modelRecord?.numberOfTrials)) reasons.push('selection-bias lineage mismatch');
  }
  if (bundle.campaignId !== bundle.selectionBiasReceiptId) reasons.push('campaign identity mismatch');

  const missingPredictionReceipts = bundle.predictionReceiptIds.filter((id) => store.getShadowPredictionReceipt(id) === null);
  if (missingPredictionReceipts.length > 0) {
    reasons.push(`predictionReceiptId(s) do not resolve: ${missingPredictionReceipts.join(', ')}`);
  }
  for (const ids of [bundle.predictionReceiptIds, bundle.outcomeJoinPredictionIds]) if (new Set(ids).size !== ids.length) reasons.push('duplicate evidence identity');
  for (const id of bundle.predictionReceiptIds) {
    const receipt = store.getShadowPredictionReceipt(id);
    if (receipt !== null && (receipt.modelId !== bundle.modelId || receipt.modelVersion !== bundle.modelVersion || receipt.targetId !== modelRecord?.targetId ||
      receipt.shadowOnly !== true || receipt.brokerAuthority !== false)) reasons.push(`prediction lineage mismatch: ${id}`);
  }
  for (const id of bundle.outcomeJoinPredictionIds) {
    if (!bundle.predictionReceiptIds.includes(id) || !store.getPredictionOutcomeJoins(id).some((r) => r.status === 'JOINED')) reasons.push(`resolved outcome join not found: ${id}`);
  }

  return {
    scope: 'DURABLE_METADATA_AND_REFERENCES_NOT_EXTERNAL_ARTIFACT_BYTES',
    valid: reasons.length === 0,
    modelRecordFound, selectionBiasReceiptFound, missingPredictionReceipts, reasons,
  };
}
