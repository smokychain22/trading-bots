import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyEmptyManagementLattice, qualifyManagementContractLattice, type OpenManagementCandidateSubject } from
  '../src/theta/production-paper-management-candidate-source.js';
import type { AlpacaOptionContractListing, AlpacaOptionSnapshot } from '../src/theta/option-chain-ingestion.js';

const at='2026-09-22T14:00:00.000Z';
const subject:OpenManagementCandidateSubject={chainId:'chain-1',underlyingId:'underlying-1',underlying:'AAPL',
  lifecycleState:'CSP_OPEN',currentContractSymbol:'AAPL261016P00200000',currentContractId:'contract-1',
  currentOptionType:'PUT',currentExpiration:'2026-10-16',currentMultiplier:100,optionQuantity:1,stockShares:0};
const contract=(overrides:Partial<AlpacaOptionContractListing>={}):AlpacaOptionContractListing=>({
  symbol:'AAPL261023P00195000',strikePrice:195,expirationDate:'2026-10-23',optionType:'PUT',
  multiplier:100,tradable:true,rootSymbol:'AAPL',underlyingSymbol:'AAPL',exerciseStyle:'american',
  deliverables:[{type:'equity',symbol:'AAPL',amount:100,allocationPercentage:100}],...overrides,
});
const snapshot=(overrides:Partial<AlpacaOptionSnapshot>={}):AlpacaOptionSnapshot=>({
  bid:1.5,ask:1.6,bidSize:10,askSize:12,quoteTimestamp:'2026-09-22T13:59:58.000Z',
  greeks:null,impliedVolatility:null,dailyVolume:null,...overrides,
});

test('management discovery qualifies an exact fresh Alpaca Paper option without ranking it',()=>{
  const listing=contract();
  const result=qualifyManagementContractLattice({subject,contracts:[listing],
    snapshots:new Map([[listing.symbol,snapshot()]]),receivedAt:at});
  assert.equal(result.quotes.length,1);
  assert.deepEqual(result.rejections,[]);
});

test('management discovery keeps missing, crossed, stale, and unproven tradability distinct',()=>{
  const listings=[
    contract({symbol:'AAPL261023P00195000'}),
    contract({symbol:'AAPL261023P00190000',strikePrice:190}),
    contract({symbol:'AAPL261023P00185000',strikePrice:185}),
    contract({symbol:'AAPL261023P00180000',strikePrice:180,tradable:null}),
  ];
  const quotes=new Map<string,AlpacaOptionSnapshot>([
    ['AAPL261023P00190000',snapshot({bid:2,ask:1})],
    ['AAPL261023P00185000',snapshot({quoteTimestamp:'2026-09-22T13:58:00.000Z'})],
    ['AAPL261023P00180000',snapshot()],
  ]);
  const result=qualifyManagementContractLattice({subject,contracts:listings,snapshots:quotes,receivedAt:at});
  assert.equal(result.quotes.length,0);
  assert.deepEqual(result.rejections.map((item)=>item.reason),[
    'QUOTE_MISSING','QUOTE_CROSSED','QUOTE_STALE_OR_FUTURE','BROKER_TRADABILITY_NOT_CONFIRMED',
  ]);
});

test('management discovery rejects identity mismatch, adjusted multiplier, same leg, and duplicate',()=>{
  const listings=[contract({symbol:'AAPL261016P00200000',strikePrice:200,expirationDate:'2026-10-16'}),
    contract({symbol:'MSFT261023P00195000'}),contract({multiplier:10}),contract(),contract()];
  const result=qualifyManagementContractLattice({subject,contracts:listings,
    snapshots:new Map([[contract().symbol,snapshot()]]),receivedAt:at});
  assert.deepEqual(result.rejections.map((item)=>item.reason),[
    'SAME_AS_CURRENT_CONTRACT','CONTRACT_IDENTITY_INVALID','MULTIPLIER_MISMATCH',
    'DUPLICATE_CONTRACT_SYMBOL','DUPLICATE_CONTRACT_SYMBOL',
  ]);
});

test('management discovery refuses adjusted or unverified deliverables',()=>{
  const listings=[contract({deliverables:null}),
    contract({symbol:'AAPL261023P00190000',strikePrice:190,
      deliverables:[{type:'equity',symbol:'AAPL',amount:50,allocationPercentage:100}]}),
    contract({symbol:'AAPL261023P00185000',strikePrice:185,rootSymbol:null})];
  const result=qualifyManagementContractLattice({subject,contracts:listings,
    snapshots:new Map(listings.map((item)=>[item.symbol,snapshot()])),receivedAt:at});
  assert.equal(result.quotes.length,0);
  assert.deepEqual(result.rejections.map((item)=>item.reason),[
    'STANDARD_DELIVERABLE_UNVERIFIED','STANDARD_DELIVERABLE_UNVERIFIED','BROKER_CONTRACT_TERMS_UNVERIFIED',
  ]);
});

test('covered-call discovery uses actual shares and contract multiplier, never a default lot size',()=>{
  const stockSubject={...subject,lifecycleState:'RECOVERY_WAIT',currentContractSymbol:null,currentContractId:null,
    currentMultiplier:null,optionQuantity:null,stockShares:80};
  const listing=contract({symbol:'AAPL261023C00210000',strikePrice:210,optionType:'CALL',multiplier:100});
  const result=qualifyManagementContractLattice({subject:stockSubject,contracts:[listing],
    snapshots:new Map([[listing.symbol,snapshot()]]),receivedAt:at});
  assert.deepEqual(result.rejections.map((item)=>item.reason),['INSUFFICIENT_COVERED_SHARES']);
});

test('a missing or stale provider quote cannot be mislabeled as a valid empty result',()=>{
  assert.equal(classifyEmptyManagementLattice([{symbol:'A',reason:'QUOTE_MISSING'}]),'PARTIAL_COVERAGE');
  assert.equal(classifyEmptyManagementLattice([{symbol:'A',reason:'QUOTE_STALE_OR_FUTURE'}]),'STALE');
  assert.equal(classifyEmptyManagementLattice([{symbol:'A',reason:'BROKER_TRADABILITY_NOT_CONFIRMED'}]),'INVALID');
  assert.equal(classifyEmptyManagementLattice([{symbol:'A',reason:'SAME_AS_CURRENT_CONTRACT'}]),'VALID_EMPTY');
});
