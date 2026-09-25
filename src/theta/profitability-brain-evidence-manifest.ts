import { createHash } from 'node:crypto';
import { canonicalJson } from '../research/point-in-time-evidence.js';
import { profitabilityBrainMethodRegistry, type ProfitabilityBrainRealityReceipt,
  buildProfitabilityBrainRealityReceipt } from './profitability-brain-reality.js';

export const profitabilityBrainEvidenceManifestVersion = 'theta-profitability-brain-evidence-v1' as const;

export interface ProfitabilityRuntimeEvidence {
  readonly methodId: string;
  readonly evidenceId: string;
  readonly evidenceHash: string;
  readonly observedAt: string;
  readonly sourceSha: string;
  readonly workerSha: string;
}

export interface ProfitabilityEmpiricalEvidence {
  readonly methodId: string;
  readonly evidenceId: string;
  readonly runtimeEvidenceId: string;
  readonly datasetHash: string;
  readonly outOfSampleReceiptId: string;
}

export interface ProfitabilityBrokerAuthorizationEvidence {
  readonly methodId: string;
  readonly evidenceId: string;
  readonly empiricalEvidenceId: string;
  readonly approvalReceiptId: string;
  readonly environment: 'PAPER';
  readonly executionAuthorized: true;
}

export interface ProfitabilityBrainEvidenceManifest {
  readonly contractVersion: typeof profitabilityBrainEvidenceManifestVersion;
  readonly canonicalSourceSha: string;
  readonly currentWorkerSha: string;
  readonly generatedAt: string;
  readonly runtime: readonly ProfitabilityRuntimeEvidence[];
  readonly empirical: readonly ProfitabilityEmpiricalEvidence[];
  readonly brokerAuthorization: readonly ProfitabilityBrokerAuthorizationEvidence[];
  readonly manifestHash: string;
}

const sha = /^[a-f0-9]{40}$/;
const hash = /^[a-f0-9]{64}$/;
const knownMethods = new Set(profitabilityBrainMethodRegistry.map((item) => item.methodId));
const unique = (values: readonly string[]): boolean => new Set(values).size === values.length;
const manifestBody = (manifest: ProfitabilityBrainEvidenceManifest) => ({
  contractVersion: manifest.contractVersion, canonicalSourceSha: manifest.canonicalSourceSha,
  currentWorkerSha: manifest.currentWorkerSha, generatedAt: manifest.generatedAt,
  runtime: manifest.runtime, empirical: manifest.empirical, brokerAuthorization: manifest.brokerAuthorization,
});

export function validateProfitabilityBrainEvidenceManifest(manifest: ProfitabilityBrainEvidenceManifest): readonly string[] {
  const violations: string[] = [];
  if (manifest.contractVersion !== profitabilityBrainEvidenceManifestVersion) violations.push('CONTRACT_VERSION_INVALID');
  if (!sha.test(manifest.canonicalSourceSha)) violations.push('CANONICAL_SOURCE_SHA_INVALID');
  if (!sha.test(manifest.currentWorkerSha)) violations.push('CURRENT_WORKER_SHA_INVALID');
  if (manifest.currentWorkerSha !== manifest.canonicalSourceSha) violations.push('SOURCE_WORKER_SHA_MISMATCH');
  if (!Number.isFinite(Date.parse(manifest.generatedAt))) violations.push('GENERATED_AT_INVALID');
  const expectedHash = createHash('sha256').update(canonicalJson(manifestBody(manifest))).digest('hex');
  if (!hash.test(manifest.manifestHash) || manifest.manifestHash !== expectedHash) violations.push('MANIFEST_HASH_INVALID');
  const runtimeIds = new Set(manifest.runtime.map((item) => item.evidenceId));
  const empiricalIds = new Set(manifest.empirical.map((item) => item.evidenceId));
  if (!unique([...runtimeIds]) || runtimeIds.size !== manifest.runtime.length) violations.push('RUNTIME_EVIDENCE_ID_DUPLICATE');
  if (!unique([...empiricalIds]) || empiricalIds.size !== manifest.empirical.length) violations.push('EMPIRICAL_EVIDENCE_ID_DUPLICATE');
  if (!unique(manifest.brokerAuthorization.map((item) => item.evidenceId))) violations.push('BROKER_EVIDENCE_ID_DUPLICATE');
  for (const item of manifest.runtime) {
    if (!knownMethods.has(item.methodId)) violations.push(`UNKNOWN_METHOD:${item.methodId}`);
    if (!hash.test(item.evidenceHash)) violations.push(`RUNTIME_HASH_INVALID:${item.methodId}`);
    if (!Number.isFinite(Date.parse(item.observedAt))) violations.push(`RUNTIME_OBSERVED_AT_INVALID:${item.methodId}`);
    if (item.sourceSha !== manifest.canonicalSourceSha || item.workerSha !== manifest.currentWorkerSha)
      violations.push(`RUNTIME_RELEASE_MISMATCH:${item.methodId}`);
  }
  for (const item of manifest.empirical) {
    if (!knownMethods.has(item.methodId)) violations.push(`UNKNOWN_METHOD:${item.methodId}`);
    if (!runtimeIds.has(item.runtimeEvidenceId)) violations.push(`EMPIRICAL_RUNTIME_LINK_MISSING:${item.methodId}`);
    if (!hash.test(item.datasetHash)) violations.push(`EMPIRICAL_DATASET_HASH_INVALID:${item.methodId}`);
  }
  for (const item of manifest.brokerAuthorization) {
    if (!knownMethods.has(item.methodId)) violations.push(`UNKNOWN_METHOD:${item.methodId}`);
    if (!empiricalIds.has(item.empiricalEvidenceId)) violations.push(`BROKER_EMPIRICAL_LINK_MISSING:${item.methodId}`);
    if (item.environment !== 'PAPER' || item.executionAuthorized !== true)
      violations.push(`BROKER_AUTHORIZATION_INVALID:${item.methodId}`);
  }
  return [...new Set(violations)].sort();
}

export function buildProfitabilityBrainRealityFromManifest(manifest: ProfitabilityBrainEvidenceManifest): {
  readonly receipt: ProfitabilityBrainRealityReceipt;
  readonly manifestHash: string;
  readonly violations: readonly string[];
} {
  const violations = validateProfitabilityBrainEvidenceManifest(manifest);
  if (violations.length > 0) return { receipt: buildProfitabilityBrainRealityReceipt(), manifestHash: manifest.manifestHash, violations };
  const runtimeById = new Map(manifest.runtime.map((item) => [item.evidenceId, item]));
  const empiricalById = new Map(manifest.empirical.map((item) => [item.evidenceId, item]));
  const current = manifest.runtime.map((item) => item.methodId);
  const empirical = manifest.empirical.filter((item) => runtimeById.get(item.runtimeEvidenceId)?.methodId === item.methodId)
    .map((item) => item.methodId);
  const authorized = manifest.brokerAuthorization.filter((item) => empiricalById.get(item.empiricalEvidenceId)?.methodId === item.methodId)
    .map((item) => item.methodId);
  return { receipt: buildProfitabilityBrainRealityReceipt({ currentWorkerRealData: current,
    empiricallyValidated: empirical, brokerAuthorized: authorized }), manifestHash: manifest.manifestHash, violations: [] };
}
