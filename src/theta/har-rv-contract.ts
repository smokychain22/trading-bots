import { z } from 'zod';

// Versioned request/response contract for
// bots/theta/quant/runtime/har_rv_contract.py, itself a stable JSON
// boundary around bots/theta/quant/features/realized_volatility.py.
// Research/shadow only -- no live Production caller, no broker authority.

export const harRvContractVersion = 'theta-har-rv-runtime-v1' as const;

export const harRvRequestSchema = z.object({
  contractVersion: z.literal(harRvContractVersion),
  snapshotId: z.string().min(1),
  timestamp: z.string().datetime({ offset: true }),
  asOf: z.string().datetime({ offset: true }),
  realizedVarianceSeries: z.array(z.number().finite().nonnegative().nullable()),
  weeklyWindow: z.number().int().positive().optional(),
  monthlyWindow: z.number().int().positive().optional(),
  minimumTrainingObservations: z.number().int().positive().optional(),
});
export type HarRvRequest = z.infer<typeof harRvRequestSchema>;

export const harRvDataQuality = z.enum(['KNOWN', 'UNKNOWN', 'INSUFFICIENT_HISTORY']);

export const harRvResponseSchema = z.object({
  contractVersion: z.literal(harRvContractVersion),
  snapshotId: z.string().min(1),
  timestamp: z.string().datetime({ offset: true }),
  asOf: z.string().datetime({ offset: true }),
  modelVersion: z.string().min(1),
  horizonDays: z.literal(1),
  forecastRealizedVariance: z.number().finite().nonnegative().nullable(),
  forecastRealizedVolatility: z.number().finite().nonnegative().nullable(),
  trainingObservationCount: z.number().int().nonnegative(),
  dataQuality: harRvDataQuality,
  reason: z.string().nullable(),
}).superRefine((response, context) => {
  const known = response.dataQuality === 'KNOWN';
  if (known !== (response.forecastRealizedVariance !== null)) {
    context.addIssue({ code: 'custom', message: 'forecastRealizedVariance must be non-null if and only if dataQuality is KNOWN' });
  }
  if (known !== (response.forecastRealizedVolatility !== null)) {
    context.addIssue({ code: 'custom', message: 'forecastRealizedVolatility must be non-null if and only if dataQuality is KNOWN' });
  }
});
export type HarRvResponse = z.infer<typeof harRvResponseSchema>;

export function parseHarRvResponse(payload: unknown): HarRvResponse {
  return harRvResponseSchema.parse(payload);
}
