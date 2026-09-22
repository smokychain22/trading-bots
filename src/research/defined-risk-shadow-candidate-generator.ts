/**
 * Defined-Risk shadow candidate generator (Wave 5 item 7). Research-only,
 * `brokerAuthority: false`. Enumerates real put-credit-spread candidates
 * from a real option chain's short/long leg quotes, constrained to
 * THETA_DEFINED_RISK's real registry lattice (7-60 DTE, per
 * `strategy-package.ts`). This is the real producer the entry E2E graph
 * and strategy router deep trace both confirmed does not exist in
 * Production -- building it here is research/shadow-only.
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
  readonly sourceEvidenceIds: readonly string[];
}

export type DefinedRiskGeneratorRejectionReason =
  | 'DTE_OUTSIDE_LATTICE' | 'SAME_STRIKE_LEG_PAIR' | 'WIDTH_OUTSIDE_POLICY_RANGE'
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
