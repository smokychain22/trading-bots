import { z } from 'zod';

const cap = (max: number) => z.number().finite().min(0).max(max).nullable();
const count = (max: number) => z.number().int().min(0).max(max).nullable();
export const optionalCapNames = [
  'max_bot_capital_pct', 'max_ticker_exposure_pct', 'max_contracts',
  'max_daily_loss_usd', 'max_open_positions', 'max_slippage_per_contract_usd',
  'min_dte', 'max_dte', 'min_open_interest',
] as const;

export const paperCopyPolicySchema = z.object({
  allocation_usd: z.number().finite().min(0).max(10_000_000),
  limit_mode: z.enum(['RECOMMENDED', 'CUSTOM']).default('CUSTOM'),
  max_bot_capital_pct: cap(100), max_ticker_exposure_pct: cap(100),
  max_contracts: count(1000), max_daily_loss_usd: cap(10_000_000),
  max_open_positions: count(1000), max_slippage_per_contract_usd: cap(100_000),
  min_dte: count(730), max_dte: count(730), min_open_interest: count(100_000_000),
  allow_0dte: z.boolean(), join_existing_positions: z.literal(false),
  start_new_trades_only: z.literal(true),
}).strict().superRefine((policy, context) => {
  if (policy.min_dte !== null && policy.max_dte !== null && policy.min_dte > policy.max_dte)
    context.addIssue({ code: 'custom', message: 'Minimum DTE must not exceed maximum DTE.' });
  if (!policy.allow_0dte && policy.min_dte === 0)
    context.addIssue({ code: 'custom', message: 'Minimum DTE must be at least one when 0DTE is disabled.' });
  if (policy.limit_mode === 'RECOMMENDED' && optionalCapNames.some((name) => policy[name] !== null))
    context.addIssue({ code: 'custom', message: 'Recommended mode cannot contain additional user caps.' });
});
export type PaperCopyPolicy = z.infer<typeof paperCopyPolicySchema>;

export function storedCopyPolicy(raw: Record<string, unknown> | null): PaperCopyPolicy | null {
  if (raw === null) return null;
  return paperCopyPolicySchema.parse({
    ...Object.fromEntries(optionalCapNames.map((name) => [name, raw[name] == null ? null : Number(raw[name])])),
    allocation_usd: Number(raw.allocation_usd), limit_mode: raw.limit_mode ?? 'CUSTOM',
    allow_0dte: raw.allow_0dte, join_existing_positions: raw.join_existing_positions,
    start_new_trades_only: raw.start_new_trades_only,
  });
}

export function recommendedCopyPolicy(allocationUsd: number): PaperCopyPolicy {
  return paperCopyPolicySchema.parse({ allocation_usd: allocationUsd, limit_mode: 'RECOMMENDED',
    ...Object.fromEntries(optionalCapNames.map((name) => [name, null])),
    allow_0dte: false, join_existing_positions: false, start_new_trades_only: true });
}

// Null removes only the user overlay. A mandatory platform cap is still required.
export function applyUserMaximum(platformMaximum: number, userMaximum: number | null): number {
  if (!Number.isFinite(platformMaximum) || platformMaximum < 0 ||
    (userMaximum !== null && (!Number.isFinite(userMaximum) || userMaximum < 0)))
    throw new Error('INVALID_CAP');
  return userMaximum === null ? platformMaximum : Math.min(platformMaximum, userMaximum);
}
