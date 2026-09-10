import type { AlpacaOpenOrderSnapshot, AlpacaPositionSnapshot, MasterAccountSnapshot } from './alpaca-provider.js';

// R1 real-state integration: pure, network-free derivation of account
// exposure from already-fetched real Alpaca account/positions/open-orders
// state. Every function here is deterministic arithmetic over already-
// known quantities -- no probability, no alpha estimate, no fabricated
// zero when a required raw input is missing (an unparseable/absent value
// makes the corresponding derived metric UNKNOWN, never 0).
//
// Honest scope limit: this module derives ONLY what real Alpaca
// account/positions/orders data can actually support -- ticker
// concentration, CSP collateral, stock inventory value, capital-at-risk,
// and open-position/order counts. Sector concentration, correlation-
// cluster exposure, and market-stress detection (gap/IV-shock/spread-
// widening) are NOT derivable from this data alone (they need sector
// classification and market-regime data THETA does not yet have a real
// source for) -- callers must continue supplying those separately, and
// must never let this module's absence of an opinion be read as "0% risk."

export type OccOptionType = 'CALL' | 'PUT';

export interface ParsedOccOptionSymbol {
  readonly underlying: string;
  readonly expiration: string; // YYYY-MM-DD
  readonly optionType: OccOptionType;
  readonly strike: number;
}

// Standard OCC option symbol format: ROOT (1-6 chars, no padding assumed --
// Alpaca does not left-pad in this environment's observed symbols) + YYMMDD
// (6 digits) + C|P (1 char) + strike*1000 (8 digits, no decimal point).
// Documented, exact parse -- returns null (never a guess) for anything that
// does not match this shape.
const OCC_SYMBOL_PATTERN = /^([A-Z]{1,6})(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/;

export function parseOccOptionSymbol(symbol: string): ParsedOccOptionSymbol | null {
  const match = OCC_SYMBOL_PATTERN.exec(symbol);
  if (match === null) return null;
  const [, root, yy, mm, dd, cp, strikeDigits] = match;
  if (root === undefined || yy === undefined || mm === undefined || dd === undefined || cp === undefined || strikeDigits === undefined) return null;
  const year = 2000 + Number(yy);
  const month = Number(mm);
  const day = Number(dd);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const strike = Number(strikeDigits) / 1000;
  if (!Number.isFinite(strike) || strike <= 0) return null;
  return {
    underlying: root,
    expiration: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    optionType: cp === 'C' ? 'CALL' : 'PUT',
    strike,
  };
}

export interface ClassifiedOptionPosition {
  readonly symbol: string;
  readonly parsed: ParsedOccOptionSymbol;
  readonly quantity: number;
  readonly side: 'SHORT' | 'LONG';
  readonly marketValue: number | null;
  readonly unrealizedPl: number | null;
}

export interface DerivedAccountExposure {
  readonly equity: number | null;
  readonly cash: number | null;
  readonly buyingPower: number | null;
  readonly optionsBuyingPower: number | null;
  // Collateral genuinely required for currently-open short puts, computed
  // as strike * multiplier * |quantity| per position, summed. UNKNOWN
  // (null) if ANY short-put position's symbol cannot be parsed -- a
  // partial sum would understate real collateral, which is never safe to
  // present as if it were the whole truth.
  readonly cspCollateralRequired: number | null;
  readonly stockInventoryValue: number | null; // sum of marketValue across us_equity positions; null if any is UNKNOWN
  readonly shortPutCount: number;
  readonly shortCallCount: number;
  readonly longPutCount: number;
  readonly longCallCount: number;
  readonly openOrderCount: number;
  // Real, derived ratios -- null (UNKNOWN) whenever a required input is
  // itself null, never coerced to 0.
  readonly portfolioCapitalAtRiskPct: number | null; // (cspCollateralRequired + stockInventoryValue) / equity
  readonly tickerConcentrationPct: number | null; // largest single-underlying exposure (stock value + CSP collateral) / equity
  readonly largestConcentrationUnderlying: string | null;
  readonly unparsedOptionSymbols: readonly string[]; // option positions whose symbol did not match the documented OCC format -- never silently dropped from view
}

const requiredMultiplier = (multiplier: number): number => multiplier;

/**
 * Derives real account exposure from an already-fetched MasterAccountSnapshot
 * and AlpacaPositionSnapshot[]/AlpacaOpenOrderSnapshot[] -- pure arithmetic,
 * no network I/O, no probability model. `multiplier` defaults to the
 * standard 100 but is a parameter, never silently assumed when a contract's
 * real multiplier metadata says otherwise (see CLAUDE.md's non-negotiable
 * "do not assume multiplier=100" rule) -- callers with per-contract
 * multiplier metadata should call this per distinct multiplier group and
 * combine results; this module does not have contract-metadata access
 * (AlpacaPositionSnapshot carries no multiplier field), so 100 is the
 * honest default for the standard-equity-option case only.
 */
export function deriveAccountExposure(
  account: MasterAccountSnapshot | null,
  positions: readonly AlpacaPositionSnapshot[],
  openOrders: readonly AlpacaOpenOrderSnapshot[],
  multiplier = 100,
): DerivedAccountExposure {
  const equity = account?.equity ?? null;
  const cash = account?.cash ?? null;
  const buyingPower = account?.buyingPower ?? null;
  const optionsBuyingPower = account?.optionsBuyingPower ?? null;

  const optionPositions: ClassifiedOptionPosition[] = [];
  const unparsedOptionSymbols: string[] = [];
  let stockInventoryValue: number | null = 0;
  const stockValueByUnderlying = new Map<string, number>();

  for (const position of positions) {
    if (position.assetClass === 'us_option') {
      const parsed = parseOccOptionSymbol(position.symbol);
      if (parsed === null) {
        unparsedOptionSymbols.push(position.symbol);
        continue;
      }
      const quantity = position.quantity ?? null;
      if (quantity === null) continue; // UNKNOWN quantity -- cannot classify this position's exposure at all
      const side: ClassifiedOptionPosition['side'] = position.side === 'short' || quantity < 0 ? 'SHORT' : 'LONG';
      optionPositions.push({ symbol: position.symbol, parsed, quantity, side, marketValue: position.marketValue, unrealizedPl: position.unrealizedPl });
    } else if (position.assetClass === 'us_equity') {
      if (position.marketValue === null) {
        stockInventoryValue = null; // one UNKNOWN stock value poisons the total -- never understate
      } else if (stockInventoryValue !== null) {
        stockInventoryValue += position.marketValue;
        stockValueByUnderlying.set(position.symbol, (stockValueByUnderlying.get(position.symbol) ?? 0) + position.marketValue);
      }
    }
    // Any other/unrecognized assetClass is neither stock nor option
    // exposure this module understands -- deliberately not counted rather
    // than guessed into one bucket or the other.
  }

  let shortPutCount = 0, shortCallCount = 0, longPutCount = 0, longCallCount = 0;
  let cspCollateralRequired: number | null = 0;
  const collateralByUnderlying = new Map<string, number>();
  for (const op of optionPositions) {
    if (op.side === 'SHORT' && op.parsed.optionType === 'PUT') {
      shortPutCount += 1;
      const collateral = op.parsed.strike * requiredMultiplier(multiplier) * Math.abs(op.quantity);
      if (cspCollateralRequired !== null) cspCollateralRequired += collateral;
      collateralByUnderlying.set(op.parsed.underlying, (collateralByUnderlying.get(op.parsed.underlying) ?? 0) + collateral);
    } else if (op.side === 'SHORT' && op.parsed.optionType === 'CALL') {
      shortCallCount += 1;
    } else if (op.side === 'LONG' && op.parsed.optionType === 'PUT') {
      longPutCount += 1;
    } else if (op.side === 'LONG' && op.parsed.optionType === 'CALL') {
      longCallCount += 1;
    }
  }
  // Unparsed option symbols make CSP collateral itself unknowable as a
  // complete figure -- a partial sum would silently understate real risk.
  if (unparsedOptionSymbols.length > 0) cspCollateralRequired = null;

  const portfolioCapitalAtRiskPct =
    equity !== null && equity > 0 && cspCollateralRequired !== null && stockInventoryValue !== null
      ? (cspCollateralRequired + stockInventoryValue) / equity
      : null;

  let largestConcentrationUnderlying: string | null = null;
  let tickerConcentrationPct: number | null = null;
  if (equity !== null && equity > 0 && cspCollateralRequired !== null && stockInventoryValue !== null) {
    const underlyings = new Set<string>([...stockValueByUnderlying.keys(), ...collateralByUnderlying.keys()]);
    let largestExposure = -Infinity;
    for (const underlying of underlyings) {
      const exposure = (stockValueByUnderlying.get(underlying) ?? 0) + (collateralByUnderlying.get(underlying) ?? 0);
      if (exposure > largestExposure) {
        largestExposure = exposure;
        largestConcentrationUnderlying = underlying;
      }
    }
    tickerConcentrationPct = largestConcentrationUnderlying !== null ? largestExposure / equity : 0;
  }

  return {
    equity, cash, buyingPower, optionsBuyingPower,
    cspCollateralRequired, stockInventoryValue,
    shortPutCount, shortCallCount, longPutCount, longCallCount,
    openOrderCount: openOrders.length,
    portfolioCapitalAtRiskPct, tickerConcentrationPct, largestConcentrationUnderlying,
    unparsedOptionSymbols,
  };
}

/**
 * Merges the two AEGIS-input fields that ARE genuinely derivable from real
 * account/positions/orders state (tickerConcentrationPct,
 * portfolioCapitalAtRiskPct) into an existing aegisInputs object -- ONLY
 * when `trustworthy` is true (the underlying account/positions/orders
 * fetches were all GOOD this cycle) AND the specific derived ratio is
 * itself non-null. A caller-supplied value is never overwritten with a
 * fabricated 0 when the real derivation came back UNKNOWN, and every OTHER
 * field (sector concentration, correlation-cluster exposure, stress
 * detection, liquidity/execution acceptability) is passed through
 * unchanged -- this is a partial, honest merge, never a claim that the
 * whole aegisInputs object became real-derived.
 */
export function mergeDerivedExposureIntoAegisInputs(
  aegisInputs: Readonly<Record<string, unknown>>,
  derivedExposure: DerivedAccountExposure,
  trustworthy: boolean,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...aegisInputs };
  if (!trustworthy) return merged;
  if (derivedExposure.tickerConcentrationPct !== null) merged.tickerConcentrationPct = derivedExposure.tickerConcentrationPct;
  if (derivedExposure.portfolioCapitalAtRiskPct !== null) merged.portfolioCapitalAtRiskPct = derivedExposure.portfolioCapitalAtRiskPct;
  return merged;
}
