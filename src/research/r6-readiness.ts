import type { Pool } from 'pg';

type ReadinessState='YES'|'NO'|'PARTIAL'|'BLOCKED';
export interface R6DataQualityReport {
  readonly evidenceRows:number; readonly decisionCycles:number; readonly candidateSets:number;
  readonly underlyings:number; readonly contracts:number; readonly branches:number;
  readonly marketSessions:number; readonly quoteObservations:number;
  readonly firstTimestamp:string|null; readonly lastTimestamp:string|null;
  readonly missingProviderFieldRate:number|null; readonly staleCandidateRate:number|null;
  readonly partialScanRate:number|null; readonly waitRate:number|null;
  readonly invalidQuoteRate:number|null; readonly providerFailureRate:number|null;
  readonly observationMissedRate:number|null;
  readonly hardVetoDistribution:Readonly<Record<string,number>>;
  readonly softRejectionDistribution:Readonly<Record<string,number>>;
  readonly providerStateDistribution:Readonly<Record<string,number>>;
}
export interface R6ReadinessReceipt {
  readonly SHADOW_RUNTIME_READY:ReadinessState; readonly LIVE_PIT_CAPTURE_ACTIVE:ReadinessState;
  readonly CROSS_SYMBOL_SCAN_COMPLETE:ReadinessState; readonly EXECUTION_OBSERVATION_PIPELINE_READY:ReadinessState;
  readonly OUTCOME_RESOLVER_READY:ReadinessState; readonly POINT_IN_TIME_DATA_EXISTS:ReadinessState;
  readonly POINT_IN_TIME_DATASET_READY:ReadinessState; readonly SHADOW_CAPTURE_READY:ReadinessState;
  readonly WHOLE_CHAIN_LABELS_READY:ReadinessState; readonly MANAGEMENT_LABELS_READY:ReadinessState;
  readonly EXECUTION_REPLAY_READY:ReadinessState; readonly DATASET_EXPORT_READY:ReadinessState;
  readonly MODEL_TRAINING_DATA_SUFFICIENT:ReadinessState;
  readonly dataQuality:R6DataQualityReport; readonly reasons:Readonly<Record<string,readonly string[]>>;
}

const num=(value:unknown):number=>Number(value??0);
const rate=(part:number,total:number):number|null=>total===0?null:part/total;
const distribution=(rows:readonly Record<string,unknown>[],key:string):Readonly<Record<string,number>>=>Object.fromEntries(
  rows.map((row)=>[String(row[key]??'UNKNOWN'),num(row.count)]),
);

export async function buildR6ReadinessReceipt(pool:Pool):Promise<R6ReadinessReceipt> {
  const existence=await pool.query(`SELECT
    to_regclass('trade.candidate_point_in_time_evidence') IS NOT NULL AS pit,
    to_regclass('trade.candidate_set_evidence') IS NOT NULL AS sets,
    to_regclass('trade.shadow_opportunity') IS NOT NULL AS shadow,
    to_regclass('research.theta_outcome_label') IS NOT NULL AS labels,
    to_regclass('market.execution_quote_observation') IS NOT NULL AS replay,
    to_regclass('research.theta_dataset_export') IS NOT NULL AS exports,
    to_regclass('research.theta_shadow_scan_run') IS NOT NULL AS scans,
    to_regclass('research.theta_execution_observation_job') IS NOT NULL AS jobs`);
  const e=existence.rows[0]??{};
  const counts=await pool.query(`SELECT
    (SELECT count(*) FROM trade.candidate_point_in_time_evidence)::int AS pit_count,
    (SELECT count(DISTINCT decision_id) FROM trade.candidate_point_in_time_evidence WHERE decision_id IS NOT NULL)::int AS decisions,
    (SELECT count(*) FROM trade.candidate_set_evidence)::int AS sets_count,
    (SELECT count(DISTINCT contract_json->>'underlying') FROM trade.candidate_point_in_time_evidence)::int AS underlyings,
    (SELECT count(DISTINCT contract_json->>'contractSymbol') FROM trade.candidate_point_in_time_evidence)::int AS contracts,
    (SELECT count(DISTINCT branch) FROM trade.candidate_point_in_time_evidence)::int AS branches,
    (SELECT count(DISTINCT decision_time::date) FROM trade.candidate_point_in_time_evidence)::int AS market_sessions,
    (SELECT min(decision_time)::text FROM trade.candidate_point_in_time_evidence) AS first_at,
    (SELECT max(decision_time)::text FROM trade.candidate_point_in_time_evidence) AS last_at,
    (SELECT count(*) FROM research.theta_shadow_scan_run)::int AS scans_count,
    (SELECT count(*) FROM research.theta_shadow_scan_run WHERE completeness_state='COMPLETE')::int AS complete_scans,
    (SELECT count(*) FROM research.theta_shadow_scan_run WHERE completeness_state<>'COMPLETE')::int AS partial_scans,
    (SELECT count(*) FROM trade.shadow_opportunity)::int AS shadow_count,
    (SELECT count(*) FROM trade.decision)::int AS all_decisions,
    (SELECT count(*) FROM trade.decision WHERE action_code='WAIT')::int AS waits,
    (SELECT count(*) FROM research.theta_outcome_label WHERE subject_type='WHOLE_CHAIN' AND censoring_state='RESOLVED')::int AS chain_labels,
    (SELECT count(*) FROM research.theta_outcome_label WHERE subject_type='MANAGED_EPISODE' AND censoring_state='RESOLVED')::int AS management_labels,
    (SELECT count(*) FROM market.execution_quote_observation WHERE observation_role='SUBSEQUENT')::int AS subsequent_quotes,
    (SELECT count(*) FROM research.theta_execution_observation_job WHERE status='PENDING')::int AS pending_jobs,
    (SELECT count(*) FROM research.theta_execution_observation_job WHERE status='MISSED')::int AS missed_jobs,
    (SELECT count(*) FROM market.execution_quote_observation)::int AS quote_count,
    (SELECT count(*) FROM market.execution_quote_observation WHERE data_quality='INVALID')::int AS invalid_quotes,
    (SELECT count(*) FROM research.theta_shadow_scan_member WHERE status='FAILED')::int AS provider_failures,
    (SELECT count(*) FROM research.theta_shadow_scan_member)::int AS scan_members,
    (SELECT count(*) FROM trade.candidate_point_in_time_evidence WHERE EXISTS(
      SELECT 1 FROM jsonb_array_elements(provider_provenance_json) p WHERE p->>'state'='STALE'))::int AS stale_candidates,
    (SELECT count(*) FROM trade.candidate_point_in_time_evidence WHERE jsonb_array_length(unknown_economics_json)>0)::int AS missing_candidates`);
  const c=counts.rows[0]??{},pitCount=num(c.pit_count),scanCount=num(c.scans_count),shadowCount=num(c.shadow_count);
  const [hard,soft,providers]=await Promise.all([
    pool.query(`SELECT value AS code,count(*)::int FROM trade.candidate_point_in_time_evidence,
      LATERAL jsonb_array_elements_text(hard_blockers_json) value GROUP BY value ORDER BY value`),
    pool.query(`SELECT COALESCE(rejection_reason,'UNKNOWN') AS code,count(*)::int FROM trade.candidate_point_in_time_evidence
      WHERE soft_status='REJECTED' GROUP BY COALESCE(rejection_reason,'UNKNOWN') ORDER BY code`),
    pool.query(`SELECT COALESCE(p->>'state','UNKNOWN') AS state,count(*)::int FROM trade.candidate_point_in_time_evidence,
      LATERAL jsonb_array_elements(provider_provenance_json) p GROUP BY COALESCE(p->>'state','UNKNOWN') ORDER BY state`),
  ]);
  const quality:R6DataQualityReport={evidenceRows:pitCount,decisionCycles:num(c.decisions),candidateSets:num(c.sets_count),
    underlyings:num(c.underlyings),contracts:num(c.contracts),branches:num(c.branches),marketSessions:num(c.market_sessions),
    quoteObservations:num(c.quote_count),firstTimestamp:c.first_at??null,lastTimestamp:c.last_at??null,
    missingProviderFieldRate:rate(num(c.missing_candidates),pitCount),staleCandidateRate:rate(num(c.stale_candidates),pitCount),
    partialScanRate:rate(num(c.partial_scans),scanCount),waitRate:rate(num(c.waits),num(c.all_decisions)),
    invalidQuoteRate:rate(num(c.invalid_quotes),num(c.quote_count)),providerFailureRate:rate(num(c.provider_failures),num(c.scan_members)),
    observationMissedRate:rate(num(c.missed_jobs),num(c.missed_jobs)+num(c.subsequent_quotes)+num(c.pending_jobs)),
    hardVetoDistribution:distribution(hard.rows,'code'),softRejectionDistribution:distribution(soft.rows,'code'),
    providerStateDistribution:distribution(providers.rows,'state')};
  const pointData=pitCount>0,liveCapture=pointData&&num(c.complete_scans)>0;
  const pipeline=e.jobs&&e.replay,whole=num(c.chain_labels)>0,management=num(c.management_labels)>0;
  const replay=num(c.subsequent_quotes)>0,exportReady=Boolean(e.exports&&e.pit&&e.labels);
  return {
    SHADOW_RUNTIME_READY:e.scans&&e.jobs&&e.pit?'YES':'NO',
    LIVE_PIT_CAPTURE_ACTIVE:liveCapture?'YES':pointData?'PARTIAL':'NO',
    CROSS_SYMBOL_SCAN_COMPLETE:num(c.complete_scans)>0?'YES':scanCount>0?'PARTIAL':'NO',
    EXECUTION_OBSERVATION_PIPELINE_READY:pipeline?'YES':'NO',OUTCOME_RESOLVER_READY:e.labels?'PARTIAL':'NO',
    POINT_IN_TIME_DATA_EXISTS:pointData?'YES':'NO',POINT_IN_TIME_DATASET_READY:pointData?'YES':'NO',
    SHADOW_CAPTURE_READY:shadowCount>0?'YES':'NO',WHOLE_CHAIN_LABELS_READY:whole?'YES':'NO',
    MANAGEMENT_LABELS_READY:management?'YES':'NO',EXECUTION_REPLAY_READY:replay?'YES':pipeline?'PARTIAL':'NO',
    DATASET_EXPORT_READY:exportReady?'YES':'NO',MODEL_TRAINING_DATA_SUFFICIENT:'NO',dataQuality:quality,
    reasons:{liveCapture:liveCapture?[]:['NO_COMPLETE_REAL_CROSS_SYMBOL_SCAN'],crossSymbol:num(c.complete_scans)>0?[]:['NO_COMPLETE_SCAN'],
      pointInTime:pointData?[]:['NO_POINT_IN_TIME_ROWS'],shadow:shadowCount>0?[]:['NO_SHADOW_ROWS'],
      wholeChain:whole?[]:['NO_RESOLVED_WHOLE_CHAIN_LABELS'],management:management?[]:['NO_RESOLVED_MANAGEMENT_LABELS'],
      executionReplay:replay?[]:['NO_SUBSEQUENT_QUOTE_OBSERVATIONS'],modelTraining:['SAMPLE_SUFFICIENCY_AND_OOS_NOT_ESTABLISHED']},
  };
}
