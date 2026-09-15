import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { hashJson, type JsonValue } from '../market/fusion-snapshot.js';
import { buildManagementActionFrontier, type ManagementFrontierAction } from './management-action-frontier.js';
import type { ManagementInputState } from './management-input-state.js';

export const shadowManagementPolicyVersion = 'theta-shadow-management-policy-v1' as const;
export const profitPreservationFeatureVersion = 'theta-profit-preservation-v1' as const;

export type EvidenceValueState = 'KNOWN' | 'UNKNOWN' | 'INVALID' | 'NOT_APPLICABLE';

export interface ProfitPathEvidence {
  readonly peakUnrealizedPnlSinceCapture: number | null;
  readonly captureStartedAt: string | null;
  readonly previousInput: ManagementInputState | null;
  readonly previousPreferredBranch?: string | null;
  readonly currentPreferredBranch?: string | null;
}

export interface ProfitPreservationFeatures {
  readonly featureVersion: typeof profitPreservationFeatureVersion;
  readonly state: EvidenceValueState;
  readonly initialCredit: number | null;
  readonly currentCloseCostAtAsk: number | null;
  readonly currentUnrealizedPnl: number | null;
  readonly peakUnrealizedPnlSinceCapture: number | null;
  readonly peakCoverage: 'SINCE_EVIDENCE_CAPTURE' | 'UNKNOWN';
  readonly captureStartedAt: string | null;
  readonly profitCaptureRatio: number | null;
  readonly peakCaptureRatio: number | null;
  readonly profitGiveback: number | null;
  readonly givebackRatio: number | null;
  readonly remainingRewardUpperBound: number | null;
  readonly securedCapital: number | null;
  readonly remainingCapitalDays: number | null;
  readonly remainingRewardPerCapitalDay: number | null;
  readonly remainingRewardToRisk: number | null;
  readonly preCostCloseMarkPnl: number | null;
  readonly forwardHoldValue: null;
  readonly closeAndRedeployValue: null;
  readonly unknownReasons: readonly string[];
  readonly invalidReasons: readonly string[];
}

export interface ShadowActionComparison {
  readonly action: ManagementFrontierAction;
  readonly feasibility: 'FEASIBLE' | 'INFEASIBLE' | 'UNKNOWN';
  readonly structuralValue: number | null;
  readonly structuralValueKind: 'PRE_COST_CLOSE_MARK' | 'REMAINING_REWARD_UPPER_BOUND' | null;
  readonly expectedAfterCostValue: number | null;
  readonly downsideRisk: number | null;
  readonly tailLossProxy: number | null;
  readonly capitalRequired: number | null;
  readonly incrementalCapital: number | null;
  readonly capitalDays: number | null;
  readonly remainingReward: number | null;
  readonly remainingRisk: number | null;
  readonly profitGiveback: number | null;
  readonly executionCost: number | null;
  readonly opportunityCost: number | null;
  readonly utility: number | null;
  readonly empiricalState: 'MODEL_REQUIRED' | 'EMPIRICAL_REQUIRED';
  readonly blockers: readonly string[];
}

export type ProfitPolicyDisposition = 'WOULD_CLOSE' | 'WOULD_HOLD' | 'BLOCKED_MODEL_REQUIRED' | 'NOT_APPLICABLE';

export interface ProfitPolicyChallenger {
  readonly policy: string;
  readonly disposition: ProfitPolicyDisposition;
  readonly observedTrigger: boolean | null;
  readonly executionAuthorized: false;
  readonly reasonCodes: readonly string[];
}

export interface StrategySwitchEvidence {
  readonly state: 'BLOCKED_ON_EMPIRICAL_COMPARISON';
  readonly alternatives: readonly ['STAY', 'SWITCH', 'WAIT'];
  readonly previousPreferredBranch: string | null;
  readonly currentPreferredBranch: string | null;
  readonly exitSpreadCost: number | null;
  readonly entrySpreadCost: number | null;
  readonly commissionsAndFees: number | null;
  readonly slippage: number | null;
  readonly foregoneRemainingTheta: number | null;
  readonly capitalChurn: number | null;
  readonly realizedOldPnl: number | null;
  readonly newCapitalRequirement: number | null;
  readonly incrementalDurationDays: number | null;
  readonly reasonCodes: readonly string[];
}

export interface ShadowManagementPolicyEvidence {
  readonly contractVersion: typeof shadowManagementPolicyVersion;
  readonly managementInputSnapshotId: string;
  readonly chainId: string;
  readonly observedAt: string;
  readonly lifecycleState: ManagementInputState['lifecycleState'];
  readonly profitPreservation: ProfitPreservationFeatures;
  readonly actionComparisons: readonly ShadowActionComparison[];
  readonly challengerPolicies: readonly ProfitPolicyChallenger[];
  readonly strategySwitch: StrategySwitchEvidence;
  readonly temporalSignals: {
    readonly eventStateChange: 'CHANGED' | 'UNCHANGED' | 'UNKNOWN';
    readonly flowAcceleration: null;
    readonly flowReversal: null;
    readonly reasonCodes: readonly string[];
  };
  readonly comparisonComplete: false;
  readonly shadowPreferredAction: null;
  readonly productionPolicyEvidence: null;
  readonly executionAuthorized: false;
  readonly policyReadiness: 'NOT_EMPIRICALLY_PROMOTED';
  readonly unknownReasons: readonly string[];
  readonly contentHash: string;
}

const fixedProfitPolicies = [25, 35, 40, 50, 60, 70, 75, 80, 90] as const;
const dtePolicies = [21, 14, 7] as const;

function finite(value: number | null): value is number {
  return value !== null && Number.isFinite(value);
}

function eventStateChange(previous: ManagementInputState | null, current: ManagementInputState):
  'CHANGED' | 'UNCHANGED' | 'UNKNOWN' {
  if (previous?.context.eventState == null || current.context.eventState == null) return 'UNKNOWN';
  return hashJson(previous.context.eventState as JsonValue) === hashJson(current.context.eventState as JsonValue)
    ? 'UNCHANGED' : 'CHANGED';
}

/**
 * Computes point-in-time facts only. It never predicts where the option will
 * trade next and never converts a profit percentage into an order decision.
 */
export function computeProfitPreservationFeatures(
  input: ManagementInputState,
  path: ProfitPathEvidence,
): ProfitPreservationFeatures {
  const isOpenShortOption = (input.lifecycleState === 'CSP_OPEN' || input.lifecycleState === 'CC_OPEN')
    && input.contract.contracts !== null && input.contract.contracts > 0;
  if (!isOpenShortOption) {
    return {
      featureVersion: profitPreservationFeatureVersion, state: 'NOT_APPLICABLE', initialCredit: null,
      currentCloseCostAtAsk: null, currentUnrealizedPnl: null, peakUnrealizedPnlSinceCapture: null,
      peakCoverage: 'UNKNOWN', captureStartedAt: null, profitCaptureRatio: null, peakCaptureRatio: null,
      profitGiveback: null, givebackRatio: null, remainingRewardUpperBound: null, securedCapital: null,
      remainingCapitalDays: null, remainingRewardPerCapitalDay: null, remainingRewardToRisk: null,
      preCostCloseMarkPnl: null, forwardHoldValue: null, closeAndRedeployValue: null,
      unknownReasons: [], invalidReasons: [],
    };
  }

  const unknownReasons: string[] = [];
  const invalidReasons: string[] = [];
  const initialCredit = input.economics.entryCreditDebit;
  const current = input.economics.unrealizedOptionPnl;
  const peak = path.peakUnrealizedPnlSinceCapture;
  const quantity = input.contract.contracts;
  const multiplier = input.contract.multiplier;
  const ask = input.market.optionAsk;
  if (!finite(initialCredit)) unknownReasons.push('INITIAL_CREDIT_UNKNOWN');
  else if (initialCredit <= 0) invalidReasons.push('INITIAL_CREDIT_NOT_POSITIVE');
  if (!finite(current)) unknownReasons.push('CURRENT_UNREALIZED_PNL_UNKNOWN');
  if (!finite(peak)) unknownReasons.push('PEAK_UNREALIZED_PNL_UNKNOWN');
  if (finite(peak) && finite(current) && peak < current) invalidReasons.push('PEAK_BELOW_CURRENT');
  const currentCloseCostAtAsk = finite(ask) && finite(multiplier) && finite(quantity)
    ? ask * multiplier * quantity : null;
  if (currentCloseCostAtAsk === null) unknownReasons.push('CURRENT_CLOSE_COST_UNKNOWN');

  const ratiosReady = finite(initialCredit) && initialCredit > 0 && finite(current) && finite(peak)
    && invalidReasons.length === 0;
  const profitGiveback = ratiosReady ? Math.max(0, peak - current) : null;
  const securedCapital = input.lifecycleState === 'CSP_OPEN' && finite(input.contract.strike)
    && finite(multiplier) && finite(quantity) ? input.contract.strike * multiplier * quantity : null;
  const remainingCapitalDays = finite(securedCapital) && finite(input.market.dte) && input.market.dte > 0
    ? securedCapital * input.market.dte : null;
  if (input.lifecycleState === 'CSP_OPEN' && remainingCapitalDays === null) {
    unknownReasons.push(input.market.dte === 0 ? 'REMAINING_CAPITAL_DAYS_ZERO' : 'REMAINING_CAPITAL_DAYS_UNKNOWN');
  }
  const remainingRewardUpperBound = finite(initialCredit) && initialCredit > 0 && finite(current)
    ? Math.max(0, initialCredit - current) : null;
  return {
    featureVersion: profitPreservationFeatureVersion,
    state: invalidReasons.length > 0 ? 'INVALID' : unknownReasons.length > 0 ? 'UNKNOWN' : 'KNOWN',
    initialCredit: finite(initialCredit) ? initialCredit : null,
    currentCloseCostAtAsk,
    currentUnrealizedPnl: finite(current) ? current : null,
    peakUnrealizedPnlSinceCapture: finite(peak) ? peak : null,
    peakCoverage: path.captureStartedAt === null ? 'UNKNOWN' : 'SINCE_EVIDENCE_CAPTURE',
    captureStartedAt: path.captureStartedAt,
    profitCaptureRatio: ratiosReady ? current / initialCredit : null,
    peakCaptureRatio: ratiosReady ? peak / initialCredit : null,
    profitGiveback,
    givebackRatio: profitGiveback !== null && finite(peak) && peak > 0 ? profitGiveback / peak : null,
    remainingRewardUpperBound,
    securedCapital,
    remainingCapitalDays,
    remainingRewardPerCapitalDay: remainingRewardUpperBound !== null && remainingCapitalDays !== null
      ? remainingRewardUpperBound / remainingCapitalDays : null,
    remainingRewardToRisk: null,
    preCostCloseMarkPnl: finite(current) ? current : null,
    forwardHoldValue: null,
    closeAndRedeployValue: null,
    unknownReasons: [...new Set([...unknownReasons, 'DOWNSIDE_TAIL_MODEL_REQUIRED',
      'FORWARD_HOLD_EV_MODEL_REQUIRED', 'REDEPLOY_OPPORTUNITY_SET_REQUIRED', 'EXECUTION_COST_EMPIRICAL_REQUIRED'])].sort(),
    invalidReasons: [...new Set(invalidReasons)].sort(),
  };
}

function challengerPolicies(features: ProfitPreservationFeatures, dte: number | null): readonly ProfitPolicyChallenger[] {
  const fixed = fixedProfitPolicies.map((percent): ProfitPolicyChallenger => ({
    policy: `FIXED_${percent}`,
    disposition: features.profitCaptureRatio === null ? 'NOT_APPLICABLE'
      : features.profitCaptureRatio >= percent / 100 ? 'WOULD_CLOSE' : 'WOULD_HOLD',
    observedTrigger: features.profitCaptureRatio === null ? null : features.profitCaptureRatio >= percent / 100,
    executionAuthorized: false,
    reasonCodes: ['RESEARCH_CHALLENGER_ONLY', 'PERCENTAGE_IS_OBSERVATION_NOT_AUTHORITY'],
  }));
  const timed = dtePolicies.map((days): ProfitPolicyChallenger => ({
    policy: `DTE_${days}`,
    disposition: dte === null ? 'NOT_APPLICABLE' : dte <= days ? 'WOULD_CLOSE' : 'WOULD_HOLD',
    observedTrigger: dte === null ? null : dte <= days,
    executionAuthorized: false,
    reasonCodes: ['RESEARCH_CHALLENGER_ONLY', 'DTE_IS_OBSERVATION_NOT_AUTHORITY'],
  }));
  const fiftyOr21 = features.profitCaptureRatio === null || dte === null ? null
    : features.profitCaptureRatio >= 0.5 || dte <= 21;
  const modelPolicies = ['DYNAMIC_REMAINING_EV', 'DYNAMIC_PROFIT_GIVEBACK', 'EVENT_AWARE', 'REGIME_AWARE']
    .map((policy): ProfitPolicyChallenger => ({ policy, disposition: 'BLOCKED_MODEL_REQUIRED', observedTrigger: null,
      executionAuthorized: false, reasonCodes: ['FORWARD_EV_MODEL_REQUIRED', 'RESEARCH_CHALLENGER_ONLY'] }));
  return [...fixed, ...timed, {
    policy: 'FIFTY_PERCENT_OR_DTE_21',
    disposition: fiftyOr21 === null ? 'NOT_APPLICABLE' : fiftyOr21 ? 'WOULD_CLOSE' : 'WOULD_HOLD',
    observedTrigger: fiftyOr21, executionAuthorized: false,
    reasonCodes: ['RESEARCH_CHALLENGER_ONLY', 'FIXED_POLICY_NOT_PRODUCTION_AUTHORITY'],
  }, { policy: 'HOLD_TO_EXPIRY', disposition: 'WOULD_HOLD', observedTrigger: true, executionAuthorized: false,
    reasonCodes: ['RESEARCH_CHALLENGER_ONLY'] }, ...modelPolicies];
}

export function buildShadowManagementPolicyEvidence(
  input: ManagementInputState,
  path: ProfitPathEvidence,
): ShadowManagementPolicyEvidence {
  const profitPreservation = computeProfitPreservationFeatures(input, path);
  const frontier = buildManagementActionFrontier(input);
  const actionComparisons = frontier.actions.map((action): ShadowActionComparison => ({
    action: action.action, feasibility: action.feasibility,
    structuralValue: action.action === 'CLOSE_FULL' || action.action === 'CLOSE_CC'
      ? profitPreservation.preCostCloseMarkPnl
      : action.action === 'HOLD' || action.action === 'HOLD_CC'
        ? profitPreservation.remainingRewardUpperBound : null,
    structuralValueKind: action.action === 'CLOSE_FULL' || action.action === 'CLOSE_CC'
      ? 'PRE_COST_CLOSE_MARK'
      : action.action === 'HOLD' || action.action === 'HOLD_CC'
        ? 'REMAINING_REWARD_UPPER_BOUND' : null,
    expectedAfterCostValue: null,
    downsideRisk: null, tailLossProxy: null,
    capitalRequired: action.action === 'HOLD' ? profitPreservation.securedCapital : null,
    incrementalCapital: null, capitalDays: profitPreservation.remainingCapitalDays,
    remainingReward: action.action === 'HOLD' || action.action === 'HOLD_CC'
      ? profitPreservation.remainingRewardUpperBound : null,
    remainingRisk: null, profitGiveback: profitPreservation.profitGiveback,
    executionCost: null, opportunityCost: null, utility: null,
    empiricalState: action.action === 'CLOSE_FULL' || action.action === 'CLOSE_CC' || action.action === 'SELL_STOCK'
      ? 'EMPIRICAL_REQUIRED' : 'MODEL_REQUIRED',
    blockers: [...new Set([...action.blockers, 'EXPECTED_AFTER_COST_VALUE_UNKNOWN'])].sort(),
  }));
  const eventChange = eventStateChange(path.previousInput, input);
  const unsigned = {
    contractVersion: shadowManagementPolicyVersion,
    managementInputSnapshotId: input.managementInputSnapshotId, chainId: input.chainId,
    observedAt: input.observedAt, lifecycleState: input.lifecycleState, profitPreservation,
    actionComparisons, challengerPolicies: challengerPolicies(profitPreservation, input.market.dte),
    strategySwitch: {
      state: 'BLOCKED_ON_EMPIRICAL_COMPARISON' as const,
      alternatives: ['STAY', 'SWITCH', 'WAIT'] as const,
      previousPreferredBranch: path.previousPreferredBranch ?? null,
      currentPreferredBranch: path.currentPreferredBranch ?? null,
      exitSpreadCost: null, entrySpreadCost: null, commissionsAndFees: null, slippage: null,
      foregoneRemainingTheta: null, capitalChurn: null, realizedOldPnl: input.economics.wholeChainPnl,
      newCapitalRequirement: null, incrementalDurationDays: null,
      reasonCodes: [
        path.previousPreferredBranch !== undefined && path.currentPreferredBranch !== undefined
          && path.previousPreferredBranch !== path.currentPreferredBranch ? 'BRANCH_PREFERENCE_CHANGED' : 'BRANCH_SWITCH_STATE_INCOMPLETE',
        'SWITCHING_COSTS_REQUIRED', 'EMPIRICAL_BRANCH_ECONOMICS_REQUIRED',
      ],
    },
    temporalSignals: {
      eventStateChange: eventChange, flowAcceleration: null, flowReversal: null,
      reasonCodes: ['FLOW_SERIES_SCHEMA_REQUIRED', ...(eventChange === 'UNKNOWN' ? ['EVENT_STATE_HISTORY_REQUIRED'] : [])],
    },
    comparisonComplete: false as const, shadowPreferredAction: null, productionPolicyEvidence: null,
    executionAuthorized: false as const, policyReadiness: 'NOT_EMPIRICALLY_PROMOTED' as const,
    unknownReasons: [...new Set([...profitPreservation.unknownReasons,
      'ACTION_UTILITIES_UNKNOWN', 'STRATEGY_SWITCH_ECONOMICS_UNKNOWN'])].sort(),
  };
  return { ...unsigned, contentHash: hashJson(unsigned as unknown as JsonValue) };
}

/** Immutable persistence for research-only management evidence. */
export class PostgresShadowManagementPolicyStore {
  constructor(private readonly pool: Pool) {}

  async assembleAndPersist(states: readonly ManagementInputState[]): Promise<readonly ShadowManagementPolicyEvidence[]> {
    const evidence: ShadowManagementPolicyEvidence[] = [];
    for (const state of states) {
      const history = await this.pool.query<{
        previous_input: ManagementInputState | null;
        peak_unrealized_pnl: string | number | null;
        capture_started_at: Date | string | null;
        previous_preferred_branch: string | null;
        current_preferred_branch: string | null;
      }>(`SELECT previous.input_json AS previous_input,
          stats.peak_unrealized_pnl,stats.capture_started_at,
          previous_frontier.selected_branch AS previous_preferred_branch,
          current_frontier.selected_branch AS current_preferred_branch
        FROM trade.management_input_snapshot current
        LEFT JOIN trade.management_input_snapshot previous
          ON previous.management_input_snapshot_id=current.previous_management_input_snapshot_id
        LEFT JOIN LATERAL (
          SELECT frontier.selected_branch FROM trade.canonical_strategy_frontier frontier
          WHERE frontier.fusion_snapshot_id=current.fusion_snapshot_id
          ORDER BY frontier.observed_at DESC LIMIT 1
        ) current_frontier ON true
        LEFT JOIN LATERAL (
          SELECT frontier.selected_branch FROM trade.canonical_strategy_frontier frontier
          WHERE frontier.fusion_snapshot_id=previous.fusion_snapshot_id
          ORDER BY frontier.observed_at DESC LIMIT 1
        ) previous_frontier ON true
        LEFT JOIN LATERAL (
          SELECT max((history.input_json #>> '{economics,unrealizedOptionPnl}')::numeric) AS peak_unrealized_pnl,
            min(history.observed_at) AS capture_started_at
          FROM trade.management_input_snapshot history WHERE history.chain_id=current.chain_id
            AND history.observed_at<=current.observed_at
            AND jsonb_typeof(history.input_json #> '{economics,unrealizedOptionPnl}')='number'
        ) stats ON true
        WHERE current.management_input_snapshot_id=$1`, [state.managementInputSnapshotId]);
      const row = history.rows[0];
      const rawPeak = row?.peak_unrealized_pnl;
      const peak = rawPeak === null || rawPeak === undefined ? null : Number(rawPeak);
      const item = buildShadowManagementPolicyEvidence(state, {
        peakUnrealizedPnlSinceCapture: Number.isFinite(peak) ? peak : null,
        captureStartedAt: row?.capture_started_at instanceof Date ? row.capture_started_at.toISOString()
          : row?.capture_started_at == null ? null : String(row.capture_started_at),
        previousInput: row?.previous_input ?? null,
        previousPreferredBranch: row?.previous_preferred_branch ?? null,
        currentPreferredBranch: row?.current_preferred_branch ?? null,
      });
      await this.pool.query(`INSERT INTO research.theta_shadow_management_policy_evidence(
        shadow_policy_evidence_id,management_input_snapshot_id,chain_id,observed_at,lifecycle_state,
        policy_version,feature_version,evidence_state,profit_state_json,action_comparisons_json,
        challenger_policies_json,strategy_switch_json,temporal_signals_json,comparison_complete,
        shadow_preferred_action,production_policy_evidence_json,execution_authorized,policy_readiness,
        unknown_reasons_json,content_hash)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11::jsonb,$12::jsonb,$13::jsonb,
          false,NULL,NULL,false,'NOT_EMPIRICALLY_PROMOTED',$14::jsonb,$15)
        ON CONFLICT(management_input_snapshot_id,policy_version) DO NOTHING`, [randomUUID(), state.managementInputSnapshotId, state.chainId,
        state.observedAt, state.lifecycleState, item.contractVersion, item.profitPreservation.featureVersion,
        item.profitPreservation.state, JSON.stringify(item.profitPreservation), JSON.stringify(item.actionComparisons),
        JSON.stringify(item.challengerPolicies), JSON.stringify(item.strategySwitch), JSON.stringify(item.temporalSignals),
        JSON.stringify(item.unknownReasons), item.contentHash]);
      evidence.push(item);
    }
    return evidence;
  }
}
