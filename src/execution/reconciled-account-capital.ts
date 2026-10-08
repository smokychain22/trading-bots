import { z } from 'zod';
import { accountCapitalInputSchema } from './qualified-account-capital.js';
import { capitalContentHash, moneySchema } from './portfolio-capital-reservation.js';

export const reconciledAccountCapitalVersion = 'theta-reconciled-account-capital-v1' as const;
export const reconciledAccountCapitalSchema = z.object({
  version: z.literal(reconciledAccountCapitalVersion), state: z.literal('READY'),
  account: accountCapitalInputSchema.shape.account,
  // Margin buying power is distinct from options buying power and may be
  // absent. It can never substitute for the options balance in this producer.
  buyingPower: moneySchema.nullable(),
}).strict().superRefine((value, context) => {
  const { contentHash, ...account } = value.account;
  if (contentHash !== capitalContentHash({ account, buyingPower: value.buyingPower })) {
    context.addIssue({ code: 'custom', path: ['account', 'contentHash'], message: 'CAPITAL_ACCOUNT_HASH_MISMATCH' });
  }
  if (Date.parse(account.receivedAt) < Date.parse(account.requestedAt)) {
    context.addIssue({ code: 'custom', path: ['account', 'receivedAt'], message: 'CAPITAL_ACCOUNT_READ_TIME_INVALID' });
  }
});
export type ReconciledAccountCapital = z.infer<typeof reconciledAccountCapitalSchema>
  | { version: typeof reconciledAccountCapitalVersion; state: 'BLOCKED'; reasons: readonly string[] };

/** Uses the account GET already performed by reconciliation. No second broker
 * read, account mutation, float-money conversion, or fabricated missing balance. */
export function buildReconciledAccountCapital(raw: Record<string, unknown>, stamp: {
  accountHash: string; snapshotId: string; requestedAt: string; receivedAt: string;
}): ReconciledAccountCapital {
  const reasons: string[] = [];
  for (const field of ['equity','cash','options_buying_power'] as const) {
    if (!moneySchema.safeParse(raw[field]).success) reasons.push(`CAPITAL_ACCOUNT_FIELD_UNQUALIFIED:${field}`);
  }
  if (raw.status !== 'ACTIVE') reasons.push('CAPITAL_ACCOUNT_NOT_ACTIVE');
  if (raw.trading_blocked !== false || raw.account_blocked !== false) reasons.push('CAPITAL_ACCOUNT_CONTROL_UNQUALIFIED');
  const buyingPower = moneySchema.safeParse(raw.buying_power);
  const account = {...stamp,equity:raw.equity,cash:raw.cash,optionsBuyingPower:raw.options_buying_power,
    status:raw.status,tradingBlocked:raw.trading_blocked};
  const qualifiedBuyingPower = buyingPower.success ? buyingPower.data : null;
  const contentHash = capitalContentHash({account,buyingPower:qualifiedBuyingPower});
  const parsed = reconciledAccountCapitalSchema.safeParse({version:reconciledAccountCapitalVersion,state:'READY',
    account:{...account,contentHash},buyingPower:qualifiedBuyingPower});
  if (!parsed.success) reasons.push('CAPITAL_ACCOUNT_OBSERVATION_INVALID');
  if (Date.parse(stamp.receivedAt) < Date.parse(stamp.requestedAt)) reasons.push('CAPITAL_ACCOUNT_READ_TIME_INVALID');
  return reasons.length || !parsed.success
    ? {version:reconciledAccountCapitalVersion,state:'BLOCKED',reasons:[...new Set(reasons)].sort()}
    : parsed.data;
}
