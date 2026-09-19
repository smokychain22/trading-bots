import type { HistoricalBar } from '../theta/underlying-history.js';
import { computeRealizedVolatility } from '../theta/underlying-features.js';

export const volatilityAccelerationVersion = 'theta-volatility-acceleration-shadow-v1' as const;

export interface VolatilityAccelerationEvidence {
  readonly contractVersion: typeof volatilityAccelerationVersion;
  readonly asOf: string;
  readonly rv5: number | null;
  readonly rv21: number | null;
  readonly rv63: number | null;
  readonly weeklyVsMonthly: number | null;
  readonly monthlyVsQuarterly: number | null;
  readonly state: 'KNOWN' | 'UNKNOWN';
  readonly brokerAuthority: false;
}

/** Point-in-time shadow evidence only. No threshold and no trade signal. */
export function buildVolatilityAccelerationEvidence(
  bars: readonly HistoricalBar[], asOf: string,
): VolatilityAccelerationEvidence {
  const rv5=computeRealizedVolatility(bars,asOf,5);
  const rv21=computeRealizedVolatility(bars,asOf,21);
  const rv63=computeRealizedVolatility(bars,asOf,63);
  return {
    contractVersion:volatilityAccelerationVersion,asOf,rv5,rv21,rv63,
    weeklyVsMonthly:rv5===null||rv21===null?null:rv5-rv21,
    monthlyVsQuarterly:rv21===null||rv63===null?null:rv21-rv63,
    state:rv5===null||rv21===null||rv63===null?'UNKNOWN':'KNOWN',brokerAuthority:false,
  };
}
