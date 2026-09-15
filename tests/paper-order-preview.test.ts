import assert from 'node:assert/strict';
import test from 'node:test';
import {buildPaperOrderPreview,type PaperOrderPreviewInput} from '../src/execution/paper-order-preview.js';
const base=():PaperOrderPreviewInput=>({previewId:'preview-1',asOf:'2026-09-16T15:00:00Z',strategyBranch:'THETA_CONVENTIONAL',
  strategyVersion:'theta-conventional-v1',legs:[{occContract:'AAPL261016P00150000',positionIntent:'SELL_TO_OPEN',ratio:1,quantity:1,
    optionType:'PUT',strike:150,expiration:'2026-10-16',dte:30}],orderType:'LIMIT',limitPrice:1.24,quoteProvider:'QUALIFIED_PROVIDER',
  quoteSemantics:'TRUSTED_TWO_SIDED_ORDER_PRICING',quoteObservedAt:'2026-09-16T14:59:58Z',quoteAgeMs:2000,maximumQuoteAgeMs:10000,
  bid:1.2,ask:1.3,creditDebit:124,maximumRisk:14876,buyingPowerEffect:15000,capitalRequired:15000,aegisResult:'ALLOW_FULL',
  portfolioEffects:{delta:-20,collateral:15000},operatorPaused:false,emergencyLocked:false,executionQuoteQualified:true,
  persistenceReady:true,idempotencyReady:true,clientOrderId:'theta-preview-1'});
test('ready dry run stays mechanically incapable of broker submission',()=>{
  const receipt=buildPaperOrderPreview(base());
  assert.equal(receipt.result,'DRY_RUN_READY');assert.deepEqual(receipt.blockers,[]);
  assert.deepEqual([receipt.executionAuthorized,receipt.submitToBroker,receipt.paperOrderCreated],[false,false,false]);
  assert.match(receipt.receiptHash,/^[0-9a-f]{64}$/);
});
test('preview fails closed on stale indicative evidence and operator locks',()=>{
  const input=base();const receipt=buildPaperOrderPreview({...input,quoteSemantics:'INDICATIVE',quoteAgeMs:20000,
    executionQuoteQualified:false,operatorPaused:true,clientOrderId:null,idempotencyReady:false});
  assert.equal(receipt.result,'DRY_RUN_BLOCKED');
  for(const blocker of ['ORDER_PRICING_SEMANTICS_NOT_PROVEN','QUOTE_STALE_OR_UNKNOWN','EXECUTION_QUOTE_NOT_QUALIFIED','OPERATOR_PAUSED','IDEMPOTENCY_NOT_READY'])
    assert.ok(receipt.blockers.includes(blocker));
});
test('multi-leg previews require explicit package risk',()=>{
  const input=base(),first=input.legs.at(0);assert.ok(first);const receipt=buildPaperOrderPreview({...input,legs:[...input.legs,{...first,occContract:'AAPL261016P00140000',positionIntent:'BUY_TO_OPEN'}],maximumRisk:null});
  assert.ok(receipt.blockers.includes('MULTI_LEG_MAX_RISK_UNKNOWN'));
});
