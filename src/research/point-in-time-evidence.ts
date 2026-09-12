import { createHash, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { z } from 'zod';

export const pointInTimeEvidenceVersion = 'theta-point-in-time-evidence-v1' as const;
export const datasetExportVersion = 'theta-r6-dataset-v1' as const;

const quality = z.enum(['GOOD','DEGRADED','STALE','UNKNOWN','INVALID','NOT_ENTITLED']);
const timestamp = z.string().datetime({ offset:true });
const jsonObject = z.record(z.string(),z.unknown());

export const providerProvenanceSchema = z.object({
  source:z.string().min(1), operationAlias:z.string().min(1),
  providerTimestamp:timestamp.nullable(), ingestionTimestamp:timestamp, asOf:timestamp,
  version:z.string().min(1), state:quality,
}).strict().superRefine((value,context) => {
  if (value.providerTimestamp !== null && Date.parse(value.providerTimestamp) > Date.parse(value.asOf)) {
    context.addIssue({ code:'custom',message:'providerTimestamp must not be after asOf' });
  }
  if (Date.parse(value.ingestionTimestamp) < Date.parse(value.asOf)) {
    context.addIssue({ code:'custom',message:'ingestionTimestamp must not precede asOf' });
  }
});

export const strategyLineageSchema = z.object({
  strategyVersion:z.string().min(1), riskVersion:z.string().min(1),
  featureVersion:z.string().min(1), costModelVersion:z.string().min(1),
  regimeVersion:z.string().min(1), executionModelVersion:z.string().min(1),
}).strict();

const forbiddenFeatureKeys = new Set([
  'wholechainnetpnl','wholechainpnl','managedepisodepnl','managedepisodeoutcome',
  'returnonsecuredcapital','returnpercapitaldaylabel','maxadverseexcursion','maxfavorableexcursion',
  'assignmentoutcome','recoveryduration','closeoutcome','rolloutcome','ccoutcome','callawayoutcome',
  'realizedexecutioncost','eventualrealizedpnl','futureoutcome','outcomelabel',
  'outcome','future','result','realizedreturn','pnl',
]);

function normalizedKey(value:string): string { return value.replace(/[^a-z0-9]/gi,'').toLowerCase(); }

export function assertNoFutureLabels(value:unknown,path='features'): void {
  if (Array.isArray(value)) {
    value.forEach((entry,index) => assertNoFutureLabels(entry,`${path}[${index}]`));
    return;
  }
  if (value === null || typeof value !== 'object') return;
  for (const [key,entry] of Object.entries(value as Record<string,unknown>)) {
    if (forbiddenFeatureKeys.has(normalizedKey(key))) throw new Error(`FUTURE_LABEL_IN_FEATURE_PAYLOAD:${path}.${key}`);
    assertNoFutureLabels(entry,`${path}.${key}`);
  }
}

export const candidateEvidenceSchema = z.object({
  candidateId:z.string().uuid(), decisionId:z.string().uuid().nullable(), fusionSnapshotId:z.string().uuid(),
  decisionTime:timestamp, branch:z.string().min(1), rankAtDecision:z.number().int().positive().nullable(), selected:z.boolean(),
  hardStatus:z.enum(['FEASIBLE','HARD_VETO','INVALID','DATA_INSUFFICIENT']),
  softStatus:z.enum(['RANKED','REJECTED','UNKNOWN']), rejectionReason:z.string().min(1).nullable(),
  contract:jsonObject, market:jsonObject, volatility:jsonObject, technical:jsonObject,
  event:jsonObject, flow:jsonObject, ownership:jsonObject, account:jsonObject,
  portfolio:jsonObject, aegis:jsonObject, execution:jsonObject, knownEconomics:jsonObject,
  unknownEconomics:z.array(z.string()), hardBlockers:z.array(z.string()), softEvidence:z.array(z.unknown()),
  providerProvenance:z.array(providerProvenanceSchema), lineage:strategyLineageSchema,
}).strict();
export type CandidatePointInTimeEvidence = z.infer<typeof candidateEvidenceSchema>;

export function candidateEvidenceHash(raw:CandidatePointInTimeEvidence): string {
  const value = candidateEvidenceSchema.parse(raw);
  assertNoFutureLabels(value);
  return sha256(canonicalJson(value));
}

export interface CandidateSetEvidence {
  readonly candidateSetId:string; readonly decisionTime:string;
  readonly universeEvaluated:readonly string[]; readonly branchesConsidered:readonly string[];
  readonly counts:Readonly<Record<string,number>>; readonly bestCandidateId:string|null;
  readonly secondBestCandidateId:string|null; readonly bestRejectedCandidateId:string|null;
  readonly completenessState:'COMPLETE'|'PARTIAL'|'UNKNOWN'; readonly missingScope:readonly string[];
}

export interface GlobalWaitRecord {
  readonly decisionId:string; readonly candidateSetId:string|null; readonly decisionTime:string;
  readonly waitReason:string; readonly underlyingsEvaluated:number; readonly contractsEvaluated:number;
  readonly branchesConsidered:readonly string[]; readonly bestRejectedCandidateId:string|null;
  readonly bestFeasibleAction:string|null; readonly blockers:readonly string[]; readonly dataMissing:readonly string[];
  readonly searchProof:Readonly<Record<string,unknown>>; readonly earned:boolean;
  readonly validationViolations:readonly string[];
}

export interface ExecutionQuoteObservation {
  readonly quoteObservationId:string; readonly candidateId:string|null;
  readonly managementInputSnapshotId:string|null; readonly observationRole:'DECISION'|'SUBSEQUENT'|'BROKER_FILL';
  readonly observedAt:string; readonly providerTimestamp:string|null; readonly ingestionTimestamp:string;
  readonly source:string; readonly operationAlias:string; readonly feed:string|null; readonly contractVersion:string;
  readonly bid:number|null; readonly ask:number|null; readonly bidSize:number|null; readonly askSize:number|null;
  readonly proposedLimit:number|null; readonly dataQuality:z.infer<typeof quality>;
}

function canonicalize(value:unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') return Object.fromEntries(
    Object.entries(value as Record<string,unknown>).sort(([a],[b]) => a.localeCompare(b)).map(([key,item]) => [key,canonicalize(item)]),
  );
  return value;
}
export function canonicalJson(value:unknown): string { return JSON.stringify(canonicalize(value)); }
export function sha256(value:string): string { return createHash('sha256').update(value).digest('hex'); }

export class PostgresPointInTimeEvidenceStore {
  constructor(private readonly pool:Pool) {}

  async saveCandidateSet(value:CandidateSetEvidence):Promise<void> {
    const payload = { ...value, universeEvaluated:[...value.universeEvaluated].sort(), branchesConsidered:[...value.branchesConsidered].sort(), missingScope:[...value.missingScope].sort() };
    await this.pool.query(`INSERT INTO trade.candidate_set_evidence(candidate_set_id,decision_time,universe_evaluated_json,
      branches_considered_json,counts_json,best_candidate_id,second_best_candidate_id,best_rejected_candidate_id,
      completeness_state,missing_scope_json,content_hash) VALUES($1,$2,$3::jsonb,$4::jsonb,$5::jsonb,$6,$7,$8,$9,$10::jsonb,$11)
      ON CONFLICT(candidate_set_id) DO NOTHING`,[value.candidateSetId,value.decisionTime,JSON.stringify(payload.universeEvaluated),
      JSON.stringify(payload.branchesConsidered),JSON.stringify(value.counts),value.bestCandidateId,value.secondBestCandidateId,
      value.bestRejectedCandidateId,value.completenessState,JSON.stringify(payload.missingScope),sha256(canonicalJson(payload))]);
  }

  async saveCandidate(raw:CandidatePointInTimeEvidence):Promise<void> {
    const value = candidateEvidenceSchema.parse(raw), hash = candidateEvidenceHash(value);
    await this.pool.query(`INSERT INTO trade.candidate_point_in_time_evidence(candidate_id,decision_id,fusion_snapshot_id,
      decision_time,branch,rank_at_decision,selected,hard_status,soft_status,rejection_reason,contract_json,market_json,
      volatility_json,technical_json,event_json,flow_json,ownership_json,account_json,portfolio_json,aegis_json,
      execution_json,known_economics_json,unknown_economics_json,hard_blockers_json,soft_evidence_json,
      provider_provenance_json,strategy_version,risk_version,feature_version,cost_model_version,regime_version,
      execution_model_version,content_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13::jsonb,
      $14::jsonb,$15::jsonb,$16::jsonb,$17::jsonb,$18::jsonb,$19::jsonb,$20::jsonb,$21::jsonb,$22::jsonb,$23::jsonb,
      $24::jsonb,$25::jsonb,$26::jsonb,$27,$28,$29,$30,$31,$32,$33) ON CONFLICT(candidate_id) DO NOTHING`,[
      value.candidateId,value.decisionId,value.fusionSnapshotId,value.decisionTime,value.branch,value.rankAtDecision,value.selected,
      value.hardStatus,value.softStatus,value.rejectionReason,JSON.stringify(value.contract),JSON.stringify(value.market),
      JSON.stringify(value.volatility),JSON.stringify(value.technical),JSON.stringify(value.event),JSON.stringify(value.flow),
      JSON.stringify(value.ownership),JSON.stringify(value.account),JSON.stringify(value.portfolio),JSON.stringify(value.aegis),
      JSON.stringify(value.execution),JSON.stringify(value.knownEconomics),JSON.stringify(value.unknownEconomics),
      JSON.stringify(value.hardBlockers),JSON.stringify(value.softEvidence),JSON.stringify(value.providerProvenance),
      value.lineage.strategyVersion,value.lineage.riskVersion,value.lineage.featureVersion,value.lineage.costModelVersion,
      value.lineage.regimeVersion,value.lineage.executionModelVersion,hash]);
  }

  async saveGlobalWait(value:GlobalWaitRecord):Promise<void> {
    await this.pool.query(`INSERT INTO trade.global_wait_evidence(decision_id,candidate_set_id,decision_time,wait_reason,
      underlyings_evaluated,contracts_evaluated,branches_considered_json,best_rejected_candidate_id,best_feasible_action,
      blockers_json,data_missing_json,search_proof_json,earned,validation_violations_json,content_hash)
      VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10::jsonb,$11::jsonb,$12::jsonb,$13,$14::jsonb,$15)
      ON CONFLICT(decision_id) DO NOTHING`,[value.decisionId,value.candidateSetId,value.decisionTime,value.waitReason,
      value.underlyingsEvaluated,value.contractsEvaluated,JSON.stringify(value.branchesConsidered),value.bestRejectedCandidateId,
      value.bestFeasibleAction,JSON.stringify(value.blockers),JSON.stringify(value.dataMissing),JSON.stringify(value.searchProof),
      value.earned,JSON.stringify(value.validationViolations),sha256(canonicalJson(value))]);
  }

  async saveQuote(value:ExecutionQuoteObservation):Promise<void> {
    if (value.candidateId === null && value.managementInputSnapshotId === null) throw new Error('QUOTE_OBSERVATION_SUBJECT_REQUIRED');
    if (value.providerTimestamp !== null && Date.parse(value.providerTimestamp)>Date.parse(value.observedAt)) throw new Error('QUOTE_PROVIDER_TIMESTAMP_AFTER_OBSERVATION');
    if (Date.parse(value.ingestionTimestamp)<Date.parse(value.observedAt)) throw new Error('QUOTE_INGESTION_PRECEDES_OBSERVATION');
    if (value.bid !== null && value.ask !== null && value.bid>value.ask) throw new Error('CROSSED_BBO_INVALID');
    await this.pool.query(`INSERT INTO market.execution_quote_observation(quote_observation_id,candidate_id,
      management_input_snapshot_id,observation_role,observed_at,provider_timestamp,ingestion_timestamp,source,
      operation_alias,feed,contract_version,bid,ask,bid_size,ask_size,proposed_limit,data_quality,content_hash)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) ON CONFLICT DO NOTHING`,[
      value.quoteObservationId,value.candidateId,value.managementInputSnapshotId,value.observationRole,value.observedAt,
      value.providerTimestamp,value.ingestionTimestamp,value.source,value.operationAlias,value.feed,value.contractVersion,
      value.bid,value.ask,value.bidSize,value.askSize,value.proposedLimit,value.dataQuality,sha256(canonicalJson(value))]);
  }
}

export interface DatasetExportRows {
  readonly candidateSets:readonly unknown[]; readonly candidates:readonly unknown[]; readonly shadowCandidates:readonly unknown[];
  readonly managementSnapshots:readonly unknown[]; readonly lifecycleOutcomes:readonly unknown[];
  readonly wholeChainOutcomes:readonly unknown[]; readonly executionEvidence:readonly unknown[];
}
export interface DatasetExportArtifact {
  readonly schemaVersion:typeof datasetExportVersion; readonly sourceWindow:{readonly start:string;readonly end:string};
  readonly exportedAt:string; readonly featureSetVersion:string; readonly strategyVersions:readonly string[];
  readonly rows:DatasetExportRows; readonly rowCounts:Readonly<Record<keyof DatasetExportRows,number>>; readonly datasetHash:string;
}

const byCanonical = (a:unknown,b:unknown):number => canonicalJson(a).localeCompare(canonicalJson(b));
export function buildDatasetExport(input:{sourceWindow:{start:string;end:string}; exportedAt:string; featureSetVersion:string;
  strategyVersions:readonly string[]; rows:DatasetExportRows}):DatasetExportArtifact {
  if (Date.parse(input.sourceWindow.end)<Date.parse(input.sourceWindow.start)) throw new Error('DATASET_WINDOW_INVALID');
  assertNoFutureLabels(input.rows.candidateSets,'candidateSets');
  assertNoFutureLabels(input.rows.candidates,'candidates');
  assertNoFutureLabels(input.rows.shadowCandidates,'shadowCandidates');
  assertNoFutureLabels(input.rows.managementSnapshots,'managementSnapshots');
  const rows = Object.fromEntries(Object.entries(input.rows).map(([key,value]) => [key,[...value].sort(byCanonical)])) as unknown as DatasetExportRows;
  const rowCounts = Object.fromEntries(Object.entries(rows).map(([key,value]) => [key,value.length])) as Readonly<Record<keyof DatasetExportRows,number>>;
  const unsigned = { schemaVersion:datasetExportVersion,sourceWindow:input.sourceWindow,exportedAt:input.exportedAt,
    featureSetVersion:input.featureSetVersion,strategyVersions:[...new Set(input.strategyVersions)].sort(),rows,rowCounts };
  return { ...unsigned,datasetHash:sha256(canonicalJson(unsigned)) };
}

export function newQuoteObservationId():string { return randomUUID(); }
