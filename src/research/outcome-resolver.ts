import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import { canonicalJson } from './point-in-time-evidence.js';
import {
  outcomeHorizonPolicyVersion, outcomeResolutionContractVersion, resolveOutcome,
  standardOutcomeHorizons, type OutcomeLabelType, type OutcomeObservation, type OutcomeSubject,
} from './resolved-outcome-engine.js';

export const wholeChainOutcomeResolverVersion = 'theta-whole-chain-outcome-resolver-v1' as const;

export interface WholeChainResolutionInput {
  readonly chainId:string; readonly closedAt:string|null; readonly allOptionLegsResolved:boolean;
  readonly allStockLotsResolved:boolean; readonly executionFeesKnown:boolean;
  readonly economicFactCount:number;
  readonly optionRealizedPnl:number|null; readonly stockRealizedPnl:number|null;
  readonly dividends:number|null; readonly fees:number|null;
}
export type WholeChainResolution =
  | {readonly state:'RESOLVED';readonly wholeChainNetPnl:number;readonly labelAvailableAt:string}
  | {readonly state:'BLOCKED';readonly reasons:readonly string[]};

export function resolveWholeChainOutcome(input:WholeChainResolutionInput):WholeChainResolution {
  const reasons:string[]=[];
  if(input.economicFactCount===0) reasons.push('NO_ECONOMIC_FACTS');
  if(input.closedAt===null) reasons.push('CHAIN_OPEN');
  if(!input.allOptionLegsResolved) reasons.push('OPTION_LEGS_UNRESOLVED');
  if(!input.allStockLotsResolved) reasons.push('STOCK_LOTS_UNRESOLVED');
  if(!input.executionFeesKnown) reasons.push('EXECUTION_FEES_UNKNOWN');
  if(input.optionRealizedPnl===null) reasons.push('OPTION_PNL_UNKNOWN');
  if(input.stockRealizedPnl===null) reasons.push('STOCK_PNL_UNKNOWN');
  if(input.dividends===null) reasons.push('DIVIDENDS_UNKNOWN');
  if(input.fees===null) reasons.push('FEES_UNKNOWN');
  if(reasons.length>0) return {state:'BLOCKED',reasons};
  return {state:'RESOLVED',wholeChainNetPnl:(input.optionRealizedPnl as number)+(input.stockRealizedPnl as number)
    +(input.dividends as number)-(input.fees as number),labelAvailableAt:input.closedAt as string};
}

export interface OutcomeResolutionReport {readonly inspected:number;readonly resolved:number;readonly blocked:number;}
export interface LabelSideResolutionReport {
  readonly subjectsCreated:number;readonly observationsCreated:number;readonly inspected:number;
  readonly resolved:number;readonly pending:number;readonly unresolved:number;readonly invalid:number;
}
export class PostgresOutcomeResolver {
  constructor(private readonly pool:Pool){}
  async resolveClosedChains(asOf:string):Promise<OutcomeResolutionReport>{
    const rows=await this.pool.query(`SELECT ec.chain_id,ec.closed_at,
      NOT EXISTS(SELECT 1 FROM trade.option_leg ol WHERE ol.chain_id=ec.chain_id AND (ol.closed_at IS NULL OR ol.realized_pnl IS NULL)) AS option_resolved,
      NOT EXISTS(SELECT 1 FROM trade.stock_lot sl WHERE sl.chain_id=ec.chain_id AND (sl.disposed_at IS NULL OR sl.realized_pnl IS NULL)) AS stock_resolved,
      ((SELECT count(*) FROM trade.option_leg ol WHERE ol.chain_id=ec.chain_id)
        +(SELECT count(*) FROM trade.stock_lot sl WHERE sl.chain_id=ec.chain_id)
        +(SELECT count(*) FROM trade.fee_event fe WHERE fe.chain_id=ec.chain_id))::int AS economic_fact_count,
      NOT EXISTS(SELECT 1 FROM trade.fill f JOIN trade.broker_order bo ON bo.broker_order_id=f.broker_order_id
        JOIN trade.order_intent oi ON oi.order_intent_id=bo.order_intent_id WHERE oi.chain_id=ec.chain_id AND f.fees IS NULL) AS fees_known,
      COALESCE((SELECT sum(ol.realized_pnl) FROM trade.option_leg ol WHERE ol.chain_id=ec.chain_id),0)::text AS option_pnl,
      COALESCE((SELECT sum(sl.realized_pnl) FROM trade.stock_lot sl WHERE sl.chain_id=ec.chain_id),0)::text AS stock_pnl,
      COALESCE((SELECT sum(de.amount_per_share*sl.shares) FROM trade.dividend_event de JOIN trade.stock_lot sl USING(stock_lot_id) WHERE sl.chain_id=ec.chain_id),0)::text AS dividends,
      COALESCE((SELECT sum(fe.amount) FROM trade.fee_event fe WHERE fe.chain_id=ec.chain_id),0)::text AS fees
      FROM trade.economic_chain ec WHERE ec.closed_at IS NOT NULL AND ec.closed_at <= $1
      AND NOT EXISTS(SELECT 1 FROM research.theta_outcome_label l WHERE l.subject_type='WHOLE_CHAIN' AND l.subject_id=ec.chain_id AND l.censoring_state='RESOLVED')
      ORDER BY ec.closed_at,ec.chain_id`,[asOf]);
    let resolved=0,blocked=0;
    for(const row of rows.rows){
      const input:WholeChainResolutionInput={chainId:String(row.chain_id),closedAt:String(row.closed_at),
        allOptionLegsResolved:Boolean(row.option_resolved),allStockLotsResolved:Boolean(row.stock_resolved),executionFeesKnown:Boolean(row.fees_known),
        economicFactCount:Number(row.economic_fact_count),
        optionRealizedPnl:Number(row.option_pnl),stockRealizedPnl:Number(row.stock_pnl),dividends:Number(row.dividends),fees:Number(row.fees)};
      const outcome=resolveWholeChainOutcome(input);
      if(outcome.state==='BLOCKED'){blocked++;continue;}
      const payload={input,outcome,resolverVersion:wholeChainOutcomeResolverVersion};
      const contentHash=createHash('sha256').update(canonicalJson(payload)).digest('hex');
      const outcomeLabelId=deterministicUuid(`whole-chain:${input.chainId}:${wholeChainOutcomeResolverVersion}`);
      const result=await this.pool.query(`INSERT INTO research.theta_outcome_label(outcome_label_id,subject_type,subject_id,
        label_available_at,label_version,censoring_state,whole_chain_net_pnl,outcomes_json,provenance_json,content_hash)
        VALUES($1,'WHOLE_CHAIN',$2,$3,$4,'RESOLVED',$5,$6::jsonb,$7::jsonb,$8) ON CONFLICT(content_hash) DO NOTHING`,
      [outcomeLabelId,input.chainId,outcome.labelAvailableAt,wholeChainOutcomeResolverVersion,outcome.wholeChainNetPnl,
        JSON.stringify({resolution:'BROKER_CONFIRMED_CLOSED_CHAIN'}),JSON.stringify({source:'THETA_ECONOMIC_LEDGER',asOf}),contentHash]);
      resolved+=result.rowCount??0;
    }
    return {inspected:rows.rowCount??0,resolved,blocked};
  }

  async resolveEligibleOutcomes(asOf:string):Promise<LabelSideResolutionReport>{
    const subjectsCreated=(await this.materializeP2BSubjects())+(await this.materializeManagementSubjects());
    const observationsCreated=await this.captureExistingFutureObservations();
    const rows=await this.pool.query(`SELECT s.* FROM research.theta_outcome_subject s
      WHERE s.horizon_closes_at <= $1 AND NOT EXISTS(
        SELECT 1 FROM research.theta_resolved_outcome_label l WHERE l.outcome_subject_id=s.outcome_subject_id)
      ORDER BY s.horizon_closes_at,s.outcome_subject_id`,[asOf]);
    let resolved=0,pending=0,unresolved=0,invalid=0;
    for(const row of rows.rows){
      const observations=await this.pool.query(`SELECT * FROM research.theta_outcome_observation
        WHERE outcome_subject_id=$1 ORDER BY observed_at,outcome_observation_id`,[row.outcome_subject_id]);
      const subject:OutcomeSubject={subjectId:String(row.subject_id),labelType:String(row.label_type) as OutcomeLabelType,
        decisionTimestamp:new Date(row.decision_timestamp).toISOString(),featureSnapshotHash:String(row.feature_snapshot_hash),
        candidateUniverseHash:String(row.candidate_universe_hash),exactContractId:row.exact_contract_id===null?null:String(row.exact_contract_id),
        strategyVersion:String(row.strategy_version),horizonId:String(row.horizon_id),horizonClosesAt:new Date(row.horizon_closes_at).toISOString()};
      const values:OutcomeObservation[]=observations.rows.map((item)=>({observationId:String(item.outcome_observation_id),
        subjectId:subject.subjectId,observedAt:new Date(item.observed_at).toISOString(),
        providerTimestamp:item.provider_timestamp===null?null:new Date(item.provider_timestamp).toISOString(),
        receivedAt:new Date(item.received_at).toISOString(),source:String(item.source),provenance:String(item.provenance_class) as OutcomeObservation['provenance'],
        completeness:String(item.completeness) as OutcomeObservation['completeness'],reasonCodes:Array.isArray(item.reason_codes_json)?item.reason_codes_json.map(String):[],
        exactContractId:item.exact_contract_id===null?null:String(item.exact_contract_id),bid:numeric(item.bid),ask:numeric(item.ask),
        underlyingSpot:numeric(item.underlying_spot),economicPnl:numeric(item.economic_pnl),fees:numeric(item.fees),slippage:numeric(item.slippage),
        capitalDays:numeric(item.capital_days),lifecycleState:item.lifecycle_state===null?null:String(item.lifecycle_state),terminal:Boolean(item.terminal)}));
      const contractLabel=subject.exactContractId!==null;
      const receipt=resolveOutcome({subject,observations:values,asOf,
        executionModel:{modelClass:contractLabel?'MARKET_MARK':'NONE',version:contractLabel?'theta-market-mark-v1':'theta-no-execution-model-v1',
          positionSide:null,multiplier:null,entryPrice:null,entryFees:null,exitFees:null,perLegSlippage:null}});
      if(receipt.state==='PENDING'){pending++;continue;}
      const receiptId=deterministicUuid(`resolution:${row.outcome_subject_id}:${receipt.contentHash}`);
      const inserted=await this.pool.query(`INSERT INTO research.theta_outcome_resolution_receipt(
        outcome_resolution_receipt_id,outcome_subject_id,resolution_state,provenance_class,completeness,
        decision_timestamp,outcome_observation_start,outcome_observation_end,label_available_at,resolution_timestamp,
        execution_model_class,execution_model_version,receipt_json,execution_authorized,content_hash)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,false,$14) ON CONFLICT(content_hash) DO NOTHING
        RETURNING outcome_resolution_receipt_id`,[receiptId,row.outcome_subject_id,receipt.state,receipt.provenance,receipt.completeness,
        receipt.decisionTimestamp,receipt.outcomeObservationStart,receipt.outcomeObservationEnd,receipt.labelAvailableAt,
        receipt.resolutionTimestamp,receipt.executionModelClass,receipt.executionModelVersion,JSON.stringify(receipt),receipt.contentHash]);
      if(receipt.state==='RESOLVED'&&inserted.rowCount===1&&receipt.labelAvailableAt!==null){
        const labelId=deterministicUuid(`label:${row.outcome_subject_id}:${outcomeResolutionContractVersion}`);
        await this.pool.query(`INSERT INTO research.theta_resolved_outcome_label(
          resolved_outcome_label_id,outcome_subject_id,outcome_resolution_receipt_id,label_type,provenance_class,
          completeness,decision_timestamp,label_available_at,label_version,market_mark_json,modeled_execution_json,
          path_statistics_json,tca_json,outcome_json,execution_authorized,content_hash)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12::jsonb,$13::jsonb,$14::jsonb,false,$15)
          ON CONFLICT(outcome_subject_id,label_version) DO NOTHING`,[labelId,row.outcome_subject_id,receiptId,subject.labelType,
          receipt.provenance,receipt.completeness,receipt.decisionTimestamp,receipt.labelAvailableAt,outcomeResolutionContractVersion,
          JSON.stringify(receipt.marketMark),JSON.stringify(receipt.modeledExecution),JSON.stringify(receipt.path),
          JSON.stringify({executionModelClass:receipt.executionModelClass,executionModelVersion:receipt.executionModelVersion}),
          JSON.stringify({terminalState:receipt.terminalState,reasonCodes:receipt.reasonCodes}),receipt.contentHash]);
        resolved++;
      }else if(receipt.state==='UNRESOLVED')unresolved++;
      else if(receipt.state==='INVALID')invalid++;
    }
    return {subjectsCreated,observationsCreated,inspected:rows.rowCount??0,resolved,pending,unresolved,invalid};
  }

  private async materializeP2BSubjects():Promise<number>{
    const rows=await this.pool.query(`SELECT chain_decision_evidence_id,observed_at,contract_version,content_hash,
      chain_snapshot_json,counterfactual_label_contract_json FROM research.theta_option_chain_decision_evidence
      ORDER BY observed_at,chain_decision_evidence_id`);
    let created=0;
    for(const row of rows.rows){
      const contract=row.counterfactual_label_contract_json as Record<string,unknown>;
      const subjects=Array.isArray(contract.subjects)?contract.subjects:[];
      const chain=row.chain_snapshot_json as Record<string,unknown>;
      const chainContracts=Array.isArray(chain.contracts)?chain.contracts as Record<string,unknown>[]:[];
      for(const raw of subjects){
        if(raw===null||typeof raw!=='object'||Array.isArray(raw))continue;
        const value=raw as Record<string,unknown>,kind=String(value.subjectType??''),subjectId=String(value.subjectId??'');
        if(subjectId.length===0)continue;
        const labelType=labelTypeForP2B(kind),exact=['SELECTED_STRIKE','NEIGHBOR_STRIKE'].includes(kind)?subjectId:null;
        const expiration=exact===null?null:String(chainContracts.find((item)=>item.optionSymbol===exact)?.expiration??'');
        const horizons=[...standardOutcomeHorizons,...(expiration&&Date.parse(`${expiration}T20:00:00.000Z`)>Date.parse(row.observed_at)
          ?[{id:'EXPIRATION',milliseconds:Date.parse(`${expiration}T20:00:00.000Z`)-Date.parse(row.observed_at)}]:[])];
        for(const horizon of horizons){
          const subject:OutcomeSubject={subjectId,labelType,decisionTimestamp:new Date(row.observed_at).toISOString(),
            featureSnapshotHash:String(row.content_hash),candidateUniverseHash:String(row.content_hash),exactContractId:exact,
            strategyVersion:String(row.contract_version),horizonId:`${outcomeHorizonPolicyVersion}:${horizon.id}`,
            horizonClosesAt:new Date(Date.parse(row.observed_at)+horizon.milliseconds).toISOString()};
          const contentHash=createHash('sha256').update(canonicalJson(subject)).digest('hex');
          const id=deterministicUuid(`outcome-subject:${row.chain_decision_evidence_id}:${kind}:${subjectId}:${horizon.id}`);
          const result=await this.pool.query(`INSERT INTO research.theta_outcome_subject(outcome_subject_id,
            source_chain_decision_evidence_id,subject_id,label_type,decision_timestamp,feature_snapshot_hash,
            candidate_universe_hash,exact_contract_id,strategy_version,horizon_id,horizon_closes_at,
            resolver_contract_version,execution_authorized,content_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,false,$13)
            ON CONFLICT(subject_id,label_type,decision_timestamp,horizon_id,resolver_contract_version) DO NOTHING`,[id,row.chain_decision_evidence_id,
            subject.subjectId,subject.labelType,subject.decisionTimestamp,subject.featureSnapshotHash,subject.candidateUniverseHash,
            subject.exactContractId,subject.strategyVersion,subject.horizonId,subject.horizonClosesAt,outcomeResolutionContractVersion,contentHash]);
          created+=result.rowCount??0;
        }
      }
    }
    return created;
  }

  private async materializeManagementSubjects():Promise<number>{
    const rows=await this.pool.query(`SELECT maf.management_action_frontier_id,maf.management_input_snapshot_id,
      maf.observed_at,maf.actions_json,maf.selected_action,maf.content_hash,COALESCE(maf.policy_version,'UNPROMOTED') AS policy_version,
      mis.content_hash AS feature_hash FROM trade.management_action_frontier maf
      JOIN trade.management_input_snapshot mis USING(management_input_snapshot_id)
      ORDER BY maf.observed_at,maf.management_action_frontier_id`);
    let created=0;
    for(const row of rows.rows){
      const actions=Array.isArray(row.actions_json)?row.actions_json:[];
      for(const raw of actions){
        if(raw===null||typeof raw!=='object'||Array.isArray(raw))continue;
        const action=String((raw as Record<string,unknown>).action??(raw as Record<string,unknown>).actionCode??'');
        if(action.length===0)continue;
        const selected=action===String(row.selected_action),labelType:OutcomeLabelType=selected?'MANAGEMENT_ACTION_OUTCOME':'MANAGEMENT_ALTERNATIVE_OUTCOME';
        const decisionTimestamp=new Date(row.observed_at).toISOString();
        const subject:OutcomeSubject={subjectId:`${row.management_action_frontier_id}:${action}`,labelType,decisionTimestamp,
          featureSnapshotHash:String(row.feature_hash),candidateUniverseHash:String(row.content_hash),exactContractId:null,
          strategyVersion:String(row.policy_version),horizonId:`${outcomeHorizonPolicyVersion}:ONE_DAY`,
          horizonClosesAt:new Date(Date.parse(row.observed_at)+86_400_000).toISOString()};
        const contentHash=createHash('sha256').update(canonicalJson(subject)).digest('hex');
        const id=deterministicUuid(`management-outcome-subject:${subject.subjectId}`);
        const result=await this.pool.query(`INSERT INTO research.theta_outcome_subject(outcome_subject_id,
          source_management_input_snapshot_id,subject_id,label_type,decision_timestamp,feature_snapshot_hash,
          candidate_universe_hash,exact_contract_id,strategy_version,horizon_id,horizon_closes_at,
          resolver_contract_version,execution_authorized,content_hash) VALUES($1,$2,$3,$4,$5,$6,$7,NULL,$8,$9,$10,$11,false,$12)
          ON CONFLICT(subject_id,label_type,decision_timestamp,horizon_id,resolver_contract_version) DO NOTHING`,[id,row.management_input_snapshot_id,
          subject.subjectId,subject.labelType,subject.decisionTimestamp,subject.featureSnapshotHash,subject.candidateUniverseHash,
          subject.strategyVersion,subject.horizonId,subject.horizonClosesAt,outcomeResolutionContractVersion,contentHash]);
        created+=result.rowCount??0;
      }
    }
    return created;
  }

  private async captureExistingFutureObservations():Promise<number>{
    const contract=await this.pool.query(`INSERT INTO research.theta_outcome_observation(outcome_observation_id,
      outcome_subject_id,observed_at,provider_timestamp,received_at,source,provenance_class,completeness,
      reason_codes_json,exact_contract_id,bid,ask,underlying_spot,economic_pnl,fees,slippage,capital_days,
      lifecycle_state,terminal,observation_json,content_hash)
      SELECT gen_random_uuid(),s.outcome_subject_id,q.observed_at,q.provider_timestamp,q.ingestion_timestamp,q.source,
        CASE WHEN q.observation_role='BROKER_FILL' THEN 'BROKER_ACTUAL' ELSE 'MARKET_OBSERVED' END,
        CASE WHEN q.data_quality='GOOD' AND q.bid IS NOT NULL AND q.ask IS NOT NULL THEN 'COMPLETE' ELSE 'PARTIAL' END,
        jsonb_build_array('IMPORTED_FROM_EXECUTION_QUOTE_OBSERVATION'),s.exact_contract_id,q.bid,q.ask,NULL,NULL,NULL,NULL,NULL,NULL,false,
        jsonb_build_object('sourceQuoteObservationId',q.quote_observation_id,'dataQuality',q.data_quality),
        encode(digest((s.outcome_subject_id::text||':'||q.quote_observation_id::text)::bytea,'sha256'),'hex')
      FROM research.theta_outcome_subject s
      JOIN trade.candidate_point_in_time_evidence c ON c.contract_json->>'contractSymbol'=s.exact_contract_id
      JOIN market.execution_quote_observation q ON q.candidate_id=c.candidate_id
      WHERE s.exact_contract_id IS NOT NULL AND q.observed_at>s.decision_timestamp AND q.observed_at<=s.horizon_closes_at
      ON CONFLICT(content_hash) DO NOTHING`);
    const management=await this.pool.query(`INSERT INTO research.theta_outcome_observation(outcome_observation_id,
      outcome_subject_id,observed_at,provider_timestamp,received_at,source,provenance_class,completeness,
      reason_codes_json,exact_contract_id,bid,ask,underlying_spot,economic_pnl,fees,slippage,capital_days,
      lifecycle_state,terminal,observation_json,content_hash)
      SELECT gen_random_uuid(),s.outcome_subject_id,later.observed_at,NULL,later.created_at,'THETA_MANAGEMENT_INPUT',
        'REPLAY_OBSERVED',CASE WHEN later.input_json#>>'{economics,wholeChainPnl}' IS NULL THEN 'PARTIAL' ELSE 'COMPLETE' END,
        jsonb_build_array('BROKER_RECONCILED_MANAGEMENT_STATE'),NULL,
        NULL,NULL,NULL,(later.input_json#>>'{economics,wholeChainPnl}')::numeric,
        (later.input_json#>>'{economics,fees}')::numeric,NULL,
        GREATEST(0,extract(epoch FROM (later.observed_at-s.decision_timestamp))/86400),later.lifecycle_state::text,false,
        jsonb_build_object('sourceManagementInputSnapshotId',later.management_input_snapshot_id),
        encode(digest((s.outcome_subject_id::text||':'||later.management_input_snapshot_id::text)::bytea,'sha256'),'hex')
      FROM research.theta_outcome_subject s JOIN trade.management_input_snapshot source
        ON source.management_input_snapshot_id=s.source_management_input_snapshot_id
      JOIN trade.management_input_snapshot later ON later.chain_id=source.chain_id
        AND later.observed_at>s.decision_timestamp AND later.observed_at<=s.horizon_closes_at
      WHERE s.source_management_input_snapshot_id IS NOT NULL
      ON CONFLICT(content_hash) DO NOTHING`);
    return (contract.rowCount??0)+(management.rowCount??0);
  }
}

export function deterministicUuid(value:string):string{
  const bytes=Buffer.from(createHash('sha256').update(value).digest('hex').slice(0,32),'hex');
  bytes[6]=((bytes[6]??0)&0x0f)|0x40; bytes[8]=((bytes[8]??0)&0x3f)|0x80;
  const hex=bytes.toString('hex'); return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

function numeric(value:unknown):number|null{
  if(value===null||value===undefined)return null;
  const parsed=Number(value);return Number.isFinite(parsed)?parsed:null;
}

function labelTypeForP2B(subjectType:string):OutcomeLabelType{
  if(subjectType==='SELECTED_STRIKE')return 'SELECTED_CONTRACT_OUTCOME';
  if(subjectType==='NEIGHBOR_STRIKE')return 'NEIGHBOR_STRIKE_OUTCOME';
  if(subjectType==='OTHER_EXPIRATION')return 'OTHER_EXPIRATION_OUTCOME';
  if(subjectType==='OTHER_STRUCTURE')return 'OTHER_STRUCTURE_OUTCOME';
  if(subjectType==='WAIT')return 'WAIT_OUTCOME';
  throw new Error(`P2B_COUNTERFACTUAL_SUBJECT_UNSUPPORTED:${subjectType}`);
}
