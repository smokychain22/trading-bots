import { z } from 'zod';
import { buildPerformanceDashboard, type PerformanceEpisode } from '../research/performance-analytics-dashboard.js';
import { moneySchema } from '../execution/portfolio-capital-reservation.js';
import { thetaStrategyBranch } from '../theta/strategy-package.js';

const nullableMoney = moneySchema.nullable();
const at = z.string().datetime({ offset: true });
export const dotFeedbackSchema = z.object({
  version: z.literal('dot-private-feedback-v1'),
  providerAccountId: z.string().uuid(),
  observationId: z.string().uuid(),
  asOf: at,
  sourceSha: z.string().regex(/^[a-f0-9]{40}$/),
  truthClass: z.enum(['MARKET_OBSERVED', 'MODELED_RESEARCH', 'BROKER_ACTUAL']),
  strategyVersion: z.string().min(1),
  strategyBranch: thetaStrategyBranch,
  proposalHash: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  decisionId: z.string().nullable(),
  candidateId: z.string().nullable(),
  rejectionCodes: z.array(z.string().regex(/^[A-Z][A-Z0-9_]{1,100}$/)).max(100),
  orderId: z.string().nullable(),
  fillId: z.string().nullable(),
  chainId: z.string().nullable(),
  quantity: z.number().int().nonnegative().nullable(),
  multiplier: z.number().int().positive().nullable(),
  entryPrice: nullableMoney,
  exitPrice: nullableMoney,
  fees: nullableMoney,
  slippage: z.number().finite().nullable(),
  realizedNetPnl: z.number().finite().nullable(),
  unrealizedPnl: z.number().finite().nullable(),
  wholeChainNetPnl: z.number().finite().nullable(),
  capitalDays: z.number().finite().nonnegative().nullable(),
  openedAt: at.nullable(),
  closedAt: at.nullable(),
  outcomeState: z.enum(['OPEN', 'RESOLVED', 'UNRESOLVED', 'UNAVAILABLE']),
  lineageState: z.enum(['CANONICAL_LEDGER_VERIFIED', 'INCOMPLETE', 'UNAVAILABLE']),
  brokerAuthority: z.literal(false),
}).strict().superRefine((value, ctx) => {
  if (value.outcomeState === 'RESOLVED' && (value.lineageState !== 'CANONICAL_LEDGER_VERIFIED' || value.chainId === null
    || value.fillId === null || value.orderId === null || value.fees === null || value.closedAt === null
    || value.openedAt === null || value.wholeChainNetPnl === null || value.realizedNetPnl === null
    || value.quantity === null || value.quantity === 0 || value.multiplier === null
    || value.entryPrice === null || value.exitPrice === null || value.truthClass === 'MARKET_OBSERVED')) {
    ctx.addIssue({ code: 'custom', message: 'resolved result requires the fee-qualified canonical whole-chain ledger' });
  }
  if (value.closedAt && value.openedAt && Date.parse(value.closedAt) < Date.parse(value.openedAt)) {
    ctx.addIssue({ code: 'custom', message: 'close precedes entry' });
  }
  if (value.closedAt && Date.parse(value.closedAt) > Date.parse(value.asOf)) {
    ctx.addIssue({ code: 'custom', message: 'future outcome not yet available' });
  }
  if (value.openedAt && Date.parse(value.openedAt) > Date.parse(value.asOf)) {
    ctx.addIssue({ code: 'custom', message: 'future entry not yet available' });
  }
});
export type DotFeedback = z.infer<typeof dotFeedbackSchema>;

/** Consumers never use account equity change or raw position marks as resolved performance. */
export function buildDotPerformance(input: readonly DotFeedback[], expectedAccountId: string) {
  const rows = input.map(value => dotFeedbackSchema.parse(value));
  if (rows.some(row => row.providerAccountId !== expectedAccountId)) throw new Error('DOT_FEEDBACK_ACCOUNT_MISMATCH');
  // A caller-supplied truth label cannot replace a verified canonical ledger import.
  if (rows.some(row => row.truthClass === 'BROKER_ACTUAL')) throw new Error('DOT_CANONICAL_IMPORT_REQUIRED');
  const chainIds = rows.filter(row => row.outcomeState === 'RESOLVED').map(row => row.chainId);
  if (new Set(chainIds).size !== chainIds.length) throw new Error('DOT_DUPLICATE_RESOLVED_CHAIN');
  const episodes: PerformanceEpisode[] = rows.map(row => ({
    episodeId: row.chainId ?? row.observationId, strategy: row.strategyBranch, strategyVersion: row.strategyVersion,
    regime: null, openedAt: row.openedAt ?? row.asOf, closedAt: row.outcomeState === 'RESOLVED' ? row.closedAt : null,
    netPnlUsd: row.outcomeState === 'RESOLVED' ? row.wholeChainNetPnl : null, grossPnlUsd: null,
    feesUsd: row.fees === null ? null : Number(row.fees), slippageUsd: row.slippage, capitalRequiredUsd: null,
    capitalDays: row.capitalDays, assigned: null, calledAway: null,
    evidenceSource: row.truthClass === 'BROKER_ACTUAL' ? 'BROKER_CONFIRMED_FILLS' : 'HISTORICAL_REPLAY_MODELED',
  }));
  return { qualification: 'CANONICAL_IMPORT_REQUIRED_BEFORE_PUBLICATION', ...buildPerformanceDashboard(episodes) };
}
