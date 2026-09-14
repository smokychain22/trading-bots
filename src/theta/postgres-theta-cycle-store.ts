import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { verifyFusionSnapshot, type JsonValue } from '../market/fusion-snapshot.js';
import type { ThetaShadowCycleResult } from './theta-shadow-cycle.js';
import type { ThetaQResponse } from './theta-q-contract.js';
import type { CanonicalStrategyFrontier } from './canonical-strategy-frontier.js';
import { buildStrategyDecisionEnvelope } from './strategy-decision-envelope.js';
import { validateGlobalWaitEvidence, type GlobalWaitEvidence } from './decision-evidence.js';
import {
  deriveOptionomicsTemporalFeatures,
  type OptionomicsFeatureSnapshotReference,
} from './optionomics-temporal-features.js';

const optionomicsTemporalResearchPolicy = {
  policyVersion: 'theta-optionomics-temporal-research-policy-v1',
  maximumGapSeconds: 3_600,
} as const;

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
  readonly strategyFrontierId: string | null;
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

type PersistableCandidate = ThetaQResponse['candidates'][number];
export interface RelationalCanonicalBranchEvidence {
  readonly branch: CanonicalStrategyFrontier['branches'][number];
  readonly selectedCandidateRef: string | null;
  readonly candidates: readonly {
    readonly candidate: CanonicalStrategyFrontier['branches'][number]['candidates'][number];
    readonly selected: boolean;
  }[];
}

export function projectCanonicalStrategyEvidence(
  frontier: CanonicalStrategyFrontier,
): readonly RelationalCanonicalBranchEvidence[] {
  const seen = new Set<string>();
  return frontier.branches.map((branch) => {
    if (branch.candidateCount !== branch.candidates.length) {
      throw new Error(`CANONICAL_BRANCH_CANDIDATE_COUNT_MISMATCH:${branch.branch}`);
    }
    const candidates = branch.candidates.map((candidate) => {
      if (candidate.branch !== branch.branch) throw new Error(`CANONICAL_CANDIDATE_BRANCH_MISMATCH:${candidate.candidateId}`);
      if (seen.has(candidate.candidateId)) throw new Error(`CANONICAL_CANDIDATE_REF_DUPLICATE:${candidate.candidateId}`);
      seen.add(candidate.candidateId);
      return { candidate, selected: frontier.selectedCandidateId === candidate.candidateId };
    });
    return {
      branch,
      selectedCandidateRef: candidates.some((entry) => entry.selected) ? frontier.selectedCandidateId : null,
      candidates,
    };
  });
}

function persistenceCandidates(cycle:ThetaShadowCycleResult):readonly PersistableCandidate[]{
  const evaluated=[...(cycle.orchestration?.thetaQ?.candidates??[])];
  const known=new Set(evaluated.map((candidate)=>candidate.candidateId));
  const ownershipScore=cycle.orchestration?.ownership?.ownability??null;
  const canonical=cycle.strategyFrontier?.branches.find((branch)=>branch.branch==='THETA_CONVENTIONAL')?.candidates??[];
  for(const [index,candidate] of canonical.entries()){
    const optionSymbol=candidate.legs.length===1?candidate.legs[0]?.optionSymbol:undefined;
    if(optionSymbol===undefined||known.has(optionSymbol))continue;
    const reasons=[
      ...candidate.hardBlockers.map((code)=>({code,polarity:-1 as const,detail:'Canonical structural hard blocker.'})),
      ...(ownershipScore===null?[{code:'OWNERSHIP_ACCEPTABILITY_UNKNOWN',polarity:0 as const,
        detail:'Ownership acceptability is UNKNOWN.'}]:[]),
      ...candidate.unknownEvidence.map((code)=>({code,polarity:0 as const,detail:'Canonical point-in-time evidence is UNKNOWN.'})),
      ...candidate.softEvidence.map((code)=>({code,polarity:0 as const,detail:'Canonical soft evidence recorded without directional assumption.'})),
    ];
    const complete=ownershipScore!==null&&candidate.hardBlockers.length===0&&candidate.unknownEvidence.length===0;
    const collateral=candidate.economics.collateral;
    const maxProfit=candidate.economics.maxProfit;
    evaluated.push({candidateId:optionSymbol,rank:candidate.paretoRank??index+1,
      actionFeasible:complete&&candidate.structurallyFeasible&&candidate.riskFeasible,
      quantity:complete?candidate.sizing.quantity:0,ownershipScore,reasons,
      economics:collateral===null||maxProfit===null?null:{max_profit:maxProfit,
        break_even_price:candidate.economics.breakEven??candidate.legs[0]?.strike??0,
        secured_collateral_per_contract:collateral,
        credit_collateral_ratio:collateral>0?maxProfit/collateral:0,ev_net:null,
        ev_net_unknown_reason:'EV_MODEL_NOT_EMPIRICALLY_READY'}});
    known.add(optionSymbol);
  }
  return evaluated;
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

      await this.persistOptionomicsEvidence(client, fusionSnapshotId, fusion.snapshot);
      const strategyFrontierId = await this.persistCanonicalStrategyFrontier(client, fusionSnapshotId, cycle);
      if (strategyFrontierId !== null) {
        await this.persistRelationalCanonicalStrategyEvidence(client, strategyFrontierId, fusionSnapshotId, cycle);
      }

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
      return { fusionSnapshotId, candidateSetId: candidates.candidateSetId, candidateCount: candidates.candidateIds.size,
        decisionId, strategyRouteId, strategyFrontierId, shadowOpportunityCount };
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

    const evaluated = persistenceCandidates(cycle);
    const setPayload = JSON.stringify(evaluated);
    const setHash = createHash('sha256').update(setPayload).digest('hex');
    const candidateSetId = deterministicRuntimeUuid(`candidate-set:${fusionSnapshotId}:THETA_CONVENTIONAL:${setHash}`);
    await client.query(
      `INSERT INTO trade.candidate_set(candidate_set_id,fusion_snapshot_id,branch,candidate_count,generated_at,generator_version,set_hash)
       VALUES($1,$2,'THETA_CONVENTIONAL',$3,$4,$5,$6)
       ON CONFLICT(fusion_snapshot_id,branch,set_hash) DO NOTHING`,
      [candidateSetId, fusionSnapshotId, evaluated.length, receipt.timestamp,
        cycle.orchestration?.thetaQ?.contractVersion ?? cycle.strategyFrontier?.contractVersion ?? 'theta-runtime-no-candidate-v1', setHash],
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
      for (const canonical of cycle.strategyFrontier?.branches
        .filter((branch) => branch.branch === 'THETA_CONVENTIONAL')
        .flatMap((branch) => branch.candidates)
        .filter((candidate) => candidate.legs.length === 1 && candidate.legs[0]?.optionSymbol === evaluatedCandidate.candidateId) ?? []) {
        candidateIds.set(canonical.candidateId, candidateId);
      }
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
       VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(fusion_snapshot_id) DO NOTHING`,
      [routeId, fusionSnapshotId, routing.timestamp, JSON.stringify(eligibility), cycle.strategyFrontier?.selectedBranch ?? null, routing.policyVersion],
    );
    return routeId;
  }

  private async persistDecision(client: PoolClient, fusionSnapshotId: string, cycle: ThetaShadowCycleResult,
    candidateSetId: string | null, candidateIds: ReadonlyMap<string, string>, strategyVersionId: string): Promise<string | null> {
    const receipt = cycle.orchestration?.receipt;
    if (receipt === null || receipt === undefined) return null;
    const authority = cycle.strategyFrontier;
    const selectedCandidateRef = authority?.selectedCandidateId ?? receipt.selectedCandidateId;
    const selectedCandidateId = selectedCandidateRef === null ? null : candidateIds.get(selectedCandidateRef) ?? null;
    const selectedBranchStatus = authority?.branches.find((branch) => branch.branch === authority.selectedBranch)?.status ?? null;
    if (selectedCandidateRef !== null && selectedCandidateId === null && (authority === null || selectedBranchStatus === 'SHADOW')) {
      throw new Error(`SELECTED_CANDIDATE_NOT_PERSISTED:${selectedCandidateRef}`);
    }
    const decisionAuthorityVersion = authority?.decisionAuthorityVersion ?? 'legacy-theta-q-decision-authority-v1';
    const actionCode = authority?.primaryAction ?? receipt.winningAction;
    const quantity = authority?.selectedQuantity ?? receipt.quantity;
    const strategyBranch = authority?.selectedBranch ?? (authority === null ? 'THETA_CONVENTIONAL' : null);
    const explanation = authority === null ? receipt.plainEnglishExplanation
      : authority.primaryAction === 'GLOBAL_WAIT'
        ? 'All applicable canonical branches were evaluated and no risk-feasible, positive-quantity structural action remained.'
        : authority.primaryAction === 'MANAGEMENT_AUTHORITY'
          ? 'Existing inventory was delegated to the management-first authority before any new-risk decision.'
          : authority.selectedCandidateId === null
            ? 'The canonical strategy authority held because no complete structural selection was available.'
            : `${authority.selectedCandidateId} was selected by the versioned cross-branch structural/Pareto authority. Empirical utility remains unknown.`;
    const reasonCodes = authority === null ? receipt.reasonCodes
      : authority.globalWaitEarned ? authority.globalWaitReasons
        : authority.primaryAction === 'MANAGEMENT_AUTHORITY' ? ['MANAGEMENT_FIRST']
          : authority.selectedCandidateId === null ? ['CANONICAL_STRUCTURAL_SELECTION_UNAVAILABLE'] : ['CANONICAL_STRUCTURAL_SELECTION'];
    const decisionId = deterministicRuntimeUuid(`decision:${fusionSnapshotId}:${receipt.underlying}:${decisionAuthorityVersion}`);
    const receiptPayload = authority === null
      ? buildStrategyDecisionEnvelope({ strategyVersionId, strategyBranch: 'THETA_CONVENTIONAL', receipt })
      : { contractVersion: decisionAuthorityVersion, authority, legacyThetaQReceipt: receipt,
          empiricalUtilityState: authority.empiricalUtilityState, executionAuthorized: false };
    const inserted = await client.query(
      `INSERT INTO trade.decision(decision_id,fusion_snapshot_id,candidate_set_id,selected_candidate_id,decision_kind,action_code,quantity,
         aegis_action,strategy_branch,decided_at,status,explanation_text,explanation_hash,runtime_selected_candidate_ref,
         policy_version,model_versions_json,fail_closed_reason,receipt_json,decision_authority_version)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'RECORDED',$11,$12,$13,$14,$15,$16,$17,$18)
       ON CONFLICT(decision_id) DO NOTHING RETURNING decision_id`,
      [decisionId, fusionSnapshotId, candidateSetId, selectedCandidateId,
        authority?.primaryAction === 'MANAGEMENT_AUTHORITY' ? 'MANAGEMENT_DELEGATION' : 'NEW_RISK',
        actionCode, quantity, cycle.orchestration?.aegis?.newRiskState ?? null, strategyBranch,
        authority?.timestamp ?? receipt.timestamp, explanation,
        createHash('sha256').update(explanation).digest('hex'), selectedCandidateRef,
        authority?.strategyVersion ?? receipt.policyVersion, JSON.stringify(receipt.modelVersions), receipt.failClosedReason,
        JSON.stringify(receiptPayload), decisionAuthorityVersion],
    );
    if ((inserted.rowCount ?? 0) > 0) {
      for (const [index, reasonCode] of reasonCodes.entries()) {
        await client.query(
          `INSERT INTO trade.decision_reason(decision_id,reason_family,reason_code,polarity,importance_rank,evidence_state)
           VALUES($1,'RUNTIME',$2,0,$3,'RECORDED')`, [decisionId, reasonCode, index + 1],
        );
      }
    }
    return decisionId;
  }

  private async persistCanonicalStrategyFrontier(client: PoolClient, fusionSnapshotId: string,
    cycle: ThetaShadowCycleResult): Promise<string | null> {
    const frontier = cycle.strategyFrontier;
    // Older replay fixtures and persisted cycle envelopes predate the canonical
    // frontier. Treat an absent frontier as legacy input instead of breaking
    // atomic replay while all newly produced cycles still carry the field.
    if (frontier == null) return null;
    const frontierId = deterministicRuntimeUuid(`canonical-frontier:${fusionSnapshotId}:${frontier.contentHash}`);
    await client.query(
      `INSERT INTO trade.canonical_strategy_frontier(frontier_id,fusion_snapshot_id,observed_at,contract_version,
        strategy_version,branches_considered_json,branches_evaluated_json,selected_branch,selected_candidate_ref,
        best_rejected_candidate_ref,global_wait_earned,empirical_economics_ready,execution_authorized,frontier_json,content_hash,
        decision_authority_version,primary_action,selected_quantity,empirical_utility_state)
       VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16,$17,$18,$19)
       ON CONFLICT(fusion_snapshot_id) DO NOTHING`,
      [frontierId, fusionSnapshotId, frontier.timestamp, frontier.contractVersion, frontier.strategyVersion,
        JSON.stringify(frontier.branchesConsidered), JSON.stringify(frontier.branchesEvaluated), frontier.selectedBranch,
        frontier.selectedCandidateId, frontier.bestRejectedCandidateId, frontier.globalWaitEarned,
        frontier.empiricalEconomicsReady, frontier.executionAuthorized, JSON.stringify(frontier), frontier.contentHash,
        frontier.decisionAuthorityVersion, frontier.primaryAction, frontier.selectedQuantity, frontier.empiricalUtilityState],
    );
    return frontierId;
  }

  private async persistRelationalCanonicalStrategyEvidence(
    client: PoolClient,
    frontierId: string,
    fusionSnapshotId: string,
    cycle: ThetaShadowCycleResult,
  ): Promise<void> {
    const frontier = cycle.strategyFrontier;
    if (frontier === null) return;
    for (const projection of projectCanonicalStrategyEvidence(frontier)) {
      const { branch } = projection;
      const branchPayload = {
        frontierId,
        fusionSnapshotId,
        branch: branch.branch,
        strategyVersion: branch.strategyVersion,
        status: branch.status,
        applicable: branch.applicable,
        evaluated: branch.evaluated,
        evaluationState: branch.evaluationState,
        candidateCount: branch.candidateCount,
        mechanicallyRejected: branch.mechanicallyRejected,
        hardVetoed: branch.hardVetoed,
        softRanked: branch.softRanked,
        dataInsufficient: branch.dataInsufficient,
        enumerationTruncated: branch.enumerationTruncated,
        bestCandidateRef: branch.bestCandidateId,
        secondBestCandidateRef: branch.secondBestCandidateId,
        bestRejectedCandidateRef: branch.bestRejectedCandidateId,
        routeReasons: branch.routeReasons,
        empiricalEconomicsReady: branch.empiricalEconomicsReady,
        executionAuthorized: branch.executionAuthorized,
      };
      const branchHash = createHash('sha256').update(JSON.stringify(branchPayload)).digest('hex');
      const branchEvidenceId = deterministicRuntimeUuid(`canonical-branch-evidence:${branchHash}`);
      await client.query(
        `INSERT INTO trade.canonical_strategy_branch_evidence(
          branch_evidence_id,frontier_id,fusion_snapshot_id,branch,strategy_version,status,applicable,evaluated,
          evaluation_state,candidate_count,mechanically_rejected,hard_vetoed,soft_ranked,data_insufficient,
          enumeration_truncated,best_candidate_ref,second_best_candidate_ref,best_rejected_candidate_ref,
          route_reasons_json,empirical_economics_ready,execution_authorized,content_hash)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb,$20,$21,$22)
         ON CONFLICT(frontier_id,branch) DO NOTHING`,
        [branchEvidenceId, frontierId, fusionSnapshotId, branch.branch, branch.strategyVersion, branch.status,
          branch.applicable, branch.evaluated, branch.evaluationState, branch.candidateCount,
          branch.mechanicallyRejected, branch.hardVetoed, branch.softRanked, branch.dataInsufficient,
          branch.enumerationTruncated, branch.bestCandidateId, branch.secondBestCandidateId,
          branch.bestRejectedCandidateId, JSON.stringify(branch.routeReasons), branch.empiricalEconomicsReady,
          branch.executionAuthorized, branchHash],
      );
      for (const { candidate, selected } of projection.candidates) {
        const candidatePayload = { frontierId, branchEvidenceId, candidate, selected };
        const candidateHash = createHash('sha256').update(JSON.stringify(candidatePayload)).digest('hex');
        const candidateEvidenceId = deterministicRuntimeUuid(`canonical-candidate-evidence:${candidateHash}`);
        await client.query(
          `INSERT INTO trade.canonical_strategy_candidate_evidence(
            candidate_evidence_id,branch_evidence_id,frontier_id,candidate_ref,branch,action,underlying,
            rank_at_decision,selected,legs_json,dte,delta,moneyness,spread_pct,liquidity_json,economics_json,
            assignment_capacity_qty,hard_blockers_json,soft_evidence_json,unknown_evidence_json,
            structurally_feasible,risk_feasible,quantity,binding_constraint,sizing_reasons_json,
            execution_authorized,content_hash)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14,$15::jsonb,$16::jsonb,$17,
            $18::jsonb,$19::jsonb,$20::jsonb,$21,$22,$23,$24,$25::jsonb,$26,$27)
           ON CONFLICT(frontier_id,candidate_ref) DO NOTHING`,
          [candidateEvidenceId, branchEvidenceId, frontierId, candidate.candidateId, candidate.branch,
            candidate.action, candidate.underlying, candidate.paretoRank, selected, JSON.stringify(candidate.legs),
            candidate.dte, candidate.delta, candidate.moneyness, candidate.spreadPct,
            JSON.stringify(candidate.liquidity), JSON.stringify(candidate.economics), candidate.assignmentCapacityQty,
            JSON.stringify(candidate.hardBlockers), JSON.stringify(candidate.softEvidence),
            JSON.stringify(candidate.unknownEvidence), candidate.structurallyFeasible, candidate.riskFeasible,
            candidate.sizing.quantity, candidate.sizing.bindingConstraint, JSON.stringify(candidate.sizing.reasons),
            candidate.executionAuthorized, candidateHash],
        );
      }
    }
  }

  private async persistOptionomicsEvidence(
    client: PoolClient,
    fusionSnapshotId: string,
    snapshot: Readonly<Record<string, JsonValue>>,
  ): Promise<void> {
    const state = jsonObject(snapshot.optionomicsFeatureState);
    const features = jsonObject(state.features);
    const rawObservations = Array.isArray(state.rawObservations)
      ? state.rawObservations.map((value) => jsonObject(value))
      : [jsonObject(state.rawObservation)].filter((value) => Object.keys(value).length > 0);
    if (rawObservations.length === 0 || Object.keys(features).length === 0) return;
    const underlying = typeof features.underlying === 'string' ? features.underlying : null;
    const schemaVersion = typeof features.schemaVersion === 'string' ? features.schemaVersion : null;
    if (underlying === null || schemaVersion === null) {
      throw new Error('OPTIONOMICS_LAYERED_EVIDENCE_METADATA_INVALID');
    }
    const provenanceRows = (Array.isArray(snapshot.sourceProvenance) ? snapshot.sourceProvenance : []).map((item) => jsonObject(item));
    const observationIds: { id: string; operationAlias: string; retrievedAt: string; quality: string }[] = [];
    for (const raw of rawObservations) {
      const responseHash = typeof raw.responseHash === 'string' ? raw.responseHash : null;
      const retrievedAt = typeof raw.retrievedAt === 'string' ? raw.retrievedAt : null;
      const operationAlias = typeof raw.operationAlias === 'string' ? raw.operationAlias : 'optionomics.get_option_chain';
      if (responseHash === null || retrievedAt === null) throw new Error('OPTIONOMICS_LAYERED_EVIDENCE_METADATA_INVALID');
      const provenance = provenanceRows.find((item) => item.provider === 'OPTIONOMICS' && item.operationAlias === operationAlias);
      const quality = typeof provenance?.state === 'string' ? provenance.state : 'UNKNOWN';
      const asOf = typeof provenance?.asOf === 'string' ? provenance.asOf : String(snapshot.decisionTimeUtc);
      const observationId = deterministicRuntimeUuid(`optionomics-raw:${fusionSnapshotId}:${operationAlias}:${responseHash}`);
      await client.query(
        `INSERT INTO market.optionomics_raw_observation(observation_id,fusion_snapshot_id,operation_alias,underlying,
          provider_timestamp,ingestion_timestamp,as_of,contract_version,data_quality,response_hash,payload_json,
          requested_at,request_path,request_parameters_json,http_status,rate_limit_json,documentation_reference,
          credential_identity_ref_hash,session_date)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14::jsonb,$15,$16::jsonb,$17,$18,$19)
         ON CONFLICT(fusion_snapshot_id,operation_alias,response_hash) DO NOTHING`,
        [observationId, fusionSnapshotId, operationAlias, underlying,
          typeof raw.providerTimestamp === 'string' ? raw.providerTimestamp : null, retrievedAt, asOf,
          typeof raw.contractVersion === 'string' ? raw.contractVersion : 'optionomics-public-api-unknown',
          quality, responseHash, JSON.stringify(raw.payload ?? null),
          typeof raw.requestedAt === 'string' ? raw.requestedAt : null,
          typeof raw.requestPath === 'string' ? raw.requestPath : null, JSON.stringify(jsonObject(raw.requestParameters)),
          typeof raw.httpStatus === 'number' ? raw.httpStatus : null, JSON.stringify(jsonObject(raw.rateLimit)),
          typeof raw.documentationReference === 'string' ? raw.documentationReference : null,
          typeof raw.credentialIdentityRefHash === 'string' ? raw.credentialIdentityRefHash : null,
          typeof raw.sessionDate === 'string' ? raw.sessionDate : null],
      );
      observationIds.push({ id: observationId, operationAlias, retrievedAt, quality });
    }
    const primary = observationIds.find((row) => row.operationAlias === 'optionomics.get_option_chain') ?? observationIds[0];
    if (primary === undefined) return;
    const featureHash = createHash('sha256').update(JSON.stringify(features)).digest('hex');
    const featureSnapshotId = deterministicRuntimeUuid(`optionomics-features:${primary.id}:${featureHash}`);
    await client.query(
      `INSERT INTO market.optionomics_feature_snapshot(feature_snapshot_id,observation_id,fusion_snapshot_id,underlying,
        observed_at,schema_version,data_quality,feature_state_json,content_hash)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)
       ON CONFLICT(observation_id,schema_version) DO NOTHING`,
      [featureSnapshotId, primary.id, fusionSnapshotId, underlying, primary.retrievedAt, schemaVersion, primary.quality, JSON.stringify(features), featureHash],
    );
    for (const observation of observationIds) {
      await client.query(
        `INSERT INTO market.optionomics_feature_observation_link(feature_snapshot_id,observation_id,observation_role)
         VALUES($1,$2,$3) ON CONFLICT(feature_snapshot_id,observation_id) DO NOTHING`,
        [featureSnapshotId, observation.id, observation.operationAlias === 'optionomics.get_option_chain' ? 'PRIMARY_CHAIN' : 'CONTEXT'],
      );
    }
    await this.persistOptionomicsTemporalEvidence(client, {
      featureSnapshotId, underlying, observedAt: primary.retrievedAt, schemaVersion, featureState: features,
    });
  }

  private async persistOptionomicsTemporalEvidence(
    client: PoolClient,
    current: OptionomicsFeatureSnapshotReference,
  ): Promise<void> {
    const priorResult = await client.query<{
      feature_snapshot_id: string;
      underlying: string;
      observed_at: Date | string;
      schema_version: string;
      feature_state_json: Record<string, unknown>;
    }>(
      `SELECT feature_snapshot_id,underlying,observed_at,schema_version,feature_state_json
       FROM market.optionomics_feature_snapshot
       WHERE underlying=$1 AND feature_snapshot_id<>$2 AND observed_at<$3
       ORDER BY observed_at DESC,feature_snapshot_id DESC LIMIT 1`,
      [current.underlying, current.featureSnapshotId, current.observedAt],
    );
    const row = priorResult.rows[0];
    if (row === undefined) return;
    const earlier: OptionomicsFeatureSnapshotReference = {
      featureSnapshotId: row.feature_snapshot_id,
      underlying: row.underlying,
      observedAt: row.observed_at instanceof Date ? row.observed_at.toISOString() : String(row.observed_at),
      schemaVersion: row.schema_version,
      featureState: row.feature_state_json,
    };
    for (const feature of deriveOptionomicsTemporalFeatures({
      earlier, current, maximumGapSeconds: optionomicsTemporalResearchPolicy.maximumGapSeconds,
    })) {
      const persistedMethodVersion = `${feature.methodVersion}:${optionomicsTemporalResearchPolicy.policyVersion}`;
      const contentHash = createHash('sha256').update(JSON.stringify({ feature, policy: optionomicsTemporalResearchPolicy })).digest('hex');
      const temporalFeatureId = deterministicRuntimeUuid(`optionomics-temporal:${contentHash}`);
      await client.query(
        `INSERT INTO research.optionomics_temporal_feature_observation(
          temporal_feature_id,underlying,feature_family,metric_key,earlier_feature_snapshot_id,
          current_feature_snapshot_id,earlier_observed_at,current_observed_at,elapsed_seconds,value_state,
          units,earlier_value,current_value,absolute_change,rate_per_hour,reason_code,method_version,
          execution_eligible,content_hash)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,false,$18)
         ON CONFLICT(current_feature_snapshot_id,feature_family,metric_key,method_version) DO NOTHING`,
        [temporalFeatureId, current.underlying, feature.family, feature.metricKey,
          feature.earlierFeatureSnapshotId, feature.currentFeatureSnapshotId, feature.earlierObservedAt,
          feature.currentObservedAt, feature.elapsedSeconds, feature.state, feature.units,
          feature.earlierValue, feature.currentValue, feature.absoluteChange, feature.ratePerHour,
          feature.reasonCode, persistedMethodVersion,
          contentHash],
      );
    }
  }

  private async persistPointInTimeEvidence(client:PoolClient,context:ThetaCyclePersistenceContext,
    cycle:ThetaShadowCycleResult,fusionSnapshotId:string,candidateSetId:string|null,
    candidateIds:ReadonlyMap<string,string>,decisionId:string|null):Promise<void> {
    if (candidateSetId===null || cycle.fusionSnapshot===null) return;
    const snapshot=cycle.fusionSnapshot.snapshot;
    const contracts=(Array.isArray(snapshot.contractCandidates) ? snapshot.contractCandidates : []).map((item) => jsonObject(item));
    const evaluated=persistenceCandidates(cycle);
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
    const branches=cycle.strategyFrontier?.branchesConsidered ?? branchResults.map((item) => item.strategyFamily);
    const missingScope:string[]=[];
    if (universe.length>1) missingScope.push('OPTION_LATTICE_ONLY_BUILT_FOR_SELECTED_UNDERLYING');
    for (const branch of cycle.strategyFrontier?.branches.filter((item) => item.applicable && item.evaluationState === 'BLOCKED_MISSING_INPUT') ?? []) {
      missingScope.push(`BRANCH_NOT_FULLY_EVALUATED:${branch.branch}`);
    }
    if (receipt===undefined || receipt===null) missingScope.push('DECISION_RECEIPT_UNAVAILABLE');
    const frontierCandidates=cycle.strategyFrontier?.branches.flatMap((branch) => branch.candidates) ?? [];
    const counts={ underlyings:universe.length,expirations:new Set(contracts.map((item) => item.expiration)).size,
      strikes:new Set(contracts.map((item) => item.strike)).size,branches:branches.length,
      mechanicallyInvalid:contracts.filter((item) => item.identityValid===false).length,
      hardVetoed:frontierCandidates.length>0?frontierCandidates.filter((item) => !item.riskFeasible).length:evaluated.filter((item) => !item.actionFeasible).length,
      softRanked:frontierCandidates.length>0?frontierCandidates.filter((item) => item.paretoRank!==null).length:evaluated.filter((item) => item.rank!==null && item.rank>0).length,
      dataInsufficient:frontierCandidates.length>0?frontierCandidates.filter((item) => item.unknownEvidence.length>0).length:evaluated.filter((item) => item.economics?.ev_net===null).length,
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
    const optionomicsState=jsonObject(snapshot.optionomicsFeatureState);
    const optionomicsFeatures=jsonObject(optionomicsState.features);
    const optionomicsProviderContext=jsonObject(optionomicsFeatures.providerContext);
    const optionomicsContracts=Array.isArray(optionomicsFeatures.contracts)
      ? optionomicsFeatures.contracts.map((raw) => jsonObject(raw)) : [];
    const flowWindows=(Array.isArray(optionomicsState.netFlowWindows) ? optionomicsState.netFlowWindows : []).map((raw) => {
      const window=jsonObject(raw);
      const netCalls=Array.isArray(window.netCalls) ? window.netCalls : [];
      const netPuts=Array.isArray(window.netPuts) ? window.netPuts : [];
      return {windowHours:window.windowHours ?? null,requestedFromUnixSeconds:window.requestedFromUnixSeconds ?? null,
        requestedToUnixSeconds:window.requestedToUnixSeconds ?? null,resolution:window.resolution ?? null,
        netCallPointCount:netCalls.length,netPutPointCount:netPuts.length,lastNetCallPoint:netCalls.at(-1) ?? null,
        lastNetPutPoint:netPuts.at(-1) ?? null,retrievedAt:window.retrievedAt ?? null,
        evidenceClass:window.evidenceClass ?? null,executableTruth:false};
    });
    for (const candidate of evaluated) {
      const persistedId=candidateIds.get(candidate.candidateId); if (persistedId===undefined) continue;
      const contract=contracts.find((item) => item.optionSymbol===candidate.candidateId || item.occSymbol===candidate.candidateId);
      if (contract===undefined) continue;
      const optionomicsContract=optionomicsContracts.find((item) => item.contractSymbol===contract.occSymbol) ?? {};
      const selected=receipt?.selectedCandidateId===candidate.candidateId;
      const alternative=receipt?.alternatives.find((item) => item.candidateId===candidate.candidateId) ?? null;
      const market={stockPrice:contract.underlyingLast,bid:contract.bid,ask:contract.ask,bidSize:contract.bidSize,
        askSize:contract.askSize,quoteTimestamp:contract.quoteTimestamp,quoteAgeSeconds:contract.quoteAgeSeconds,feed:contract.feed};
      const evidencePayload={candidateId:persistedId,decisionId,fusionSnapshotId,decisionTime:String(snapshot.decisionTimeUtc),
        branch:'THETA_CONVENTIONAL',rank:candidate.rank,selected,contract:{underlying:contract.underlying,
          contractSymbol:contract.occSymbol,optionType:contract.optionType,strike:contract.strike,expiration:contract.expiration,
          dte:contract.dte,moneyness:contract.moneyness,multiplier:contract.multiplier},market:{...market,dataQuality:contract.dataQuality},volatility:{iv:contract.iv,
          providerMetrics:optionomicsProviderContext.metrics ?? null,
          skew:optionomicsFeatures.skew ?? null,termStructure:optionomicsFeatures.termStructure ?? null,
          surface:optionomicsFeatures.volatilitySurface ?? null,contractVolatility:optionomicsContract.volatility ?? null,
          marketStructure:optionomicsContract.marketStructure ?? null,
          providerExposureHeatmap:optionomicsProviderContext.exposureHeatmap ?? null},technical:{trend:snapshot.regimeState,momentum:null,drawdown:null,realizedVolatility:null},
        event:{state:snapshot.eventState,earningsDistance:null,exDividendState:null},
        flow:{optionomicsNetFlowWindows:flowWindows,interpretation:'UNMODELED_RESEARCH_CONTEXT',
          providerFlowAggregates:optionomicsProviderContext.flowAggregates ?? null,
          featureSchemaVersion:optionomicsFeatures.schemaVersion ?? null,unavailableFamilies:optionomicsFeatures.unavailableFamilies ?? []},
        ownership:{state:snapshot.expertPriorState},account:snapshot.accountState,portfolio:snapshot.portfolioExposure,
        aegis:{state:cycle.orchestration?.aegis ?? null},execution:{...market,executable:contract.executable,
          // Execution quality currently decides SUBMIT/SKIP but does not price
          // an order. Keep the limit UNKNOWN until a fresh executable OPRA BBO
          // is passed through the versioned limit-price policy immediately
          // before submission. An action string must never masquerade as price.
          proposedLimit:null,recommendedAction:alternative?.executionRecommendedAction ?? null},knownEconomics:candidate.economics ?? {},
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
    if (decisionId!==null && cycle.strategyFrontier?.globalWaitEarned === true) {
      const eligibleBranches=cycle.strategyFrontier.branchesConsidered;
      const evaluatedBranches=cycle.strategyFrontier.branchesEvaluated;
      const recoveryApplicable=cycle.strategyFrontier.branches.find((branch) => branch.branch==='THETA_RECOVERY')?.applicable ?? false;
      const ccApplicable=cycle.strategyFrontier.branches.find((branch) => branch.branch==='THETA_CC')?.applicable ?? false;
      const global:GlobalWaitEvidence={reason:'DATA_INSUFFICIENT',eligibleUnderlyingCount:universe.length,
        underlyingsEvaluated:cycle.selectedUnderlying===null?0:1,contractsEvaluated:frontierCandidates.length,
        validatedBranchesEligible:eligibleBranches,validatedBranchesEvaluated:evaluatedBranches,
        existingPositionManagementEvaluated:true,recoveryOpportunitiesEvaluated:!recoveryApplicable || evaluatedBranches.includes('THETA_RECOVERY'),
        coveredCallOpportunitiesEvaluated:!ccApplicable || evaluatedBranches.includes('THETA_CC'),
        redeploymentAlternativesEvaluated:true,hardGateCounts:{},softEvidenceFamiliesObserved:[],blockedBranches:{},
        bestCandidateId:best,secondBestCandidateId:second,bestRejectedCandidateId:bestRejected};
      const validation=validateGlobalWaitEvidence(global);
      const waitPayload={...global,validation};
      await client.query(`INSERT INTO trade.global_wait_evidence(decision_id,candidate_set_id,decision_time,wait_reason,
        underlyings_evaluated,contracts_evaluated,branches_considered_json,best_rejected_candidate_id,best_feasible_action,
        blockers_json,data_missing_json,search_proof_json,earned,validation_violations_json,content_hash)
        VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10::jsonb,$11::jsonb,$12::jsonb,$13,$14::jsonb,$15)
        ON CONFLICT(decision_id) DO NOTHING`,[decisionId,candidateSetId,String(snapshot.decisionTimeUtc),global.reason,
        global.underlyingsEvaluated,global.contractsEvaluated,JSON.stringify(branches),bestRejected,null,
        JSON.stringify(cycle.strategyFrontier.globalWaitReasons),JSON.stringify(snapshot.unknownFeatures),JSON.stringify(global),validation.earned,
        JSON.stringify(validation.violations),createHash('sha256').update(JSON.stringify(waitPayload)).digest('hex')]);
    }
  }
}
