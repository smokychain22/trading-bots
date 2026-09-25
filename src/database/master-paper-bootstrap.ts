import { createHash } from 'node:crypto';
import { Pool } from 'pg';
import type { Environment } from '../config/environment.js';
import { ALPACA_PAPER_BASE_URL, verifyAlpacaPaperAccount } from '../customer/alpaca-paper-verification.js';
import { PostgresCustomerStore } from '../customer/customer-store.js';
import { encryptSecret } from '../customer/customer-security.js';

const RECOVERY_EMAIL = 'theta-master-recovery@internal.invalid';
const CONFIRMATION = 'AIVEN_RECOVER_MASTER_THETA_PAPER';

export const matchesMasterRecoveryConfirmation = (value: string | readonly string[] | undefined): boolean =>
  value === CONFIRMATION;

const disabledPasswordHash = (): string =>
  `disabled-recovery-${createHash('sha256').update('THETA_AIVEN_MASTER_SERVICE_IDENTITY').digest('hex')}`;

export async function bootstrapAivenMasterPaperAccount(environment: Environment) {
  if (!environment.AIVEN_DATABASE_URL) throw new Error('AIVEN_DATABASE_NOT_CONFIGURED');
  if (!environment.ALPACA_API_KEY || !environment.ALPACA_SECRET_KEY) throw new Error('ALPACA_MASTER_CREDENTIAL_NOT_CONFIGURED');
  if (environment.ALPACA_BASE_URL !== ALPACA_PAPER_BASE_URL) throw new Error('ALPACA_PAPER_HOST_REQUIRED');
  if (!environment.PAPER_COPY_TOKEN_ENCRYPTION_KEY || !environment.PAPER_COPY_TOKEN_KEY_REF)
    throw new Error('MASTER_CREDENTIAL_ENCRYPTION_NOT_CONFIGURED');
  if (environment.FOLLOWER_PAPER_EXECUTION_ENABLED) throw new Error('FOLLOWER_EXECUTION_MUST_REMAIN_LOCKED');
  if (environment.MASTER_PAPER_EXECUTION_ENABLED || !environment.PAPER_PAUSE_NEW_ORDERS)
    throw new Error('MASTER_EXECUTION_MUST_REMAIN_LOCKED_DURING_RECOVERY');

  const verification = await verifyAlpacaPaperAccount({
    kind: 'MASTER_API_KEY', apiKey: environment.ALPACA_API_KEY, apiSecret: environment.ALPACA_SECRET_KEY,
  });
  if (!verification.ready || verification.account.status !== 'ACTIVE') throw new Error('ALPACA_PAPER_ACCOUNT_NOT_READY');

  const pool = new Pool({ connectionString: environment.AIVEN_DATABASE_URL, max: 2, connectionTimeoutMillis: 8_000,
    application_name: 'theta-master-paper-bootstrap' });
  try {
    const customer = await pool.query(`INSERT INTO iam.customer_identity(email_normalized,password_hash,status)
      VALUES($1,$2,'DISABLED')
      ON CONFLICT(email_normalized) DO UPDATE SET status='DISABLED',updated_at=now()
      RETURNING customer_id`, [RECOVERY_EMAIL, disabledPasswordHash()]);
    const customerId = String(customer.rows[0].customer_id);
    const encryptedCredential = encryptSecret(JSON.stringify({
      apiKeyId: environment.ALPACA_API_KEY, apiSecret: environment.ALPACA_SECRET_KEY,
    }), environment.PAPER_COPY_TOKEN_ENCRYPTION_KEY, customerId);
    const store = new PostgresCustomerStore(pool);
    const saved = await store.saveFollower({
      customerId,
      providerAccountRef: verification.account.id,
      maskedAccount: `••••${verification.account.id.slice(-4)}`,
      connectionMethod: 'PAPER_API_KEY_PRIVATE_BETA',
      accountStatus: verification.account.status ?? null,
      equity: verification.account.equity ?? null,
      buyingPower: verification.account.buying_power ?? null,
      cash: verification.account.cash ?? null,
      optionsBuyingPower: verification.account.options_buying_power ?? null,
      optionsApprovedLevel: verification.account.options_approved_level ?? null,
      optionsTradingLevel: verification.account.options_trading_level ?? null,
      accountReady: verification.ready,
      openPositionCount: verification.positions.length,
      openOrderCount: verification.openOrders.length,
      marketIsOpen: verification.marketOpen,
      restrictions: {
        trading_blocked: verification.account.trading_blocked === true,
        account_blocked: verification.account.account_blocked === true,
        transfers_blocked: verification.account.transfers_blocked === true,
      },
      keyRef: environment.PAPER_COPY_TOKEN_KEY_REF,
      encryptedCredential,
      scope: 'aiven-master-paper-recovery',
    });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(863801010)');
      const row = await client.query(`SELECT follower_account_id,account_role,provider_account_ref
        FROM copy.follower_account WHERE customer_id=$1 AND disconnected_at IS NULL FOR UPDATE`, [customerId]);
      if (row.rowCount !== 1 || row.rows[0].provider_account_ref !== verification.account.id)
        throw new Error('MASTER_CONNECTION_IDENTITY_MISMATCH');
      const otherMaster = await client.query(`SELECT 1 FROM copy.follower_account
        WHERE account_role='MASTER_THETA_PAPER' AND customer_id<>$1 LIMIT 1`, [customerId]);
      if (otherMaster.rowCount) throw new Error('MASTER_CONNECTION_ALREADY_EXISTS');
      const followerHistory = await client.query(`SELECT 1 FROM copy.follower_copy_event
        WHERE follower_account_id=$1 LIMIT 1`, [row.rows[0].follower_account_id]);
      if (followerHistory.rowCount) throw new Error('FOLLOWER_HISTORY_REQUIRES_RECONCILIATION');
      await client.query(`UPDATE copy.customer_participation SET state='BLOCKED',updated_at=now()
        WHERE customer_id=$1`, [customerId]);
      await client.query(`UPDATE copy.follower_policy SET superseded_at=now()
        WHERE follower_account_id=$1 AND superseded_at IS NULL`, [row.rows[0].follower_account_id]);
      if (row.rows[0].account_role !== 'MASTER_THETA_PAPER') {
        await client.query(`UPDATE copy.follower_account SET account_role='MASTER_THETA_PAPER',
          participation='STOP_NEW_TRADES_MANAGE_EXISTING',updated_at=now()
          WHERE follower_account_id=$1`, [row.rows[0].follower_account_id]);
        await client.query(`INSERT INTO ops.paper_account_role_event(connection_id,account_role,reason)
          VALUES($1,'MASTER_THETA_PAPER','AIVEN_RECOVERY_VERIFIED_SERVER_PAPER_IDENTITY')`, [row.rows[0].follower_account_id]);
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    return {
      state: 'RECOVERED', accountRole: 'MASTER_THETA_PAPER', paperHost: ALPACA_PAPER_BASE_URL,
      maskedBrokerIdentity: saved.maskedAccount, accountStatus: verification.account.status ?? null,
      optionsApprovedLevel: verification.account.options_approved_level ?? null,
      optionsTradingLevel: verification.account.options_trading_level ?? null,
      positionCount: verification.positions.length, openOrderCount: verification.openOrders.length,
      marketOpen: verification.marketOpen, calendarSessionCount: verification.calendar.length,
      credentialStorage: 'AES_256_GCM_SERVER_SIDE', loginState: 'DISABLED_SERVICE_IDENTITY',
      selfCopyAllowed: false, orderSubmission: 'LOCKED',
    } as const;
  } finally {
    await pool.end();
  }
}
