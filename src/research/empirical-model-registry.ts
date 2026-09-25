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
}

function recordIdentity(record: ModelRegistryRecord): string {
  const withoutCreatedAt: Record<string, unknown> = { ...record };
  delete withoutCreatedAt.createdAt;
  return sha256(canonicalJson(withoutCreatedAt));
}

/**
 * In-memory, append-only registry. A real durable backing store is a
 * future Codex/infra integration concern (see the CODEX_INTEGRATION_HANDOFF
 * in this build wave's final report) -- this module defines the exact
 * contract and immutability semantics independent of storage.
 */
export class EmpiricalModelRegistry {
  private readonly records = new Map<string, ModelRegistryRecord>();

  private key(modelId: string, modelVersion: string): string { return `${modelId}::${modelVersion}`; }

  register(record: ModelRegistryRecord): void {
    if (record.numberOfTrials < 1) throw new Error('MODEL_REGISTRY_INVALID_NUMBER_OF_TRIALS');
    if (Date.parse(record.trainingWindow.end) < Date.parse(record.trainingWindow.start)) throw new Error('MODEL_REGISTRY_INVALID_TRAINING_WINDOW');
    const key = this.key(record.modelId, record.modelVersion);
    const existing = this.records.get(key);
    if (existing === undefined) { this.records.set(key, record); return; }
    if (recordIdentity(existing) !== recordIdentity(record)) {
      throw new Error(`MODEL_REGISTRY_IMMUTABLE_VERSION_CONFLICT:${key}`);
    }
    // Identical re-registration: idempotent no-op, never overwrites.
  }

  get(modelId: string, modelVersion: string): ModelRegistryRecord | null {
    return this.records.get(this.key(modelId, modelVersion)) ?? null;
  }

  /** Deliberately no `getLatest`/`getCurrent` method exists on this class --
   * every consumer must supply an exact version. */
  listVersions(modelId: string): readonly string[] {
    return [...this.records.values()].filter((r) => r.modelId === modelId).map((r) => r.modelVersion);
  }
}
