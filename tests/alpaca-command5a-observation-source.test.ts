import assert from 'node:assert/strict';
import test from 'node:test';
import { AlpacaCommand5aObservationSource } from '../src/research/alpaca-command5a-observation-source.js';
import { buildShadowEpisodeContract } from '../src/research/shadow-episode-contract.js';
import type { SeriousCandidateSubject } from '../src/research/serious-subject-policy.js';
import type { LocalObservationJobReceipt, LocalObservationSubjectReceipt } from '../src/storage/local-observation-job-scheduler.js';

const symbol = 'SPY261120P00500000';
const subjectInput: SeriousCandidateSubject = {
  subjectId: 'a'.repeat(64), kind: 'CANDIDATE', snapshotId: 'snapshot-1',
  decisionAt: '2026-09-25T14:30:00Z', decisionBucketAt: '2026-09-25T14:00:00Z',
  candidateId: 'candidate-1', branch: 'THETA_CONVENTIONAL', rankAtDecision: 1, selected: false,
  selectionReasons: ['BRANCH_BEST'], candidate: { candidateId: 'candidate-1',
    branch: 'THETA_CONVENTIONAL', action: 'OPEN_CSP', underlying: 'SPY',
    legs: [{ positionIntent: 'SELL_TO_OPEN', optionSymbol: symbol, optionType: 'PUT', strike: 500,
      expiration: '2026-11-20', multiplier: 100, bid: 2, ask: 2.1,
      quoteTimestamp: '2026-09-25T14:29:59Z' }], dte: 56, delta: -0.2, moneyness: 0.91,
    spreadPct: 0.05, liquidity: { volume: 10, openInterest: 100 },
    economics: { premiumPerShare: 2, grossPremium: 200, collateral: 50_000, maxProfit: 200,
      maxLoss: 49_800, breakEven: 498, downsideCushion: 0.1, retainedUpside: null,
      callAwayProceeds: null, wholeChainPnlAtCallAway: null, capitalDayYield: 0.001,
      expectedAfterCostEv: null }, assignmentCapacityQty: 1, aegisState: 'ALLOW_FULL',
    hardBlockers: [], softEvidence: [], unknownEvidence: [], structurallyFeasible: true,
    riskFeasible: true, sizing: { quantity: 1, bindingConstraint: 'BROKER', reasons: [] },
    paretoRank: 1, dominatedBy: [], executionAuthorized: false },
  subjectSelectionPolicyVersion: 'theta-serious-subject-selection-v2', shadowOnly: true,
  brokerAuthority: false, orderSubmitted: false, brokerFill: false,
};

function inputs(inputSubject: SeriousCandidateSubject = subjectInput) {
  const episode = buildShadowEpisodeContract({ subject: inputSubject, decisionId: 'decision-1',
    featureSnapshotHash: 'b'.repeat(64), strategyVersion: 'strategy-v1', riskVersion: 'risk-v1',
    frontierContentHash: 'd'.repeat(64), optionomicsContextHash: 'e'.repeat(64),
    costVersion: 'cost-v1', executionModelVersion: 'execution-v1', sourceSha: 'c'.repeat(40),
    workerSha: 'c'.repeat(40) });
  const subject: LocalObservationSubjectReceipt = { subjectId: episode.subjectId, decisionCycleId: 'cycle-1',
    underlying: 'SPY', episode, sourceSha: episode.sourceSha, workerSha: episode.workerSha,
    contentHash: episode.contentHash, brokerAuthority: false };
  const job: LocalObservationJobReceipt = { observationJobId: 'job-1', subjectId: episode.subjectId,
    horizonCode: '15M', derivedFromHorizonCode: null,
    targetAt: '2026-09-25T14:45:00Z', targetSessionDate: '2026-09-25',
    sourceSha: episode.sourceSha, workerSha: episode.workerSha, contentHash: 'd'.repeat(64),
    state: 'IN_PROGRESS', attempts: 1, lastAttemptAt: '2026-09-25T14:45:00Z',
    claimExpiresAt: '2026-09-25T14:46:00Z', resolvedAt: null, reasonCode: null,
    claimedBy: 'observer-1', brokerAuthority: false };
  return { subject, job };
}

const longSymbol = 'SPY261120P00495000';
const definedRiskSubject: SeriousCandidateSubject = {
  ...subjectInput,
  subjectId: 'f'.repeat(64),
  branch: 'THETA_DEFINED_RISK',
  candidateId: 'defined-risk-candidate-1',
  candidate: {
    ...subjectInput.candidate,
    candidateId: 'defined-risk-candidate-1',
    branch: 'THETA_DEFINED_RISK',
    action: 'OPEN_DEFINED_RISK',
    legs: [
      subjectInput.candidate.legs[0] as typeof subjectInput.candidate.legs[number],
      { positionIntent: 'BUY_TO_OPEN', optionSymbol: longSymbol, optionType: 'PUT', strike: 495,
        expiration: '2026-11-20', multiplier: 100, bid: 1.2, ask: 1.3,
        quoteTimestamp: '2026-09-25T14:29:59Z' },
    ],
  },
};

test('Alpaca source fetches exact leg and stock reference with GET-only research authority', async () => {
  const calls: URL[] = [];
  const fetchImpl: typeof fetch = async (request, init) => {
    assert.equal((init?.method ?? 'GET').toUpperCase(), 'GET');
    const url = new URL(request instanceof Request ? request.url : request.toString());
    calls.push(url);
    if (url.pathname === '/v2/clock') return Response.json({ timestamp: new Date().toISOString(), is_open: true,
      next_open: new Date().toISOString(), next_close: new Date().toISOString() });
    if (url.pathname.includes('/v1beta1/options/snapshots/SPY')) return Response.json({ snapshots: {
      [symbol]: { latestQuote: { bp: 2.2, ap: 2.3, bs: 10, as: 12, t: new Date().toISOString() },
        greeks: { delta: -0.2, gamma: 0.01, theta: -0.03, vega: 0.1, rho: -0.02 },
        impliedVolatility: 0.21 },
    }, next_page_token: null });
    if (url.pathname === '/v2/stocks/SPY/trades/latest') return Response.json({ trade: {
      p: 550, s: 1, t: new Date().toISOString(),
    } });
    return new Response('not found', { status: 404 });
  };
  const source = new AlpacaCommand5aObservationSource({ tradingApiBase: 'https://paper-api.alpaca.test',
    marketDataApiBase: 'https://data.alpaca.test', apiKey: 'test-key', apiSecret: 'test-secret', fetchImpl },
  { optionFeed: 'indicative', stockFeed: 'iex', maximumResearchQuoteAgeSeconds: 60,
    maximumTargetDelaySeconds: 100_000_000 });
  assert.deepEqual(await source.marketState(), { providerAvailable: true, marketSessionOpen: true });
  const receipt = await source.observe(inputs());
  assert.equal(receipt.state, 'READY');
  assert.equal(receipt.quotes[0]?.optionSymbol, symbol);
  assert.equal(receipt.quotes[0]?.feed, 'INDICATIVE');
  assert.equal(receipt.underlying?.price, 550);
  const snapshot = calls.find((url) => url.pathname.includes('/v1beta1/options/snapshots/SPY'));
  assert.ok(snapshot);
  assert.equal(snapshot.searchParams.get('expiration_date_gte'), '2026-11-20');
  assert.equal(snapshot.searchParams.get('expiration_date_lte'), '2026-11-20');
  assert.equal(snapshot.searchParams.get('strike_price_gte'), '500');
  assert.equal(snapshot.searchParams.get('strike_price_lte'), '500');
  assert.equal(source.brokerAuthority, false);
});

test('two-leg defined-risk marks use one bounded snapshot page instead of one provider call per leg', async () => {
  let snapshotCalls = 0;
  const now = new Date().toISOString();
  const fetchImpl: typeof fetch = async (request) => {
    const url = new URL(request instanceof Request ? request.url : request.toString());
    if (url.pathname.includes('/v1beta1/options/snapshots/SPY')) {
      snapshotCalls += 1;
      assert.equal(url.searchParams.get('strike_price_gte'), '495');
      assert.equal(url.searchParams.get('strike_price_lte'), '500');
      return Response.json({ snapshots: {
        [symbol]: { latestQuote: { bp: 2.2, ap: 2.3, t: now }, impliedVolatility: 0.21 },
        [longSymbol]: { latestQuote: { bp: 1.2, ap: 1.3, t: now }, impliedVolatility: 0.22 },
      }, next_page_token: null });
    }
    if (url.pathname === '/v2/stocks/SPY/trades/latest') return Response.json({ trade: {
      p: 550, s: 1, t: now,
    } });
    return new Response('unexpected', { status: 500 });
  };
  const source = new AlpacaCommand5aObservationSource({ tradingApiBase: 'https://paper-api.alpaca.test',
    marketDataApiBase: 'https://data.alpaca.test', apiKey: 'test-key', apiSecret: 'test-secret', fetchImpl },
  { optionFeed: 'indicative', stockFeed: 'iex', maximumResearchQuoteAgeSeconds: 60,
    maximumTargetDelaySeconds: 100_000_000 });
  const receipt = await source.observe(inputs(definedRiskSubject));
  assert.equal(receipt.state, 'READY');
  assert.equal(snapshotCalls, 1);
  assert.deepEqual(receipt.quotes.map((quote) => quote.optionSymbol), [symbol, longSymbol]);
});

test('missing exact contract stays MISSING and never falls back to another quote', async () => {
  const fetchImpl: typeof fetch = async (request) => {
    const url = new URL(request instanceof Request ? request.url : request.toString());
    if (url.pathname.includes('/v1beta1/options/snapshots/SPY')) return Response.json({ snapshots: {
      SPY261120P00490000: { latestQuote: { bp: 1, ap: 1.1, t: new Date().toISOString() } },
    }, next_page_token: null });
    if (url.pathname === '/v2/clock') return Response.json({ is_open: true });
    return new Response('not found', { status: 404 });
  };
  const source = new AlpacaCommand5aObservationSource({ tradingApiBase: 'https://paper-api.alpaca.test',
    marketDataApiBase: 'https://data.alpaca.test', apiKey: 'test-key', apiSecret: 'test-secret', fetchImpl },
  { optionFeed: 'indicative', stockFeed: 'iex', maximumResearchQuoteAgeSeconds: 60,
    maximumTargetDelaySeconds: 100_000_000 });
  const receipt = await source.observe(inputs());
  assert.equal(receipt.state, 'MISSING');
  assert.equal(receipt.reasonCode, 'EXACT_CONTRACT_SNAPSHOT_MISSING');
  assert.equal(receipt.quotes.length, 0);
});

test('one-sided and stale exact quotes remain typed missing observations, never labels', async () => {
  for (const scenario of [
    { quote: { bp: 2.2, ap: null, t: new Date().toISOString() }, reason: 'ASK_MISSING' },
    { quote: { bp: 2.2, ap: 2.3, t: '2026-01-01T00:00:00.000Z' }, reason: 'QUOTE_STALE' },
  ]) {
    const fetchImpl: typeof fetch = async (request) => {
      const url = new URL(request instanceof Request ? request.url : request.toString());
      if (url.pathname.includes('/v1beta1/options/snapshots/SPY')) return Response.json({ snapshots: {
        [symbol]: { latestQuote: scenario.quote, impliedVolatility: 0.21 },
      }, next_page_token: null });
      return new Response('unexpected', { status: 500 });
    };
    const source = new AlpacaCommand5aObservationSource({ tradingApiBase: 'https://paper-api.alpaca.test',
      marketDataApiBase: 'https://data.alpaca.test', apiKey: 'test-key', apiSecret: 'test-secret', fetchImpl },
    { optionFeed: 'indicative', stockFeed: 'iex', maximumResearchQuoteAgeSeconds: 60,
      maximumTargetDelaySeconds: 100_000_000 });
    const receipt = await source.observe(inputs());
    assert.equal(receipt.state, 'MISSING');
    assert.equal(receipt.reasonCode, scenario.reason);
    assert.equal(receipt.quotes.length, 0);
  }
});

test('missing underlying trade facts cannot become a retrying incomplete dataset', async () => {
  const fetchImpl: typeof fetch = async (request) => {
    const url = new URL(request instanceof Request ? request.url : request.toString());
    if (url.pathname.includes('/v1beta1/options/snapshots/SPY')) return Response.json({ snapshots: {
      [symbol]: { latestQuote: { bp: 2.2, ap: 2.3, t: new Date().toISOString() }, impliedVolatility: 0.21 },
    }, next_page_token: null });
    if (url.pathname === '/v2/stocks/SPY/trades/latest') return Response.json({ trade: {
      p: null, s: 1, t: new Date().toISOString(),
    } });
    return new Response('unexpected', { status: 500 });
  };
  const source = new AlpacaCommand5aObservationSource({ tradingApiBase: 'https://paper-api.alpaca.test',
    marketDataApiBase: 'https://data.alpaca.test', apiKey: 'test-key', apiSecret: 'test-secret', fetchImpl },
  { optionFeed: 'indicative', stockFeed: 'iex', maximumResearchQuoteAgeSeconds: 60,
    maximumTargetDelaySeconds: 100_000_000 });
  const receipt = await source.observe(inputs());
  assert.equal(receipt.state, 'MISSING');
  assert.equal(receipt.reasonCode, 'UNDERLYING_TRADE_PRICE_MISSING');
  assert.equal(receipt.underlying, null);
});

test('an expired target window is censored without substituting a current mark', async () => {
  let calls = 0;
  const fetchImpl: typeof fetch = async () => {
    calls += 1;
    return new Response('unexpected', { status: 500 });
  };
  const source = new AlpacaCommand5aObservationSource({ tradingApiBase: 'https://paper-api.alpaca.test',
    marketDataApiBase: 'https://data.alpaca.test', apiKey: 'test-key', apiSecret: 'test-secret', fetchImpl },
  { optionFeed: 'indicative', stockFeed: 'iex', maximumResearchQuoteAgeSeconds: 60,
    maximumTargetDelaySeconds: 60 });
  const receipt = await source.observe(inputs());
  assert.equal(receipt.state, 'MISSING');
  assert.equal(receipt.reasonCode, 'TARGET_OBSERVATION_WINDOW_EXPIRED');
  assert.equal(calls, 0);
});

test('explicit OPRA and SIP requests remain explicit when available, response feed metadata is not invented', async () => {
  const now = new Date().toISOString();
  const feeds:string[]=[];
  const fetchImpl:typeof fetch=async(request)=>{
    const url=new URL(request instanceof Request?request.url:request.toString());
    feeds.push(url.searchParams.get('feed')??'MISSING');
    if(url.pathname.includes('/v1beta1/options/snapshots/SPY'))return Response.json({snapshots:{
      [symbol]:{latestQuote:{bp:2.2,ap:2.3,t:now}},
    },next_page_token:null});
    if(url.pathname==='/v2/stocks/SPY/trades/latest')return Response.json({trade:{p:550,s:1,t:now}});
    return new Response('unexpected',{status:500});
  };
  const source=new AlpacaCommand5aObservationSource({tradingApiBase:'https://paper-api.alpaca.test',
    marketDataApiBase:'https://data.alpaca.test',apiKey:'test-key',apiSecret:'test-secret',fetchImpl},
  {optionFeed:'opra',stockFeed:'sip',maximumResearchQuoteAgeSeconds:60,maximumTargetDelaySeconds:100_000_000});
  const receipt=await source.observe(inputs());
  assert.equal(receipt.state,'READY');
  assert.equal(receipt.quotes[0]?.feed,'OPRA');
  assert.deepEqual(feeds,['opra','sip']);
});

test('entitlement, rate-limit, malformed and network failures remain typed provider failures, never empty opportunity',async()=>{
  const scenarios=[
    {response:async()=>new Response('forbidden',{status:403}),reason:'PROVIDER_NOT_ENTITLED',state:'MISSING'},
    {response:async()=>new Response('rate limited',{status:429}),reason:'PROVIDER_RATE_LIMITED',state:'MISSING'},
    {response:async()=>Response.json({unexpected:true}),reason:'PROVIDER_MALFORMED_RESPONSE',state:'INVALID'},
    {response:async()=>{throw new TypeError('network down');},reason:'PROVIDER_NETWORK_ERROR',state:'MISSING'},
  ] as const;
  for(const scenario of scenarios){
    const source=new AlpacaCommand5aObservationSource({tradingApiBase:'https://paper-api.alpaca.test',
      marketDataApiBase:'https://data.alpaca.test',apiKey:'test-key',apiSecret:'test-secret',fetchImpl:scenario.response as typeof fetch},
    {optionFeed:'opra',stockFeed:'sip',maximumResearchQuoteAgeSeconds:60,maximumTargetDelaySeconds:100_000_000});
    const receipt=await source.observe(inputs());
    assert.equal(receipt.state,scenario.state);
    assert.equal(receipt.reasonCode,scenario.reason);
    assert.equal(receipt.quotes.length,0);
  }
});

test('provider timeout is classified separately from entitlement and empty data',async()=>{
  const fetchImpl:typeof fetch=async(_request,init)=>new Promise((_resolve,reject)=>{
    init?.signal?.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')),{once:true});
  });
  const source=new AlpacaCommand5aObservationSource({tradingApiBase:'https://paper-api.alpaca.test',
    marketDataApiBase:'https://data.alpaca.test',apiKey:'test-key',apiSecret:'test-secret',fetchImpl,requestTimeoutMs:5},
  {optionFeed:'opra',stockFeed:'sip',maximumResearchQuoteAgeSeconds:60,maximumTargetDelaySeconds:100_000_000});
  const receipt=await source.observe(inputs());
  assert.equal(receipt.state,'MISSING');
  assert.equal(receipt.reasonCode,'PROVIDER_TIMEOUT');
});
