import { z } from "zod";
import type { Environment } from "../config/environment.js";
import type { CustomerStore, FollowerRecord } from "./customer-store.js";
import {
  encryptSecret,
  randomOpaqueToken,
  sha256,
} from "./customer-security.js";

const oauthTokenSchema = z.object({
  access_token: z.string().min(20),
  token_type: z.string().min(1),
  scope: z.string().default(""),
});

const accountSchema = z.object({
  id: z.string().min(4),
  status: z.string().nullable().optional(),
  cash: z.coerce.number().finite().nullable().optional(),
  buying_power: z.coerce.number().finite().nullable().optional(),
  options_buying_power: z.coerce.number().finite().nullable().optional(),
  options_approved_level: z.number().int().nullable().optional(),
  options_trading_level: z.number().int().nullable().optional(),
  trading_blocked: z.boolean().optional(),
  account_blocked: z.boolean().optional(),
  transfers_blocked: z.boolean().optional(),
});

export function oauthConfiguration(environment: Environment) {
  const missing = [
    "DATABASE_URL",
    "ALPACA_OAUTH_CLIENT_ID",
    "ALPACA_OAUTH_CLIENT_SECRET",
    "ALPACA_OAUTH_REDIRECT_URI",
    "PAPER_COPY_TOKEN_KEY_REF",
    "PAPER_COPY_TOKEN_ENCRYPTION_KEY",
  ].filter((name) => !environment[name as keyof Environment]);
  return { configured: missing.length === 0, missing };
}

export function buildAlpacaAuthorizationUrl(
  environment: Environment,
  state: string,
): URL {
  const url = new URL("https://app.alpaca.markets/oauth/authorize");
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: environment.ALPACA_OAUTH_CLIENT_ID ?? "",
    redirect_uri: environment.ALPACA_OAUTH_REDIRECT_URI ?? "",
    state,
    scope: "trading data",
    env: "paper",
  }).toString();
  return url;
}

export async function startAlpacaOAuth(
  store: CustomerStore,
  environment: Environment,
  customerId: string,
  returnPath = "/bots/theta/copy",
): Promise<URL> {
  const configuration = oauthConfiguration(environment);
  if (!configuration.configured) throw new Error("ALPACA_OAUTH_NOT_CONFIGURED");
  const state = randomOpaqueToken();
  await store.createOAuthState(
    sha256(state),
    customerId,
    returnPath,
    new Date(Date.now() + 10 * 60_000),
  );
  return buildAlpacaAuthorizationUrl(environment, state);
}

async function exchangeCode(environment: Environment, code: string) {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: environment.ALPACA_OAUTH_CLIENT_ID ?? "",
    client_secret: environment.ALPACA_OAUTH_CLIENT_SECRET ?? "",
    redirect_uri: environment.ALPACA_OAUTH_REDIRECT_URI ?? "",
  });
  const response = await fetch("https://api.alpaca.markets/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`ALPACA_TOKEN_EXCHANGE_${response.status}`);
  return oauthTokenSchema.parse(await response.json());
}

export type FollowerVerification = {
  readonly account: z.infer<typeof accountSchema>;
  readonly positionsAvailable: boolean;
  readonly openOrdersAvailable: boolean;
  readonly ready: boolean;
  readonly reason: string | null;
};

export async function verifyFollowerAccount(
  accessToken: string,
): Promise<FollowerVerification> {
  const headers = { Authorization: `Bearer ${accessToken}` };
  const [accountResponse, positionsResponse, ordersResponse] = await Promise.all([
    fetch("https://paper-api.alpaca.markets/v2/account", {
      headers,
      signal: AbortSignal.timeout(12_000),
    }),
    fetch("https://paper-api.alpaca.markets/v2/positions", {
      headers,
      signal: AbortSignal.timeout(12_000),
    }),
    fetch("https://paper-api.alpaca.markets/v2/orders?status=open&limit=1", {
      headers,
      signal: AbortSignal.timeout(12_000),
    }),
  ]);
  if (!accountResponse.ok) {
    throw new Error(`ALPACA_FOLLOWER_ACCOUNT_${accountResponse.status}`);
  }
  const account = accountSchema.parse(await accountResponse.json());
  const optionsLevel = account.options_trading_level ?? account.options_approved_level ?? 0;
  const active = account.status === "ACTIVE";
  const blocked = account.trading_blocked === true || account.account_blocked === true;
  const ready = active && !blocked && optionsLevel >= 2;
  return {
    account,
    positionsAvailable: positionsResponse.ok,
    openOrdersAvailable: ordersResponse.ok,
    ready,
    reason: !active
      ? "Your Alpaca Paper account is not active."
      : blocked
        ? "Your Alpaca Paper account is restricted."
        : optionsLevel < 2
          ? "Your paper account needs options trading enabled before it can copy THETA."
          : !positionsResponse.ok || !ordersResponse.ok
            ? "Alpaca account reconciliation is temporarily unavailable."
            : null,
  };
}

export async function completeAlpacaOAuth(
  store: CustomerStore,
  environment: Environment,
  customerId: string,
  state: string,
  code: string,
): Promise<{ follower: FollowerRecord; returnPath: string }> {
  const configuration = oauthConfiguration(environment);
  if (!configuration.configured) throw new Error("ALPACA_OAUTH_NOT_CONFIGURED");
  const stateRecord = await store.consumeOAuthState(
    sha256(state),
    customerId,
    new Date(),
  );
  if (!stateRecord) throw new Error("OAUTH_STATE_INVALID_EXPIRED_OR_REPLAYED");
  const token = await exchangeCode(environment, code);
  const verification = await verifyFollowerAccount(token.access_token);
  const account = verification.account;
  const encryptedToken = encryptSecret(
    token.access_token,
    environment.PAPER_COPY_TOKEN_ENCRYPTION_KEY ?? "",
    customerId,
  );
  const follower = await store.saveFollower({
    customerId,
    providerAccountRef: account.id,
    maskedAccount: `••••${account.id.slice(-4)}`,
    accountStatus: account.status ?? null,
    buyingPower: account.buying_power ?? null,
    cash: account.cash ?? null,
    optionsBuyingPower: account.options_buying_power ?? null,
    optionsApprovedLevel: account.options_approved_level ?? null,
    optionsTradingLevel: account.options_trading_level ?? null,
    accountReady: verification.ready && verification.positionsAvailable && verification.openOrdersAvailable,
    restrictions: {
      trading_blocked: account.trading_blocked === true,
      account_blocked: account.account_blocked === true,
      transfers_blocked: account.transfers_blocked === true,
    },
    keyRef: environment.PAPER_COPY_TOKEN_KEY_REF ?? "",
    encryptedToken,
    scope: token.scope,
  });
  return { follower, returnPath: stateRecord.returnPath };
}

