export const wholeChainEconomicsVersion = 'theta-whole-chain-economics-v1' as const;

/**
 * Formalizes whole-chain economics for a Wheel chain that may have rolled,
 * been assigned, and/or run covered calls. Every named component is kept
 * EXPLICIT (never collapsed early) so a reviewer can see exactly what fed
 * a final number -- prior option losses are never hidden inside a later
 * recovery, and LEG_LEVEL_PNL is always reported alongside WHOLE_CHAIN_PNL,
 * never replaced by it.
 */
export interface WholeChainComponents {
  /** Net credit collected opening the ORIGINAL short put (positive = credit received). */
  readonly initialPutPremium: number | null;
  /** Sum of all roll opening credits across every roll in this chain (each roll's own net-credit,
   * already computed via forwardContinuationCashFlow at the time it happened -- never re-derived here). */
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
   * null if the stock (or a covered-call obligation on it) is still open. */
  readonly stockSaleOrCallAwayProceeds: number | null;
  /**
   * `null` means UNKNOWN -- no trusted fee evidence exists. See the
   * `dividends` doc comment above; the same UNKNOWN-vs-real-zero
   * distinction applies here, and a genuinely fee-free fill (a real
   * observed `0`) is honestly different from fee evidence that was never
   * verified at all.
   */
  readonly fees: number | null;
  readonly slippage: number | null;
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
 *   + (fees + slippage) / sharesAssigned
 *
 * netPutPremiumRetained = initialPutPremium + rollCredits - rollCloseCosts.
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
  if (components.initialPutPremium === null) missingComponents.push('initialPutPremium');
  if (components.rollCredits === null) missingComponents.push('rollCredits');
  if (components.rollCloseCosts === null) missingComponents.push('rollCloseCosts');
  if (components.fees === null) missingComponents.push('fees');
  if (components.slippage === null) missingComponents.push('slippage');
  if (missingComponents.length > 0) {
    return { contractVersion: wholeChainEconomicsVersion, effectiveStockBasisPerShare: null, complete: false, missingComponents };
  }
  const netPutPremiumRetained = (components.initialPutPremium as number)
    + (components.rollCredits as number) - (components.rollCloseCosts as number);
  const perShareAdjustment = (netPutPremiumRetained - (components.fees as number) - (components.slippage as number)) / components.stockSharesAssigned;
  return {
    contractVersion: wholeChainEconomicsVersion,
    effectiveStockBasisPerShare: components.assignmentStrike - perShareAdjustment,
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
    { label: 'ROLL_CREDITS', amount: components.rollCredits },
    { label: 'ROLL_CLOSE_COSTS', amount: components.rollCloseCosts === null ? null : -components.rollCloseCosts },
    { label: 'DIVIDENDS', amount: components.dividends },
    { label: 'COVERED_CALL_PREMIUM', amount: components.coveredCallPremium },
    { label: 'COVERED_CALL_CLOSE_COSTS', amount: components.coveredCallCloseCosts === null ? null : -components.coveredCallCloseCosts },
    // components.fees === null means UNKNOWN (no trusted fee evidence) --
    // `-null` would coerce to 0 in JS, silently turning "unknown" into "a
    // real observed zero." The explicit check prevents that.
    { label: 'FEES', amount: components.fees === null ? null : -components.fees },
    { label: 'SLIPPAGE', amount: components.slippage === null ? null : -components.slippage },
  ];
  // The stock leg is EITHER still-open (an unrealized mark) OR closed (sale/
  // call-away proceeds) -- never both, and the leg that does not apply is
  // omitted entirely rather than reported as a fabricated zero or a
  // spurious "unknown" that would poison an otherwise-complete sum.
  if (components.openStockShares > 0) {
    const unrealizedStockMtm = components.currentStockMarkPerShare !== null && components.assignmentStrike !== null
      ? (components.currentStockMarkPerShare - components.assignmentStrike) * components.openStockShares : null;
    legs.push({ label: 'UNREALIZED_STOCK_MTM', amount: unrealizedStockMtm });
  } else if (components.assignmentStrike !== null) {
    // Shares were assigned at some point and are no longer held. The
    // ACQUISITION cost paid at assignment (assignmentStrike * shares) is a
    // real, distinct cash outflow that must be netted against the sale/
    // call-away proceeds here -- reporting raw proceeds alone would count
    // the money received for the stock while silently forgetting the money
    // paid to acquire it in the first place (a confirmed defect found by
    // review: a $19,500 acquisition was previously omitted entirely,
    // inflating whole-chain P&L by exactly that amount). This leg is the
    // stock position's own realized P&L, not its gross proceeds.
    const stockPnl = components.stockSaleOrCallAwayProceeds === null ? null
      : components.stockSaleOrCallAwayProceeds - components.assignmentStrike * components.stockSharesAssigned;
    legs.push({ label: 'STOCK_PNL_AT_SALE_OR_CALL_AWAY', amount: stockPnl });
  }
  const anyUnknown = legs.some((leg) => leg.amount === null);
  const wholeChainPnl = anyUnknown ? null : legs.reduce((sum, leg) => sum + (leg.amount as number), 0);
  return { contractVersion: wholeChainEconomicsVersion, legLevelPnl: legs, wholeChainPnl };
}
