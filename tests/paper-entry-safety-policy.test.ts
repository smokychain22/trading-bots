import assert from 'node:assert/strict';
import test from 'node:test';
import type { AlpacaCalendarSession } from '../src/theta/alpaca-provider.js';
import type { CorporateActionRead } from '../src/theta/alpaca-corporate-action-evidence.js';
import type { OptionomicsEarningsEvidence } from '../src/theta/earnings-event-evidence.js';
import type { MacroRiskEvidence } from '../src/theta/macro-event-policy.js';
import { applyCompanyEventPaperPolicy, applyCorporateActionPaperPolicy, buildPaperEntrySafetyPolicyReceipt,
  classifyPaperInstrument, paperInstrumentClassificationManifest,
  tradingSessionsThroughExpiration } from '../src/theta/paper-entry-safety-policy.js';

const now='2026-09-23T14:00:00.000Z';
const earnings=(state:OptionomicsEarningsEvidence['state']='KNOWN_POSITIVE_DISTANCE',distance:number|null=8):OptionomicsEarningsEvidence=>({
  version:'theta-optionomics-earnings-evidence-v1',authority:'OPTIONOMICS_SESSION_RESEARCH',state,
  distanceTradingSessions:distance,distanceCalendarDays:null,coverageAuthority:'POSITIVE_DISTANCE_ONLY_NO_NEGATIVE_ASSURANCE',
  providerTimestamp:'2026-09-23T13:59:00.000Z',thetaObservedAt:'2026-09-23T14:00:00.000Z',thetaFirstObservedAt:null,
  sessionDate:'2026-09-23',evidenceId:'earnings-evidence',reason:'TEST',paperEntryNegativeAssurance:false,
});
const macro=(state:MacroRiskEvidence['state']='KNOWN_FALSE'):MacroRiskEvidence=>({
  policyVersion:'theta-macro-event-paper-bootstrap-v1',authority:'PAPER_BOOTSTRAP_NOT_EMPIRICALLY_OPTIMAL',state,
  macroRiskFlag:state==='KNOWN_TRUE'?true:state==='KNOWN_FALSE'?false:null,decisionAsOf:now,validThrough:'2026-10-31',
  eventCount:0,nearEventCount:0,evidenceIds:['macro-evidence'],reason:'TEST',
});
const calendar:readonly AlpacaCalendarSession[]=['2026-09-23','2026-09-24','2026-09-25','2026-09-28','2026-09-29']
  .map((date)=>({date,open:'09:30',close:'16:00',sessionOpen:null,sessionClose:null}));
const read:CorporateActionRead={version:'alpaca-corporate-action-observation-v1',provider:'ALPACA',operation:'GET /v1/corporate-actions',
  symbols:['AAPL'],start:'2026-09-23',end:'2026-11-07',requestedDataQuality:'all',firstObservedAt:now,
  pagesRead:1,paginationComplete:true,negativeCoverageQualified:false,observations:[]};

test('trading-session horizon uses the exchange calendar and refuses incomplete expiry coverage',()=>{
  assert.equal(tradingSessionsThroughExpiration({decisionAsOf:now,expiration:'2026-09-29',calendar}),5);
  assert.equal(tradingSessionsThroughExpiration({decisionAsOf:now,expiration:'2026-09-30',calendar}),null);
});

test('positive earnings evidence classifies a company without approving a Paper fallback',()=>{
  const result=classifyPaperInstrument({symbol:'AAPL',decisionAsOf:now,earnings:earnings()});
  assert.equal(result.state,'OPERATING_COMPANY');
  assert.equal(result.paperBootstrapApproved,false);
  assert.equal(result.authority,'OPTIONOMICS_POSITIVE_EARNINGS');
});

test('company event policy blocks near earnings and clears known earnings beyond expiry',()=>{
  const instrument=classifyPaperInstrument({symbol:'AAPL',decisionAsOf:now,earnings:earnings()});
  const near=applyCompanyEventPaperPolicy({decisionAsOf:now,expiration:'2026-09-29',calendar,instrument,
    earnings:earnings('KNOWN_POSITIVE_DISTANCE',3),macro:macro()});
  assert.equal(near.state,'KNOWN_NEAR_EARNINGS_BLOCK');assert.equal(near.action,'BLOCK');
  const after=applyCompanyEventPaperPolicy({decisionAsOf:now,expiration:'2026-09-29',calendar,instrument,
    earnings:earnings('KNOWN_POSITIVE_DISTANCE',8),macro:macro()});
  assert.equal(after.state,'KNOWN_AFTER_EXPIRY_CLEAR');assert.equal(after.action,'CLEAR');
});

test('unknown earnings coverage and unknown instrument class remain blocked',()=>{
  const unknownEarnings=earnings('UNKNOWN',null);
  const instrument=classifyPaperInstrument({symbol:'AAPL',decisionAsOf:now,earnings:unknownEarnings});
  const result=applyCompanyEventPaperPolicy({decisionAsOf:now,expiration:'2026-09-29',calendar,instrument,
    earnings:unknownEarnings,macro:macro()});
  assert.equal(result.state,'INSTRUMENT_CLASSIFICATION_UNKNOWN_BLOCK');
  assert.equal(result.action,'BLOCK');
});

test('explicit fund classification makes company earnings not applicable while retaining macro safety',()=>{
  const unknownEarnings=earnings('UNKNOWN',null);
  const manifest=[{symbol:'SPY',instrumentClass:'NON_COMPANY_FUND' as const,paperBootstrapApproved:true,
    authorityRef:'owner-manifest-1',effectiveAt:'2026-09-01T00:00:00.000Z',reviewedAt:'2026-09-01T00:00:00.000Z'}];
  const instrument=classifyPaperInstrument({symbol:'SPY',decisionAsOf:now,earnings:unknownEarnings,manifest});
  const clear=applyCompanyEventPaperPolicy({decisionAsOf:now,expiration:'2026-09-29',calendar,instrument,
    earnings:unknownEarnings,macro:macro()});
  assert.equal(clear.state,'FUND_NOT_APPLICABLE_CLEAR');
  const blocked=applyCompanyEventPaperPolicy({decisionAsOf:now,expiration:'2026-09-29',calendar,instrument,
    earnings:unknownEarnings,macro:macro('KNOWN_TRUE')});
  assert.equal(blocked.state,'MACRO_EVENT_BLOCK');
});

test('the canonical manifest approves only SPY and still preserves macro blocking',()=>{
  assert.deepEqual(paperInstrumentClassificationManifest.entries.map((entry)=>entry.symbol),['SPY']);
  const manifestDecision='2026-09-24T14:00:00.000Z';
  const unknownEarnings=earnings('UNKNOWN',null);
  const instrument=classifyPaperInstrument({symbol:'SPY',decisionAsOf:manifestDecision,earnings:unknownEarnings});
  assert.equal(instrument.state,'NON_COMPANY_FUND');
  assert.equal(instrument.paperBootstrapApproved,true);
  assert.equal(instrument.authority,'VERSIONED_MANIFEST');
  const clear=applyCompanyEventPaperPolicy({decisionAsOf:manifestDecision,expiration:'2026-09-29',calendar,instrument,
    earnings:unknownEarnings,macro:macro()});
  assert.equal(clear.state,'FUND_NOT_APPLICABLE_CLEAR');assert.equal(clear.action,'CLEAR');
  const nearMacro=applyCompanyEventPaperPolicy({decisionAsOf:manifestDecision,expiration:'2026-09-29',calendar,instrument,
    earnings:unknownEarnings,macro:macro('KNOWN_TRUE')});
  assert.equal(nearMacro.state,'MACRO_EVENT_BLOCK');assert.equal(nearMacro.action,'BLOCK');
  const unknownMacro=applyCompanyEventPaperPolicy({decisionAsOf:manifestDecision,expiration:'2026-09-29',calendar,instrument,
    earnings:unknownEarnings,macro:macro('UNKNOWN')});
  assert.equal(unknownMacro.state,'MACRO_COVERAGE_UNKNOWN_BLOCK');assert.equal(unknownMacro.action,'BLOCK');
});

const corporateInput=()=>({symbol:'AAPL',decisionAsOf:now,read,providerError:false,currentPositiveRelevant:false,
  persistedPositiveRelevance:'EXPIRED_NOT_RELEVANT' as const,standardOptionContract:true,ordinaryDeliverable:true,
  verifiedMultiplier:true,approvedFirstPaperInstrument:true,oneRiskyUnderlyingPolicy:true,reconciliationGood:true,
  aegisGood:true,freshQuote:true});

test('corporate-action policy never maps a successful empty read to qualified absence',()=>{
  const result=applyCorporateActionPaperPolicy(corporateInput());
  assert.equal(result.state,'PAPER_BOOTSTRAP_LIMITED');
  assert.equal(result.authority,'PAPER_BOOTSTRAP_NOT_COMPLETE_NEGATIVE_ASSURANCE');
  assert.equal(result.negativeCoverageQualified,false);
});

test('corporate-action policy blocks positives, partial coverage, provider errors, adjusted contracts, and incomplete fallback',()=>{
  assert.equal(applyCorporateActionPaperPolicy({...corporateInput(),currentPositiveRelevant:true}).state,'KNOWN_RELEVANT_ACTION_BLOCK');
  assert.equal(applyCorporateActionPaperPolicy({...corporateInput(),read:{...read,paginationComplete:false}}).state,'QUERY_INCOMPLETE_BLOCK');
  assert.equal(applyCorporateActionPaperPolicy({...corporateInput(),read:null,providerError:true}).state,'PROVIDER_ERROR_BLOCK');
  assert.equal(applyCorporateActionPaperPolicy({...corporateInput(),ordinaryDeliverable:false}).state,'ADJUSTED_CONTRACT_BLOCK');
  assert.equal(applyCorporateActionPaperPolicy({...corporateInput(),approvedFirstPaperInstrument:false}).state,'NEGATIVE_ASSURANCE_UNKNOWN_BLOCK');
});

test('combined safety receipt is content-addressed and only clears when both policies clear',()=>{
  const instrument=classifyPaperInstrument({symbol:'AAPL',decisionAsOf:now,earnings:earnings(),manifest:[{
    symbol:'AAPL',instrumentClass:'OPERATING_COMPANY',paperBootstrapApproved:true,authorityRef:'manifest-aapl',
    effectiveAt:'2026-09-01T00:00:00.000Z',reviewedAt:'2026-09-01T00:00:00.000Z'}]});
  const companyEvent=applyCompanyEventPaperPolicy({decisionAsOf:now,expiration:'2026-09-29',calendar,instrument,
    earnings:earnings(),macro:macro()});
  const corporateAction=applyCorporateActionPaperPolicy(corporateInput());
  const receipt=buildPaperEntrySafetyPolicyReceipt({decisionAsOf:now,companyEvent,corporateAction});
  assert.equal(receipt.action,'CLEAR');assert.match(receipt.contentHash,/^[a-f0-9]{64}$/);
});
