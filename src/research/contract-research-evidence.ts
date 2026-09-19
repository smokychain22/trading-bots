import type { NormalizedOptionContract } from '../theta/option-contract.js';

export const contractResearchEvidenceVersion = 'theta-contract-research-evidence-v1' as const;

/**
 * Research/shadow only. `brokerAuthority: false` always. This module never
 * replaces or feeds `canonical-strategy-frontier.ts`'s own selection --
 * it is an ENRICHMENT layer: a typed, UNKNOWN-safe research record per
 * contract (per directive "Contract / expiration / strike research
 * evidence"), plus two comparators (expiration, strike) that name their
 * own reasons rather than collapsing into one opaque score, mirroring the
 * conservative-dominance pattern already used three times in this
 * codebase (`canonical-strategy-frontier.ts`'s `dominates()`,
 * `strategy-quality-shadow-diagnostics.ts`'s `economicallyDominates()`,
 * `underlying-selection-shadow.ts`'s `dominates()`).
 *
 * Fields with NO source on `NormalizedOptionContract` today (skew, term
 * structure, expected-move distance, ownership quality, AEGIS result,
 * event distance) are accepted as OPTIONAL, explicitly-labeled caller
 * inputs -- this module does not guess an extraction path into the
 * opaque Optionomics context blob (per the standing "do not guess
 * Optionomics JSON paths" rule); a caller who already has a typed value
 * from `optionomics-feature-engine.ts` passes it through honestly.
 */
export interface ContractResearchEvidence {
  readonly contractVersion: typeof contractResearchEvidenceVersion;
  readonly underlying: string;
  readonly optionSymbol: string;
  readonly occSymbol: string | null;
  readonly optionType: 'CALL' | 'PUT';
  readonly expiration: string;
  readonly dte: number;
  readonly strike: number;
  readonly delta: number | null;
  readonly premiumPerShare: number | null;
  readonly bid: number | null;
  readonly ask: number | null;
  readonly midReference: number | null;
  readonly spreadPct: number | null;
  readonly impliedVolatility: number | null;
  /** Caller-supplied, UNKNOWN unless the caller already has a typed value
   * (e.g. from `optionomics-feature-engine.ts`'s `skew: FeatureValue<number>`). */
  readonly skew: number | null;
  readonly termStructure: number | null;
  readonly expectedMoveDistance: number | null;
  readonly breakEven: number | null;
  readonly moneyness: number | null;
  readonly capitalRequired: number | null;
  readonly capitalDays: number | null;
  /** Days to the nearest known event (earnings/ex-dividend/other); `null`
   * = UNKNOWN, never assumed absent. */
  readonly eventDistanceDays: number | null;
  readonly openInterest: number | null;
  readonly volume: number | null;
  readonly assignmentCapacityQty: number | null;
  readonly ownershipQualityScore: number | null;
  readonly aegisResult: string | null;
  /** Count of the caller-declared fields above that are `null` (UNKNOWN) --
   * a transparent uncertainty signal, never itself a hidden penalty. */
  readonly uncertaintyCount: number;
  readonly brokerAuthority: false;
}

function finite(value: number | null): value is number {
  return value !== null && Number.isFinite(value);
}

/**
 * Assembles one contract's research evidence from the ALREADY-COMPUTED
 * `NormalizedOptionContract` (bid/ask/Greeks/moneyness/breakEven all read,
 * never recomputed) plus caller-supplied context this module has no
 * source for on its own. `premiumPerShare` uses the conservative bid side
 * (matching the convention already established everywhere else in this
 * codebase for a short-option premium reference) -- callers pricing a
 * long leg must supply their own premium reference via `capitalRequired`
 * and not rely on this field's sign convention.
 */
export function buildContractResearchEvidence(input: {
  readonly contract: NormalizedOptionContract;
  readonly capitalDays?: number | null;
  readonly skew?: number | null;
  readonly termStructure?: number | null;
  readonly expectedMoveDistance?: number | null;
  readonly eventDistanceDays?: number | null;
  readonly assignmentCapacityQty?: number | null;
  readonly ownershipQualityScore?: number | null;
  readonly aegisResult?: string | null;
}): ContractResearchEvidence {
  const contract = input.contract;
  const premiumPerShare = finite(contract.bid) ? contract.bid : null;
  const capitalRequired = contract.optionType === 'PUT' ? contract.strike * contract.multiplier : null;
  const optional = [
    input.skew ?? null, input.termStructure ?? null, input.expectedMoveDistance ?? null,
    input.eventDistanceDays ?? null, input.ownershipQualityScore ?? null, input.aegisResult ?? null,
    contract.iv, contract.delta, contract.openInterest, contract.volume, contract.spreadPct,
  ];
  return {
    contractVersion: contractResearchEvidenceVersion, underlying: contract.underlying, optionSymbol: contract.optionSymbol,
    occSymbol: contract.occSymbol, optionType: contract.optionType, expiration: contract.expiration, dte: contract.dte,
    strike: contract.strike, delta: contract.delta, premiumPerShare, bid: contract.bid, ask: contract.ask,
    midReference: contract.midpointReference, spreadPct: contract.spreadPct, impliedVolatility: contract.iv,
    skew: input.skew ?? null, termStructure: input.termStructure ?? null, expectedMoveDistance: input.expectedMoveDistance ?? null,
    breakEven: contract.breakEven, moneyness: contract.moneyness, capitalRequired,
    capitalDays: input.capitalDays ?? null, eventDistanceDays: input.eventDistanceDays ?? null,
    openInterest: contract.openInterest, volume: contract.volume,
    assignmentCapacityQty: input.assignmentCapacityQty ?? null, ownershipQualityScore: input.ownershipQualityScore ?? null,
    aegisResult: input.aegisResult ?? null, uncertaintyCount: optional.filter((value) => value === null).length,
    brokerAuthority: false,
  };
}

// ---------------------------------------------------------------------
// Expiration comparator
// ---------------------------------------------------------------------

export interface ExpirationBucket {
  readonly expiration: string;
  readonly dte: number;
  readonly contractCount: number;
  readonly totalPremium: number | null;
  readonly meanCapitalDays: number | null;
  /** theta/gamma PROXIES only -- the mean of the contracts' own raw Greeks
   * in this bucket, never a fabricated exposure model. `null` when no
   * contract in the bucket has a known theta/gamma. */
  readonly thetaProxy: number | null;
  readonly gammaProxy: number | null;
  readonly meanTermStructure: number | null;
  readonly nearestEventDistanceDays: number | null;
  readonly meanSpreadPct: number | null;
  readonly meanAssignmentCapacityQty: number | null;
}

function meanOf(values: readonly (number | null)[]): number | null {
  const known = values.filter(finite);
  return known.length === 0 ? null : known.reduce((sum, value) => sum + value, 0) / known.length;
}
function sumOrNull(values: readonly (number | null)[]): number | null {
  return values.length > 0 && values.every(finite) ? (values as readonly number[]).reduce((sum, value) => sum + value, 0) : null;
}

export function buildExpirationBuckets(
  evidence: readonly ContractResearchEvidence[],
  greeksByOptionSymbol: ReadonlyMap<string, { readonly theta: number | null; readonly gamma: number | null }>,
): readonly ExpirationBucket[] {
  const byExpiration = new Map<string, ContractResearchEvidence[]>();
  for (const item of evidence) byExpiration.set(item.expiration, [...(byExpiration.get(item.expiration) ?? []), item]);
  return [...byExpiration.entries()].map(([expiration, items]): ExpirationBucket => ({
    expiration, dte: items[0]?.dte ?? 0, contractCount: items.length,
    totalPremium: sumOrNull(items.map((item) => item.premiumPerShare)),
    meanCapitalDays: meanOf(items.map((item) => item.capitalDays)),
    thetaProxy: meanOf(items.map((item) => greeksByOptionSymbol.get(item.optionSymbol)?.theta ?? null)),
    gammaProxy: meanOf(items.map((item) => greeksByOptionSymbol.get(item.optionSymbol)?.gamma ?? null)),
    meanTermStructure: meanOf(items.map((item) => item.termStructure)),
    nearestEventDistanceDays: (() => {
      const known = items.map((item) => item.eventDistanceDays).filter(finite);
      return known.length === 0 ? null : Math.min(...known);
    })(),
    meanSpreadPct: meanOf(items.map((item) => item.spreadPct)),
    meanAssignmentCapacityQty: meanOf(items.map((item) => item.assignmentCapacityQty)),
  })).toSorted((a, b) => a.dte - b.dte);
}

export interface ExpirationComparisonReason {
  readonly dimension: 'totalPremium' | 'meanCapitalDays' | 'thetaProxy' | 'meanTermStructure' | 'nearestEventDistanceDays' | 'meanSpreadPct';
  readonly aValue: number;
  readonly bValue: number;
  readonly aIsBetter: boolean;
}

/**
 * "WHY expiration X over Y?" -- returns the exact named dimensions that
 * differ, each labeled with which side is better, rather than a single
 * unexplained score. No universal DTE rule: this function does not rank
 * or pick a winner, it only reports comparable facts.
 */
export function compareExpirations(a: ExpirationBucket, b: ExpirationBucket): readonly ExpirationComparisonReason[] {
  const dims: readonly [ExpirationComparisonReason['dimension'], number | null, number | null, boolean][] = [
    ['totalPremium', a.totalPremium, b.totalPremium, true],
    // Lower capital-days for the SAME premium is generally preferable
    // (less capital tied up per unit time), so lower is "better" here.
    ['meanCapitalDays', a.meanCapitalDays, b.meanCapitalDays, false],
    ['thetaProxy', a.thetaProxy, b.thetaProxy, true],
    ['meanTermStructure', a.meanTermStructure, b.meanTermStructure, true],
    ['nearestEventDistanceDays', a.nearestEventDistanceDays, b.nearestEventDistanceDays, true],
    ['meanSpreadPct', a.meanSpreadPct, b.meanSpreadPct, false],
  ];
  const reasons: ExpirationComparisonReason[] = [];
  for (const [dimension, aValue, bValue, higherIsBetter] of dims) {
    if (!finite(aValue) || !finite(bValue) || aValue === bValue) continue;
    const aIsBetter = higherIsBetter ? aValue > bValue : aValue < bValue;
    reasons.push({ dimension, aValue, bValue, aIsBetter });
  }
  return reasons;
}

// ---------------------------------------------------------------------
// Strike comparator
// ---------------------------------------------------------------------

export interface StrikeComparisonReason {
  readonly dimension: 'premiumPerShare' | 'breakEven' | 'expectedMoveDistance' | 'spreadPct' | 'openInterest' | 'capitalRequired';
  readonly aValue: number;
  readonly bValue: number;
  readonly aIsBetter: boolean;
}

/**
 * Compares two strikes for the SAME expiration/underlying/option type.
 * Never asserts "farther OTM is always better" or converts delta to a
 * probability -- delta is reported as a plain fact
 * (`ContractResearchEvidence.delta`), not itself a comparison dimension
 * here (using it as one would implicitly treat it as a probability-like
 * ranking signal, which the standing rules forbid).
 */
export function compareStrikes(a: ContractResearchEvidence, b: ContractResearchEvidence): readonly StrikeComparisonReason[] {
  if (a.expiration !== b.expiration || a.optionType !== b.optionType || a.underlying !== b.underlying) {
    throw new Error('STRIKE_COMPARISON_REQUIRES_SAME_UNDERLYING_EXPIRATION_AND_OPTION_TYPE');
  }
  const dims: readonly [StrikeComparisonReason['dimension'], number | null, number | null, boolean][] = [
    ['premiumPerShare', a.premiumPerShare, b.premiumPerShare, true],
    // A break-even farther from the current strike toward safety is
    // context-dependent (PUT vs CALL flips the "better" direction) --
    // this module reports the raw comparison only for the same option
    // type, where the direction is at least internally consistent; it
    // does not claim which absolute direction is universally better.
    ['breakEven', a.breakEven, b.breakEven, a.optionType === 'PUT'],
    ['expectedMoveDistance', a.expectedMoveDistance, b.expectedMoveDistance, true],
    ['spreadPct', a.spreadPct, b.spreadPct, false],
    ['openInterest', a.openInterest, b.openInterest, true],
    ['capitalRequired', a.capitalRequired, b.capitalRequired, false],
  ];
  const reasons: StrikeComparisonReason[] = [];
  for (const [dimension, aValue, bValue, higherIsBetter] of dims) {
    if (!finite(aValue) || !finite(bValue) || aValue === bValue) continue;
    const aIsBetter = higherIsBetter ? aValue > bValue : aValue < bValue;
    reasons.push({ dimension, aValue, bValue, aIsBetter });
  }
  return reasons;
}
