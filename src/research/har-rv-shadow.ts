import { invokeAndValidate, type PythonBridgeConfig } from '../theta/python-bridge.js';
import { harRvContractVersion, parseHarRvResponse, type HarRvResponse } from '../theta/har-rv-contract.js';
import type { VolatilityAccelerationEvidence } from './volatility-acceleration.js';

export const harRvShadowVersion = 'theta-har-rv-shadow-v1' as const;

export type HarRvShadowFailureCode =
  | 'BRIDGE_TIMEOUT' | 'BRIDGE_PROCESS_ERROR' | 'BRIDGE_NON_ZERO_EXIT' | 'BRIDGE_OUTPUT_TOO_LARGE'
  | 'BRIDGE_EMPTY_OUTPUT' | 'BRIDGE_MALFORMED_JSON' | 'BRIDGE_SCHEMA_VALIDATION_FAILED'
  | 'BRIDGE_VERSION_MISMATCH' | 'BRIDGE_SNAPSHOT_MISMATCH' | 'BRIDGE_UNKNOWN_MODEL_FAMILY' | 'PYTHON_UNAVAILABLE';

/**
 * Research/shadow only. `brokerAuthority: false` always. A Python bridge
 * failure (timeout, process error, malformed output, Python genuinely
 * unavailable on this host) NEVER becomes a Production trading failure --
 * it degrades to `DEGRADED_RESEARCH_FEATURE` here, exactly like the
 * bridge's own doc comment requires for its live-authority callers, even
 * though this module has no live-authority caller of its own.
 *
 * This module NEVER declares HAR-RV superior to the simpler baselines it
 * assembles alongside it -- per MODEL-001 (baseline-first) and the
 * standing directive ("HAR must earn its complexity"), that judgment
 * requires comparing forecast error against REALIZED outcomes on
 * untouched OOS data, which this module does not have. It only assembles
 * the comparable forecasts side by side, honestly labeled, for a later
 * evaluation pass once real outcomes exist.
 */
export interface HarRvShadowComparison {
  readonly contractVersion: typeof harRvShadowVersion;
  readonly asOf: string;
  readonly harRv: {
    readonly state: 'AVAILABLE' | 'DEGRADED_RESEARCH_FEATURE';
    readonly forecastRealizedVolatility: number | null;
    readonly modelVersion: string | null;
    readonly trainingObservationCount: number | null;
    readonly failureCode: HarRvShadowFailureCode | null;
    readonly reason: string | null;
  };
  /**
   * The simplest possible baseline: "tomorrow's realized vol equals the
   * most recent short-horizon realized vol" (`rv5`). Named explicitly as
   * naive persistence, never presented as a forecast method in its own
   * right.
   */
  readonly naivePersistenceRealizedVolatility: number | null;
  readonly rv5: number | null;
  readonly rv21: number | null;
  readonly rv63: number | null;
  readonly brokerAuthority: false;
}

function failureCodeFor(bridgeFailureCode: string): HarRvShadowFailureCode {
  const known: Record<string, HarRvShadowFailureCode> = {
    TIMEOUT: 'BRIDGE_TIMEOUT', PROCESS_ERROR: 'BRIDGE_PROCESS_ERROR', NON_ZERO_EXIT: 'BRIDGE_NON_ZERO_EXIT',
    OUTPUT_TOO_LARGE: 'BRIDGE_OUTPUT_TOO_LARGE', EMPTY_OUTPUT: 'BRIDGE_EMPTY_OUTPUT', MALFORMED_JSON: 'BRIDGE_MALFORMED_JSON',
    SCHEMA_VALIDATION_FAILED: 'BRIDGE_SCHEMA_VALIDATION_FAILED', VERSION_MISMATCH: 'BRIDGE_VERSION_MISMATCH',
    SNAPSHOT_MISMATCH: 'BRIDGE_SNAPSHOT_MISMATCH', UNKNOWN_MODEL_FAMILY: 'BRIDGE_UNKNOWN_MODEL_FAMILY',
  };
  return known[bridgeFailureCode] ?? 'BRIDGE_PROCESS_ERROR';
}

/**
 * Invokes the HAR-RV Python bridge (model family `harRv`, expected to be
 * allowlisted by the caller's `PythonBridgeConfig` to
 * `bots/theta/quant/runtime/har_rv_contract.py`) and assembles the result
 * alongside the already-existing simple-volatility baselines
 * (`VolatilityAccelerationEvidence`: rv5/rv21/rv63) -- never a second,
 * competing RV computation of its own.
 */
export async function buildHarRvShadowComparison(input: {
  readonly bridgeConfig: PythonBridgeConfig;
  readonly snapshotId: string;
  readonly timestamp: string;
  readonly asOf: string;
  readonly realizedVarianceSeries: readonly (number | null)[];
  readonly acceleration: VolatilityAccelerationEvidence;
  readonly weeklyWindow?: number;
  readonly monthlyWindow?: number;
  readonly minimumTrainingObservations?: number;
}): Promise<HarRvShadowComparison> {
  const request = {
    contractVersion: harRvContractVersion, snapshotId: input.snapshotId, timestamp: input.timestamp, asOf: input.asOf,
    realizedVarianceSeries: [...input.realizedVarianceSeries],
    weeklyWindow: input.weeklyWindow, monthlyWindow: input.monthlyWindow,
    minimumTrainingObservations: input.minimumTrainingObservations,
  };
  const result = await invokeAndValidate<HarRvResponse>(
    input.bridgeConfig, 'harRv', request, parseHarRvResponse,
  );

  const rv5 = input.acceleration.rv5, rv21 = input.acceleration.rv21, rv63 = input.acceleration.rv63;
  const base = {
    contractVersion: harRvShadowVersion, asOf: input.asOf,
    naivePersistenceRealizedVolatility: rv5, rv5, rv21, rv63, brokerAuthority: false as const,
  };

  if (!result.ok) {
    return {
      ...base,
      harRv: {
        state: 'DEGRADED_RESEARCH_FEATURE', forecastRealizedVolatility: null, modelVersion: null,
        trainingObservationCount: null, failureCode: failureCodeFor(result.failureCode), reason: result.detail,
      },
    };
  }

  const response = result.data;
  if (response.dataQuality !== 'KNOWN') {
    return {
      ...base,
      harRv: {
        state: 'DEGRADED_RESEARCH_FEATURE', forecastRealizedVolatility: null, modelVersion: response.modelVersion,
        trainingObservationCount: response.trainingObservationCount, failureCode: null, reason: response.reason,
      },
    };
  }

  return {
    ...base,
    harRv: {
      state: 'AVAILABLE', forecastRealizedVolatility: response.forecastRealizedVolatility,
      modelVersion: response.modelVersion, trainingObservationCount: response.trainingObservationCount,
      failureCode: null, reason: null,
    },
  };
}
