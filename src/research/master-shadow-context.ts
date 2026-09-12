import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { canonicalThetaStrategyRegistry } from '../theta/strategy-package.js';
import { deterministicRuntimeUuid } from '../theta/postgres-theta-cycle-store.js';
import { canonicalJson } from './point-in-time-evidence.js';

export const masterShadowContextVersions = Object.freeze({
  strategy: 'theta-conventional@1.0.0-research',
  feature: 'theta-feature-set-v1',
  risk: 'theta-aegis-runtime-v1',
  execution: 'theta-execution-quality-runtime-v2',
  cost: 'theta-cost-model-v1',
});

export interface MasterShadowContext {
  readonly botInstanceId: string;
  readonly accountId: string;
  readonly strategyVersionId: string;
  readonly featureVersionId: string;
  readonly riskLimitVersionId: string;
  readonly executionVersionId: string;
  readonly costModelVersionId: string;
}

const hash = (value: unknown): string => createHash('sha256').update(canonicalJson(value)).digest('hex');

async function upsertVersion(client: PoolClient, input: {
  table: 'strategy_version'|'feature_version'|'risk_limit_version'|'execution_version'|'cost_model_version';
  idColumn: string; semanticVersion: string; jsonColumn: string; payload: unknown; status?: string;
}): Promise<string> {
  const id = deterministicRuntimeUuid(`core-version:${input.table}:${input.semanticVersion}`);
  const configHash = hash(input.payload);
  const statusColumns = input.status === undefined ? '' : ',status';
  const statusValues = input.status === undefined ? '' : ',$5';
  const parameters = input.status === undefined
    ? [id, input.semanticVersion, JSON.stringify(input.payload), configHash]
    : [id, input.semanticVersion, JSON.stringify(input.payload), configHash, input.status];
  const result = await client.query(`INSERT INTO core.${input.table}
    (${input.idColumn},semantic_version,${input.jsonColumn},config_hash${statusColumns})
    VALUES($1,$2,$3::jsonb,$4${statusValues})
    ON CONFLICT(semantic_version) DO UPDATE SET semantic_version=EXCLUDED.semantic_version
    RETURNING ${input.idColumn} AS id,config_hash`, parameters);
  const resolved = result.rows[0]?.id;
  if (resolved === undefined) throw new Error(`SHADOW_CONTEXT_VERSION_UNRESOLVED:${input.semanticVersion}`);
  if (String(result.rows[0].config_hash) !== configHash) throw new Error(`SHADOW_CONTEXT_VERSION_HASH_MISMATCH:${input.semanticVersion}`);
  return String(resolved);
}

/** Build a research-only context for the already designated, verified master. */
export async function ensureMasterShadowContext(pool: Pool, verifiedProviderAccountId: string): Promise<MasterShadowContext> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(863801019)');
    const master = await client.query(`SELECT f.workspace_id,f.token_secret_id,f.provider_account_ref,
      f.account_status,f.connection_status,f.disconnected_at
      FROM copy.follower_account f
      WHERE f.account_role='MASTER_THETA_PAPER' AND f.environment='PAPER' FOR UPDATE`);
    if (master.rowCount !== 1) throw new Error(master.rowCount === 0
      ? 'MASTER_THETA_PAPER_NOT_DESIGNATED' : 'MASTER_THETA_PAPER_AMBIGUOUS');
    const row = master.rows[0];
    if (row.disconnected_at !== null || row.connection_status !== 'CONNECTED') throw new Error('MASTER_THETA_PAPER_NOT_CONNECTED');
    if (String(row.provider_account_ref) !== verifiedProviderAccountId) throw new Error('MASTER_BROKER_IDENTITY_MISMATCH');
    if (row.token_secret_id === null) throw new Error('MASTER_ENCRYPTED_CREDENTIAL_REFERENCE_MISSING');

    const workspaceId = String(row.workspace_id);
    const providerConnectionId = deterministicRuntimeUuid(`provider-connection:${workspaceId}:ALPACA:PAPER`);
    await client.query(`INSERT INTO core.provider_connection(provider_connection_id,workspace_id,provider_code,environment,
      secret_ref,masked_label,status,connected_at,last_verified_at,metadata_json)
      VALUES($1,$2,'ALPACA','PAPER',$3,$4,'GOOD',now(),now(),$5::jsonb)
      ON CONFLICT(workspace_id,provider_code,environment) DO UPDATE SET
        secret_ref=EXCLUDED.secret_ref,masked_label=EXCLUDED.masked_label,status='GOOD',last_verified_at=now(),
        metadata_json=EXCLUDED.metadata_json`, [providerConnectionId, workspaceId, `alpaca-token:${String(row.token_secret_id)}`,
        `Alpaca Paper ••••${verifiedProviderAccountId.slice(-4)}`,
        JSON.stringify({ connectionMethod:'PAPER_API_KEY_PRIVATE_BETA', accountRole:'MASTER_THETA_PAPER' })]);
    const connection = await client.query(`SELECT provider_connection_id FROM core.provider_connection
      WHERE workspace_id=$1 AND provider_code='ALPACA' AND environment='PAPER'`, [workspaceId]);
    const resolvedConnectionId = String(connection.rows[0].provider_connection_id);

    const accountId = deterministicRuntimeUuid(`trading-account:${resolvedConnectionId}:${verifiedProviderAccountId}`);
    await client.query(`INSERT INTO core.trading_account(account_id,workspace_id,provider_connection_id,provider_account_id,
      environment,options_level,status) VALUES($1,$2,$3,$4,'PAPER',NULL,$5)
      ON CONFLICT(provider_connection_id,provider_account_id) DO UPDATE SET status=EXCLUDED.status`,
    [accountId, workspaceId, resolvedConnectionId, verifiedProviderAccountId, String(row.account_status ?? 'UNKNOWN')]);
    const account = await client.query(`SELECT account_id FROM core.trading_account
      WHERE provider_connection_id=$1 AND provider_account_id=$2`, [resolvedConnectionId, verifiedProviderAccountId]);
    const resolvedAccountId = String(account.rows[0].account_id);

    const strategy = canonicalThetaStrategyRegistry.get(masterShadowContextVersions.strategy);
    if (strategy === undefined || strategy.executionEnabled || strategy.status !== 'SHADOW') throw new Error('CANONICAL_SHADOW_STRATEGY_INVALID');
    const strategyVersionId = await upsertVersion(client, { table:'strategy_version', idColumn:'strategy_version_id',
      semanticVersion:masterShadowContextVersions.strategy, jsonColumn:'config_json', payload:strategy, status:'UNVALIDATED' });
    const featureVersionId = await upsertVersion(client, { table:'feature_version', idColumn:'feature_version_id',
      semanticVersion:masterShadowContextVersions.feature, jsonColumn:'definition_manifest_json',
      payload:{ featureSetVersion:masterShadowContextVersions.feature, nullSemantics:'UNKNOWN_PRESERVED', futureLabelsExcluded:true } });
    const riskLimitVersionId = await upsertVersion(client, { table:'risk_limit_version', idColumn:'risk_limit_version_id',
      semanticVersion:masterShadowContextVersions.risk, jsonColumn:'limits_json',
      payload:{ policyVersion:masterShadowContextVersions.risk, unknownInputAction:'HOLD_ONLY', executionEnabled:false }, status:'UNVALIDATED' });
    const executionVersionId = await upsertVersion(client, { table:'execution_version', idColumn:'execution_version_id',
      semanticVersion:masterShadowContextVersions.execution, jsonColumn:'policy_json',
      payload:{ policyVersion:masterShadowContextVersions.execution, mode:'SHADOW_EVIDENCE', brokerMutationSurface:false }, status:'UNVALIDATED' });
    const costModelVersionId = await upsertVersion(client, { table:'cost_model_version', idColumn:'cost_model_version_id',
      semanticVersion:masterShadowContextVersions.cost, jsonColumn:'assumptions_json',
      payload:{ costModelVersion:masterShadowContextVersions.cost, empiricalCalibration:'NOT_READY', unknownCostsRemainUnknown:true }, status:'UNVALIDATED' });

    const botInstanceId = deterministicRuntimeUuid(`bot-instance:${resolvedAccountId}:THETA`);
    await client.query(`INSERT INTO core.bot_instance(bot_instance_id,workspace_id,account_id,bot_code,mode,scheduler_enabled,
      strategy_version_id,risk_limit_version_id,execution_version_id,cost_model_version_id,feature_version_id,state)
      VALUES($1,$2,$3,'THETA','SHADOW',true,$4,$5,$6,$7,$8,'IDLE')
      ON CONFLICT(account_id,bot_code) DO UPDATE SET mode='SHADOW',scheduler_enabled=true,
        strategy_version_id=EXCLUDED.strategy_version_id,risk_limit_version_id=EXCLUDED.risk_limit_version_id,
        execution_version_id=EXCLUDED.execution_version_id,cost_model_version_id=EXCLUDED.cost_model_version_id,
        feature_version_id=EXCLUDED.feature_version_id,state='IDLE'`, [botInstanceId, workspaceId, resolvedAccountId,
        strategyVersionId, riskLimitVersionId, executionVersionId, costModelVersionId, featureVersionId]);
    const bot = await client.query(`SELECT bot_instance_id FROM core.bot_instance WHERE account_id=$1 AND bot_code='THETA'`, [resolvedAccountId]);
    await client.query('COMMIT');
    return { botInstanceId:String(bot.rows[0].bot_instance_id), accountId:resolvedAccountId, strategyVersionId,
      featureVersionId, riskLimitVersionId, executionVersionId, costModelVersionId };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}
