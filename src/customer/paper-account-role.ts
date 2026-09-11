import { Pool } from 'pg';
import type { Environment } from '../config/environment.js';
import { customerStore } from './customer-store.js';
import { verifyStoredFollowerAccount } from './alpaca-oauth.js';

export interface MasterRoleStore {
  promote(customerId: string, verifiedAccountId: string): Promise<void>;
}

export class PostgresMasterRoleStore implements MasterRoleStore {
  constructor(private readonly pool: Pool) {}

  async listConnections() {
    const result = await this.pool.query(`SELECT customer_id, follower_account_id AS connection_id,
      account_role, account_status, account_ready, last_verified_at,
      ('••••' || right(provider_account_ref,4)) AS masked_account
      FROM copy.follower_account WHERE disconnected_at IS NULL
      AND customer_id IS NOT NULL AND connection_method='PAPER_API_KEY_PRIVATE_BETA'
      ORDER BY created_at`);
    return result.rows;
  }

  async promote(customerId: string, verifiedAccountId: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(863801010)');
      const result = await client.query(`SELECT follower_account_id, account_role
        FROM copy.follower_account WHERE customer_id=$1 AND provider_account_ref=$2
        AND disconnected_at IS NULL AND connection_method='PAPER_API_KEY_PRIVATE_BETA'
        AND environment='PAPER' FOR UPDATE`, [customerId, verifiedAccountId]);
      if (result.rowCount !== 1) throw new Error('MASTER_CONNECTION_IDENTITY_MISMATCH');
      const row = result.rows[0];
      if (row.account_role !== 'MASTER_THETA_PAPER') {
        const history = await client.query(`SELECT 1 FROM copy.follower_copy_event
          WHERE follower_account_id=$1 LIMIT 1`, [row.follower_account_id]);
        if (history.rowCount) throw new Error('FOLLOWER_HISTORY_REQUIRES_RECONCILIATION');
        const execution = await client.query(`SELECT 1 FROM trade.execution_account
          WHERE follower_account_id=$1 LIMIT 1`, [row.follower_account_id]);
        if (execution.rowCount) throw new Error('FOLLOWER_EXECUTION_REQUIRES_RECONCILIATION');
        await client.query(`UPDATE copy.customer_participation SET state='BLOCKED', updated_at=now()
          WHERE customer_id=$1`, [customerId]);
        await client.query(`UPDATE copy.follower_policy SET superseded_at=now()
          WHERE follower_account_id=$1 AND superseded_at IS NULL`, [row.follower_account_id]);
        await client.query(`UPDATE copy.follower_account SET account_role='MASTER_THETA_PAPER',
          participation='STOP_NEW_TRADES_MANAGE_EXISTING', updated_at=now()
          WHERE follower_account_id=$1`, [row.follower_account_id]);
        await client.query(`INSERT INTO ops.paper_account_role_event(connection_id,account_role,reason)
          VALUES ($1,'MASTER_THETA_PAPER','OWNER_DESIGNATED_PRIVATE_PAPER_MASTER')`, [row.follower_account_id]);
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }
}

// Caller must be the authenticated operator route. No credentials or full account
// identifiers leave this server-side verification/persistence boundary.
export async function designateConnectedPaperMaster(
  environment: Environment, customerId: string,
  store: MasterRoleStore,
  verify = () => verifyStoredFollowerAccount(customerStore(environment.DATABASE_URL), environment, customerId),
) {
  const verification = await verify();
  if (!verification.ready || verification.account.status !== 'ACTIVE')
    throw new Error('MASTER_ACCOUNT_NOT_READY');
  await store.promote(customerId, verification.account.id);
  return {
    account_role: 'MASTER_THETA_PAPER' as const,
    paper_host: 'https://paper-api.alpaca.markets',
    account_status: verification.account.status,
    self_copy_allowed: false,
    order_submission: 'LOCKED' as const,
    orders_submitted: 0,
  };
}

let rolePool: Pool | undefined;
export function masterRoleStore(databaseUrl: string | undefined): PostgresMasterRoleStore {
  if (!databaseUrl) throw new Error('CUSTOMER_DATABASE_NOT_CONFIGURED');
  rolePool ??= new Pool({ connectionString: databaseUrl, max: 2, connectionTimeoutMillis: 5000 });
  return new PostgresMasterRoleStore(rolePool);
}
