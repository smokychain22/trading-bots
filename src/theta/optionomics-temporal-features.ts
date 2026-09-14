import { createHash } from 'node:crypto';

export const optionomicsTemporalFeatureMethodVersion = 'theta-optionomics-temporal-delta-v1' as const;

export type OptionomicsTemporalFeatureState = 'KNOWN' | 'UNKNOWN' | 'INVALID';
export type OptionomicsTemporalFeatureFamily = 'VOLATILITY' | 'SKEW' | 'TERM_STRUCTURE' | 'EXPOSURE';

export interface OptionomicsFeatureSnapshotReference {
  readonly featureSnapshotId: string;
  readonly underlying: string;
  readonly observedAt: string;
  readonly schemaVersion: string;
  readonly featureState: Readonly<Record<string, unknown>>;
}

export interface OptionomicsTemporalFeature {
  readonly family: OptionomicsTemporalFeatureFamily;
  readonly metricKey: string;
  readonly state: OptionomicsTemporalFeatureState;
  readonly units: 'DECIMAL_IV' | 'PROVIDER_REPORTED_UNVERIFIED';
  readonly earlierValue: number | null;
  readonly currentValue: number | null;
  readonly absoluteChange: number | null;
  readonly ratePerHour: number | null;
  readonly elapsedSeconds: number | null;
  readonly reasonCode: string | null;
  readonly earlierFeatureSnapshotId: string;
  readonly currentFeatureSnapshotId: string;
  readonly earlierObservedAt: string;
  readonly currentObservedAt: string;
  readonly methodVersion: typeof optionomicsTemporalFeatureMethodVersion;
  readonly executionEligible: false;
}

interface ScalarDefinition {
  readonly family: OptionomicsTemporalFeatureFamily;
  readonly metricKey: string;
  readonly units: OptionomicsTemporalFeature['units'];
  readonly path: readonly string[];
}

const scalarDefinitions: readonly ScalarDefinition[] = [
  { family: 'SKEW', metricKey: 'PUT25_MINUS_CALL25_IV', units: 'DECIMAL_IV', path: ['skew'] },
  { family: 'TERM_STRUCTURE', metricKey: 'FAR_MINUS_NEAR_IV', units: 'DECIMAL_IV', path: ['termStructure'] },
  { family: 'VOLATILITY', metricKey: 'ATM_IV', units: 'PROVIDER_REPORTED_UNVERIFIED', path: ['providerContext', 'metrics', 'atmIv'] },
  { family: 'VOLATILITY', metricKey: 'IV_RANK', units: 'PROVIDER_REPORTED_UNVERIFIED', path: ['providerContext', 'metrics', 'ivRank'] },
  { family: 'VOLATILITY', metricKey: 'IV_PERCENTILE', units: 'PROVIDER_REPORTED_UNVERIFIED', path: ['providerContext', 'metrics', 'ivPercentile'] },
  { family: 'VOLATILITY', metricKey: 'IV_MINUS_RV20', units: 'PROVIDER_REPORTED_UNVERIFIED', path: ['providerContext', 'metrics', 'ivMinusRealizedVolatility20d'] },
  { family: 'VOLATILITY', metricKey: 'IV_SKEW_Z_SCORE', units: 'PROVIDER_REPORTED_UNVERIFIED', path: ['providerContext', 'metrics', 'impliedVolatilitySkewZScore'] },
  { family: 'VOLATILITY', metricKey: 'RISK_REVERSAL_25', units: 'PROVIDER_REPORTED_UNVERIFIED', path: ['providerContext', 'metrics', 'riskReversal25'] },
  { family: 'EXPOSURE', metricKey: 'TOTAL_GEX', units: 'PROVIDER_REPORTED_UNVERIFIED', path: ['providerContext', 'metrics', 'totalGex'] },
  { family: 'EXPOSURE', metricKey: 'TOTAL_DELTA_EXPOSURE', units: 'PROVIDER_REPORTED_UNVERIFIED', path: ['providerContext', 'metrics', 'totalDeltaExposure'] },
  { family: 'EXPOSURE', metricKey: 'GAMMA_FLIP_STRIKE', units: 'PROVIDER_REPORTED_UNVERIFIED', path: ['providerContext', 'metrics', 'gammaFlipStrike'] },
  { family: 'EXPOSURE', metricKey: 'PUT_WALL_STRIKE', units: 'PROVIDER_REPORTED_UNVERIFIED', path: ['providerContext', 'metrics', 'putWall'] },
  { family: 'EXPOSURE', metricKey: 'CALL_WALL_STRIKE', units: 'PROVIDER_REPORTED_UNVERIFIED', path: ['providerContext', 'metrics', 'callWall'] },
] as const;

interface ScalarValue {
  readonly state: OptionomicsTemporalFeatureState;
  readonly value: number | null;
  readonly reason: string | null;
}

function objectOrNull(value: unknown): Readonly<Record<string, unknown>> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : null;
}

function atPath(root: Readonly<Record<string, unknown>>, path: readonly string[]): unknown {
  let current: unknown = root;
  for (const segment of path) {
    const object = objectOrNull(current);
    if (object === null || !(segment in object)) return null;
    current = object[segment];
  }
  return current;
}

function scalar(root: Readonly<Record<string, unknown>>, path: readonly string[]): ScalarValue {
  const raw = objectOrNull(atPath(root, path));
  if (raw === null) return { state: 'UNKNOWN', value: null, reason: 'FEATURE_VALUE_ABSENT' };
  const state = raw.state;
  if (state !== 'KNOWN' && state !== 'UNKNOWN' && state !== 'INVALID') {
    return { state: 'INVALID', value: null, reason: 'FEATURE_STATE_INVALID' };
  }
  if (state !== 'KNOWN') {
    return { state, value: null, reason: typeof raw.reason === 'string' ? raw.reason : `FEATURE_${state}` };
  }
  if (typeof raw.value !== 'number' || !Number.isFinite(raw.value)) {
    return { state: 'INVALID', value: null, reason: 'KNOWN_FEATURE_VALUE_NOT_FINITE' };
  }
  return { state: 'KNOWN', value: raw.value, reason: null };
}

function invalidForAll(input: {
  readonly earlier: OptionomicsFeatureSnapshotReference;
  readonly current: OptionomicsFeatureSnapshotReference;
  readonly reasonCode: string;
}): readonly OptionomicsTemporalFeature[] {
  return scalarDefinitions.map((definition) => ({
    family: definition.family,
    metricKey: definition.metricKey,
    state: 'INVALID',
    units: definition.units,
    earlierValue: null,
    currentValue: null,
    absoluteChange: null,
    ratePerHour: null,
    elapsedSeconds: null,
    reasonCode: input.reasonCode,
    earlierFeatureSnapshotId: input.earlier.featureSnapshotId,
    currentFeatureSnapshotId: input.current.featureSnapshotId,
    earlierObservedAt: input.earlier.observedAt,
    currentObservedAt: input.current.observedAt,
    methodVersion: optionomicsTemporalFeatureMethodVersion,
    executionEligible: false,
  }));
}

export function deriveOptionomicsTemporalFeatures(input: {
  readonly earlier: OptionomicsFeatureSnapshotReference;
  readonly current: OptionomicsFeatureSnapshotReference;
  readonly maximumGapSeconds: number;
}): readonly OptionomicsTemporalFeature[] {
  if (input.earlier.underlying !== input.current.underlying) {
    return invalidForAll({ ...input, reasonCode: 'UNDERLYING_MISMATCH' });
  }
  const earlierMs = Date.parse(input.earlier.observedAt);
  const currentMs = Date.parse(input.current.observedAt);
  if (!Number.isFinite(earlierMs) || !Number.isFinite(currentMs)) {
    return invalidForAll({ ...input, reasonCode: 'OBSERVATION_TIMESTAMP_INVALID' });
  }
  if (currentMs <= earlierMs) {
    return invalidForAll({ ...input, reasonCode: 'OBSERVATIONS_NOT_STRICTLY_TIME_ORDERED' });
  }
  if (!Number.isFinite(input.maximumGapSeconds) || input.maximumGapSeconds <= 0) {
    return invalidForAll({ ...input, reasonCode: 'MAXIMUM_GAP_INVALID' });
  }
  const elapsedSeconds = (currentMs - earlierMs) / 1_000;
  const versionMismatch = input.earlier.schemaVersion !== input.current.schemaVersion;
  return scalarDefinitions.map((definition) => {
    const base = {
      family: definition.family,
      metricKey: definition.metricKey,
      units: definition.units,
      elapsedSeconds,
      earlierFeatureSnapshotId: input.earlier.featureSnapshotId,
      currentFeatureSnapshotId: input.current.featureSnapshotId,
      earlierObservedAt: input.earlier.observedAt,
      currentObservedAt: input.current.observedAt,
      methodVersion: optionomicsTemporalFeatureMethodVersion,
      executionEligible: false as const,
    };
    if (versionMismatch) return {
      ...base, state: 'UNKNOWN' as const, earlierValue: null, currentValue: null,
      absoluteChange: null, ratePerHour: null, reasonCode: 'FEATURE_SCHEMA_VERSION_MISMATCH',
    };
    if (elapsedSeconds > input.maximumGapSeconds) return {
      ...base, state: 'UNKNOWN' as const, earlierValue: null, currentValue: null,
      absoluteChange: null, ratePerHour: null, reasonCode: 'OBSERVATION_GAP_EXCEEDS_POLICY',
    };
    const earlier = scalar(input.earlier.featureState, definition.path);
    const current = scalar(input.current.featureState, definition.path);
    if (earlier.state === 'INVALID' || current.state === 'INVALID') return {
      ...base, state: 'INVALID' as const, earlierValue: earlier.value, currentValue: current.value,
      absoluteChange: null, ratePerHour: null,
      reasonCode: `INVALID_INPUT:EARLIER_${earlier.reason ?? earlier.state}:CURRENT_${current.reason ?? current.state}`,
    };
    if (earlier.state !== 'KNOWN' || current.state !== 'KNOWN' || earlier.value === null || current.value === null) return {
      ...base, state: 'UNKNOWN' as const, earlierValue: earlier.value, currentValue: current.value,
      absoluteChange: null, ratePerHour: null,
      reasonCode: `UNKNOWN_INPUT:EARLIER_${earlier.reason ?? earlier.state}:CURRENT_${current.reason ?? current.state}`,
    };
    const absoluteChange = current.value - earlier.value;
    return {
      ...base, state: 'KNOWN' as const, earlierValue: earlier.value, currentValue: current.value,
      absoluteChange, ratePerHour: absoluteChange * 3_600 / elapsedSeconds, reasonCode: null,
    };
  });
}

export function hashOptionomicsTemporalFeature(feature: OptionomicsTemporalFeature): string {
  return createHash('sha256').update(JSON.stringify(feature)).digest('hex');
}
