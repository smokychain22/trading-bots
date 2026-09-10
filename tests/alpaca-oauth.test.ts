import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAlpacaAuthorizationUrl,
  completeAlpacaOAuth,
  oauthConfiguration,
  startAlpacaOAuth,
  verifyFollowerAccount,
} from "../src/customer/alpaca-oauth.js";
import { loadEnvironment } from "../src/config/environment.js";
import type {
  CustomerIdentity,
  CustomerStore,
  FollowerRecord,
  OAuthStateRecord,
  SaveFollowerInput,
} from "../src/customer/customer-store.js";
import { sha256 } from "../src/customer/customer-security.js";

const environment = loadEnvironment({
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://synthetic.invalid/test",
  ALPACA_OAUTH_CLIENT_ID: "synthetic-client-id",
  ALPACA_OAUTH_CLIENT_SECRET: "synthetic-client-secret",
  ALPACA_OAUTH_REDIRECT_URI: "https://trading-bots-one.vercel.app/api/v1/alpaca/oauth/callback",
  PAPER_COPY_TOKEN_KEY_REF: "paper-copy-v1",
  PAPER_COPY_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64"),
});

class MemoryStore implements CustomerStore {
  state = new Map<string, { customerId: string; returnPath: string; expiresAt: Date; consumed: boolean }>();
  savedTokenPlaintext = false;
  follower: FollowerRecord | null = null;
  async createCustomer(): Promise<CustomerIdentity> { throw new Error("unused"); }
  async findCustomerByEmail(): Promise<CustomerIdentity | null> { return null; }
  async createSession(): Promise<void> {}
  async getSession(): Promise<CustomerIdentity | null> { return null; }
  async revokeSession(): Promise<void> {}
  async createOAuthState(stateHash: string, customerId: string, returnPath: string, expiresAt: Date) {
    this.state.set(stateHash, { customerId, returnPath, expiresAt, consumed: false });
  }
  async consumeOAuthState(stateHash: string, customerId: string, now: Date): Promise<OAuthStateRecord | null> {
    const item = this.state.get(stateHash);
    if (!item || item.customerId !== customerId || item.consumed || item.expiresAt <= now) return null;
    item.consumed = true;
    return { customerId, returnPath: item.returnPath };
  }
  async saveFollower(input: SaveFollowerInput) {
    this.savedTokenPlaintext = input.encryptedCredential.ciphertext.toString().includes("oauth-access-token");
    this.follower = {
      customerId: input.customerId,
      followerAccountId: "follower-1",
      maskedAccount: input.maskedAccount,
      connectionMethod: input.connectionMethod,
      accountStatus: input.accountStatus,
      equity: input.equity,
      buyingPower: input.buyingPower,
      cash: input.cash,
      optionsBuyingPower: input.optionsBuyingPower,
      optionsApprovedLevel: input.optionsApprovedLevel,
      optionsTradingLevel: input.optionsTradingLevel,
      accountReady: input.accountReady,
      connectionStatus: "CONNECTED",
      lastBrokerSyncAt: new Date().toISOString(),
      openPositionCount: input.openPositionCount,
      openOrderCount: input.openOrderCount,
      marketIsOpen: input.marketIsOpen,
      participation: "READY",
      allocationUsd: null,
    };
    return this.follower;
  }
  async getFollower() { return this.follower; }
  async getFollowerCredential() { return null; }
  async updateFollowerVerification(): Promise<FollowerRecord> { if (!this.follower) throw new Error("missing"); return this.follower; }
  async markFollowerNeedsAttention(): Promise<void> {}
  async saveParticipation(): Promise<FollowerRecord> { if (!this.follower) throw new Error("missing"); return this.follower; }
  async disconnectFollower(): Promise<void> { this.follower = null; }
}

test("authorization URL is official, PAPER-only, state-bound, and minimally scoped", () => {
  const url = buildAlpacaAuthorizationUrl(environment, "synthetic-state");
  assert.equal(url.origin, "https://app.alpaca.markets");
  assert.equal(url.pathname, "/oauth/authorize");
  assert.equal(url.searchParams.get("env"), "paper");
  assert.equal(url.searchParams.get("scope"), "trading");
  assert.equal(url.searchParams.get("state"), "synthetic-state");
  assert.equal(url.searchParams.get("redirect_uri"), environment.ALPACA_OAUTH_REDIRECT_URI);
  assert.equal(url.searchParams.has("client_secret"), false);
});

test("configuration reports exact missing variable names without values", () => {
  const result = oauthConfiguration(loadEnvironment({ NODE_ENV: "test" }));
  assert.equal(result.configured, false);
  assert(result.missing.includes("DATABASE_URL"));
  assert(result.missing.includes("PAPER_COPY_TOKEN_ENCRYPTION_KEY"));
});

test("OAuth callback consumes state once, verifies paper account, and stores only ciphertext", async () => {
  const store = new MemoryStore();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === "https://api.alpaca.markets/oauth/token")
      return Response.json({ access_token: "synthetic-oauth-access-token-1234567890", token_type: "bearer", scope: "trading" });
    if (url.endsWith("/v2/account"))
      return Response.json({ id: "paper-account-1234", status: "ACTIVE", equity: "20000", cash: "10000", buying_power: "20000", options_buying_power: "15000", options_approved_level: 3, options_trading_level: 3, trading_blocked: false, account_blocked: false });
    if (url.endsWith("/v2/clock")) return Response.json({ is_open: false });
    return Response.json([]);
  };
  try {
    const authorization = await startAlpacaOAuth(store, environment, "customer-a");
    const state = authorization.searchParams.get("state");
    assert(state);
    assert(store.state.has(sha256(state)));
    const completed = await completeAlpacaOAuth(store, environment, "customer-a", state, "temporary-code");
    assert.equal(completed.follower.accountReady, true);
    assert.equal(completed.follower.maskedAccount, "••••1234");
    assert.equal(store.savedTokenPlaintext, false);
    await assert.rejects(
      completeAlpacaOAuth(store, environment, "customer-a", state, "temporary-code"),
      /OAUTH_STATE_INVALID_EXPIRED_OR_REPLAYED/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("THETA core requires options level 1, while level 0 remains blocked", async () => {
  const originalFetch = globalThis.fetch;
  let level = 0;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/v2/account"))
      return Response.json({
        id: "paper-account-1234",
        status: "ACTIVE",
        equity: "20000",
        cash: "10000",
        buying_power: "20000",
        options_buying_power: "10000",
        options_approved_level: level,
        options_trading_level: level,
        trading_blocked: false,
        account_blocked: false,
      });
    if (url.endsWith("/v2/clock")) return Response.json({ is_open: false });
    return Response.json([]);
  };
  try {
    for (const expectedLevel of [0, 1, 2, 3]) {
      level = expectedLevel;
      const result = await verifyFollowerAccount("synthetic-oauth-token-1234567890");
      assert.equal(result.ready, expectedLevel >= 1, `level ${expectedLevel}`);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("OAuth state cannot be consumed by another customer or after expiry", async () => {
  const store = new MemoryStore();
  await store.createOAuthState("owner-state", "customer-a", "/bots/theta/copy", new Date(Date.now() + 1000));
  assert.equal(await store.consumeOAuthState("owner-state", "customer-b", new Date()), null);
  await store.createOAuthState("expired", "customer-a", "/bots/theta/copy", new Date(Date.now() - 1));
  assert.equal(await store.consumeOAuthState("expired", "customer-a", new Date()), null);
});
