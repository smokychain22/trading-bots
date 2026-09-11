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

export interface CrossSymbolEconomicFrontierResult {
  readonly snapshotId: string;
  readonly timestamp: string;
  readonly perUnderlying: readonly UnderlyingFrontierEntry[];
  readonly combinedCandidates: readonly CombinedFrontierCandidate[];
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
  selectedUnderlying: null, selectedCandidateId: null,
  reasonCodes: [`PIPELINE_STAGE_FAILED:CROSS_SYMBOL_PARETO_FRONTIER`],
  failClosedReason: reason,
});

/**
 * Runs the full new-risk pipeline for every underlying in the shortlist,
 * combines every underlying that produced at least one feasible
 * candidate's economics into ONE Pareto-dominance comparison, and selects
 * the final winner among non-dominated survivors by ReturnPerCapitalDay
 * (highest known value; a survivor with an unknown ReturnPerCapitalDay is
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

  const survivors = combinedCandidates.filter((c) => c.survivesFrontier && survivorIds.has(c.combinedCandidateId));

  const byCombinedId = (a: CombinedFrontierCandidate, b: CombinedFrontierCandidate): number =>
    a.combinedCandidateId < b.combinedCandidateId ? -1 : a.combinedCandidateId > b.combinedCandidateId ? 1 : 0;

  // Primary tie-break: highest known ReturnPerCapitalDay. As of this
  // writing, THETA-Q's baseline has no calibrated entry-outcome model
  // (ev_net is honestly null for every candidate, per theta_q_baseline.py's
  // own documented gap), which means returnPerCapitalDay -- itself derived
  // from ev_net -- is ALSO always null today. Rather than silently fall
  // through to an arbitrary pick (e.g. array/call order) when that
  // happens, this falls back to the lowest known CapitalDays (a real,
  // always-known quantity -- capital tied up x days committed) as an
  // explicit, reported, capital-efficiency-only secondary criterion. This
  // is never a substitute for real EV-based selection once a calibrated
  // model exists (R6) -- it is the most honest thing this frontier can do
  // with what is actually known today, and the reason code below always
  // says which criterion actually decided the pick.
  const rankableByReturn = survivors.filter((c) => c.economics.returnPerCapitalDay !== null);
  rankableByReturn.sort((a, b) => {
    const diff = (b.economics.returnPerCapitalDay as number) - (a.economics.returnPerCapitalDay as number);
    return diff !== 0 ? diff : byCombinedId(a, b);
  });

  const rankableByCapitalDays = survivors.filter((c) => c.economics.capitalDays !== null);
  rankableByCapitalDays.sort((a, b) => {
    const diff = (a.economics.capitalDays as number) - (b.economics.capitalDays as number);
    return diff !== 0 ? diff : byCombinedId(a, b);
  });

  const winner = rankableByReturn[0] ?? rankableByCapitalDays[0] ?? null;
  const selectedByReturnPerCapitalDay = rankableByReturn.length > 0;

  const reasonCodes: string[] = [];
  if (winner === null) {
    reasonCodes.push('NO_FRONTIER_SURVIVORS');
  } else if (!selectedByReturnPerCapitalDay) {
    reasonCodes.push('RETURN_PER_CAPITAL_DAY_UNKNOWN_FOR_ALL_SURVIVORS_FELL_BACK_TO_LOWEST_CAPITAL_DAYS');
  } else {
    reasonCodes.push('SELECTED_BY_HIGHEST_RETURN_PER_CAPITAL_DAY_AMONG_FRONTIER_SURVIVORS');
  }

  return {
    snapshotId, timestamp, perUnderlying, combinedCandidates,
    selectedUnderlying: winner?.underlying ?? null,
    selectedCandidateId: winner?.candidateId ?? null,
    reasonCodes,
    failClosedReason: null,
  };
}
