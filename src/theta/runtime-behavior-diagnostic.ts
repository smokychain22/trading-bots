import { createHash, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { canonicalJson } from '../research/point-in-time-evidence.js';
import type { ScanCompleteness } from '../research/shadow-evidence-runtime.js';

export const runtimeBehaviorDiagnosticVersion = 'theta-runtime-behavior-diagnostic-v1' as const;

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
  readonly observedAt: string;
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
  readonly providerBlockers: readonly string[];
  readonly actionPlansReady: number;
  readonly actionPlanBlockers: readonly string[];
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
  else if (input.completeness === 'DATA_INSUFFICIENT' || input.candidateCount === 0) waitClassification = 'NO_OPPORTUNITY';
  else if (input.completeness !== 'COMPLETE' || input.providerBlockers.length > 0) waitClassification = 'DATA_WAIT';
  else if (blockers.some(quoteBlocker)) waitClassification = 'QUOTE_WAIT';
  else if (input.aegisVetoCount > 0 || input.quantityZeroCount > 0 || blockers.some(riskBlocker)) waitClassification = 'RISK_WAIT';
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
    'NO_EMPIRICAL_FREQUENCY_THRESHOLD',
  ];
  return { waitClassification, overtradingState, reasonCodes: [...new Set(reasonCodes)].toSorted() };
}

type PreviousDiagnostic = { readonly wait_classification: WaitClassification; readonly consecutive_wait_cycles: number };

export class PostgresRuntimeBehaviorDiagnosticStore {
  constructor(private readonly pool: Pool) {}

  async persist(input: RuntimeBehaviorDiagnosticInput): Promise<RuntimeBehaviorDiagnostic> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['THETA_RUNTIME_BEHAVIOR_DIAGNOSTIC']);
      const existing = await client.query(
        `SELECT diagnostic_json FROM research.theta_runtime_behavior_diagnostic WHERE scan_id=$1`, [input.scanId],
      );
      if (existing.rowCount === 1) {
        await client.query('COMMIT');
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
      await client.query('COMMIT');
      return diagnostic;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
