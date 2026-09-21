/**
 * R8 WAIT-as-real-alternative research contract (directive priority #1
 * follow-on). Research-only, `brokerAuthority: false`. WAIT is currently
 * represented in Production only as "no candidate passed" -- this module
 * gives it the same evidence shape a real candidate has, so it can
 * eventually compete on economics via
 * `cross-strategy-common-horizon-contract.ts` rather than being the
 * silent default whenever nothing else was selected.
 *
 * Strict separation enforced throughout: `bestRejectedCandidateId`/
 * `secondBestCandidateId` are STRUCTURAL facts (which real candidates
 * existed and were compared); `futureRealizedCounterfactual` is an
 * ESTIMATE with explicit provenance, NEVER conflated with real broker
 * P&L. See `CounterfactualProvenance` below -- an estimate is never
 * silently promoted to "observed."
 */

export const waitEconomicContractVersion = 'theta-wait-economic-contract-v1' as const;

export type CounterfactualProvenance = 'OBSERVED' | 'ESTIMABLE' | 'NOT_IDENTIFIABLE';

/**
 * Every dollar field is either a KNOWN structural fact (cash preserved,
 * foregone premium from a real rejected candidate's real quote) or an
 * explicitly-provenanced counterfactual ESTIMATE -- never a fabricated
 * "what would have happened" number presented as real. `null` is the
 * correct value for any field not yet computable, at every layer.
 */
export interface WaitEconomicEvidence {
  readonly decisionId: string;
  readonly asOf: string;
  /** Cash that stayed uncommitted -- a real structural fact (sum of
   * capital the best-rejected/second-best candidates would have
   * required), never an estimate. */
  readonly cashPreserved: number | null;
  /** Capital-days avoided = cashPreserved x the candidate's own DTE, a
   * deterministic structural computation from already-known candidate
   * facts, not a forecast. */
  readonly capitalDaysAvoided: number | null;
  /** Real, structural: was there a known event/corporate-action risk
   * the rejected candidate(s) would have carried. Never inferred beyond
   * what the actual event-evidence gate already determined. */
  readonly eventRiskAvoided: boolean | null;
  /** Real, structural: assignment burden the rejected candidate would
   * have carried, if quantifiable from its own known economics (e.g. its
   * collateral/strike distance) -- never a probability estimate. */
  readonly assignmentBurdenAvoided: number | null;
  /** The real, known premium of the best-rejected candidate at decision
   * time -- a structural fact about what was given up, never what it
   * would have realized. */
  readonly foregonePremium: number | null;
  readonly bestRejectedCandidateId: string | null;
  readonly secondBestCandidateId: string | null;
  /** The ESTIMATED whole-chain P&L the best-rejected candidate would
   * have realized, had it been taken -- ALWAYS paired with
   * `futureRealizedCounterfactualProvenance` below, and this field must
   * be `null` whenever that provenance is `NOT_IDENTIFIABLE`. */
  readonly futureRealizedCounterfactual: number | null;
  readonly futureRealizedCounterfactualProvenance: CounterfactualProvenance;
}

/**
 * Validates that a counterfactual estimate is never reported without
 * being honestly labeled -- `NOT_IDENTIFIABLE` provenance REQUIRES a
 * `null` counterfactual value; a non-null value REQUIRES `OBSERVED` or
 * `ESTIMABLE` provenance. This is the structural enforcement of "REAL
 * BROKER PNL != COUNTERFACTUAL PNL" -- an invalid combination is
 * rejected outright, never silently accepted.
 */
export function validateWaitEconomicEvidence(evidence: WaitEconomicEvidence): { readonly valid: boolean; readonly reason: string | null } {
  if (evidence.futureRealizedCounterfactualProvenance === 'NOT_IDENTIFIABLE' && evidence.futureRealizedCounterfactual !== null) {
    return { valid: false, reason: 'NOT_IDENTIFIABLE_PROVENANCE_MUST_NEVER_CARRY_A_NON_NULL_COUNTERFACTUAL_VALUE' };
  }
  if (evidence.futureRealizedCounterfactualProvenance !== 'NOT_IDENTIFIABLE' && evidence.futureRealizedCounterfactual === null) {
    return { valid: false, reason: 'OBSERVED_OR_ESTIMABLE_PROVENANCE_REQUIRES_A_NON_NULL_COUNTERFACTUAL_VALUE' };
  }
  return { valid: true, reason: null };
}

/**
 * Future population-level metrics this contract reserves fields for --
 * NEVER populated with synthetic numbers by this module. Every field
 * starts `null`; a real value requires a real, dated evidence set this
 * module has no access to yet. Computing these honestly requires
 * accumulated real WaitEconomicEvidence + real resolved-chain outcomes,
 * neither of which exist in this session.
 */
export interface WaitRegretMetrics {
  readonly asOfWindowStart: string;
  readonly asOfWindowEnd: string;
  readonly sampleSize: number;
  /** Fraction of genuinely comparable opportunities where a rejected
   * candidate was later confirmed (via a real, resolved chain, never an
   * estimate) to have been profitable. */
  readonly opportunityConversionRate: number | null;
  /** Fraction of REJECTED candidates that a later resolved comparable
   * chain confirms would have been profitable -- i.e. WAIT was the
   * wrong call. */
  readonly falseRejectRate: number | null;
  /** Fraction of ACCEPTED candidates that a later resolved chain
   * confirms underperformed WAIT's own real cash-preservation baseline. */
  readonly falseAcceptRate: number | null;
  /** Signed: realized outcome minus the best available alternative's
   * REALIZED outcome (never a counterfactual estimate) for genuinely
   * paired, resolved comparisons only. */
  readonly decisionRegret: number | null;
  /** The WAIT-specific case of decisionRegret: realized cash-preservation
   * value minus the best rejected candidate's OWN REALIZED outcome, when
   * a real paired resolution exists. */
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
 * with, so WAIT can genuinely compete rather than being a structural
 * default. `capitalRequirement`/`collateral` are `0` (a real, known fact
 * -- WAIT commits no capital), never `null`; every field this evidence
 * does not itself supply stays `null`. The empirical
 * `expectedAfterCostWholeChainPnl` is deliberately left `null` here even
 * when a `futureRealizedCounterfactual` exists on the source evidence --
 * a counterfactual estimate must never silently become "empirical
 * forward economics" in the comparison contract without the caller
 * explicitly choosing to carry it across with its provenance intact.
 */
import type { CandidateComparisonInput } from './cross-strategy-common-horizon-contract.js';

export function waitAsComparisonCandidate(evidence: WaitEconomicEvidence): CandidateComparisonInput {
  return {
    candidateId: `WAIT:${evidence.decisionId}`,
    deterministic: {
      action: 'WAIT', strategy: 'WAIT', underlying: '', contractIdentities: [], dte: null, strikes: [],
      executableOpenCreditDebit: 0, multiplier: null, collateral: 0, buyingPowerImpact: 0, maxLoss: null,
      breakEven: null, downsideCushion: null, width: null, bidAskSpread: null,
      estimatedEntryExecutionCost: 0, capitalRequirement: 0,
    },
    empirical: {
      expectedAfterCostWholeChainPnl: null, probabilityProfitable: null, probabilityAssignment: null,
      expectedAssignmentBurden: null, expectedRecoveryDuration: null, expectedCapitalDays: null,
      expectedShortfall: null, cvar: null, expectedTca: null, calibratedUncertainty: null,
    },
  };
}
