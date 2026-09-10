import { Pool } from "pg";
import type { EncryptedSecret } from "./customer-security.js";

export type CustomerIdentity = {
  readonly customerId: string;
  readonly email: string;
  readonly passwordHash: string;
};

export type OAuthStateRecord = {
  readonly customerId: string;
  readonly returnPath: string;
};

export type FollowerRecord = {
  readonly customerId: string;
  readonly followerAccountId: string;
  readonly maskedAccount: string;
  readonly accountStatus: string | null;
  readonly buyingPower: number | null;
  readonly cash: number | null;
  readonly optionsBuyingPower: number | null;
  readonly optionsApprovedLevel: number | null;
  readonly optionsTradingLevel: number | null;
  readonly accountReady: boolean;
  readonly lastBrokerSyncAt: string | null;
  readonly participation: string;
  readonly allocationUsd: number | null;
};

export type SaveFollowerInput = {
  readonly customerId: string;
  readonly providerAccountRef: string;
  readonly maskedAccount: string;
  readonly accountStatus: string | null;
  readonly buyingPower: number | null;
  readonly cash: number | null;
  readonly optionsBuyingPower: number | null;
  readonly optionsApprovedLevel: number | null;
  readonly optionsTradingLevel: number | null;
  readonly accountReady: boolean;
  readonly restrictions: Readonly<Record<string, boolean>>;
  readonly keyRef: string;
  readonly encryptedToken: EncryptedSecret;
  readonly scope: string;
};
export type StoredFollowerToken = EncryptedSecret & { readonly keyRef: string };

export interface CustomerStore {
  createCustomer(email: string, passwordHash: string): Promise<CustomerIdentity>;
  findCustomerByEmail(email: string): Promise<CustomerIdentity | null>;
  createSession(customerId: string, sessionHash: string, expiresAt: Date): Promise<void>;
  getSession(sessionHash: string, now: Date): Promise<CustomerIdentity | null>;
  revokeSession(sessionHash: string): Promise<void>;
  createOAuthState(stateHash: string, customerId: string, returnPath: string, expiresAt: Date): Promise<void>;
  consumeOAuthState(stateHash: string, customerId: string, now: Date): Promise<OAuthStateRecord | null>;
  saveFollower(input: SaveFollowerInput): Promise<FollowerRecord>;
  getFollower(customerId: string): Promise<FollowerRecord | null>;
  getFollowerToken(customerId: string): Promise<StoredFollowerToken | null>;
  saveParticipation(customerId: string, allocationUsd: number): Promise<FollowerRecord>;
  disconnectFollower(customerId: string): Promise<void>;
}

const numberOrNull = (value: unknown): number | null =>
  value === null || value === undefined || value === "" ? null : Number(value);

function followerFromRow(row: Record<string, unknown>): FollowerRecord {
  return {
    customerId: String(row.customer_id),
    followerAccountId: String(row.follower_account_id),
    maskedAccount: String(row.provider_account_ref_masked),
    accountStatus: row.account_status == null ? null : String(row.account_status),
    buyingPower: numberOrNull(row.buying_power),
    cash: numberOrNull(row.cash),
    optionsBuyingPower: numberOrNull(row.options_buying_power),
    optionsApprovedLevel: numberOrNull(row.options_approved_level),
    optionsTradingLevel: numberOrNull(row.options_trading_level),
    accountReady: row.account_ready === true,
    lastBrokerSyncAt:
      row.last_broker_sync_at instanceof Date
        ? row.last_broker_sync_at.toISOString()
        : row.last_broker_sync_at == null
          ? null
          : String(row.last_broker_sync_at),
    participation: row.participation_state == null ? "READY" : String(row.participation_state),
    allocationUsd: numberOrNull(row.allocation_usd),
  };
}

export class PostgresCustomerStore implements CustomerStore {
  constructor(private readonly pool: Pool) {}

  async createCustomer(email: string, passwordHash: string) {
    const result = await this.pool.query(
      `INSERT INTO iam.customer_identity(email_normalized, password_hash)
       VALUES ($1, $2)
       RETURNING customer_id, email_normalized, password_hash`,
      [email, passwordHash],
    );
    const row = result.rows[0];
    return { customerId: row.customer_id, email: row.email_normalized, passwordHash: row.password_hash };
  }

  async findCustomerByEmail(email: string) {
    const result = await this.pool.query(
      `SELECT customer_id, email_normalized, password_hash
       FROM iam.customer_identity WHERE email_normalized = $1 AND status = 'ACTIVE'`,
      [email],
    );
    const row = result.rows[0];
    return row
      ? { customerId: row.customer_id, email: row.email_normalized, passwordHash: row.password_hash }
      : null;
  }

  async createSession(customerId: string, sessionHash: string, expiresAt: Date) {
    await this.pool.query(
      `INSERT INTO iam.customer_session(session_hash, customer_id, expires_at)
       VALUES ($1, $2, $3)`,
      [sessionHash, customerId, expiresAt],
    );
  }

  async getSession(sessionHash: string, now: Date) {
    const result = await this.pool.query(
      `SELECT c.customer_id, c.email_normalized, c.password_hash
       FROM iam.customer_session s
       JOIN iam.customer_identity c ON c.customer_id = s.customer_id
       WHERE s.session_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > $2
         AND c.status = 'ACTIVE'`,
      [sessionHash, now],
    );
    const row = result.rows[0];
    if (!row) return null;
    void this.pool.query(
      `UPDATE iam.customer_session SET last_seen_at = now() WHERE session_hash = $1`,
      [sessionHash],
    );
    return { customerId: row.customer_id, email: row.email_normalized, passwordHash: row.password_hash };
  }

  async revokeSession(sessionHash: string) {
    await this.pool.query(
      `UPDATE iam.customer_session SET revoked_at = now() WHERE session_hash = $1 AND revoked_at IS NULL`,
      [sessionHash],
    );
  }

  async createOAuthState(stateHash: string, customerId: string, returnPath: string, expiresAt: Date) {
    await this.pool.query(
      `INSERT INTO copy.alpaca_oauth_state(state_hash, customer_id, return_path, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [stateHash, customerId, returnPath, expiresAt],
    );
  }

  async consumeOAuthState(stateHash: string, customerId: string, now: Date) {
    const result = await this.pool.query(
      `UPDATE copy.alpaca_oauth_state SET consumed_at = $3
       WHERE state_hash = $1 AND customer_id = $2 AND consumed_at IS NULL AND expires_at > $3
       RETURNING customer_id, return_path`,
      [stateHash, customerId, now],
    );
    const row = result.rows[0];
    return row ? { customerId: row.customer_id, returnPath: row.return_path } : null;
  }

  async saveFollower(input: SaveFollowerInput) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO iam.workspace(workspace_id, name) VALUES ($1, $2)
         ON CONFLICT (workspace_id) DO NOTHING`,
        [input.customerId, `customer-${input.customerId.slice(0, 8)}`],
      );
      await client.query(
        `UPDATE copy.alpaca_oauth_token SET revoked_at = now()
         WHERE customer_id = $1 AND revoked_at IS NULL`,
        [input.customerId],
      );
      await client.query(
        `UPDATE copy.follower_account SET disconnected_at = now(), participation = 'DISCONNECTED',
          account_ready = false, updated_at = now()
         WHERE customer_id = $1 AND disconnected_at IS NULL`,
        [input.customerId],
      );
      const token = await client.query(
        `INSERT INTO copy.alpaca_oauth_token
          (customer_id, key_ref, ciphertext, iv, auth_tag, scope)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING token_secret_id`,
        [input.customerId, input.keyRef, input.encryptedToken.ciphertext, input.encryptedToken.iv, input.encryptedToken.authTag, input.scope],
      );
      const follower = await client.query(
        `INSERT INTO copy.follower_account
          (workspace_id, customer_id, provider_account_ref, oauth_secret_ref,
           token_secret_id, participation, account_ready, options_approved,
           account_status, buying_power, cash, options_buying_power,
           options_approved_level, options_trading_level, restrictions,
           last_broker_sync_at, disconnected_at)
         VALUES ($1, $1, $2, $3, $4, 'COPY_NEW_AND_MANAGE', $5, $6,
                 $7, $8, $9, $10, $11, $12, $13, now(), NULL)
         ON CONFLICT (workspace_id, provider_code, provider_account_ref)
         DO UPDATE SET customer_id = EXCLUDED.customer_id,
           oauth_secret_ref = EXCLUDED.oauth_secret_ref,
           token_secret_id = EXCLUDED.token_secret_id,
           account_ready = EXCLUDED.account_ready,
           options_approved = EXCLUDED.options_approved,
           account_status = EXCLUDED.account_status,
           buying_power = EXCLUDED.buying_power, cash = EXCLUDED.cash,
           options_buying_power = EXCLUDED.options_buying_power,
           options_approved_level = EXCLUDED.options_approved_level,
           options_trading_level = EXCLUDED.options_trading_level,
           restrictions = EXCLUDED.restrictions,
           last_broker_sync_at = now(), disconnected_at = NULL,
           updated_at = now()
         RETURNING follower_account_id`,
        [input.customerId, input.providerAccountRef, `vault:${token.rows[0].token_secret_id}`, token.rows[0].token_secret_id, input.accountReady, input.optionsApprovedLevel !== null, input.accountStatus, input.buyingPower, input.cash, input.optionsBuyingPower, input.optionsApprovedLevel, input.optionsTradingLevel, JSON.stringify(input.restrictions)],
      );
      await client.query(
        `INSERT INTO copy.customer_participation(customer_id, follower_account_id, state)
         VALUES ($1, $2, $3)
         ON CONFLICT (customer_id) DO UPDATE SET follower_account_id = EXCLUDED.follower_account_id,
           state = EXCLUDED.state, updated_at = now()`,
        [input.customerId, follower.rows[0].follower_account_id, input.accountReady ? "READY" : "BLOCKED"],
      );
      await client.query("COMMIT");
      const saved = await this.getFollower(input.customerId);
      if (!saved) throw new Error("FOLLOWER_PERSISTENCE_FAILED");
      return saved;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async getFollower(customerId: string) {
    const result = await this.pool.query(
      `SELECT f.customer_id, f.follower_account_id,
        ('••••' || right(f.provider_account_ref, 4)) AS provider_account_ref_masked,
        f.account_status, f.buying_power, f.cash, f.options_buying_power,
        f.options_approved_level, f.options_trading_level, f.account_ready,
        f.last_broker_sync_at, p.state AS participation_state, p.allocation_usd
       FROM copy.follower_account f
       LEFT JOIN copy.customer_participation p ON p.customer_id = f.customer_id
       WHERE f.customer_id = $1 AND f.disconnected_at IS NULL
       ORDER BY f.updated_at DESC LIMIT 1`,
      [customerId],
    );
    return result.rows[0] ? followerFromRow(result.rows[0]) : null;
  }

  async getFollowerToken(customerId: string) {
    const result = await this.pool.query(
      `UPDATE copy.alpaca_oauth_token t SET last_used_at = now()
       FROM copy.follower_account f
       WHERE t.customer_id = $1 AND t.customer_id = f.customer_id
         AND t.token_secret_id = f.token_secret_id
         AND t.revoked_at IS NULL AND f.disconnected_at IS NULL
       RETURNING t.key_ref, t.ciphertext, t.iv, t.auth_tag`,
      [customerId],
    );
    const row = result.rows[0];
    return row
      ? { keyRef: row.key_ref, ciphertext: row.ciphertext, iv: row.iv, authTag: row.auth_tag }
      : null;
  }

  async saveParticipation(customerId: string, allocationUsd: number) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const follower = await client.query(
        `SELECT follower_account_id FROM copy.follower_account
         WHERE customer_id = $1 AND disconnected_at IS NULL AND account_ready = true
         ORDER BY updated_at DESC LIMIT 1 FOR UPDATE`,
        [customerId],
      );
      if (!follower.rows[0]) throw new Error("FOLLOWER_NOT_CONNECTED");
      await client.query(
        `UPDATE copy.follower_policy SET superseded_at = now()
         WHERE follower_account_id = $1 AND superseded_at IS NULL`,
        [follower.rows[0].follower_account_id],
      );
      await client.query(
        `INSERT INTO copy.follower_policy(
          follower_account_id, policy_version, allocation_usd,
          max_bot_capital_pct, max_ticker_exposure_pct, max_contracts,
          max_daily_loss_usd, max_open_positions, max_slippage_per_contract_usd,
          min_dte, max_dte, allow_0dte, min_open_interest,
          join_existing_positions, start_new_trades_only
        ) VALUES ($1, 'theta-copy-policy-v1:' || gen_random_uuid()::text, $2,
          25, 10, 1, 500, 3, 10, 7, 60, false, 500, false, true)`,
        [follower.rows[0].follower_account_id, allocationUsd],
      );
      await client.query(
        `UPDATE copy.customer_participation
         SET allocation_usd = $2, state = 'READY', policy_version = 'theta-copy-policy-v1', updated_at = now()
         WHERE customer_id = $1`,
        [customerId, allocationUsd],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    const follower = await this.getFollower(customerId);
    if (!follower) throw new Error("FOLLOWER_NOT_CONNECTED");
    return follower;
  }

  async disconnectFollower(customerId: string) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `UPDATE copy.alpaca_oauth_token SET revoked_at = now(), ciphertext = decode('', 'hex')
         WHERE customer_id = $1 AND revoked_at IS NULL`,
        [customerId],
      );
      await client.query(
        `UPDATE copy.follower_account SET disconnected_at = now(), participation = 'DISCONNECTED',
          account_ready = false, updated_at = now() WHERE customer_id = $1 AND disconnected_at IS NULL`,
        [customerId],
      );
      await client.query(
        `UPDATE copy.customer_participation SET state = 'DISCONNECTED', updated_at = now()
         WHERE customer_id = $1`,
        [customerId],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

let sharedPool: Pool | null = null;
export function customerStore(databaseUrl: string | undefined): CustomerStore {
  if (!databaseUrl) throw new Error("CUSTOMER_DATABASE_NOT_CONFIGURED");
  sharedPool ??= new Pool({ connectionString: databaseUrl, max: 4, idleTimeoutMillis: 10_000 });
  return new PostgresCustomerStore(sharedPool);
}
