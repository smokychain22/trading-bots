import assert from 'node:assert/strict';
import test from 'node:test';
import { buildStrategyQualityShadowDiagnostic, buildUniverseBreadthShadowPlan } from '../src/research/strategy-quality-shadow-diagnostics.js';
import { buildCanonicalStrategyFrontier } from '../src/theta/canonical-strategy-frontier.js';
import { normalizeOptionContract, type NormalizedOptionContract } from '../src/theta/option-contract.js';
import { parseStrategyRoutingResponse, type StrategyFamily } from '../src/theta/strategy-router-contract.js';
import type { HistoricalBar } from '../src/theta/underlying-history.js';

const NOW = '2026-09-19T15:00:00.000Z';
const sampleHistoryBars=Array.from({length:70},(_,index):HistoricalBar=>{
  const timestamp=new Date(Date.UTC(2026,6,index+1)).toISOString();
  const close=100+index+(index%2===0?1:-1);
  return {symbol:'AAPL',timestamp,open:close-0.5,high:close+1,low:close-1,close,volume:1_000_000};
});

const contract = (symbol:string,expiration:string,strike:number,bid:number,ask:number):NormalizedOptionContract =>
  normalizeOptionContract({source:'ALPACA',underlying:'AAPL',optionSymbol:symbol,occSymbol:symbol,optionType:'PUT',strike,
    expiration,asOfDate:'2026-09-19',multiplier:100,underlyingBid:199.9,underlyingAsk:200.1,underlyingLast:200,
    underlyingTimestamp:NOW,bid,ask,bidSize:10,askSize:10,lastTradePrice:bid,lastTradeSize:1,quoteTimestamp:NOW,
    tradeTimestamp:NOW,volume:100,volumeSource:'ALPACA',openInterest:500,openInterestSource:'OPTIONOMICS',iv:0.3,
    delta:-0.2,gamma:0.01,theta:-0.04,vega:0.12,rho:-0.03,greeksTimestamp:NOW,greeksSource:'OPTIONOMICS',
    feed:'INDICATIVE',dataQuality:'GOOD',maxQuoteAgeSecondsForExecutable:30,maxSpreadPctForExecutable:0.2},NOW);

const routing = () => {
  const families:readonly StrategyFamily[]=['THETA_Q','THETA_H','THETA_R','THETA_A','THETA_C','THETA_D'];
  return parseStrategyRoutingResponse({contractVersion:'theta-strategy-router-runtime-v1',snapshotId:'s',timestamp:NOW,
    policyVersion:'p',results:families.map((strategyFamily)=>({strategyFamily,eligible:strategyFamily==='THETA_Q',
      eligibilityState:strategyFamily==='THETA_Q'?'ELIGIBLE_CHALLENGER':'INELIGIBLE_STATE',
      reasons:[{code:'TEST',polarity:0,detail:'test'}],policyVersion:'p'}))});
};

test('DTE-edge and capital-day challengers remain observational and preserve typed Optionomics UNKNOWNs',()=>{
  const inWindow=contract('AAPL261016P00190000','2026-10-16',190,2,2.1);
  const lowerEdge=contract('AAPL261013P00190000','2026-10-13',190,2.4,2.5);
  const upperEdge=contract('AAPL261123P00185000','2026-11-23',185,3,3.2);
  const optionomicsContext={contracts:[{volatility:{impliedVolatility:{state:'KNOWN',value:0.3,reason:null}},
    structuralEconomics:{expectedMoveApprox:{state:'KNOWN',value:12,reason:null}},
    marketStructure:{gammaExposure:{state:'UNKNOWN',value:null,reason:'GEX_UNKNOWN'}}}],
    skew:{state:'UNKNOWN',value:null,reason:'PAIR_UNAVAILABLE'},termStructure:{state:'KNOWN',value:0.02,reason:null},
    volatilitySurface:{state:'KNOWN',value:{point:0.3},reason:null},flow:{windows:[]},providerContext:{metrics:null,
      exposureHeatmap:null,vannaExposureHeatmap:null,charmExposureHeatmap:null,events:null,earningsFilings:null,symbolNews:null}} as const;
  const frontier=buildCanonicalStrategyFrontier({snapshotId:'s',timestamp:NOW,strategyVersion:'v',contracts:[inWindow,lowerEdge,upperEdge],
    routing:routing(),stock:null,assignmentCapacityQty:2,buyingPower:100_000,brokerAllowedQty:2,
    sizingPolicy:{riskBudgetQtyCap:2,collateralQtyCap:2,concentrationQtyCap:2,assignmentCapacityQtyCap:2,tailRiskQtyCap:2,
      correlationQtyCap:2,liquidityQtyCap:2,reducedStateMultiplier:0.5},aegisNewRiskState:'ALLOW_FULL',eventState:null,
    unmanagedBrokerPositionCount:0,unevaluatedUnderlyingCount:0,optionomicsContext});
  const diagnostic=buildStrategyQualityShadowDiagnostic({contracts:[inWindow,lowerEdge,upperEdge],frontier,optionomicsContext,
    historicalBars:sampleHistoryBars,asOf:NOW,
    conventionalDteMin:25,conventionalDteMax:60});
  assert.equal(diagnostic.brokerAuthority,false);
  assert.equal(diagnostic.liveSelectionChanged,false);
  assert.equal(diagnostic.dteEdge.observedCandidateCount,2);
  assert.equal(diagnostic.dteEdge.lowerBandCount,1);
  assert.equal(diagnostic.dteEdge.upperBandCount,1);
  assert.equal(diagnostic.dteEdge.economicallyDominatesSelectedOnKnownObjectives, null);
  assert.ok(['COMMON_HORIZON_REQUIRED', 'NO_SELECTED_OR_EDGE_CANDIDATE'].includes(diagnostic.dteEdge.comparisonState));
  assert.equal(diagnostic.optionomicsFamilies.IV,'KNOWN');
  assert.equal(diagnostic.optionomicsFamilies.TERM,'KNOWN');
  assert.equal(diagnostic.optionomicsFamilies.SKEW,'UNKNOWN');
  assert.equal(diagnostic.optionomicsFamilies.REALIZED_VOLATILITY,'UNAVAILABLE');
  assert.equal(diagnostic.optionomicsFamilies.VRP,'UNAVAILABLE');
  assert.equal(diagnostic.volatilityAcceleration.brokerAuthority,false);
  assert.equal(diagnostic.volatilityAcceleration.state,'KNOWN');
  const rawDiagnostic = buildStrategyQualityShadowDiagnostic({ contracts: [inWindow], frontier,
    optionomicsContext: { ...optionomicsContext, flow: { windows: [{}] }, providerContext: {
      ...optionomicsContext.providerContext, exposureHeatmap: { error: 'unavailable' },
      vannaExposureHeatmap: { rows: [1] }, events: { events: [] },
    } }, historicalBars: [], asOf: NOW, conventionalDteMin: 25, conventionalDteMax: 60 });
  for (const family of ['GEX', 'VANNA', 'EVENTS', 'FLOW'] as const) {
    assert.equal(rawDiagnostic.optionomicsFamilies[family], 'OBSERVED_UNQUALIFIED');
  }
});

test('capital-day challenger records a changed winner without changing the canonical frontier',()=>{
  const longer=contract('AAPL261016P00190000','2026-10-16',190,2,2.1);
  const shorter=contract('AAPL261014P00190000','2026-10-14',190,2,2.1);
  const frontier=buildCanonicalStrategyFrontier({snapshotId:'s',timestamp:NOW,strategyVersion:'v',contracts:[longer,shorter],
    routing:routing(),stock:null,assignmentCapacityQty:2,buyingPower:100_000,brokerAllowedQty:2,sizingPolicy:{riskBudgetQtyCap:2,
      collateralQtyCap:2,concentrationQtyCap:2,assignmentCapacityQtyCap:2,tailRiskQtyCap:2,correlationQtyCap:2,
      liquidityQtyCap:2,reducedStateMultiplier:0.5},aegisNewRiskState:'ALLOW_FULL',eventState:null,
    unmanagedBrokerPositionCount:0,unevaluatedUnderlyingCount:0,optionomicsContext:null});
  const selectedBefore=frontier.selectedCandidateId;
  const diagnostic=buildStrategyQualityShadowDiagnostic({contracts:[longer,shorter],frontier,optionomicsContext:null,
    historicalBars:[],asOf:NOW,
    conventionalDteMin:25,conventionalDteMax:60});
  assert.equal(frontier.selectedCandidateId,selectedBefore);
  assert.equal(diagnostic.capitalDayChallenger.challengerCandidateId,'THETA_CONVENTIONAL:AAPL261014P00190000');
  assert.equal(diagnostic.liveSelectionChanged,false);
});

test('bounded universe challenger rotates outside the two-symbol champion without broker authority',()=>{
  const symbols=['AAPL','MSFT','AMZN','GOOG','META','NVDA','SPY','QQQ','TSLA','AMD'];
  const first=buildUniverseBreadthShadowPlan(symbols,0);
  const second=buildUniverseBreadthShadowPlan(symbols,1);
  assert.deepEqual(first.championSymbols,['AAPL','MSFT']);
  assert.deepEqual(first.challengerSymbols,[{width:5,symbol:'AMZN'}]);
  assert.deepEqual(second.challengerSymbols,[{width:10,symbol:'NVDA'}]);
  assert.equal(first.maximumAdditionalFullScans,1);
  assert.equal(first.brokerAuthority,false);
});
