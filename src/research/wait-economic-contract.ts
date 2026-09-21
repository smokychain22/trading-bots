/**
 * R8 WAIT-as-real-alternative research contract, v2 (hardened).
 * Research-only, `brokerAuthority: false`. WAIT is currently represented
 * in Production only as "no candidate passed" -- this module gives it
 * the same evidence shape a real candidate has, so it can eventually
 * compete on economics via `cross-strategy-common-horizon-contract.ts`
 * rather than being the silent default whenever nothing else was
 * selected.
 *
 * v2 hardening, per direct user review:
 *  - v1's `cashPreserved`/`capitalDaysAvoided` doc comments described
 *    SUMMING the best-rejected AND second-best candidates' capital
 *    requirements -- mutually exclusive alternatives THETA could never
 *    have entered simultaneously. Replaced with `capitalReferenceCandidateId`
 *    + `cashPreservedAgainstReference` (ONE named reference candidate's
 *    own capital requirement, never a sum) +
 *    `capitalDaysAvoidedAgainstReference` (computed against that SAME
 *    reference and its own DTE). `validateWaitEconomicEvidence` now also
 *    enforces the reference/value pairing is internally consistent.
 *  - `waitAsComparisonCandidate` previously set `dte: null`, which
 *    `hasCompleteDeterministicEconomics` (the v1 comparator) required
 *    non-null for EVERY candidate -- so WAIT could never actually enter
 *    a comparison. Fixed by `cross-strategy-common-horizon-contract.ts`'s
 *    v2 `validateDeterministicEconomicsForAction`, which does not
 *    require `dte` for `action === 'WAIT'` at all; this function now
 *    requires and passes through a real `ComparisonContext` (horizon
 *    identity, basis, currency) so WAIT shares the SAME comparability
 *    identity as the real candidates it competes against.
 *
 * Strict separation enforced throughout: `bestRejectedCandidateId`/
 * `secondBestCandidateId` are STRUCTURAL facts (which real candidates
 * existed and were compared); `futureRealizedCounterfactual` is an
 * ESTIMATE with explicit provenance, NEVER conflated with real broker
 * P&L.
 */
import type { CandidateComparisonInput, ComparisonContext } from './cross-strategy-common-horizon-contract.js';

export const waitEconomicContractVersion = 'theta-wait-economic-contract-v2' as const;

export type CounterfactualProvenance = 'OBSERVED' | 'ESTIMABLE' | 'NOT_IDENTIFIABLE';

/**
 * Every dollar field is either a KNOWN structural fact or an explicitly-
 * provenanced counterfactual ESTIMATE -- never a fabricated "what would
 * have happened" number presented as real.
 */
export interface WaitEconomicEvidence {
  readonly decisionId: string;
  readonly asOf: string;
  /** The ONE candidate `cashPreservedAgainstReference`/
   * `capitalDaysAvoidedAgainstReference` are computed against -- never
   * an implicit sum of multiple mutually-exclusive alternatives. `null`
   * when no single reference candidate is being used (e.g. no real
   * rejected candidate existed this cycle). */
  readonly capitalReferenceCandidateId: string | null;
  /** The reference candidate's OWN known `capitalRequirement` -- a real
   * structural fact about what THAT ONE candidate would have committed,
   * never a sum across alternatives. Must be `null` whenever
   * `capitalReferenceCandidateId` is `null`. */
  readonly cashPreservedAgainstReference: number | null;
  /** = `cashPreservedAgainstReference` x the reference candidate's own
   * known DTE -- a deterministic structural computation, not a forecast.
   * Must be `null` whenever `cashPreservedAgainstReference` is `null`. */
  readonly capitalDaysAvoidedAgainstReference: number | null;
  readonly eventRiskAvoided: boolean | null;
  readonly assignmentBurdenAvoided: number | null;
  /** The real, known premium of the reference candidate at decision
   * time -- a structural fact about what was given up, never what it
   * would have realized. */
  readonly foregonePremium: number | null;
  readonly bestRejectedCandidateId: string | null;
  readonly secondBestCandidateId: string | null;
  readonly futureRealizedCounterfactual: number | null;
  readonly futureRealizedCounterfactualProvenance: CounterfactualProvenance;
}

export interface WaitEconomicValidationResult {
  readonly valid: boolean;
  readonly reason: string | null;
}

/**
 * Validates two independent consistency rules: (1) the counterfactual
 * provenance/value pairing (same discipline as
 * `management-outcome-schema.ts`'s realized/counterfactual fields), and
 * (2) the capital-reference chain -- a non-null
 * `cashPreservedAgainstReference`/`capitalDaysAvoidedAgainstReference`
 * REQUIRES a named `capitalReferenceCandidateId`; a `null` reference
 * REQUIRES both derived values to also be `null`. This is the structural
 * enforcement against silently summing mutually-exclusive alternatives.
 */
export function validateWaitEconomicEvidence(evidence: WaitEconomicEvidence): WaitEconomicValidationResult {
  if (evidence.futureRealizedCounterfactualProvenance === 'NOT_IDENTIFIABLE' && evidence.futureRealizedCounterfactual !== null) {
    return { valid: false, reason: 'NOT_IDENTIFIABLE_PROVENANCE_MUST_NEVER_CARRY_A_NON_NULL_COUNTERFACTUAL_VALUE' };
  }
  if (evidence.futureRealizedCounterfactualProvenance !== 'NOT_IDENTIFIABLE' && evidence.futureRealizedCounterfactual === null) {
    return { valid: false, reason: 'OBSERVED_OR_ESTIMABLE_PROVENANCE_REQUIRES_A_NON_NULL_COUNTERFACTUAL_VALUE' };
  }
  if (evidence.capitalReferenceCandidateId === null
    && (evidence.cashPreservedAgainstReference !== null || evidence.capitalDaysAvoidedAgainstReference !== null)) {
    return { valid: false, reason: 'CAPITAL_REFERENCE_VALUES_REQUIRE_A_NAMED_REFERENCE_CANDIDATE' };
  }
  if (evidence.cashPreservedAgainstReference === null && evidence.capitalDaysAvoidedAgainstReference !== null) {
    return { valid: false, reason: 'CAPITAL_DAYS_AVOIDED_REQUIRES_A_KNOWN_CASH_PRESERVED_VALUE' };
  }
  return { valid: true, reason: null };
}

/**
 * Future population-level metrics this contract reserves fields for --
 * NEVER populated with synthetic numbers by this module.
 */
export interface WaitRegretMetrics {
  readonly asOfWindowStart: string;
  readonly asOfWindowEnd: string;
  readonly sampleSize: number;
  readonly opportunityConversionRate: number | null;
  readonly falseRejectRate: number | null;
  readonly falseAcceptRate: number | null;
  readonly decisionRegret: number | null;
  readonly waitRegret: number | null;
}

export function emptyWaitRegretMetrics(windowStart: string, windowEnd: string): WaitRegretMetrics {
  return {
    asOfWindowStart: windowStart, asOfWindowEnd: windowEnd, sampleSize: 0,
    opportunityConversionRate: null, falseRejectRate: null, falseAcceptRate: null,
    decisionRegret: null, waitRegret: null,
  };
}

/**
 * Projects `WaitEconomicEvidence` into the SAME shape
 * `cross-strategy-common-horizon-contract.ts` compares real candidates
 * with. Requires a real `context` shared with the candidates WAIT is
 * being compared against (v2 fix -- WAIT must carry the SAME horizon
 * identity, or `compareCrossStrategy` correctly refuses to compare it
 * at all). `dte`/`strikes`/`contractIdentities` stay empty/null -- WAIT
 * genuinely has none -- and `validateDeterministicEconomicsForAction`
 * does not require them for `action === 'WAIT'`.
 */
export function waitAsComparisonCandidate(evidence: WaitEconomicEvidence, context: ComparisonContext): CandidateComparisonInput {
  return {
    candidateId: `WAIT:${evidence.decisionId}`, context, quantity: 0,
    deterministic: {
      action: 'WAIT', strategy: 'WAIT', underlying: '', structureClass: 'NO_STRUCTURE',
      contractIdentities: [], dte: null, strikes: [], executableOpenCreditDebit: 0, multiplier: null,
      collateral: 0, buyingPowerImpact: 0, maxLoss: null, breakEven: null, downsideCushion: null,
      width: null, bidAskSpread: null, estimatedEntryExecutionCost: 0, capitalRequirement: 0,
    },
    empirical: {
      expectedAfterCostWholeChainPnl: null, probabilityProfitable: null, probabilityAssignment: null,
      expectedAssignmentBurden: null, expectedRecoveryDuration: null, expectedCapitalDays: null,
      expectedShortfall: null, cvar: null, maxDrawdown: null, concentrationImpact: null,
      expectedTca: null, calibratedUncertainty: null,
    },
  };
}
