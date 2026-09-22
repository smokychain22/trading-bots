/**
 * Defined-Risk shadow candidate generator (Wave 5 item 7). Research-only,
 * `brokerAuthority: false`. Enumerates real put-credit-spread candidates
 * from a real option chain's short/long leg quotes, constrained to
 * THETA_DEFINED_RISK's real registry lattice (7-60 DTE, per
 * `strategy-package.ts`).
 *
 * **CORRECTION (Wave 6, per Codex's own review of this module --
 * `docs/operations/THETA_RESOLVED_AND_ACTIVE_WORK.md`)**: `canonical-strategy-frontier.ts`
 * was found to already contain real, structurally complete Defined-Risk
 * (and Hold-Strike) candidate-construction logic (`definedRiskCandidate`/
 * `singleLegPutCandidate`, filtered by each branch's own real registry
 * DTE lattice against the SAME fetched `input.contracts`) -- this
 * module's earlier doc comment claiming "no code path anywhere in the
 * live pipeline constructs a multi-leg Defined-Risk spread candidate"
 * was **incomplete**: that construction logic exists; what remains
 * genuinely unresolved is whether the real upstream chain fetch
 * (`theta-shadow-cycle.ts`'s `config.optionExpirationDateGte/Lte`) is
 * configured wide enough to ever supply it real 7-60-DTE-lattice
 * contracts distinct from THETA_Q's own window -- not independently
 * verified either way. Per Codex's explicit instruction, this module is
 * a **research prototype to reconcile with that existing frontier, not
 * a competing/duplicate Production decision authority** -- see
 * `THETA_CANONICAL_FRONTIER_HD_RECONCILIATION.md` for the full
 * correction. Codex also identified a real defect this pass fixes: this
 * generator previously accepted a structurally valid but stale/
 * desynchronized quote pair without giving the caller a way to reject
 * it (`requireSynchronizedFreshQuotes` below).
 *
 * Deliberately REUSES, never reimplements, the already-hardened spread
 * economics from `defined-risk-vs-csp-paired-study.ts`
 * (`computePutCreditSpreadStructuralEconomics`, `buildSpreadExecutionBurdenEvidence`)
 * -- this module is a batch chain-enumeration wrapper around that real,
 * tested, 26-test-covered machinery, not a second, competing formula.
 */
import {
  computePutCreditSpreadStructuralEconomics, buildSpreadExecutionBurdenEvidence,
  type SpreadLegQuote, type PutCreditSpreadStructuralClassification,
} from './defined-risk-vs-csp-paired-study.js';

export const definedRiskShadowCandidateGeneratorVersion = 'theta-defined-risk-shadow-candidate-generator-v1' as const;

export interface DefinedRiskLegContract {
  readonly contractId: string;
  readonly strike: number;
  readonly quote: SpreadLegQuote;
}

export interface DefinedRiskChainInput {
  readonly underlying: string;
  readonly decisionTimestamp: string;
  readonly expiration: string;
  readonly dte: number;
  readonly shortLegCandidates: readonly DefinedRiskLegContract[];
  readonly longLegCandidates: readonly DefinedRiskLegContract[];
  readonly quantity: number;
  readonly maxSyncAgeMs: number;
  readonly maxQuoteAgeMs: number;
  readonly minDte: number;
  readonly maxDte: number;
  /** Required policy bounds on spread width -- this module never invents a plausible width range. */
  readonly minWidth: number;
  readonly maxWidth: number;
  /**
   * Required, caller-supplied. When `true`, a structurally valid pair
   * whose leg quotes are not `BOTH_FRESH_AND_SYNCHRONIZED` (per
   * `buildSpreadExecutionBurdenEvidence`'s `quoteState`) is REJECTED
   * (`QUOTE_NOT_SYNCHRONIZED_FRESH`), never silently accepted. When
   * `false`, a stale/desynchronized pair may still be accepted, but its
   * real `quoteState` is always preserved on the accepted candidate so a
   * downstream consumer can check it -- this module never hides that
   * evidence either way. No default -- the caller must decide.
   */
  readonly requireSynchronizedFreshQuotes: boolean;
  readonly sourceEvidenceIds: readonly string[];
}

export type DefinedRiskGeneratorRejectionReason =
  | 'DTE_OUTSIDE_LATTICE' | 'SAME_STRIKE_LEG_PAIR' | 'WIDTH_OUTSIDE_POLICY_RANGE' | 'QUOTE_NOT_SYNCHRONIZED_FRESH'
  | PutCreditSpreadStructuralClassification;

export interface DefinedRiskAcceptedCandidate {
  readonly candidateId: string;
  readonly shortContractId: string;
  readonly longContractId: string;
  readonly shortStrike: number;
  readonly longStrike: number;
  readonly dte: number;
  readonly expiration: string;
  readonly width: number;
  readonly openingNetCreditPerShare: number;
  readonly maxProfit: number;
  readonly maxLoss: number;
  readonly multiplier: number;
  readonly quantity: number;
  readonly breakEven: number;
  readonly capitalRequirement: number;
  readonly quoteSynchronizationStatus: string;
  readonly quoteState: string;
  readonly evidenceIds: readonly string[];
}

export interface DefinedRiskRejectedCandidate {
  readonly shortContractId: string;
  readonly longContractId: string;
  readonly reason: DefinedRiskGeneratorRejectionReason;
  readonly detail: string;
}

export interface DefinedRiskGenerationResult {
  readonly generatorVersion: typeof definedRiskShadowCandidateGeneratorVersion;
  readonly underlying: string;
  readonly decisionTimestamp: string;
  readonly acceptedCandidates: readonly DefinedRiskAcceptedCandidate[];
  readonly rejectedCandidates: readonly DefinedRiskRejectedCandidate[];
  readonly brokerAuthority: false;
}

/**
 * Enumerates every (short, long) leg pair where `short.strike > long.strike`
 * (a real put-credit-spread candidate geometry) into either
 * `acceptedCandidates` or `rejectedCandidates` with an exact reason.
 * Structural/economic validity is delegated entirely to
 * `computePutCreditSpreadStructuralEconomics` -- this function adds only
 * the chain-level DTE-lattice and width-policy checks that function does
 * not own.
 */
export function generateDefinedRiskCandidates(input: DefinedRiskChainInput): DefinedRiskGenerationResult {
  const acceptedCandidates: DefinedRiskAcceptedCandidate[] = [];
  const rejectedCandidates: DefinedRiskRejectedCandidate[] = [];

  if (input.dte < input.minDte || input.dte > input.maxDte) {
    for (const short of input.shortLegCandidates) {
      for (const long of input.longLegCandidates) {
        if (short.contractId === long.contractId) continue;
        rejectedCandidates.push({
          shortContractId: short.contractId, longContractId: long.contractId, reason: 'DTE_OUTSIDE_LATTICE',
          detail: `dte=${input.dte} outside [${input.minDte},${input.maxDte}]`,
        });
      }
    }
    return {
      generatorVersion: definedRiskShadowCandidateGeneratorVersion, underlying: input.underlying,
      decisionTimestamp: input.decisionTimestamp, acceptedCandidates, rejectedCandidates, brokerAuthority: false,
    };
  }

  for (const short of input.shortLegCandidates) {
    for (const long of input.longLegCandidates) {
      if (short.contractId === long.contractId) continue;
      if (short.strike === long.strike) {
        rejectedCandidates.push({ shortContractId: short.contractId, longContractId: long.contractId, reason: 'SAME_STRIKE_LEG_PAIR', detail: 'Short and long legs reference the same strike.' });
        continue;
      }
      // A short strike below the long strike is a structurally invalid put-credit-spread
      // geometry -- handled by computePutCreditSpreadStructuralEconomics's own
      // INVERTED_STRIKES classification below, not special-cased here.
      const structural = computePutCreditSpreadStructuralEconomics({
        shortStrike: short.strike, longStrike: long.strike, shortLeg: short.quote, longLeg: long.quote, quantity: input.quantity,
      });

      if (structural.classification !== 'VALID_CREDIT_SPREAD') {
        rejectedCandidates.push({ shortContractId: short.contractId, longContractId: long.contractId, reason: structural.classification, detail: `computePutCreditSpreadStructuralEconomics classified this pair as ${structural.classification}.` });
        continue;
      }
      if ((structural.width as number) < input.minWidth || (structural.width as number) > input.maxWidth) {
        rejectedCandidates.push({ shortContractId: short.contractId, longContractId: long.contractId, reason: 'WIDTH_OUTSIDE_POLICY_RANGE', detail: `width=${structural.width} outside policy [${input.minWidth},${input.maxWidth}]` });
        continue;
      }

      const burden = buildSpreadExecutionBurdenEvidence(
        short.contractId, short.quote, long.contractId, long.quote,
        input.decisionTimestamp, input.maxSyncAgeMs, input.maxQuoteAgeMs,
      );

      if (input.requireSynchronizedFreshQuotes && burden.quoteState !== 'BOTH_FRESH_AND_SYNCHRONIZED') {
        rejectedCandidates.push({
          shortContractId: short.contractId, longContractId: long.contractId, reason: 'QUOTE_NOT_SYNCHRONIZED_FRESH',
          detail: `quoteState=${burden.quoteState}, but policy requires BOTH_FRESH_AND_SYNCHRONIZED.`,
        });
        continue;
      }

      acceptedCandidates.push({
        candidateId: `DEFINED_RISK:${short.contractId}/${long.contractId}`,
        shortContractId: short.contractId, longContractId: long.contractId,
        shortStrike: short.strike, longStrike: long.strike, dte: input.dte, expiration: input.expiration,
        width: structural.width as number, openingNetCreditPerShare: structural.openingNetCreditPerShare as number,
        maxProfit: structural.maxProfit as number, maxLoss: structural.maxLoss as number,
        multiplier: structural.multiplier as number, quantity: structural.quantity as number,
        breakEven: short.strike - (structural.openingNetCreditPerShare as number),
        capitalRequirement: structural.maxLoss as number,
        quoteSynchronizationStatus: burden.quoteSynchronization.status, quoteState: burden.quoteState,
        evidenceIds: input.sourceEvidenceIds,
      });
    }
  }

  return {
    generatorVersion: definedRiskShadowCandidateGeneratorVersion, underlying: input.underlying,
    decisionTimestamp: input.decisionTimestamp, acceptedCandidates, rejectedCandidates, brokerAuthority: false,
  };
}
