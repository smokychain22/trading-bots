/**
 * Research-only implementation of a real, multi-candidate
 * `PaperBootstrapCandidateSource` (Codex-owned interface,
 * `src/theta/paper-bootstrap-management-policy.ts`, imported read-only
 * here, never modified). Confirmed this session by direct source
 * reading: the canonical `PaperBootstrapCandidateSource.candidatesFor()`
 * interface (paper-bootstrap-management-policy.ts:1100-1105) returns
 * only ONE `rollCandidate`/`ccCandidate` each, and the only real
 * Production call site (`autonomous-runtime.ts:352-353`) never injects
 * anything else, so it always falls back to the `noCandidates` default
 * (`{rollCandidate: null, ccCandidate: null}`). The richer multi-
 * candidate machinery already EXISTS in `PaperBootstrapPolicyInput`
 * (`rollCandidates`, `ccCandidates`, `rollCcCandidates`, all optional,
 * all documented as "falls back to the single-candidate path when
 * absent/empty") and in `evaluateRollCandidates`/
 * `evaluateCoveredCallCandidates` -- this module is the missing
 * DISCOVERY layer that would let those arrays actually be populated
 * from real quotes, not a new ranking or selection mechanism (ranking
 * stays entirely inside the existing, already-tested policy code).
 *
 * `brokerAuthority: false`. This module never submits an order, never
 * calls a broker-mutating endpoint, never deploys, never migrates, never
 * restarts anything. It is a PURE function over already-fetched quote
 * data -- real-time fetching (an Alpaca options-chain read) is Codex's
 * integration responsibility; this module only proves the
 * enumeration/mapping logic is correct given realistic input shapes.
 *
 * See docs/research/THETA_PAPER_BOOTSTRAP_CANDIDATE_SOURCE_INTEGRATION_NOTE.md
 * for the proposed (NOT YET APPLIED) minimal Production interface widening
 * this module is designed to slot into.
 */
import type { RollCandidate } from '../theta/paper-bootstrap-management-policy.js';

export const paperBootstrapCandidateSourceResearchVersion = 'theta-paper-bootstrap-candidate-source-research-v1' as const;

/**
 * A single real, already-fetched Alpaca-executable option-chain
 * observation. Deliberately richer than `RollCandidate` -- it retains
 * `quoteTimestamp`, `dte`, `delta`, and `underlying`, none of which the
 * current canonical `RollCandidate` type carries, so this evidence is
 * never silently dropped between discovery and the (separate) mapping
 * step that narrows it down to what the current Production type accepts.
 * Every field is either a real observed fact or explicitly `null` --
 * never fabricated.
 */
export interface CandidateQuoteObservation {
  readonly contractId: string;
  readonly underlying: string;
  readonly optionType: 'PUT' | 'CALL';
  readonly strike: number;
  readonly expiration: string;
  readonly multiplier: number;
  readonly bid: number | null;
  readonly ask: number | null;
  readonly quoteTimestamp: string;
  readonly dte: number;
  readonly delta: number | null;
  readonly quoteSource: 'ALPACA_EXECUTABLE_MARKET';
}

export interface CurrentShortLeg {
  readonly contractId: string;
  readonly underlying: string;
  readonly optionType: 'PUT' | 'CALL';
  readonly strike: number;
  readonly expiration: string;
  readonly multiplier: number;
  readonly quantity: number;
}

export type CandidateRejectionReason =
  | 'SAME_CONTRACT_AS_CURRENT' | 'DUPLICATE_CONTRACT_ID' | 'STALE_QUOTE'
  | 'MISSING_BID_OR_ASK' | 'CROSSED_OR_INVERTED_QUOTE' | 'NON_POSITIVE_BID'
  | 'WRONG_UNDERLYING' | 'WRONG_OPTION_TYPE' | 'MISMATCHED_MULTIPLIER';

export interface CandidateEnumerationResult {
  readonly accepted: readonly RollCandidate[];
  /** Every rejected observation and the exact reason -- research
   * transparency. A quote that was excluded is never silently dropped
   * without a reason code attached, matching this session's standing
   * UNKNOWN-never-silent discipline. */
  readonly rejected: readonly { readonly contractId: string; readonly reason: CandidateRejectionReason }[];
}

/**
 * `maxQuoteAgeMs` is required, caller-supplied -- this module never
 * invents a staleness threshold. A quote older than this (relative to
 * `asOf`) is rejected as `STALE_QUOTE` rather than silently used.
 */
export interface EnumerationConfig {
  readonly maxQuoteAgeMs: number;
  readonly asOf: string;
}

function classifyRejection(
  observation: CandidateQuoteObservation, currentLeg: CurrentShortLeg, config: EnumerationConfig,
): CandidateRejectionReason | null {
  if (observation.underlying !== currentLeg.underlying) return 'WRONG_UNDERLYING';
  if (observation.optionType !== currentLeg.optionType) return 'WRONG_OPTION_TYPE';
  if (observation.multiplier !== currentLeg.multiplier) return 'MISMATCHED_MULTIPLIER';
  if (observation.contractId === currentLeg.contractId) return 'SAME_CONTRACT_AS_CURRENT';
  const ageMs = Date.parse(config.asOf) - Date.parse(observation.quoteTimestamp);
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > config.maxQuoteAgeMs) return 'STALE_QUOTE';
  if (observation.bid === null || observation.ask === null) return 'MISSING_BID_OR_ASK';
  if (!(observation.bid >= 0) || !Number.isFinite(observation.bid)) return 'NON_POSITIVE_BID';
  if (observation.ask < observation.bid) return 'CROSSED_OR_INVERTED_QUOTE';
  return null;
}

function toRollCandidate(observation: CandidateQuoteObservation, quantity: number): RollCandidate {
  return {
    optionContractId: observation.contractId, symbol: observation.underlying, optionType: observation.optionType,
    strike: observation.strike, expiration: observation.expiration, multiplier: observation.multiplier,
    quantity, bid: observation.bid, ask: observation.ask,
  };
}

/**
 * Enumerates ALL real, currently-quoted alternative contracts for the
 * SAME underlying and SAME option type as `currentLeg` -- multiple
 * expirations and multiple strikes, never pre-selecting one target
 * before valuation (the directive's explicit requirement). Duplicate
 * `contractId`s in the input are rejected (`DUPLICATE_CONTRACT_ID`) on
 * the SECOND and later occurrence -- the first occurrence in array order
 * is kept, never silently merged or averaged.
 */
export function enumerateCandidates(
  observations: readonly CandidateQuoteObservation[], currentLeg: CurrentShortLeg,
  quantity: number, config: EnumerationConfig,
): CandidateEnumerationResult {
  const seenContractIds = new Set<string>();
  const accepted: RollCandidate[] = [];
  const rejected: { readonly contractId: string; readonly reason: CandidateRejectionReason }[] = [];
  for (const observation of observations) {
    if (seenContractIds.has(observation.contractId)) {
      rejected.push({ contractId: observation.contractId, reason: 'DUPLICATE_CONTRACT_ID' });
      continue;
    }
    const reason = classifyRejection(observation, currentLeg, config);
    if (reason !== null) {
      rejected.push({ contractId: observation.contractId, reason });
      continue;
    }
    seenContractIds.add(observation.contractId);
    accepted.push(toRollCandidate(observation, quantity));
  }
  return { accepted, rejected };
}

/**
 * The full candidate SET this module produces for one chain: both the
 * legacy single-candidate fields (for backward compatibility with the
 * CURRENT canonical `PaperBootstrapCandidateSource` interface) and the
 * plural arrays `PaperBootstrapPolicyInput` already supports today but no
 * real source populates. The single-candidate fields are deliberately
 * `null` here -- this module makes NO ranking judgment about which
 * enumerated candidate is "the" target; ranking is the policy's job
 * (`evaluateRollCandidates`/`evaluateCoveredCallCandidates`), never
 * duplicated here. A caller wiring this into the CURRENT narrow
 * interface must pick a convention for the singular fields itself (e.g.
 * `rollCandidates[0] ?? null`) -- this module refuses to make that
 * choice silently, since it is exactly the kind of "incidental ordering"
 * decision this session's broader audit flagged as a defect elsewhere.
 */
export interface PaperBootstrapCandidateSetV2 {
  readonly rollCandidate: null;
  readonly ccCandidate: null;
  readonly rollCandidates: readonly RollCandidate[];
  readonly ccCandidates: readonly RollCandidate[];
  readonly rollCcCandidates: readonly RollCandidate[];
}

export interface CandidateSetInput {
  readonly currentShortPutLeg: CurrentShortLeg | null;
  readonly currentShortCallLeg: CurrentShortLeg | null;
  readonly putObservations: readonly CandidateQuoteObservation[];
  readonly callObservations: readonly CandidateQuoteObservation[];
  readonly quantity: number;
  readonly config: EnumerationConfig;
}

export interface CandidateSetResult {
  readonly candidateSet: PaperBootstrapCandidateSetV2;
  readonly rollRejections: readonly { readonly contractId: string; readonly reason: CandidateRejectionReason }[];
  readonly ccRejections: readonly { readonly contractId: string; readonly reason: CandidateRejectionReason }[];
}

/**
 * Builds the full candidate set for one chain. `currentShortPutLeg`
 * present + `putObservations` supplied -> real ROLL candidates enumerated
 * (alternative puts). `currentShortCallLeg` present + `callObservations`
 * supplied -> real covered-call ROLL_CC candidates (alternative calls on
 * an already-open CC) AND, when `currentShortPutLeg` is null (i.e. stock
 * is held, no open short put), the SAME call observations also populate
 * `ccCandidates` (a fresh SELL_CC decision after assignment/recovery,
 * not a roll of an existing CC). Both `currentShortPutLeg` and
 * `currentShortCallLeg` being null with no observations produces an
 * entirely empty (never fabricated) candidate set.
 */
export function buildPaperBootstrapCandidateSet(input: CandidateSetInput): CandidateSetResult {
  const rollResult = input.currentShortPutLeg !== null
    ? enumerateCandidates(input.putObservations, input.currentShortPutLeg, input.quantity, input.config)
    : { accepted: [], rejected: [] };

  const rollCcResult = input.currentShortCallLeg !== null
    ? enumerateCandidates(input.callObservations, input.currentShortCallLeg, input.quantity, input.config)
    : { accepted: [], rejected: [] };

  // A fresh SELL_CC decision (no open CC to roll) needs a synthetic
  // "current leg" placeholder purely to reuse the same underlying/
  // option-type filter -- constructed from the observations themselves
  // (never a fabricated contract identity), and excluded from rejection
  // by construction since no real contractId can equal a placeholder
  // that was never a real observation's id.
  const firstCallObservation = input.callObservations[0];
  const ccResult = input.currentShortCallLeg === null && firstCallObservation !== undefined
    ? enumerateCandidates(
      input.callObservations,
      {
        // A real first observation (checked above) makes `underlying`/
        // `multiplier` used directly -- never a fallback default (an
        // implicit `?? 100` multiplier would violate the
        // never-assume-multiplier hygiene rule even though it was
        // previously unreachable dead code given this same guarantee).
        contractId: '__NO_CURRENT_CC__', underlying: firstCallObservation.underlying,
        optionType: 'CALL', strike: NaN, expiration: '', multiplier: firstCallObservation.multiplier,
        quantity: input.quantity,
      },
      input.quantity, input.config,
    )
    : { accepted: [], rejected: [] };

  return {
    candidateSet: {
      rollCandidate: null, ccCandidate: null,
      rollCandidates: rollResult.accepted, ccCandidates: ccResult.accepted, rollCcCandidates: rollCcResult.accepted,
    },
    rollRejections: rollResult.rejected, ccRejections: [...ccResult.rejected, ...rollCcResult.rejected],
  };
}
