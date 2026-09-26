/**
 * COMMAND 4 item 20 (COMMAND 3 §14/§21). Execution research dataset
 * contract. Research-only, `brokerAuthority: false`. Direction-normalized
 * slippage sign convention: positive always means "worse than expected,"
 * regardless of buy/sell side. Unfilled orders are excluded from slippage
 * labels entirely -- they belong only in fill-probability data, since no
 * fill price exists to compute slippage from.
 */

export const executionDatasetContractVersion = 'theta-execution-dataset-contract-v1' as const;

export type OrderSide = 'BUY' | 'SELL';
export type OrderTerminalStatus = 'FILLED' | 'CANCELLED' | 'EXPIRED';

export interface ExecutionDecisionQuote {
  readonly bid: number;
  readonly ask: number;
  readonly mid: number;
  readonly spread: number;
  readonly observedAt: string;
}

export interface FillProbabilityRow {
  readonly contractVersion: typeof executionDatasetContractVersion;
  readonly orderIntentId: string;
  readonly side: OrderSide;
  readonly size: number;
  readonly limitOffsetFromMid: number;
  readonly quoteAgeSeconds: number | null;
  readonly underlyingLiquidity: number | null;
  readonly optionOpenInterest: number | null;
  readonly optionVolume: number | null;
  readonly timeOfDayBucket: string | null;
  readonly filled: boolean;
  readonly terminalStatus: OrderTerminalStatus;
}

export interface SlippageRow {
  readonly contractVersion: typeof executionDatasetContractVersion;
  readonly orderIntentId: string;
  readonly side: OrderSide;
  /** `(fillPrice - decisionMid) * sign(side)`, where `sign('BUY') = +1` and
   * `sign('SELL') = -1` -- positive is always worse-than-expected for the
   * side actually taken. */
  readonly directionNormalizedSlippage: number;
  readonly fillPrice: number;
  readonly decisionMid: number;
}

const SIDE_SIGN: Readonly<Record<OrderSide, 1 | -1>> = { BUY: 1, SELL: -1 };

export function buildSlippageRow(input: {
  readonly orderIntentId: string; readonly side: OrderSide; readonly fillPrice: number; readonly decisionQuote: ExecutionDecisionQuote;
}): SlippageRow {
  if (!Number.isFinite(input.fillPrice)) throw new Error('SLIPPAGE_FILL_PRICE_NOT_FINITE');
  const raw = input.fillPrice - input.decisionQuote.mid;
  return {
    contractVersion: executionDatasetContractVersion, orderIntentId: input.orderIntentId, side: input.side,
    directionNormalizedSlippage: raw * SIDE_SIGN[input.side], fillPrice: input.fillPrice, decisionMid: input.decisionQuote.mid,
  };
}

/**
 * Throws if called for an unfilled order -- this is the structural
 * enforcement of "unfilled orders must not receive factual slippage
 * labels."
 */
export function assertEligibleForSlippage(row: FillProbabilityRow): void {
  if (!row.filled) throw new Error('UNFILLED_ORDER_INELIGIBLE_FOR_SLIPPAGE_LABEL');
}
