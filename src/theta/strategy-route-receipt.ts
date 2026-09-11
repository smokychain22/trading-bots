import type { StrategyRoutingResponse, StrategyFamily } from './strategy-router-contract.js';
import type { NewRiskOrchestrationResult } from './new-risk-orchestrator.js';
import type { CrossSymbolEconomicFrontierResult } from './cross-symbol-economic-frontier.js';
import type { AegisAssessmentResponse } from './aegis-contract.js';

// R1H item 13: the explicit Route Receipt the strategy router must emit.
// strategy_router.py / strategy-router-contract.ts already produce a
// genuine per-family eligibility sweep (never a consensus vote -- see
// strategy_router.py's own docstring); this module ASSEMBLES that
// eligibility output together with the actual downstream outcome (the
// new-risk pipeline's selected action, WAIT/Q=0 reason, AEGIS result, and
// the cross-symbol economic comparison) into one receipt, so nothing
// about "why this strategy, why not another, why this quantity" is left
// opaque or split across several separate objects a caller has to
// reassemble by hand.
//
// This module performs NO quantitative computation and invents no new
// strategy-selection logic: THETA_Q is the only family this pipeline
// currently generates real candidates for (THETA_H/THETA_R/THETA_A/
// THETA_C/THETA_D remain eligibility-only in this codebase today -- see
// docs/quant/phase6_router for the roadmap). This receipt states that
// limitation explicitly (strategiesWithoutCandidateGeneration) rather
// than silently implying every eligible family competed.

export interface IneligibleStrategy {
  readonly family: StrategyFamily;
  readonly reasonCodes: readonly string[];
}

export interface StrategyRouteReceipt {
  readonly snapshotId: string;
  readonly timestamp: string;
  readonly policyVersion: string;
  readonly eligibleStrategies: readonly StrategyFamily[];
  readonly ineligibleStrategies: readonly IneligibleStrategy[];
  // Families this codebase does not yet generate real candidates for,
  // even when eligible -- an honest, explicit gap, never silently implied
  // to have competed. Currently every family except THETA_Q.
  readonly strategiesWithoutCandidateGeneration: readonly StrategyFamily[];
  readonly selectedStrategy: StrategyFamily | null;
  readonly selectedUnderlying: string | null;
  readonly selectedCandidateId: string | null;
  readonly waitReason: string | null;
  readonly qZeroReason: string | null;
  readonly rejectionReasonCodes: readonly string[];
  readonly economicFrontier: CrossSymbolEconomicFrontierResult | null;
  readonly aegis: AegisAssessmentResponse | null;
  readonly modelVersions: Readonly<Record<string, string>>;
}

const THETA_Q: StrategyFamily = 'THETA_Q';

/**
 * Assembles one StrategyRouteReceipt from the router's own eligibility
 * sweep, one representative new-risk cycle result (the family currently
 * wired to generate candidates -- THETA_Q), and (optionally) the
 * cross-symbol economic frontier's final selection when this router
 * decision spans more than one underlying.
 */
export function assembleStrategyRouteReceipt(
  routing: StrategyRoutingResponse,
  primaryResult: NewRiskOrchestrationResult,
  economicFrontier: CrossSymbolEconomicFrontierResult | null,
  modelVersions: Readonly<Record<string, string>>,
): StrategyRouteReceipt {
  const eligibleStrategies = routing.results.filter((r) => r.eligible).map((r) => r.strategyFamily);
  const ineligibleStrategies: IneligibleStrategy[] = routing.results
    .filter((r) => !r.eligible)
    .map((r) => ({ family: r.strategyFamily, reasonCodes: r.reasons.map((reason) => reason.code) }));
  const strategiesWithoutCandidateGeneration = routing.results
    .map((r) => r.strategyFamily)
    .filter((family) => family !== THETA_Q);

  const winningAction = economicFrontier !== null ? null : primaryResult.receipt.winningAction;
  // A cross-symbol frontier's selectedUnderlying/selectedCandidateId are
  // ONLY promoted to this receipt's confirmed selection when the
  // frontier itself reports executable===true (a genuinely
  // calibrated-EV-derived pick, per computeFrontierDisposition's own
  // EXECUTABLE_SELECTION/RESEARCH_RANKING_ONLY/NO_SURVIVORS split) --
  // never merely because a research-ranking pick happens to be present.
  // The frontier's own (possibly non-executable) pick remains fully
  // visible via the `economicFrontier` field on this receipt for
  // research/regret analysis; it is simply never conflated with a
  // confirmed selection here.
  const frontierConfirmed = economicFrontier !== null && economicFrontier.executable;
  const selectedUnderlying = frontierConfirmed
    ? economicFrontier.selectedUnderlying
    : economicFrontier === null && primaryResult.receipt.selectedCandidateId !== null
      ? primaryResult.receipt.underlying
      : null;
  const selectedCandidateId = frontierConfirmed ? economicFrontier.selectedCandidateId : economicFrontier === null ? primaryResult.receipt.selectedCandidateId : null;

  const thetaQEligible = eligibleStrategies.includes(THETA_Q);
  const selectedStrategy: StrategyFamily | null = selectedCandidateId !== null && thetaQEligible ? THETA_Q : null;

  const waitReason =
    selectedCandidateId === null
      ? (economicFrontier !== null
          ? (economicFrontier.reasonCodes[0] ?? 'WAIT_NO_REASON_RECORDED')
          : (winningAction === 'PASS' || winningAction === 'WAIT' ? (primaryResult.receipt.reasonCodes[0] ?? 'WAIT_NO_REASON_RECORDED') : null))
      : null;

  const qZeroReason = selectedCandidateId !== null && primaryResult.receipt.quantity === 0 ? 'Q_ZERO_AFTER_SIZING_OR_EXECUTION_QUALITY' : null;

  const rejectionReasonCodes = [
    ...ineligibleStrategies.flatMap((s) => s.reasonCodes),
    ...primaryResult.receipt.reasonCodes,
    ...(economicFrontier?.reasonCodes ?? []),
  ];

  return {
    snapshotId: primaryResult.receipt.snapshotId,
    timestamp: primaryResult.receipt.timestamp,
    policyVersion: routing.policyVersion,
    eligibleStrategies,
    ineligibleStrategies,
    strategiesWithoutCandidateGeneration,
    selectedStrategy,
    selectedUnderlying,
    selectedCandidateId,
    waitReason,
    qZeroReason,
    rejectionReasonCodes,
    economicFrontier,
    aegis: primaryResult.aegis,
    modelVersions,
  };
}
