export const commonHorizonEconomicsVersion = 'theta-common-horizon-economics-v1' as const;

/**
 * Formalizes the "same state, same forward horizon, no premium
 * double-counting" requirement for comparing management actions
 * (HOLD vs. CLOSE vs. ROLL vs. SELL_CC, etc.) at time t.
 *
 * Two economically DIFFERENT quantities must never be merged into one
 * number:
 *   - SUNK economics: option/stock P&L already realized before t. This is
 *     immutable accounting history (a roll's old leg, a prior partial close,
 *     dividends/fees already booked). It happened; no action taken NOW can
 *     change it.
 *   - FORWARD CONTINUATION economics: the cash-flow effect of an action
 *     taken AT t, computed only from quantities observable at t (current
 *     mark-to-close, a candidate's mark-to-open). It says nothing about what
 *     already happened.
 *
 * A policy that adds sunk P&L into a forward action's utility is double
 * counting the same premium twice (once when it was originally collected,
 * again when comparing what to do next) -- this module exists so that
 * mistake is structurally impossible to make silently: `sunkRealizedEconomics`
 * and `forwardContinuationCashFlow` are computed by two separate, narrowly
 * scoped functions that never share an input field.
 */

export interface SunkEconomicsInputs {
  readonly realizedOptionPnl: number;
  readonly realizedStockPnl: number;
  readonly dividends: number;
  readonly fees: number | null;
}

/**
 * Immutable, already-booked economics. Returns null (never a partial or
 * fabricated number) when fees are unknown -- an unknown fee cannot be
 * silently treated as zero.
 */
export function sunkRealizedEconomics(inputs: SunkEconomicsInputs): number | null {
  if (inputs.fees === null) return null;
  return inputs.realizedOptionPnl + inputs.realizedStockPnl + inputs.dividends - inputs.fees;
}

export interface ForwardContinuationInputs {
  /** Known dollar cost to close the currently open leg right now (null if unknown/no open leg). */
  readonly closeCostDollars: number | null;
  /** Known dollar credit from opening a new leg right now (null if no candidate/unknown). */
  readonly openCreditDollars: number | null;
}

export interface ForwardContinuationResult {
  readonly netCashFlow: number | null;
  readonly complete: boolean;
  readonly reasons: readonly string[];
}

/**
 * The forward-only cash-flow effect of closing (if applicable) and/or
 * opening (if applicable) at time t. Deliberately accepts ONLY dollar
 * boundaries already computed from current quotes -- it has no access to
 * sunk P&L fields, so it is structurally impossible for a caller to have it
 * silently re-add realized premium into a forward comparison.
 */
export function forwardContinuationCashFlow(inputs: ForwardContinuationInputs): ForwardContinuationResult {
  const { closeCostDollars, openCreditDollars } = inputs;
  if (closeCostDollars === null && openCreditDollars === null) {
    return { netCashFlow: null, complete: false, reasons: ['NO_FORWARD_CASH_FLOW_LEGS_KNOWN'] };
  }
  const netCashFlow = (openCreditDollars ?? 0) - (closeCostDollars ?? 0);
  const reasons: string[] = [];
  if (closeCostDollars !== null) reasons.push(`CLOSE_COST_${closeCostDollars.toFixed(2)}`);
  if (openCreditDollars !== null) reasons.push(`OPEN_CREDIT_${openCreditDollars.toFixed(2)}`);
  return { netCashFlow, complete: true, reasons };
}

export interface CommonHorizonComparison {
  readonly asOf: string;
  /** The furthest-out date any action under comparison could still be open through, used only as a
   * descriptive audit anchor -- never as a forecast of value at that date. */
  readonly horizonAnchor: string | null;
  readonly sunkRealizedPnl: number | null;
  readonly candidateExpirations: readonly string[];
}

/**
 * Builds the shared, descriptive horizon anchor every action in one
 * comparison must be evaluated against -- the furthest expiration date in
 * play (current contract's, plus any roll/CC candidate's). This never
 * projects a value forward to that date; it only records, for audit, that
 * every action's forward cash flow was computed as of the SAME observation
 * time (`asOf`) even though the actions themselves resolve on different
 * calendar dates.
 */
export function buildCommonHorizonComparison(
  asOf: string, sunk: SunkEconomicsInputs, currentExpiration: string | null,
  candidateExpirations: readonly (string | null)[],
): CommonHorizonComparison {
  const known = [currentExpiration, ...candidateExpirations].filter((value): value is string => value !== null);
  const horizonAnchor = known.length === 0 ? null : known.reduce((latest, value) => value > latest ? value : latest);
  return {
    asOf, horizonAnchor, sunkRealizedPnl: sunkRealizedEconomics(sunk),
    candidateExpirations: known,
  };
}
