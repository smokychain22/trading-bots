import { createHash } from 'node:crypto';
import { z } from 'zod';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

const utcTimestamp = z.string().datetime({ offset: true }).transform((value) => new Date(value).toISOString());

const evidenceState = z.enum(['GOOD', 'DEGRADED', 'STALE', 'UNKNOWN', 'INVALID', 'NOT_ENTITLED']);

const provenanceSchema = z.object({
  provider: z.enum(['ALPACA', 'OPTIONOMICS']),
  operationAlias: z.string().min(1),
  asOf: utcTimestamp.nullable(),
  retrievedAt: utcTimestamp,
  state: evidenceState,
  contentHash: z.string().regex(/^[0-9a-f]{64}$/),
  feed: z.string().min(1).nullable(),
  contractVersion: z.string().min(1),
  truthRole: z.enum(['ACCOUNT', 'CONTRACT', 'QUOTE', 'CONTEXT']),
  requiredForNewRisk: z.boolean(),
});

const unknownFeatureSchema = z.object({
  feature: z.string().min(1),
  reasonCode: z.string().min(1),
  provider: z.enum(['ALPACA', 'OPTIONOMICS']).nullable(),
});

const executableTruthSchema = z.object({
  account: evidenceState,
  contract: evidenceState,
  quote: evidenceState,
});

const versionManifestSchema = z.object({
  strategyVersion: z.string().min(1),
  featureVersion: z.string().min(1),
  riskLimitVersion: z.string().min(1),
  executionVersion: z.string().min(1),
  costModelVersion: z.string().min(1),
  dataVersion: z.string().min(1),
  modelVersions: z.record(z.string(), z.string().min(1)),
});

const fusionSnapshotInputSchema = z.object({
  botId: z.literal('THETA'),
  decisionTimeUtc: utcTimestamp,
  triggerType: z.string().min(1),
  marketSession: z.unknown(),
  underlyingState: z.unknown(),
  contractCandidates: z.array(z.unknown()),
  accountState: z.unknown(),
  positionState: z.unknown(),
  alpacaQuoteState: z.unknown(),
  optionomicsFeatureState: z.unknown(),
  eventState: z.unknown(),
  regimeState: z.unknown(),
  expertPriorState: z.unknown(),
  riskState: z.unknown(),
  versions: versionManifestSchema,
  sourceProvenance: z.array(provenanceSchema).min(1),
  freshnessFlags: z.array(z.string().min(1)),
  unknownFeatures: z.array(unknownFeatureSchema),
  executableTruth: executableTruthSchema,
}).strict();

export type FusionSnapshotInput = z.input<typeof fusionSnapshotInputSchema>;

export interface FusionSnapshot {
  readonly snapshot: Readonly<Record<string, JsonValue>>;
  readonly contentHash: string;
  readonly validForNewRisk: boolean;
}

function assertJsonValue(value: unknown, path = '$', seen = new WeakSet<object>()): asserts value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`${path} contains a non-finite number`);
    return;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new TypeError(`${path} contains a circular reference`);
    seen.add(value);
    value.forEach((item, index) => assertJsonValue(item, `${path}[${index}]`, seen));
    seen.delete(value);
    return;
  }
  if (typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`${path} is not a plain JSON object`);
    }
    if (seen.has(value)) throw new TypeError(`${path} contains a circular reference`);
    seen.add(value);
    for (const [key, item] of Object.entries(value)) {
      if (item === undefined) throw new TypeError(`${path}.${key} is undefined`);
      assertJsonValue(item, `${path}.${key}`, seen);
    }
    seen.delete(value);
    return;
  }
  throw new TypeError(`${path} is not JSON serializable`);
}

function canonicalize(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key] as JsonValue)]),
    );
  }
  return typeof value === 'number' && Object.is(value, -0) ? 0 : value;
}

export function canonicalJson(value: JsonValue): string {
  return JSON.stringify(canonicalize(value));
}

export function hashJson(value: JsonValue): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value !== null && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

export function buildFusionSnapshot(rawInput: FusionSnapshotInput): FusionSnapshot {
  const parsed = fusionSnapshotInputSchema.parse(rawInput);

  for (const truthRole of ['ACCOUNT', 'CONTRACT', 'QUOTE'] as const) {
    const hasRequiredTruth = parsed.sourceProvenance.some(
      (item) => item.provider === 'ALPACA' && item.truthRole === truthRole && item.requiredForNewRisk,
    );
    if (!hasRequiredTruth) throw new Error(`FusionSnapshot requires Alpaca ${truthRole} provenance`);
  }

  const requiredProvenanceIsGood = parsed.sourceProvenance
    .filter((item) => item.requiredForNewRisk)
    .every((item) => item.state === 'GOOD');
  const validForNewRisk =
    Object.values(parsed.executableTruth).every((state) => state === 'GOOD') && requiredProvenanceIsGood;
  const snapshotInput = { ...parsed, validForNewRisk };
  assertJsonValue(snapshotInput);
  const snapshot = canonicalize(snapshotInput) as Record<string, JsonValue>;
  const contentHash = hashJson(snapshot);

  return deepFreeze({ snapshot, contentHash, validForNewRisk });
}

export function verifyFusionSnapshot(snapshot: JsonValue, expectedHash: string): boolean {
  if (!/^[0-9a-f]{64}$/.test(expectedHash)) return false;
  return hashJson(snapshot) === expectedHash;
}
