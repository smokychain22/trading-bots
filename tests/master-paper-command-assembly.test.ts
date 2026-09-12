import assert from 'node:assert/strict';
import test from 'node:test';
import { assembleMasterPaperExecutionCommand, type MasterPaperCommandAssemblyInput } from '../src/execution/master-paper-command-assembly.js';

const base: MasterPaperCommandAssemblyInput = {
  action:'OPEN_CSP',executionAccountId:'11111111-1111-4111-8111-111111111111',
  decisionId:'22222222-2222-4222-8222-222222222222',candidateId:'AAPL261016P00150000',
  strategyVersion:'theta-conventional-v1',chainId:'33333333-3333-4333-8333-333333333333',
  optionContractId:'44444444-4444-4444-8444-444444444444',underlyingId:'55555555-5555-4555-8555-555555555555',
  symbol:'AAPL261016P00150000',quantity:1,multiplier:100,limitPrice:1.25,pricingPolicyVersion:'passive-limit-v1',
  quote:{source:'ALPACA',feed:'OPRA',bid:1.2,ask:1.3,observedAt:'2026-09-13T14:00:00Z',maximumAgeSeconds:10},
  accountVerified:true,optionsCapabilityVerified:true,aegisState:'ALLOW_FULL',now:'2026-09-13T14:00:05Z',
  decisionExpiresAt:'2026-09-13T14:01:00Z',attempt:1,
};

test('selected CSP becomes one deterministic OPRA-bound persisted command',()=>{
  const first=assembleMasterPaperExecutionCommand(base),second=assembleMasterPaperExecutionCommand(base);
  assert.deepEqual(first,second);
  assert.equal(first.request.position_intent,'sell_to_open');
  assert.equal(first.request.qty,1);
  assert.equal(first.gate.priceEvidence,'ALPACA_OPRA_BBO');
  assert.match(first.executionEvidence.quoteContentHash,/^[0-9a-f]{64}$/);
});

test('indicative option data, stale quotes and out-of-BBO limits fail before persistence',()=>{
  assert.throws(()=>assembleMasterPaperExecutionCommand({...base,quote:{...base.quote,feed:'INDICATIVE'}}),/REQUIRES_ALPACA_OPRA/);
  assert.throws(()=>assembleMasterPaperExecutionCommand({...base,now:'2026-09-13T14:00:20Z'}),/QUOTE_NOT_FRESH/);
  assert.throws(()=>assembleMasterPaperExecutionCommand({...base,limitPrice:1.31}),/LIMIT_OUTSIDE_BBO/);
});

test('covered-call opening requires actual reconciled share coverage',()=>{
  const cc={...base,action:'OPEN_CC' as const,symbol:'AAPL261016C00170000',candidateId:'AAPL261016C00170000'};
  assert.throws(()=>assembleMasterPaperExecutionCommand(cc),/confirmed share coverage/);
  const command=assembleMasterPaperExecutionCommand({...cc,confirmedCoveredShares:100});
  assert.equal(command.request.position_intent,'sell_to_open');
});

test('stock disposal requires stock BBO lineage and no option contract',()=>{
  const command=assembleMasterPaperExecutionCommand({...base,action:'SELL_STOCK',symbol:'AAPL',candidateId:'assigned-stock',
    optionContractId:null,multiplier:1,limitPrice:149.95,quote:{...base.quote,feed:'SIP',bid:149.9,ask:150}});
  assert.equal(command.request.position_intent,undefined);
  assert.equal(command.gate.priceEvidence,'ALPACA_STOCK_BBO');
  assert.equal(command.gate.isNewEntry,false);
  assert.throws(()=>assembleMasterPaperExecutionCommand({...base,action:'SELL_STOCK',symbol:'AAPL',candidateId:'assigned-stock',
    optionContractId:null,multiplier:1,limitPrice:149.95,quote:{...base.quote,feed:'OPRA',bid:149.9,ask:150}}),/STOCK_EXECUTION_LINEAGE_INVALID/);
});
