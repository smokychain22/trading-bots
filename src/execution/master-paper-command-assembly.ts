import { createHash } from 'node:crypto';
import { z } from 'zod';
import { generateClientOrderId } from '../theta/order-intent-state.js';
import type { MasterPaperExecutionCommand } from './master-paper-execution-orchestrator.js';
import { buildAlpacaLimitOrder, thetaActionOpensNewRisk, type ThetaOrderAction } from './order-construction.js';

export interface MasterPaperCommandAssemblyInput {
  readonly action: ThetaOrderAction;
  readonly executionAccountId: string;
  readonly decisionId: string;
  readonly candidateId: string;
  readonly strategyVersion: string;
  readonly chainId: string;
  readonly optionContractId: string | null;
  readonly underlyingId: string;
  readonly symbol: string;
  readonly quantity: number;
  readonly multiplier: number;
  readonly confirmedCoveredShares?: number;
  readonly limitPrice: number;
  readonly pricingPolicyVersion: string;
  readonly quote: {
    readonly source: 'ALPACA';
    readonly feed: 'OPRA' | 'SIP' | 'IEX' | 'INDICATIVE';
    readonly bid: number;
    readonly ask: number;
    readonly observedAt: string;
    readonly maximumAgeSeconds: number;
  };
  readonly accountVerified: boolean;
  readonly optionsCapabilityVerified: boolean;
  readonly aegisState: 'ALLOW_FULL' | 'ALLOW_REDUCED' | 'HOLD_ONLY' | 'HARD_VETO';
  readonly now: string;
  readonly decisionExpiresAt: string;
  readonly attempt: number;
}

const inputSchema = z.object({
  action: z.enum(['OPEN_CSP', 'CLOSE_CSP', 'ROLL_CSP_CLOSE', 'ROLL_CSP_OPEN', 'OPEN_CC', 'CLOSE_CC', 'ROLL_CC_CLOSE', 'ROLL_CC_OPEN', 'SELL_STOCK']),
  executionAccountId: z.string().uuid(), decisionId: z.string().uuid(), candidateId: z.string().min(1),
  strategyVersion: z.string().min(1), chainId: z.string().uuid(), optionContractId: z.string().uuid().nullable(),
  underlyingId: z.string().uuid(), symbol: z.string().min(1).max(64), quantity: z.number().int().positive(),
  multiplier: z.number().int().positive(), confirmedCoveredShares: z.number().int().nonnegative().optional(),
  limitPrice: z.number().positive().finite(), pricingPolicyVersion: z.string().min(1),
  quote: z.object({ source: z.literal('ALPACA'), feed: z.enum(['OPRA', 'SIP', 'IEX', 'INDICATIVE']),
    bid: z.number().nonnegative().finite(), ask: z.number().positive().finite(), observedAt: z.string().datetime({ offset: true }),
    maximumAgeSeconds: z.number().positive().finite() }).strict(),
  accountVerified: z.boolean(), optionsCapabilityVerified: z.boolean(),
  aegisState: z.enum(['ALLOW_FULL', 'ALLOW_REDUCED', 'HOLD_ONLY', 'HARD_VETO']),
  now: z.string().datetime({ offset: true }), decisionExpiresAt: z.string().datetime({ offset: true }),
  attempt: z.number().int().positive(),
}).strict();

const deterministicUuid = (value: string): string => {
  const bytes = Buffer.from(createHash('sha256').update(value).digest('hex').slice(0, 32), 'hex');
  const version = bytes.at(6), variant = bytes.at(8);
  if (version === undefined || variant === undefined) throw new Error('ORDER_INTENT_ID_INVALID');
  bytes[6] = (version & 0x0f) | 0x40;
  bytes[8] = (variant & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

const canonicalQuoteHash = (input: z.infer<typeof inputSchema>): string => createHash('sha256').update(JSON.stringify({
  source: input.quote.source, feed: input.quote.feed, symbol: input.symbol,
  bid: input.quote.bid, ask: input.quote.ask, observedAt: input.quote.observedAt,
  pricingPolicyVersion: input.pricingPolicyVersion, limitPrice: input.limitPrice,
})).digest('hex');

/**
 * Converts one already-selected, already-sized strategy or management action
 * into the exact persisted command consumed by the Paper coordinator. It does
 * no strategy selection and no sizing. Missing or contradictory evidence
 * fails before persistence or broker access.
 */
export function assembleMasterPaperExecutionCommand(raw: MasterPaperCommandAssemblyInput): MasterPaperExecutionCommand {
  const input = inputSchema.parse(raw);
  const isStock = input.action === 'SELL_STOCK';
  if (isStock) {
    if (input.optionContractId !== null || !['SIP', 'IEX'].includes(input.quote.feed)) {
      throw new Error('STOCK_EXECUTION_LINEAGE_INVALID');
    }
  } else if (input.optionContractId === null || input.quote.feed !== 'OPRA') {
    throw new Error('OPTION_EXECUTION_REQUIRES_ALPACA_OPRA_BBO');
  }
  if (input.quote.bid > input.quote.ask) throw new Error('EXECUTION_BBO_CROSSED');
  if (input.limitPrice < input.quote.bid || input.limitPrice > input.quote.ask) throw new Error('EXECUTION_LIMIT_OUTSIDE_BBO');
  const quoteAgeSeconds = (Date.parse(input.now) - Date.parse(input.quote.observedAt)) / 1000;
  if (!Number.isFinite(quoteAgeSeconds) || quoteAgeSeconds < 0 || quoteAgeSeconds > input.quote.maximumAgeSeconds) {
    throw new Error('EXECUTION_QUOTE_NOT_FRESH');
  }
  if (Date.parse(input.decisionExpiresAt) <= Date.parse(input.now)) throw new Error('EXECUTION_DECISION_EXPIRED');

  const identitySeed = `${input.candidateId}:${input.strategyVersion}:${input.action}:${input.chainId}`;
  const clientOrderId = generateClientOrderId(input.decisionId, identitySeed, input.attempt);
  const orderIntentId = deterministicUuid(`${input.executionAccountId}:${input.decisionId}:${identitySeed}:${input.attempt}`);
  const request = buildAlpacaLimitOrder({ action: input.action, symbol: input.symbol, quantity: input.quantity,
    limitPrice: input.limitPrice, clientOrderId, optionMultiplier: input.multiplier,
    ...(input.confirmedCoveredShares === undefined ? {} : { confirmedCoveredShares: input.confirmedCoveredShares }) });
  return {
    orderIntentId, executionAccountId: input.executionAccountId, decisionId: input.decisionId,
    action: input.action, chainId: input.chainId, optionContractId: input.optionContractId,
    underlyingId: input.underlyingId, request, persistedAt: input.now,
    executionEvidence: { quoteSource: 'ALPACA', quoteFeed: input.quote.feed as 'OPRA' | 'SIP' | 'IEX',
      quoteAsOf: input.quote.observedAt, decisionExpiresAt: input.decisionExpiresAt,
      quoteContentHash: canonicalQuoteHash(input), aegisState: input.aegisState },
    gate: { baseHostname: 'paper-api.alpaca.markets', accountVerified: input.accountVerified,
      optionsCapabilityVerified: input.optionsCapabilityVerified, aegisState: input.aegisState,
      quoteFresh: true, priceEvidence: isStock ? 'ALPACA_STOCK_BBO' : 'ALPACA_OPRA_BBO',
      decisionExpiresAt: input.decisionExpiresAt, now: input.now, isNewEntry: thetaActionOpensNewRisk(input.action) },
  };
}
