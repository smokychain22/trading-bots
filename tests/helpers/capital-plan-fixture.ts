import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { PersistedPaperOrderIntent } from '../../src/execution/paper-order-coordinator.js';
import { masterPaperActionPlanVersion, type ApprovedMasterPaperActionPlan } from '../../src/execution/master-paper-action-handoff.js';
import { capitalContentHash, type CapitalEnvelope, type CapitalProposal } from '../../src/execution/portfolio-capital-reservation.js';
import { PostgresPortfolioCapitalStore } from '../../src/execution/postgres-portfolio-capital-store.js';
import { testAegisAssessmentIdentity } from '../fixtures/aegis-assessment-identity.js';

export function capitalPlanFixture(intent: PersistedPaperOrderIntent): ApprovedMasterPaperActionPlan {
  const legs = intent.multiLegEvidence?.legs;
  const actionPlanId = randomUUID();
  return { contractVersion: masterPaperActionPlanVersion, actionPlanId, actionGroupId: actionPlanId,
    decisionAuthority: 'NEW_RISK', managementInputSnapshotId: null, managementActionFrontierId: null,
    dependsOnActionPlanId: null, legSequence: 1, executionAccountId: intent.executionAccountId, decisionId: intent.decisionId,
    candidateId: randomUUID(), strategyVersion: 'synthetic-test', strategyBranch: legs ? 'THETA_DEFINED_RISK' : 'THETA_CONVENTIONAL',
    ...(legs ? { strategyPaperAuthorityReceiptHash: 'a'.repeat(64), definedRisk: {
      packageIdentity: intent.multiLegEvidence?.packageIdentity ?? 'INVALID_FIXTURE', structuralNetCreditPerShare: 1.1,
      legs: legs as unknown as NonNullable<ApprovedMasterPaperActionPlan['definedRisk']>['legs'] } } : {}),
    chainId: intent.chainId, optionContractId: intent.optionContractId, underlyingId: intent.underlyingId,
    underlying: 'SPY', optionType: 'PUT', symbol: legs?.[0]?.occSymbol ?? intent.request.symbol,
    quantity: intent.request.qty, canonicalQuantity: intent.authorizationEvidence.canonicalQuantity,
    paperEvidenceQuantity: intent.request.qty, paperEvidenceRiskCap: intent.request.qty,
    paperEvidenceCapReason: 'CANONICAL_QUANTITY_LOWER', firstCanaryCompleted: true, executionTier: 'PAPER_EVIDENCE',
    multiplier: legs?.[0]?.multiplier ?? 100, action: legs ? 'OPEN_DEFINED_RISK' : 'OPEN_CSP', economicBoundary: 0.01,
    economicsRemainPositive: true, expectedAfterCostEv: null, empiricalEconomicsReady: false,
    selectedByCanonicalAuthority: true, hardValidityPassed: true, accountVerified: true, optionsCapabilityVerified: true,
    noEquivalentExposureConflict: true, aegisState: 'ALLOW_FULL', aegisAssessmentIdentity: testAegisAssessmentIdentity(),
    killSwitchActive: false, decisionExpiresAt: intent.executionEvidence.decisionExpiresAt,
    pricingPolicy: { waitIntervalMs: 5000, maxAttempts: 3, concessionFractions: [0,0.5,1], tickSize: 0.01 },
    pricingAttempt: 0, previousLimit: null };
}

/** Upstream synthetic fixture for native-lifecycle tests, NOT qualification
 * evidence. Those tests already relax unrelated decision FKs. The actual
 * intent transaction and reservation binding run with their real stores. */
export async function seedCapitalPlanForIntent(pool: Pool, intent: PersistedPaperOrderIntent,
  plan = capitalPlanFixture(intent)): Promise<ApprovedMasterPaperActionPlan> {
  const target = new URL(process.env.TEST_DATABASE_URL ?? 'invalid');
  const db = await pool.query('SELECT current_database() AS db');
  if (!['127.0.0.1','localhost'].includes(target.hostname) || target.pathname !== `/${db.rows[0]?.db}`
    || !/^(trading_bots|theta_phase2_recovery_ci|theta_v4_binding_\d+)$/.test(db.rows[0]?.db)) throw new Error('SYNTHETIC_CAPITAL_FIXTURE_LOCAL_ONLY');
  const accountHash = capitalContentHash(intent.executionAccountId), hash = 'a'.repeat(64);
  const available = { CASH:'10000000',BROKER:'10000000',PORTFOLIO:'10000000',ASSIGNMENT:'10000000',
    'TICKER:SPY':'10000000','SECTOR:TEST':'10000000','CORRELATION:TEST':'10000000' };
  const envelope: CapitalEnvelope = { envelopeId:randomUUID(),executionAccountId:intent.executionAccountId,
    observedAt:intent.persistedAt,expiresAt:intent.executionEvidence.decisionExpiresAt,evidenceHash:hash,
    available,reflected:{},policyVersion:'synthetic-test',qualification:{producerVersion:'theta-account-capital-csp-v1',
      accountHash,policyHash:hash,inputHash:hash,receiptHash:hash,observationHash:hash,sourceEvidenceHashes:[hash,hash,hash],
      usedByDimension:{},softLimitByDimension:{},retainedReasons:[],aegisReassessmentRequired:true,brokerAuthority:false} };
  const proposal: CapitalProposal = { reservationId:plan.actionPlanId,proposalRef:plan.actionPlanId,
    decisionId:plan.decisionId,candidateRef:plan.candidateId,strategy:plan.strategyBranch as CapitalProposal['strategy'],
    quantity:plan.quantity,canonicalMaximumQuantity:plan.canonicalQuantity,quoteExpiresAt:plan.decisionExpiresAt,
    perUnit:Object.fromEntries(Object.keys(available).map(k=>[k,'500'])),authorityHash:capitalContentHash(plan) };
  await pool.query(`INSERT INTO trade.execution_account(execution_account_id,account_kind,provider_account_ref_hash,
    provider_account_ref_masked,account_ready) VALUES($1,'MASTER_API_KEY',$2,'synthetic',true) ON CONFLICT DO NOTHING`,
  [intent.executionAccountId,accountHash]);
  await new PostgresPortfolioCapitalStore(pool).reserve(envelope,[proposal],intent.persistedAt);
  await pool.query(`INSERT INTO trade.master_paper_action_plan(action_plan_id,decision_id,execution_account_id,
    plan_version,status,plan_json,content_hash,not_before,execution_tier,canonical_quantity,paper_evidence_quantity,
    empirical_economics_ready,expected_after_cost_ev,authority_kind,action_group_id,leg_sequence,created_at,updated_at)
    VALUES($1,$2,$3,$4,'READY',$5,$6,$7,'PAPER_EVIDENCE',$8,$9,false,NULL,'NEW_RISK',$1,1,$7,$7)`,
  [plan.actionPlanId,plan.decisionId,plan.executionAccountId,plan.contractVersion,JSON.stringify(plan),capitalContentHash(plan),
    intent.persistedAt,plan.canonicalQuantity,plan.quantity]);
  return plan;
}
