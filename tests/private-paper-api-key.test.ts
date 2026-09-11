import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes } from "node:crypto";
import { loadEnvironment } from "../src/config/environment.js";
import { connectPrivatePaperApiKey, privatePaperCredentialSchema } from "../src/customer/private-paper-api-key.js";
import { verifyAlpacaPaperAccount } from "../src/customer/alpaca-paper-verification.js";
import { EncryptedStoreBrokerCredentialProvider, MasterEncryptedStoreBrokerCredentialProvider } from "../src/customer/broker-credential-provider.js";
import { encryptSecret } from "../src/customer/customer-security.js";
import { reverifyStoredFollowerAccount } from "../src/customer/alpaca-oauth.js";
import type { CustomerIdentity, CustomerStore, FollowerRecord, MasterCredentialStore, OAuthStateRecord, SaveFollowerInput, StoredFollowerCredential } from "../src/customer/customer-store.js";

const encryptionKey = randomBytes(32).toString("base64");
const environment = loadEnvironment({
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://synthetic.invalid/test",
  PAPER_COPY_TOKEN_KEY_REF: "private-beta-v1",
  PAPER_COPY_TOKEN_ENCRYPTION_KEY: encryptionKey,
  PRIVATE_PAPER_API_KEY_BETA_ENABLED: "true",
});

class MemoryStore implements CustomerStore {
  needsAttentionCount = 0;
  inputs = new Map<string, SaveFollowerInput>();
  records = new Map<string, FollowerRecord>();
  async createCustomer(): Promise<CustomerIdentity> { throw new Error("unused"); }
  async findCustomerByEmail(): Promise<CustomerIdentity | null> { return null; }
  async createSession(): Promise<void> {}
  async getSession(): Promise<CustomerIdentity | null> { return null; }
  async revokeSession(): Promise<void> {}
  async createOAuthState(): Promise<void> {}
  async consumeOAuthState(): Promise<OAuthStateRecord | null> { return null; }
  async saveFollower(input: SaveFollowerInput) {
    this.inputs.set(input.customerId, input);
    const record: FollowerRecord = {
      customerId: input.customerId, followerAccountId: `follower-${input.customerId}`,
      maskedAccount: input.maskedAccount, connectionMethod: input.connectionMethod,
      accountStatus: input.accountStatus, equity: input.equity, buyingPower: input.buyingPower,
      cash: input.cash, optionsBuyingPower: input.optionsBuyingPower,
      optionsApprovedLevel: input.optionsApprovedLevel, optionsTradingLevel: input.optionsTradingLevel,
      accountReady: input.accountReady, connectionStatus: "CONNECTED",
      lastBrokerSyncAt: new Date().toISOString(), openPositionCount: input.openPositionCount,
      openOrderCount: input.openOrderCount, marketIsOpen: input.marketIsOpen,
      participation: "READY", allocationUsd: null,
    };
    this.records.set(input.customerId, record);
    return record;
  }
  async getFollower(customerId: string) { return this.records.get(customerId) ?? null; }
  async getFollowerCredential(customerId: string): Promise<StoredFollowerCredential | null> {
    const input = this.inputs.get(customerId);
    return input ? { ...input.encryptedCredential, keyRef: input.keyRef, connectionMethod: input.connectionMethod } : null;
  }
  async updateFollowerVerification(customerId: string) { const record = this.records.get(customerId); if (!record) throw new Error("missing"); return record; }
  async markFollowerNeedsAttention(): Promise<void> { this.needsAttentionCount += 1; }
  async saveParticipation(customerId: string) { const record = this.records.get(customerId); if (!record) throw new Error("missing"); return record; }
  async disconnectFollower(customerId: string) { this.records.delete(customerId); this.inputs.delete(customerId); }
}

function paperFetch(expectedKey: string, expectedSecret: string): typeof fetch {
  return async (input, init) => {
    const headers = new Headers(init?.headers);
    if (headers.get("APCA-API-KEY-ID") !== expectedKey || headers.get("APCA-API-SECRET-KEY") !== expectedSecret)
      return Response.json({ message: "unauthorized" }, { status: 401 });
    const path = new URL(String(input)).pathname;
    if (path === "/v2/account") return Response.json({
      id: "paper-account-abcd", status: "ACTIVE", equity: "25000", cash: "12000",
      buying_power: "48000", options_buying_power: "12000", options_approved_level: 2,
      options_trading_level: 2, trading_blocked: false, account_blocked: false,
    });
    if (path === "/v2/positions") return Response.json([{ symbol: "AAPL" }]);
    if (path === "/v2/orders") return Response.json([]);
    if (path === "/v2/clock") return Response.json({ is_open: false, timestamp: new Date().toISOString() });
    if (path === "/v2/calendar") return Response.json([{ date: "2026-09-11", open: "09:30", close: "16:00" }]);
    return Response.json({}, { status: 404 });
  };
}

test("valid private credentials verify real read capabilities and persist only ciphertext", async () => {
  const store = new MemoryStore();
  const apiKeyId = "paper-key-id";
  const secret = "paper-secret-value";
  const follower = await connectPrivatePaperApiKey(store, environment, "customer-a", {
    api_key_id: apiKeyId, secret_key: secret,
  }, paperFetch(apiKeyId, secret));
  assert.equal(follower.connectionMethod, "PAPER_API_KEY_PRIVATE_BETA");
  assert.equal(follower.equity, 25000);
  assert.equal(follower.openPositionCount, 1);
  assert.equal(follower.openOrderCount, 0);
  assert.equal(follower.marketIsOpen, false);
  const saved = store.inputs.get("customer-a");
  assert(saved);
  const persisted = Buffer.concat([saved.encryptedCredential.ciphertext, saved.encryptedCredential.iv, saved.encryptedCredential.authTag]).toString();
  assert.equal(persisted.includes(apiKeyId), false);
  assert.equal(persisted.includes(secret), false);
  assert.equal(JSON.stringify(follower).includes(apiKeyId), false);
  assert.equal(JSON.stringify(follower).includes(secret), false);
  const resolved = await new EncryptedStoreBrokerCredentialProvider(store, environment).getAuthentication("customer-a");
  assert.deepEqual(resolved, { method: "PAPER_API_KEY_PRIVATE_BETA", authentication: { kind: "FOLLOWER_API_KEY", apiKey: apiKeyId, apiSecret: secret } });
});

test("invalid, missing, and non-ready credentials fail before persistence", async () => {
  const store = new MemoryStore();
  await assert.rejects(connectPrivatePaperApiKey(store, environment, "customer-a", { api_key_id: "bad", secret_key: "bad" }, paperFetch("good", "good")), /Alpaca PAPER/);
  assert.throws(() => privatePaperCredentialSchema.parse({ api_key_id: "present" }));
  assert.throws(() => privatePaperCredentialSchema.parse({ secret_key: "present" }));
  const noOptions = paperFetch("key", "secret");
  const wrapped: typeof fetch = async (input, init) => new URL(String(input)).pathname === "/v2/account"
    ? Response.json({ id: "paper-account-abcd", status: "ACTIVE", options_approved_level: 0, options_trading_level: 0 })
    : noOptions(input, init);
  await assert.rejects(connectPrivatePaperApiKey(store, environment, "customer-a", { api_key_id: "key", secret_key: "secret" }, wrapped), /ACCOUNT_NOT_READY/);
  assert.equal(store.inputs.size, 0);
});

test("live or altered host is rejected before any provider request", async () => {
  let called = false;
  const neverFetch: typeof fetch = async () => { called = true; return Response.json({}); };
  await assert.rejects(verifyAlpacaPaperAccount({ kind: "FOLLOWER_API_KEY", apiKey: "key", apiSecret: "secret" }, neverFetch, "https://api.alpaca.markets"), /HOST_REJECTED/);
  assert.equal(called, false);
});

test("tenant isolation, replacement, and disconnect keep credentials customer-bound", async () => {
  const store = new MemoryStore();
  await connectPrivatePaperApiKey(store, environment, "customer-a", { api_key_id: "key-a", secret_key: "secret-a" }, paperFetch("key-a", "secret-a"));
  await connectPrivatePaperApiKey(store, environment, "customer-b", { api_key_id: "key-b", secret_key: "secret-b" }, paperFetch("key-b", "secret-b"));
  const provider = new EncryptedStoreBrokerCredentialProvider(store, environment);
  assert.equal((await provider.getAuthentication("customer-a"))?.authentication.kind, "FOLLOWER_API_KEY");
  assert.notDeepEqual(await provider.getAuthentication("customer-a"), await provider.getAuthentication("customer-b"));
  const oldCiphertext = store.inputs.get("customer-a")?.encryptedCredential.ciphertext.toString("hex");
  await connectPrivatePaperApiKey(store, environment, "customer-a", { api_key_id: "key-new", secret_key: "secret-new" }, paperFetch("key-new", "secret-new"));
  assert.notEqual(store.inputs.get("customer-a")?.encryptedCredential.ciphertext.toString("hex"), oldCiphertext);
  assert.equal((await provider.getAuthentication("customer-a"))?.authentication.kind, "FOLLOWER_API_KEY");
  await store.disconnectFollower("customer-a");
  assert.equal(await provider.getAuthentication("customer-a"), null);
  assert(await provider.getAuthentication("customer-b"));
});

test("autonomous master credential resolution is role-scoped and emits MASTER_API_KEY only", async () => {
  const customerId = "master-customer";
  const encrypted = encryptSecret(JSON.stringify({ apiKeyId: "master-key", apiSecret: "master-secret" }), encryptionKey, customerId);
  const store: MasterCredentialStore = { getMasterCredential: async () => ({
    ...encrypted, customerId, providerAccountRef: "paper-account-master",
    keyRef: "private-beta-v1", connectionMethod: "PAPER_API_KEY_PRIVATE_BETA",
  }) };
  const resolved = await new MasterEncryptedStoreBrokerCredentialProvider(store, environment).getAuthentication();
  assert.equal(resolved?.authentication.kind, "MASTER_API_KEY");
  assert.equal(resolved?.providerAccountRef, "paper-account-master");
  assert.equal(JSON.stringify({ method: resolved?.method, providerAccountRef: resolved?.providerAccountRef }).includes("master-secret"), false);
});

test("reverify preserves a working connection during an Alpaca outage and flags confirmed credential rejection", async () => {
  const store = new MemoryStore();
  await connectPrivatePaperApiKey(store, environment, "customer-a", {
    api_key_id: "key-a", secret_key: "secret-a",
  }, paperFetch("key-a", "secret-a"));
  const unavailable: typeof fetch = async () => { throw new TypeError("synthetic network outage"); };
  await assert.rejects(reverifyStoredFollowerAccount(store, environment, "customer-a", unavailable), /request failed/);
  assert.equal(store.needsAttentionCount, 0);
  assert.equal(store.records.get("customer-a")?.connectionStatus, "CONNECTED");

  const rejected: typeof fetch = async () => Response.json({ message: "unauthorized" }, { status: 401 });
  await assert.rejects(reverifyStoredFollowerAccount(store, environment, "customer-a", rejected), /HTTP 401/);
  assert.equal(store.needsAttentionCount, 1);
});

