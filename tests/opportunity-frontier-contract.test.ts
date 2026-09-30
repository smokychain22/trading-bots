import assert from 'node:assert/strict';
import test from 'node:test';
import { parseOpportunityFrontierResponse } from '../src/theta/opportunity-frontier-contract.js';

const basePayload = (overrides: Record<string, unknown> = {}) => ({
  contractVersion: 'theta-opportunity-frontier-runtime-v1',
  snapshotId: 'snapshot-1',
  timestamp: new Date().toISOString(),
  policyVersion: 'v1',
  entries: [
    { candidateId: 'c1', rank: 1, disposition: 'OPEN_FULL', waitReason: null, rejectionCategory: null, reasons: [] },
  ],
  actionableCandidateIds: ['c1'],
  globalIdle: null,
  ...overrides,
});

test('WAIT must carry a specific waitReason', () => {
  assert.throws(() => parseOpportunityFrontierResponse(basePayload({
    entries: [{ candidateId: 'c1', rank: null, disposition: 'WAIT', waitReason: null, rejectionCategory: 'EVENT', reasons: [] }],
    actionableCandidateIds: [],
    globalIdle: {
      reason: 'EVENT_RISK_CLUSTER', eligibleUnderlyingsScanned: 1, contractsEvaluated: 1, positiveEvCandidates: 0,
      riskRejectedCandidates: 0, executionRejectedCandidates: 0, bestRejectedCandidateId: null, bestRejectedEv: null,
    },
  })));
});

test('an OPEN_* disposition must carry a rank', () => {
  assert.throws(() => parseOpportunityFrontierResponse(basePayload({
    entries: [{ candidateId: 'c1', rank: null, disposition: 'OPEN_FULL', waitReason: null, rejectionCategory: null, reasons: [] }],
  })));
});

test('globalIdle must be null whenever an actionable candidate exists', () => {
  assert.throws(() => parseOpportunityFrontierResponse(basePayload({
    globalIdle: {
      reason: 'NO_POSITIVE_AFTER_COST_EDGE', eligibleUnderlyingsScanned: 1, contractsEvaluated: 1,
      positiveEvCandidates: 0, riskRejectedCandidates: 0, executionRejectedCandidates: 0,
      bestRejectedCandidateId: null, bestRejectedEv: null,
    },
  })));
});

test('no actionable candidate requires a globalIdle report', () => {
  assert.throws(() => parseOpportunityFrontierResponse(basePayload({
    entries: [{ candidateId: 'c1', rank: null, disposition: 'PASS', waitReason: null, rejectionCategory: 'NEGATIVE_EV', reasons: [] }],
    actionableCandidateIds: [],
    globalIdle: null,
  })));
});

test('a well-formed actionable response parses cleanly', () => {
  const response = parseOpportunityFrontierResponse(basePayload());
  assert.equal(response.actionableCandidateIds.length, 1);
});

test('a missing candidate cannot turn complete enumeration into a false global idle', () => {
  const payload=basePayload({timestamp:'2026-09-30T14:00:00.000Z'});
  const expected={snapshotId:'snapshot-1',timestamp:'2026-09-30T14:00:00.000Z',
    policyVersion:'v1',candidateIds:['c1','c2']};
  assert.throws(()=>parseOpportunityFrontierResponse(payload,expected),
    /OPPORTUNITY_RESPONSE_CANDIDATE_SET_MISMATCH/);
  assert.throws(()=>parseOpportunityFrontierResponse(basePayload({...payload,policyVersion:'other'}),expected),
    /OPPORTUNITY_RESPONSE_IDENTITY_MISMATCH/);
});

test('actionable IDs must exactly match OPEN entries',()=>{
  assert.throws(()=>parseOpportunityFrontierResponse(basePayload({actionableCandidateIds:['other']})),
    /actionableCandidateIds must exactly match OPEN entries/);
  assert.throws(()=>parseOpportunityFrontierResponse(basePayload({actionableCandidateIds:['c1','c1']})),
    /actionableCandidateIds must exactly match OPEN entries/);
});

test('a global idle report cannot undercount evaluated contracts or name an absent near miss',()=>{
  const idle={reason:'NO_POSITIVE_AFTER_COST_EDGE',eligibleUnderlyingsScanned:1,
    contractsEvaluated:0,positiveEvCandidates:0,riskRejectedCandidates:0,
    executionRejectedCandidates:0,bestRejectedCandidateId:null,bestRejectedEv:null};
  const entries=[{candidateId:'c1',rank:null,disposition:'PASS',waitReason:null,
    rejectionCategory:'NEGATIVE_EV',reasons:[]}];
  assert.throws(()=>parseOpportunityFrontierResponse(basePayload({entries,
    actionableCandidateIds:[],globalIdle:idle})),/globalIdle contract count must match evaluated entries/);
  assert.throws(()=>parseOpportunityFrontierResponse(basePayload({entries,
    actionableCandidateIds:[],globalIdle:{...idle,contractsEvaluated:1,
      bestRejectedCandidateId:'missing'}})),/globalIdle best rejected candidate must be evaluated/);
});

test('global idle rejection categories reconcile with evaluated dispositions',()=>{
  const idle={reason:'NO_POSITIVE_AFTER_COST_EDGE',eligibleUnderlyingsScanned:1,
    contractsEvaluated:2,positiveEvCandidates:1,riskRejectedCandidates:1,
    executionRejectedCandidates:1,bestRejectedCandidateId:'c1',bestRejectedEv:-1};
  const entries=[
    {candidateId:'c1',rank:null,disposition:'PASS',waitReason:null,rejectionCategory:'AEGIS',reasons:[]},
    {candidateId:'c2',rank:null,disposition:'PASS',waitReason:null,rejectionCategory:'LIQUIDITY',reasons:[]},
  ];
  const payload=basePayload({entries,actionableCandidateIds:[],globalIdle:idle});
  assert.equal(parseOpportunityFrontierResponse(payload).globalIdle?.contractsEvaluated,2);
  assert.throws(()=>parseOpportunityFrontierResponse(basePayload({...payload,
    globalIdle:{...idle,riskRejectedCandidates:0}})),/risk rejection count/);
  assert.throws(()=>parseOpportunityFrontierResponse(basePayload({...payload,
    globalIdle:{...idle,executionRejectedCandidates:0}})),/execution rejection count/);
  assert.throws(()=>parseOpportunityFrontierResponse(basePayload({...payload,
    globalIdle:{...idle,positiveEvCandidates:3}})),/positive EV count/);
});
