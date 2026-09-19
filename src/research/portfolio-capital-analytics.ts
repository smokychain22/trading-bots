/**
 * Research/shadow only. `brokerAuthority: false` always. This module owns
 * NO risk, sizing, or allocation authority of any kind -- it never reports
 * RISK_APPROVED/OPEN_MORE/REDUCE_POSITION/BEST_TICKER/OPTIMAL_SIZE, never
 * gates an order, and never recomputes broker buying power. AEGIS
 * (`src/theta/aegis-contract.ts`, `src/theta/aegis-derivation.ts`) remains
 * Production's sole risk/concentration authority; `src/theta/account-
 * exposure.ts`'s `deriveAccountExposure` remains the canonical single-
 * snapshot collateral/exposure/concentration derivation. This module is a
 * pure DESCRIPTIVE STATISTICS layer that answers "how was capital
 * deployed, concentrated, and occupied over time" from an already-
 * assembled, caller-supplied portfolio snapshot -- it recomputes no
 * collateral/max-loss formula (those are computed once, upstream, by
 * `canonical-strategy-frontier.ts`/`defined-risk-economics.ts`/`account-
 * exposure.ts`, and simply labeled with a capital CATEGORY here).
 *
 * Every position is assigned to exactly ONE mutually-exclusive capital
 * category, so summed totals never double-count the same dollars. In
 * particular (per the standing "avoid double-counting covered stock"
 * rule): held stock is always `STOCK_INVENTORY_CAPITAL` regardless of
 * whether it is currently uncovered, in `RECOVERY_WAIT`, or covered by an
 * open call -- `stockLifecycleState` is a state TAG on that one capital
 * figure, never a second dollar commitment.
 *
 * `capitalDays` follows the existing canonical "dollars x days" definition
 * already documented by `capitalDaysLabel`/`returnPerCapitalDayLabel` in
 * `r6-outcome-labels.ts` (this module does not import those label
 * wrappers -- they label a single resolved chain's already-known value,
 * this module aggregates many still-open positions' capital x days-to-
 * date -- but the underlying unit/definition is identical and must never
 * be redefined differently here).
 */
export const portfolioCapitalAnalyticsVersion = 'theta-portfolio-capital-analytics-v1' as const;

export type PortfolioCapitalCategory =
  | 'PUT_COLLATERAL'
  | 'ASSIGNMENT_RESERVED_CAPITAL'
  | 'DEFINED_RISK_MAX_LOSS_CAPITAL'
  | 'STOCK_INVENTORY_CAPITAL'
  | 'PENDING_ORDER_RESERVE'
  | 'OTHER_KNOWN_COMMITMENT';

export type StockLifecycleState = 'PLAIN_HOLDING' | 'RECOVERY_WAIT' | 'CC_COVERED';

export interface PortfolioCapitalPositionRecord {
  /** One canonical economic capital commitment, not one raw option leg.
   * Multi-leg structures must arrive already aggregated to their canonical
   * maximum-loss capital so this layer cannot count both legs separately. */
  /** Canonical broker/position identity used for deduplication. A duplicate
   * `positionId` in the same snapshot is a structural data-integrity
   * failure and is rejected (thrown), never silently summed. */
  readonly positionId: string;
  readonly chainId: string | null;
  readonly underlying: string;
  readonly strategy: string | null;
  readonly category: PortfolioCapitalCategory;
  /** Required (non-null) if and only if `category === 'STOCK_INVENTORY_CAPITAL'`.
   * Any other category must carry `null` here -- this field is a state tag
   * on stock capital, never an independent capital commitment. */
  readonly stockLifecycleState: StockLifecycleState | null;
  /** Dollars committed by this position, in this category's own units.
   * Caller-computed (e.g. from `deriveAccountExposure`, `canonical-
   * strategy-frontier.ts`, or `defined-risk-economics.ts`) -- never
   * re-derived by this module. Non-finite or negative values are treated
   * as UNKNOWN (excluded from totals, counted separately), never coerced
   * to zero or thrown away silently. */
  readonly capitalAmount: number | null;
  /** Days this capital has been committed as of the snapshot. Same
   * UNKNOWN-safe treatment as `capitalAmount`. */
  readonly daysOccupied: number | null;
  readonly sectorOrGroup: string | null;
}

export interface PortfolioCapitalSnapshotInput {
  readonly snapshotId: string;
  readonly asOf: string;
  readonly accountEquity: number | null;
  readonly cash: number | null;
  /** Broker-reported truth only. Never reconstructed from a guessed
   * margin formula when unavailable -- reported as `null` (UNKNOWN). */
  readonly buyingPower: number | null;
  readonly positions: readonly PortfolioCapitalPositionRecord[];
}

export interface CapitalCategoryBreakdownEntry {
  readonly category: PortfolioCapitalCategory;
  readonly positionCount: number;
  readonly knownCapitalAmountCount: number;
  readonly unknownCapitalAmountCount: number;
  /** Sum of known rows only. A category with no rows is a known zero.
   * Use the known/unknown counts to determine whether a non-empty category
   * total is complete. */
  readonly totalCapital: number | null;
}

export interface CapitalConcentrationEntry {
  readonly key: string;
  readonly capital: number;
  readonly positionCount: number;
  /** `capital / totalKnownCommittedCapital`. `null` when the denominator
   * is unknown or zero -- never a fabricated share. */
  readonly shareOfKnownCommittedCapital: number | null;
}

export interface PortfolioCapitalSnapshotReport {
  readonly contractVersion: typeof portfolioCapitalAnalyticsVersion;
  readonly snapshotId: string;
  readonly asOf: string;
  readonly brokerAuthority: false;

  readonly accountEquity: number | null;
  readonly cash: number | null;
  readonly buyingPower: number | null;
  /** Account fields rejected as non-finite. Broker values are passed
   * through when finite and are never reconstructed locally. */
  readonly invalidAccountFields: readonly ('accountEquity' | 'cash' | 'buyingPower')[];

  readonly positionCount: number;
  readonly knownChainPositionCount: number;
  readonly unknownChainPositionCount: number;
  readonly knownCapitalPositionCount: number;
  readonly unknownCapitalPositionCount: number;
  readonly capitalAccountingState: 'COMPLETE' | 'PARTIAL' | 'UNKNOWN';
  /** Sum of known `capitalAmount` across every category (mutually
   * exclusive, so never double-counted). `0` for a genuinely empty
   * portfolio (a known fact); `null` when there are positions but none
   * of them carry a known capital amount (nothing known to sum). */
  readonly capitalCommitted: number | null;
  /** Research-only arithmetic estimate: account equity minus the sum of
   * known commitments. This is deliberately not named free capital or
   * buying power. It is reported only when capital accounting is complete
   * and account equity is finite. */
  readonly researchUncommittedEquityEstimate: number | null;
  /** Known committed capital divided by account equity. This is not a
   * broker margin or buying-power utilization ratio. It is reported only
   * when capital accounting is complete and equity is strictly positive. */
  readonly knownCapitalToEquityRatio: number | null;
  readonly researchUncommittedEquityFraction: number | null;

  readonly categoryBreakdown: readonly CapitalCategoryBreakdownEntry[];

  /** Sum of known `capitalAmount * daysOccupied` across every position
   * (any category). A genuinely empty portfolio is known zero. `null` when
   * a non-empty portfolio has no position with both facts known. */
  readonly capitalDaysTotal: number | null;
  readonly knownCapitalDaysPositionCount: number;
  readonly unknownCapitalDaysPositionCount: number;
  readonly capitalDaysAccountingState: 'COMPLETE' | 'PARTIAL' | 'UNKNOWN';
  /** The four fields below are descriptive state/category slices of
   * capitalDaysTotal. They must not be added to capitalDaysTotal or to one
   * another as if they were independent capital commitments. */
  readonly assignmentCapitalDays: number | null;
  readonly recoveryCapitalDays: number | null;
  readonly ccCapitalDays: number | null;
  readonly definedRiskCapitalDays: number | null;

  readonly underlyingConcentration: readonly CapitalConcentrationEntry[];
  readonly strategyConcentration: readonly CapitalConcentrationEntry[];
  /** `null` when no position carries a known `sectorOrGroup` -- absence of
   * sector evidence, not a computed zero. */
  readonly sectorConcentration: readonly CapitalConcentrationEntry[] | null;
  readonly largestUnderlyingCapitalShare: number | null;
}

function finiteNonNegative(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value >= 0;
}

function sumKnown(pairs: readonly (number | null)[]): { total: number | null; knownCount: number } {
  const known = pairs.filter((value): value is number => value !== null && Number.isFinite(value));
  if (known.length === 0) return { total: null, knownCount: 0 };
  const total = known.reduce((sum, value) => sum + value, 0);
  return Number.isFinite(total) ? { total, knownCount: known.length } : { total: null, knownCount: 0 };
}

function sumKnownOrEmptyZero(pairs: readonly (number | null)[]): { total: number | null; knownCount: number } {
  if (pairs.length === 0) return { total: 0, knownCount: 0 };
  return sumKnown(pairs);
}

function buildConcentration(
  rows: readonly { readonly key: string; readonly capital: number }[],
  totalKnownCommittedCapital: number | null,
): readonly CapitalConcentrationEntry[] {
  const byKey = new Map<string, { capital: number; positionCount: number }>();
  for (const row of rows) {
    const existing = byKey.get(row.key) ?? { capital: 0, positionCount: 0 };
    byKey.set(row.key, { capital: existing.capital + row.capital, positionCount: existing.positionCount + 1 });
  }
  return [...byKey.entries()]
    .map(([key, aggregate]) => ({
      key, capital: aggregate.capital, positionCount: aggregate.positionCount,
      shareOfKnownCommittedCapital: totalKnownCommittedCapital !== null && totalKnownCommittedCapital > 0
        ? aggregate.capital / totalKnownCommittedCapital : null,
    }))
    .sort((left, right) => right.capital - left.capital);
}

/**
 * Builds a pure descriptive capital snapshot report. Throws on structural
 * data-integrity violations (duplicate `positionId`, duplicate active
 * `chainId`, or a `stockLifecycleState` that is missing or present on the
 * wrong category) rather than silently deduplicating or guessing -- these
 * represent a caller/broker-feed defect,
 * not a modeled financial state. Implausible per-field values (negative or
 * non-finite `capitalAmount`/`daysOccupied`) are treated as UNKNOWN
 * (excluded from sums, counted separately), never coerced to zero.
 */
export function buildPortfolioCapitalSnapshotReport(input: PortfolioCapitalSnapshotInput): PortfolioCapitalSnapshotReport {
  const seenPositionIds = new Set<string>();
  const seenChainIds = new Set<string>();
  for (const position of input.positions) {
    if (position.positionId.trim().length === 0) {
      throw new Error('PORTFOLIO_CAPITAL_POSITION_ID_REQUIRED');
    }
    if (position.underlying.trim().length === 0) {
      throw new Error(`PORTFOLIO_CAPITAL_UNDERLYING_REQUIRED: ${position.positionId}`);
    }
    if (seenPositionIds.has(position.positionId)) {
      throw new Error(`PORTFOLIO_CAPITAL_DUPLICATE_POSITION_ID: ${position.positionId}`);
    }
    seenPositionIds.add(position.positionId);
    if (position.chainId !== null) {
      if (position.chainId.trim().length === 0) {
        throw new Error(`PORTFOLIO_CAPITAL_CHAIN_ID_INVALID: ${position.positionId}`);
      }
      if (seenChainIds.has(position.chainId)) {
        throw new Error(`PORTFOLIO_CAPITAL_DUPLICATE_ACTIVE_CHAIN_ID: ${position.chainId}`);
      }
      seenChainIds.add(position.chainId);
    }
    const requiresLifecycleState = position.category === 'STOCK_INVENTORY_CAPITAL';
    if (requiresLifecycleState && position.stockLifecycleState === null) {
      throw new Error(`PORTFOLIO_CAPITAL_STOCK_LIFECYCLE_STATE_REQUIRED: ${position.positionId}`);
    }
    if (!requiresLifecycleState && position.stockLifecycleState !== null) {
      throw new Error(`PORTFOLIO_CAPITAL_STOCK_LIFECYCLE_STATE_NOT_APPLICABLE: ${position.positionId}`);
    }
  }

  const validCapitalAmounts = input.positions.map((position) => (finiteNonNegative(position.capitalAmount) ? position.capitalAmount : null));
  const { total: capitalCommitted, knownCount: knownCapitalPositionCount } = sumKnown(validCapitalAmounts);
  const totalCapitalCommitted = input.positions.length === 0 ? 0 : capitalCommitted;
  const unknownCapitalPositionCount = input.positions.length - knownCapitalPositionCount;
  const capitalAccountingState = input.positions.length === 0 || unknownCapitalPositionCount === 0
    ? 'COMPLETE' as const
    : knownCapitalPositionCount === 0 ? 'UNKNOWN' as const : 'PARTIAL' as const;

  const invalidAccountFields: ('accountEquity' | 'cash' | 'buyingPower')[] = [];
  const accountEquity = input.accountEquity !== null && Number.isFinite(input.accountEquity)
    ? input.accountEquity : (input.accountEquity === null ? null : (invalidAccountFields.push('accountEquity'), null));
  const cash = input.cash !== null && Number.isFinite(input.cash)
    ? input.cash : (input.cash === null ? null : (invalidAccountFields.push('cash'), null));
  const buyingPower = input.buyingPower !== null && Number.isFinite(input.buyingPower)
    ? input.buyingPower : (input.buyingPower === null ? null : (invalidAccountFields.push('buyingPower'), null));
  const completeCapitalKnown = capitalAccountingState === 'COMPLETE' && totalCapitalCommitted !== null;
  const researchUncommittedEquityEstimate = accountEquity !== null && completeCapitalKnown
    ? accountEquity - totalCapitalCommitted : null;
  const knownCapitalToEquityRatio = accountEquity !== null && accountEquity > 0 && completeCapitalKnown
    ? totalCapitalCommitted / accountEquity : null;

  const categories: readonly PortfolioCapitalCategory[] = [
    'PUT_COLLATERAL', 'ASSIGNMENT_RESERVED_CAPITAL', 'DEFINED_RISK_MAX_LOSS_CAPITAL',
    'STOCK_INVENTORY_CAPITAL', 'PENDING_ORDER_RESERVE', 'OTHER_KNOWN_COMMITMENT',
  ];
  const categoryBreakdown: CapitalCategoryBreakdownEntry[] = categories.map((category) => {
    const rows = input.positions
      .map((position, index) => ({ position, amount: validCapitalAmounts[index] as number | null }))
      .filter((row) => row.position.category === category);
    const { total, knownCount } = sumKnownOrEmptyZero(rows.map((row) => row.amount));
    return {
      category, positionCount: rows.length, knownCapitalAmountCount: knownCount,
      unknownCapitalAmountCount: rows.length - knownCount, totalCapital: total,
    };
  });

  const capitalDayPairs = input.positions.map((position, index) => {
    const amount = validCapitalAmounts[index] as number | null;
    const days = position.daysOccupied;
    if (amount === null || days === null || !Number.isFinite(days) || days < 0) return { capitalDays: null, position };
    return { capitalDays: amount * days, position };
  });
  const capitalDaysTotal = sumKnownOrEmptyZero(capitalDayPairs.map((row) => row.capitalDays)).total;
  const knownCapitalDaysPositionCount = capitalDayPairs.filter((row) => row.capitalDays !== null).length;
  const unknownCapitalDaysPositionCount = input.positions.length - knownCapitalDaysPositionCount;
  const capitalDaysAccountingState = input.positions.length === 0 || unknownCapitalDaysPositionCount === 0
    ? 'COMPLETE' as const
    : knownCapitalDaysPositionCount === 0 ? 'UNKNOWN' as const : 'PARTIAL' as const;
  const assignmentCapitalDays = sumKnownOrEmptyZero(
    capitalDayPairs.filter((row) => row.position.category === 'ASSIGNMENT_RESERVED_CAPITAL').map((row) => row.capitalDays),
  ).total;
  const recoveryCapitalDays = sumKnownOrEmptyZero(
    capitalDayPairs.filter((row) => row.position.category === 'STOCK_INVENTORY_CAPITAL' && row.position.stockLifecycleState === 'RECOVERY_WAIT')
      .map((row) => row.capitalDays),
  ).total;
  const ccCapitalDays = sumKnownOrEmptyZero(
    capitalDayPairs.filter((row) => row.position.category === 'STOCK_INVENTORY_CAPITAL' && row.position.stockLifecycleState === 'CC_COVERED')
      .map((row) => row.capitalDays),
  ).total;
  const definedRiskCapitalDays = sumKnownOrEmptyZero(
    capitalDayPairs.filter((row) => row.position.category === 'DEFINED_RISK_MAX_LOSS_CAPITAL').map((row) => row.capitalDays),
  ).total;

  const knownCapitalRows = input.positions
    .map((position, index) => ({ position, amount: validCapitalAmounts[index] as number | null }))
    .filter((row): row is { position: PortfolioCapitalPositionRecord; amount: number } => row.amount !== null);

  const underlyingConcentration = buildConcentration(
    knownCapitalRows.map((row) => ({ key: row.position.underlying, capital: row.amount })), totalCapitalCommitted,
  );
  const strategyConcentration = buildConcentration(
    knownCapitalRows.filter((row) => row.position.strategy !== null && row.position.strategy.trim().length > 0)
      .map((row) => ({ key: row.position.strategy as string, capital: row.amount })), totalCapitalCommitted,
  );
  const sectorRows = knownCapitalRows.filter((row) => row.position.sectorOrGroup !== null && row.position.sectorOrGroup.trim().length > 0)
    .map((row) => ({ key: row.position.sectorOrGroup as string, capital: row.amount }));
  const sectorConcentration = sectorRows.length > 0 ? buildConcentration(sectorRows, totalCapitalCommitted) : null;

  const largestUnderlyingCapitalShare = underlyingConcentration[0]?.shareOfKnownCommittedCapital ?? null;

  return {
    contractVersion: portfolioCapitalAnalyticsVersion, snapshotId: input.snapshotId, asOf: input.asOf, brokerAuthority: false,
    accountEquity, cash, buyingPower, invalidAccountFields,
    positionCount: input.positions.length,
    knownChainPositionCount: input.positions.filter((position) => position.chainId !== null).length,
    unknownChainPositionCount: input.positions.filter((position) => position.chainId === null).length,
    knownCapitalPositionCount, unknownCapitalPositionCount, capitalAccountingState,
    capitalCommitted: totalCapitalCommitted, researchUncommittedEquityEstimate, knownCapitalToEquityRatio,
    researchUncommittedEquityFraction: knownCapitalToEquityRatio !== null ? 1 - knownCapitalToEquityRatio : null,
    categoryBreakdown,
    capitalDaysTotal, knownCapitalDaysPositionCount, unknownCapitalDaysPositionCount, capitalDaysAccountingState,
    assignmentCapitalDays, recoveryCapitalDays, ccCapitalDays, definedRiskCapitalDays,
    underlyingConcentration, strategyConcentration, sectorConcentration, largestUnderlyingCapitalShare,
  };
}

/**
 * Composable top-N concentration helper, kept separate from the core
 * snapshot builder so no arbitrary "N" is baked into the report itself.
 * Sorts defensively, then returns `null` when
 * `totalKnownCommittedCapital` (the report's own `capitalCommitted`) is
 * unknown, non-finite, or zero.
 */
export function computeTopNCapitalShare(
  entries: readonly CapitalConcentrationEntry[], n: number, totalKnownCommittedCapital: number | null,
): number | null {
  if (!Number.isInteger(n) || n <= 0) throw new Error('PORTFOLIO_CAPITAL_TOP_N_INVALID');
  if (totalKnownCommittedCapital === null || !Number.isFinite(totalKnownCommittedCapital) || totalKnownCommittedCapital <= 0) return null;
  if (entries.some((entry) => !Number.isFinite(entry.capital) || entry.capital < 0)) {
    throw new Error('PORTFOLIO_CAPITAL_TOP_N_ENTRY_INVALID');
  }
  const topCapital = [...entries].sort((left, right) => right.capital - left.capital)
    .slice(0, n).reduce((sum, entry) => sum + entry.capital, 0);
  return topCapital / totalKnownCommittedCapital;
}

/**
 * Interface-only scaffold for future opportunity-cost research (directive
 * section 15). No implementation exists yet -- computing a real
 * counterfactual requires an alternative candidate that was actually
 * available at time T (e.g. from `canonical-strategy-frontier.ts`'s
 * ranking at that cycle), which this module does not itself source. Any
 * value placed in `hypotheticalOutcome` must be clearly labeled
 * `COUNTERFACTUAL` and must never be reported or treated as a realized
 * fact.
 */
export interface PortfolioOpportunityCostCounterfactualRecord {
  readonly recordType: 'COUNTERFACTUAL';
  readonly chainId: string;
  readonly capitalOccupiedAt: string;
  readonly alternativeCandidateId: string;
  readonly alternativeCandidateAvailableAt: string;
  readonly hypotheticalOutcomeVersion: string;
  readonly hypotheticalNetPnl: number | null;
}
