import { createHash, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { DurableMultiLegOrderEvidence, PersistedPaperOrderIntent } from '../../src/execution/paper-order-coordinator.js';
import type { BrokerOrderLegSnapshot, BrokerOrderSnapshot } from '../../src/execution/broker.js';

export const NOW = '2026-10-06T15:00:00.000Z';
// provider order ids are globally unique in the schema, so a re-run against the same disposable database must not reuse a literal id
const RUN = randomUUID().slice(0, 8);
const hash = (value: string): string => createHash('sha256').update(value).digest('hex');

export interface DefinedRiskWorld {
  readonly underlyingId: string; readonly botInstanceId: string;
  readonly shortContract: string; readonly longContract: string; readonly shortSymbol: string; readonly longSymbol: string;
}

/** Seeds one underlying, a 650/645 put pair and the bot instance a chain needs (real FKs, disposable database only). */
export async function seedDefinedRiskWorld(pool: Pool): Promise<DefinedRiskWorld> {
  const underlyingId = randomUUID(), shortContract = randomUUID(), longContract = randomUUID();
  const workspaceId = randomUUID(), providerId = randomUUID(), accountId = randomUUID(), botInstanceId = randomUUID();
  const strategyId = randomUUID(), featureId = randomUUID(), riskId = randomUUID(), executionId = randomUUID(), costId = randomUUID();
  await pool.query(`INSERT INTO market.underlying(underlying_id,symbol,asset_type) VALUES($1,$2,'EQUITY')`, [underlyingId, `M${underlyingId.slice(0, 8)}`]);
  const shortSymbol = `MS${shortContract.replaceAll('-', '').slice(0, 12)}`, longSymbol = `ML${longContract.replaceAll('-', '').slice(0, 12)}`;
  await pool.query(`INSERT INTO market.option_contract(option_contract_id,contract_symbol,underlying_id,option_type,strike,expiration_date,multiplier,tradable,status)
    VALUES($1,$2,$5,'PUT',650,'2026-10-16',100,true,'ACTIVE'),($3,$4,$5,'PUT',645,'2026-10-16',100,true,'ACTIVE')`, [shortContract, shortSymbol, longContract, longSymbol, underlyingId]);
  await pool.query(`INSERT INTO iam.workspace(workspace_id,name) VALUES($1,$2)`, [workspaceId, `mleg-${workspaceId}`]);
  await pool.query(`INSERT INTO core.provider_connection(provider_connection_id,workspace_id,provider_code,environment,secret_ref,status) VALUES($1,$2,'ALPACA','PAPER',$3,'GOOD')`, [providerId, workspaceId, `t-${providerId}`]);
  await pool.query(`INSERT INTO core.trading_account(account_id,workspace_id,provider_connection_id,provider_account_id,environment,status) VALUES($1,$2,$3,$4,'PAPER','ACTIVE')`, [accountId, workspaceId, providerId, `t-${accountId}`]);
  await pool.query(`INSERT INTO core.strategy_version(strategy_version_id,semantic_version,config_json,config_hash,status) VALUES($1,$2,'{}',$3,'TEST')`, [strategyId, `t-${strategyId}`, hash(strategyId)]);
  await pool.query(`INSERT INTO core.feature_version(feature_version_id,semantic_version,definition_manifest_json,config_hash) VALUES($1,$2,'{}',$3)`, [featureId, `t-${featureId}`, hash(featureId)]);
  await pool.query(`INSERT INTO core.risk_limit_version(risk_limit_version_id,semantic_version,limits_json,config_hash,status) VALUES($1,$2,'{}',$3,'TEST')`, [riskId, `t-${riskId}`, hash(riskId)]);
  await pool.query(`INSERT INTO core.execution_version(execution_version_id,semantic_version,policy_json,config_hash,status) VALUES($1,$2,'{}',$3,'TEST')`, [executionId, `t-${executionId}`, hash(executionId)]);
  await pool.query(`INSERT INTO core.cost_model_version(cost_model_version_id,semantic_version,assumptions_json,config_hash,status) VALUES($1,$2,'{}',$3,'TEST')`, [costId, `t-${costId}`, hash(costId)]);
  await pool.query(`INSERT INTO core.bot_instance(bot_instance_id,workspace_id,account_id,mode,strategy_version_id,risk_limit_version_id,execution_version_id,cost_model_version_id,feature_version_id)
    VALUES($1,$2,$3,'PAPER',$4,$5,$6,$7,$8)`, [botInstanceId, workspaceId, accountId, strategyId, riskId, executionId, costId, featureId]);
  return { underlyingId, botInstanceId, shortContract, longContract, shortSymbol, longSymbol };
}

export function durableEvidence(world: DefinedRiskWorld, closing: boolean): DurableMultiLegOrderEvidence {
  const shortIntent = closing ? 'buy_to_close' as const : 'sell_to_open' as const, longIntent = closing ? 'sell_to_close' as const : 'buy_to_open' as const;
  return { orderClass: 'mleg', creditDebitDirection: closing ? 'DEBIT' : 'CREDIT',
    packageIdentity: `MLEG:${world.shortSymbol}:${closing ? 'buy' : 'sell'}:1:${shortIntent}|${world.longSymbol}:${closing ? 'sell' : 'buy'}:1:${longIntent}`, legs: [
      { legIndex: 1, optionContractId: world.shortContract, providerContractId: 'alpaca-short', occSymbol: world.shortSymbol, optionType: 'PUT', positionIntent: shortIntent, ratioQuantity: 1, expiration: '2026-10-16', strike: 650, multiplier: 100, deliverableIdentity: 'STANDARD:SPY:100' },
      { legIndex: 2, optionContractId: world.longContract, providerContractId: 'alpaca-long', occSymbol: world.longSymbol, optionType: 'PUT', positionIntent: longIntent, ratioQuantity: 1, expiration: '2026-10-16', strike: 645, multiplier: 100, deliverableIdentity: 'STANDARD:SPY:100' }] };
}

export function mlegIntent(world: DefinedRiskWorld, chainId: string, closing: boolean, quantity = 1): PersistedPaperOrderIntent {
  const evidence = durableEvidence(world, closing), orderIntentId = randomUUID();
  return { orderIntentId, executionAccountId: randomUUID(), status: 'READY', brokerOrderId: null,
    request: { symbol: evidence.packageIdentity, qty: quantity, side: closing ? 'buy' : 'sell', type: 'limit', time_in_force: 'day', limit_price: closing ? '0.40' : '-1.10',
      client_order_id: `theta-d-${orderIntentId}`, order_class: 'mleg', legs: evidence.legs.map((leg) => ({ symbol: leg.occSymbol, side: leg.positionIntent.startsWith('buy_') ? 'buy' as const : 'sell' as const, ratio_qty: 1, position_intent: leg.positionIntent })) },
    action: closing ? 'CLOSE_DEFINED_RISK' : 'OPEN_DEFINED_RISK', decisionId: randomUUID(), persistedAt: NOW, chainId, optionContractId: null, underlyingId: world.underlyingId, multiLegEvidence: evidence,
    executionEvidence: { quoteSource: 'ALPACA', quoteFeed: 'OPRA', quoteSemantics: 'CONSOLIDATED_NBBO', quoteAsOf: NOW, decisionExpiresAt: '2026-10-06T15:01:00.000Z', quoteContentHash: 'a'.repeat(64), aegisState: 'ALLOW_FULL' },
    authorizationEvidence: { executionTier: 'PAPER_EVIDENCE', canonicalQuantity: quantity, paperEvidenceQuantity: quantity, empiricalEconomicsReady: false, expectedAfterCostEv: null } };
}

export interface LegFill { readonly filled: number; readonly avg: number | null; readonly status?: string }
export function brokerParent(intent: PersistedPaperOrderIntent, rawBrokerId: string, shortLeg: LegFill, longLeg: LegFill, status: string, qty = intent.request.qty): BrokerOrderSnapshot {
  const brokerId = `${rawBrokerId}-${RUN}`;
  const evidence = intent.multiLegEvidence as DurableMultiLegOrderEvidence;
  const legs: BrokerOrderLegSnapshot[] = [shortLeg, longLeg].map((fill, index) => {
    const leg = evidence.legs[index] as DurableMultiLegOrderEvidence['legs'][number];
    return { id: `${brokerId}-leg-${index + 1}`, symbol: leg.occSymbol, side: leg.positionIntent.startsWith('buy_') ? 'buy' : 'sell', positionIntent: leg.positionIntent, ratioQty: 1, qty,
      filledQty: fill.filled, filledAvgPrice: fill.avg, status: fill.status ?? (fill.filled >= qty ? 'filled' : fill.filled > 0 ? 'partially_filled' : 'new') };
  });
  const parentFilled = Math.min(shortLeg.filled, longLeg.filled);
  return { id: brokerId, clientOrderId: intent.request.client_order_id, symbol: intent.request.symbol, qty, filledQty: parentFilled, filledAvgPrice: null, side: intent.request.side, positionIntent: null,
    status, limitPrice: Number(intent.request.limit_price), submittedAt: NOW, replacedBy: null, replaces: null, orderClass: 'mleg', legs };
}
