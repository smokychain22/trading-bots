import { z } from 'zod';
import type { BrokerOrderRequest } from './broker.js';

export type ThetaOrderAction =
  | 'OPEN_CSP' | 'CLOSE_CSP' | 'ROLL_CSP_CLOSE' | 'ROLL_CSP_OPEN'
  | 'OPEN_CC' | 'CLOSE_CC' | 'ROLL_CC_CLOSE' | 'ROLL_CC_OPEN' | 'SELL_STOCK';

export interface ThetaOrderInstruction {
  readonly action: ThetaOrderAction;
  readonly symbol: string;
  readonly quantity: number;
  readonly limitPrice: number;
  readonly clientOrderId: string;
  readonly confirmedCoveredShares?: number;
  readonly optionMultiplier?: number;
}
const instructionSchema = z.object({
  action: z.enum(['OPEN_CSP', 'CLOSE_CSP', 'ROLL_CSP_CLOSE', 'ROLL_CSP_OPEN', 'OPEN_CC', 'CLOSE_CC', 'ROLL_CC_CLOSE', 'ROLL_CC_OPEN', 'SELL_STOCK']),
  symbol: z.string().min(1).max(64),
  quantity: z.number().int().positive(),
  limitPrice: z.number().positive().finite(),
  clientOrderId: z.string().min(1).max(48),
  confirmedCoveredShares: z.number().int().nonnegative().optional(),
  optionMultiplier: z.number().int().positive().optional(),
}).strict();

const buyActions: readonly ThetaOrderAction[] = ['CLOSE_CSP', 'ROLL_CSP_CLOSE', 'CLOSE_CC', 'ROLL_CC_CLOSE'];
const coveredCallOpenActions: readonly ThetaOrderAction[] = ['OPEN_CC', 'ROLL_CC_OPEN'];

export function buildAlpacaLimitOrder(raw: ThetaOrderInstruction): BrokerOrderRequest {
  const input = instructionSchema.parse(raw);
  if (coveredCallOpenActions.includes(input.action)) {
    const multiplier = input.optionMultiplier ?? 100;
    if (input.confirmedCoveredShares === undefined || input.confirmedCoveredShares < input.quantity * multiplier) {
      throw new Error('Covered-call order requires confirmed share coverage.');
    }
  }
  return {
    symbol: input.symbol,
    qty: input.quantity,
    side: buyActions.includes(input.action) ? 'buy' : 'sell',
    type: 'limit',
    time_in_force: 'day',
    limit_price: input.limitPrice.toFixed(2),
    client_order_id: input.clientOrderId,
  };
}

export function assertRollPair(close: ThetaOrderInstruction, open: ThetaOrderInstruction): void {
  const csp = close.action === 'ROLL_CSP_CLOSE' && open.action === 'ROLL_CSP_OPEN';
  const cc = close.action === 'ROLL_CC_CLOSE' && open.action === 'ROLL_CC_OPEN';
  if (!csp && !cc) throw new Error('A roll must be an explicit close-old plus open-new pair.');
  if (close.clientOrderId === open.clientOrderId) throw new Error('Each roll leg requires its own client_order_id.');
}
