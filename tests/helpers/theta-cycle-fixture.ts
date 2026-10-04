// A real THETA cycle (fusion snapshot, canonical frontier, orchestration receipt) over a chain of any size, for real-PostgreSQL writer tests.
// Mirrors tests/db/theta-cycle-persistence.test.ts but evaluates EVERY contract as a ranked thetaQ candidate so the point-in-time writer sees a full decision.
import { createHash, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { buildFusionSnapshot, type FusionSnapshotInput } from '../../src/market/fusion-snapshot.js';
import { normalizeOptionContract } from '../../src/theta/option-contract.js';
import { buildCanonicalStrategyFrontier } from '../../src/theta/canonical-strategy-frontier.js';
import type { StrategyRoutingResponse } from '../../src/theta/strategy-router-contract.js';
import type { ThetaShadowCycleResult } from '../../src/theta/theta-shadow-cycle.js';
import { flatPortfolioExposure } from './flat-portfolio-exposure.js';

const hash = (value: string): string => createHash('sha256').update(value).digest('hex');

export interface CycleWorld {
  readonly botId: string; readonly strategyId: string; readonly featureId: string; readonly riskId: string; readonly executionId: string; readonly costId: string; readonly accountSnapshotId: number;
}

export async function seedWorld(pool: Pool, at: string): Promise<CycleWorld> {
  const workspaceId = randomUUID(), connectionId = randomUUID(), accountId = randomUUID(), botId = randomUUID();
  const strategyId = randomUUID(), featureId = randomUUID(), riskId = randomUUID(), executionId = randomUUID(), costId = randomUUID();
  await pool.query('INSERT INTO iam.workspace(workspace_id,name) VALUES($1,$2)', [workspaceId, `test-${workspaceId}`]);
  await pool.query(`INSERT INTO core.provider_connection(provider_connection_id,workspace_id,provider_code,environment,secret_ref,status) VALUES($1,$2,'ALPACA','PAPER',$3,'GOOD')`, [connectionId, workspaceId, `test-${connectionId}`]);
  await pool.query(`INSERT INTO core.trading_account(account_id,workspace_id,provider_connection_id,provider_account_id,environment,status) VALUES($1,$2,$3,$4,'PAPER','ACTIVE')`, [accountId, workspaceId, connectionId, `test-${accountId}`]);
  await pool.query(`INSERT INTO core.strategy_version(strategy_version_id,semantic_version,config_json,config_hash,status) VALUES($1,$2,'{}',$3,'TEST')`, [strategyId, `test-${strategyId}`, hash(strategyId)]);
  await pool.query(`INSERT INTO core.feature_version(feature_version_id,semantic_version,definition_manifest_json,config_hash) VALUES($1,$2,'{}',$3)`, [featureId, `test-${featureId}`, hash(featureId)]);
  await pool.query(`INSERT INTO core.risk_limit_version(risk_limit_version_id,semantic_version,limits_json,config_hash,status) VALUES($1,$2,'{}',$3,'TEST')`, [riskId, `test-${riskId}`, hash(riskId)]);
  await pool.query(`INSERT INTO core.execution_version(execution_version_id,semantic_version,policy_json,config_hash,status) VALUES($1,$2,'{}',$3,'TEST')`, [executionId, `test-${executionId}`, hash(executionId)]);
  await pool.query(`INSERT INTO core.cost_model_version(cost_model_version_id,semantic_version,assumptions_json,config_hash,status) VALUES($1,$2,'{}',$3,'TEST')`, [costId, `test-${costId}`, hash(costId)]);
  await pool.query(`INSERT INTO core.bot_instance(bot_instance_id,workspace_id,account_id,mode,strategy_version_id,risk_limit_version_id,execution_version_id,cost_model_version_id,feature_version_id) VALUES($1,$2,$3,'SHADOW',$4,$5,$6,$7,$8)`, [botId, workspaceId, accountId, strategyId, riskId, executionId, costId, featureId]);
  const snapshot = await pool.query(`INSERT INTO trade.account_snapshot(account_id,equity,cash,buying_power,options_buying_power,options_level,as_of,retrieved_at) VALUES($1,100000,50000,100000,50000,3,$2,$2) RETURNING account_snapshot_id`, [accountId, at]);
  return { botId, strategyId, featureId, riskId, executionId, costId, accountSnapshotId: Number(snapshot.rows[0].account_snapshot_id) };
}

export const persistenceContext = (world: CycleWorld) => ({ botInstanceId: world.botId, universeVersionId: null, strategyVersionId: world.strategyId, featureVersionId: world.featureId,
  riskLimitVersionId: world.riskId, executionVersionId: world.executionId, costModelVersionId: world.costId, accountSnapshotId: world.accountSnapshotId, releaseIdentity: { sourceSha: 'a'.repeat(40), workerSha: 'b'.repeat(40) } });

/** `contractCount` contracts, each one evaluated as a ranked candidate; `at` makes the decision (and its fusion snapshot) unique. */
export interface CycleRichness { /** KiB of decision-wide Optionomics context (volatility surface, provider metrics, heatmap) shared by every candidate; 0 = none */ readonly sharedKiB: number; /** identical keys give byte-identical raw provider payloads in different cycles (payload dedupe); default: unique per cycle */ readonly payloadKey?: string }

/** Production-shaped Optionomics feature state: one decision-wide surface/provider context plus per-contract entries. */
function optionomicsState(contracts: readonly { occSymbol: string; strike: number }[], sharedKiB: number, at: string, payloadKey: string): Record<string, unknown> | null {
  if (sharedKiB <= 0) return null;
  const payload = { chain: Array.from({ length: 40 }, (_, index) => ({ key: payloadKey, strike: 300 + index, oi: (index * 37) % 1000, iv: Number((0.1 + ((index * 13) % 40) / 100).toFixed(3)) })) };
  const rawObservation = { operationAlias: 'optionomics.get_option_chain', responseHash: createHash('sha256').update(JSON.stringify(payload)).digest('hex'), retrievedAt: at, requestedAt: at, requestPath: '/v1/options/chain', requestParameters: { ticker: 'SPY' }, httpStatus: 200, rateLimit: {}, documentationReference: 'fixture', credentialIdentityRefHash: null, sessionDate: at.slice(0, 10), contractVersion: 'optionomics-fixture-v1', payload };
  const surface = Array.from({ length: Math.max(1, Math.ceil((sharedKiB * 1024) / 120)) }, (_, index) => ({ expiration: `2027-${String(1 + (index % 12)).padStart(2, '0')}-15`, strike: 300 + (index % 400), iv: Number((0.15 + (index % 40) / 200).toFixed(4)), skew: Number((((index * 7) % 30) / 100).toFixed(4)), source: 'OPTIONOMICS' }));
  return { schemaVersion: 'theta-optionomics-features-v1', netFlowWindows: [], rawObservation, features: { schemaVersion: 'theta-optionomics-features-v1', volatilitySurface: surface, skew: { points: surface.slice(0, 20) }, termStructure: { points: surface.slice(0, 12) },
    providerContext: { metrics: { ivRank: 0.42, ivPercentile: 0.51, gammaExposure: -1.2e9, putCallRatio: 0.9 }, exposureHeatmap: { cells: surface.slice(0, Math.floor(surface.length / 3)) }, flowAggregates: { netPremium: -1200000, windows: [1, 4, 24] } },
    unavailableFamilies: [], contracts: contracts.map((contract) => ({ contractSymbol: contract.occSymbol, volatility: { iv: 0.2 + (contract.strike % 17) / 200, vega: 0.1 }, marketStructure: { openInterest: 1000 + contract.strike } })) } };
}

function seededRandom(initial: number): () => number { let a = initial >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export function buildCycle(contractCount: number, at: string, richness: CycleRichness = { sharedKiB: 60 }, seed = 1): ThetaShadowCycleResult {
  const random = seededRandom(seed * 7919 + contractCount);
  const asOfDate = at.slice(0, 10);
  const make = (symbol: string, strike: number, expiration: string, bid: number, feed: 'OPRA' | 'INDICATIVE') => normalizeOptionContract({
    source: 'ALPACA', underlying: 'SPY', optionSymbol: symbol, occSymbol: symbol, optionType: 'PUT', strike, expiration, asOfDate, multiplier: 100,
    contractTradable: true, exerciseStyle: 'AMERICAN', deliverableClassification: 'STANDARD_EQUITY', underlyingBid: 500, underlyingAsk: 500.02, underlyingLast: 500.01, underlyingTimestamp: at,
    underlyingQuoteReceivedAt: at, underlyingQuoteSource: 'ALPACA_IEX', bid, ask: Math.round((bid + 0.1) * 100) / 100, bidSize: 20, askSize: 20, lastTradePrice: bid, lastTradeSize: 1, quoteTimestamp: at, tradeTimestamp: at,
    volume: Math.floor(random() * 5000), volumeSource: 'ALPACA', openInterest: Math.floor(random() * 50000), openInterestSource: 'ALPACA', iv: Number((0.1 + random() * 0.5).toFixed(4)), delta: Number((-random()).toFixed(4)), gamma: Number((random() * 0.05).toFixed(5)), theta: Number((-random() * 0.2).toFixed(5)), vega: Number((random() * 0.5).toFixed(5)), rho: Number((-random() * 0.1).toFixed(5)), greeksTimestamp: at, greeksSource: 'ALPACA',
    feed, dataQuality: 'GOOD', maxQuoteAgeSecondsForExecutable: 60, maxSpreadPctForExecutable: 0.1,
  }, at);
  const contracts = Array.from({ length: contractCount }, (_, index) => {
    const strike = 300 + (index % 400); const day = 1 + (index % 28);
    const symbol = `SPY${String(26).padStart(2, '0')}${String(1 + (index % 12)).padStart(2, '0')}${String(day).padStart(2, '0')}P${String(strike * 1000 + Math.floor(index / 400)).padStart(8, '0')}`;
    return make(symbol, strike, `2027-${String(1 + (index % 12)).padStart(2, '0')}-${String(day).padStart(2, '0')}`, Math.round((0.2 + (index % 50) / 20) * 100) / 100, index % 2 === 0 ? 'OPRA' : 'INDICATIVE');
  });
  const unique = [...new Map(contracts.map((contract) => [contract.optionSymbol, contract])).values()];
  const snapshotInput: FusionSnapshotInput = {
    botId: 'THETA', decisionTimeUtc: at, triggerType: 'TEST', marketSession: { isOpen: false }, underlyingState: { symbol: 'SPY' }, contractCandidates: unique, accountState: { status: 'ACTIVE' },
    positionState: { positions: [], orders: [] }, portfolioExposure: flatPortfolioExposure(), alpacaQuoteState: null, optionomicsFeatureState: optionomicsState(unique, richness.sharedKiB, at, richness.payloadKey ?? `${at}:${seed}`) as FusionSnapshotInput['optionomicsFeatureState'], eventState: null, regimeState: null, expertPriorState: null,
    riskState: null, strategyRouterState: null,
    versions: { strategyVersion: 'test', featureVersion: 'test', riskLimitVersion: 'test', executionVersion: 'test', costModelVersion: 'test', dataVersion: 'test', modelVersions: {} },
    sourceProvenance: [
      { provider: 'ALPACA', operationAlias: 'account', asOf: null, retrievedAt: at, state: 'GOOD', contentHash: hash('account'), feed: null, contractVersion: 'v2', truthRole: 'ACCOUNT', requiredForNewRisk: true },
      { provider: 'ALPACA', operationAlias: 'contracts', asOf: at, retrievedAt: at, state: 'GOOD', contentHash: hash('contracts'), feed: null, contractVersion: 'v2', truthRole: 'CONTRACT', requiredForNewRisk: true },
      { provider: 'ALPACA', operationAlias: 'quotes', asOf: at, retrievedAt: at, state: 'GOOD', contentHash: hash('quotes'), feed: 'OPRA', contractVersion: 'v1', truthRole: 'QUOTE', requiredForNewRisk: true },
    ],
    providerHealth: [{ provider: 'ALPACA', state: 'GOOD', asOf: at, retrievedAt: at }], freshnessFlags: [], unknownFeatures: [], executableTruth: { account: 'GOOD', contract: 'GOOD', quote: 'GOOD' },
  };
  const fusion = buildFusionSnapshot(snapshotInput);
  const families = ['THETA_Q', 'THETA_H', 'THETA_R', 'THETA_A', 'THETA_C', 'THETA_D'] as const;
  const routing = { contractVersion: 'theta-strategy-router-runtime-v1', snapshotId: fusion.contentHash, timestamp: at, policyVersion: 'router-v1',
    results: families.map((strategyFamily) => ({ strategyFamily, eligible: strategyFamily === 'THETA_Q', eligibilityState: 'PASS' as const, reasons: [], policyVersion: 'router-v1' })) } satisfies StrategyRoutingResponse;
  const canonicalFrontierInput = { snapshotId: fusion.contentHash, timestamp: at, strategyVersion: 'test-strategy-package', contracts: unique, routing, stock: null, assignmentCapacityQty: 1,
    buyingPower: 100_000, brokerAllowedQty: 1, sizingPolicy: { riskBudgetQtyCap: 0, collateralQtyCap: 1, concentrationQtyCap: 1, assignmentCapacityQtyCap: 1, tailRiskQtyCap: 1, correlationQtyCap: 1, liquidityQtyCap: 1, reducedStateMultiplier: 0.5 },
    aegisNewRiskState: 'ALLOW_FULL', eventState: 'CLEAR', unmanagedBrokerPositionCount: 0, unevaluatedUnderlyingCount: 0, optionomicsContext: null };
  const strategyFrontier = buildCanonicalStrategyFrontier(canonicalFrontierInput as Parameters<typeof buildCanonicalStrategyFrontier>[0]);
  const economics = { max_profit: 250, break_even_price: 497.5, secured_collateral_per_contract: 50000, credit_collateral_ratio: 0.005, ev_net: null, ev_net_unknown_reason: 'OUTCOME_PROBABILITY_UNKNOWN', commission_per_contract: 0.65, fees_per_contract: 0.05, est_slippage_per_contract: 1.0, cost_model_version: 'TEST-COST-1' };
  return {
    runId: randomUUID(), startedAt: at, finishedAt: at, universeFunnel: {}, selectedUnderlying: 'SPY', underlyingRanking: [], optionChainComplete: true, optionContractsComplete: true, snapshotContentHash: fusion.contentHash,
    fusionSnapshot: fusion, snapshotValidForNewRisk: true, provenance: 'HYBRID', provenanceDetail: [], blockers: [], strategyFrontier, canonicalFrontierInput, methodInputProvenance: [],
    orchestration: {
      receipt: { decisionId: 'runtime-receipt', snapshotId: fusion.contentHash, fusionSnapshotHash: fusion.contentHash, timestamp: at, underlying: 'SPY', winningAction: 'PASS', selectedCandidateId: null, quantity: 0,
        alternatives: unique.slice(0, 200).map((contract) => ({ candidateId: contract.optionSymbol, disposition: 'PASS', evNet: null, returnPerCapitalDay: null, aegisState: null, quantity: 0, executionRecommendedAction: null, rejectionReason: 'EDGE_UNKNOWN' })),
        ownershipSnapshotId: null, regimeSnapshotId: null, executionAuthorized: false, reasonCodes: ['NO_ELIGIBLE_CANDIDATE'], plainEnglishExplanation: 'No candidate qualified.', failClosedReason: null, policyVersion: 'test-policy', modelVersions: {} },
      ownership: { contractVersion: 'theta-ownership-runtime-v1', snapshotId: fusion.contentHash, underlyingSymbol: 'SPY', timestamp: at, policyVersion: 'test-ownership', ownability: null, thesisInvalidated: false, reasons: [],
        components: ['LiquidityQuality', 'StructuralQuality', 'RecoveryQuality', 'TailQuality', 'EventAdjustment'].map((name) => ({ name, value: null, status: 'TEST', reasons: [] })) }, regime: null, routing,
      thetaQ: { contractVersion: 'theta-q-runtime-v1', fusionSnapshotHash: fusion.contentHash,
        candidates: unique.map((contract, index) => ({ candidateId: contract.optionSymbol, rank: index + 1, actionFeasible: false, quantity: 0, economics, ownershipScore: null, eligibilityBasis: 'INELIGIBLE' as const,
          paperBootstrapPolicyVersion: null, paperBootstrapAllowedUnknownComponents: [], paperBootstrapReasonCodes: [], reasons: [{ code: 'EDGE_UNKNOWN', polarity: -1 as const, detail: 'Validated outcome probability is unavailable.' }] })),
        wait: { candidateId: 'WAIT', actionFeasible: true, quantity: 0 }, recommendation: { actionCode: 'WAIT', selectedCandidateId: 'WAIT', quantity: 0, executionAuthorized: false, requiresAegis: true, requiresFreshAlpacaBbo: true } },
      aegis: null, paretoSurvivorIds: [], opportunityBook: null, shadowOpportunities: [],
    },
  } as unknown as ThetaShadowCycleResult;
}
