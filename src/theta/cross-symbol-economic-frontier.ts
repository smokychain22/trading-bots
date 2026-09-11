import { invokeAndValidate, type PythonBridgeConfig } from './python-bridge.js';
import { runNewRiskOrchestration, type NewRiskOrchestrationRequest, type NewRiskOrchestrationResult } from './new-risk-orchestrator.js';
import { paretoFrontierContractVersion, parseParetoFrontierResponse, survivingCandidateIds, type CandidateEconomics } from './pareto-frontier-contract.js';

// R1H item H, Stage 2: the FULL economic frontier across a bounded Top-N
// cross-symbol shortlist. cross-symbol-selection.ts's
// computeUnderlyingReturnProxy/rankUnderlyingsByReturnProxy remain
// exactly what they always were -- a cheap Stage-1 ECONOMIC_PREFILTER
// (bid/collateral proxy only, no tail risk, no ownership, no capital-days,
// no execution cost) used ONLY to bound which underlyings are worth the
// expense of a full pipeline run. THIS module is the actual final
// selector: for each of the Stage-1 survivors, it runs the REAL, full
// new-risk pipeline (ownership -> regime -> strategy router -> THETA-Q
// lattice -> per-candidate economics), then combines every underlying's
// candidates into ONE shared Pareto-dominance comparison -- never picking
// a winner by re-running the cheap proxy, never hiding the comparison
// inside one opaque weighted score.
//
// No candidate's economics are recomputed here -- every dimension comes
// from new-risk-orchestrator.ts's own already-computed
// NewRiskOrchestrationResult.candidateEconomics (item H part 2), so this
// module performs zero quantitative computation of its own beyond the
// cross-underlying combination and final tie-break selection.
//
// A failed per-underlying cycle simply contributes ZERO candidates to the
// combined frontier (its own receipt already reports why it failed
// closed) -- never a partial/unverified economics injected into a
// cross-underlying comparison alongside underlyings whose full pipeline
// genuinely completed.

export interface UnderlyingFrontierEntry {
  readonly underlying: string;
  readonly result: NewRiskOrchestrationResult;
}

export interface CombinedFrontierCandidate {
  readonly underlying: string;
  readonly candidateId: string; // the underlying-scoped candidateId, as new-risk-orchestrator.ts reported it
  readonly combinedCandidateId: string; // `${underlying}:${candidateId}` -- globally unique across the whole cross-symbol set
  readonly economics: Omit<CandidateEconomics, 'candidateId'>;
  readonly survivesFrontier: boolean;
  readonly dominatedBy: readonly string[]; // combinedCandidateId values of whichever candidates dominate this one
}

// Distinguishes a candidate this frontier merely RANKED for research/
// regret-tracking purposes from one it actually endorses as executable.
// EXECUTABLE_SELECTION requires the winner's ReturnPerCapitalDay (derived
// from ev_net, THETA-Q's calibrated-outcome quantity) to be genuinely
// known -- never merely that it survived Pareto dominance or won a
// capital-efficiency tie-break. As of this writing, THETA-Q's baseline
// has no calibrated entry-outcome model at all (ev_net/
// returnPerCapitalDay are honestly null for every candidate, see R6/
// docs/research/THETA_EV_MODEL_SPEC.md), so this frontier can NEVER
// currently reach EXECUTABLE_SELECTION -- every real cycle today reports
// RESEARCH_RANKING_ONLY or NO_SURVIVORS. This is intentional and
// permanent until a real calibrated model is promoted (R6), not a
// temporary bug: capital-days is a real, always-known quantity, but
// "shorter capital lockup" is NOT the same claim as "positive expected
// value," and this frontier must never let one masquerade as the other.
export type FrontierDisposition = 'EXECUTABLE_SELECTION' | 'RESEARCH_RANKING_ONLY' | 'NO_SURVIVORS';

export interface CrossSymbolEconomicFrontierResult {
  readonly snapshotId: string;
  readonly timestamp: string;
  readonly perUnderlying: readonly UnderlyingFrontierEntry[];
  readonly combinedCandidates: readonly CombinedFrontierCandidate[];
  readonly disposition: FrontierDisposition;
  // true ONLY for disposition === 'EXECUTABLE_SELECTION'. A caller (the
  // strategy route receipt, any future execution path) MUST treat
  // executable === false as "no confirmed selection exists," regardless
  // of whether selectedUnderlying/selectedCandidateId are populated --
  // those two fields are preserved even when non-executable specifically
  // so shadow/regret analysis can still see what the frontier WOULD have
  // picked on capital-efficiency grounds alone.
  readonly executable: boolean;
  readonly selectedUnderlying: string | null;
  readonly selectedCandidateId: string | null;
  readonly reasonCodes: readonly string[];
  readonly failClosedReason: string | null;
}

const failClosed = (
  snapshotId: string,
  timestamp: string,
  perUnderlying: readonly UnderlyingFrontierEntry[],
  reason: string,
): CrossSymbolEconomicFrontierResult => ({
  snapshotId, timestamp, perUnderlying, combinedCandidates: [],
  disposition: 'NO_SURVIVORS', executable: false,
  selectedUnderlying: null, selectedCandidateId: null,
  reasonCodes: [`PIPELINE_STAGE_FAILED:CROSS_SYMBOL_PARETO_FRONTIER`],
  failClosedReason: reason,
});

/**
 * Runs the full new-risk pipeline for every underlying in the shortlist,
 * combines every underlying that produced at least one feasible
 * candidate's economics into ONE Pareto-dominance comparison, and selects
 * the final winner among non-dominated survivors by ReturnPerCapitalDay
 * (highest positive value backed by positive after-cost EV; a survivor with an unknown ReturnPerCapitalDay is
 * never assumed to be zero or worst -- it simply cannot win the final
 * tie-break, though it still appears in combinedCandidates as a genuine
 * frontier survivor). Deterministic tie-break: candidates with equal
 * ReturnPerCapitalDay are ordered by combinedCandidateId ascending, never
 * by array/call order.
 */
export async function runCrossSymbolEconomicFrontier(
  bridge: PythonBridgeConfig,
  snapshotId: string,
  timestamp: string,
  requestsByUnderlying: readonly NewRiskOrchestrationRequest[],
): Promise<CrossSymbolEconomicFrontierResult> {
  const perUnderlying: UnderlyingFrontierEntry[] = [];
  for (const request of requestsByUnderlying) {
    const result = await runNewRiskOrchestration(bridge, request);
    perUnderlying.push({ underlying: request.underlying, result });
  }

  const combinedInputs: { underlying: string; candidateId: string; combinedCandidateId: string; economics: Omit<CandidateEconomics, 'candidateId'> }[] = [];
  for (const entry of perUnderlying) {
    if (entry.result.candidateEconomics === null) continue; // this underlying's cycle failed closed or had zero feasible candidates
    for (const econ of entry.result.candidateEconomics) {
      const { candidateId, ...rest } = econ;
      combinedInputs.push({
        underlying: entry.underlying,
        candidateId,
        combinedCandidateId: `${entry.underlying}:${candidateId}`,
        economics: { ...rest, underlying: entry.underlying, strategyBranch: rest.strategyBranch ?? 'THETA_Q' },
      });
    }
  }

  if (combinedInputs.length === 0) {
    return failClosed(snapshotId, timestamp, perUnderlying, 'no underlying in the shortlist produced any feasible candidate economics');
  }

  const paretoResult = await invokeAndValidate(
    bridge, 'paretoFrontier',
    {
      contractVersion: paretoFrontierContractVersion, snapshotId, timestamp,
      candidates: combinedInputs.map((c) => ({ candidateId: c.combinedCandidateId, ...c.economics })),
    },
    (payload) => parseParetoFrontierResponse(payload),
  );

  if (!paretoResult.ok) {
    return failClosed(snapshotId, timestamp, perUnderlying, paretoResult.detail);
  }

  const survivorIds = new Set(survivingCandidateIds(paretoResult.data));
  const resultByCombinedId = new Map(paretoResult.data.results.map((r) => [r.candidateId, r]));

  const combinedCandidates: CombinedFrontierCandidate[] = combinedInputs.map((c) => {
    const paretoEntry = resultByCombinedId.get(c.combinedCandidateId);
    return {
      underlying: c.underlying, candidateId: c.candidateId, combinedCandidateId: c.combinedCandidateId,
      economics: c.economics, survivesFrontier: paretoEntry?.survivesFrontier ?? false,
      dominatedBy: paretoEntry?.dominatedBy ?? [],
    };
  });

  const disposition = confirmWinnerAgainstOwnPipeline(computeFrontierDisposition(combinedCandidates, survivorIds), perUnderlying);

  return { snapshotId, timestamp, perUnderlying, combinedCandidates, ...disposition, failClosedReason: null };
}

/**
 * Mandatory cross-check (item 3's "mandatory dimensions" discipline):
 * economics alone are never sufficient for EXECUTABLE_SELECTION.
 * candidateEconomics is populated BEFORE that underlying's own full
 * pipeline runs AEGIS/opportunity-frontier/sizing/execution-quality --
 * the economics-only winner is never assumed to have already passed
 * those gates. Confirms the winning underlying's OWN full-pipeline
 * receipt actually selected this exact candidate with a positive
 * quantity before ever reporting executable=true; if it did not (a
 * different candidate won that underlying's own frontier, or AEGIS/
 * sizing/execution-quality reduced it to Q=0), downgrades to
 * RESEARCH_RANKING_ONLY rather than claim an executable pick that was
 * never actually confirmed end-to-end. Exported as a standalone pure
 * function so it is independently testable without a real Python
 * subprocess or a real calibrated EV model (both required to naturally
 * reach EXECUTABLE_SELECTION in the live pipeline today).
 */
export function confirmWinnerAgainstOwnPipeline(
  disposition: FrontierDispositionResult,
  perUnderlying: readonly UnderlyingFrontierEntry[],
): FrontierDispositionResult {
  if (!disposition.executable || disposition.selectedUnderlying === null || disposition.selectedCandidateId === null) {
    return disposition;
  }
  const winnerUnderlyingEntry = perUnderlying.find((e) => e.underlying === disposition.selectedUnderlying);
  const confirmedByOwnPipeline =
    winnerUnderlyingEntry?.result.receipt.selectedCandidateId === disposition.selectedCandidateId &&
    (winnerUnderlyingEntry?.result.receipt.quantity ?? 0) > 0;
  if (confirmedByOwnPipeline) return disposition;
  return {
    disposition: 'RESEARCH_RANKING_ONLY', executable: false,
    selectedUnderlying: disposition.selectedUnderlying, selectedCandidateId: disposition.selectedCandidateId,
    reasonCodes: [
      ...disposition.reasonCodes,
      'WINNING_CANDIDATE_NOT_CONFIRMED_BY_ITS_OWN_UNDERLYINGS_AEGIS_SIZING_EXECUTION_QUALITY_PIPELINE',
    ],
  };
}

const byCombinedId = (a: CombinedFrontierCandidate, b: CombinedFrontierCandidate): number =>
  a.combinedCandidateId < b.combinedCandidateId ? -1 : a.combinedCandidateId > b.combinedCandidateId ? 1 : 0;

export interface FrontierDispositionResult {
  readonly disposition: FrontierDisposition;
  readonly executable: boolean;
  readonly selectedUnderlying: string | null;
  readonly selectedCandidateId: string | null;
  readonly reasonCodes: readonly string[];
}

/**
 * Pure selection logic, independently testable without a real Python
 * bridge (ReturnPerCapitalDay is always null in the real pipeline today,
 * since no calibrated EV model exists yet -- this function's
 * EXECUTABLE_SELECTION branch can only be exercised with a synthetic
 * fixture until R6 lands, which is exactly why it is split out on its
 * own rather than only reachable via a real subprocess call).
 *
 * EXECUTABLE tie-break: highest positive ReturnPerCapitalDay backed by
 * positive after-cost EV -- the ONLY criterion that may ever produce disposition='EXECUTABLE_SELECTION', as
 * it is the sole quantity here derived from a genuinely calibrated
 * economic estimate (ev_net). RESEARCH-ONLY fallback (lowest known
 * CapitalDays) is preserved purely for research/regret-tracking --
 * "shorter capital lockup" is never treated as "positive expected value."
 */
export function computeFrontierDisposition(
  combinedCandidates: readonly CombinedFrontierCandidate[],
  survivorIds: ReadonlySet<string>,
): FrontierDispositionResult {
  const survivors = combinedCandidates.filter((c) => c.survivesFrontier && survivorIds.has(c.combinedCandidateId));

  const rankableByReturn = survivors.filter((c) =>
    c.economics.evNet !== null && c.economics.evNet > 0 &&
    c.economics.returnPerCapitalDay !== null && c.economics.returnPerCapitalDay > 0,
  );
  rankableByReturn.sort((a, b) => {
    const diff = (b.economics.returnPerCapitalDay as number) - (a.economics.returnPerCapitalDay as number);
    return diff !== 0 ? diff : byCombinedId(a, b);
  });

  if (rankableByReturn.length > 0) {
    const winner = rankableByReturn[0] as CombinedFrontierCandidate;
    return {
      disposition: 'EXECUTABLE_SELECTION', executable: true,
      selectedUnderlying: winner.underlying, selectedCandidateId: winner.candidateId,
      reasonCodes: ['SELECTED_BY_HIGHEST_RETURN_PER_CAPITAL_DAY_AMONG_FRONTIER_SURVIVORS'],
    };
  }

  if (survivors.length === 0) {
    return {
      disposition: 'NO_SURVIVORS', executable: false,
      selectedUnderlying: null, selectedCandidateId: null,
      reasonCodes: ['NO_FRONTIER_SURVIVORS'],
    };
  }

  const rankableByCapitalDays = survivors.filter((c) => c.economics.capitalDays !== null);
  rankableByCapitalDays.sort((a, b) => {
    const diff = (a.economics.capitalDays as number) - (b.economics.capitalDays as number);
    return diff !== 0 ? diff : byCombinedId(a, b);
  });
  const researchPick = rankableByCapitalDays[0] ?? null;

  return {
    disposition: 'RESEARCH_RANKING_ONLY', executable: false,
    selectedUnderlying: researchPick?.underlying ?? null,
    selectedCandidateId: researchPick?.candidateId ?? null,
    reasonCodes: [
      survivors.some((candidate) => candidate.economics.evNet !== null || candidate.economics.returnPerCapitalDay !== null)
        ? 'WAIT_ECONOMIC_EXPECTANCY_NOT_POSITIVE'
        : 'WAIT_ECONOMIC_EXPECTANCY_UNCALIBRATED',
      researchPick !== null
        ? 'RESEARCH_RANKING_BY_LOWEST_CAPITAL_DAYS_ONLY_NOT_EXECUTABLE'
        : 'NO_SURVIVOR_HAS_A_KNOWN_CAPITAL_DAYS_EITHER',
    ],
  };
}
