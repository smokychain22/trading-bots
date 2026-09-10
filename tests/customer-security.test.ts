import test from "node:test";
import assert from "node:assert/strict";
import {
  decryptSecret,
  encryptSecret,
  hashPassword,
  parseEncryptionKey,
  sha256,
  verifyPassword,
} from "../src/customer/customer-security.js";

test("customer passwords use a salted scrypt verifier", async () => {
  const first = await hashPassword("synthetic-password-one");
  const second = await hashPassword("synthetic-password-one");
  assert.notEqual(first, second);
  assert.equal(await verifyPassword("synthetic-password-one", first), true);
  assert.equal(await verifyPassword("wrong-password-value", first), false);
  assert.equal(first.includes("synthetic-password-one"), false);
});

test("OAuth tokens are authenticated-encrypted and bound to one customer", () => {
  const key = Buffer.alloc(32, 7).toString("base64");
  const secret = "synthetic-oauth-token-that-never-leaves-server";
  const encrypted = encryptSecret(secret, key, "customer-a");
  assert.equal(encrypted.ciphertext.includes(Buffer.from(secret)), false);
  assert.equal(decryptSecret(encrypted, key, "customer-a"), secret);
  assert.throws(() => decryptSecret(encrypted, key, "customer-b"));
  assert.equal(parseEncryptionKey(key).length, 32);
  assert.throws(() => parseEncryptionKey("too-short"));
});

test("state and session hashes are one-way fixed-length references", () => {
  const hash = sha256("synthetic-state");
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.equal(hash.includes("synthetic-state"), false);
});

