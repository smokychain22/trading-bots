import assert from 'node:assert/strict';
import test from 'node:test';
import { buildR7PhaseStatus } from '../src/theta/r7-phase-status.js';
import type { FirstPaperOrderDryRun } from '../src/theta/first-paper-order-preflight.js';

test('mechanically complete dry run passes engineering while empirical and owner gates stay closed',()=>{
  const dryRun={preflightVersion:'theta-first-paper-order-dry-run-v1',brokerEndpoint:'/v2/orders',
    request:{symbol:'AAPL261016P00150000',qty:1,side:'sell',type:'limit',time_in_force:'day',limit_price:'1.24',
      client_order_id:'theta-first-1',position_intent:'sell_to_open'},requestPayloadHash:'a'.repeat(64),
    networkSubmission:'NOT_ATTEMPTED',executionAuthorized:false,mechanicalBlockers:[],
    receipt:{readyForFirstPaperOrder:'NO',blockers:['EV_MODEL_NOT_EMPIRICALLY_READY']}} as unknown as FirstPaperOrderDryRun;
  const status=buildR7PhaseStatus(dryRun);
  assert.equal(status.R7_ENGINEERING,'PASS');
  assert.equal(status.R7_EMPIRICAL_GATE,'BLOCKED');
  assert.equal(status.R7_OWNER_AUTHORIZATION,'NOT_GRANTED');
  assert.equal(status.R7_FULL_PHASE,'NO');
  assert.equal(status.READY_FOR_FIRST_PAPER_ORDER,'NO');
});

test('empirical gate is reported independently from an operational blocker',()=>{
  const dryRun={preflightVersion:'theta-first-paper-order-dry-run-v1',brokerEndpoint:'/v2/orders',
    request:{symbol:'AAPL261016P00150000',qty:1,side:'sell',type:'limit',time_in_force:'day',limit_price:'1.24',
      client_order_id:'theta-first-1',position_intent:'sell_to_open'},requestPayloadHash:'a'.repeat(64),
    networkSubmission:'NOT_ATTEMPTED',executionAuthorized:false,mechanicalBlockers:[],
    receipt:{readyForFirstPaperOrder:'NO',blockers:['SCHEDULER_NOT_HEALTHY']}} as unknown as FirstPaperOrderDryRun;
  const status=buildR7PhaseStatus(dryRun);
  assert.equal(status.R7_ENGINEERING,'PASS');
  assert.equal(status.R7_EMPIRICAL_GATE,'PASS');
  assert.equal(status.READY_FOR_FIRST_PAPER_ORDER,'NO');
});
