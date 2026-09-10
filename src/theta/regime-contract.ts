import { z } from 'zod';

// Versioned request/response contract for bots/theta/quant/models/regime_v0.py.
// Five independent axes, never collapsed into one blended regime score
// (TRD section 42) -- this contract enforces that shape rather than
// allowing a future caller to flatten it into a single number.

export const regimeContractVersion = 'theta-regime-runtime-v1' as const;

const reasonSchema = z.object({
  code: z.string().min(1),
  polarity: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
  detail: z.string().min(1),
});

export const regimeSnapshotResponseSchema = z.object({
  contractVersion: z.literal(regimeContractVersion),
  snapshotId: z.string().min(1),
  timestamp: z.string().datetime({ offset: true }),
  policyVersion: z.string().min(1),
  trendState: z.enum(['BULL', 'RANGE', 'BEAR']).nullable(),
  volatilityState: z.enum(['LOW', 'NORMAL', 'HIGH', 'SHOCK']).nullable(),
  eventState: z.enum(['NONE', 'EARNINGS_NEAR', 'CORPORATE_ACTION', 'MACRO_RISK', 'OTHER_KNOWN']).nullable(),
  liquidityState: z.enum(['NORMAL', 'THIN', 'DISLOCATED']).nullable(),
  stressState: z.enum(['NORMAL', 'CORRECTION', 'CRISIS']).nullable(),
  confidence: z.number().min(0).max(1),
  reasons: z.array(reasonSchema),
}).superRefine((response, context) => {
  const axes = [response.trendState, response.volatilityState, response.eventState, response.liquidityState, response.stressState];
  const resolved = axes.filter((axis) => axis !== null).length;
  const expectedConfidence = resolved / axes.length;
  if (Math.abs(response.confidence - expectedConfidence) > 1e-9) {
    context.addIssue({ code: 'custom', message: 'confidence must equal the fraction of resolvable axes' });
  }
});

export type RegimeSnapshotResponse = z.infer<typeof regimeSnapshotResponseSchema>;

export function parseRegimeSnapshotResponse(payload: unknown): RegimeSnapshotResponse {
  return regimeSnapshotResponseSchema.parse(payload);
}
