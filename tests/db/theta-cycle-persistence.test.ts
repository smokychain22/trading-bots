import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';
import { buildFusionSnapshot, type FusionSnapshotInput } from '../../src/market/fusion-snapshot.js';
import { PostgresThetaCycleStore } from '../../src/theta/postgres-theta-cycle-store.js';
import { normalizeOptionContract } from '../../src/theta/option-contract.js';
import type { ThetaShadowCycleResult } from '../../src/theta/theta-shadow-cycle.js';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');

test('PostgreSQL atomically persists and idempotently replays a complete decision cycle', {
  skip: !process.env.TEST_DATABASE_URL,
}, async () => {
  const connectionString = process.env.TEST_DATABASE_URL;
  assert.ok(connectionString);
  const url = new URL(connectionString);
  assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname), 'Disposable local database only');
  const pool = new Pool({ connectionString: url.toString(), max: 3 });
  const now = '2026-09-11T15:00:00.000Z';
  try {
    const workspaceId = randomUUID(), connectionId = randomUUID(), accountId = randomUUID(), botId = randomUUID();
    const strategyId = randomUUID(), featureId = randomUUID(), riskId = randomUUID(), executionId = randomUUID(), costId = randomUUID();
    await pool.query(`INSERT INTO iam.workspace(workspace_id,name) VALUES($1,$2)`, [workspaceId, `test-${workspaceId}`]);
    await pool.query(`INSERT INTO core.provider_connection(provider_connection_id,workspace_id,provider_code,environment,secret_ref,status)
      VALUES($1,$2,'ALPACA','PAPER',$3,'GOOD')`, [connectionId, workspaceId, `test-${connectionId}`]);
    await pool.query(`INSERT INTO core.trading_account(account_id,workspace_id,provider_connection_id,provider_account_id,environment,status)
      VALUES($1,$2,$3,$4,'PAPER','ACTIVE')`, [accountId, workspaceId, connectionId, `test-${accountId}`]);
    await pool.query(`INSERT INTO core.strategy_version(strategy_version_id,semantic_version,config_json,config_hash,status) VALUES($1,$2,'{}',$3,'TEST')`, [strategyId, `test-${strategyId}`, hash(strategyId)]);
    await pool.query(`INSERT INTO core.feature_version(feature_version_id,semantic_version,definition_manifest_json,config_hash) VALUES($1,$2,'{}',$3)`, [featureId, `test-${featureId}`, hash(featureId)]);
    await pool.query(`INSERT INTO core.risk_limit_version(risk_limit_version_id,semantic_version,limits_json,config_hash,status) VALUES($1,$2,'{}',$3,'TEST')`, [riskId, `test-${riskId}`, hash(riskId)]);
    await pool.query(`INSERT INTO core.execution_version(execution_version_id,semantic_version,policy_json,config_hash,status) VALUES($1,$2,'{}',$3,'TEST')`, [executionId, `test-${executionId}`, hash(executionId)]);
    await pool.query(`INSERT INTO core.cost_model_version(cost_model_version_id,semantic_version,assumptions_json,config_hash,status) VALUES($1,$2,'{}',$3,'TEST')`, [costId, `test-${costId}`, hash(costId)]);
    await pool.query(`INSERT INTO core.bot_instance(bot_instance_id,workspace_id,account_id,mode,strategy_version_id,risk_limit_version_id,execution_version_id,cost_model_version_id,feature_version_id)
      VALUES($1,$2,$3,'SHADOW',$4,$5,$6,$7,$8)`, [botId, workspaceId, accountId, strategyId, riskId, executionId, costId, featureId]);
    const accountSnapshot = await pool.query(`INSERT INTO trade.account_snapshot(account_id,equity,cash,buying_power,options_buying_power,options_level,as_of,retrieved_at)
      VALUES($1,100000,50000,100000,50000,3,$2,$2) RETURNING account_snapshot_id`, [accountId, now]);

    const contract = normalizeOptionContract({
      source: 'ALPACA', underlying: 'SPY', optionSymbol: 'SPY261009P00500000', occSymbol: 'SPY261009P00500000',
      optionType: 'PUT', strike: 500, expiration: '2026-10-09', asOfDate: '2026-09-11', multiplier: 100,
      underlyingBid: 500, underlyingAsk: 500.02, underlyingLast: 500.01, underlyingTimestamp: now,
      bid: 2.5, ask: 2.6, bidSize: 20, askSize: 20, lastTradePrice: 2.5, lastTradeSize: 1,
      quoteTimestamp: now, tradeTimestamp: now, volume: 100, volumeSource: 'ALPACA', openInterest: 1000,
      openInterestSource: 'ALPACA', iv: 0.2, delta: -0.2, gamma: 0.01, theta: -0.03, vega: 0.1, rho: -0.02,
      greeksTimestamp: now, greeksSource: 'ALPACA', feed: 'OPRA', dataQuality: 'GOOD',
      maxQuoteAgeSecondsForExecutable: 60, maxSpreadPctForExecutable: 0.1,
    }, now);
    const snapshotInput: FusionSnapshotInput = {
      botId: 'THETA', decisionTimeUtc: now, triggerType: 'TEST', marketSession: { isOpen: false }, underlyingState: { symbol: 'SPY' },
      contractCandidates: [contract], accountState: { status: 'ACTIVE' }, positionState: { positions: [], orders: [] }, portfolioExposure: {},
      alpacaQuoteState: null, optionomicsFeatureState: null, eventState: null, regimeState: null, expertPriorState: null,
      riskState: null, strategyRouterState: null,
      versions: { strategyVersion: 'test', featureVersion: 'test', riskLimitVersion: 'test', executionVersion: 'test', costModelVersion: 'test', dataVersion: 'test', modelVersions: {} },
      sourceProvenance: [
        { provider: 'ALPACA', operationAlias: 'account', asOf: now, retrievedAt: now, state: 'GOOD', contentHash: hash('account'), feed: null, contractVersion: 'v2', truthRole: 'ACCOUNT', requiredForNewRisk: true },
        { provider: 'ALPACA', operationAlias: 'contracts', asOf: now, retrievedAt: now, state: 'GOOD', contentHash: hash('contracts'), feed: null, contractVersion: 'v2', truthRole: 'CONTRACT', requiredForNewRisk: true },
        { provider: 'ALPACA', operationAlias: 'quotes', asOf: now, retrievedAt: now, state: 'GOOD', contentHash: hash('quotes'), feed: 'OPRA', contractVersion: 'v1', truthRole: 'QUOTE', requiredForNewRisk: true },
      ],
      providerHealth: [{ provider: 'ALPACA', state: 'GOOD', asOf: now, retrievedAt: now }], freshnessFlags: [], unknownFeatures: [],
      executableTruth: { account: 'GOOD', contract: 'GOOD', quote: 'GOOD' },
    };
    const fusion = buildFusionSnapshot(snapshotInput);
    const families = ['THETA_Q','THETA_H','THETA_R','THETA_A','THETA_C','THETA_D'] as const;
    const cycle = {
      runId: randomUUID(), startedAt: now, finishedAt: now, universeFunnel: {}, selectedUnderlying: 'SPY', underlyingRanking: [],
      optionChainComplete: true, optionContractsComplete: true, snapshotContentHash: fusion.contentHash, fusionSnapshot: fusion,
      snapshotValidForNewRisk: true, provenance: 'HYBRID', provenanceDetail: [], blockers: [],
      orchestration: {
        receipt: { decisionId: 'runtime-receipt', snapshotId: fusion.contentHash, fusionSnapshotHash: fusion.contentHash, timestamp: now,
          underlying: 'SPY', winningAction: 'PASS', selectedCandidateId: null, quantity: 0,
          alternatives: [{ candidateId: contract.optionSymbol, disposition: 'PASS', evNet: null, returnPerCapitalDay: null, aegisState: null, quantity: 0, executionRecommendedAction: null, rejectionReason: 'EDGE_UNKNOWN' }], ownershipSnapshotId: null,
          regimeSnapshotId: null, executionAuthorized: false, reasonCodes: ['NO_ELIGIBLE_CANDIDATE'], plainEnglishExplanation: 'No candidate qualified.',
          failClosedReason: null, policyVersion: 'test-policy', modelVersions: {} },
        ownership: null, regime: null,
        routing: { contractVersion: 'theta-strategy-router-runtime-v1', snapshotId: fusion.contentHash, timestamp: now, policyVersion: 'router-v1',
          results: families.map((strategyFamily) => ({ strategyFamily, eligible: false, eligibilityState: 'PASS' as const, reasons: [], policyVersion: 'router-v1' })) },
        thetaQ: { contractVersion: 'theta-q-runtime-v1', fusionSnapshotHash: fusion.contentHash,
          candidates: [{ candidateId: contract.optionSymbol, rank: 1, actionFeasible: false, quantity: 0,
            economics: { max_profit: 250, break_even_price: 497.5, secured_collateral_per_contract: 50000,
              credit_collateral_ratio: 0.005, ev_net: null, ev_net_unknown_reason: 'OUTCOME_PROBABILITY_UNKNOWN' },
            ownershipScore: null, reasons: [{ code: 'EDGE_UNKNOWN', polarity: -1 as const, detail: 'Validated outcome probability is unavailable.' }] }],
          wait: { candidateId: 'WAIT', actionFeasible: true, quantity: 0 },
          recommendation: { actionCode: 'WAIT', selectedCandidateId: 'WAIT', quantity: 0, executionAuthorized: false, requiresAegis: true, requiresFreshAlpacaBbo: true } },
        aegis: null, paretoSurvivorIds: [], opportunityBook: null,
        shadowOpportunities: [{ contractVersion: 'theta-shadow-opportunity-book-v1', opportunityId: `opp-${randomUUID()}`, snapshotId: fusion.contentHash,
          timestamp: now, underlying: 'SPY', contractSymbol: null, strategyBranch: 'THETA_Q', evNet: null, tailAdjustedEv: null,
          returnPerCapitalDay: null, capitalRequired: null, uncertainty: null, ownershipSnapshotId: null, regimeSnapshotId: null,
          aegisState: null, recommendedQuantity: null, executionQualityAcceptable: null, outcome: 'PASS', waitReason: null,
          rejectionCategory: 'NO_ELIGIBLE_CANDIDATE', reasons: [], policyVersion: 'test-policy', modelVersions: {}, eventualOutcomeKnown: false, eventualRealizedPnl: null }],
      },
    } as unknown as ThetaShadowCycleResult;
    const store = new PostgresThetaCycleStore(pool);
    const context = { botInstanceId: botId, universeVersionId: null, strategyVersionId: strategyId, featureVersionId: featureId,
      riskLimitVersionId: riskId, executionVersionId: executionId, costModelVersionId: costId,
      accountSnapshotId: Number(accountSnapshot.rows[0].account_snapshot_id) };
    const first = await store.persist(context, cycle);
    const second = await store.persist(context, cycle);
    assert.equal(first.fusionSnapshotId, second.fusionSnapshotId);
    const counts = await pool.query(`SELECT
      (SELECT count(*) FROM trade.fusion_snapshot WHERE bot_instance_id=$1)::int AS snapshots,
      (SELECT count(*) FROM trade.candidate_set WHERE fusion_snapshot_id=$2)::int AS candidate_sets,
      (SELECT count(*) FROM trade.candidate c JOIN trade.candidate_set cs USING(candidate_set_id) WHERE cs.fusion_snapshot_id=$2)::int AS candidates,
      (SELECT count(*) FROM trade.candidate_reason cr JOIN trade.candidate c USING(candidate_id) JOIN trade.candidate_set cs USING(candidate_set_id) WHERE cs.fusion_snapshot_id=$2)::int AS candidate_reasons,
      (SELECT count(*) FROM trade.decision WHERE fusion_snapshot_id=$2)::int AS decisions,
      (SELECT count(*) FROM trade.strategy_route WHERE fusion_snapshot_id=$2)::int AS routes,
      (SELECT count(*) FROM trade.shadow_opportunity WHERE fusion_snapshot_id=$2)::int AS opportunities`, [botId, first.fusionSnapshotId]);
    assert.deepEqual(counts.rows[0], { snapshots: 1, candidate_sets: 1, candidates: 1, candidate_reasons: 1, decisions: 1, routes: 1, opportunities: 1 });
  } finally { await pool.end(); }
});
