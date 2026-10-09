import type { Pool } from 'pg';
import { AlpacaProviderError, fetchMasterAccountEvidence, type AlpacaProviderConfig } from './alpaca-provider.js';
import { managementBrokerAccountMaxAgeMs } from './management-input-state.js';

const refreshMarginMs = 60_000;

/** Refresh the existing master's account evidence before an open-chain decision.
 * The evidence scan runs after management, so its snapshot can be older than
 * management's 180-second limit even when reconciliation just succeeded.
 * This producer cannot create an account or change its authority. */
export async function refreshManagementAccountSnapshot(input: {
  readonly pool: Pool;
  readonly alpaca: AlpacaProviderConfig;
  readonly connectionId: string;
  readonly expectedProviderAccountRef: string;
  readonly now?: () => string;
  readonly readEvidence?: typeof fetchMasterAccountEvidence;
}): Promise<'FRESH' | 'REFRESHED' | 'PROVIDER_UNAVAILABLE'> {
  const now = input.now ?? (() => new Date().toISOString());
  const checkedAt = now();
  if (!Number.isFinite(Date.parse(checkedAt))) throw new Error('MANAGEMENT_ACCOUNT_CLOCK_INVALID');
  const existing = await input.pool.query(`SELECT ta.account_id,
      (SELECT max(s.as_of) FROM trade.account_snapshot s WHERE s.account_id=ta.account_id) AS latest_as_of
    FROM core.trading_account ta JOIN copy.follower_account f
      ON f.workspace_id=ta.workspace_id AND f.provider_account_ref=ta.provider_account_id
    WHERE f.follower_account_id=$1 AND f.account_role='MASTER_THETA_PAPER'
      AND f.environment='PAPER' AND f.connection_status='CONNECTED' AND f.disconnected_at IS NULL
      AND ta.environment='PAPER' AND ta.provider_account_id=$2`,
  [input.connectionId, input.expectedProviderAccountRef]);
  if (existing.rowCount !== 1) throw new Error('MANAGEMENT_MASTER_ACCOUNT_IDENTITY_UNVERIFIED');
  const latest = existing.rows[0]?.latest_as_of;
  const latestMs = latest instanceof Date ? latest.getTime() : Date.parse(String(latest ?? ''));
  const ageMs = Date.parse(checkedAt) - latestMs;
  if (Number.isFinite(ageMs) && ageMs >= 0 && ageMs <= managementBrokerAccountMaxAgeMs - refreshMarginMs) {
    return 'FRESH';
  }

  let evidence: Awaited<ReturnType<typeof fetchMasterAccountEvidence>>;
  try {
    evidence = await (input.readEvidence ?? fetchMasterAccountEvidence)(input.alpaca, now);
  } catch (error) {
    // Keep recording the position's missing-evidence frontier on a transient
    // broker read failure. Invalid authentication and malformed account data
    // remain hard failures, never a reusable account snapshot.
    if (error instanceof AlpacaProviderError &&
      ['RATE_LIMITED','SERVER_ERROR','NETWORK_ERROR','PROVIDER_TIMEOUT'].includes(error.errorClass))
      return 'PROVIDER_UNAVAILABLE';
    throw error;
  }
  if (evidence.providerAccountId !== input.expectedProviderAccountRef)
    throw new Error('MANAGEMENT_MASTER_ACCOUNT_IDENTITY_MISMATCH');
  if (evidence.snapshot.accountStatus !== 'ACTIVE') throw new Error('MANAGEMENT_MASTER_ACCOUNT_NOT_ACTIVE');
  const stored = await input.pool.query(`INSERT INTO trade.account_snapshot(
      account_id,equity,cash,buying_power,options_buying_power,options_level,as_of,retrieved_at)
    SELECT ta.account_id,$3,$4,$5,$6,$7,$8,$8 FROM core.trading_account ta
    JOIN copy.follower_account f ON f.workspace_id=ta.workspace_id
      AND f.provider_account_ref=ta.provider_account_id
    WHERE f.follower_account_id=$1 AND f.account_role='MASTER_THETA_PAPER'
      AND f.environment='PAPER' AND f.connection_status='CONNECTED' AND f.disconnected_at IS NULL
      AND ta.environment='PAPER' AND ta.provider_account_id=$2 AND ta.account_id=$9
    RETURNING account_snapshot_id`,
  [input.connectionId, input.expectedProviderAccountRef,evidence.snapshot.equity,evidence.snapshot.cash,
    evidence.snapshot.buyingPower,evidence.snapshot.optionsBuyingPower,evidence.snapshot.optionsTradingLevel,
    evidence.snapshot.receivedAt,existing.rows[0].account_id]);
  if (stored.rowCount !== 1) throw new Error('MANAGEMENT_MASTER_ACCOUNT_IDENTITY_CHANGED');
  return 'REFRESHED';
}
