import type { Pool, PoolClient } from 'pg';
import type { CheckResult, EvidenceCapabilityResult } from './readiness.js';

export type PersistableCapabilityResult = CheckResult | EvidenceCapabilityResult;

const isEvidenceResult = (result: PersistableCapabilityResult): result is EvidenceCapabilityResult =>
  'availability' in result;

const persistedState = (result: PersistableCapabilityResult): string => {
  if (!isEvidenceResult(result)) return result.state;
  if (result.availability === 'AVAILABLE') return 'GOOD';
  if (result.availability === 'AVAILABLE_WITH_LIMITS') return 'GOOD';
  if (result.availability === 'NOT_ENTITLED') return 'NOT_ENTITLED';
  return 'UNKNOWN';
};

const entitlement = (result: PersistableCapabilityResult): string => {
  if (isEvidenceResult(result)) return result.availability;
  if (result.state === 'GOOD') return 'AVAILABLE';
  if (result.state === 'NOT_ENTITLED') return 'NOT_ENTITLED';
  return 'UNVERIFIED';
};

const safeDetails = (result: PersistableCapabilityResult): Record<string, unknown> => {
  const denied = new Set([
    'maskedAccount', 'equity', 'cash', 'buyingPower', 'optionsBuyingPower',
    'optionsApprovedLevel', 'optionsTradingLevel', 'optionsLevel',
  ]);
  return {
    operationAlias: result.operationAlias,
    httpStatus: result.httpStatus,
    latencyMs: result.latencyMs,
    provenance: result.provenance,
    details: Object.fromEntries(Object.entries(result.details).filter(([key]) => !denied.has(key))),
    availability: entitlement(result),
  };
};

async function ensureConnection(
  client: PoolClient,
  provider: 'ALPACA' | 'OPTIONOMICS',
): Promise<string> {
  const environment = provider === 'ALPACA' ? 'PAPER' : 'RESEARCH';
  const existing = await client.query(
    `SELECT provider_connection_id FROM core.provider_connection
     WHERE provider_code=$1 AND environment=$2 ORDER BY connected_at NULLS LAST,provider_connection_id LIMIT 2`,
    [provider, environment],
  );
  if (existing.rowCount === 1) return String(existing.rows[0].provider_connection_id);
  if ((existing.rowCount ?? 0) > 1) throw new Error(`MULTIPLE_${provider}_PROVIDER_CONNECTIONS`);
  const workspaces = await client.query(`SELECT workspace_id FROM iam.workspace ORDER BY created_at LIMIT 2`);
  if (workspaces.rowCount !== 1) throw new Error('CANONICAL_WORKSPACE_NOT_UNIQUE');
  const inserted = await client.query(
    `INSERT INTO core.provider_connection(
       workspace_id,provider_code,environment,secret_ref,status,connected_at,last_verified_at,metadata_json)
     VALUES($1,$2,$3,$4,'UNKNOWN',now(),now(),$5::jsonb)
     RETURNING provider_connection_id`,
    [workspaces.rows[0].workspace_id, provider, environment,
      provider === 'ALPACA' ? 'encrypted-master-paper-credential' : 'vercel:OPTIONOMICS_API_KEY',
      JSON.stringify({ credentialValuesLogged: false })],
  );
  return String(inserted.rows[0].provider_connection_id);
}

/** Persists sanitized capability metadata only. No credentials or account balances enter this registry. */
export async function persistProviderCapabilities(
  pool: Pool,
  provider: 'ALPACA' | 'OPTIONOMICS',
  results: readonly PersistableCapabilityResult[],
): Promise<{ providerConnectionId: string; capabilityCount: number }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const providerConnectionId = await ensureConnection(client, provider);
    if (provider === 'ALPACA' && results.some((result) => result.capability === 'HISTORICAL_OPTION_BARS')) {
      await client.query(
        `DELETE FROM core.provider_capability WHERE provider_connection_id=$1 AND capability_code = ANY($2::text[])`,
        [providerConnectionId, [
          'HISTORICAL_OPTION_BARS_INDICATIVE', 'HISTORICAL_OPTION_BARS_OPRA',
          'HISTORICAL_OPTION_TRADES_INDICATIVE', 'HISTORICAL_OPTION_TRADES_OPRA',
        ]],
      );
    }
    for (const result of results) {
      if (result.provider !== provider) throw new Error('PROVIDER_CAPABILITY_RESULT_MISMATCH');
      await client.query(
        `INSERT INTO core.provider_capability(
           provider_connection_id,capability_code,entitlement,status,checked_at,details_json)
         VALUES($1,$2,$3,$4,$5,$6::jsonb)
         ON CONFLICT(provider_connection_id,capability_code) DO UPDATE SET
           entitlement=EXCLUDED.entitlement,status=EXCLUDED.status,
           checked_at=EXCLUDED.checked_at,details_json=EXCLUDED.details_json`,
        [providerConnectionId, result.capability, entitlement(result), persistedState(result),
          result.observedAt, JSON.stringify(safeDetails(result))],
      );
      const path = typeof result.provenance.path === 'string' ? result.provenance.path : null;
      const method = typeof result.provenance.method === 'string' ? result.provenance.method : 'GET';
      if (path !== null) {
        const contractVersion = typeof result.provenance.contractVersion === 'string'
          ? result.provenance.contractVersion : 'provider-readiness-v1';
        await client.query(
          `INSERT INTO core.provider_operation_registry(
             provider_code,operation_alias,method,path_or_operation_id,contract_version,notes)
           VALUES($1,$2,$3,$4,$5,$6)
           ON CONFLICT(provider_code,operation_alias,contract_version) DO UPDATE SET
             method=EXCLUDED.method,path_or_operation_id=EXCLUDED.path_or_operation_id,
             active_to=NULL,notes=EXCLUDED.notes`,
          [provider, result.operationAlias, method, path, contractVersion,
            'Read-only provider capability verification. Credential values are never persisted.'],
        );
      }
    }
    const authentication = provider === 'OPTIONOMICS'
      ? results.find((result) => result.capability === 'OPTIONOMICS_AUTHENTICATION')
      : null;
    const connectionState = authentication !== null && authentication !== undefined
      ? (!isEvidenceResult(authentication) && authentication.state === 'GOOD' ? 'GOOD' : 'DEGRADED')
      : results.length > 0 && results.some((result) =>
        isEvidenceResult(result)
          ? result.availability === 'AVAILABLE' || result.availability === 'AVAILABLE_WITH_LIMITS'
          : result.state === 'GOOD') ? 'GOOD' : 'DEGRADED';
    await client.query(
      `UPDATE core.provider_connection SET status=$2,last_verified_at=now(),
         metadata_json=metadata_json || $3::jsonb WHERE provider_connection_id=$1`,
      [providerConnectionId, connectionState,
        JSON.stringify({ lastCapabilityCount: results.length, credentialValuesLogged: false })],
    );
    await client.query('COMMIT');
    return { providerConnectionId, capabilityCount: results.length };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
