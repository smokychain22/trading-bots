export const managedEpisodePathFeaturesVersion = 'theta-managed-episode-path-features-v1' as const;

/**
 * INTERFACE/CALCULATION BOUNDARY ONLY -- no persistence, no database
 * migration, and no wiring into any management action's utility. Defined
 * now because analytical mark semantics (analyticalOptionMarkDollars in
 * paper-bootstrap-management-policy.ts) are finally structurally separate
 * from the conservative ASK-side execution-cost estimate -- these path
 * features MUST be fed by the analytical valuation, never the execution
 * estimate, or a widening spread would corrupt the path history the same
 * way it would have corrupted the loss-magnitude signal before that fix.
 *
 * These are PATH FEATURES -- pure historical/informational evidence about
 * how a position's analytical value has moved. They NEVER directly
 * command CLOSE/HOLD/ROLL. A position that reached +60% analytical
 * unrealized value and has since given back to +8% does not automatically
 * trigger anything -- the SAME forward-looking action comparison this
 * bootstrap policy already performs (CLOSE_FULL/ROLL/HOLD's own utility)
 * remains the only decision mechanism. These features exist so that
 * comparison (and future research) can eventually CONSUME the path as
 * evidence, once a real accumulation mechanism exists to track it turn
 * over turn -- which this module does not implement.
 */
export interface ManagedEpisodePathFeatures {
  readonly contractVersion: typeof managedEpisodePathFeaturesVersion;
  /** Maximum Favorable Economic Excursion -- the best analytical
   * unrealized value (dollars) this episode has shown so far. */
  readonly maximumFavorableExcursionDollars: number | null;
  /** Maximum Adverse Economic Excursion -- the worst analytical
   * unrealized value (dollars) this episode has shown so far. */
  readonly maximumAdverseExcursionDollars: number | null;
  /** MFE expressed as a fraction of entry credit/debit, for cross-episode
   * comparability. */
  readonly peakProfitFraction: number | null;
  /** How much of the peak favorable excursion has since been given back,
   * as a fraction of that peak -- 0 means no giveback, 1 means fully
   * round-tripped back to the entry reference. */
  readonly profitGivebackFraction: number | null;
  readonly timeSinceMfeDays: number | null;
  readonly timeSinceMaeDays: number | null;
  readonly asOf: string;
}

/**
 * One observation in an episode's analytical-value path -- the raw input
 * this module's (future) accumulation logic would fold over. `asOf` and
 * `analyticalValueDollars` must both come from the SAME immutable
 * snapshot as every other management decision at that timestamp -- this
 * module does not fetch or derive its own state.
 */
export interface PathObservation {
  readonly asOf: string;
  readonly analyticalValueDollars: number;
}

/**
 * Pure fold over a COMPLETE, caller-supplied observation history --
 * this module has no accumulation/storage of its own (no persistence
 * this pass, per the directive). Returns null for every excursion field
 * when the history is empty, never a fabricated zero. `entryReference`
 * (e.g. entry credit/debit) is required for `peakProfitFraction` and
 * `profitGivebackFraction` -- omitted, those two stay null while the
 * dollar-denominated MFE/MAE fields still compute from the observations
 * alone.
 */
export function computeManagedEpisodePathFeatures(
  observations: readonly PathObservation[], entryReference: number | null = null,
): ManagedEpisodePathFeatures {
  if (observations.length === 0) {
    return {
      contractVersion: managedEpisodePathFeaturesVersion,
      maximumFavorableExcursionDollars: null, maximumAdverseExcursionDollars: null,
      peakProfitFraction: null, profitGivebackFraction: null,
      timeSinceMfeDays: null, timeSinceMaeDays: null, asOf: new Date(0).toISOString(),
    };
  }
  const latest = observations[observations.length - 1] as PathObservation;
  let mfe = observations[0] as PathObservation;
  let mae = observations[0] as PathObservation;
  for (const observation of observations) {
    if (observation.analyticalValueDollars > mfe.analyticalValueDollars) mfe = observation;
    if (observation.analyticalValueDollars < mae.analyticalValueDollars) mae = observation;
  }
  const daysBetween = (fromIso: string, toIso: string): number | null => {
    const from = Date.parse(fromIso), to = Date.parse(toIso);
    if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
    return Math.max(0, (to - from) / 86_400_000);
  };
  const peakProfitFraction = entryReference !== null && entryReference !== 0
    ? mfe.analyticalValueDollars / Math.abs(entryReference) : null;
  const profitGivebackFraction = mfe.analyticalValueDollars > 0
    ? Math.max(0, (mfe.analyticalValueDollars - latest.analyticalValueDollars) / mfe.analyticalValueDollars) : null;

  return {
    contractVersion: managedEpisodePathFeaturesVersion,
    maximumFavorableExcursionDollars: mfe.analyticalValueDollars,
    maximumAdverseExcursionDollars: mae.analyticalValueDollars,
    peakProfitFraction, profitGivebackFraction,
    timeSinceMfeDays: daysBetween(mfe.asOf, latest.asOf), timeSinceMaeDays: daysBetween(mae.asOf, latest.asOf),
    asOf: latest.asOf,
  };
}
