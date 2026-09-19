import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCanonicalStrategyFrontier } from '../src/theta/canonical-strategy-frontier.js';
import {
  buildOptionsChainDecisionEvidence,
  type ChainScopedAttachment,
} from '../src/theta/options-chain-decision-intelligence.js';
import { normalizeOptionContract, type NormalizedOptionContract } from '../src/theta/option-contract.js';
import { parseStrategyRoutingResponse, type StrategyFamily } from '../src/theta/strategy-router-contract.js';

const NOW='2026-09-14T15:00:00.000Z';
const SNAPSHOT='a'.repeat(64);

function contract(overrides:Partial<Parameters<typeof normalizeOptionContract>[0]>={}):NormalizedOptionContract{
  return normalizeOptionContract({source:'ALPACA',underlying:'AAPL',optionSymbol:'AAPL261016P00190000',occSymbol:'AAPL261016P00190000',
    optionType:'PUT',strike:190,expiration:'2026-10-16',asOfDate:'2026-09-14',multiplier:100,
    underlyingBid:199.9,underlyingAsk:200.1,underlyingLast:200,underlyingTimestamp:NOW,
    bid:2,ask:2.1,bidSize:20,askSize:18,lastTradePrice:2.05,lastTradeSize:1,quoteTimestamp:NOW,tradeTimestamp:NOW,
    volume:250,volumeSource:'ALPACA',openInterest:1200,openInterestSource:'OPTIONOMICS',iv:0.28,delta:-0.22,
    gamma:0.01,theta:-0.04,vega:0.12,rho:-0.03,greeksTimestamp:NOW,greeksSource:'OPTIONOMICS',feed:'OPRA',
    dataQuality:'GOOD',maxQuoteAgeSecondsForExecutable:30,maxSpreadPctForExecutable:0.2,...overrides},NOW);
}

function routing(eligible:readonly StrategyFamily[]){
  const families:readonly StrategyFamily[]=['THETA_Q','THETA_H','THETA_R','THETA_A','THETA_C','THETA_D'];
  return parseStrategyRoutingResponse({contractVersion:'theta-strategy-router-runtime-v1',snapshotId:SNAPSHOT,timestamp:NOW,
    policyVersion:'router-v1',results:families.map((strategyFamily)=>({strategyFamily,eligible:eligible.includes(strategyFamily),
      eligibilityState:eligible.includes(strategyFamily)?'ELIGIBLE_CHALLENGER':'INELIGIBLE_STATE',
      reasons:[{code:'TEST_ROUTE',polarity:0 as const,detail:'test'}],policyVersion:'router-v1'}))});
}

const base={snapshotId:SNAPSHOT,timestamp:NOW,strategyVersion:'theta-strategy-package-v1',stock:null,
  assignmentCapacityQty:2,aegisNewRiskState:'ALLOW_FULL' as const,buyingPower:100_000,brokerAllowedQty:10,
  sizingPolicy:{riskBudgetQtyCap:4,collateralQtyCap:4,concentrationQtyCap:3,assignmentCapacityQtyCap:3,
    tailRiskQtyCap:2,correlationQtyCap:2,liquidityQtyCap:2,reducedStateMultiplier:0.5},eventState:null,
  unmanagedBrokerPositionCount:0,unevaluatedUnderlyingCount:0,optionomicsContext:{state:'UNKNOWN'} as const};

function evidence(contracts:readonly NormalizedOptionContract[],eligible:readonly StrategyFamily[]=['THETA_Q'],
  attachments:readonly ChainScopedAttachment[]=[],policy:Parameters<typeof buildOptionsChainDecisionEvidence>[0]['liquidityPolicy']={
    policyVersion:'test-liquidity-v1',maximumQuoteAgeSeconds:30,maximumRelativeSpread:0.2,minimumOpenInterest:null,
    minimumVolume:null,minimumBidSize:null,minimumAskSize:null},stock:typeof base.stock|{underlying:string;shares:number;currentPrice:number;brokerCostBasisPerShare:number;wholeChainEconomicBasisPerShare:number}=null){
  const frontier=buildCanonicalStrategyFrontier({...base,contracts,routing:routing(eligible),stock});
  return buildOptionsChainDecisionEvidence({fusionSnapshotId:'00000000-0000-4000-8000-000000000043',snapshotContentHash:SNAPSHOT,
    observedAt:NOW,underlying:'AAPL',contracts,frontier,liquidityPolicy:policy,optionomicsAttachments:attachments});
}

test('builds strike, delta, and expiration ladders without turning delta into probability',()=>{
  const c15=contract({optionSymbol:'AAPL261016P00185000',occSymbol:'AAPL261016P00185000',strike:185,delta:-0.15});
  const c25=contract({optionSymbol:'AAPL261016P00195000',occSymbol:'AAPL261016P00195000',strike:195,delta:-0.25,bid:3,ask:3.1});
  const later=contract({optionSymbol:'AAPL261120P00190000',occSymbol:'AAPL261120P00190000',expiration:'2026-11-20',delta:-0.15});
  const result=evidence([c15,c25,later]);
  assert.deepEqual(result.expirationFrontier.map((row)=>row.expiration),['2026-10-16','2026-11-20']);
  assert.deepEqual(result.strikeDeltaFrontiers[0]?.strikeOrder,[185,195]);
  assert.deepEqual(result.strikeDeltaFrontiers[0]?.deltaOrder,[c15.optionSymbol,c25.optionSymbol]);
  assert.equal(result.strikeDeltaFrontiers[0]?.ivOrder.length,2);
  assert.equal(result.strikeDeltaFrontiers[0]?.openInterestOrder.length,2);
  assert.equal(result.strikeDeltaFrontiers[0]?.volumeOrder.length,2);
  assert.equal(result.strikeDeltaFrontiers[0]?.breakevenOrder.length,2);
  assert.equal(result.contracts[0]?.deltaGridDistances['0.15'],0);
  assert.equal(result.contracts[0]?.theoreticalModelValue.state,'UNKNOWN');
  assert.ok(result.contractSelectionReceipt.whyThisDelta.includes('DELTA_IS_NOT_WIN_PROBABILITY'));
});

test('separates hard liquidity policy, stale quotes, zero bids, and Paper indicative evidence',()=>{
  const wide=contract({optionSymbol:'WIDE',occSymbol:'WIDE',bid:1,ask:2});
  const zero=contract({optionSymbol:'ZERO',occSymbol:'ZERO',bid:0,ask:0.1});
  const stale=contract({optionSymbol:'STALE',occSymbol:'STALE',quoteTimestamp:'2026-09-14T14:00:00.000Z',openInterest:50_000});
  const indicative=contract({optionSymbol:'INDICATIVE',occSymbol:'INDICATIVE',feed:'INDICATIVE'});
  const result=evidence([wide,zero,stale,indicative]);
  assert.ok(result.contracts.find((row)=>row.optionSymbol==='WIDE')?.hardLiquidityBlockers.includes('RELATIVE_SPREAD_TOO_WIDE'));
  assert.ok(result.contracts.find((row)=>row.optionSymbol==='ZERO')?.hardLiquidityBlockers.includes('ZERO_BID_UNUSABLE_FOR_SELLER'));
  assert.ok(result.contracts.find((row)=>row.optionSymbol==='STALE')?.hardLiquidityBlockers.includes('QUOTE_STALE_BY_POLICY'));
  assert.equal(result.contracts.find((row)=>row.optionSymbol==='INDICATIVE')?.researchUsable,true);
  assert.equal(result.contracts.find((row)=>row.optionSymbol==='INDICATIVE')?.executionUsable,true);
  assert.equal(result.executionAuthorized,false);
});

test('retains event crossings, expected move, and UNKNOWN volatility without inventing values',()=>{
  const attachments:ChainScopedAttachment[]=[
    {family:'EVENTS',scope:'EXPIRATION',scopeKey:'2026-10-16',classification:'PROVIDER_FACT',state:'KNOWN',value:true,providerTimestamp:NOW,reason:null},
    {family:'EARNINGS',scope:'EXPIRATION',scopeKey:'2026-10-16',classification:'PROVIDER_FACT',state:'KNOWN',value:false,providerTimestamp:NOW,reason:null},
    {family:'EXPECTED_MOVE',scope:'EXPIRATION',scopeKey:'2026-10-16',classification:'THETA_DERIVED',state:'KNOWN',value:12,providerTimestamp:NOW,reason:null},
    {family:'IV_RANK',scope:'CHAIN',scopeKey:'CHAIN',classification:'PROVIDER_FACT',state:'UNKNOWN',value:null,providerTimestamp:null,reason:'NOT_SUPPLIED'},
  ];
  const result=evidence([contract()],['THETA_Q'],attachments);
  assert.equal(result.expirationFrontier[0]?.eventCrossing.value,true);
  assert.equal(result.expirationFrontier[0]?.earningsCrossing.value,false);
  assert.equal(result.expirationFrontier[0]?.expectedMove,12);
  assert.equal(result.optionomicsAttachments.find((item)=>item.family==='IV_RANK')?.state,'UNKNOWN');
});

test('retains invalid surface and provider/derived GEX disagreement as separate evidence',()=>{
  const attachments:ChainScopedAttachment[]=[
    {family:'SURFACE',scope:'CHAIN',scopeKey:'CHAIN',classification:'THETA_DERIVED',state:'INVALID',value:null,providerTimestamp:null,reason:'ARBITRAGE_DIAGNOSTIC_FAILED'},
    {family:'GEX',scope:'CHAIN',scopeKey:'CHAIN',classification:'PROVIDER_FACT',state:'KNOWN',value:100,providerTimestamp:NOW,reason:null},
    {family:'GEX',scope:'CHAIN',scopeKey:'CHAIN',classification:'THETA_DERIVED',state:'KNOWN',value:-80,providerTimestamp:NOW,reason:null},
  ];
  const result=evidence([contract()],['THETA_Q'],attachments);
  assert.equal(result.optionomicsAttachments.find((item)=>item.family==='SURFACE')?.state,'INVALID');
  assert.deepEqual(result.optionomicsAttachments.filter((item)=>item.family==='GEX').map((item)=>item.classification),['PROVIDER_FACT','THETA_DERIVED']);
});

test('compares CSP, defined risk, and WAIT from one immutable snapshot while keeping every action locked',()=>{
  const short=contract({optionSymbol:'AAPL261016P00195000',occSymbol:'AAPL261016P00195000',strike:195,bid:3,ask:3.1});
  const long=contract({optionSymbol:'AAPL261016P00190000',occSymbol:'AAPL261016P00190000',strike:190,bid:1,ask:1.1});
  const result=evidence([short,long],['THETA_Q','THETA_D']);
  assert.ok(result.structureComparisons.some((row)=>row.structure==='CSP'));
  const spread=result.structureComparisons.find((row)=>row.structure==='DEFINED_RISK');
  assert.equal(spread?.legIds.length,2);
  assert.equal(spread?.snapshotId,SNAPSHOT);
  assert.ok(result.structureComparisons.some((row)=>row.structure==='WAIT'));
  assert.ok(result.structureComparisons.every((row)=>row.executionAuthorized===false&&row.afterCostValue===null));
  const readiness=result.branchResearchReadiness.find((row)=>row.branch==='THETA_DEFINED_RISK');
  assert.equal(readiness?.status,'BLOCKED_MISSING_EVIDENCE');
  assert.ok(readiness?.missingEvidence.includes('spreadPermission'));
  assert.equal(readiness?.executionAuthorized,false);
});

test('preserves covered-call whole-chain loss and recovery alternatives rather than chasing cheap premium',()=>{
  const call=contract({optionType:'CALL',optionSymbol:'AAPL261016C00200000',occSymbol:'AAPL261016C00200000',strike:200,bid:1,ask:1.1,delta:0.2});
  const result=evidence([call],[],[],undefined,{underlying:'AAPL',shares:100,currentPrice:198,brokerCostBasisPerShare:205,wholeChainEconomicBasisPerShare:205});
  const cc=result.structureComparisons.find((row)=>row.structure==='CC');
  const canonical=result.structureComparisons.filter((row)=>row.structure==='RECOVERY');
  assert.ok(cc);
  assert.equal(cc.knownStructuralEconomics?.wholeChainPnlAtCallAway,-400);
  assert.ok(canonical.length>=2,'RECOVERY_WAIT and SELL_STOCK/SELL_CC alternatives remain visible');
  assert.equal(result.executionAuthorized,false);
});

test('supports an underlying-only snapshot and emits WAIT research evidence without a fake contract',()=>{
  const result=evidence([],['THETA_Q']);
  assert.equal(result.underlying,'AAPL');
  assert.deepEqual(result.contracts,[]);
  assert.deepEqual(result.expirationFrontier,[]);
  assert.equal(result.contractSelectionReceipt.selectedContractId,null);
  assert.equal(result.counterfactualLabelContract.subjects.at(-1)?.subjectType,'WAIT');
});

test('counterfactual subjects keep neighboring strikes and future labels physically empty',()=>{
  const left=contract({optionSymbol:'LEFT',occSymbol:'LEFT',strike:185,delta:-0.15});
  const center=contract({optionSymbol:'CENTER',occSymbol:'CENTER',strike:190,delta:-0.22,bid:3,ask:3.05});
  const right=contract({optionSymbol:'RIGHT',occSymbol:'RIGHT',strike:195,delta:-0.28});
  const result=evidence([left,center,right]);
  assert.ok(result.counterfactualLabelContract.subjects.some((subject)=>subject.subjectType==='NEIGHBOR_STRIKE'));
  assert.ok(result.counterfactualLabelContract.subjects.every((subject)=>subject.outcome===null&&subject.labelAvailableAt===null));
  assert.equal(result.empiricalEconomicsReady,false);
});
