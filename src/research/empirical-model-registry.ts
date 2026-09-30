/**
 * COMMAND 4 item 13 (COMMAND 2 §24/§28, COMMAND 3). Immutable, versioned
 * empirical model registry. Research metadata only, `brokerAuthority:
 * false` -- grants zero broker/execution authority; no field or method
 * here can influence `canonical-strategy-frontier.ts`, `management-action-
 * frontier.ts`, sizing, or AEGIS.
 *
 * No mutable "latest model" pointer exists anywhere in this module -- every
 * consumer must reference an exact `(modelId, modelVersion)` pair. Records
 * are append-only: `registerModel` throws on any attempt to re-register an
 * existing `(modelId, modelVersion)` with different content (an identical
 * re-registration is an idempotent no-op).
 */
import { canonicalJson, sha256 } from './point-in-time-evidence.js';

export const empiricalModelRegistryVersion = 'theta-empirical-model-registry-v1' as const;

export type ModelPromotionState = 'RESEARCH' | 'SHADOW' | 'PAPER_CHALLENGER' | 'PAPER_PROMOTED';

export interface ModelRegistryMetrics {
  readonly brierScore: number | null;
  readonly logLoss: number | null;
  readonly ece: number | null;
  readonly independentN: number | null;
}

export interface ModelRegistryRecord {
  readonly contractVersion: typeof empiricalModelRegistryVersion;
  readonly modelId: string;
  readonly modelVersion: string;
  readonly targetId: string;
  readonly strategyScope: readonly string[];
  readonly actionScope: readonly string[];
  readonly featureSetVersion: string;
  readonly datasetId: string;
  readonly datasetHash: string;
  readonly labelVersion: string;
  readonly codeSha: string;
  readonly trainingWindow: { readonly start: string; readonly end: string };
  readonly validationWindows: readonly { readonly start: string; readonly end: string }[];
  readonly finalOosWindow: { readonly start: string; readonly end: string } | null;
  readonly dependenceGroupingVersion: string;
  readonly purgeVersion: string;
  readonly calibrationMethod: string | null;
  readonly calibrationArtifactHash: string | null;
  readonly costModelVersion: string;
  readonly hyperparameterSearchId: string | null;
  readonly numberOfTrials: number;
  readonly selectionBiasReceiptId: string | null;
  readonly metrics: ModelRegistryMetrics;
  readonly artifactHash: string;
  readonly createdAt: string;
  readonly promotionState: ModelPromotionState;
  /** Command 5B item 20 (model development order): a challenger-tier model
   * must reference the baseline it is being compared against -- `null`
   * only when `isBaseline: true`. Prevents a challenger from registering
   * at PAPER_CHALLENGER/PAPER_PROMOTED with no recorded baseline evidence
   * to beat. */
  readonly baselineModelId: string | null;
  readonly baselineModelVersion?: string | null;
  readonly isBaseline: boolean;
}

/** Metadata validation is shared by both stores. It grants no promotion authority. */
export function validateModelRegistryRecord(record: ModelRegistryRecord): void {
  const fail = (field: string): never => { throw new Error(`MODEL_REGISTRY_INVALID_${field}`); };
  if (record.contractVersion !== empiricalModelRegistryVersion) fail('VERSION');
  for (const field of ['modelId', 'modelVersion', 'targetId', 'featureSetVersion', 'datasetId', 'labelVersion',
    'dependenceGroupingVersion', 'purgeVersion', 'costModelVersion'] as const) {
    if (typeof record[field] !== 'string' || record[field].trim().length === 0) fail(field);
  }
  for (const field of ['datasetHash', 'artifactHash'] as const) if (!/^[a-f0-9]{64}$/.test(record[field])) fail(field);
  if (!/^[a-f0-9]{40}$/.test(record.codeSha)) fail('CODE_SHA');
  if (typeof record.isBaseline !== 'boolean' || !['RESEARCH', 'SHADOW', 'PAPER_CHALLENGER', 'PAPER_PROMOTED'].includes(record.promotionState)) fail('PROMOTION_METADATA');
  if (!Number.isSafeInteger(record.numberOfTrials) || record.numberOfTrials < 1) fail('NUMBER_OF_TRIALS');
  if (!Number.isFinite(Date.parse(record.createdAt))) fail('CREATED_AT');
  const window = (value: { start: string; end: string }, name: string): [number, number] => {
    const start = Date.parse(value.start), end = Date.parse(value.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) fail(name);
    return [start, end];
  };
  const [, trainEnd] = window(record.trainingWindow, 'TRAINING_WINDOW');
  let validationEnd = trainEnd;
  for (const value of record.validationWindows) {
    const [start, end] = window(value, 'VALIDATION_WINDOW');
    if (start <= trainEnd) fail('VALIDATION_OVERLAPS_TRAINING');
    validationEnd = Math.max(validationEnd, end);
  }
  if (record.finalOosWindow !== null && window(record.finalOosWindow, 'OOS_WINDOW')[0] <= validationEnd) fail('OOS_OVERLAP');
  for (const scope of [record.strategyScope, record.actionScope]) {
    if (!Array.isArray(scope) || new Set(scope).size !== scope.length || scope.some((s) => typeof s !== 'string' || !s.trim())) fail('SCOPE');
  }
  for (const name of ['brierScore', 'logLoss', 'ece', 'independentN'] as const) {
    const value = record.metrics[name];
    if (value !== null && (!Number.isFinite(value) || value < 0 ||
      ((name === 'brierScore' || name === 'ece') && value > 1) || (name === 'independentN' && !Number.isSafeInteger(value)))) fail(`METRIC_${name}`);
  }
  if ((record.calibrationMethod === null) !== (record.calibrationArtifactHash === null) ||
    (record.calibrationArtifactHash !== null && !/^[a-f0-9]{64}$/.test(record.calibrationArtifactHash))) fail('CALIBRATION');
  if (!record.isBaseline && record.baselineModelId === null && ['PAPER_CHALLENGER', 'PAPER_PROMOTED'].includes(record.promotionState)) {
    throw new Error('MODEL_REGISTRY_CHALLENGER_WITHOUT_BASELINE');
  }
  if (record.isBaseline && (record.baselineModelId !== null || record.baselineModelVersion != null)) throw new Error('MODEL_REGISTRY_BASELINE_CANNOT_REFERENCE_ANOTHER_BASELINE');
  if (record.baselineModelId !== null && (!record.baselineModelId.trim() || !record.baselineModelVersion?.trim() || record.baselineModelId === record.modelId)) fail('EXACT_BASELINE_REFERENCE');
}

function recordIdentity(record: ModelRegistryRecord): string {
  return sha256(canonicalJson(record));
}

/**
 * In-memory, append-only registry. ResearchDurableStore applies the same
 * validation and exact identity to the local SQLite research ledger.
 */
export class EmpiricalModelRegistry {
  private readonly records = new Map<string, ModelRegistryRecord>();

  private key(modelId: string, modelVersion: string): string { return JSON.stringify([modelId, modelVersion]); }

  register(record: ModelRegistryRecord): void {
    validateModelRegistryRecord(record);
    if (record.baselineModelId !== null) {
      if (!record.baselineModelVersion) throw new Error('MODEL_REGISTRY_EXACT_BASELINE_REQUIRED');
      const baseline = this.get(record.baselineModelId, record.baselineModelVersion);
      if (!baseline?.isBaseline || baseline.targetId !== record.targetId) throw new Error('MODEL_REGISTRY_BASELINE_NOT_FOUND_OR_INCOMPATIBLE');
    }
    const key = this.key(record.modelId, record.modelVersion);
    const existing = this.records.get(key);
    if (existing === undefined) { this.records.set(key, structuredClone(record)); return; }
    if (recordIdentity(existing) !== recordIdentity(record)) {
      throw new Error(`MODEL_REGISTRY_IMMUTABLE_VERSION_CONFLICT:${key}`);
    }
    // Identical re-registration: idempotent no-op, never overwrites.
  }

  get(modelId: string, modelVersion: string): ModelRegistryRecord | null {
    const record = this.records.get(this.key(modelId, modelVersion));
    return record === undefined ? null : structuredClone(record);
  }

  /** Deliberately no `getLatest`/`getCurrent` method exists on this class --
   * every consumer must supply an exact version. */
  listVersions(modelId: string): readonly string[] {
    return [...this.records.values()].filter((r) => r.modelId === modelId).map((r) => r.modelVersion).sort();
  }
}
