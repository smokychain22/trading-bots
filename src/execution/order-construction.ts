import { z } from 'zod';
import type { BrokerOrderRequest } from './broker.js';
import { parseOccOptionSymbol } from '../theta/account-exposure.js';

export type ThetaOrderAction =
  | 'OPEN_CSP' | 'CLOSE_CSP' | 'ROLL_CSP_CLOSE' | 'ROLL_CSP_OPEN'
  | 'OPEN_CC' | 'CLOSE_CC' | 'ROLL_CC_CLOSE' | 'ROLL_CC_OPEN' | 'SELL_STOCK'
  | 'OPEN_DEFINED_RISK' | 'CLOSE_DEFINED_RISK';

export interface ThetaOrderInstruction {
  readonly action: ThetaOrderAction;
  readonly symbol: string;
  readonly quantity: number;
  readonly limitPrice: number;
  readonly clientOrderId: string;
  readonly confirmedCoveredShares?: number;
  readonly optionMultiplier?: number;
  /**
   * HDAC-05. Whole short-call contracts on this underlying that are ALREADY committed to other shares (open short calls
   * plus pending sell-to-open call orders, excluding the call a roll is itself closing). Required for every covered-call
   * open: `null`/undefined is UNKNOWN and blocks. Coverage must hold for (quantity + committed) contracts.
   */
  readonly committedShortCallContracts?: number | null;
}
const instructionSchema = z.object({
  action: z.enum(['OPEN_CSP', 'CLOSE_CSP', 'ROLL_CSP_CLOSE', 'ROLL_CSP_OPEN', 'OPEN_CC', 'CLOSE_CC', 'ROLL_CC_CLOSE', 'ROLL_CC_OPEN', 'SELL_STOCK']),
  symbol: z.string().min(1).max(64),
  quantity: z.number().int().positive(),
  limitPrice: z.number().positive().finite(),
  clientOrderId: z.string().min(1).max(48),
  confirmedCoveredShares: z.number().int().nonnegative().optional(),
  optionMultiplier: z.number().int().positive().optional(),
  committedShortCallContracts: z.number().int().nonnegative().nullable().optional(),
}).strict();

const buyActions: readonly ThetaOrderAction[] = ['CLOSE_CSP', 'ROLL_CSP_CLOSE', 'CLOSE_CC', 'ROLL_CC_CLOSE'];
const coveredCallOpenActions: readonly ThetaOrderAction[] = ['OPEN_CC', 'ROLL_CC_OPEN'];
const newRiskActions = new Set<ThetaOrderAction>(['OPEN_CSP', 'ROLL_CSP_OPEN', 'OPEN_CC', 'ROLL_CC_OPEN', 'OPEN_DEFINED_RISK']);
const allThetaOrderActions = new Set<ThetaOrderAction>([...instructionSchema.shape.action.options,
  'OPEN_DEFINED_RISK','CLOSE_DEFINED_RISK']);
export const thetaActionOpensNewRisk = (action: string): boolean => {
  if (!allThetaOrderActions.has(action as ThetaOrderAction)) throw new Error('THETA_ORDER_ACTION_INVALID');
  return newRiskActions.has(action as ThetaOrderAction);
};
const optionPositionIntent: Readonly<Partial<Record<ThetaOrderAction, NonNullable<BrokerOrderRequest['position_intent']>>>> = {
  OPEN_CSP: 'sell_to_open', CLOSE_CSP: 'buy_to_close',
  ROLL_CSP_CLOSE: 'buy_to_close', ROLL_CSP_OPEN: 'sell_to_open',
  OPEN_CC: 'sell_to_open', CLOSE_CC: 'buy_to_close',
  ROLL_CC_CLOSE: 'buy_to_close', ROLL_CC_OPEN: 'sell_to_open',
};

export function buildAlpacaLimitOrder(raw: ThetaOrderInstruction): BrokerOrderRequest {
  const input = instructionSchema.parse(raw);
  // Action/instrument agreement: a short call can only be opened through an
  // explicit covered-call action. A CSP action may never carry a call symbol
  // (that would be an uncovered short call that skips the coverage check),
  // and a covered-call action may never carry a put symbol.
  const occ = parseOccOptionSymbol(input.symbol);
  if (input.action === 'SELL_STOCK') {
    if (occ !== null || /\d{6}[CP]\d{8}$/.test(input.symbol)) throw new Error('SELL_STOCK requires an equity symbol, not an option contract.');
  } else if (input.action.includes('_CSP_') || input.action.endsWith('_CSP')) {
    if (occ === null || occ.optionType !== 'PUT') throw new Error('CSP actions require an OCC put contract symbol.');
  } else if (occ === null || occ.optionType !== 'CALL') {
    throw new Error('Covered-call actions require an OCC call contract symbol.');
  }
  if (coveredCallOpenActions.includes(input.action)) {
    // A missing multiplier is UNKNOWN (adjusted contracts exist) -- never silently assumed to be 100 for a coverage check.
    const multiplier = input.optionMultiplier;
    const committed = input.committedShortCallContracts;
    if (multiplier === undefined || input.confirmedCoveredShares === undefined || committed === undefined || committed === null
      || input.confirmedCoveredShares < (input.quantity + committed) * multiplier) {
      throw new Error('Covered-call order requires confirmed share coverage net of committed short calls, an explicit option multiplier and a known committed short-call count.');
    }
  }
  const positionIntent = optionPositionIntent[input.action];
  return {
    symbol: input.symbol,
    qty: input.quantity,
    side: buyActions.includes(input.action) ? 'buy' : 'sell',
    type: 'limit',
    time_in_force: 'day',
    limit_price: input.limitPrice.toFixed(2),
    client_order_id: input.clientOrderId,
    ...(positionIntent === undefined ? {} : { position_intent: positionIntent }),
  };
}

export function assertRollPair(close: ThetaOrderInstruction, open: ThetaOrderInstruction): void {
  const csp = close.action === 'ROLL_CSP_CLOSE' && open.action === 'ROLL_CSP_OPEN';
  const cc = close.action === 'ROLL_CC_CLOSE' && open.action === 'ROLL_CC_OPEN';
  if (!csp && !cc) throw new Error('A roll must be an explicit close-old plus open-new pair.');
  if (close.clientOrderId === open.clientOrderId) throw new Error('Each roll leg requires its own client_order_id.');
}
