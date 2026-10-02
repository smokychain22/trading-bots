import { isModeledCostBasis, type CostBasisKind } from './cost-basis-typing.js';

export const wholeChainEconomicsVersion = 'theta-whole-chain-economics-v2' as const;

const finite = (value: number | null): value is number => typeof value === 'number' && Number.isFinite(value);

/**
 * Formalizes whole-chain economics for a Wheel chain that may have rolled,
 * been assigned, and/or run covered calls. Every named component is kept
 * EXPLICIT (never collapsed early) so a reviewer can see exactly what fed
 * a final number -- prior option losses are never hidden inside a later
 * recovery, and LEG_LEVEL_PNL is always reported alongside WHOLE_CHAIN_PNL,
 * never replaced by it.
 */
export interface WholeChainComponents {
  /** States whether premium/cost legs already use actual broker fill cash flows. */
  readonly cashflowBasis: 'ACTUAL_FILL_CASHFLOW' | 'BENCHMARK_CASHFLOW';
  /** Net credit collected opening the ORIGINAL short put (positive = credit received). */
  readonly initialPutPremium: number | null;
  /** Actual close debits for non-roll put closes, including terminal partial closes. */
  readonly putCloseCosts: number | null;
  /** Sum of gross opening credits across every roll. Old-leg close debits remain separate. */
  readonly rollCredits: number | null;
  /** Sum of all roll closing costs (the OLD leg's close cost at each roll) -- kept separate from
   * rollCredits so a roll's own gross mechanics stay visible, not netted away before this point. */
  readonly rollCloseCosts: number | null;
  /** Strike at which stock was assigned, or null if this chain was never assigned. */
  readonly assignmentStrike: number | null;
  readonly stockSharesAssigned: number;
  /**
   * `null` means UNKNOWN -- no trusted dividend evidence exists for this
   * chain. This is a DIFFERENT state from a real, observed zero (no
   * dividend occurred). Callers must never pass `0` merely because
   * dividend evidence has not been verified -- that would silently
   * convert "we don't know" into "we know it was nothing," corrupting
   * both this leg and (via `computeWholeChainPnl`'s completeness check)
   * the entire whole-chain P&L identity.
   */
  readonly dividends: number | null;
  readonly coveredCallPremium: number | null;
  readonly coveredCallCloseCosts: number | null;
  /** Proceeds from selling the stock outright OR from a call-away (per-share price * shares), or
   * Includes realized partial exits while other shares remain open. Null when unproven or no exit applies. */
  readonly stockSaleOrCallAwayProceeds: number | null;
  /**
   * `null` means UNKNOWN -- no trusted fee evidence exists. See the
   * `dividends` doc comment above; the same UNKNOWN-vs-real-zero
   * distinction applies here, and a genuinely fee-free fill (a real
   * observed `0`) is honestly different from fee evidence that was never
   * verified at all.
   */
  readonly fees: number | null;
  /**
   * Origin of `fees`. Optional for backward compatibility: undefined keeps the
   * historical behavior. When present together with ACTUAL_FILL_CASHFLOW, any
   * basis other than BROKER_ACTUAL_FEE (a modeled cost, a slippage assumption
   * or an unproven actual fee) makes the realized whole-chain P&L UNKNOWN
   * rather than letting a modeled number masquerade as a broker-charged one.
   */
  readonly feeBasis?: CostBasisKind;
  /** Actual execution cost not already present in the supplied cash-flow legs. */
  readonly executionCostNotEmbeddedInCashflows: number | null;
  /** Benchmark shortfall diagnostic only. It never changes realized cash P&L. */
  readonly tcaExecutionShortfall: number | null;
  /** Current mark-to-market stock price, used only for an UNREALIZED component when shares are
   * still held (never treated as realized proceeds). */
  readonly currentStockMarkPerShare: number | null;
  readonly openStockShares: number;
}

export interface EffectiveStockBasisResult {
  readonly contractVersion: typeof wholeChainEconomicsVersion;
  readonly effectiveStockBasisPerShare: number | null;
  readonly complete: boolean;
  readonly missingComponents: readonly string[];
}

/**
 * EffectiveStockBasis = assignmentStrike
 *   - (netPutPremiumRetained / sharesAssigned)
 *   + (fees + executionCostNotEmbeddedInCashflows) / sharesAssigned
 *
 * netPutPremiumRetained = initialPutPremium - putCloseCosts + rollCredits - rollCloseCosts.
 * Returns null (never a partial/fabricated number) when there was no
 * assignment at all, or when any required component is unknown.
 */
export function computeEffectiveStockBasis(components: WholeChainComponents): EffectiveStockBasisResult {
  if (components.assignmentStrike === null || components.stockSharesAssigned <= 0) {
    return {
      contractVersion: wholeChainEconomicsVersion, effectiveStockBasisPerShare: null,
      complete: false, missingComponents: ['NO_ASSIGNMENT_RECORDED'],
    };
  }
  const missingComponents: string[] = [];
  for (const key of ['initialPutPremium', 'putCloseCosts', 'rollCredits', 'rollCloseCosts', 'fees',
    'executionCostNotEmbeddedInCashflows', 'assignmentStrike', 'stockSharesAssigned'] as const) {
    if (!finite(components[key])) missingComponents.push(key);
  }
  if (finite(components.assignmentStrike) && components.assignmentStrike <= 0) missingComponents.push('assignmentStrike:INVALID');
  if (missingComponents.length > 0) {
    return { contractVersion: wholeChainEconomicsVersion, effectiveStockBasisPerShare: null, complete: false, missingComponents };
  }
  const netPutPremiumRetained = (components.initialPutPremium as number) - (components.putCloseCosts as number)
    + (components.rollCredits as number) - (components.rollCloseCosts as number);
  const perShareAdjustment = (netPutPremiumRetained - (components.fees as number)
    - (components.executionCostNotEmbeddedInCashflows as number)) / components.stockSharesAssigned;
  const basis = components.assignmentStrike - perShareAdjustment;
  if (!finite(basis)) return { contractVersion: wholeChainEconomicsVersion, effectiveStockBasisPerShare: null,
    complete: false, missingComponents: ['NONFINITE_DERIVED_BASIS'] };
  return {
    contractVersion: wholeChainEconomicsVersion,
    effectiveStockBasisPerShare: basis,
    complete: true, missingComponents: [],
  };
}

export interface WholeChainPnlLeg {
  readonly label: string;
  readonly amount: number | null;
}

export interface WholeChainPnlBreakdown {
  readonly contractVersion: typeof wholeChainEconomicsVersion;
  readonly legLevelPnl: readonly WholeChainPnlLeg[];
  readonly wholeChainPnl: number | null;
  readonly cashflowBasis: WholeChainComponents['cashflowBasis'];
  readonly tcaExecutionShortfall: number | null;
}

/**
 * Every component is reported as its own named leg, even components that
 * are null (UNKNOWN) -- an unknown leg makes `wholeChainPnl` null (never a
 * partial sum silently missing a piece), while `legLevelPnl` still shows
 * exactly which legs ARE known.
 */
export function computeWholeChainPnl(components: WholeChainComponents): WholeChainPnlBreakdown {
  const legs: WholeChainPnlLeg[] = [
    { label: 'INITIAL_PUT_PREMIUM', amount: components.initialPutPremium },
    { label: 'PUT_CLOSE_COSTS', amount: components.putCloseCosts === null ? null : -components.putCloseCosts },
    { label: 'ROLL_CREDITS', amount: components.rollCredits },
    { label: 'ROLL_CLOSE_COSTS', amount: components.rollCloseCosts === null ? null : -components.rollCloseCosts },
    { label: 'DIVIDENDS', amount: components.dividends },
    { label: 'COVERED_CALL_PREMIUM', amount: components.coveredCallPremium },
    { label: 'COVERED_CALL_CLOSE_COSTS', amount: components.coveredCallCloseCosts === null ? null : -components.coveredCallCloseCosts },
    // components.fees === null means UNKNOWN (no trusted fee evidence) --
    // `-null` would coerce to 0 in JS, silently turning "unknown" into "a
    // real observed zero." The explicit check prevents that.
    { label: 'FEES', amount: components.fees === null ? null : -components.fees },
    { label: 'EXECUTION_COST_NOT_EMBEDDED_IN_CASHFLOWS', amount: components.executionCostNotEmbeddedInCashflows === null
      ? null : -components.executionCostNotEmbeddedInCashflows },
  ];
  // A partially exited inventory has BOTH realized and unrealized legs.
  // Allocation of acquisition cost must conserve the assigned share count.
  const validShares = finite(components.stockSharesAssigned) && finite(components.openStockShares)
    && components.stockSharesAssigned >= 0 && components.openStockShares >= 0
    && components.openStockShares <= components.stockSharesAssigned;
  if (!validShares) legs.push({ label: 'STOCK_SHARE_IDENTITY_INVALID', amount: null });
  if (components.openStockShares > 0) {
    const unrealizedStockMtm = components.currentStockMarkPerShare !== null && components.assignmentStrike !== null
      ? (components.currentStockMarkPerShare - components.assignmentStrike) * components.openStockShares : null;
    legs.push({ label: 'UNREALIZED_STOCK_MTM', amount: unrealizedStockMtm });
  }
  if (validShares && components.stockSharesAssigned > components.openStockShares) {
    // Shares were assigned at some point and are no longer held. The
    // ACQUISITION cost paid at assignment (assignmentStrike * shares) is a
    // real, distinct cash outflow that must be netted against the sale/
    // call-away proceeds here -- reporting raw proceeds alone would count
    // the money received for the stock while silently forgetting the money
    // paid to acquire it in the first place (a confirmed defect found by
    // review: a $19,500 acquisition was previously omitted entirely,
    // inflating whole-chain P&L by exactly that amount). This leg is the
    // stock position's own realized P&L, not its gross proceeds.
    const exitedShares = components.stockSharesAssigned - components.openStockShares;
    const stockPnl = !finite(components.stockSaleOrCallAwayProceeds) || !finite(components.assignmentStrike)
      ? null : components.stockSaleOrCallAwayProceeds - components.assignmentStrike * exitedShares;
    legs.push({ label: 'STOCK_PNL_AT_SALE_OR_CALL_AWAY', amount: stockPnl });
  }
  if (components.cashflowBasis === 'ACTUAL_FILL_CASHFLOW' && components.feeBasis !== undefined
    && (isModeledCostBasis(components.feeBasis) || components.feeBasis === 'UNKNOWN_ACTUAL_FEE')) {
    legs.push({ label: `FEE_BASIS_NOT_BROKER_ACTUAL:${components.feeBasis}`, amount: null });
  }
  const normalizedLegs = legs.map(leg => ({ ...leg, amount: finite(leg.amount) ? leg.amount : null }));
  const sum = normalizedLegs.some(leg => leg.amount === null) ? null
    : normalizedLegs.reduce((total, leg) => total + (leg.amount as number), 0);
  const wholeChainPnl = finite(sum) ? sum : null;
  return { contractVersion: wholeChainEconomicsVersion, legLevelPnl: normalizedLegs, wholeChainPnl,
    cashflowBasis:components.cashflowBasis,tcaExecutionShortfall:components.tcaExecutionShortfall };
}
