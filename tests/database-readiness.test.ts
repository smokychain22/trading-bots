import assert from "node:assert/strict";
import test from "node:test";
import { checkDatabaseReadiness } from "../src/customer/database-readiness.js";

test("database readiness reports MISSING without guessing or attempting a connection", async () => {
  const result = await checkDatabaseReadiness(undefined);
  assert.equal(result.state, "MISSING");
  assert.equal(result.latest_migration, null);
  assert.equal(result.customer_iam, false);
  assert.equal(result.token_vault, false);
  assert.equal(result.active_followers, null);
  assert.equal(result.private_beta_followers, 0);
  assert.equal(result.connection_type, "TRANSACTION_POOLED_RUNTIME");
  assert.equal(result.migration_connection_type, "DIRECT_OR_SESSION_POOLED");
});
