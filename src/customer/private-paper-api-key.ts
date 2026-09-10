import { z } from "zod";
import type { Environment } from "../config/environment.js";
import type { CustomerStore, FollowerRecord } from "./customer-store.js";
import { encryptSecret } from "./customer-security.js";
import { verifyAlpacaPaperAccount } from "./alpaca-paper-verification.js";

export const privatePaperCredentialSchema = z.object({
  api_key_id: z.string().trim().min(1).max(256),
  secret_key: z.string().min(1).max(512),
}).strict();

export function privatePaperApiKeyConfiguration(environment: Environment) {
  const missing = ["DATABASE_URL", "PAPER_COPY_TOKEN_KEY_REF", "PAPER_COPY_TOKEN_ENCRYPTION_KEY"]
    .filter((name) => !environment[name as keyof Environment]);
  return { configured: environment.PRIVATE_PAPER_API_KEY_BETA_ENABLED && missing.length === 0, missing };
}

export async function connectPrivatePaperApiKey(
  store: CustomerStore,
  environment: Environment,
  customerId: string,
  raw: unknown,
  fetchImpl: typeof fetch = fetch,
): Promise<FollowerRecord> {
  if (!privatePaperApiKeyConfiguration(environment).configured)
    throw new Error("PRIVATE_PAPER_API_KEY_BETA_NOT_CONFIGURED");
  const input = privatePaperCredentialSchema.parse(raw);
  const verification = await verifyAlpacaPaperAccount({
    kind: "FOLLOWER_API_KEY",
    apiKey: input.api_key_id,
    apiSecret: input.secret_key,
  }, fetchImpl);
  if (!verification.ready) throw new Error("ALPACA_PAPER_ACCOUNT_NOT_READY");
  const account = verification.account;
  const encryptedCredential = encryptSecret(JSON.stringify({
    apiKeyId: input.api_key_id,
    apiSecret: input.secret_key,
  }), environment.PAPER_COPY_TOKEN_ENCRYPTION_KEY ?? "", customerId);
  return store.saveFollower({
    customerId,
    providerAccountRef: account.id,
    maskedAccount: `••••${account.id.slice(-4)}`,
    connectionMethod: "PAPER_API_KEY_PRIVATE_BETA",
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
    scope: "private-paper-api-key-beta",
  });
}
