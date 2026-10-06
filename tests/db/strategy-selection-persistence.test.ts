import assert from 'node:assert/strict';
import test from 'node:test';
import pg from 'pg';
import { PostgresThetaCycleStore } from '../../src/theta/postgres-theta-cycle-store.js';
import { verifyAegisAssessmentIdentity } from '../../src/theta/aegis-assessment-identity.js';
import { riskFamilySchema } from '../../src/theta/aegis-contract.js';
import type { ThetaShadowCycleResult } from '../../src/theta/theta-shadow-cycle.js';
import { createHash, randomUUID } from 'node:crypto';
import { PostgresMasterPaperActionPlanStore } from '../../src/execution/postgres-master-paper-action-plan-store.js';
import { masterPaperActionPlanVersion, type ApprovedMasterPaperActionPlan } from '../../src/execution/master-paper-action-handoff.js';
import { definedRiskOpenPackageIdentity } from '../../src/execution/defined-risk-paper-order.js';
import type { CanonicalFrontierCandidate, CanonicalStrategyFrontier } from '../../src/theta/canonical-strategy-frontier.js';
import { buildCycle, persistenceContext, seedWorld } from '../helpers/theta-cycle-fixture.js';

// Real PostgreSQL: when the sovereign frontier selects H or D (from a governed receipt), the decision must persist a NON-NULL selected candidate (H: its exact
// put; D: a two-leg candidate with no representative contract) and an AEGIS identity bound to THAT strategy's own assessment -- never Q's assessment of the same
// contract. Before this, an H/D selection persisted a NULL candidate and could never become a Paper plan.
const url = process.env.TEST_DATABASE_URL;
const exitActions = ['CLOSE', 'CANCEL', 'BUY_TO_CLOSE', 'RECONCILE', 'REDUCE_POSITION', 'SAFETY_EXIT'] as const;

function selectStrategy(cycle: ThetaShadowCycleResult, branch: 'THETA_HOLD_STRIKE' | 'THETA_DEFINED_RISK', withOwnAssessment: boolean): { cycle: ThetaShadowCycleResult; ref: string } {
  const frontier = cycle.strategyFrontier as CanonicalStrategyFrontier;
  const contract = (cycle.fusionSnapshot?.snapshot.contractCandidates as Array<{ optionSymbol: string; strike: number; expiration: string; multiplier: number }>)[0];
  assert.ok(contract);
  const leg = (symbol: string, strike: number, positionIntent: 'SELL_TO_OPEN' | 'BUY_TO_OPEN') => ({ positionIntent, optionSymbol: symbol, occSymbol: symbol, optionType: 'PUT' as const,
    strike, expiration: contract.expiration, multiplier: contract.multiplier, contractTradable: true, exerciseStyle: 'AMERICAN', deliverableClassification: 'STANDARD_EQUITY' as const,
    bid: 1, ask: 1.1, quoteTimestamp: frontier.timestamp });
  const longSymbol = `${contract.optionSymbol.slice(0, -8)}${String(Math.max(1, contract.strike - 5) * 1000).padStart(8, '0')}`;
  const legs = branch === 'THETA_HOLD_STRIKE' ? [leg(contract.optionSymbol, contract.strike, 'SELL_TO_OPEN')]
    : [leg(contract.optionSymbol, contract.strike, 'SELL_TO_OPEN'), leg(longSymbol, Math.max(1, contract.strike - 5), 'BUY_TO_OPEN')];
  const ref = branch === 'THETA_HOLD_STRIKE' ? `${branch}:${legs[0]?.optionSymbol}` : `${branch}:${legs[0]?.optionSymbol}:${legs[1]?.optionSymbol}`;
  const selected = { candidateId: ref, branch, action: branch === 'THETA_HOLD_STRIKE' ? 'OPEN_CSP' : 'OPEN_DEFINED_RISK', underlying: 'SPY', legs, dte: 5, delta: -0.2,
    moneyness: 0.95, spreadPct: 0.02, liquidity: { volume: 100, openInterest: 1000 }, shortDteRiskEvidence: null, multiLegRiskEvidence: null,
    economics: { premiumPerShare: 1, grossPremium: 100, collateral: branch === 'THETA_HOLD_STRIKE' ? contract.strike * 100 : 400, maxProfit: 100, maxLoss: 400, breakEven: contract.strike - 1,
      downsideCushion: 0.01, retainedUpside: null, callAwayProceeds: null, wholeChainPnlAtCallAway: null },
    structurallyFeasible: true, riskFeasible: true, hardBlockers: [], unknownEvidence: [], softEvidence: [], aegisState: 'ALLOW_FULL',
    sizing: { quantity: 1, bindingConstraint: 'NONE' }, paretoRank: null, dominatedBy: [], executionAuthorized: false } as unknown as CanonicalFrontierCandidate;
  const branches = frontier.branches.map((item) => item.branch === branch ? { ...item, candidates: [selected], candidateCount: 1, bestCandidateId: ref, applicable: true, evaluated: true, evaluationState: 'EVALUATED' } : item);
  const hash = cycle.fusionSnapshot?.contentHash as string;
  const assessment = { contractVersion: 'theta-aegis-runtime-v1', decisionId: `${hash}:${ref}`, snapshotId: hash, timestamp: frontier.timestamp, policyVersion: 'aegis-policy-v1',
    compoundStressHoldCount: 2, policyConfigurationHash: 'a'.repeat(64), families: riskFamilySchema.options.map((family) => ({ family, state: 'ALLOW_FULL', reasons: [] })),
    newRiskState: 'ALLOW_FULL', reasons: [], permittedActions: [...exitActions, 'OPEN_CSP'] };
  return { ref, cycle: { ...cycle, strategyFrontier: { ...frontier, branches, selectedBranch: branch, selectedCandidateId: ref, primaryAction: selected.action,
    selectedQuantity: 1, entrySelectionBasis: branch === 'THETA_HOLD_STRIKE' ? 'THETA_H_DECISION_BOUND' : 'THETA_D_DECISION_BOUND', globalWaitEarned: false } as CanonicalStrategyFrontier,
    strategyAegisByCandidateId: withOwnAssessment ? { [ref]: assessment } : {} } as unknown as ThetaShadowCycleResult };
}

test('an H or D selection persists its own candidate and a strategy-bound AEGIS identity; it never borrows Q\'s assessment', { skip: !url }, async () => {
  assert.ok(url && ['127.0.0.1', 'localhost'].includes(new URL(url).hostname), 'Disposable local database only');
  const pool = new pg.Pool({ connectionString: url, max: 4 });
  try {
    const world = await seedWorld(pool, '2026-10-07T14:59:00.000Z');
    const store = new PostgresThetaCycleStore(pool, {});
    const salt = Date.now() % 100_000;
    for (const [index, branch] of (['THETA_HOLD_STRIKE', 'THETA_DEFINED_RISK'] as const).entries()) {
      const { cycle, ref } = selectStrategy(buildCycle(6, `2026-10-07T15:0${index}:00.000Z`, { sharedKiB: 30 }, salt + index), branch, true);
      const saved = await store.persist(persistenceContext(world), cycle);
      const row = (await pool.query(`SELECT d.selected_candidate_id::text AS candidate_id, c.structure_code, c.option_contract_id::text AS contract,
          cs.branch::text AS set_branch, c.metrics_json->'strategyCandidate' AS strategy_candidate, d.receipt_json->'aegisAssessmentIdentity' AS identity
        FROM trade.decision d JOIN trade.candidate c ON c.candidate_id=d.selected_candidate_id JOIN trade.candidate_set cs ON cs.candidate_set_id=c.candidate_set_id
        WHERE d.fusion_snapshot_id=$1`, [saved.fusionSnapshotId])).rows[0];
      assert.ok(row, `${branch}: the decision references a persisted candidate (was NULL before)`);
      assert.equal(row.set_branch, branch);
      if (branch === 'THETA_HOLD_STRIKE') { assert.equal(row.structure_code, 'CSP'); assert.ok(row.contract); }
      else {
        assert.equal(row.structure_code, 'PUT_CREDIT_SPREAD');
        assert.equal(row.contract, null, 'a spread has no representative contract');
        assert.equal(row.strategy_candidate.legs.length, 2);
        assert.ok(row.strategy_candidate.legs.every((leg: { optionContractId: string }) => /^[0-9a-f-]{36}$/.test(leg.optionContractId)));
      }
      const identity = verifyAegisAssessmentIdentity(row.identity);
      assert.ok(identity, `${branch}: the AEGIS identity verifies`);
      assert.equal(identity.strategyBranch, branch);
      assert.equal(identity.runtimeCandidateRef, ref);
      assert.equal(identity.assessmentCandidateId, ref, 'bound to the strategy\'s own candidate-bound assessment');
      // replay is idempotent
      await store.persist(persistenceContext(world), cycle);
      assert.equal((await pool.query(`SELECT count(*)::int AS n FROM trade.candidate c JOIN trade.candidate_set cs USING(candidate_set_id) WHERE cs.fusion_snapshot_id=$1 AND cs.branch::text=$2`,
        [saved.fusionSnapshotId, branch])).rows[0].n, 1);
    }
    // without the strategy's own assessment there is NO identity (it is never filled from Q's per-symbol assessment)
    const { cycle } = selectStrategy(buildCycle(6, '2026-10-07T15:05:00.000Z', { sharedKiB: 30 }, salt + 9), 'THETA_HOLD_STRIKE', false);
    const saved = await store.persist(persistenceContext(world), cycle);
    const identity = (await pool.query(`SELECT receipt_json->'aegisAssessmentIdentity' AS identity FROM trade.decision WHERE fusion_snapshot_id=$1`, [saved.fusionSnapshotId])).rows[0]?.identity;
    assert.equal(identity ?? null, null);
  } finally { await pool.end(); }
});

// Real PostgreSQL: a persisted D selection becomes exactly one enqueued Paper plan on a DEFINED_RISK chain; the package can not be re-pointed at other
// contracts, a D plan can not ride an H decision, and a second spread touching either leg contract is held back while the first is in flight.
test('D plan enqueue binds the persisted two-leg identity, a DEFINED_RISK chain and the in-flight duplicate guard', { skip: !url }, async () => {
  assert.ok(url && ['127.0.0.1', 'localhost'].includes(new URL(url).hostname), 'Disposable local database only');
  const pool = new pg.Pool({ connectionString: url, max: 4 });
  try {
    const world = await seedWorld(pool, '2026-10-08T14:59:00.000Z');
    const store = new PostgresThetaCycleStore(pool, {});
    const accountId = randomUUID();
    await pool.query(`INSERT INTO trade.execution_account(execution_account_id,account_kind,environment,provider_account_ref_hash,provider_account_ref_masked)
      VALUES($1,'MASTER_API_KEY','PAPER',$2,'test')`, [accountId, createHash('sha256').update(accountId).digest('hex')]);
    await pool.query('UPDATE trade.execution_account SET account_ready=true WHERE execution_account_id=$1', [accountId]);
    const salt = Date.now() % 100_000;
    const persistD = async (minute: number, branch: 'THETA_DEFINED_RISK' | 'THETA_HOLD_STRIKE' = 'THETA_DEFINED_RISK') => {
      const built = selectStrategy(buildCycle(6, `2026-10-08T15:${String(minute).padStart(2, '0')}:00.000Z`, { sharedKiB: 30 }, salt), branch, true);
      const cycle = { ...built.cycle, provenanceDetail: [...built.cycle.provenanceDetail, 'aegisInputs=DERIVED_FROM_REAL'] } as ThetaShadowCycleResult;
      const saved = await store.persist(persistenceContext(world), cycle);
      const row = (await pool.query(`SELECT d.decision_id::text, d.selected_candidate_id::text AS candidate_id, c.underlying_id::text,
          c.metrics_json->'strategyCandidate' AS strategy_candidate, d.receipt_json->'aegisAssessmentIdentity' AS identity
        FROM trade.decision d JOIN trade.candidate c ON c.candidate_id=d.selected_candidate_id WHERE d.fusion_snapshot_id=$1`, [saved.fusionSnapshotId])).rows[0];
      assert.ok(row);
      return { row, cycle };
    };
    type PlanLeg = { legIndex: 1 | 2; optionContractId: string; occSymbol: string };
    const planFor = ({ row, cycle }: Awaited<ReturnType<typeof persistD>>, legOverride?: (legs: PlanLeg[]) => PlanLeg[]): ApprovedMasterPaperActionPlan => {
      const persisted = (row.strategy_candidate as { legs: Array<{ legIndex: 1 | 2; contractSymbol: string; optionContractId: string }> }).legs;
      const frontier = cycle.strategyFrontier as CanonicalStrategyFrontier;
      const candidate = frontier.branches.flatMap((b) => b.candidates).find((c) => c.candidateId === frontier.selectedCandidateId) as CanonicalFrontierCandidate;
      const legs = persisted.map((leg, index) => ({ legIndex: leg.legIndex, optionContractId: leg.optionContractId, providerContractId: leg.contractSymbol,
        occSymbol: leg.contractSymbol, optionType: 'PUT', positionIntent: index === 0 ? 'sell_to_open' : 'buy_to_open', ratioQuantity: 1,
        expiration: candidate.legs[index]?.expiration, strike: candidate.legs[index]?.strike, multiplier: 100, deliverableIdentity: 'STANDARD:SPY:100' }));
      const finalLegs = legOverride === undefined ? legs : legOverride(legs as PlanLeg[]) as typeof legs;
      const planId = randomUUID();
      return { contractVersion: masterPaperActionPlanVersion, actionPlanId: planId, decisionAuthority: 'NEW_RISK', managementInputSnapshotId: null, managementActionFrontierId: null,
        actionGroupId: planId, legSequence: 1, dependsOnActionPlanId: null, executionAccountId: accountId, decisionId: row.decision_id, candidateId: row.candidate_id,
        strategyVersion: 'strategy-v1', strategyBranch: 'THETA_DEFINED_RISK', strategyPaperAuthorityReceiptHash: 'c'.repeat(64), chainId: randomUUID(), optionContractId: null,
        underlyingId: row.underlying_id, underlying: 'SPY', optionType: 'PUT', symbol: finalLegs[0]?.occSymbol, quantity: 1, canonicalQuantity: 1, paperEvidenceQuantity: 1,
        paperEvidenceRiskCap: 1, paperEvidenceCapReason: 'CANONICAL_QUANTITY_LOWER', executionTier: 'PAPER_EVIDENCE', multiplier: 100, action: 'OPEN_DEFINED_RISK',
        definedRisk: { packageIdentity: definedRiskOpenPackageIdentity(String(finalLegs[0]?.occSymbol), String(finalLegs[1]?.occSymbol)), structuralNetCreditPerShare: 1, legs: finalLegs },
        economicBoundary: 0.05, economicsRemainPositive: true, expectedAfterCostEv: null, empiricalEconomicsReady: false, selectedByCanonicalAuthority: true, hardValidityPassed: true,
        accountVerified: true, optionsCapabilityVerified: true, noEquivalentExposureConflict: true, aegisState: 'ALLOW_FULL', aegisAssessmentIdentity: row.identity,
        killSwitchActive: false, decisionExpiresAt: '2026-10-08T15:30:00.000Z', pricingPolicy: { waitIntervalMs: 5000, maxAttempts: 3, concessionFractions: [0, 0.5, 1], tickSize: 0.01 },
        pricingAttempt: 0, previousLimit: null } as unknown as ApprovedMasterPaperActionPlan;
    };
    const plans = new PostgresMasterPaperActionPlanStore(pool);
    const first = await persistD(10);
    const plan = planFor(first);
    const chain = { botInstanceId: world.botId, underlyingId: plan.underlyingId };
    // a re-pointed package (the long leg swapped onto another real contract id) is rejected before anything is written
    await assert.rejects(plans.enqueueWithDisposition(planFor(first, (legs) => [legs[0] as PlanLeg, { ...(legs[1] as PlanLeg), optionContractId: (legs[0] as PlanLeg).optionContractId }]),
      '2026-10-08T15:10:01.000Z', chain), /ACTION_PLAN_DEFINED_RISK_LEG_LINEAGE_INVALID/);
    const enqueued = await plans.enqueueWithDisposition(plan, '2026-10-08T15:10:01.000Z', chain);
    assert.equal(enqueued.disposition, 'ENQUEUED');
    assert.equal((await pool.query('SELECT chain_kind FROM trade.economic_chain WHERE chain_id=$1', [plan.chainId])).rows[0]?.chain_kind, 'DEFINED_RISK');
    assert.equal((await plans.enqueueWithDisposition(plan, '2026-10-08T15:10:02.000Z', chain)).disposition, 'REPLAY', 'idempotent replay');
    // the next scan re-selects the same spread under a NEW decision while the first plan is still in its window: held back, not a second spread
    const second = await persistD(11);
    const duplicate = planFor(second);
    assert.ok(duplicate.definedRisk?.legs.some((leg) => plan.definedRisk?.legs.some((other) => other.optionContractId === leg.optionContractId)),
      'fixture shares a leg contract (no vacuous pass)');
    const held = await plans.enqueueWithDisposition(duplicate, '2026-10-08T15:11:01.000Z', { botInstanceId: world.botId, underlyingId: duplicate.underlyingId });
    assert.equal(held.disposition, 'EQUIVALENT_ENTRY_IN_FLIGHT');
    assert.deepEqual(held.conflictingIds, [plan.actionPlanId]);
    // a D plan can never ride an H decision (a single-leg candidate)
    const hold = await persistD(12, 'THETA_HOLD_STRIKE');
    await assert.rejects(plans.enqueueWithDisposition({ ...planFor(first), decisionId: hold.row.decision_id, candidateId: hold.row.candidate_id } as ApprovedMasterPaperActionPlan,
      '2026-10-08T15:12:01.000Z', chain), /ACTION_PLAN_DEFINED_RISK_CANDIDATE_INVALID/);
    // NO SILENT EXPIRY: the immediate handoff did not reach this READY plan; its leaf reason survives the expiry quarantine
    assert.equal(await plans.recordHandoffNotReached(plan.actionPlanId, ['SKIPPED:MARKET_CLOSED'], '2026-10-08T15:10:03.000Z'), true);
    assert.equal(await plans.recordHandoffNotReached(randomUUID(), ['SKIPPED:X'], '2026-10-08T15:10:03.000Z'), false, 'only a READY plan is annotated');
    assert.equal(await plans.claimNext(accountId, 'worker-test', '2026-10-08T15:31:00.000Z'), null, 'the expired plan is never claimed');
    const expired = (await pool.query('SELECT status, last_blockers_json FROM trade.master_paper_action_plan WHERE action_plan_id=$1', [plan.actionPlanId])).rows[0];
    assert.deepEqual(expired, { status: 'QUARANTINED', last_blockers_json: ['DECISION_EXPIRED', 'HANDOFF_NOT_REACHED:SKIPPED:MARKET_CLOSED'] });
    const lastEvent = (await pool.query(`SELECT state, detail_json FROM trade.master_paper_action_plan_event WHERE action_plan_id=$1 ORDER BY event_time DESC, created_at DESC LIMIT 1`,
      [plan.actionPlanId])).rows[0];
    assert.deepEqual(lastEvent?.detail_json?.blockers, ['DECISION_EXPIRED', 'HANDOFF_NOT_REACHED:SKIPPED:MARKET_CLOSED']);
  } finally { await pool.end(); }
});
