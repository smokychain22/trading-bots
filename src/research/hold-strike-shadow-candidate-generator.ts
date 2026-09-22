/**
 * Hold-Strike shadow candidate generator (Wave 5 item 6). Research-only,
 * `brokerAuthority: false`. Enumerates real, single-leg cash-secured-put
 * candidates from a real option chain, constrained to THETA_HOLD_STRIKE's
 * real registry lattice (2-5 DTE, per `strategy-package.ts`). This is the
 * real producer the entry E2E graph and strategy router deep trace both
 * confirmed does not exist in Production -- building it here is
 * research/shadow-only; it confers no Paper or broker authority and is
 * never wired into `autonomous-runtime.ts`.
 *
 * Reuses `cashSecuredPutMaxLossAtZero` from the already-hardened
 * `cross-strategy-common-horizon-contract.ts` rather than recomputing the
 * CSP tail-loss formula independently.
 */
import { cashSecuredPutMaxLossAtZero } from './cross-strategy-common-horizon-contract.js';

export const holdStrikeShadowCandidateGeneratorVersion = 'theta-hold-strike-shadow-candidate-generator-v1' as const;

export interface HoldStrikeChainContractQuote {
  readonly contractId: string;
  readonly strike: number;
  readonly dte: number;
  readonly expiration: string;
  readonly bid: number | null;
  readonly ask: number | null;
  readonly quoteTimestamp: string | null;
  readonly delta: number | null;
  readonly multiplier: number | null;
}

export type OwnershipEligibility = 'ELIGIBLE' | 'INELIGIBLE' | 'UNKNOWN';
export type EventProximity = 'CLEAR' | 'NEAR' | 'UNKNOWN';

export interface HoldStrikeGeneratorInput {
  readonly underlying: string;
  readonly decisionTimestamp: string;
  readonly ownershipState: OwnershipEligibility;
  readonly eventState: EventProximity;
  readonly contracts: readonly HoldStrikeChainContractQuote[];
  /** Required, caller-supplied -- this module never invents a freshness policy. */
  readonly maxQuoteAgeMs: number;
  /** Required, caller-supplied real lattice bounds -- the registry's real values (2/5) must be passed explicitly, never hardcoded here. */
  readonly minDte: number;
  readonly maxDte: number;
  readonly sourceEvidenceIds: readonly string[];
}

export type HoldStrikeRejectionReason =
  | 'OWNERSHIP_INELIGIBLE' | 'OWNERSHIP_UNKNOWN' | 'EVENT_NEAR' | 'EVENT_STATE_UNKNOWN'
  | 'DTE_OUTSIDE_LATTICE' | 'MISSING_EXECUTABLE_QUOTE' | 'QUOTE_STALE' | 'QUOTE_INVALID'
  | 'MISSING_MULTIPLIER' | 'NON_POSITIVE_MULTIPLIER' | 'MISSING_DELTA' | 'NON_POSITIVE_STRIKE';

export interface HoldStrikeAcceptedCandidate {
  readonly candidateId: string;
  readonly contractId: string;
  readonly strike: number;
  readonly dte: number;
  readonly expiration: string;
  readonly delta: number;
  readonly bid: number;
  readonly ask: number;
  readonly spread: number;
  readonly multiplier: number;
  /** Always 1 -- this generator enumerates structural candidates, it never sizes a real order. */
  readonly quantity: 1;
  readonly collateral: number;
  readonly breakEven: number;
  readonly maxLossAtZero: number;
  readonly quoteTimestamp: string;
  readonly evidenceIds: readonly string[];
}

export interface HoldStrikeRejectedCandidate {
  readonly contractId: string;
  readonly reason: HoldStrikeRejectionReason;
  readonly detail: string;
}

export interface HoldStrikeGenerationResult {
  readonly generatorVersion: typeof holdStrikeShadowCandidateGeneratorVersion;
  readonly underlying: string;
  readonly decisionTimestamp: string;
  readonly acceptedCandidates: readonly HoldStrikeAcceptedCandidate[];
  readonly rejectedCandidates: readonly HoldStrikeRejectedCandidate[];
  readonly brokerAuthority: false;
}

function finite(value: number | null): value is number {
  return value !== null && Number.isFinite(value);
}

function reject(contractId: string, reason: HoldStrikeRejectionReason, detail: string): HoldStrikeRejectedCandidate {
  return { contractId, reason, detail };
}

/**
 * Enumerates every real contract in `input.contracts` into either
 * `acceptedCandidates` (a real, structurally sound, single-leg CSP
 * candidate within the 2-5 DTE lattice) or `rejectedCandidates` (with an
 * exact, individually-preserved reason). Ownership/event gates are
 * checked once per generation call (they are decision-context-level
 * facts, not per-contract), and rejecting on them still names EVERY
 * contract individually rather than short-circuiting silently.
 */
export function generateHoldStrikeCandidates(input: HoldStrikeGeneratorInput): HoldStrikeGenerationResult {
  const contextRejectionReason: HoldStrikeRejectionReason | null =
    input.ownershipState === 'INELIGIBLE' ? 'OWNERSHIP_INELIGIBLE'
      : input.ownershipState === 'UNKNOWN' ? 'OWNERSHIP_UNKNOWN'
        : input.eventState === 'NEAR' ? 'EVENT_NEAR'
          : input.eventState === 'UNKNOWN' ? 'EVENT_STATE_UNKNOWN'
            : null;

  if (contextRejectionReason !== null) {
    return {
      generatorVersion: holdStrikeShadowCandidateGeneratorVersion, underlying: input.underlying,
      decisionTimestamp: input.decisionTimestamp, acceptedCandidates: [],
      rejectedCandidates: input.contracts.map((c) => reject(c.contractId, contextRejectionReason,
        `Decision-context gate failed: ownershipState=${input.ownershipState}, eventState=${input.eventState}.`)),
      brokerAuthority: false,
    };
  }

  const acceptedCandidates: HoldStrikeAcceptedCandidate[] = [];
  const rejectedCandidates: HoldStrikeRejectedCandidate[] = [];

  for (const c of input.contracts) {
    if (!finite(c.strike) || c.strike <= 0) { rejectedCandidates.push(reject(c.contractId, 'NON_POSITIVE_STRIKE', `strike=${c.strike}`)); continue; }
    if (c.dte < input.minDte || c.dte > input.maxDte) {
      rejectedCandidates.push(reject(c.contractId, 'DTE_OUTSIDE_LATTICE', `dte=${c.dte} outside [${input.minDte},${input.maxDte}]`));
      continue;
    }
    if (c.bid === null || c.ask === null) { rejectedCandidates.push(reject(c.contractId, 'MISSING_EXECUTABLE_QUOTE', 'bid or ask is null')); continue; }
    if (!finite(c.bid) || !finite(c.ask) || c.bid < 0 || c.ask <= 0 || c.bid > c.ask) {
      rejectedCandidates.push(reject(c.contractId, 'QUOTE_INVALID', `bid=${c.bid}, ask=${c.ask}`));
      continue;
    }
    if (c.quoteTimestamp === null) { rejectedCandidates.push(reject(c.contractId, 'QUOTE_STALE', 'quoteTimestamp is null')); continue; }
    const ageMs = Date.parse(input.decisionTimestamp) - Date.parse(c.quoteTimestamp);
    if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > input.maxQuoteAgeMs) {
      rejectedCandidates.push(reject(c.contractId, 'QUOTE_STALE', `quote age ${ageMs}ms exceeds policy max ${input.maxQuoteAgeMs}ms (or is future-dated)`));
      continue;
    }
    if (c.multiplier === null) { rejectedCandidates.push(reject(c.contractId, 'MISSING_MULTIPLIER', 'multiplier is null')); continue; }
    if (!finite(c.multiplier) || c.multiplier <= 0) { rejectedCandidates.push(reject(c.contractId, 'NON_POSITIVE_MULTIPLIER', `multiplier=${c.multiplier}`)); continue; }
    if (c.delta === null) { rejectedCandidates.push(reject(c.contractId, 'MISSING_DELTA', 'delta is null')); continue; }

    const maxLossAtZero = cashSecuredPutMaxLossAtZero(c.strike, c.bid, c.multiplier, 1);
    acceptedCandidates.push({
      candidateId: `HOLD_STRIKE:${c.contractId}`, contractId: c.contractId, strike: c.strike, dte: c.dte,
      expiration: c.expiration, delta: c.delta, bid: c.bid, ask: c.ask, spread: c.ask - c.bid,
      multiplier: c.multiplier, quantity: 1, collateral: c.strike * c.multiplier,
      breakEven: c.strike - c.bid, maxLossAtZero: maxLossAtZero as number,
      quoteTimestamp: c.quoteTimestamp, evidenceIds: input.sourceEvidenceIds,
    });
  }

  return {
    generatorVersion: holdStrikeShadowCandidateGeneratorVersion, underlying: input.underlying,
    decisionTimestamp: input.decisionTimestamp, acceptedCandidates, rejectedCandidates, brokerAuthority: false,
  };
}
