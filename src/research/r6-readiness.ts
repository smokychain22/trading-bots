import type { Pool } from 'pg';

export interface R6ReadinessReceipt {
  readonly POINT_IN_TIME_DATASET_READY:'YES'|'NO'; readonly SHADOW_CAPTURE_READY:'YES'|'NO';
  readonly WHOLE_CHAIN_LABELS_READY:'YES'|'NO'; readonly MANAGEMENT_LABELS_READY:'YES'|'NO';
  readonly EXECUTION_REPLAY_READY:'YES'|'NO'; readonly DATASET_EXPORT_READY:'YES'|'NO';
  readonly reasons:Readonly<Record<string,readonly string[]>>;
}

export async function buildR6ReadinessReceipt(pool:Pool):Promise<R6ReadinessReceipt> {
  const result=await pool.query(`SELECT
    to_regclass('trade.candidate_point_in_time_evidence') IS NOT NULL AS pit,
    to_regclass('trade.candidate_set_evidence') IS NOT NULL AS sets,
    to_regclass('trade.shadow_opportunity') IS NOT NULL AS shadow,
    to_regclass('research.theta_outcome_label') IS NOT NULL AS labels,
    to_regclass('market.execution_quote_observation') IS NOT NULL AS replay,
    to_regclass('research.theta_dataset_export') IS NOT NULL AS exports,
    (SELECT count(*) FROM trade.candidate_point_in_time_evidence) AS pit_count,
    (SELECT count(*) FROM trade.shadow_opportunity) AS shadow_count,
    (SELECT count(*) FROM research.theta_outcome_label WHERE subject_type='WHOLE_CHAIN' AND censoring_state='RESOLVED') AS chain_labels,
    (SELECT count(*) FROM research.theta_outcome_label WHERE subject_type='MANAGED_EPISODE' AND censoring_state='RESOLVED') AS management_labels,
    (SELECT count(*) FROM market.execution_quote_observation WHERE observation_role='SUBSEQUENT') AS subsequent_quotes`);
  const row=result.rows[0] ?? {};
  const yesNo=(value:boolean):'YES'|'NO'=>value?'YES':'NO';
  const pit=Boolean(row.pit&&row.sets)&&Number(row.pit_count)>0;
  const shadow=Boolean(row.shadow)&&Number(row.shadow_count)>0;
  const whole=Boolean(row.labels)&&Number(row.chain_labels)>0;
  const management=Boolean(row.labels)&&Number(row.management_labels)>0;
  const replay=Boolean(row.replay)&&Number(row.subsequent_quotes)>0;
  return { POINT_IN_TIME_DATASET_READY:yesNo(pit),SHADOW_CAPTURE_READY:yesNo(shadow),
    WHOLE_CHAIN_LABELS_READY:yesNo(whole),MANAGEMENT_LABELS_READY:yesNo(management),
    EXECUTION_REPLAY_READY:yesNo(replay),DATASET_EXPORT_READY:yesNo(Boolean(row.exports&&row.pit&&row.labels)),
    reasons:{ pointInTime:pit?[]:['NO_POINT_IN_TIME_ROWS'],shadow:shadow?[]:['NO_SHADOW_ROWS'],
      wholeChain:whole?[]:['NO_RESOLVED_WHOLE_CHAIN_LABELS'],management:management?[]:['NO_RESOLVED_MANAGEMENT_LABELS'],
      executionReplay:replay?[]:['NO_SUBSEQUENT_QUOTE_OBSERVATIONS'] } };
}
