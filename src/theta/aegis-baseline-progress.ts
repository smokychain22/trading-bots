import { paperBootstrapAlpacaContractIvPolicy } from './aegis-alpaca-iv-stress.js';
import { paperBootstrapAegisSpreadStressPolicy } from './aegis-spread-stress.js';
import { parseOccOptionSymbol } from './account-exposure.js';

type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as ObjectValue : null;
const count = (value: unknown): number | null =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;

export type BaselineProgressState = 'AEGIS_BASELINE_NOT_OBSERVED' | 'AEGIS_BASELINE_NOT_STARTED'
  | 'AEGIS_BASELINE_ACCUMULATING' | 'AEGIS_BASELINE_PARTIAL' | 'AEGIS_BASELINE_READY';

export interface AegisBaselineProgressReceipt {
  readonly contractVersion: 'theta-aegis-baseline-progress-v1';
  readonly authority: 'EXPLAINABILITY_ONLY';
  readonly scope: 'LATEST_FUSION_SNAPSHOT';
  readonly decisionAsOf: string | null;
  readonly cohorts: readonly {
    readonly signal: 'IV_SHOCK' | 'SPREAD_WIDENING';
    readonly underlying: string;
    readonly optionType: string | null;
    readonly feed: string | null;
    readonly dteBucket: string | null;
    readonly moneynessBucket: string | null;
    readonly contractCount: number;
    readonly rawN: number | null;
    readonly sessionN: number | null;
    readonly effectiveN: number | null;
    readonly temporalSpanDays: number | null;
    readonly maturity: string;
    readonly nextMaturityRequirement: string;
  }[];
  readonly gap: { readonly state: string; readonly reason: string | null;
    readonly stressGapDetected: boolean | null };
  readonly state: BaselineProgressState;
}

function nextRequirement(signal: 'IV_SHOCK' | 'SPREAD_WIDENING', maturity: string,
  rawN: number | null, sessionN: number | null, temporalSpanDays: number | null): string {
  if (maturity === 'DETECTOR_READY') return 'NONE';
  if (maturity === 'BASELINE_NOT_STARTED') return 'FIRST_SOURCE_PROVEN_SESSION';
  if (maturity !== 'BASELINE_ACCUMULATING') return `RESOLVE_${maturity}`;
  const policy = signal === 'IV_SHOCK' ? paperBootstrapAlpacaContractIvPolicy.maturity
    : paperBootstrapAegisSpreadStressPolicy.maturity;
  if (rawN === null || sessionN === null) return 'COUNTS_UNAVAILABLE';
  const needs = [
    Math.max(0, policy.minimumRawN - rawN) > 0 ? `${policy.minimumRawN - rawN}_RAW` : null,
    Math.max(0, policy.minimumSessionN - sessionN) > 0 ? `${policy.minimumSessionN - sessionN}_SESSIONS` : null,
    temporalSpanDays === null || temporalSpanDays < policy.minimumTemporalSpanDays
      ? `${policy.minimumTemporalSpanDays}_DAY_SPAN` : null,
  ].filter((item): item is string => item !== null);
  return needs.length > 0 ? needs.join('+') : 'CURRENT_OBSERVATION_OR_COHORT_VALIDATION';
}

/** Summarizes persisted assessments only. Missing rows remain unobserved. */
export function summarizeAegisBaselineProgress(input: {
  readonly decisionAsOf: string | null;
  readonly riskState: unknown;
  readonly regimeState: unknown;
}): AegisBaselineProgressReceipt {
  const risk = object(input.riskState);
  const cohorts: AegisBaselineProgressReceipt['cohorts'][number][] = [];
  for (const [signal, container] of [
    ['IV_SHOCK', object(risk?.alpacaContractIvStress)],
    ['SPREAD_WIDENING', object(risk?.spreadStress)],
  ] as const) {
    const assessments = object(container?.assessmentsByContract);
    for (const assessmentValue of Object.values(assessments ?? {})) {
      const assessment = object(assessmentValue), maturity = object(assessment?.maturity);
      if (assessment === null || maturity === null || typeof assessment.underlying !== 'string') continue;
      const evidence = object(maturity.evidence);
      const rawN = count(evidence?.rawN), sessionN = count(evidence?.sessionN);
      const temporalSpanDays = typeof maturity.temporalSpanDays === 'number'
        && Number.isFinite(maturity.temporalSpanDays) ? maturity.temporalSpanDays : null;
      const state = typeof maturity.state === 'string' ? maturity.state : 'UNKNOWN';
      const optionType = typeof assessment.optionSymbol === 'string'
        ? parseOccOptionSymbol(assessment.optionSymbol)?.optionType ?? null : null;
      cohorts.push({ signal, underlying: assessment.underlying,
        optionType,
        feed: typeof assessment.currentFeed === 'string' ? assessment.currentFeed : null,
        dteBucket: typeof assessment.dteBucket === 'string' ? assessment.dteBucket : null,
        moneynessBucket: typeof assessment.moneynessBucket === 'string' ? assessment.moneynessBucket : null,
        contractCount: 1,
        rawN, sessionN, effectiveN: count(evidence?.effectiveN), temporalSpanDays,
        maturity: state, nextMaturityRequirement: nextRequirement(signal, state, rawN, sessionN, temporalSpanDays) });
    }
  }
  const regime = object(input.regimeState), gap = object(regime?.aegisGapStressAssessment);
  const gapState = typeof gap?.state === 'string' ? gap.state : 'NOT_OBSERVED';
  const grouped = new Map<string, typeof cohorts>();
  for (const cohort of cohorts) {
    const key = [cohort.signal, cohort.underlying, cohort.optionType, cohort.feed,
      cohort.dteBucket, cohort.moneynessBucket].join(':');
    grouped.set(key, [...(grouped.get(key) ?? []), cohort]);
  }
  const cohortSummary = [...grouped.values()].map((group) => {
    const first = group[0];
    if (first === undefined) throw new Error('AEGIS_BASELINE_EMPTY_COHORT_INTERNAL');
    const same = <K extends keyof typeof first>(key: K): typeof first[K] | null =>
      group.every((item) => item[key] === first[key]) ? first[key] : null;
    const maturity = same('maturity') ?? 'INCONSISTENT_COHORT_ASSESSMENTS';
    const rawN = same('rawN'), sessionN = same('sessionN');
    const temporalSpanDays = same('temporalSpanDays');
    return { ...first, contractCount: group.length, rawN, sessionN,
      effectiveN: same('effectiveN'), temporalSpanDays, maturity,
      nextMaturityRequirement: nextRequirement(first.signal, maturity, rawN, sessionN, temporalSpanDays) };
  });
  const states = cohortSummary.map((cohort) => cohort.maturity);
  const bothSignalsObserved = new Set(cohortSummary.map((cohort) => cohort.signal)).size === 2;
  const state: BaselineProgressState = states.length === 0 ? 'AEGIS_BASELINE_NOT_OBSERVED'
    : bothSignalsObserved && states.every((item) => item === 'DETECTOR_READY') && gapState === 'READY'
      ? 'AEGIS_BASELINE_READY'
      : bothSignalsObserved && states.every((item) => item === 'BASELINE_NOT_STARTED')
        ? 'AEGIS_BASELINE_NOT_STARTED'
        : bothSignalsObserved && states.every((item) => item === 'BASELINE_ACCUMULATING')
          ? 'AEGIS_BASELINE_ACCUMULATING'
          : 'AEGIS_BASELINE_PARTIAL';
  return { contractVersion: 'theta-aegis-baseline-progress-v1', authority: 'EXPLAINABILITY_ONLY',
    scope: 'LATEST_FUSION_SNAPSHOT',
    decisionAsOf: input.decisionAsOf, cohorts: cohortSummary, gap: { state: gapState,
      reason: typeof gap?.reason === 'string' ? gap.reason : null,
      stressGapDetected: typeof gap?.stressGapDetected === 'boolean' ? gap.stressGapDetected : null }, state };
}
