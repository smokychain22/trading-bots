import assert from "node:assert/strict";
import test from "node:test";
import {
  privatePaperBetaReadiness,
  summarizeOptionomicsReadiness,
  verifyOptionomicsConnection,
} from "../src/customer/operator-readiness.js";
import type { CheckResult } from "../src/providers/readiness.js";
import { verifyMasterPaperConnection } from "../src/customer/paper-copy.js";

const result = (state: CheckResult["state"], alias: string): CheckResult => ({
  provider: "OPTIONOMICS",
  capability: alias,
  operationAlias: alias,
  state,
  httpStatus: state === "GOOD" ? 200 : 401,
  observedAt: "2026-09-10T00:00:00.000Z",
  retrievedAt: "2026-09-10T00:00:00.000Z",
  latencyMs: 10,
  provenance: { credentialValuesLogged: false },
  details: {},
});

test("Optionomics is connected only when discovery and documented probes are GOOD", () => {
  assert.equal(
    summarizeOptionomicsReadiness([result("GOOD", "discover"), result("GOOD", "auth")]).state,
    "CONNECTED",
  );
  assert.equal(
    summarizeOptionomicsReadiness([result("GOOD", "discover"), result("INVALID", "auth")]).state,
    "INVALID",
  );
  assert.equal(summarizeOptionomicsReadiness([result("GOOD", "discover")]).state, "DEGRADED");
});

test("missing Optionomics configuration stays explicit and never probes guessed routes", async () => {
  const readiness = await verifyOptionomicsConnection({} as never);
  assert.equal(readiness.state, "MISSING");
  assert.deepEqual(readiness.capabilities, []);
});

test("private paper key beta is configuration-gated and execution remains separate", () => {
  const readiness = privatePaperBetaReadiness(2);
  assert.equal(readiness.state, "IMPLEMENTED_CONFIGURATION_GATED");
  assert.equal(readiness.policy_status, "PRIVATE_TEAM_PAPER_ONLY");
  assert.equal(readiness.raw_key_endpoint_available, true);
  assert.equal(readiness.follower_count, 2);
});

test("missing master configuration returns MISSING without a provider request", async () => {
  const readiness = await verifyMasterPaperConnection({} as never);
  assert.equal(readiness.connection_state, "MISSING");
  assert.equal(readiness.configured, false);
  assert.deepEqual(readiness.capability_results, []);
  assert.equal(readiness.execution_enabled, false);
});
