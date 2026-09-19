export const managementCounterfactualAnalysisVersion = 'theta-management-counterfactual-analysis-v1' as const;

export type CounterfactualOutcomeState = 'RESOLVED' | 'NO_FILL' | 'UNRESOLVED' | 'BLOCKED_ON_DATA';
export type CounterfactualSource = 'BROKER_ACTUAL' | 'DEFENSIBLE_REPLAY';

export interface ManagementOutcomeObservation {
  readonly action: string;
  readonly source: CounterfactualSource;
  readonly state: CounterfactualOutcomeState;
  readonly labelAvailableAt: string | null;
  readonly wholeChainNetPnl: number | null;
  readonly returnPerCapitalDay: number | null;
  readonly maxAdverseExcursion: number | null;
  readonly executionCost: number | null;
  readonly fillModelVersion: string | null;
  readonly evidenceId: string;
}

export interface ManagementCounterfactualInput {
  readonly decisionId: string;
  readonly chainId: string;
  readonly decidedAt: string;
  readonly featureCutoff: string;
  readonly selectedAction: string;
  readonly outcomes: readonly ManagementOutcomeObservation[];
}

export interface ManagementCounterfactualComparison {
  readonly selectedAction: string;
  readonly alternativeAction: string;
  readonly state: 'COMPARABLE' | 'NO_FILL' | 'UNRESOLVED' | 'BLOCKED_ON_DATA';
  readonly netPnlDifference: number | null;
  readonly returnPerCapitalDayDifference: number | null;
  readonly maxAdverseExcursionDifference: number | null;
  readonly executionCostDifference: number | null;
}

export interface ManagementCounterfactualAnalysis {
  readonly contractVersion: typeof managementCounterfactualAnalysisVersion;
  readonly decisionId: string;
  readonly chainId: string;
  readonly status: 'COMPLETE' | 'PARTIAL' | 'BLOCKED_ON_DATA';
  readonly comparisons: readonly ManagementCounterfactualComparison[];
  readonly blockers: readonly string[];
  readonly executionAuthorized: false;
}

const time = (value: string, code: string): number => {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(code);
  return parsed;
};
const finiteOrNull = (value: number | null): boolean => value === null || Number.isFinite(value);
const difference = (alternative: number | null, selected: number | null): number | null =>
  alternative === null || selected === null ? null : alternative - selected;

export function analyzeManagementCounterfactuals(input: ManagementCounterfactualInput): ManagementCounterfactualAnalysis {
  if (!input.decisionId.trim() || !input.chainId.trim() || !input.selectedAction.trim()) {
    throw new Error('MANAGEMENT_COUNTERFACTUAL_IDENTITY_INVALID');
  }
  const decidedAt = time(input.decidedAt, 'MANAGEMENT_COUNTERFACTUAL_DECISION_TIME_INVALID');
  if (time(input.featureCutoff, 'MANAGEMENT_COUNTERFACTUAL_FEATURE_CUTOFF_INVALID') > decidedAt) {
    throw new Error('MANAGEMENT_COUNTERFACTUAL_FEATURE_LEAKAGE');
  }
  const selected = input.outcomes.find((outcome) => outcome.action === input.selectedAction);
  if (selected === undefined || selected.source !== 'BROKER_ACTUAL') {
    throw new Error('MANAGEMENT_COUNTERFACTUAL_SELECTED_BROKER_OUTCOME_MISSING');
  }
  const actions = new Set<string>();
  for (const outcome of input.outcomes) {
    if (actions.has(outcome.action)) throw new Error(`MANAGEMENT_COUNTERFACTUAL_DUPLICATE_ACTION:${outcome.action}`);
    actions.add(outcome.action);
    if (!outcome.action.trim() || !outcome.evidenceId.trim()) throw new Error('MANAGEMENT_COUNTERFACTUAL_EVIDENCE_INVALID');
    if (![outcome.wholeChainNetPnl, outcome.returnPerCapitalDay, outcome.maxAdverseExcursion,
      outcome.executionCost].every(finiteOrNull)) throw new Error(`MANAGEMENT_COUNTERFACTUAL_NONFINITE:${outcome.action}`);
    if (outcome.state === 'RESOLVED') {
      if (outcome.labelAvailableAt === null || time(outcome.labelAvailableAt,
        `MANAGEMENT_COUNTERFACTUAL_LABEL_TIME_INVALID:${outcome.action}`) <= decidedAt) {
        throw new Error(`MANAGEMENT_COUNTERFACTUAL_LABEL_LEAKAGE:${outcome.action}`);
      }
      if (outcome.source === 'DEFENSIBLE_REPLAY' && !outcome.fillModelVersion?.trim()) {
        throw new Error(`MANAGEMENT_COUNTERFACTUAL_FILL_MODEL_MISSING:${outcome.action}`);
      }
    }
  }
  const blockers: string[] = [];
  if (selected.state !== 'RESOLVED') blockers.push(`SELECTED_OUTCOME_${selected.state}`);
  const comparisons = input.outcomes.filter((outcome) => outcome.action !== input.selectedAction).map((alternative) => {
    const state = selected.state === 'BLOCKED_ON_DATA' || alternative.state === 'BLOCKED_ON_DATA' ? 'BLOCKED_ON_DATA'
      : selected.state === 'UNRESOLVED' || alternative.state === 'UNRESOLVED' ? 'UNRESOLVED'
        : selected.state === 'NO_FILL' || alternative.state === 'NO_FILL' ? 'NO_FILL' : 'COMPARABLE';
    if (state !== 'COMPARABLE') blockers.push(`${alternative.action}_${state}`);
    return {
      selectedAction:input.selectedAction, alternativeAction:alternative.action, state,
      netPnlDifference:state === 'COMPARABLE' ? difference(alternative.wholeChainNetPnl, selected.wholeChainNetPnl) : null,
      returnPerCapitalDayDifference:state === 'COMPARABLE' ? difference(alternative.returnPerCapitalDay, selected.returnPerCapitalDay) : null,
      maxAdverseExcursionDifference:state === 'COMPARABLE' ? difference(alternative.maxAdverseExcursion, selected.maxAdverseExcursion) : null,
      executionCostDifference:state === 'COMPARABLE' ? difference(alternative.executionCost, selected.executionCost) : null,
    } as const;
  });
  const comparable = comparisons.filter((row) => row.state === 'COMPARABLE').length;
  const status = comparable === comparisons.length && comparisons.length > 0 ? 'COMPLETE'
    : comparable > 0 ? 'PARTIAL' : 'BLOCKED_ON_DATA';
  return {
    contractVersion:managementCounterfactualAnalysisVersion, decisionId:input.decisionId, chainId:input.chainId,
    status, comparisons, blockers:[...new Set(blockers)].sort(), executionAuthorized:false,
  };
}
