import { createHash, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { withRuntimePostgresTransaction } from './runtime-postgres-client.js';
import { canonicalJson } from '../research/point-in-time-evidence.js';
import type { ScanCompleteness } from '../research/shadow-evidence-runtime.js';
import type { StrategyQualityShadowDiagnostic } from '../research/strategy-quality-shadow-diagnostics.js';
import type { UniverseBreadthShadowPlan } from '../research/strategy-quality-shadow-diagnostics.js';
import type { UniverseDiscoveryFunnel } from './universe-discovery.js';
import type { FirstPaperRuntimeTelemetry } from './first-paper-runtime-telemetry.js';

export const runtimeBehaviorDiagnosticVersion = 'theta-runtime-behavior-diagnostic-v5' as const;

export interface RuntimeReadOnlyPreSubmitProof {
  readonly symbol: string;
  readonly planState: 'BLOCKED' | 'READY';
  readonly planBlockers: readonly string[];
  readonly preSubmitState: 'NOT_REACHED' | 'BLOCKED' | 'NO_QUOTE' | 'QUOTE_REJECTED' | 'PRICE_REJECTED'
    | 'READY_TO_SUBMIT_BUT_DISABLED' | 'PROVIDER_ERROR' | 'INTERNAL_ERROR';
  readonly preSubmitBlockers: readonly string[];
  readonly optionSymbol: string | null;
  readonly quoteProvider: string | null;
  readonly quoteSemantics: string | null;
  readonly quoteAgeMs: number | null;
  readonly limitPrice: number | null;
  readonly quoteAgePolicyVersion: string | null;
  readonly brokerMutationSurface: false;
}

export interface RuntimeFirstPaperSymbolEvidence {
  readonly symbol: string;
  readonly cycleState: 'COMPLETED' | 'FAILED';
  readonly cycleErrorCode: string | null;
  readonly optionChainComplete: boolean | null;
  readonly optionContractsComplete: boolean | null;
  readonly qLatticeTotal: number;
  readonly qDecision: string | null;
  readonly qReasonCodes: readonly string[];
  readonly selectedCandidateId: string | null;
  readonly selectedOptionSymbol: string | null;
  readonly canonicalAction: string | null;
  readonly selectedQuantity: number;
  readonly aegisState: string | null;
  readonly entrySafetyPolicy: null | {
    readonly action: 'BLOCK' | 'CLEAR';
    readonly companyEventState: string;
    readonly corporateActionState: string;
    readonly decisionAsOf: string;
  };
  readonly runtimeTelemetry: FirstPaperRuntimeTelemetry | null;
  readonly cycleBlockers: readonly string[];
  readonly preSubmit: RuntimeReadOnlyPreSubmitProof | null;
}

export interface RuntimeFirstPaperEvidence {
  readonly version: 'theta-first-paper-runtime-evidence-v1';
  readonly symbols: readonly RuntimeFirstPaperSymbolEvidence[];
  readonly brokerMutationSurface: false;
}

export interface RuntimeStrategyDiagnostic {
  readonly branch: string;
  readonly status: 'RESEARCH_ONLY' | 'SHADOW';
  readonly consideredCount: number;
  readonly applicableCount: number;
  readonly evaluatedCount: number;
  readonly rejectedCount: number;
  readonly candidateCount: number;
  readonly hardGateRejectionCount: number;
  readonly dataUnknownCount: number;
  readonly routeReasons: readonly string[];
  readonly hardGates: Readonly<Record<string, number>>;
  readonly missingDataReasons: Readonly<Record<string, number>>;
  readonly reachabilityState: 'REACHED' | 'NOT_APPLICABLE_CURRENT_SCAN' | 'BLOCKED_WHEN_APPLICABLE';
}

export interface BestRejectedCandidateDiagnostic {
  readonly symbol: string;
  readonly branch: string;
  readonly candidateId: string;
  readonly hardBlockers: readonly string[];
  readonly unknownEvidence: readonly string[];
}

export type WaitClassification =
  | 'ACTION_READY'
  | 'HEALTHY_WAIT'
  | 'NO_OPPORTUNITY'
  | 'RISK_WAIT'
  | 'QUOTE_WAIT'
  | 'DATA_WAIT'
  | 'OVERSTRICT_POLICY_WAIT'
  | 'POSSIBLE_LOGIC_PARALYSIS';

export type OvertradingState =
  | 'NO_NEW_ACTION'
  | 'SINGLE_BOUNDED_ACTION'
  | 'MULTIPLE_ACTION_PLANS_SAME_SCAN';

export interface RuntimeBehaviorDiagnosticInput {
  readonly scanId: string;
  readonly decisionIds: readonly string[];
  readonly observedAt: string;
  readonly session: 'OPEN' | 'CLOSED' | 'UNCONFIRMED' | 'MIXED' | 'UNKNOWN';
  readonly universeSize: number;
  readonly strategiesConsidered: number;
  readonly strategiesApplicable: number;
  readonly strategiesRejected: number;
  readonly strategyDiagnostics: readonly RuntimeStrategyDiagnostic[];
  readonly completeness: ScanCompleteness;
  readonly globalWaitEarned: boolean;
  readonly globalWaitReasons: readonly string[];
  readonly candidateCount: number;
  readonly feasibleCandidateCount: number;
  readonly selectedCandidateCount: number;
  readonly hardRejectedCount: number;
  readonly softRankedCount: number;
  readonly dataInsufficientCount: number;
  readonly quantityZeroCount: number;
  readonly aegisVetoCount: number;
  readonly nearMissCount: number;
  readonly softEconomicRejectionCount: number;
  readonly dataUnknownRejectionCount: number;
  readonly quoteRejectionCount: number;
  readonly liquidityRejectionCount: number;
  readonly hardGateCounts: Readonly<Record<string, number>>;
  readonly finalAction: 'ACTION_READY' | 'WAIT' | 'SYSTEM_HOLD';
  readonly waitReasons: readonly string[];
  readonly bestRejectedCandidates: readonly BestRejectedCandidateDiagnostic[];
  readonly antiParalysisFindings: readonly string[];
  readonly providerBlockers: readonly string[];
  readonly actionPlansReady: number;
  readonly actionPlanBlockers: readonly string[];
  readonly strategyQualityChallengers?: readonly StrategyQualityShadowDiagnostic[];
  readonly universeBreadthChallenger?: UniverseBreadthShadowPlan;
  readonly universeDiscoveryFunnel?: UniverseDiscoveryFunnel;
  readonly firstPaperEvidence?: RuntimeFirstPaperEvidence;
}

export interface RuntimeBehaviorDiagnostic extends RuntimeBehaviorDiagnosticInput {
  readonly contractVersion: typeof runtimeBehaviorDiagnosticVersion;
  readonly waitClassification: WaitClassification;
  readonly overtradingState: OvertradingState;
  readonly consecutiveWaitCycles: number;
  readonly lastBrokerActionAt: string | null;
  readonly secondsSinceLastBrokerAction: number | null;
  readonly reasonCodes: readonly string[];
  readonly thresholdPolicyState: 'NO_EMPIRICAL_FREQUENCY_THRESHOLD';
  readonly contentHash: string;
}

const quoteBlocker = (value: string): boolean => /QUOTE|BBO|OPRA|ORDER_PRICING|ENTITLEMENT/.test(value);
const riskBlocker = (value: string): boolean => /AEGIS|QUANTITY|ACCOUNT|ASSIGNMENT|COLLATERAL|CONCENTRATION|CONFLICT|BUYING_POWER/.test(value);

export function deriveAntiParalysisFindings(input: {
  readonly candidateHardBlockers: readonly (readonly string[])[];
  readonly strategyReachability: readonly {
    branch: string; status: 'RESEARCH_ONLY' | 'SHADOW'; consideredCount: number;
    applicableCount: number; reachabilityState: RuntimeStrategyDiagnostic['reachabilityState'];
  }[];
}): readonly string[] {
  const otherwiseValid=input.candidateHardBlockers.filter((blockers)=>blockers.length<=1);
  const gates=[...new Set(otherwiseValid.flatMap((blockers)=>blockers))];
  return [
    ...gates.filter((gate)=>otherwiseValid.length>0
      &&otherwiseValid.filter((blockers)=>blockers.length===1&&blockers[0]===gate).length/otherwiseValid.length>0.9)
      .map((gate)=>`DOMINANT_HARD_GATE_OBSERVED:${gate}`),
    ...input.strategyReachability.filter((strategy)=>strategy.status==='SHADOW'&&strategy.consideredCount>0
      &&strategy.applicableCount>0&&strategy.reachabilityState==='BLOCKED_WHEN_APPLICABLE')
      .map((strategy)=>`SHADOW_STRATEGY_UNREACHABLE:${strategy.branch}`),
  ].toSorted();
}

export function classifyRuntimeBehavior(input: RuntimeBehaviorDiagnosticInput): {
  readonly waitClassification: WaitClassification;
  readonly overtradingState: OvertradingState;
  readonly reasonCodes: readonly string[];
} {
  if (input.feasibleCandidateCount > input.candidateCount || input.selectedCandidateCount > input.candidateCount) {
    throw new Error('RUNTIME_BEHAVIOR_DIAGNOSTIC_COUNTS_INVALID');
  }
  const blockers = [...new Set([...input.providerBlockers, ...input.actionPlanBlockers])].toSorted();
  const overtradingState: OvertradingState = input.actionPlansReady === 0 ? 'NO_NEW_ACTION'
    : input.actionPlansReady === 1 ? 'SINGLE_BOUNDED_ACTION' : 'MULTIPLE_ACTION_PLANS_SAME_SCAN';
  let waitClassification: WaitClassification;
  if (input.actionPlansReady > 0) waitClassification = 'ACTION_READY';
  else if (input.providerBlockers.length > 0 || (input.completeness !== 'COMPLETE' && input.completeness !== 'DATA_INSUFFICIENT')) waitClassification = 'DATA_WAIT';
  else if (input.completeness === 'DATA_INSUFFICIENT' || input.candidateCount === 0) waitClassification = 'NO_OPPORTUNITY';
  else if (blockers.some(quoteBlocker)) waitClassification = 'QUOTE_WAIT';
  else if (input.aegisVetoCount > 0 || input.quantityZeroCount > 0 || blockers.some(riskBlocker)) waitClassification = 'RISK_WAIT';
  else if (input.antiParalysisFindings.length > 0) waitClassification = 'POSSIBLE_LOGIC_PARALYSIS';
  else if (input.globalWaitEarned) waitClassification = 'HEALTHY_WAIT';
  else if (input.feasibleCandidateCount > 0 && input.selectedCandidateCount === 0) waitClassification = 'OVERSTRICT_POLICY_WAIT';
  else waitClassification = 'POSSIBLE_LOGIC_PARALYSIS';

  const reasonCodes = [
    `WAIT_CLASSIFICATION_${waitClassification}`,
    `OVERTRADING_STATE_${overtradingState}`,
    ...input.globalWaitReasons,
    ...blockers,
    ...(input.feasibleCandidateCount > 0 ? ['FEASIBLE_CANDIDATE_OBSERVED'] : []),
    ...(input.nearMissCount > 0 ? ['NEAR_MISS_OBSERVED'] : []),
    ...input.antiParalysisFindings,
    'NO_EMPIRICAL_FREQUENCY_THRESHOLD',
  ];
  return { waitClassification, overtradingState, reasonCodes: [...new Set(reasonCodes)].toSorted() };
}

type PreviousDiagnostic = { readonly wait_classification: WaitClassification; readonly consecutive_wait_cycles: number };

export class PostgresRuntimeBehaviorDiagnosticStore {
  constructor(private readonly pool: Pool) {}

  async persist(input: RuntimeBehaviorDiagnosticInput): Promise<RuntimeBehaviorDiagnostic> {
    return withRuntimePostgresTransaction(this.pool, async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['THETA_RUNTIME_BEHAVIOR_DIAGNOSTIC']);
      const existing = await client.query(
        `SELECT diagnostic_json FROM research.theta_runtime_behavior_diagnostic WHERE scan_id=$1`, [input.scanId],
      );
      if (existing.rowCount === 1) {
        return existing.rows[0]?.diagnostic_json as RuntimeBehaviorDiagnostic;
      }
      const previous = await client.query<PreviousDiagnostic>(
        `SELECT wait_classification,consecutive_wait_cycles FROM research.theta_runtime_behavior_diagnostic
         ORDER BY observed_at DESC,created_at DESC LIMIT 1 FOR SHARE`,
      );
      const lastAction = await client.query<{ last_action_at: string | null }>(
        `SELECT max(action_at) AS last_action_at FROM (
           SELECT created_at AS action_at FROM trade.order_intent
           UNION ALL
           SELECT applied_at AS action_at FROM trade.lifecycle_application
         ) actions`,
      );
      const classification = classifyRuntimeBehavior(input);
      const isWait = classification.waitClassification !== 'ACTION_READY';
      const previousRow = previous.rows[0];
      const consecutiveWaitCycles = isWait
        ? previousRow === undefined || previousRow.wait_classification === 'ACTION_READY'
          ? 1 : Number(previousRow.consecutive_wait_cycles) + 1
        : 0;
      const lastBrokerActionAt = lastAction.rows[0]?.last_action_at === null || lastAction.rows[0]?.last_action_at === undefined
        ? null : new Date(lastAction.rows[0].last_action_at).toISOString();
      const secondsSinceLastBrokerAction = lastBrokerActionAt === null ? null
        : Math.max(0, (Date.parse(input.observedAt) - Date.parse(lastBrokerActionAt)) / 1000);
      const payload = {
        contractVersion: runtimeBehaviorDiagnosticVersion,
        ...input,
        ...classification,
        consecutiveWaitCycles,
        lastBrokerActionAt,
        secondsSinceLastBrokerAction,
        thresholdPolicyState: 'NO_EMPIRICAL_FREQUENCY_THRESHOLD' as const,
      };
      const contentHash = createHash('sha256').update(canonicalJson(payload)).digest('hex');
      const diagnostic: RuntimeBehaviorDiagnostic = { ...payload, contentHash };
      await client.query(
        `INSERT INTO research.theta_runtime_behavior_diagnostic(
          diagnostic_id,scan_id,observed_at,contract_version,wait_classification,overtrading_state,
          global_wait_earned,consecutive_wait_cycles,last_broker_action_at,seconds_since_last_broker_action,
          candidate_count,feasible_candidate_count,selected_candidate_count,hard_rejected_count,
          soft_ranked_count,data_insufficient_count,quantity_zero_count,aegis_veto_count,near_miss_count,
          action_plans_ready,provider_blockers_json,action_plan_blockers_json,reason_codes_json,
          threshold_policy_state,diagnostic_json,content_hash)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
          $21::jsonb,$22::jsonb,$23::jsonb,$24,$25::jsonb,$26)`,
        [randomUUID(),input.scanId,input.observedAt,runtimeBehaviorDiagnosticVersion,
          diagnostic.waitClassification,diagnostic.overtradingState,input.globalWaitEarned,consecutiveWaitCycles,
          lastBrokerActionAt,secondsSinceLastBrokerAction,input.candidateCount,input.feasibleCandidateCount,
          input.selectedCandidateCount,input.hardRejectedCount,input.softRankedCount,input.dataInsufficientCount,
          input.quantityZeroCount,input.aegisVetoCount,input.nearMissCount,input.actionPlansReady,
          JSON.stringify(input.providerBlockers),JSON.stringify(input.actionPlanBlockers),
          JSON.stringify(diagnostic.reasonCodes),diagnostic.thresholdPolicyState,JSON.stringify(diagnostic),contentHash],
      );
      return diagnostic;
    });
  }
}
