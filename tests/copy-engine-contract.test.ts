import assert from "node:assert/strict";
import test from "node:test";
import {
  copyEventId,
  followerClientOrderId,
  planFollowerCopy,
  syncStateAfterBrokerResult,
  type FollowerCopyState,
  type MasterCopyEvent,
} from "../src/customer/copy-engine-contract.js";

const event = (overrides: Partial<MasterCopyEvent> = {}): MasterCopyEvent => ({
  masterDecisionId: "decision-1",
  masterLifecycleId: "chain-1",
  masterOrderId: "master-order-1",
  masterFillId: "master-fill-1",
  action: "OPEN_CSP",
  symbol: "AAPL",
  contractId: "AAPL-put-1",
  masterQuantity: 5,
  masterFilledQuantity: 5,
  occurredAt: "2026-09-10T14:00:00.000Z",
  ...overrides,
});

const follower = (overrides: Partial<FollowerCopyState> = {}): FollowerCopyState => ({
  followerId: "follower-1",
  policyVersion: "policy-1",
  participation: "COPY_NEW_AND_MANAGE",
  accountReady: true,
  optionsApproved: true,
  authorizedCapitalRemaining: 20_000,
  collateralPerContract: 10_000,
  maxContractsPerPosition: 5,
  existingCopiedQuantity: 0,
  actualBrokerQuantity: 0,
  freshFollowerQuote: true,
  expectedSlippagePerContract: 2,
  maxSlippagePerContract: 10,
  brokerOrderState: "NONE",
  processedCopyEventIds: [],
  followerAssigned: null,
  ...overrides,
});

test("master quantity five adapts to follower quantities two, one, and zero", () => {
  const two = planFollowerCopy(event(), follower());
  const one = planFollowerCopy(event(), follower({ authorizedCapitalRemaining: 10_000 }));
  const zero = planFollowerCopy(event(), follower({ authorizedCapitalRemaining: 9_999 }));
  assert.deepEqual([two.intendedQuantity, one.intendedQuantity, zero.intendedQuantity], [2, 1, 0]);
  assert.deepEqual([two.outcome, one.outcome, zero.outcome], ["COPY_REDUCED", "COPY_REDUCED", "SKIP_ACCOUNT"]);
  assert.equal(zero.executionAuthorized, false);
});

test("master close maps to the actual copied quantity and never opens risk", () => {
  const plan = planFollowerCopy(
    event({ action: "CLOSE_CSP", masterQuantity: 5, masterFilledQuantity: 5 }),
    follower({ existingCopiedQuantity: 2, actualBrokerQuantity: 2 }),
  );
  assert.equal(plan.closeQuantity, 2);
  assert.equal(plan.openQuantity, 0);
  assert.equal(plan.intendedQuantity, 2);
});

test("roll is close old plus open new in one lineage", () => {
  const plan = planFollowerCopy(
    event({ action: "ROLL_CSP" }),
    follower({ existingCopiedQuantity: 2, actualBrokerQuantity: 2 }),
  );
  assert.equal(plan.closeQuantity, 2);
  assert.equal(plan.openQuantity, 2);
  assert.equal(plan.intendedQuantity, 2);
});

test("assignment propagates only when follower assignment matches", () => {
  const matched = planFollowerCopy(
    event({ action: "ASSIGN_STOCK", contractId: null }),
    follower({ existingCopiedQuantity: 2, actualBrokerQuantity: 2, followerAssigned: true }),
  );
  assert.equal(matched.outcome, "COPY_REDUCED");
  const diverged = planFollowerCopy(
    event({ action: "ASSIGN_STOCK", contractId: null }),
    follower({ existingCopiedQuantity: 2, actualBrokerQuantity: 2, followerAssigned: false }),
  );
  assert.equal(diverged.syncState, "DIVERGED");
  assert.equal(diverged.nextAction, "RECONCILE");
});

test("partial fill, rejection, and ambiguous submission never trigger a blind retry", () => {
  for (const [brokerOrderState, syncState] of [
    ["PARTIAL_FILL", "PARTIAL_SYNC"],
    ["REJECTED", "BLOCKED"],
    ["UNKNOWN_SUBMISSION", "RECONCILING"],
  ] as const) {
    const plan = planFollowerCopy(event(), follower({ brokerOrderState }));
    assert.equal(plan.nextAction, "RECONCILE");
    assert.equal(plan.syncState, syncState);
    assert.equal(plan.executionAuthorized, false);
  }
});

test("manual follower position change is divergence and must reconcile", () => {
  const plan = planFollowerCopy(
    event({ action: "CLOSE_CSP" }),
    follower({ existingCopiedQuantity: 2, actualBrokerQuantity: 0 }),
  );
  assert.equal(plan.reason, "BROKER_POSITION_DIVERGED");
  assert.equal(plan.syncState, "DIVERGED");
  assert.equal(plan.nextAction, "RECONCILE");
});

test("OAuth disconnect, stale quote, and slippage failure block safely", () => {
  assert.equal(planFollowerCopy(event(), follower({ participation: "DISCONNECTED" })).reason, "FOLLOWER_DISCONNECTED");
  assert.equal(planFollowerCopy(event(), follower({ freshFollowerQuote: false })).reason, "STALE_FOLLOWER_QUOTE");
  assert.equal(planFollowerCopy(event(), follower({ expectedSlippagePerContract: 11 })).reason, "SLIPPAGE_LIMIT_EXCEEDED");
});

test("stopping new trades preserves management of existing exposure", () => {
  const stopped = follower({ participation: "STOP_NEW_TRADES_MANAGE_EXISTING" });
  assert.equal(planFollowerCopy(event(), stopped).reason, "NEW_TRADES_STOPPED");
  const close = planFollowerCopy(
    event({ action: "CLOSE_CSP" }),
    follower({ participation: "STOP_NEW_TRADES_MANAGE_EXISTING", existingCopiedQuantity: 2, actualBrokerQuantity: 2 }),
  );
  assert.equal(close.closeQuantity, 2);
  assert.equal(close.nextAction, "PERSIST_PLAN");
});

test("stable copy identities make duplicate events and webhook replays no-ops", () => {
  const id = copyEventId(event(), "follower-1");
  assert.equal(id, copyEventId(event(), "follower-1"));
  assert.equal(followerClientOrderId(id), followerClientOrderId(id));
  assert.notEqual(followerClientOrderId(id, 1), followerClientOrderId(id, 2));
  const duplicate = planFollowerCopy(event(), follower({ processedCopyEventIds: [id] }));
  assert.equal(duplicate.outcome, "DUPLICATE_NOOP");
  assert.equal(duplicate.nextAction, "NONE");
  assert.throws(() => followerClientOrderId(id, 0));
});

test("broker result maps full, partial, rejection, and unknown sync states", () => {
  assert.equal(syncStateAfterBrokerResult({ intendedQuantity: 2, filledQuantity: 2, brokerState: "FILLED" }), "SYNCED");
  assert.equal(syncStateAfterBrokerResult({ intendedQuantity: 2, filledQuantity: 1, brokerState: "PARTIAL_FILL" }), "PARTIAL_SYNC");
  assert.equal(syncStateAfterBrokerResult({ intendedQuantity: 2, filledQuantity: 0, brokerState: "REJECTED" }), "BLOCKED");
  assert.equal(syncStateAfterBrokerResult({ intendedQuantity: 2, filledQuantity: 0, brokerState: "UNKNOWN_SUBMISSION" }), "RECONCILING");
  assert.equal(syncStateAfterBrokerResult({ intendedQuantity: 2, filledQuantity: 3, brokerState: "FILLED" }), "DIVERGED");
  assert.throws(() => syncStateAfterBrokerResult({ intendedQuantity: 2, filledQuantity: -1, brokerState: "FILLED" }));
});
