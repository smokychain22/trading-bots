import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { verifyFusionSnapshot, type JsonValue } from '../market/fusion-snapshot.js';
import type { ThetaShadowCycleResult } from './theta-shadow-cycle.js';
import { buildStrategyDecisionEnvelope } from './strategy-decision-envelope.js';
import { validateGlobalWaitEvidence, type GlobalWaitEvidence } from './decision-evidence.js';

export interface ThetaCyclePersistenceContext {
  readonly botInstanceId: string;
  readonly universeVersionId: string | null;
  readonly strategyVersionId: string;
  readonly featureVersionId: string;
  readonly riskLimitVersionId: string;
  readonly executionVersionId: string;
  readonly costModelVersionId: string;
  readonly accountSnapshotId: number;
}

export interface PersistedThetaCycle {
  readonly fusionSnapshotId: string;
  readonly candidateSetId: string | null;
  readonly candidateCount: number;
  readonly decisionId: string | null;
  readonly strategyRouteId: string | null;
  readonly shadowOpportunityCount: number;
}

export function deterministicRuntimeUuid(value: string): string {
  const bytes = Buffer.from(createHash('sha256').update(value).digest('hex').slice(0, 32), 'hex');
  const versionByte = bytes.at(6);
  const variantByte = bytes.at(8);
  if (versionByte === undefined || variantByte === undefined) throw new Error('RUNTIME_UUID_HASH_INVALID');
  bytes[6] = (versionByte & 0x0f) | 0x40;
  bytes[8] = (variantByte & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

function objectField(snapshot: Readonly<Record<string, JsonValue>>, key: string): JsonValue {
  return snapshot[key] ?? null;
}

function jsonObject(value: JsonValue | undefined): Record<string, JsonValue> {
  return value !== null && value !== undefined && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

export class PostgresThetaCycleStore {
  constructor(private readonly pool: Pool) {}

  async persist(context: ThetaCyclePersistenceContext, cycle: ThetaShadowCycleResult): Promise<PersistedThetaCycle> {
    if (cycle.fusionSnapshot === null) throw new Error('FUSION_SNAPSHOT_NOT_AVAILABLE');
    const fusion = cycle.fusionSnapshot;
    if (fusion.contentHash !== cycle.snapshotContentHash) throw new Error('FUSION_SNAPSHOT_HASH_MISMATCH');
    if (!verifyFusionSnapshot(fusion.snapshot as JsonValue, fusion.contentHash)) throw new Error('FUSION_SNAPSHOT_CONTENT_INVALID');
    const fusionSnapshotId = deterministicRuntimeUuid(`fusion:${context.botInstanceId}:${fusion.contentHash}`);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO trade.fusion_snapshot(
          fusion_snapshot_id,bot_instance_id,decision_time,trigger_type,universe_version_id,
          strategy_version_id,feature_version_id,risk_limit_version_id,execution_version_id,cost_model_version_id,
          account_snapshot_id,feature_snapshot_refs_json,portfolio_state_json,provider_provenance_json,
          unknown_features_json,snapshot_json,content_hash)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'[]'::jsonb,$12,$13,$14,$15,$16)
         ON CONFLICT(bot_instance_id,content_hash) DO NOTHING`,
        [fusionSnapshotId, context.botInstanceId, String(fusion.snapshot.decisionTimeUtc), String(fusion.snapshot.triggerType),
          context.universeVersionId, context.strategyVersionId, context.featureVersionId, context.riskLimitVersionId,
          context.executionVersionId, context.costModelVersionId, context.accountSnapshotId,
          JSON.stringify(objectField(fusion.snapshot, 'portfolioExposure')),
          JSON.stringify(objectField(fusion.snapshot, 'sourceProvenance')),
          JSON.stringify(objectField(fusion.snapshot, 'unknownFeatures')), JSON.stringify(fusion.snapshot), fusion.contentHash],
      );

      const candidates = await this.persistCandidates(client, fusionSnapshotId, cycle);
      const strategyRouteId = await this.persistRoute(client, fusionSnapshotId, cycle);
      const decisionId = await this.persistDecision(client, fusionSnapshotId, cycle, candidates.candidateSetId, candidates.candidateIds,
        context.strategyVersionId);
      await this.persistPointInTimeEvidence(client,context,cycle,fusionSnapshotId,candidates.candidateSetId,
        candidates.candidateIds,decisionId);
      let shadowOpportunityCount = 0;
      for (const entry of cycle.orchestration?.shadowOpportunities ?? []) {
        const result = await client.query(
          `INSERT INTO trade.shadow_opportunity(
            opportunity_id,fusion_snapshot_id,observed_at,underlying,contract_symbol,strategy_branch,
            ev_net,tail_adjusted_ev,return_per_capital_day,capital_required,uncertainty,ownership_snapshot_id,
            regime_snapshot_ref,aegis_state,recommended_quantity,execution_quality_acceptable,outcome,wait_reason,
            rejection_category,reasons_json,policy_version,model_versions_json,eventual_outcome_known,eventual_realized_pnl)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
           ON CONFLICT(opportunity_id) DO NOTHING RETURNING opportunity_id`,
          [entry.opportunityId, fusionSnapshotId, entry.timestamp, entry.underlying, entry.contractSymbol,
            entry.strategyBranch, entry.evNet, entry.tailAdjustedEv, entry.returnPerCapitalDay, entry.capitalRequired,
            entry.uncertainty, entry.ownershipSnapshotId, entry.regimeSnapshotId, entry.aegisState,
            entry.recommendedQuantity, entry.executionQualityAcceptable, entry.outcome, entry.waitReason,
            entry.rejectionCategory, JSON.stringify(entry.reasons), entry.policyVersion,
            JSON.stringify(entry.modelVersions), entry.eventualOutcomeKnown, entry.eventualRealizedPnl],
        );
        shadowOpportunityCount += result.rowCount ?? 0;
      }
      await client.query('COMMIT');
      return { fusionSnapshotId, candidateSetId: candidates.candidateSetId, candidateCount: candidates.candidateIds.size, decisionId, strategyRouteId, shadowOpportunityCount };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }

  private async persistCandidates(
    client: PoolClient,
    fusionSnapshotId: string,
    cycle: ThetaShadowCycleResult,
  ): Promise<{ candidateSetId: string | null; candidateIds: Map<string, string> }> {
    const receipt = cycle.orchestration?.receipt;
    if (receipt === null || receipt === undefined) return { candidateSetId: null, candidateIds: new Map() };

    const evaluated = cycle.orchestration?.thetaQ?.candidates ?? [];
    const setPayload = JSON.stringify(evaluated);
    const setHash = createHash('sha256').update(setPayload).digest('hex');
    const candidateSetId = deterministicRuntimeUuid(`candidate-set:${fusionSnapshotId}:THETA_CONVENTIONAL:${setHash}`);
    await client.query(
      `INSERT INTO trade.candidate_set(candidate_set_id,fusion_snapshot_id,branch,candidate_count,generated_at,generator_version,set_hash)
       VALUES($1,$2,'THETA_CONVENTIONAL',$3,$4,$5,$6)
       ON CONFLICT(fusion_snapshot_id,branch,set_hash) DO NOTHING`,
      [candidateSetId, fusionSnapshotId, evaluated.length, receipt.timestamp, cycle.orchestration?.thetaQ?.contractVersion ?? 'theta-runtime-no-candidate-v1', setHash],
    );

    const snapshotContracts = cycle.fusionSnapshot?.snapshot.contractCandidates;
    if (!Array.isArray(snapshotContracts)) throw new Error('FUSION_SNAPSHOT_CONTRACT_CANDIDATES_INVALID');
    const candidateIds = new Map<string, string>();
    for (const evaluatedCandidate of evaluated) {
      const contract = snapshotContracts.find((item) => {
        if (item === null || typeof item !== 'object' || Array.isArray(item)) return false;
        return item.optionSymbol === evaluatedCandidate.candidateId || item.occSymbol === evaluatedCandidate.candidateId;
      });
      if (contract === undefined || contract === null || typeof contract !== 'object' || Array.isArray(contract)) {
        throw new Error(`EVALUATED_CANDIDATE_CONTRACT_MISSING:${evaluatedCandidate.candidateId}`);
      }
      const underlying = String(contract.underlying);
      const contractSymbol = String(contract.occSymbol ?? contract.optionSymbol);
      const optionType = String(contract.optionType);
      const strike = Number(contract.strike);
      const expiration = String(contract.expiration);
      const multiplier = Number(contract.multiplier);
      if (!underlying || !contractSymbol || !['CALL', 'PUT'].includes(optionType) || !Number.isFinite(strike) || !Number.isFinite(multiplier)) {
        throw new Error(`EVALUATED_CANDIDATE_IDENTITY_INVALID:${evaluatedCandidate.candidateId}`);
      }

      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`theta-underlying:${underlying}`]);
      let underlyingResult = await client.query<{ underlying_id: string }>(
        `SELECT underlying_id FROM market.underlying WHERE symbol=$1 ORDER BY active DESC, created_at ASC LIMIT 1`, [underlying],
      );
      if (underlyingResult.rowCount === 0) {
        const underlyingId = deterministicRuntimeUuid(`underlying:${underlying}`);
        underlyingResult = await client.query<{ underlying_id: string }>(
          `INSERT INTO market.underlying(underlying_id,symbol,asset_type,exchange,currency,active)
           VALUES($1,$2,'US_EQUITY',NULL,'USD',true) RETURNING underlying_id`, [underlyingId, underlying],
        );
      }
      const underlyingId = underlyingResult.rows[0]?.underlying_id;
      if (underlyingId === undefined) throw new Error(`UNDERLYING_PERSISTENCE_FAILED:${underlying}`);

      const optionContractId = deterministicRuntimeUuid(`option-contract:${contractSymbol}`);
      await client.query(
        `INSERT INTO market.option_contract(option_contract_id,provider_contract_id,contract_symbol,underlying_id,option_type,strike,expiration_date,multiplier,tradable,status)
         VALUES($1,$2::text,$2::varchar(64),$3,$4,$5,$6,$7,$8,'ACTIVE')
         ON CONFLICT(contract_symbol) DO NOTHING`,
        [optionContractId, contractSymbol, underlyingId, optionType, strike, expiration, multiplier, Boolean(contract.executable)],
      );
      const persistedContract = await client.query<{ option_contract_id: string; underlying_id: string; option_type: string; strike: string; expiration_date: string; multiplier: string }>(
        `SELECT option_contract_id,underlying_id,option_type,strike::text,expiration_date::text,multiplier::text
         FROM market.option_contract WHERE contract_symbol=$1`, [contractSymbol],
      );
      const stored = persistedContract.rows[0];
      if (stored === undefined || stored.underlying_id !== underlyingId || stored.option_type !== optionType || Number(stored.strike) !== strike || stored.expiration_date !== expiration || Number(stored.multiplier) !== multiplier) {
        throw new Error(`OPTION_CONTRACT_IDENTITY_CONFLICT:${contractSymbol}`);
      }

      const candidateId = deterministicRuntimeUuid(`candidate:${candidateSetId}:${evaluatedCandidate.candidateId}`);
      candidateIds.set(evaluatedCandidate.candidateId, candidateId);
      const alternative = receipt.alternatives.find((item) => item.candidateId === evaluatedCandidate.candidateId) ?? null;
      const inserted = await client.query(
        `INSERT INTO trade.candidate(candidate_id,candidate_set_id,underlying_id,option_contract_id,structure_code,rank,action_feasible,
           ev_net,ownership_score,capital_required,metrics_json)
         VALUES($1,$2,$3,$4,'CSP',$5,$6,$7,$8,$9,$10)
         ON CONFLICT(candidate_id) DO NOTHING RETURNING candidate_id`,
        [candidateId, candidateSetId, underlyingId, stored.option_contract_id, evaluatedCandidate.rank, evaluatedCandidate.actionFeasible,
          evaluatedCandidate.economics?.ev_net ?? null, evaluatedCandidate.ownershipScore,
          evaluatedCandidate.economics?.secured_collateral_per_contract ?? null,
          JSON.stringify({ thetaQ: evaluatedCandidate, decisionAlternative: alternative, contract })],
      );
      if ((inserted.rowCount ?? 0) > 0) {
        for (const [index, reason] of evaluatedCandidate.reasons.entries()) {
          await client.query(
            `INSERT INTO trade.candidate_reason(candidate_id,reason_family,reason_code,polarity,value_json,importance_rank)
             VALUES($1,'THETA_Q',$2,$3,$4,$5)`,
            [candidateId, reason.code, reason.polarity, JSON.stringify({ detail: reason.detail }), index + 1],
          );
        }
      }
    }
    return { candidateSetId, candidateIds };
  }

  private async persistRoute(client: PoolClient, fusionSnapshotId: string, cycle: ThetaShadowCycleResult): Promise<string | null> {
    const routing = cycle.orchestration?.routing;
    if (routing === null || routing === undefined) return null;
    const routeId = deterministicRuntimeUuid(`route:${fusionSnapshotId}`);
    const eligibility = routing.results.map((result) => ({
      branch: result.strategyFamily, eligible: result.eligible,
      eligibilityState: result.eligibilityState, reasonCodes: result.reasons.map((reason) => reason.code),
    }));
    await client.query(
      `INSERT INTO trade.strategy_route(strategy_route_id,fusion_snapshot_id,evaluated_at,branch_eligibility_json,selected_branch,policy_version)
       VALUES($1,$2,$3,$4,NULL,$5) ON CONFLICT(fusion_snapshot_id) DO NOTHING`,
      [routeId, fusionSnapshotId, routing.timestamp, JSON.stringify(eligibility), routing.policyVersion],
    );
    return routeId;
  }

  private async persistDecision(client: PoolClient, fusionSnapshotId: string, cycle: ThetaShadowCycleResult,
    candidateSetId: string | null, candidateIds: ReadonlyMap<string, string>, strategyVersionId: string): Promise<string | null> {
    const receipt = cycle.orchestration?.receipt;
    if (receipt === null || receipt === undefined) return null;
    const selectedCandidateId = receipt.selectedCandidateId === null ? null : candidateIds.get(receipt.selectedCandidateId);
    if (receipt.selectedCandidateId !== null && selectedCandidateId === undefined) {
      throw new Error(`SELECTED_CANDIDATE_NOT_PERSISTED:${receipt.selectedCandidateId}`);
    }
    const decisionId = deterministicRuntimeUuid(`decision:${fusionSnapshotId}:${receipt.underlying}`);
    const strategyEnvelope = buildStrategyDecisionEnvelope({
      strategyVersionId,
      strategyBranch: 'THETA_CONVENTIONAL',
      receipt,
    });
    const inserted = await client.query(
      `INSERT INTO trade.decision(decision_id,fusion_snapshot_id,candidate_set_id,selected_candidate_id,decision_kind,action_code,quantity,
         aegis_action,strategy_branch,decided_at,status,explanation_text,explanation_hash,runtime_selected_candidate_ref,
         policy_version,model_versions_json,fail_closed_reason,receipt_json)
       VALUES($1,$2,$3,$4,'NEW_RISK',$5,$6,$7,'THETA_CONVENTIONAL',$8,'RECORDED',$9,$10,$11,$12,$13,$14,$15)
       ON CONFLICT(decision_id) DO NOTHING RETURNING decision_id`,
      [decisionId, fusionSnapshotId, candidateSetId,
        selectedCandidateId ?? null,
        receipt.winningAction, receipt.quantity,
        cycle.orchestration?.aegis?.newRiskState ?? null, receipt.timestamp, receipt.plainEnglishExplanation,
        createHash('sha256').update(receipt.plainEnglishExplanation).digest('hex'), receipt.selectedCandidateId,
        receipt.policyVersion, JSON.stringify(receipt.modelVersions), receipt.failClosedReason, JSON.stringify(strategyEnvelope)],
    );
    if ((inserted.rowCount ?? 0) > 0) {
      for (const [index, reasonCode] of receipt.reasonCodes.entries()) {
        await client.query(
          `INSERT INTO trade.decision_reason(decision_id,reason_family,reason_code,polarity,importance_rank,evidence_state)
           VALUES($1,'RUNTIME',$2,0,$3,'RECORDED')`, [decisionId, reasonCode, index + 1],
        );
      }
    }
    return decisionId;
  }

  private async persistPointInTimeEvidence(client:PoolClient,context:ThetaCyclePersistenceContext,
    cycle:ThetaShadowCycleResult,fusionSnapshotId:string,candidateSetId:string|null,
    candidateIds:ReadonlyMap<string,string>,decisionId:string|null):Promise<void> {
    if (candidateSetId===null || cycle.fusionSnapshot===null) return;
    const snapshot=cycle.fusionSnapshot.snapshot;
    const contracts=(Array.isArray(snapshot.contractCandidates) ? snapshot.contractCandidates : []).map((item) => jsonObject(item));
    const evaluated=cycle.orchestration?.thetaQ?.candidates ?? [];
    const receipt=cycle.orchestration?.receipt;
    const ranked=evaluated.toSorted((a,b) => (a.rank ?? Number.MAX_SAFE_INTEGER)-(b.rank ?? Number.MAX_SAFE_INTEGER));
    const feasible=ranked.filter((candidate) => candidate.actionFeasible);
    const best=feasible[0]===undefined?null:candidateIds.get(feasible[0].candidateId) ?? null;
    const second=feasible[1]===undefined?null:candidateIds.get(feasible[1].candidateId) ?? null;
    const rejected=ranked.find((candidate) => !candidate.actionFeasible);
    const bestRejected=rejected===undefined?null:candidateIds.get(rejected.candidateId) ?? null;
    const ranking=Array.isArray(cycle.underlyingRanking) ? cycle.underlyingRanking : [];
    const universe=ranking.map((item) => {
      if (item!==null && typeof item==='object' && 'symbol' in item) return String(item.symbol);
      if (item!==null && typeof item==='object' && 'underlying' in item) return String(item.underlying);
      return null;
    }).filter((value):value is string => value!==null);
    const branchResults=cycle.orchestration?.routing?.results ?? [];
    const branches=branchResults.map((item) => item.strategyFamily);
    const missingScope:string[]=[];
    if (universe.length>1) missingScope.push('OPTION_LATTICE_ONLY_BUILT_FOR_SELECTED_UNDERLYING');
    if (branchResults.some((item) => item.eligible && item.strategyFamily!=='THETA_Q')) missingScope.push('ELIGIBLE_NON_PRIMARY_BRANCH_NOT_EVALUATED');
    if (receipt===undefined || receipt===null) missingScope.push('DECISION_RECEIPT_UNAVAILABLE');
    const counts={ underlyings:universe.length,expirations:new Set(contracts.map((item) => item.expiration)).size,
      strikes:new Set(contracts.map((item) => item.strike)).size,branches:branches.length,
      mechanicallyInvalid:contracts.filter((item) => item.identityValid===false).length,
      hardVetoed:evaluated.filter((item) => !item.actionFeasible).length,
      softRanked:evaluated.filter((item) => item.rank!==null && item.rank>0).length,
      dataInsufficient:evaluated.filter((item) => item.economics?.ev_net===null).length,
      selected:receipt?.selectedCandidateId===null || receipt?.selectedCandidateId===undefined ? 0:1,
      notSelected:Math.max(0,evaluated.length-(receipt?.selectedCandidateId===null||receipt?.selectedCandidateId===undefined?0:1)) };
    const setPayload={candidateSetId,decisionTime:String(snapshot.decisionTimeUtc),universe:[...universe].sort(),
      branches:[...branches].sort(),counts,best,second,bestRejected,missingScope:[...missingScope].sort()};
    await client.query(`INSERT INTO trade.candidate_set_evidence(candidate_set_id,decision_time,universe_evaluated_json,
      branches_considered_json,counts_json,best_candidate_id,second_best_candidate_id,best_rejected_candidate_id,
      completeness_state,missing_scope_json,content_hash) VALUES($1,$2,$3::jsonb,$4::jsonb,$5::jsonb,$6,$7,$8,$9,$10::jsonb,$11)
      ON CONFLICT(candidate_set_id) DO NOTHING`,[candidateSetId,String(snapshot.decisionTimeUtc),JSON.stringify(setPayload.universe),
      JSON.stringify(setPayload.branches),JSON.stringify(counts),best,second,bestRejected,missingScope.length===0?'COMPLETE':'PARTIAL',
      JSON.stringify(setPayload.missingScope),createHash('sha256').update(JSON.stringify(setPayload)).digest('hex')]);

    const provenance=(Array.isArray(snapshot.sourceProvenance) ? snapshot.sourceProvenance : []).map((raw) => {
      const item=jsonObject(raw);
      return { source:String(item.provider ?? 'UNKNOWN'),operationAlias:String(item.operationAlias ?? 'UNKNOWN'),
        providerTimestamp:item.asOf ?? null,ingestionTimestamp:item.retrievedAt ?? snapshot.decisionTimeUtc,
        asOf:item.asOf ?? snapshot.decisionTimeUtc,version:String(item.contractVersion ?? 'UNKNOWN'),
        state:String(item.state ?? 'UNKNOWN'),feed:item.feed ?? null,contentHash:item.contentHash ?? null };
    });
    const versions=snapshot.versions !== null && typeof snapshot.versions==='object' && !Array.isArray(snapshot.versions)
      ? snapshot.versions as Record<string,JsonValue> : {};
    for (const candidate of evaluated) {
      const persistedId=candidateIds.get(candidate.candidateId); if (persistedId===undefined) continue;
      const contract=contracts.find((item) => item.optionSymbol===candidate.candidateId || item.occSymbol===candidate.candidateId);
      if (contract===undefined) continue;
      const selected=receipt?.selectedCandidateId===candidate.candidateId;
      const alternative=receipt?.alternatives.find((item) => item.candidateId===candidate.candidateId) ?? null;
      const market={stockPrice:contract.underlyingLast,bid:contract.bid,ask:contract.ask,bidSize:contract.bidSize,
        askSize:contract.askSize,quoteTimestamp:contract.quoteTimestamp,quoteAgeSeconds:contract.quoteAgeSeconds,feed:contract.feed};
      const evidencePayload={candidateId:persistedId,decisionId,fusionSnapshotId,decisionTime:String(snapshot.decisionTimeUtc),
        branch:'THETA_CONVENTIONAL',rank:candidate.rank,selected,contract:{underlying:contract.underlying,
          contractSymbol:contract.occSymbol,optionType:contract.optionType,strike:contract.strike,expiration:contract.expiration,
          multiplier:contract.multiplier},market,volatility:{iv:contract.iv,ivRank:null,ivPercentile:null,skew:null,
          termStructure:null,surface:null},technical:{trend:snapshot.regimeState,momentum:null,drawdown:null,realizedVolatility:null},
        event:{state:snapshot.eventState,earningsDistance:null,exDividendState:null},flow:{uoa:null},
        ownership:{state:snapshot.expertPriorState},account:snapshot.accountState,portfolio:snapshot.portfolioExposure,
        aegis:{state:cycle.orchestration?.aegis ?? null},execution:{...market,executable:contract.executable,
          proposedLimit:alternative?.executionRecommendedAction ?? null},knownEconomics:candidate.economics ?? {},
        unknownEconomics:candidate.economics?.ev_net===null?[candidate.economics.ev_net_unknown_reason]:[],
        hardBlockers:candidate.actionFeasible?[]:candidate.reasons.filter((reason) => reason.polarity<0).map((reason) => reason.code),
        softEvidence:candidate.reasons,provenance,lineage:{strategyVersion:String(versions.strategyVersion ?? context.strategyVersionId),
          riskVersion:String(versions.riskLimitVersion ?? context.riskLimitVersionId),featureVersion:String(versions.featureVersion ?? context.featureVersionId),
          costModelVersion:String(versions.costModelVersion ?? context.costModelVersionId),regimeVersion:String(versions.regimeVersion ?? 'UNKNOWN'),
          executionModelVersion:String(versions.executionVersion ?? context.executionVersionId)}};
      const hash=createHash('sha256').update(JSON.stringify(evidencePayload)).digest('hex');
      await client.query(`INSERT INTO trade.candidate_point_in_time_evidence(candidate_id,decision_id,fusion_snapshot_id,
        decision_time,branch,rank_at_decision,selected,hard_status,soft_status,rejection_reason,contract_json,market_json,
        volatility_json,technical_json,event_json,flow_json,ownership_json,account_json,portfolio_json,aegis_json,
        execution_json,known_economics_json,unknown_economics_json,hard_blockers_json,soft_evidence_json,
        provider_provenance_json,strategy_version,risk_version,feature_version,cost_model_version,regime_version,
        execution_model_version,content_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13::jsonb,
        $14::jsonb,$15::jsonb,$16::jsonb,$17::jsonb,$18::jsonb,$19::jsonb,$20::jsonb,$21::jsonb,$22::jsonb,$23::jsonb,
        $24::jsonb,$25::jsonb,$26::jsonb,$27,$28,$29,$30,$31,$32,$33) ON CONFLICT(candidate_id) DO NOTHING`,[
        persistedId,decisionId,fusionSnapshotId,String(snapshot.decisionTimeUtc),'THETA_CONVENTIONAL',candidate.rank,selected,
        candidate.actionFeasible?'FEASIBLE':candidate.economics?.ev_net===null?'DATA_INSUFFICIENT':'HARD_VETO',
        candidate.actionFeasible?'RANKED':alternative?.disposition==='PASS'?'REJECTED':'UNKNOWN',alternative?.rejectionReason ?? null,
        JSON.stringify(evidencePayload.contract),JSON.stringify(evidencePayload.market),JSON.stringify(evidencePayload.volatility),
        JSON.stringify(evidencePayload.technical),JSON.stringify(evidencePayload.event),JSON.stringify(evidencePayload.flow),
        JSON.stringify(evidencePayload.ownership),JSON.stringify(evidencePayload.account),JSON.stringify(evidencePayload.portfolio),
        JSON.stringify(evidencePayload.aegis),JSON.stringify(evidencePayload.execution),JSON.stringify(evidencePayload.knownEconomics),
        JSON.stringify(evidencePayload.unknownEconomics),JSON.stringify(evidencePayload.hardBlockers),JSON.stringify(evidencePayload.softEvidence),
        JSON.stringify(provenance),evidencePayload.lineage.strategyVersion,evidencePayload.lineage.riskVersion,
        evidencePayload.lineage.featureVersion,evidencePayload.lineage.costModelVersion,evidencePayload.lineage.regimeVersion,
        evidencePayload.lineage.executionModelVersion,hash]);
      if (contract.bid!==null || contract.ask!==null) {
        const quotePayload={candidateId:persistedId,observedAt:String(snapshot.decisionTimeUtc),providerTimestamp:contract.quoteTimestamp,
          source:contract.source,feed:contract.feed,bid:contract.bid,ask:contract.ask,bidSize:contract.bidSize,askSize:contract.askSize};
        const quoteHash=createHash('sha256').update(JSON.stringify(quotePayload)).digest('hex');
        await client.query(`INSERT INTO market.execution_quote_observation(quote_observation_id,candidate_id,observation_role,
          observed_at,provider_timestamp,ingestion_timestamp,source,operation_alias,feed,contract_version,bid,ask,bid_size,
          ask_size,proposed_limit,data_quality,content_hash) VALUES($1,$2,'DECISION',$3,$4,$3,$5,'option_snapshot',$6,'v1',$7,$8,$9,$10,NULL,$11,$12)
          ON CONFLICT(content_hash) DO NOTHING`,[deterministicRuntimeUuid(`quote:${quoteHash}`),persistedId,
          String(snapshot.decisionTimeUtc),contract.quoteTimestamp,contract.source,contract.feed,contract.bid,contract.ask,
          contract.bidSize,contract.askSize,contract.dataQuality,quoteHash]);
      }
    }
    if (decisionId!==null && receipt?.winningAction==='WAIT') {
      const eligibleBranches=branchResults.filter((item) => item.eligible).map((item) => item.strategyFamily);
      const global:GlobalWaitEvidence={reason:'DATA_INSUFFICIENT',eligibleUnderlyingCount:universe.length,
        underlyingsEvaluated:cycle.selectedUnderlying===null?0:1,contractsEvaluated:evaluated.length,
        validatedBranchesEligible:eligibleBranches,validatedBranchesEvaluated:['THETA_Q'],
        existingPositionManagementEvaluated:false,recoveryOpportunitiesEvaluated:false,coveredCallOpportunitiesEvaluated:false,
        redeploymentAlternativesEvaluated:false,hardGateCounts:{},softEvidenceFamiliesObserved:[],blockedBranches:{},
        bestCandidateId:best,secondBestCandidateId:second,bestRejectedCandidateId:bestRejected};
      const validation=validateGlobalWaitEvidence(global);
      const waitPayload={...global,validation};
      await client.query(`INSERT INTO trade.global_wait_evidence(decision_id,candidate_set_id,decision_time,wait_reason,
        underlyings_evaluated,contracts_evaluated,branches_considered_json,best_rejected_candidate_id,best_feasible_action,
        blockers_json,data_missing_json,search_proof_json,earned,validation_violations_json,content_hash)
        VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10::jsonb,$11::jsonb,$12::jsonb,$13,$14::jsonb,$15)
        ON CONFLICT(decision_id) DO NOTHING`,[decisionId,candidateSetId,String(snapshot.decisionTimeUtc),global.reason,
        global.underlyingsEvaluated,global.contractsEvaluated,JSON.stringify(branches),bestRejected,null,
        JSON.stringify(receipt.reasonCodes),JSON.stringify(snapshot.unknownFeatures),JSON.stringify(global),validation.earned,
        JSON.stringify(validation.violations),createHash('sha256').update(JSON.stringify(waitPayload)).digest('hex')]);
    }
  }
}
