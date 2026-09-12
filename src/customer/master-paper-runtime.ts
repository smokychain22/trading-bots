import { z } from 'zod';
import type { Environment } from '../config/environment.js';
import { AlpacaPaperBrokerAdapter } from '../execution/broker.js';
import {
  fetchMarketCalendar,
  fetchMarketClock,
  fetchOpenOrders,
  fetchPositions,
  type AlpacaProviderConfig,
} from '../theta/alpaca-provider.js';
import { MasterEncryptedStoreBrokerCredentialProvider } from './broker-credential-provider.js';
import type { CustomerStore, MasterCredentialStore } from './customer-store.js';

const accountSchema = z.object({
  id: z.string().min(1),
  status: z.string().nullable().optional(),
  equity: z.union([z.string(), z.number()]).nullable().optional(),
  cash: z.union([z.string(), z.number()]).nullable().optional(),
  buying_power: z.union([z.string(), z.number()]).nullable().optional(),
  options_buying_power: z.union([z.string(), z.number()]).nullable().optional(),
  options_approved_level: z.union([z.string(), z.number()]).nullable().optional(),
  options_trading_level: z.union([z.string(), z.number()]).nullable().optional(),
  trading_blocked: z.boolean().nullable().optional(),
  transfers_blocked: z.boolean().nullable().optional(),
}).passthrough();

const numberOrNull = (value: string | number | null | undefined): number | null => {
  if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export function masterOptionsAccountReady(input: {
  status: string | null; approvedLevel: number | null; tradingLevel: number | null;
  tradingBlocked: boolean | null;
}): boolean {
  return input.status === 'ACTIVE' && input.tradingBlocked === false
    && input.approvedLevel !== null && Number.isInteger(input.approvedLevel) && input.approvedLevel >= 1
    && input.tradingLevel !== null && Number.isInteger(input.tradingLevel) && input.tradingLevel >= 1;
}

export interface StoredMasterPaperReadiness {
  readonly connectionState: 'CONNECTED' | 'NOT_CONFIGURED' | 'INVALID';
  readonly accountRole: 'MASTER_THETA_PAPER';
  readonly brokerHost: 'https://paper-api.alpaca.markets';
  readonly brokerIdentityVerified: boolean;
  readonly maskedAccount: string | null;
  readonly accountStatus: string | null;
  readonly equity: number | null;
  readonly cash: number | null;
  readonly buyingPower: number | null;
  readonly optionsBuyingPower: number | null;
  readonly optionsApprovedLevel: number | null;
  readonly optionsTradingLevel: number | null;
  readonly openPositions: number | null;
  readonly openOrders: number | null;
  readonly marketOpen: boolean | null;
  readonly calendarSessionConfirmed: boolean;
  readonly observedAt: string;
  readonly orderSubmission: 'LOCKED';
  readonly reasonCode: string | null;
}

const unavailable = (state: 'NOT_CONFIGURED' | 'INVALID', observedAt: string, reasonCode: string): StoredMasterPaperReadiness => ({
  connectionState: state, accountRole: 'MASTER_THETA_PAPER', brokerHost: 'https://paper-api.alpaca.markets',
  brokerIdentityVerified: false, maskedAccount: null, accountStatus: null, equity: null, cash: null,
  buyingPower: null, optionsBuyingPower: null, optionsApprovedLevel: null, optionsTradingLevel: null,
  openPositions: null, openOrders: null, marketOpen: null, calendarSessionConfirmed: false,
  observedAt, orderSubmission: 'LOCKED', reasonCode,
});

/** Resolves and verifies the designated master. There is no order mutation path. */
export async function verifyStoredMasterPaperConnection(
  environment: Environment,
  store: CustomerStore & MasterCredentialStore,
  now = new Date(),
): Promise<StoredMasterPaperReadiness> {
  const observedAt = now.toISOString();
  if (!environment.PAPER_COPY_TOKEN_ENCRYPTION_KEY || !environment.PAPER_COPY_TOKEN_KEY_REF) {
    return unavailable('NOT_CONFIGURED', observedAt, 'MASTER_CREDENTIAL_DECRYPTION_NOT_CONFIGURED');
  }
  const resolved = await new MasterEncryptedStoreBrokerCredentialProvider(store, environment).getAuthentication();
  if (resolved === null) return unavailable('NOT_CONFIGURED', observedAt, 'MASTER_CREDENTIAL_NOT_FOUND');

  const brokerHost = 'https://paper-api.alpaca.markets' as const;
  const broker = new AlpacaPaperBrokerAdapter({ baseUrl: brokerHost, authentication: resolved.authentication });
  const rawAccount = accountSchema.parse(await broker.getAccount());
  if (rawAccount.id !== resolved.providerAccountRef) {
    await store.markFollowerNeedsAttention(resolved.customerId);
    return unavailable('INVALID', observedAt, 'MASTER_BROKER_IDENTITY_MISMATCH');
  }
  const config: AlpacaProviderConfig = {
    tradingApiBase: brokerHost,
    marketDataApiBase: 'https://data.alpaca.markets',
    apiKey: resolved.authentication.apiKey,
    apiSecret: resolved.authentication.apiSecret,
  };
  const [positions, orders, clock, calendar] = await Promise.all([
    fetchPositions(config, observedAt), fetchOpenOrders(config, observedAt), fetchMarketClock(config, observedAt),
    fetchMarketCalendar(config, observedAt.slice(0, 10), observedAt.slice(0, 10)),
  ]);
  const accountStatus = rawAccount.status ?? null;
  const optionsApprovedLevel = numberOrNull(rawAccount.options_approved_level);
  const optionsTradingLevel = numberOrNull(rawAccount.options_trading_level);
  const restrictions = { tradingBlocked: rawAccount.trading_blocked === true, transfersBlocked: rawAccount.transfers_blocked === true };
  const accountReady = masterOptionsAccountReady({status:accountStatus,approvedLevel:optionsApprovedLevel,
    tradingLevel:optionsTradingLevel,tradingBlocked:rawAccount.trading_blocked ?? null});
  await store.updateFollowerVerification(resolved.customerId, {
    accountStatus, equity: numberOrNull(rawAccount.equity), cash: numberOrNull(rawAccount.cash),
    buyingPower: numberOrNull(rawAccount.buying_power), optionsBuyingPower: numberOrNull(rawAccount.options_buying_power),
    optionsApprovedLevel, optionsTradingLevel, accountReady, openPositionCount: positions.length,
    openOrderCount: orders.length, marketIsOpen: clock.isOpen, restrictions,
  });
  return {
    connectionState: accountReady ? 'CONNECTED' : 'INVALID', accountRole: 'MASTER_THETA_PAPER', brokerHost,
    brokerIdentityVerified: true, maskedAccount: `••••${rawAccount.id.slice(-4)}`, accountStatus,
    equity: numberOrNull(rawAccount.equity), cash: numberOrNull(rawAccount.cash), buyingPower: numberOrNull(rawAccount.buying_power),
    optionsBuyingPower: numberOrNull(rawAccount.options_buying_power), optionsApprovedLevel, optionsTradingLevel,
    openPositions: positions.length, openOrders: orders.length, marketOpen: clock.isOpen,
    calendarSessionConfirmed: calendar.some((session) => session.date === observedAt.slice(0, 10) && session.open !== null && session.close !== null),
    observedAt, orderSubmission: 'LOCKED', reasonCode: accountReady ? null : 'MASTER_ACCOUNT_NOT_READY',
  };
}
