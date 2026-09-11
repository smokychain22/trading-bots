import { z } from "zod";
import type { Environment } from "../config/environment.js";
import { AlpacaPaperBrokerError } from "../execution/broker.js";
import type { CustomerStore, FollowerRecord } from "./customer-store.js";
import {
  encryptSecret,
  randomOpaqueToken,
  sha256,
} from "./customer-security.js";
import { EncryptedStoreBrokerCredentialProvider } from "./broker-credential-provider.js";
import { verifyAlpacaPaperAccount, type FollowerVerification } from "./alpaca-paper-verification.js";

const oauthTokenSchema = z.object({
  access_token: z.string().min(20),
  token_type: z.string().min(1),
  scope: z.string().default(""),
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
    scope: "trading",
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

export async function verifyFollowerAccount(
  accessToken: string,
): Promise<FollowerVerification> {
  return verifyAlpacaPaperAccount({ kind: "FOLLOWER_OAUTH", accessToken });
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
  const grantedScopes = new Set(token.scope.split(/\s+/).filter(Boolean));
  if (!grantedScopes.has("trading"))
    throw new Error("ALPACA_OAUTH_SCOPE_INSUFFICIENT");
  const verification = await verifyFollowerAccount(token.access_token);
  const account = verification.account;
  const encryptedCredential = encryptSecret(
    token.access_token,
    environment.PAPER_COPY_TOKEN_ENCRYPTION_KEY ?? "",
    customerId,
  );
  const follower = await store.saveFollower({
    customerId,
    providerAccountRef: account.id,
    maskedAccount: `••••${account.id.slice(-4)}`,
    connectionMethod: "ALPACA_OAUTH",
    accountStatus: account.status ?? null,
    equity: account.equity ?? null,
    buyingPower: account.buying_power ?? null,
    cash: account.cash ?? null,
    optionsBuyingPower: account.options_buying_power ?? null,
    optionsApprovedLevel: account.options_approved_level ?? null,
    optionsTradingLevel: account.options_trading_level ?? null,
    accountReady: verification.ready,
    openPositionCount: verification.positions.length,
    openOrderCount: verification.openOrders.length,
    marketIsOpen: verification.marketOpen,
    restrictions: {
      trading_blocked: account.trading_blocked === true,
      account_blocked: account.account_blocked === true,
      transfers_blocked: account.transfers_blocked === true,
    },
    keyRef: environment.PAPER_COPY_TOKEN_KEY_REF ?? "",
    encryptedCredential,
    scope: token.scope,
  });
  return { follower, returnPath: stateRecord.returnPath };
}

export async function verifyStoredFollowerAccount(
  store: CustomerStore,
  environment: Environment,
  customerId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<FollowerVerification> {
  const credential = await new EncryptedStoreBrokerCredentialProvider(store, environment)
    .getAuthentication(customerId);
  if (!credential) throw new Error("FOLLOWER_CREDENTIAL_NOT_AVAILABLE");
  return verifyAlpacaPaperAccount(credential.authentication, fetchImpl);
}

export async function reverifyStoredFollowerAccount(
  store: CustomerStore,
  environment: Environment,
  customerId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<FollowerRecord> {
  try {
    const verification = await verifyStoredFollowerAccount(store, environment, customerId, fetchImpl);
    return store.updateFollowerVerification(customerId, {
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
    });
  } catch (error) {
    // A transient provider or network failure must not revoke a previously valid
    // connection. Only confirmed credential rejection changes stored health.
    if (error instanceof AlpacaPaperBrokerError && error.category === "INVALID_AUTH")
      await store.markFollowerNeedsAttention(customerId);
    throw error;
  }
}
