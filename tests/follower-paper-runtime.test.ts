import assert from 'node:assert/strict';
import test from 'node:test';
import type { FollowerCopyPlan } from '../src/customer/copy-engine-contract.js';
import {
  assembleLockedFollowerPaperActionPlan,classifyFollowerLifecycleDivergence,classifyFollowerOrderReconciliation,
} from '../src/customer/follower-paper-runtime.js';
import type { ExecutionOptionQuote } from '../src/execution/execution-option-quote.js';

const copyPlan=(action:FollowerCopyPlan['action']='OPEN_CSP'):FollowerCopyPlan=>({
  contractVersion:'theta-copy-engine-v1',copyEventId:'copy_1234567890abcdef',followerOrderIntentId:'intent_1234567890abcdef',
  clientOrderId:'theta_follower_1234567890abcdef',action,outcome:'COPY_FULL',syncState:'PENDING_SYNC',
  intendedQuantity:2,closeQuantity:action.includes('CLOSE')?2:0,openQuantity:action.includes('OPEN')?2:0,
  executionAuthorized:false,nextAction:'PERSIST_PLAN',reason:'FULL_ACCOUNT_CAPACITY',
});
const quote:ExecutionOptionQuote={contractVersion:'execution-option-quote-v1',contractId:'AAPL261016P00150000',
  providerContractId:'AAPL261016P00150000',bid:1.2,ask:1.3,bidSize:10,askSize:12,
  providerTimestamp:'2026-09-15T14:30:00.000Z',receivedAtUtc:'2026-09-15T14:30:00.100Z',
  receivedAtMonotonic:10,sequence:1,provider:'ALPACA',sourceSemantics:'CONSOLIDATED_NBBO',
  connectionState:'CONNECTED',subscriptionState:'ACTIVE',
  provenance:{authenticated:true,exactContractMapping:true,documentedForOrderPricing:true}};
const assemble=(action:FollowerCopyPlan['action']='OPEN_CSP')=>assembleLockedFollowerPaperActionPlan({
  copyPlan:copyPlan(action),workspaceId:'10000000-0000-4000-8000-000000000001',
  followerAccountId:'10000000-0000-4000-8000-000000000002',symbol:'AAPL261016P00150000',quote,
  proposedLimit:1.25,aegisState:'ALLOW_FULL',aegisPolicyVersion:'follower-aegis-v1',
  now:'2026-09-15T14:30:00.200Z',decisionExpiresAt:'2026-09-15T14:30:05.000Z',maximumQuoteAgeMs:1000,marketOpen:true});

test('follower Paper action plan uses current qualified BBO and remains non-submittable',()=>{
  const plan=assemble();
  assert.equal(plan.side,'SELL');
  assert.equal(plan.positionIntent,'SELL_TO_OPEN');
  assert.equal(plan.quantity,2);
  assert.equal(plan.executionGate,'FOLLOWER_EXECUTION_DISABLED');
  assert.equal(plan.executionAuthorized,false);
  assert.equal(plan.quoteAgeMs,200);
  assert.equal(assemble().actionPlanId,plan.actionPlanId);
});

test('follower action plan fails closed for stale/unproven quote, veto, expired decision, or out-of-BBO limit',()=>{
  assert.throws(()=>assembleLockedFollowerPaperActionPlan({
    copyPlan:copyPlan(),workspaceId:'10000000-0000-4000-8000-000000000001',
    followerAccountId:'10000000-0000-4000-8000-000000000002',symbol:quote.contractId,
    quote:{...quote,provider:'OPTIONOMICS',sourceSemantics:'TRUSTED_TWO_SIDED_ORDER_PRICING'},
    proposedLimit:1.25,aegisState:'ALLOW_FULL',aegisPolicyVersion:'v1',now:'2026-09-15T14:30:00.200Z',
    decisionExpiresAt:'2026-09-15T14:30:05.000Z',maximumQuoteAgeMs:1000,marketOpen:true,
  }),/FOLLOWER_QUOTE_PROVIDER_NOT_APPROVED/);
  assert.throws(()=>assembleLockedFollowerPaperActionPlan({
    copyPlan:copyPlan(),workspaceId:'10000000-0000-4000-8000-000000000001',
    followerAccountId:'10000000-0000-4000-8000-000000000002',symbol:quote.contractId,
    quote:{...quote,sourceSemantics:'INDICATIVE'},proposedLimit:1.25,aegisState:'ALLOW_FULL',
    aegisPolicyVersion:'v1',now:'2026-09-15T14:30:00.200Z',decisionExpiresAt:'2026-09-15T14:30:05.000Z',maximumQuoteAgeMs:1000,marketOpen:true,
  }),/QUOTE_NOT_QUALIFIED/);
  assert.throws(()=>assembleLockedFollowerPaperActionPlan({
    copyPlan:copyPlan(),workspaceId:'10000000-0000-4000-8000-000000000001',
    followerAccountId:'10000000-0000-4000-8000-000000000002',symbol:quote.contractId,quote,
    proposedLimit:1.4,aegisState:'ALLOW_FULL',aegisPolicyVersion:'v1',now:'2026-09-15T14:30:00.200Z',
    decisionExpiresAt:'2026-09-15T14:30:05.000Z',maximumQuoteAgeMs:1000,marketOpen:true}),/OUTSIDE_CURRENT_BBO/);
  assert.throws(()=>assembleLockedFollowerPaperActionPlan({
    copyPlan:copyPlan(),workspaceId:'10000000-0000-4000-8000-000000000001',
    followerAccountId:'10000000-0000-4000-8000-000000000002',symbol:quote.contractId,quote,
    proposedLimit:1.25,aegisState:'HARD_VETO',aegisPolicyVersion:'v1',now:'2026-09-15T14:30:00.200Z',
    decisionExpiresAt:'2026-09-15T14:30:05.000Z',maximumQuoteAgeMs:1000,marketOpen:true}),/AEGIS_NOT_APPROVED/);
  assert.throws(()=>assembleLockedFollowerPaperActionPlan({
    copyPlan:copyPlan(),workspaceId:'10000000-0000-4000-8000-000000000001',
    followerAccountId:'10000000-0000-4000-8000-000000000002',symbol:quote.contractId,
    quote:{...quote,provenance:{...quote.provenance,authorization:'must-not-persist'}},
    proposedLimit:1.25,aegisState:'ALLOW_FULL',aegisPolicyVersion:'v1',now:'2026-09-15T14:30:00.200Z',
    decisionExpiresAt:'2026-09-15T14:30:05.000Z',maximumQuoteAgeMs:1000,marketOpen:true,
  }),/SECRET_FIELD_IN_FOLLOWER_ACTION_PLAN/);
  assert.throws(()=>assembleLockedFollowerPaperActionPlan({
    copyPlan:copyPlan(),workspaceId:'10000000-0000-4000-8000-000000000001',
    followerAccountId:'10000000-0000-4000-8000-000000000002',symbol:quote.contractId,
    quote:{...quote,providerTimestamp:'2026-09-15T14:29:58.000Z'},proposedLimit:1.25,aegisState:'ALLOW_FULL',
    aegisPolicyVersion:'v1',now:'2026-09-15T14:30:00.200Z',decisionExpiresAt:'2026-09-15T14:30:05.000Z',
    maximumQuoteAgeMs:1000,marketOpen:true,
  }),/QUOTE_NOT_QUALIFIED:QUOTE_STALE/);
});

test('reconciliation distinguishes absent, partial, filled and foreign broker orders without retrying',()=>{
  const plan=assemble();
  assert.deepEqual(classifyFollowerOrderReconciliation({plan,brokerOrder:null}),
    {state:'BROKER_ABSENT',filledQuantity:0,requiresReconciliation:false});
  const order={id:'broker-1',clientOrderId:plan.clientOrderId,symbol:plan.symbol,qty:2,filledQty:1,
    filledAvgPrice:1.25,side:'sell' as const,status:'partially_filled',limitPrice:1.25,submittedAt:null,replacedBy:null,replaces:null};
  assert.equal(classifyFollowerOrderReconciliation({plan,brokerOrder:order}).state,'PARTIAL_FILL');
  assert.equal(classifyFollowerOrderReconciliation({plan,brokerOrder:{...order,filledQty:2,status:'filled'}}).state,'FILLED');
  assert.equal(classifyFollowerOrderReconciliation({plan,brokerOrder:{...order,clientOrderId:'foreign'}}).state,'UNKNOWN_SUBMISSION');
});

const divergence=(overrides:Partial<Parameters<typeof classifyFollowerLifecycleDivergence>[0]>={})=>
  classifyFollowerLifecycleDivergence({action:'CLOSE_CSP',entryParticipated:true,intendedQuantity:2,filledQuantity:2,
    expectedBrokerQuantity:0,actualBrokerQuantity:0,followerAssigned:null,followerCalledAway:null,
    participation:'COPY_NEW_AND_MANAGE',recoveringStock:true,coveredCallOpen:true,restarting:false,...overrides});

test('follower lifecycle divergence covers missed entry, fills, rolls, assignment, recovery, CC, call-away and restart',()=>{
  const cases:Array<[Partial<Parameters<typeof classifyFollowerLifecycleDivergence>[0]>,string]>=[
    [{entryParticipated:false},'MISSED_MASTER_ENTRY'],
    [{filledQuantity:1},'PARTIAL_FILL'],
    [{action:'CLOSE_CSP',filledQuantity:0},'CSP_CLOSE_DIVERGED'],
    [{action:'ROLL_CSP_OPEN',filledQuantity:0},'CSP_ROLL_DIVERGED'],
    [{action:'ASSIGN_STOCK',followerAssigned:false},'ASSIGNMENT_DIVERGED'],
    [{action:'HOLD_STOCK',recoveringStock:false},'STOCK_RECOVERY_DIVERGED'],
    [{action:'OPEN_CC',coveredCallOpen:false},'COVERED_CALL_DIVERGED'],
    [{action:'CALL_AWAY',followerCalledAway:false},'CALL_AWAY_DIVERGED'],
    [{participation:'STOP_NEW_TRADES_MANAGE_EXISTING'},'PAUSED_MANAGING_EXISTING'],
    [{restarting:true},'RESTART_RECONCILIATION_REQUIRED'],
    [{expectedBrokerQuantity:2,actualBrokerQuantity:1},'BROKER_POSITION_DIVERGED'],
  ];
  for(const [input,expected] of cases)assert.equal(divergence(input),expected);
  assert.equal(divergence(),'NONE');
});

test('all option order actions retain explicit position intent',()=>{
  const cases:Array<[FollowerCopyPlan['action'],'BUY'|'SELL',string|null]>=[
    ['OPEN_CSP','SELL','SELL_TO_OPEN'],['CLOSE_CSP','BUY','BUY_TO_CLOSE'],
    ['ROLL_CSP_CLOSE','BUY','BUY_TO_CLOSE'],['ROLL_CSP_OPEN','SELL','SELL_TO_OPEN'],
    ['OPEN_CC','SELL','SELL_TO_OPEN'],['CLOSE_CC','BUY','BUY_TO_CLOSE'],
    ['ROLL_CC_CLOSE','BUY','BUY_TO_CLOSE'],['ROLL_CC_OPEN','SELL','SELL_TO_OPEN'],
    ['SELL_STOCK','SELL',null],
  ];
  for(const [action,side,intent] of cases){const plan=assemble(action);assert.equal(plan.side,side);assert.equal(plan.positionIntent,intent);}
});
