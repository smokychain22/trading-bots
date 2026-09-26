import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';
import { buildFusionSnapshot, type FusionSnapshotInput } from '../../src/market/fusion-snapshot.js';
import { PostgresThetaCycleStore } from '../../src/theta/postgres-theta-cycle-store.js';
import { PostgresOutcomeResolver } from '../../src/research/outcome-resolver.js';
import { PostgresDatasetExporter } from '../../src/research/postgres-dataset-export.js';
import { normalizeOptionContract } from '../../src/theta/option-contract.js';
import { buildCanonicalStrategyFrontier } from '../../src/theta/canonical-strategy-frontier.js';
import type { StrategyRoutingResponse } from '../../src/theta/strategy-router-contract.js';
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
      contractTradable: true, exerciseStyle: 'AMERICAN', deliverableClassification: 'STANDARD_EQUITY',
      underlyingBid: 500, underlyingAsk: 500.02, underlyingLast: 500.01, underlyingTimestamp: now,
      underlyingQuoteReceivedAt: now, underlyingQuoteSource: 'ALPACA_IEX',
      bid: 2.5, ask: 2.6, bidSize: 20, askSize: 20, lastTradePrice: 2.5, lastTradeSize: 1,
      quoteTimestamp: now, tradeTimestamp: now, volume: 100, volumeSource: 'ALPACA', openInterest: 1000,
      openInterestSource: 'ALPACA', iv: 0.2, delta: -0.2, gamma: 0.01, theta: -0.03, vega: 0.1, rho: -0.02,
      greeksTimestamp: now, greeksSource: 'ALPACA', feed: 'OPRA', dataQuality: 'GOOD',
      maxQuoteAgeSecondsForExecutable: 60, maxSpreadPctForExecutable: 0.1,
    }, now);
    const researchContract = (optionSymbol: string, strike: number, expiration: string, bid: number) =>
      normalizeOptionContract({
        source: 'ALPACA', underlying: 'SPY', optionSymbol, occSymbol: optionSymbol,
        optionType: 'PUT', strike, expiration, asOfDate: '2026-09-11', multiplier: 100,
        contractTradable: true, exerciseStyle: 'AMERICAN', deliverableClassification: 'STANDARD_EQUITY',
        underlyingBid: 500, underlyingAsk: 500.02, underlyingLast: 500.01, underlyingTimestamp: now,
        bid, ask: bid + 0.1, bidSize: 20, askSize: 20, lastTradePrice: bid, lastTradeSize: 1,
        quoteTimestamp: now, tradeTimestamp: now, volume: 100, volumeSource: 'ALPACA', openInterest: 1000,
        openInterestSource: 'ALPACA', iv: 0.2, delta: -0.2, gamma: 0.01, theta: -0.03, vega: 0.1,
        rho: -0.02, greeksTimestamp: now, greeksSource: 'ALPACA', feed: 'INDICATIVE', dataQuality: 'GOOD',
        maxQuoteAgeSecondsForExecutable: 60, maxSpreadPctForExecutable: 0.1,
      }, now);
    const researchContracts = [
      researchContract('SPY260914P00500000', 500, '2026-09-14', 1.2),
      researchContract('SPY260921P00500000', 500, '2026-09-21', 2.2),
      researchContract('SPY260921P00490000', 490, '2026-09-21', 0.3),
    ];
    const snapshotInput: FusionSnapshotInput = {
      botId: 'THETA', decisionTimeUtc: now, triggerType: 'TEST', marketSession: { isOpen: false }, underlyingState: { symbol: 'SPY' },
      contractCandidates: [contract, ...researchContracts], accountState: { status: 'ACTIVE' }, positionState: { positions: [], orders: [] }, portfolioExposure: {},
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
    const routing = {
      contractVersion: 'theta-strategy-router-runtime-v1', snapshotId: fusion.contentHash, timestamp: now, policyVersion: 'router-v1',
      results: families.map((strategyFamily) => ({ strategyFamily, eligible: strategyFamily === 'THETA_Q', eligibilityState: 'PASS' as const, reasons: [], policyVersion: 'router-v1' })),
    } satisfies StrategyRoutingResponse;
    const strategyFrontier = buildCanonicalStrategyFrontier({
      snapshotId: fusion.contentHash, timestamp: now, strategyVersion: 'test-strategy-package', contracts: [contract, ...researchContracts], routing,
      stock: null, assignmentCapacityQty: 1, buyingPower: 100_000, brokerAllowedQty: 1,
      sizingPolicy: { riskBudgetQtyCap: 0, collateralQtyCap: 1, concentrationQtyCap: 1,
        assignmentCapacityQtyCap: 1, tailRiskQtyCap: 1, correlationQtyCap: 1, liquidityQtyCap: 1,
        reducedStateMultiplier: 0.5 },
      aegisNewRiskState: 'ALLOW_FULL', eventState: 'CLEAR', unmanagedBrokerPositionCount: 0,
      unevaluatedUnderlyingCount: 0, optionomicsContext: null,
    });
    const cycle = {
      runId: randomUUID(), startedAt: now, finishedAt: now, universeFunnel: {}, selectedUnderlying: 'SPY', underlyingRanking: [],
      optionChainComplete: true, optionContractsComplete: true, snapshotContentHash: fusion.contentHash, fusionSnapshot: fusion,
      snapshotValidForNewRisk: true, provenance: 'HYBRID', provenanceDetail: [], blockers: [],
      strategyFrontier,
      orchestration: {
        receipt: { decisionId: 'runtime-receipt', snapshotId: fusion.contentHash, fusionSnapshotHash: fusion.contentHash, timestamp: now,
          underlying: 'SPY', winningAction: 'PASS', selectedCandidateId: null, quantity: 0,
          alternatives: [{ candidateId: contract.optionSymbol, disposition: 'PASS', evNet: null, returnPerCapitalDay: null, aegisState: null, quantity: 0, executionRecommendedAction: null, rejectionReason: 'EDGE_UNKNOWN' }], ownershipSnapshotId: null,
          regimeSnapshotId: null, executionAuthorized: false, reasonCodes: ['NO_ELIGIBLE_CANDIDATE'], plainEnglishExplanation: 'No candidate qualified.',
          failClosedReason: null, policyVersion: 'test-policy', modelVersions: {} },
        ownership: null, regime: null,
        routing,
        thetaQ: { contractVersion: 'theta-q-runtime-v1', fusionSnapshotHash: fusion.contentHash,
          candidates: [{ candidateId: contract.optionSymbol, rank: 1, actionFeasible: false, quantity: 0,
            economics: { max_profit: 250, break_even_price: 497.5, secured_collateral_per_contract: 50000,
              credit_collateral_ratio: 0.005, ev_net: null, ev_net_unknown_reason: 'OUTCOME_PROBABILITY_UNKNOWN',
              commission_per_contract: 0.65, fees_per_contract: 0.05, est_slippage_per_contract: 1.0, cost_model_version: 'TEST-COST-1' },
            ownershipScore: null, eligibilityBasis: 'INELIGIBLE' as const, paperBootstrapPolicyVersion:null,
            paperBootstrapAllowedUnknownComponents:[],paperBootstrapReasonCodes:[],
            reasons: [{ code: 'EDGE_UNKNOWN', polarity: -1 as const, detail: 'Validated outcome probability is unavailable.' }] }],
          wait: { candidateId: 'WAIT', actionFeasible: true, quantity: 0 },
          recommendation: { actionCode: 'WAIT', selectedCandidateId: 'WAIT', quantity: 0, executionAuthorized: false, requiresAegis: true, requiresFreshAlpacaBbo: true } },
        aegis: null, paretoSurvivorIds: [], opportunityBook: null,
        shadowOpportunities: [{ contractVersion: 'theta-shadow-opportunity-book-v1', opportunityId: `opp-${randomUUID()}`, snapshotId: fusion.contentHash,
          timestamp: now, underlying: 'SPY', contractSymbol: null, strategyBranch: 'THETA_Q', evNet: null, tailAdjustedEv: null,
          returnPerCapitalDay: null, capitalRequired: null, uncertainty: null, ownershipSnapshotId: null, regimeSnapshotId: null,
          aegisState: null, recommendedQuantity: null, executionQualityAcceptable: null, outcome: 'PASS', waitReason: null,
          rejectionCategory: 'NO_ELIGIBLE_CANDIDATE', reasons: [], policyVersion: 'test-policy', modelVersions: {}, eventualOutcomeKnown: false, eventualRealizedPnl: null },
        { contractVersion: 'theta-shadow-opportunity-book-v1', opportunityId: `opp-${randomUUID()}`, snapshotId: fusion.contentHash,
          timestamp: now, underlying: 'SPY', contractSymbol: 'SPY261009P00500000', strategyBranch: 'THETA_Q', evNet: null, tailAdjustedEv: null,
          returnPerCapitalDay: null, capitalRequired: null, uncertainty: null, ownershipSnapshotId: null, regimeSnapshotId: null,
          aegisState: null, recommendedQuantity: null, executionQualityAcceptable: null, outcome: 'PASS', waitReason: null,
          rejectionCategory: 'EDGE_UNKNOWN', reasons: [{ code: 'EDGE_UNKNOWN' }], policyVersion: 'test-policy', modelVersions: {}, eventualOutcomeKnown: false, eventualRealizedPnl: null }],
      },
    } as unknown as ThetaShadowCycleResult;
    const store = new PostgresThetaCycleStore(pool);
    const context = { botInstanceId: botId, universeVersionId: null, strategyVersionId: strategyId, featureVersionId: featureId,
      riskLimitVersionId: riskId, executionVersionId: executionId, costModelVersionId: costId,
      accountSnapshotId: Number(accountSnapshot.rows[0].account_snapshot_id) };
    const first = await store.persist(context, cycle);
    const second = await store.persist(context, cycle);
    assert.equal(first.fusionSnapshotId, second.fusionSnapshotId);
    assert.equal(first.shadowOpportunityCount, 2);
    assert.equal(second.shadowOpportunityCount, 0);
    const storedFrontier = await pool.query(`SELECT frontier_json FROM trade.canonical_strategy_frontier WHERE fusion_snapshot_id=$1`,
      [first.fusionSnapshotId]);
    assert.equal(storedFrontier.rows.length, 1);
    const shadow = storedFrontier.rows[0].frontier_json.adaptiveShadowDecision;
    assert.equal(shadow.contractVersion, 'theta-adaptive-decision-brain-shadow-v3');
    assert.equal(shadow.shadowComparison.version, 'theta-canonical-shadow-comparison-v1');
    assert.equal(shadow.shadowComparison.brokerAuthority, false);
    assert.equal(shadow.adaptiveShadowDecision.candidateId, null);
    assert.equal(shadow.shadowComparison.profitabilityWinner, null);
    assert.ok(shadow.shadowComparison.cohorts.length > 0, 'persisted structural economics must be reloadable');
    assert.ok(shadow.contentHash.length === 64);
    const resolver=new PostgresOutcomeResolver(pool);
    const materialized=await resolver.materializeEligibleSubjects();
    const replayed=await resolver.materializeEligibleSubjects();
    assert.ok(materialized.strategy>0,'strategy subjects must be reachable from a persisted PIT frontier');
    assert.ok(materialized.wait>0,'formal WAIT subjects must be reachable from persisted WAIT evidence');
    assert.equal(Object.values(replayed).reduce((sum,value)=>sum+value,0),0,'subject materialization must be idempotent');
    const counts = await pool.query(`SELECT
      (SELECT count(*) FROM trade.fusion_snapshot WHERE bot_instance_id=$1)::int AS snapshots,
      (SELECT count(*) FROM trade.candidate_set WHERE fusion_snapshot_id=$2)::int AS candidate_sets,
      (SELECT count(*) FROM trade.candidate c JOIN trade.candidate_set cs USING(candidate_set_id) WHERE cs.fusion_snapshot_id=$2)::int AS candidates,
      (SELECT count(*) FROM trade.candidate_reason cr JOIN trade.candidate c USING(candidate_id) JOIN trade.candidate_set cs USING(candidate_set_id) WHERE cs.fusion_snapshot_id=$2)::int AS candidate_reasons,
      (SELECT count(*) FROM market.option_quote_snapshot q JOIN trade.candidate c ON c.option_quote_snapshot_id=q.snapshot_id
        JOIN trade.candidate_set cs USING(candidate_set_id) WHERE cs.fusion_snapshot_id=$2)::int AS linked_quotes,
      (SELECT count(*) FROM trade.decision WHERE fusion_snapshot_id=$2)::int AS decisions,
      (SELECT count(*) FROM trade.strategy_route WHERE fusion_snapshot_id=$2)::int AS routes,
      (SELECT count(*) FROM trade.shadow_opportunity WHERE fusion_snapshot_id=$2)::int AS opportunities,
      (SELECT count(*) FROM trade.canonical_strategy_branch_evidence WHERE fusion_snapshot_id=$2)::int AS canonical_branches,
      (SELECT count(*) FROM trade.canonical_strategy_candidate_evidence c
        JOIN trade.canonical_strategy_branch_evidence b USING(branch_evidence_id) WHERE b.fusion_snapshot_id=$2)::int AS canonical_candidates`,
      [botId, first.fusionSnapshotId]);
    assert.deepEqual(counts.rows[0], { snapshots: 1, candidate_sets: 1, candidates: 1, candidate_reasons: 1, linked_quotes: 1, decisions: 1,
      routes: 1, opportunities: 2, canonical_branches: 5, canonical_candidates: 3 });
    const researchEvidence = await pool.query(`SELECT c.branch::text,c.candidate_ref,c.hard_blockers_json
      FROM trade.canonical_strategy_candidate_evidence c
      JOIN trade.canonical_strategy_branch_evidence b USING(branch_evidence_id)
      WHERE b.fusion_snapshot_id=$1 AND c.branch IN ('THETA_HOLD_STRIKE','THETA_DEFINED_RISK')
      ORDER BY c.branch,c.candidate_ref`, [first.fusionSnapshotId]);
    assert.equal(researchEvidence.rows.length, 2);
    for (const row of researchEvidence.rows) {
      assert.ok((row.hard_blockers_json as string[]).includes('ROUTER_NOT_APPLICABLE'));
    }
    const quotes = await pool.query(`SELECT q.as_of::text,q.retrieved_at::text,q.feed,q.quality::text,q.bid::text,q.ask::text
      FROM market.option_quote_snapshot q JOIN trade.candidate c ON c.option_quote_snapshot_id=q.snapshot_id
      JOIN trade.candidate_set cs USING(candidate_set_id) WHERE cs.fusion_snapshot_id=$1`, [first.fusionSnapshotId]);
    assert.equal(quotes.rows.length, 1, 'replaying a cycle must not duplicate the same broker quote');
    assert.equal(new Date(quotes.rows[0].as_of).toISOString(), now);
    assert.equal(new Date(quotes.rows[0].retrieved_at).toISOString(), now);
    assert.equal(quotes.rows[0].feed, 'OPRA');
    assert.equal(quotes.rows[0].quality, 'GOOD');
    assert.equal(Number(quotes.rows[0].bid), 2.5);
    assert.equal(Number(quotes.rows[0].ask), 2.6);
    const ivLineage = await pool.query(`SELECT volatility_json,market_json
      FROM trade.candidate_point_in_time_evidence WHERE fusion_snapshot_id=$1`, [first.fusionSnapshotId]);
    assert.ok(ivLineage.rows.length > 0);
    const proven = ivLineage.rows.find((row) => row.volatility_json?.ivSource === 'ALPACA');
    assert.ok(proven, 'new IV evidence must retain its actual Alpaca source');
    assert.equal(proven.volatility_json.ivEvidenceAuthority, 'ALPACA_OPTION_SNAPSHOT_CONTRACT_IV');
    assert.equal(proven.volatility_json.ivProviderTimestamp, null);
    assert.equal(proven.market_json.underlyingQuoteSource, 'ALPACA_IEX');
    assert.equal(proven.market_json.underlyingQuoteReceivedAt, now);
    const exported = await new PostgresDatasetExporter(pool).export({start:now,
      end:'2026-09-11T15:01:00.000Z',exportedAt:new Date().toISOString(),featureSetVersion:'test-v1'});
    assert.ok(exported.rowCounts.candidates > 0);
    assert.equal(exported.rowCounts.entryChainLinks, 0, 'WAIT decisions and candidate scans cannot manufacture entry links');
  } finally { await pool.end(); }
});
