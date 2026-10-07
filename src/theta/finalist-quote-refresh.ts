import type { NormalizedOptionContract } from './option-contract.js';

export const finalistQuoteRefreshContractVersion = 'theta-finalist-quote-refresh-v1' as const;

export interface FinalistQuoteRefreshPolicy {
  readonly policyVersion: string;
  readonly effectiveAt: string;
  readonly maxFinalists: number;
  readonly maxAgeSeconds: number;
}

export type FinalistQuoteRefreshState =
  | 'REFRESHED'
  | 'INCOMPLETE_PAGINATION'
  | 'MISSING_EXACT_CONTRACT'
  | 'PROVIDER_ERROR';

export interface FinalistQuoteRefreshObservation {
  readonly optionSymbol: string;
  readonly initialProviderTimestamp: string | null;
  readonly initialReceivedAt: string;
  readonly refreshRequestedAt: string;
  readonly refreshReceivedAt: string;
  readonly refreshedProviderTimestamp: string | null;
  readonly state: FinalistQuoteRefreshState;
  readonly sanitizedErrorCode: string | null;
}

export interface FinalistQuoteRefreshReceipt {
  readonly contractVersion: typeof finalistQuoteRefreshContractVersion;
  readonly policyVersion: string;
  readonly candidateBuiltAt: string;
  readonly finalistChosenAt: string;
  readonly decisionAsOf: string;
  readonly initialCandidateCount: number;
  readonly maxFinalists: number;
  readonly selectedCount: number;
  readonly refreshedCount: number;
  readonly failedCount: number;
  readonly observations: readonly FinalistQuoteRefreshObservation[];
  readonly latency: {
    readonly candidateToDecisionMs: number;
    readonly refreshRoundTripMsP50: number | null;
    readonly refreshRoundTripMsP95: number | null;
    readonly initialQuoteAgeAtCandidateSecondsP50: number | null;
    readonly initialQuoteAgeAtCandidateSecondsP95: number | null;
    readonly refreshedQuoteAgeAtDecisionSecondsP50: number | null;
    readonly refreshedQuoteAgeAtDecisionSecondsP95: number | null;
    readonly refreshedQuoteTimestampUnavailableCount: number;
  };
}

export interface ParsedLattice {
  readonly minDte: number | null;
  readonly maxDte: number | null;
  readonly deltaCenters: readonly number[];
  readonly deltaBands: readonly (readonly [number, number])[];
  readonly minOpenInterest: number | null;
  readonly minVolume: number | null;
  readonly maxSpreadPct: number | null;
}

const finiteOrNull = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

export function parseLattice(lattice: Readonly<Record<string, unknown>>): ParsedLattice {
  const minDte = typeof lattice.minDte === 'number' && Number.isFinite(lattice.minDte) ? lattice.minDte : null;
  const maxDte = typeof lattice.maxDte === 'number' && Number.isFinite(lattice.maxDte) ? lattice.maxDte : null;
  const rawBands = Array.isArray(lattice.deltaBands) ? lattice.deltaBands : [];
  const deltaBands = rawBands.flatMap((value): (readonly [number, number])[] => {
    if (!Array.isArray(value) || value.length !== 2) return [];
    const [low, high] = value;
    return typeof low === 'number' && Number.isFinite(low) && typeof high === 'number' && Number.isFinite(high)
      && low >= 0 && high >= low ? [[low, high] as const] : [];
  });
  const deltaCenters = deltaBands.map(([low, high]) => (low + high) / 2);
  return {
    minDte, maxDte, deltaCenters, deltaBands,
    minOpenInterest: finiteOrNull(lattice.minOpenInterest), minVolume: finiteOrNull(lattice.minVolume),
    maxSpreadPct: finiteOrNull(lattice.maxSpreadPct),
  };
}

export function finalistQuoteRefreshMaxAgeSeconds(
  policy: FinalistQuoteRefreshPolicy,
  asOf: string,
): number {
  const effectiveAt = Date.parse(policy.effectiveAt);
  const asOfMs = Date.parse(asOf);
  if (policy.policyVersion.trim() === '' || !Number.isFinite(effectiveAt) || !Number.isFinite(asOfMs)
    || effectiveAt > asOfMs || !Number.isInteger(policy.maxFinalists) || policy.maxFinalists <= 0
    || !Number.isFinite(policy.maxAgeSeconds) || policy.maxAgeSeconds <= 0) {
    throw new Error('FINALIST_QUOTE_REFRESH_POLICY_INVALID');
  }
  return policy.maxAgeSeconds;
}

/** Mirrors theta_q_lattice.py's deterministic gates (delta band half-open on the upper edge). */
function failsFrozenLatticeGate(contract: NormalizedOptionContract, lattice: ParsedLattice): boolean {
  if (lattice.minDte !== null && contract.dte < lattice.minDte) return true;
  if (lattice.maxDte !== null && contract.dte > lattice.maxDte) return true;
  if (lattice.deltaBands.length > 0) {
    const magnitude = contract.delta === null ? null : Math.abs(contract.delta);
    if (magnitude === null || !lattice.deltaBands.some(([low, high]) => magnitude >= low && magnitude < high)) return true;
  }
  if (lattice.maxSpreadPct !== null && (contract.spreadPct === null || contract.spreadPct > lattice.maxSpreadPct)) return true;
  if (lattice.minOpenInterest !== null && (contract.openInterest === null || contract.openInterest < lattice.minOpenInterest)) return true;
  if (lattice.minVolume !== null && (contract.volume === null || contract.volume < lattice.minVolume)) return true;
  return false;
}

function finiteOrInfinity(value: number | null): number {
  return value !== null && Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
}

function nonnegativeDuration(later: string, earlier: string | null, divisor: number): number | null {
  if (earlier === null) return null;
  const difference = Date.parse(later) - Date.parse(earlier);
  return Number.isFinite(difference) && difference >= 0 ? difference / divisor : null;
}

/** Nearest-rank percentile over actually observed, valid timing evidence. */
function percentile(values: readonly number[], fraction: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(fraction * sorted.length) - 1] ?? null;
}

/**
 * Q-FINALIST-CAP-001: capital facts known BEFORE the shortlist is chosen. A contract whose one-contract collateral exceeds
 * buying power, or whose collateral/equity already reaches the AEGIS hard single-underlying limit, can never be sized to one
 * contract. Unknown facts (null) never mark a contract: behaviour is then identical to a capital-blind shortlist.
 */
export interface FinalistCapitalContext {
  readonly equity: number | null;
  readonly buyingPower: number | null;
  /** maxTickerConcentrationPct * hardCapMultiplier from the AEGIS policy, or null when unknown. */
  readonly hardTickerConcentrationLimitPct: number | null;
}

export function isFinalistCapitalMisfit(contract: Pick<NormalizedOptionContract, 'strike' | 'multiplier'>,
  capital: FinalistCapitalContext | undefined): boolean {
  if (capital === undefined) return false;
  const collateral = contract.strike * contract.multiplier;
  if (!Number.isFinite(collateral) || collateral <= 0) return false;
  if (capital.buyingPower !== null && Number.isFinite(capital.buyingPower) && capital.buyingPower >= 0 && collateral > capital.buyingPower) return true;
  return capital.equity !== null && Number.isFinite(capital.equity) && capital.equity > 0
    && capital.hardTickerConcentrationLimitPct !== null && Number.isFinite(capital.hardTickerConcentrationLimitPct)
    && collateral / capital.equity >= capital.hardTickerConcentrationLimitPct;
}

/**
 * Chooses a bounded quote-refresh set without granting decision authority.
 * The ordering uses only structural lattice proximity and observable quote
 * quality. The canonical THETA-Q, Pareto, AEGIS, sizing and action authorities
 * still run after refreshed evidence is frozen.
 */
export function selectFinalistContractsForRefresh(input: {
  readonly contracts: readonly NormalizedOptionContract[];
  readonly latticeConfig: Readonly<Record<string, unknown>>;
  readonly policy: FinalistQuoteRefreshPolicy;
  readonly asOf: string;
  /** Optional. Capital-misfit contracts rank after every capital-fitting contract of the same gate status; they still fill any
   * slots left over, so nothing is silently dropped. Absent or unknown capital leaves the ordering unchanged. */
  readonly capital?: FinalistCapitalContext;
}): readonly NormalizedOptionContract[] {
  finalistQuoteRefreshMaxAgeSeconds(input.policy, input.asOf);
  const lattice = parseLattice(input.latticeConfig);
  const midpointDte = lattice.minDte !== null && lattice.maxDte !== null
    ? (lattice.minDte + lattice.maxDte) / 2 : null;

  return input.contracts
    .filter((contract) => contract.optionType === 'PUT' && contract.occSymbol !== null
      && contract.multiplier === 100 && contract.bid !== null)
    .map((contract) => {
      const dteOutside = lattice.minDte !== null && lattice.maxDte !== null
        && (contract.dte < lattice.minDte || contract.dte > lattice.maxDte) ? 1 : 0;
      // Phase 2 Q funnel fix (THETA-Q-FINALIST-BLIND-TO-DETERMINISTIC-GATES):
      // the bounded shortlist used to rank purely by delta-band-center
      // proximity, so a cohort of delta-central but illiquid (or oversized)
      // contracts could occupy every finalist slot and starve the contracts
      // that pass the SAME frozen lattice gates Q applies next (archived
      // cycle e9f4b10f: 5 finalists, all dead on volume/AEGIS while 363 puts
      // passed every liquidity gate). Contracts that already fail a frozen
      // lattice gate are now ranked after those that do not. No threshold is
      // read from anywhere new, loosened or tightened; a gate absent from the
      // lattice config is simply not evaluated, and UNKNOWN fails closed
      // exactly as the lattice does. Ties still resolve by the prior keys.
      const gateFailure = failsFrozenLatticeGate(contract, lattice) ? 1 : 0;
      const deltaDistance = contract.delta === null || lattice.deltaCenters.length === 0
        ? Number.POSITIVE_INFINITY
        : Math.min(...lattice.deltaCenters.map((center) => Math.abs(Math.abs(contract.delta as number) - center)));
      const capitalMisfit = isFinalistCapitalMisfit(contract, input.capital) ? 1 : 0;
      return {
        contract,
        score: [
          // A capital-misfit contract can never size to one contract, so it ranks last whether or not it passes the lattice gates;
          // with capital unknown capitalMisfit is 0 and this key reduces to the previous gateFailure ordering.
          gateFailure || capitalMisfit ? 1 : 0,
          capitalMisfit,
          gateFailure,
          dteOutside,
          deltaDistance,
          midpointDte === null ? 0 : Math.abs(contract.dte - midpointDte),
          finiteOrInfinity(contract.spreadPct),
          finiteOrInfinity(contract.dataAgeSeconds),
        ] as const,
      };
    })
    .sort((left, right) => {
      for (let index = 0; index < left.score.length; index += 1) {
        const difference = (left.score[index] as number) - (right.score[index] as number);
        if (difference !== 0 && !Number.isNaN(difference)) return difference;
      }
      return left.contract.optionSymbol.localeCompare(right.contract.optionSymbol);
    })
    .slice(0, input.policy.maxFinalists)
    .map(({ contract }) => contract);
}

export function buildFinalistQuoteRefreshReceipt(input: {
  readonly policy: FinalistQuoteRefreshPolicy;
  readonly candidateBuiltAt: string;
  readonly finalistChosenAt: string;
  readonly decisionAsOf: string;
  readonly initialCandidateCount: number;
  readonly observations: readonly FinalistQuoteRefreshObservation[];
}): FinalistQuoteRefreshReceipt {
  finalistQuoteRefreshMaxAgeSeconds(input.policy, input.decisionAsOf);
  if ([input.candidateBuiltAt, input.finalistChosenAt, input.decisionAsOf]
    .some((value) => !Number.isFinite(Date.parse(value)))) {
    throw new Error('FINALIST_QUOTE_REFRESH_TIMING_INVALID');
  }
  const decisionAt = Date.parse(input.decisionAsOf);
  const candidateAt = Date.parse(input.candidateBuiltAt);
  const finalistAt = Date.parse(input.finalistChosenAt);
  if (candidateAt > finalistAt || finalistAt > decisionAt
    || !Number.isSafeInteger(input.initialCandidateCount) || input.initialCandidateCount < 0
    || input.observations.length > input.policy.maxFinalists
    || input.observations.length > input.initialCandidateCount
    || new Set(input.observations.map((observation) => observation.optionSymbol)).size !== input.observations.length) {
    throw new Error('FINALIST_QUOTE_REFRESH_TIMING_INVALID');
  }
  for (const observation of input.observations) {
    const times = [observation.initialReceivedAt, observation.refreshRequestedAt, observation.refreshReceivedAt]
      .map((value) => Date.parse(value));
    if (times.some((value) => !Number.isFinite(value) || value > decisionAt)
      || (times[0] as number) > candidateAt || (times[1] as number) < finalistAt
      || (times[2] as number) < (times[1] as number)) {
      throw new Error('FINALIST_QUOTE_REFRESH_FUTURE_EVIDENCE');
    }
  }
  const refreshedCount = input.observations.filter((item) => item.state === 'REFRESHED').length;
  const refreshRoundTrips = input.observations.map((item) =>
    nonnegativeDuration(item.refreshReceivedAt, item.refreshRequestedAt, 1)).filter((value): value is number => value !== null);
  const initialQuoteAges = input.observations.map((item) =>
    nonnegativeDuration(input.candidateBuiltAt, item.initialProviderTimestamp, 1_000)).filter((value): value is number => value !== null);
  const refreshedQuoteAges = input.observations.filter((item) => item.state === 'REFRESHED').map((item) =>
    nonnegativeDuration(input.decisionAsOf, item.refreshedProviderTimestamp, 1_000)).filter((value): value is number => value !== null);
  return {
    contractVersion: finalistQuoteRefreshContractVersion,
    policyVersion: input.policy.policyVersion,
    candidateBuiltAt: input.candidateBuiltAt,
    finalistChosenAt: input.finalistChosenAt,
    decisionAsOf: input.decisionAsOf,
    initialCandidateCount: input.initialCandidateCount,
    maxFinalists: input.policy.maxFinalists,
    selectedCount: input.observations.length,
    refreshedCount,
    failedCount: input.observations.length - refreshedCount,
    observations: [...input.observations].sort((a, b) => a.optionSymbol.localeCompare(b.optionSymbol)),
    latency: {
      candidateToDecisionMs: decisionAt - candidateAt,
      refreshRoundTripMsP50: percentile(refreshRoundTrips, 0.5),
      refreshRoundTripMsP95: percentile(refreshRoundTrips, 0.95),
      initialQuoteAgeAtCandidateSecondsP50: percentile(initialQuoteAges, 0.5),
      initialQuoteAgeAtCandidateSecondsP95: percentile(initialQuoteAges, 0.95),
      refreshedQuoteAgeAtDecisionSecondsP50: percentile(refreshedQuoteAges, 0.5),
      refreshedQuoteAgeAtDecisionSecondsP95: percentile(refreshedQuoteAges, 0.95),
      refreshedQuoteTimestampUnavailableCount: refreshedCount - refreshedQuoteAges.length,
    },
  };
}
