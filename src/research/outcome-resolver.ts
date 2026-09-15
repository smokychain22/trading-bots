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
  readonly policyLearningRecordsCreated:number;readonly materialized:OutcomeSubjectMaterializationReport;
}
export interface OutcomeSubjectMaterializationReport {
  readonly wholeChain:number;readonly strategy:number;readonly actionRegret:number;readonly contractRegret:number;
  readonly strategyRegret:number;readonly wait:number;readonly management:number;readonly contract:number;
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
    const materialized=await this.materializeEligibleSubjects();
    const subjectsCreated=Object.values(materialized).reduce((sum,value)=>sum+value,0);
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
      const brokerActual=values.length>0&&values.every((item)=>item.provenance==='BROKER_ACTUAL');
      const receipt=resolveOutcome({subject,observations:values,asOf,
        executionModel:{modelClass:brokerActual?'BROKER_ACTUAL':contractLabel?'MARKET_MARK':'NONE',
          version:brokerActual?'theta-broker-actual-v1':contractLabel?'theta-market-mark-v1':'theta-no-execution-model-v1',
          positionSide:null,multiplier:null,entryPrice:null,entryFees:null,exitFees:null,perLegSlippage:null}});
      if(receipt.state==='PENDING'){pending++;continue;}
      const receiptId=deterministicUuid(`resolution:${row.outcome_subject_id}:${receipt.contentHash}`);
      const inserted=await this.pool.query(`INSERT INTO research.theta_outcome_resolution_receipt(
        outcome_resolution_receipt_id,outcome_subject_id,resolution_state,provenance_class,completeness,
        decision_timestamp,outcome_observation_start,outcome_observation_end,label_available_at,resolution_timestamp,
        execution_model_class,execution_model_version,receipt_json,execution_authorized,content_hash)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,false,$14) ON CONFLICT DO NOTHING
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
          JSON.stringify(receipt.tca),
          JSON.stringify({terminalState:receipt.terminalState,reasonCodes:receipt.reasonCodes}),receipt.contentHash]);
        resolved++;
      }else if(receipt.state==='UNRESOLVED')unresolved++;
      else if(receipt.state==='INVALID')invalid++;
    }
    const policyLearningRecordsCreated=await this.materializePolicyLearningRecords();
    return {subjectsCreated,observationsCreated,inspected:rows.rowCount??0,resolved,pending,unresolved,invalid,
      policyLearningRecordsCreated,materialized};
  }

  async materializeEligibleSubjects():Promise<OutcomeSubjectMaterializationReport>{
    const [wholeChain,strategy,actionRegret,contractRegret,strategyRegret,wait,management,contract]=await Promise.all([
      this.materializeWholeChainSubjects(),this.materializeStrategySubjects(),this.materializeActionRegretSubjects(),
      this.materializeContractRegretSubjects(),this.materializeStrategyRegretSubjects(),this.materializeWaitSubjects(),
      this.materializeManagementSubjects(),this.materializeP2BSubjects(),
    ]);
    return {wholeChain,strategy,actionRegret,contractRegret,strategyRegret,wait,management,contract};
  }

  private async materializeWholeChainSubjects():Promise<number>{
    const rows=await this.pool.query(`SELECT ec.chain_id,ec.opened_at,ec.closed_at,ec.lifecycle_state,
      bi.account_id,ol.decision_id,d.fusion_snapshot_id,fs.content_hash AS feature_hash,
      COALESCE(sv.semantic_version,'UNVERSIONED') AS strategy_version
      FROM trade.economic_chain ec JOIN core.bot_instance bi USING(bot_instance_id)
      LEFT JOIN LATERAL (SELECT option_leg.decision_id FROM trade.option_leg
        WHERE option_leg.chain_id=ec.chain_id AND option_leg.decision_id IS NOT NULL ORDER BY option_leg.opened_at LIMIT 1) ol ON true
      LEFT JOIN trade.decision d ON d.decision_id=ol.decision_id
      LEFT JOIN trade.fusion_snapshot fs ON fs.fusion_snapshot_id=d.fusion_snapshot_id
      LEFT JOIN core.strategy_version sv ON sv.strategy_version_id=bi.strategy_version_id
      WHERE ec.closed_at IS NOT NULL AND ec.closed_at>ec.opened_at
      ORDER BY ec.opened_at,ec.chain_id`);
    let created=0;
    for(const row of rows.rows){
      const context={chainId:String(row.chain_id),accountId:String(row.account_id),entryDecisionId:row.decision_id??null,
        fusionSnapshotId:row.fusion_snapshot_id??null,terminalLifecycleState:String(row.lifecycle_state),
        terminalCondition:'CANONICAL_ECONOMIC_CHAIN_CLOSED'};
      const featureHash=typeof row.feature_hash==='string'?row.feature_hash:hashValue({context,kind:'WHOLE_CHAIN_FEATURE_LINEAGE'});
      const subject:OutcomeSubject={subjectId:String(row.chain_id),labelType:'WHOLE_CHAIN_OUTCOME',
        decisionTimestamp:new Date(row.opened_at).toISOString(),featureSnapshotHash:featureHash,
        candidateUniverseHash:hashValue({context,kind:'WHOLE_CHAIN_CANDIDATE_LINEAGE'}),exactContractId:null,
        strategyVersion:String(row.strategy_version),horizonId:`${outcomeHorizonPolicyVersion}:TERMINAL_CHAIN_EVENT`,
        horizonClosesAt:new Date(row.closed_at).toISOString()};
      created+=await this.insertSubject('source_chain_id',String(row.chain_id),subject,{comparisonGroupId:`CHAIN:${row.chain_id}`,
        strategyBranch:null,actionCode:'CHAIN_TERMINAL',context});
    }
    return created;
  }

  private async materializeStrategySubjects():Promise<number>{
    const rows=await this.pool.query(`SELECT f.frontier_id,f.observed_at,f.content_hash,f.strategy_version,
      f.selected_branch,f.global_wait_earned,f.frontier_json,fs.content_hash AS feature_hash,
      COALESCE(jsonb_agg(jsonb_build_object('branch',b.branch,'evaluated',b.evaluated,'applicable',b.applicable,
        'evaluationState',b.evaluation_state,'bestCandidateRef',b.best_candidate_ref,'routeReasons',b.route_reasons_json)
        ORDER BY b.branch) FILTER(WHERE b.branch_evidence_id IS NOT NULL),'[]'::jsonb) AS branches
      FROM trade.canonical_strategy_frontier f JOIN trade.fusion_snapshot fs USING(fusion_snapshot_id)
      LEFT JOIN trade.canonical_strategy_branch_evidence b USING(frontier_id)
      GROUP BY f.frontier_id,fs.content_hash ORDER BY f.observed_at,f.frontier_id`);
    let created=0;
    for(const row of rows.rows){
      const branches=Array.isArray(row.branches)?row.branches as Record<string,unknown>[]:[];
      const applicable=branches.filter((item)=>item.applicable===true&&item.evaluated===true).map((item)=>String(item.branch));
      if(row.global_wait_earned===true)applicable.push('WAIT');
      for(const branch of [...new Set(applicable)]){
        const context={frontierId:String(row.frontier_id),branch,selected:branch===String(row.selected_branch),
          selectedBranch:row.selected_branch??null,globalWaitEarned:Boolean(row.global_wait_earned),branches,
          frontier:row.frontier_json};
        const subject:OutcomeSubject={subjectId:`${row.frontier_id}:${branch}`,labelType:'STRATEGY_OUTCOME',
          decisionTimestamp:new Date(row.observed_at).toISOString(),featureSnapshotHash:String(row.feature_hash),
          candidateUniverseHash:String(row.content_hash),exactContractId:null,strategyVersion:String(row.strategy_version),
          horizonId:`${outcomeHorizonPolicyVersion}:ONE_DAY`,horizonClosesAt:plusMs(row.observed_at,86_400_000)};
        created+=await this.insertSubject('source_frontier_id',String(row.frontier_id),subject,
          {comparisonGroupId:`STRATEGY:${row.frontier_id}`,strategyBranch:branch,actionCode:branch==='WAIT'?'WAIT':null,context});
      }
    }
    return created;
  }

  private async materializeWaitSubjects():Promise<number>{
    const rows=await this.pool.query(`SELECT w.*,d.fusion_snapshot_id,fs.content_hash AS feature_hash,
      COALESCE(cs.set_hash,w.content_hash) AS universe_hash,COALESCE(sv.semantic_version,'UNVERSIONED') AS strategy_version
      FROM trade.global_wait_evidence w JOIN trade.decision d USING(decision_id)
      JOIN trade.fusion_snapshot fs USING(fusion_snapshot_id)
      LEFT JOIN trade.candidate_set cs ON cs.candidate_set_id=w.candidate_set_id
      LEFT JOIN core.strategy_version sv ON sv.strategy_version_id=fs.strategy_version_id
      ORDER BY w.decision_time,w.decision_id`);
    let created=0;
    for(const row of rows.rows){
      const context={waitReason:String(row.wait_reason),underlyingsEvaluated:Number(row.underlyings_evaluated),
        contractsEvaluated:Number(row.contracts_evaluated),branchesConsidered:row.branches_considered_json,
        bestRejectedCandidateId:row.best_rejected_candidate_id??null,bestFeasibleAction:row.best_feasible_action??null,
        blockers:row.blockers_json,dataMissing:row.data_missing_json,searchProof:row.search_proof_json,
        earned:Boolean(row.earned),validationViolations:row.validation_violations_json};
      const subject:OutcomeSubject={subjectId:String(row.decision_id),labelType:'WAIT_OUTCOME',
        decisionTimestamp:new Date(row.decision_time).toISOString(),featureSnapshotHash:String(row.feature_hash),
        candidateUniverseHash:String(row.universe_hash),exactContractId:null,strategyVersion:String(row.strategy_version),
        horizonId:`${outcomeHorizonPolicyVersion}:ONE_DAY`,horizonClosesAt:plusMs(row.decision_time,86_400_000)};
      created+=await this.insertSubject('source_decision_id',String(row.decision_id),subject,
        {comparisonGroupId:`WAIT:${row.decision_id}`,strategyBranch:'WAIT',actionCode:'WAIT',context});
    }
    return created;
  }

  private async materializeActionRegretSubjects():Promise<number>{
    const rows=await this.pool.query(`SELECT maf.management_action_frontier_id,maf.management_input_snapshot_id,
      maf.observed_at,maf.actions_json,maf.selected_action,maf.content_hash,mis.content_hash AS feature_hash,
      COALESCE(maf.policy_version,'UNPROMOTED') AS policy_version
      FROM trade.management_action_frontier maf JOIN trade.management_input_snapshot mis USING(management_input_snapshot_id)
      ORDER BY maf.observed_at,maf.management_action_frontier_id`);
    let created=0;
    for(const row of rows.rows){
      const actions=feasibleActions(row.actions_json);
      if(actions.length<2)continue;
      const context={frontierId:String(row.management_action_frontier_id),selectedAction:row.selected_action??null,
        feasibleActions:actions,comparisonRule:'RISK_AND_COST_ADJUSTED_NOT_RAW_PNL'};
      const subject:OutcomeSubject={subjectId:String(row.management_action_frontier_id),labelType:'ACTION_REGRET',
        decisionTimestamp:new Date(row.observed_at).toISOString(),featureSnapshotHash:String(row.feature_hash),
        candidateUniverseHash:String(row.content_hash),exactContractId:null,strategyVersion:String(row.policy_version),
        horizonId:`${outcomeHorizonPolicyVersion}:ONE_DAY`,horizonClosesAt:plusMs(row.observed_at,86_400_000)};
      created+=await this.insertSubject('source_management_input_snapshot_id',String(row.management_input_snapshot_id),subject,
        {comparisonGroupId:`ACTION:${row.management_action_frontier_id}`,strategyBranch:null,
          actionCode:row.selected_action??null,context});
    }
    return created;
  }

  private async materializeContractRegretSubjects():Promise<number>{
    const rows=await this.pool.query(`SELECT chain_decision_evidence_id,observed_at,contract_version,content_hash,
      counterfactual_label_contract_json FROM research.theta_option_chain_decision_evidence
      ORDER BY observed_at,chain_decision_evidence_id`);
    let created=0;
    for(const row of rows.rows){
      const contract=objectValue(row.counterfactual_label_contract_json),subjects=Array.isArray(contract.subjects)?contract.subjects:[];
      const alternatives=subjects.filter((item)=>item!==null&&typeof item==='object'&&!Array.isArray(item));
      if(alternatives.length<2)continue;
      const context={chainDecisionEvidenceId:String(row.chain_decision_evidence_id),frozenAlternatives:alternatives,
        comparisonRule:'AFTER_COST_RISK_CAPITAL_DAYS'};
      const subject:OutcomeSubject={subjectId:String(row.chain_decision_evidence_id),labelType:'CONTRACT_REGRET',
        decisionTimestamp:new Date(row.observed_at).toISOString(),featureSnapshotHash:String(row.content_hash),
        candidateUniverseHash:String(row.content_hash),exactContractId:null,strategyVersion:String(row.contract_version),
        horizonId:`${outcomeHorizonPolicyVersion}:ONE_DAY`,horizonClosesAt:plusMs(row.observed_at,86_400_000)};
      created+=await this.insertSubject('source_chain_decision_evidence_id',String(row.chain_decision_evidence_id),subject,
        {comparisonGroupId:`CONTRACT:${row.chain_decision_evidence_id}`,strategyBranch:null,actionCode:null,context});
    }
    return created;
  }

  private async materializeStrategyRegretSubjects():Promise<number>{
    const rows=await this.pool.query(`SELECT f.frontier_id,f.observed_at,f.strategy_version,f.content_hash,
      fs.content_hash AS feature_hash,f.selected_branch,f.global_wait_earned,
      COALESCE(jsonb_agg(jsonb_build_object('branch',b.branch,'applicable',b.applicable,'evaluated',b.evaluated,
        'evaluationState',b.evaluation_state,'bestCandidateRef',b.best_candidate_ref) ORDER BY b.branch)
        FILTER(WHERE b.branch_evidence_id IS NOT NULL),'[]'::jsonb) AS branches
      FROM trade.canonical_strategy_frontier f JOIN trade.fusion_snapshot fs USING(fusion_snapshot_id)
      LEFT JOIN trade.canonical_strategy_branch_evidence b USING(frontier_id)
      GROUP BY f.frontier_id,fs.content_hash ORDER BY f.observed_at,f.frontier_id`);
    let created=0;
    for(const row of rows.rows){
      const branches=(Array.isArray(row.branches)?row.branches as unknown[]:[]).filter((item:unknown)=>objectValue(item).applicable===true&&objectValue(item).evaluated===true);
      if(branches.length+(row.global_wait_earned?1:0)<2)continue;
      const context={selectedBranch:row.selected_branch??null,branches,waitAvailable:Boolean(row.global_wait_earned),
        chargedCosts:['EXIT_COST','ENTRY_COST','SLIPPAGE','CAPITAL_CHURN','FOREGONE_THETA','INCREMENTAL_CAPITAL_DAYS']};
      const subject:OutcomeSubject={subjectId:String(row.frontier_id),labelType:'STRATEGY_REGRET',
        decisionTimestamp:new Date(row.observed_at).toISOString(),featureSnapshotHash:String(row.feature_hash),
        candidateUniverseHash:String(row.content_hash),exactContractId:null,strategyVersion:String(row.strategy_version),
        horizonId:`${outcomeHorizonPolicyVersion}:ONE_DAY`,horizonClosesAt:plusMs(row.observed_at,86_400_000)};
      created+=await this.insertSubject('source_frontier_id',String(row.frontier_id),subject,
        {comparisonGroupId:`STRATEGY:${row.frontier_id}`,strategyBranch:row.selected_branch??null,actionCode:null,context});
    }
    return created;
  }

  private async insertSubject(sourceColumn:'source_chain_decision_evidence_id'|'source_management_input_snapshot_id'|
    'source_chain_id'|'source_frontier_id'|'source_decision_id',sourceId:string,subject:OutcomeSubject,metadata:{
      comparisonGroupId:string|null;strategyBranch:string|null;actionCode:string|null;context:Record<string,unknown>
    }):Promise<number>{
    const contentHash=hashValue({...subject,sourceColumn,sourceId,...metadata});
    const id=deterministicUuid(`p2d:${sourceColumn}:${sourceId}:${subject.subjectId}:${subject.labelType}:${subject.decisionTimestamp}:${subject.horizonId}`);
    const result=await this.pool.query(`INSERT INTO research.theta_outcome_subject(outcome_subject_id,${sourceColumn},
      subject_id,label_type,decision_timestamp,feature_snapshot_hash,candidate_universe_hash,exact_contract_id,
      strategy_version,horizon_id,horizon_closes_at,resolver_contract_version,comparison_group_id,strategy_branch,
      action_code,subject_context_json,execution_authorized,content_hash)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,false,$17)
      ON CONFLICT(subject_id,label_type,decision_timestamp,horizon_id,resolver_contract_version) DO NOTHING`,[
      id,sourceId,subject.subjectId,subject.labelType,subject.decisionTimestamp,subject.featureSnapshotHash,
      subject.candidateUniverseHash,subject.exactContractId,subject.strategyVersion,subject.horizonId,
      subject.horizonClosesAt,outcomeResolutionContractVersion,metadata.comparisonGroupId,metadata.strategyBranch,
      metadata.actionCode,JSON.stringify(metadata.context),contentHash]);
    return result.rowCount??0;
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
          created+=await this.insertSubject('source_chain_decision_evidence_id',String(row.chain_decision_evidence_id),subject,
            {comparisonGroupId:`CONTRACT:${row.chain_decision_evidence_id}`,strategyBranch:null,
              actionCode:kind==='WAIT'?'WAIT':null,context:{subjectType:kind,frozenSubject:value,chainDecisionEvidenceId:row.chain_decision_evidence_id}});
        }
      }
    }
    return created;
  }

  private async materializeManagementSubjects():Promise<number>{
    const rows=await this.pool.query(`SELECT maf.management_action_frontier_id,maf.management_input_snapshot_id,
      maf.observed_at,maf.actions_json,maf.selected_action,maf.content_hash,COALESCE(maf.policy_version,'UNPROMOTED') AS policy_version,
      mis.content_hash AS feature_hash,mis.chain_id,mis.input_json,
      smpe.profit_state_json,smpe.action_comparisons_json,smpe.strategy_switch_json
      FROM trade.management_action_frontier maf
      JOIN trade.management_input_snapshot mis USING(management_input_snapshot_id)
      LEFT JOIN research.theta_shadow_management_policy_evidence smpe USING(management_input_snapshot_id)
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
        const profit=objectValue(row.profit_state_json);
        const currentUnrealizedPnl=numeric(profit.currentUnrealizedPnl);
        created+=await this.insertSubject('source_management_input_snapshot_id',String(row.management_input_snapshot_id),subject,
          {comparisonGroupId:`ACTION:${row.management_action_frontier_id}`,strategyBranch:null,actionCode:action,
            context:{chainId:row.chain_id,selected,action,feasibleActions:feasibleActions(row.actions_json),
              profitPreservation:profit,openWinnerObserved:currentUnrealizedPnl!==null&&currentUnrealizedPnl>0,
              managementState:row.input_json,actionComparisons:row.action_comparisons_json??[],strategySwitch:row.strategy_switch_json??{}}});
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
    const chains=await this.pool.query(`INSERT INTO research.theta_outcome_observation(outcome_observation_id,
      outcome_subject_id,observed_at,provider_timestamp,received_at,source,provenance_class,completeness,
      reason_codes_json,exact_contract_id,bid,ask,underlying_spot,economic_pnl,fees,slippage,capital_days,
      lifecycle_state,terminal,observation_json,content_hash)
      SELECT gen_random_uuid(),s.outcome_subject_id,ec.closed_at,NULL,GREATEST(ec.created_at,ec.closed_at),
        'THETA_ECONOMIC_LEDGER','BROKER_ACTUAL',
        CASE WHEN facts.economic_fact_count>0 AND facts.option_open=0 AND facts.stock_open=0 AND facts.unknown_fill_fees=0
          THEN 'COMPLETE' ELSE 'PARTIAL' END,
        CASE WHEN facts.economic_fact_count=0 THEN jsonb_build_array('NO_ECONOMIC_FACTS')
          WHEN facts.unknown_fill_fees>0 THEN jsonb_build_array('EXECUTION_FEES_UNKNOWN') ELSE '[]'::jsonb END,
        NULL,NULL,NULL,NULL,
        CASE WHEN facts.economic_fact_count>0 AND facts.option_open=0 AND facts.stock_open=0 AND facts.unknown_fill_fees=0
          THEN facts.option_pnl+facts.stock_pnl+facts.dividends-facts.fees ELSE NULL END,
        CASE WHEN facts.unknown_fill_fees=0 THEN facts.fees ELSE NULL END,NULL,
        extract(epoch FROM (ec.closed_at-ec.opened_at))/86400,ec.lifecycle_state::text,true,
        jsonb_build_object('chainId',ec.chain_id,'optionRealizedPnl',facts.option_pnl,'stockRealizedPnl',facts.stock_pnl,
          'dividends',facts.dividends,'fees',CASE WHEN facts.unknown_fill_fees=0 THEN facts.fees ELSE NULL END,
          'economicFactCount',facts.economic_fact_count,'oldRollLossPreserved',true),
        encode(digest((s.outcome_subject_id::text||':CHAIN_TERMINAL:'||ec.closed_at::text)::bytea,'sha256'),'hex')
      FROM research.theta_outcome_subject s JOIN trade.economic_chain ec ON ec.chain_id=s.source_chain_id
      JOIN LATERAL (SELECT
        ((SELECT count(*) FROM trade.option_leg ol WHERE ol.chain_id=ec.chain_id)
          +(SELECT count(*) FROM trade.stock_lot sl WHERE sl.chain_id=ec.chain_id)
          +(SELECT count(*) FROM trade.fee_event fe WHERE fe.chain_id=ec.chain_id))::int AS economic_fact_count,
        (SELECT count(*) FROM trade.option_leg ol WHERE ol.chain_id=ec.chain_id AND ol.closed_at IS NULL)::int AS option_open,
        (SELECT count(*) FROM trade.stock_lot sl WHERE sl.chain_id=ec.chain_id AND sl.disposed_at IS NULL)::int AS stock_open,
        (SELECT count(*) FROM trade.fill f JOIN trade.broker_order bo USING(broker_order_id)
          JOIN trade.order_intent oi USING(order_intent_id) WHERE oi.chain_id=ec.chain_id AND f.fees IS NULL)::int AS unknown_fill_fees,
        COALESCE((SELECT sum(ol.realized_pnl) FROM trade.option_leg ol WHERE ol.chain_id=ec.chain_id),0) AS option_pnl,
        COALESCE((SELECT sum(sl.realized_pnl) FROM trade.stock_lot sl WHERE sl.chain_id=ec.chain_id),0) AS stock_pnl,
        COALESCE((SELECT sum(de.amount_per_share*sl.shares) FROM trade.dividend_event de JOIN trade.stock_lot sl USING(stock_lot_id)
          WHERE sl.chain_id=ec.chain_id),0) AS dividends,
        COALESCE((SELECT sum(fe.amount) FROM trade.fee_event fe WHERE fe.chain_id=ec.chain_id),0) AS fees) facts ON true
      WHERE s.label_type='WHOLE_CHAIN_OUTCOME' AND ec.closed_at IS NOT NULL
      ON CONFLICT(content_hash) DO NOTHING`);
    return (contract.rowCount??0)+(management.rowCount??0)+(chains.rowCount??0);
  }

  private async materializePolicyLearningRecords():Promise<number>{
    const result=await this.pool.query(`INSERT INTO research.theta_policy_learning_record(
      policy_learning_record_id,outcome_subject_id,resolved_outcome_label_id,decision_timestamp,label_available_at,
      strategy_branch,selected_action,action_set_json,pit_context_json,option_context_json,portfolio_context_json,
      outcome_json,provenance_class,tca_json,return_metrics_json,return_cohort,win_rate_cohort,cluster_ids_json,
      target_families_json,return_cohort_definition_version,win_rate_aggregation_version,execution_authorized,content_hash)
      SELECT gen_random_uuid(),s.outcome_subject_id,l.resolved_outcome_label_id,s.decision_timestamp,l.label_available_at,
        s.strategy_branch,s.action_code,COALESCE(s.subject_context_json->'feasibleActions','[]'::jsonb),s.subject_context_json,
        COALESCE(s.subject_context_json->'optionContext','{}'::jsonb),
        COALESCE(s.subject_context_json->'portfolioState',s.subject_context_json->'managementState'->'context'->'portfolioState','{}'::jsonb),
        l.outcome_json,l.provenance_class,l.tca_json,
        jsonb_build_object('premiumCapture',NULL,'returnOnSecuredCapital',NULL,'returnOnMaxRisk',NULL,
          'annualizedCapitalReturn',NULL,'returnPerCapitalDay',
          CASE WHEN (l.path_statistics_json->>'terminalProfit') IS NOT NULL
            AND (s.subject_context_json#>>'{profitPreservation,securedCapital}') IS NOT NULL
            AND extract(epoch FROM (l.label_available_at-s.decision_timestamp))>0
          THEN ((l.path_statistics_json->>'terminalProfit')::numeric
            /NULLIF((s.subject_context_json#>>'{profitPreservation,securedCapital}')::numeric,0))
            /(extract(epoch FROM (l.label_available_at-s.decision_timestamp))/86400) ELSE NULL END),
        CASE WHEN (l.path_statistics_json->>'terminalProfit') IS NULL
          OR (s.subject_context_json#>>'{profitPreservation,securedCapital}') IS NULL THEN NULL
          WHEN abs((l.path_statistics_json->>'terminalProfit')::numeric
            /NULLIF((s.subject_context_json#>>'{profitPreservation,securedCapital}')::numeric,0))<0.10 THEN 'VERY_SMALL'
          WHEN abs((l.path_statistics_json->>'terminalProfit')::numeric
            /NULLIF((s.subject_context_json#>>'{profitPreservation,securedCapital}')::numeric,0))<0.20 THEN 'SMALL'
          WHEN abs((l.path_statistics_json->>'terminalProfit')::numeric
            /NULLIF((s.subject_context_json#>>'{profitPreservation,securedCapital}')::numeric,0))<0.40 THEN 'MEDIUM'
          WHEN abs((l.path_statistics_json->>'terminalProfit')::numeric
            /NULLIF((s.subject_context_json#>>'{profitPreservation,securedCapital}')::numeric,0))<0.75 THEN 'LARGE'
          ELSE 'VERY_LARGE' END,NULL,
        jsonb_build_object('decisionDate',s.decision_timestamp::date,'comparisonGroup',s.comparison_group_id,
          'wholeChain',s.source_chain_id,'strategyBranch',s.strategy_branch),
        jsonb_build_object('classification',jsonb_build_array('ACTION_PROFITABLE','ACTION_BEATS_WAIT','HOLD_BEATS_CLOSE'),
          'regression',jsonb_build_array('NET_PNL','RETURN_PER_CAPITAL_DAY','MFE','MAE'),
          'distribution',jsonb_build_array('QUANTILES','TAIL_LOSS','CVAR')),
        'theta-return-cohort-v1',NULL,false,encode(digest((s.outcome_subject_id::text||':'||l.resolved_outcome_label_id::text||':theta-policy-learning-v1')::bytea,'sha256'),'hex')
      FROM research.theta_outcome_subject s JOIN research.theta_resolved_outcome_label l USING(outcome_subject_id)
      ON CONFLICT(outcome_subject_id,resolved_outcome_label_id) DO NOTHING`);
    return result.rowCount??0;
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

function objectValue(value:unknown):Record<string,unknown>{
  return value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
}
function plusMs(value:unknown,milliseconds:number):string{return new Date(Date.parse(String(value))+milliseconds).toISOString();}
function hashValue(value:unknown):string{return createHash('sha256').update(canonicalJson(value)).digest('hex');}
function feasibleActions(value:unknown):string[]{
  return (Array.isArray(value)?value:[]).flatMap((item)=>{
    const action=objectValue(item),name=String(action.action??action.actionCode??'');
    return name.length>0&&(action.feasibility==='FEASIBLE'||action.feasible===true)?[name]:[];
  });
}

function labelTypeForP2B(subjectType:string):OutcomeLabelType{
  if(subjectType==='SELECTED_STRIKE')return 'SELECTED_CONTRACT_OUTCOME';
  if(subjectType==='NEIGHBOR_STRIKE')return 'NEIGHBOR_STRIKE_OUTCOME';
  if(subjectType==='OTHER_EXPIRATION')return 'OTHER_EXPIRATION_OUTCOME';
  if(subjectType==='OTHER_STRUCTURE')return 'OTHER_STRUCTURE_OUTCOME';
  if(subjectType==='WAIT')return 'WAIT_OUTCOME';
  throw new Error(`P2B_COUNTERFACTUAL_SUBJECT_UNSUPPORTED:${subjectType}`);
}
