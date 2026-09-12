import assert from "node:assert/strict";
import test from "node:test";
import {
  copyEventId,
  directionAwarePriceDeterioration,
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
  chainEntryParticipated: false,
  assignmentCapacityContracts: 5,
  tailCapacityContracts: 5,
  concentrationCapacityContracts: 5,
  accountLimitContracts: 5,
  actualCoveredShares: 0,
  contractMultiplier: 100,
  followerBrokerLifecycleConfirmed: false,
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
    follower({ chainEntryParticipated:true,existingCopiedQuantity: 2, actualBrokerQuantity: 2 }),
  );
  assert.equal(plan.closeQuantity, 2);
  assert.equal(plan.openQuantity, 0);
  assert.equal(plan.intendedQuantity, 2);
});

test("roll requires independently evaluated close and open legs", () => {
  const state=follower({chainEntryParticipated:true,existingCopiedQuantity:2,actualBrokerQuantity:2});
  const close=planFollowerCopy(event({action:"ROLL_CSP_CLOSE"}),state);
  const open=planFollowerCopy(event({action:"ROLL_CSP_OPEN"}),state);
  assert.deepEqual([close.closeQuantity,close.openQuantity],[2,0]);
  assert.deepEqual([open.closeQuantity,open.openQuantity],[0,2]);
  assert.equal(planFollowerCopy(event({action:"ROLL_CSP"}),state).reason,"ROLL_REQUIRES_EXPLICIT_LEGS");
});

test("assignment propagates only when follower assignment matches", () => {
  const matched = planFollowerCopy(
    event({ action: "ASSIGN_STOCK", contractId: null }),
    follower({ chainEntryParticipated:true,existingCopiedQuantity: 2, actualBrokerQuantity: 2, followerAssigned: true,
      followerBrokerLifecycleConfirmed:true }),
  );
  assert.equal(matched.outcome, "COPY_REDUCED");
  const diverged = planFollowerCopy(
    event({ action: "ASSIGN_STOCK", contractId: null }),
    follower({ chainEntryParticipated:true,existingCopiedQuantity: 2, actualBrokerQuantity: 2, followerAssigned: false,
      followerBrokerLifecycleConfirmed:true }),
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
    follower({ chainEntryParticipated:true,existingCopiedQuantity: 2, actualBrokerQuantity: 0 }),
  );
  assert.equal(plan.reason, "BROKER_POSITION_DIVERGED");
  assert.equal(plan.syncState, "DIVERGED");
  assert.equal(plan.nextAction, "RECONCILE");
});

test("OAuth disconnect, stale quote, and slippage failure block safely", () => {
  assert.equal(planFollowerCopy(event(), follower({ participation: "DISCONNECTED" })).reason, "FOLLOWER_DISCONNECTED");
  assert.equal(planFollowerCopy(event(), follower({ accountReady: false })).reason, "FOLLOWER_NOT_READY");
  assert.equal(planFollowerCopy(event(), follower({ optionsApproved: false })).reason, "OPTIONS_NOT_APPROVED");
  assert.equal(planFollowerCopy(event(), follower({ freshFollowerQuote: false })).reason, "STALE_FOLLOWER_QUOTE");
  assert.equal(planFollowerCopy(event(), follower({ expectedSlippagePerContract: null })).reason, "EXECUTION_ECONOMICS_UNKNOWN");
  assert.equal(planFollowerCopy(event(), follower({ expectedSlippagePerContract: 11 })).reason, "SLIPPAGE_LIMIT_EXCEEDED");
});

test("stopping new trades preserves management of existing exposure", () => {
  const stopped = follower({ participation: "STOP_NEW_TRADES_MANAGE_EXISTING" });
  assert.equal(planFollowerCopy(event(), stopped).reason, "NEW_TRADES_STOPPED");
  const close = planFollowerCopy(
    event({ action: "CLOSE_CSP" }),
    follower({ participation: "STOP_NEW_TRADES_MANAGE_EXISTING",chainEntryParticipated:true,existingCopiedQuantity: 2, actualBrokerQuantity: 2 }),
  );
  assert.equal(close.closeQuantity, 2);
  assert.equal(close.nextAction, "PERSIST_PLAN");
});

test("downstream lifecycle is excluded after a skipped entry",()=>{
  const plan=planFollowerCopy(event({action:"CLOSE_CSP"}),follower({existingCopiedQuantity:1,actualBrokerQuantity:1}));
  assert.equal(plan.reason,"FOLLOWER_SKIPPED_ENTRY");
});

test("unknown capacity never increases opening size",()=>{
  for (const field of ["assignmentCapacityContracts","tailCapacityContracts","concentrationCapacityContracts"] as const) {
    const plan=planFollowerCopy(event(),follower({[field]:null}));
    assert.equal(plan.intendedQuantity,0);
    assert.equal(plan.reason,"FOLLOWER_CAPACITY_UNKNOWN");
  }
});

test("each follower capacity independently binds and zero is never forced to one",()=>{
  for (const field of ["assignmentCapacityContracts","tailCapacityContracts","concentrationCapacityContracts",
    "accountLimitContracts"] as const) {
    assert.equal(planFollowerCopy(event(),follower({[field]:1})).intendedQuantity,1);
    const zero=planFollowerCopy(event(),follower({[field]:0}));
    assert.equal(zero.intendedQuantity,0);
    assert.equal(zero.outcome,"SKIP_ACCOUNT");
  }
});

test("a null customer limit means no extra cap while numeric zero remains an actual zero cap",()=>{
  const noExtraCap=planFollowerCopy(event(),follower({accountLimitContracts:null}));
  const zeroCap=planFollowerCopy(event(),follower({accountLimitContracts:0}));
  assert.equal(noExtraCap.intendedQuantity,2);
  assert.equal(zeroCap.intendedQuantity,0);
  assert.equal(zeroCap.outcome,"SKIP_ACCOUNT");
});

test("covered-call entry uses the follower's reduced chain quantity and actual shares",()=>{
  const state=follower({chainEntryParticipated:true,existingCopiedQuantity:2,actualBrokerQuantity:2,
    actualCoveredShares:200,contractMultiplier:100});
  const open=planFollowerCopy(event({action:"OPEN_CC"}),state);
  const rollOpen=planFollowerCopy(event({action:"ROLL_CC_OPEN"}),state);
  assert.deepEqual([open.intendedQuantity,open.openQuantity],[2,2]);
  assert.deepEqual([rollOpen.intendedQuantity,rollOpen.openQuantity],[2,2]);
  assert.equal(planFollowerCopy(event({action:"OPEN_CC"}),{...state,actualCoveredShares:199}).reason,
    "INSUFFICIENT_FOLLOWER_COVERED_SHARES");
  assert.equal(planFollowerCopy(event({action:"OPEN_CC"}),{...state,contractMultiplier:null}).reason,
    "INSUFFICIENT_FOLLOWER_COVERED_SHARES");
});

test("terminal lifecycle events need the follower's own broker confirmation",()=>{
  const state=follower({chainEntryParticipated:true,existingCopiedQuantity:1,actualBrokerQuantity:1});
  for(const action of ["EXPIRE_CSP","ASSIGN_STOCK","EXPIRE_CC","CALL_AWAY"] as const){
    assert.equal(planFollowerCopy(event({action,contractId:null}),state).reason,
      "FOLLOWER_BROKER_LIFECYCLE_UNCONFIRMED");
  }
});

test("credit and debit deterioration use opposite adverse directions",()=>{
  assert.deepEqual(directionAwarePriceDeterioration({direction:"CREDIT",masterPrice:2,followerPrice:1.9}),
    {direction:"CREDIT",amount:0.10000000000000009,classification:"ADVERSE"});
  assert.deepEqual(directionAwarePriceDeterioration({direction:"DEBIT",masterPrice:1,followerPrice:1.1}),
    {direction:"DEBIT",amount:0.10000000000000009,classification:"ADVERSE"});
  assert.equal(directionAwarePriceDeterioration({direction:"CREDIT",masterPrice:2,followerPrice:2.1}).classification,"IMPROVED");
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
