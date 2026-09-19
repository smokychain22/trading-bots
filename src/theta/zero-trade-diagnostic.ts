import type { Pool } from 'pg';

export const zeroTradeDiagnosticVersion = 'theta-zero-trade-diagnostic-v1' as const;

type JsonRecord = Readonly<Record<string, unknown>>;

interface DiagnosticRow {
  readonly scan_id: string;
  readonly observed_at: string | Date;
  readonly wait_classification: string;
  readonly global_wait_earned: boolean;
  readonly candidate_count: number;
  readonly feasible_candidate_count: number;
  readonly selected_candidate_count: number;
  readonly hard_rejected_count: number;
  readonly soft_ranked_count: number;
  readonly data_insufficient_count: number;
  readonly quantity_zero_count: number;
  readonly aegis_veto_count: number;
  readonly near_miss_count: number;
  readonly action_plans_ready: number;
  readonly diagnostic_json: JsonRecord;
  readonly symbols_attempted: number;
  readonly symbols_completed: number;
  readonly scan_candidate_count: number;
  readonly completeness_state: string;
  readonly max_underlyings: number;
}

interface BranchRow {
  readonly scan_id: string;
  readonly branch: string;
  readonly status: string;
  readonly applicable: boolean;
  readonly evaluated: boolean;
  readonly evaluation_state: string;
  readonly candidate_count: number;
  readonly mechanically_rejected: number;
  readonly hard_vetoed: number;
  readonly soft_ranked: number;
  readonly data_insufficient: number;
  readonly enumeration_truncated: boolean;
  readonly route_reasons_json: readonly unknown[];
}

interface CandidateRow {
  readonly scan_id: string;
  readonly candidate_ref: string;
  readonly branch: string;
  readonly action: string;
  readonly underlying: string;
  readonly rank_at_decision: number | null;
  readonly selected: boolean;
  readonly legs_json: readonly unknown[];
  readonly dte: number | null;
  readonly delta: string | number | null;
  readonly spread_pct: string | number | null;
  readonly liquidity_json: JsonRecord;
  readonly economics_json: JsonRecord;
  readonly hard_blockers_json: readonly unknown[];
  readonly soft_evidence_json: readonly unknown[];
  readonly unknown_evidence_json: readonly unknown[];
  readonly structurally_feasible: boolean;
  readonly risk_feasible: boolean;
  readonly quantity: number;
  readonly binding_constraint: string;
  readonly sizing_reasons_json: readonly unknown[];
}

interface RuntimeCycleRow {
  readonly correlation_id: string;
  readonly invoked_at: string | Date;
  readonly completed_at: string | Date | null;
  readonly status: string;
  readonly result_json: JsonRecord;
}

export type ZeroTradeClassification =
  | 'HEALTHY_SELECTIVITY'
  | 'INSUFFICIENT_EVIDENCE'
  | 'POSSIBLE_WAIT_PARALYSIS'
  | 'CONFIRMED_WAIT_PARALYSIS'
  | 'EXECUTION_PATH_DEFECT'
  | 'DATA_PROVIDER_BLOCKER'
  | 'SIZING_BLOCKER'
  | 'AEGIS_DOMINANCE_REQUIRES_RESEARCH'
  | 'OTHER';

const strings = (value: unknown): readonly string[] => Array.isArray(value)
  ? value.filter((item): item is string => typeof item === 'string') : [];

const record = (value: unknown): JsonRecord => value !== null && typeof value === 'object' && !Array.isArray(value)
  ? value as JsonRecord : {};

const numeric = (value: unknown): number => typeof value === 'number' && Number.isFinite(value) ? value : 0;

function increment(target: Record<string, number>, values: readonly string[]): void {
  for (const value of values) target[value] = (target[value] ?? 0) + 1;
}

function rankedCounts(values: Readonly<Record<string, number>>): readonly { reason: string; count: number }[] {
  return Object.entries(values).map(([reason, count]) => ({ reason, count }))
    .sort((left, right) => right.count - left.count || left.reason.localeCompare(right.reason));
}

export function classifyZeroTradeEvidence(input: {
  readonly cycleCount: number;
  readonly actionReadyCycles: number;
  readonly actionPlansReady: number;
  readonly orderIntentCount: number;
  readonly candidateCount: number;
  readonly feasibleCandidateCount: number;
  readonly providerBlockedCycles: number;
  readonly dataWaitCycles: number;
  readonly quoteWaitCycles: number;
  readonly quantityZeroCount: number;
  readonly aegisVetoCount: number;
  readonly paralysisCycles: number;
  readonly healthyWaitCycles: number;
}): ZeroTradeClassification {
  if (input.cycleCount === 0) return 'INSUFFICIENT_EVIDENCE';
  if ((input.actionReadyCycles > 0 || input.actionPlansReady > 0) && input.orderIntentCount === 0) return 'EXECUTION_PATH_DEFECT';
  if (input.providerBlockedCycles > 0 || input.dataWaitCycles + input.quoteWaitCycles >= Math.ceil(input.cycleCount / 2)) {
    return 'DATA_PROVIDER_BLOCKER';
  }
  if (input.quantityZeroCount > 0 && input.quantityZeroCount >= Math.max(1, input.feasibleCandidateCount)) return 'SIZING_BLOCKER';
  if (input.aegisVetoCount > 0 && input.aegisVetoCount >= Math.max(1, input.feasibleCandidateCount)) {
    return 'AEGIS_DOMINANCE_REQUIRES_RESEARCH';
  }
  if (input.paralysisCycles === input.cycleCount && input.candidateCount > 0) return 'CONFIRMED_WAIT_PARALYSIS';
  if (input.paralysisCycles > 0) return 'POSSIBLE_WAIT_PARALYSIS';
  if (input.healthyWaitCycles > 0 || input.candidateCount > 0) return 'HEALTHY_SELECTIVITY';
  return 'OTHER';
}

export async function readZeroTradeDiagnostic(
  pool: Pool,
  window: { readonly startUtc: string; readonly endUtc: string },
): Promise<JsonRecord> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN TRANSACTION READ ONLY');
    const [diagnostics, branches, candidates, execution, runtimeCycles] = await Promise.all([
      client.query<DiagnosticRow>(
        `SELECT d.scan_id,d.observed_at,d.wait_classification,d.global_wait_earned,
                d.candidate_count,d.feasible_candidate_count,d.selected_candidate_count,
                d.hard_rejected_count,d.soft_ranked_count,d.data_insufficient_count,
                d.quantity_zero_count,d.aegis_veto_count,d.near_miss_count,d.action_plans_ready,
                d.diagnostic_json,s.symbols_attempted,s.symbols_completed,
                s.candidate_count AS scan_candidate_count,s.completeness_state,s.max_underlyings
           FROM research.theta_runtime_behavior_diagnostic d
           JOIN research.theta_shadow_scan_run s USING(scan_id)
          WHERE d.observed_at >= $1::timestamptz AND d.observed_at < $2::timestamptz
          ORDER BY d.observed_at,d.scan_id`, [window.startUtc, window.endUtc],
      ),
      client.query<BranchRow>(
        `SELECT m.scan_id,b.branch::text,b.status,b.applicable,b.evaluated,b.evaluation_state,
                b.candidate_count,b.mechanically_rejected,b.hard_vetoed,b.soft_ranked,
                b.data_insufficient,b.enumeration_truncated,b.route_reasons_json
           FROM research.theta_shadow_scan_member m
           JOIN research.theta_shadow_scan_run s USING(scan_id)
           JOIN trade.canonical_strategy_branch_evidence b ON b.fusion_snapshot_id=m.fusion_snapshot_id
          WHERE s.finished_at >= $1::timestamptz AND s.finished_at < $2::timestamptz
          ORDER BY m.scan_id,b.branch`, [window.startUtc, window.endUtc],
      ),
      client.query<CandidateRow>(
        `SELECT m.scan_id,c.candidate_ref,c.branch::text,c.action,c.underlying,c.rank_at_decision,
                c.selected,c.legs_json,c.dte,c.delta,c.spread_pct,c.liquidity_json,c.economics_json,
                c.hard_blockers_json,c.soft_evidence_json,
                c.unknown_evidence_json,c.structurally_feasible,c.risk_feasible,c.quantity,
                c.binding_constraint,c.sizing_reasons_json
           FROM research.theta_shadow_scan_member m
           JOIN research.theta_shadow_scan_run s USING(scan_id)
           JOIN trade.canonical_strategy_branch_evidence b ON b.fusion_snapshot_id=m.fusion_snapshot_id
           JOIN trade.canonical_strategy_candidate_evidence c ON c.branch_evidence_id=b.branch_evidence_id
          WHERE s.finished_at >= $1::timestamptz AND s.finished_at < $2::timestamptz
          ORDER BY m.scan_id,c.rank_at_decision NULLS LAST,c.candidate_ref`, [window.startUtc, window.endUtc],
      ),
      client.query<{
        action_plans: number; order_intents: number; broker_orders: number; fills: number;
      }>(
        `SELECT
          (SELECT count(*)::int FROM trade.master_paper_action_plan WHERE created_at >= $1 AND created_at < $2) action_plans,
          (SELECT count(*)::int FROM trade.order_intent WHERE created_at >= $1 AND created_at < $2) order_intents,
          (SELECT count(*)::int FROM trade.broker_order WHERE created_at >= $1 AND created_at < $2) broker_orders,
          (SELECT count(*)::int FROM trade.fill WHERE created_at >= $1 AND created_at < $2) fills`,
        [window.startUtc, window.endUtc],
      ),
      client.query<RuntimeCycleRow>(
        `SELECT correlation_id,invoked_at,completed_at,status,result_json
           FROM ops.runtime_worker_cycle
          WHERE invoked_at >= $1::timestamptz AND invoked_at < $2::timestamptz
            AND result_json #>> '{reconciliation,marketOpen}' = 'true'
            AND EXISTS (
              SELECT 1 FROM jsonb_array_elements(COALESCE(result_json->'jobResults','[]'::jsonb)) job
               WHERE job->>'jobType'='OPPORTUNITY_SCAN'
            )
          ORDER BY invoked_at,correlation_id`, [window.startUtc, window.endUtc],
      ),
    ]);
    await client.query('COMMIT');

    const hardGates: Record<string, number> = {};
    const unknownEvidence: Record<string, number> = {};
    const sizingReasons: Record<string, number> = {};
    const routeReasons: Record<string, number> = {};
    for (const candidate of candidates.rows) {
      increment(hardGates, strings(candidate.hard_blockers_json));
      increment(unknownEvidence, strings(candidate.unknown_evidence_json));
      increment(sizingReasons, strings(candidate.sizing_reasons_json));
    }
    for (const branch of branches.rows) increment(routeReasons, strings(branch.route_reasons_json));

    const cycleRows = diagnostics.rows.map((row) => {
      const diagnostic = record(row.diagnostic_json);
      return {
        scanId: row.scan_id,
        observedAt: new Date(row.observed_at).toISOString(),
        session: diagnostic.session ?? 'UNKNOWN',
        completeness: row.completeness_state,
        universeSize: numeric(diagnostic.universeSize),
        maxUnderlyings: row.max_underlyings,
        symbolsAttempted: row.symbols_attempted,
        symbolsCompleted: row.symbols_completed,
        candidateCount: row.candidate_count,
        feasibleCandidateCount: row.feasible_candidate_count,
        selectedCandidateCount: row.selected_candidate_count,
        hardRejectedCount: row.hard_rejected_count,
        softRankedCount: row.soft_ranked_count,
        dataInsufficientCount: row.data_insufficient_count,
        quantityZeroCount: row.quantity_zero_count,
        aegisVetoCount: row.aegis_veto_count,
        nearMissCount: row.near_miss_count,
        actionPlansReady: row.action_plans_ready,
        finalAction: diagnostic.finalAction ?? 'UNKNOWN',
        waitClassification: row.wait_classification,
        globalWaitEarned: row.global_wait_earned,
        waitReasons: strings(diagnostic.waitReasons),
        providerBlockers: strings(diagnostic.providerBlockers),
        actionPlanBlockers: strings(diagnostic.actionPlanBlockers),
        antiParalysisFindings: strings(diagnostic.antiParalysisFindings),
        bestRejectedCandidates: Array.isArray(diagnostic.bestRejectedCandidates)
          ? diagnostic.bestRejectedCandidates.slice(0, 5) : [],
        strategyQualityChallengers: Array.isArray(diagnostic.strategyQualityChallengers)
          ? diagnostic.strategyQualityChallengers : [],
        universeBreadthChallenger: record(diagnostic.universeBreadthChallenger),
      };
    });
    const branchSummary = [...new Set(branches.rows.map((row) => row.branch))].sort().map((branch) => {
      const rows = branches.rows.filter((row) => row.branch === branch);
      return {
        branch,
        status: rows[0]?.status ?? 'UNKNOWN',
        observedCycles: new Set(rows.map((row) => row.scan_id)).size,
        applicableCycles: new Set(rows.filter((row) => row.applicable).map((row) => row.scan_id)).size,
        evaluatedCycles: new Set(rows.filter((row) => row.evaluated).map((row) => row.scan_id)).size,
        blockedMissingInputCycles: new Set(rows.filter((row) => row.evaluation_state === 'BLOCKED_MISSING_INPUT').map((row) => row.scan_id)).size,
        candidateCount: rows.reduce((sum, row) => sum + row.candidate_count, 0),
        mechanicallyRejected: rows.reduce((sum, row) => sum + row.mechanically_rejected, 0),
        hardVetoed: rows.reduce((sum, row) => sum + row.hard_vetoed, 0),
        dataInsufficient: rows.reduce((sum, row) => sum + row.data_insufficient, 0),
        enumerationTruncatedCycles: new Set(rows.filter((row) => row.enumeration_truncated).map((row) => row.scan_id)).size,
      };
    });
    const totals = diagnostics.rows.reduce((sum, row) => ({
      candidates: sum.candidates + row.candidate_count,
      feasible: sum.feasible + row.feasible_candidate_count,
      selected: sum.selected + row.selected_candidate_count,
      hardRejected: sum.hardRejected + row.hard_rejected_count,
      softRanked: sum.softRanked + row.soft_ranked_count,
      dataInsufficient: sum.dataInsufficient + row.data_insufficient_count,
      quantityZero: sum.quantityZero + row.quantity_zero_count,
      aegisVeto: sum.aegisVeto + row.aegis_veto_count,
      nearMiss: sum.nearMiss + row.near_miss_count,
      actionPlansReady: sum.actionPlansReady + row.action_plans_ready,
    }), { candidates:0,feasible:0,selected:0,hardRejected:0,softRanked:0,dataInsufficient:0,
      quantityZero:0,aegisVeto:0,nearMiss:0,actionPlansReady:0 });
    const executionRow = execution.rows[0] ?? { action_plans:0,order_intents:0,broker_orders:0,fills:0 };
    const actionReadyCycles = cycleRows.filter((row) => row.waitClassification === 'ACTION_READY').length;
    const providerBlockedCycles = cycleRows.filter((row) => row.providerBlockers.length > 0).length;
    const dataWaitCycles = cycleRows.filter((row) => row.waitClassification === 'DATA_WAIT').length;
    const quoteWaitCycles = cycleRows.filter((row) => row.waitClassification === 'QUOTE_WAIT').length;
    const paralysisCycles = cycleRows.filter((row) => row.waitClassification === 'POSSIBLE_LOGIC_PARALYSIS'
      || row.waitClassification === 'OVERSTRICT_POLICY_WAIT').length;
    const healthyWaitCycles = cycleRows.filter((row) => row.waitClassification === 'HEALTHY_WAIT'
      || row.waitClassification === 'NO_OPPORTUNITY').length;
    const classification = classifyZeroTradeEvidence({ cycleCount:cycleRows.length,actionReadyCycles,
      actionPlansReady:totals.actionPlansReady,orderIntentCount:executionRow.order_intents,
      candidateCount:totals.candidates,feasibleCandidateCount:totals.feasible,providerBlockedCycles,
      dataWaitCycles,quoteWaitCycles,quantityZeroCount:totals.quantityZero,aegisVetoCount:totals.aegisVeto,
      paralysisCycles,healthyWaitCycles });
    const opportunityCycles = runtimeCycles.rows.map((cycle) => {
      const result = record(cycle.result_json);
      const jobs = Array.isArray(result.jobResults) ? result.jobResults.map(record) : [];
      const opportunity = jobs.find((job) => job.jobType === 'OPPORTUNITY_SCAN');
      const invokedAt = new Date(cycle.invoked_at).toISOString();
      const completedAt = cycle.completed_at === null ? null : new Date(cycle.completed_at).toISOString();
      const relatedScans = cycleRows.filter((scan) => {
        const observed = Date.parse(scan.observedAt);
        return observed >= Date.parse(invokedAt) && (completedAt === null || observed <= Date.parse(completedAt));
      });
      return {
        correlationId: cycle.correlation_id,
        invokedAt,
        completedAt,
        status: cycle.status,
        opportunityStatus: typeof opportunity?.status === 'string' ? opportunity.status : 'UNKNOWN',
        opportunityOutcome: typeof opportunity?.outcome === 'string' ? opportunity.outcome : 'UNKNOWN',
        opportunityErrorCode: typeof opportunity?.errorCode === 'string' ? opportunity.errorCode : null,
        scanIds: relatedScans.map((scan) => scan.scanId),
      };
    });
    const targetOpportunityCycles = opportunityCycles.slice(-13);
    const targetScanIds = new Set(targetOpportunityCycles.flatMap((cycle) => cycle.scanIds));
    const targetCycles = cycleRows.filter((cycle) => targetScanIds.has(cycle.scanId));
    const targetCandidates = candidates.rows.filter((candidate) => targetScanIds.has(candidate.scan_id));
    const targetBranches = branches.rows.filter((branch) => targetScanIds.has(branch.scan_id));
    const targetHardGates: Record<string, number> = {};
    const targetUnknownEvidence: Record<string, number> = {};
    const targetSizingReasons: Record<string, number> = {};
    const targetRouteReasons: Record<string, number> = {};
    for (const candidate of targetCandidates) {
      increment(targetHardGates, strings(candidate.hard_blockers_json));
      increment(targetUnknownEvidence, strings(candidate.unknown_evidence_json));
      increment(targetSizingReasons, strings(candidate.sizing_reasons_json));
    }
    for (const branch of targetBranches) increment(targetRouteReasons, strings(branch.route_reasons_json));
    const candidateHas = (candidate: CandidateRow, pattern: RegExp): boolean =>
      strings(candidate.unknown_evidence_json).some((reason) => pattern.test(reason.toUpperCase()))
      || strings(candidate.hard_blockers_json).some((reason) => pattern.test(reason.toUpperCase()));
    const targetTotals = {
      uniqueUnderlyings: [...new Set(targetCandidates.map((candidate) => candidate.underlying))].sort(),
      symbolEvaluations: targetCycles.reduce((sum, cycle) => sum + cycle.symbolsAttempted, 0),
      candidates: targetCandidates.length,
      hardRejected: targetCandidates.filter((candidate) => strings(candidate.hard_blockers_json).length > 0).length,
      structurallyFeasible: targetCandidates.filter((candidate) => candidate.structurally_feasible).length,
      riskFeasible: targetCandidates.filter((candidate) => candidate.risk_feasible).length,
      quoteRejected: targetCandidates.filter((candidate) => candidateHas(candidate, /QUOTE|BBO|STALE|BID|ASK/)).length,
      liquidityRejected: targetCandidates.filter((candidate) => candidateHas(candidate, /SPREAD|LIQUIDITY|OPEN_INTEREST|VOLUME|ZERO_BID/)).length,
      quoteUsable: targetCandidates.filter((candidate) => !candidateHas(candidate, /QUOTE|BBO|STALE|BID|ASK/)).length,
      liquidityUsable: targetCandidates.filter((candidate) => !candidateHas(candidate, /SPREAD|LIQUIDITY|OPEN_INTEREST|VOLUME|ZERO_BID/)).length,
      economicEvidenceKnown: targetCandidates.filter((candidate) =>
        typeof candidate.economics_json.expectedAfterCostEv === 'number'
        && Number.isFinite(candidate.economics_json.expectedAfterCostEv)).length,
      positiveExpectedAfterCostEv: targetCandidates.filter((candidate) =>
        typeof candidate.economics_json.expectedAfterCostEv === 'number'
        && candidate.economics_json.expectedAfterCostEv > 0).length,
      unknownData: targetCandidates.filter((candidate) => strings(candidate.unknown_evidence_json).length > 0).length,
      aegisUnknown: targetCandidates.filter((candidate) => candidateHas(candidate, /AEGIS_STATE_UNKNOWN/)).length,
      aegisVetoed: targetCandidates.filter((candidate) => candidateHas(candidate, /AEGIS_(HOLD_ONLY|HARD_VETO|EMERGENCY_EXIT_ONLY)/)).length,
      quantityZero: targetCandidates.filter((candidate) => candidate.quantity === 0).length,
      quantityPositive: targetCandidates.filter((candidate) => candidate.quantity > 0).length,
      selected: targetCandidates.filter((candidate) => candidate.selected).length,
      nearMisses: targetCycles.reduce((sum, cycle) => sum + cycle.nearMissCount, 0),
      waits: targetCycles.filter((cycle) => cycle.finalAction === 'WAIT').length,
      opens: targetCycles.filter((cycle) => cycle.finalAction === 'ACTION_READY').length,
      explicitWaits: targetCycles.filter((cycle) => cycle.finalAction === 'WAIT').length,
      finalActionUnavailable: targetCycles.filter((cycle) => cycle.finalAction === 'UNKNOWN').length,
      dteDistribution: Object.entries(targetCandidates.reduce<Record<string,number>>((counts,candidate)=>{
        const key=candidate.dte===null?'UNKNOWN':String(candidate.dte);counts[key]=(counts[key]??0)+1;return counts;
      },{})).map(([dte,count])=>({dte,count})).sort((left,right)=>left.dte.localeCompare(right.dte,undefined,{numeric:true})),
    };

    return {
      contractVersion: zeroTradeDiagnosticVersion,
      generatedAt: new Date().toISOString(),
      source: 'PRODUCTION_POSTGRESQL_SERVER_SIDE_READ_ONLY',
      window,
      classification,
      cycleCount: cycleRows.length,
      cycles: cycleRows,
      openOpportunityCycleCount: opportunityCycles.length,
      openOpportunityCycles: opportunityCycles,
      targetOpenSessionSample: {
        selectionRule: 'LAST_13_OPEN_OPPORTUNITY_CYCLES_IN_WINDOW',
        cycleCount: targetOpportunityCycles.length,
        successfulCycles: targetOpportunityCycles.filter((cycle) => cycle.status === 'SUCCEEDED').length,
        degradedCycles: targetOpportunityCycles.filter((cycle) => cycle.status === 'DEGRADED').length,
        opportunityCycles: targetOpportunityCycles,
        diagnosticCycles: targetCycles,
        totals: targetTotals,
        branchSummary: [...new Set(targetBranches.map((row) => row.branch))].sort().map((branch) => {
          const rows = targetBranches.filter((row) => row.branch === branch);
          return { branch,status:rows[0]?.status ?? 'UNKNOWN',observedCycles:new Set(rows.map((row) => row.scan_id)).size,
            applicableCycles:new Set(rows.filter((row) => row.applicable).map((row) => row.scan_id)).size,
            evaluatedCycles:new Set(rows.filter((row) => row.evaluated).map((row) => row.scan_id)).size,
            candidateCount:rows.reduce((sum,row)=>sum+row.candidate_count,0),
            dataInsufficient:rows.reduce((sum,row)=>sum+row.data_insufficient,0) };
        }),
        rejectionDistribution: { hardGates:rankedCounts(targetHardGates),unknownEvidence:rankedCounts(targetUnknownEvidence),
          sizingReasons:rankedCounts(targetSizingReasons),routeReasons:rankedCounts(targetRouteReasons) },
        bestRejectedCandidates: targetCandidates.filter((row) => !row.selected)
          .sort((left,right)=>(left.rank_at_decision??Number.MAX_SAFE_INTEGER)-(right.rank_at_decision??Number.MAX_SAFE_INTEGER))
          .slice(0,10).map((row)=>({candidateRef:row.candidate_ref,branch:row.branch,underlying:row.underlying,
            rankAtDecision:row.rank_at_decision,dte:row.dte,delta:row.delta===null?null:Number(row.delta),
            spreadPct:row.spread_pct===null?null:Number(row.spread_pct),legs:row.legs_json,
            liquidity:row.liquidity_json,economics:row.economics_json,hardBlockers:strings(row.hard_blockers_json),
            unknownEvidence:strings(row.unknown_evidence_json),quantity:row.quantity,bindingConstraint:row.binding_constraint})),
      },
      totals,
      branchSummary,
      rejectionDistribution: {
        hardGates: rankedCounts(hardGates),
        unknownEvidence: rankedCounts(unknownEvidence),
        sizingReasons: rankedCounts(sizingReasons),
        routeReasons: rankedCounts(routeReasons),
      },
      bestRejectedCandidates: candidates.rows.filter((row) => !row.selected)
        .sort((left, right) => (left.rank_at_decision ?? Number.MAX_SAFE_INTEGER)
          - (right.rank_at_decision ?? Number.MAX_SAFE_INTEGER))
        .slice(0, 12).map((row) => ({ candidateRef:row.candidate_ref,branch:row.branch,action:row.action,
          underlying:row.underlying,rankAtDecision:row.rank_at_decision,dte:row.dte,
          delta:row.delta===null?null:Number(row.delta),spreadPct:row.spread_pct===null?null:Number(row.spread_pct),
          hardBlockers:strings(row.hard_blockers_json),unknownEvidence:strings(row.unknown_evidence_json),
          structurallyFeasible:row.structurally_feasible,riskFeasible:row.risk_feasible,
          quantity:row.quantity,bindingConstraint:row.binding_constraint })),
      executionHandoff: {
        persistedActionPlans: executionRow.action_plans,
        orderIntents: executionRow.order_intents,
        brokerOrders: executionRow.broker_orders,
        fills: executionRow.fills,
      },
      safeguards: { executionAuthorized:false,ordersSubmitted:0,followerExecution:'LOCKED',liveMoneyAuthorized:false },
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
