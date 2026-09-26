/**
 * COMMAND 5B item 12: Optionomics flow research. Research-only,
 * `brokerAuthority: false`. Defines matched/controlled cohorts for testing
 * whether Optionomics flow/unusual-activity data adds real value beyond
 * base features -- a BASE_MODEL vs BASE_MODEL_PLUS_FLOW comparison
 * CONTRACT, not a real trained comparison (no real resolved episodes exist
 * yet). Never converts flow into a Production hard gate from this module.
 */

export const optionomicsFlowValueStudyVersion = 'theta-optionomics-flow-value-study-v1' as const;

export type FlowCohort = 'FLOW_STRONG' | 'FLOW_NEUTRAL' | 'FLOW_BEARISH';
export type UnusualActivityCohort = 'UNUSUAL_ACTIVITY_PRESENT' | 'UNUSUAL_ACTIVITY_ABSENT';

/** The matching/control variables the directive requires before any flow
 * comparison is defensible -- every field is required so a caller cannot
 * silently omit a confound. */
export interface FlowMatchControls {
  readonly underlying: string;
  readonly dte: number;
  readonly delta: number;
  readonly iv: number | null;
  readonly rv: number | null;
  readonly regime: string | null;
  readonly trend: string | null;
  readonly eventProximityDays: number | null;
  readonly liquidityBucket: string | null;
  readonly spreadPct: number | null;
  readonly timeOfDayBucket: string | null;
  readonly marketState: string | null;
}

export interface FlowStudySubject {
  readonly subjectId: string;
  readonly decisionAt: string;
  readonly flowCohort: FlowCohort;
  readonly unusualActivityCohort: UnusualActivityCohort;
  readonly controls: FlowMatchControls;
}

export interface FlowIncrementalValueReport {
  readonly contractVersion: typeof optionomicsFlowValueStudyVersion;
  readonly baseModelId: string;
  readonly baseModelVersion: string;
  readonly basePlusFlowModelId: string;
  readonly basePlusFlowModelVersion: string;
  /** Every incremental-value field stays null until a real comparison has
   * been run against real matched cohorts -- never a fabricated lift. */
  readonly incrementalPredictiveValue: number | null;
  readonly incrementalCalibrationImprovement: number | null;
  readonly incrementalEconomicRankingImprovement: number | null;
  readonly tailDiscrimination: number | null;
  readonly confidenceIntervalLow: number | null;
  readonly confidenceIntervalHigh: number | null;
  readonly independentN: number | null;
  readonly evaluatedAt: string | null;
}

/** Two subjects are a valid matched pair only if every control variable
 * that must match, matches -- underlying/DTE/regime must be exact,
 * delta/IV/RV/spread within a caller-supplied tolerance. Returns false
 * (never throws) so a caller can filter a candidate pool cheaply. */
export function isValidMatchedPair(
  a: FlowMatchControls, b: FlowMatchControls,
  tolerances: { readonly delta: number; readonly iv: number; readonly rv: number; readonly spreadPct: number },
): boolean {
  if (a.underlying !== b.underlying) return false;
  if (a.dte !== b.dte) return false;
  if (a.regime !== b.regime) return false;
  if (Math.abs(a.delta - b.delta) > tolerances.delta) return false;
  if (a.iv !== null && b.iv !== null && Math.abs(a.iv - b.iv) > tolerances.iv) return false;
  if (a.rv !== null && b.rv !== null && Math.abs(a.rv - b.rv) > tolerances.rv) return false;
  if (a.spreadPct !== null && b.spreadPct !== null && Math.abs(a.spreadPct - b.spreadPct) > tolerances.spreadPct) return false;
  return true;
}

/** The honest, un-evaluated starting report -- every incremental-value
 * field null, since no real comparison has been run. */
export function buildUnevaluatedIncrementalValueReport(input: {
  readonly baseModelId: string; readonly baseModelVersion: string;
  readonly basePlusFlowModelId: string; readonly basePlusFlowModelVersion: string;
}): FlowIncrementalValueReport {
  return {
    contractVersion: optionomicsFlowValueStudyVersion, ...input,
    incrementalPredictiveValue: null, incrementalCalibrationImprovement: null,
    incrementalEconomicRankingImprovement: null, tailDiscrimination: null,
    confidenceIntervalLow: null, confidenceIntervalHigh: null, independentN: null, evaluatedAt: null,
  };
}
