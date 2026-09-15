import assert from "node:assert/strict";
import test from "node:test";
import { checkDatabaseReadiness } from "../src/customer/database-readiness.js";

test("database readiness reports MISSING without guessing or attempting a connection", async () => {
  const result = await checkDatabaseReadiness(undefined);
  assert.equal(result.state, "MISSING");
  assert.equal(result.latest_migration, null);
  assert.equal(result.customer_iam, false);
  assert.equal(result.token_vault, false);
  assert.equal(result.paper_execution_schema, false);
  assert.equal(result.active_followers, null);
  assert.equal(result.private_beta_followers, null);
  assert.equal(result.follower_action_plans,null);
  assert.equal(result.follower_reconciliation_events,null);
  assert.equal(result.required_migration, "041_management_policy_evidence");
  assert.equal(result.connection_type, "TRANSACTION_POOLED_RUNTIME");
  assert.equal(result.migration_connection_type, "DIRECT_OR_SESSION_POOLED");
});
