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

// Phase 1 Zero-Unknown Reclosure Pass 3 continuation (items 7-11): a
// historical episode's real evidence must never be reinterpreted as
// "today's current deployed worker." Rather than solve that solely with a
// field-name JSDoc (rejected -- an ambiguous field must be fixed, not just
// annotated), `currentWorkerSha` is renamed to the temporally neutral
// `evidenceWorkerSha` (the worker/release SHA live as of `generatedAt`,
// whatever moment that is), and `evidenceClass` is now a required,
// explicit tag: `CURRENT_RUNTIME` (this evidence proves today's deployed
// worker ran these methods on real data) or `HISTORICAL_REAL_RUNTIME`
// (this evidence proves a real historical episode ran them, on that
// episode's own day -- never promoted to "current"). See
// buildProfitabilityBrainRealityFromManifest for how this tag routes into
// two separate, orthogonal receipt dimensions (`currentWorkerRealData` vs
// `historicalRealData`) rather than one overloaded flag.
export type ProfitabilityEvidenceClass = 'CURRENT_RUNTIME' | 'HISTORICAL_REAL_RUNTIME';

export interface ProfitabilityBrainEvidenceManifest {
  readonly contractVersion: typeof profitabilityBrainEvidenceManifestVersion;
  readonly evidenceClass: ProfitabilityEvidenceClass;
  readonly canonicalSourceSha: string;
  readonly evidenceWorkerSha: string;
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
  contractVersion: manifest.contractVersion, evidenceClass: manifest.evidenceClass,
  canonicalSourceSha: manifest.canonicalSourceSha,
  evidenceWorkerSha: manifest.evidenceWorkerSha, generatedAt: manifest.generatedAt,
  runtime: manifest.runtime, empirical: manifest.empirical, brokerAuthorization: manifest.brokerAuthorization,
});

export function validateProfitabilityBrainEvidenceManifest(manifest: ProfitabilityBrainEvidenceManifest): readonly string[] {
  const violations: string[] = [];
  if (manifest.contractVersion !== profitabilityBrainEvidenceManifestVersion) violations.push('CONTRACT_VERSION_INVALID');
  if (manifest.evidenceClass !== 'CURRENT_RUNTIME' && manifest.evidenceClass !== 'HISTORICAL_REAL_RUNTIME')
    violations.push('EVIDENCE_CLASS_INVALID');
  if (!sha.test(manifest.canonicalSourceSha)) violations.push('CANONICAL_SOURCE_SHA_INVALID');
  if (!sha.test(manifest.evidenceWorkerSha)) violations.push('EVIDENCE_WORKER_SHA_INVALID');
  if (manifest.evidenceWorkerSha !== manifest.canonicalSourceSha) violations.push('SOURCE_WORKER_SHA_MISMATCH');
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
    if (item.sourceSha !== manifest.canonicalSourceSha || item.workerSha !== manifest.evidenceWorkerSha)
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
  const methodIds = manifest.runtime.map((item) => item.methodId);
  const empirical = manifest.empirical.filter((item) => runtimeById.get(item.runtimeEvidenceId)?.methodId === item.methodId)
    .map((item) => item.methodId);
  const authorized = manifest.brokerAuthorization.filter((item) => empiricalById.get(item.empiricalEvidenceId)?.methodId === item.methodId)
    .map((item) => item.methodId);
  // items 8-9: the two questions ("did this run on real historical data"
  // vs "has today's current deployed worker run this on real data") are
  // answered by routing the SAME runtime evidence into two DIFFERENT,
  // never-both receipt dimensions, decided solely by the manifest's own
  // explicit evidenceClass tag -- never inferred, never both at once.
  return { receipt: buildProfitabilityBrainRealityReceipt({
    currentWorkerRealData: manifest.evidenceClass === 'CURRENT_RUNTIME' ? methodIds : [],
    historicalRealData: manifest.evidenceClass === 'HISTORICAL_REAL_RUNTIME' ? methodIds : [],
    empiricallyValidated: empirical, brokerAuthorized: authorized }), manifestHash: manifest.manifestHash, violations: [] };
}
