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
}

interface ParsedLattice {
  readonly minDte: number | null;
  readonly maxDte: number | null;
  readonly deltaCenters: readonly number[];
}

function parseLattice(lattice: Readonly<Record<string, unknown>>): ParsedLattice {
  const minDte = typeof lattice.minDte === 'number' && Number.isFinite(lattice.minDte) ? lattice.minDte : null;
  const maxDte = typeof lattice.maxDte === 'number' && Number.isFinite(lattice.maxDte) ? lattice.maxDte : null;
  const rawBands = Array.isArray(lattice.deltaBands) ? lattice.deltaBands : [];
  const deltaCenters = rawBands.flatMap((value) => {
    if (!Array.isArray(value) || value.length !== 2) return [];
    const [low, high] = value;
    return typeof low === 'number' && Number.isFinite(low) && typeof high === 'number' && Number.isFinite(high)
      && low >= 0 && high >= low ? [(low + high) / 2] : [];
  });
  return { minDte, maxDte, deltaCenters };
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

function finiteOrInfinity(value: number | null): number {
  return value !== null && Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
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
      const deltaDistance = contract.delta === null || lattice.deltaCenters.length === 0
        ? Number.POSITIVE_INFINITY
        : Math.min(...lattice.deltaCenters.map((center) => Math.abs(Math.abs(contract.delta as number) - center)));
      return {
        contract,
        score: [
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
  for (const observation of input.observations) {
    const times = [observation.initialReceivedAt, observation.refreshRequestedAt, observation.refreshReceivedAt]
      .map((value) => Date.parse(value));
    if (times.some((value) => !Number.isFinite(value) || value > decisionAt)) {
      throw new Error('FINALIST_QUOTE_REFRESH_FUTURE_EVIDENCE');
    }
  }
  const refreshedCount = input.observations.filter((item) => item.state === 'REFRESHED').length;
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
  };
}
