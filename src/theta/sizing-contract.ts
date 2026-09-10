import { z } from 'zod';

// Versioned request/response contract for bots/theta/quant/models/sizing.py.

export const sizingContractVersion = 'theta-sizing-runtime-v1' as const;

const reasonSchema = z.object({
  code: z.string().min(1),
  polarity: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
  detail: z.string().min(1),
});

export const sizingResultResponseSchema = z.object({
  contractVersion: z.literal(sizingContractVersion),
  decisionId: z.string().min(1),
  snapshotId: z.string().min(1),
  timestamp: z.string().datetime({ offset: true }),
  policyVersion: z.string().min(1),
  quantity: z.number().int().nonnegative(),
  capitalRequired: z.number().finite().nullable(),
  bindingConstraint: z.string().min(1),
  reasons: z.array(reasonSchema),
}).superRefine((response, context) => {
  if (response.quantity === 0 && response.capitalRequired !== null && response.capitalRequired !== 0) {
    context.addIssue({ code: 'custom', message: 'zero quantity must not carry a nonzero capital requirement' });
  }
});

export type SizingResultResponse = z.infer<typeof sizingResultResponseSchema>;

export function parseSizingResultResponse(payload: unknown): SizingResultResponse {
  return sizingResultResponseSchema.parse(payload);
}
