import assert from 'node:assert/strict';
import test from 'node:test';
import { AlpacaExecutionQuoteSource, AlpacaIndicativeOptionQuoteSource } from '../src/execution/alpaca-execution-quote-source.js';
import type { ApprovedMasterPaperActionPlan } from '../src/execution/master-paper-action-handoff.js';
import type { AlpacaProviderConfig } from '../src/theta/alpaca-provider.js';

const plan = (symbol = 'SPY261009P00500000'): ApprovedMasterPaperActionPlan => ({
  action: 'OPEN_CSP', optionContractId: 'contract-id', optionType: 'PUT', underlying: 'SPY', symbol,
} as ApprovedMasterPaperActionPlan);

const config = (fetchImpl: typeof fetch): AlpacaProviderConfig => ({
  tradingApiBase: 'https://paper-api.alpaca.markets', marketDataApiBase: 'https://data.alpaca.markets',
  apiKey: 'test-only', apiSecret: 'test-only', fetchImpl,
});

test('both Paper quote sources scope the pre-submit read to exact OCC expiration and strike', async () => {
  const requested: URL[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url=new URL(String(input));
    requested.push(url);
    if(url.pathname==='/v2/options/contracts')return Response.json({option_contracts:[{
      symbol:'SPY261009P00500000',strike_price:'500',expiration_date:'2026-10-09',size:'100',tradable:true,
      underlying_symbol:'SPY',style:'american',deliverables:[{type:'equity',symbol:'SPY',amount:'100',allocation_percentage:'100'}],
    }],next_page_token:null});
    return Response.json({ snapshots: {
      SPY261009P00500000: { latestQuote: { bp: 0.11, ap: 0.12, bs: 40, as: 35, t: '2026-10-01T14:30:00Z' } },
    }, next_page_token: null });
  }) as typeof fetch;
  const sources = [new AlpacaExecutionQuoteSource(config(fetchImpl)), new AlpacaIndicativeOptionQuoteSource(config(fetchImpl))];
  for (const source of sources) {
    const quote = await source.getCurrentQuote(plan(), '2026-10-01T14:30:01Z');
    assert.equal(quote?.contractId, 'SPY261009P00500000');
    assert.equal(quote?.sourceSemantics, 'PAPER_INDICATIVE_REFERENCE');
    assert.deepEqual(quote?.optionIdentity, {
      underlying: 'SPY', optionSymbol: 'SPY261009P00500000', expiration: '2026-10-09', strike: 500,
      optionType: 'PUT', multiplier: 100, contractTradable: true, exerciseStyle: 'american',
      deliverableClassification: 'STANDARD_EQUITY',
    });
  }
  assert.equal(requested.length, 4);
  for (const url of requested.filter((item)=>item.pathname.includes('/snapshots/'))) {
    assert.equal(url.searchParams.get('expiration_date_gte'), '2026-10-09');
    assert.equal(url.searchParams.get('expiration_date_lte'), '2026-10-09');
    assert.equal(url.searchParams.get('strike_price_gte'), '500');
    assert.equal(url.searchParams.get('strike_price_lte'), '500');
    assert.equal(url.searchParams.get('feed'), 'indicative');
  }
  for(const url of requested.filter((item)=>item.pathname==='/v2/options/contracts')){
    assert.equal(url.searchParams.get('show_deliverables'),'true');
    assert.equal(url.searchParams.get('underlying_symbols'),'SPY');
  }
});

test('pre-submit quote refuses ambiguous identity and incomplete provider pages', async () => {
  let requests = 0;
  const fetchImpl = (async (input:RequestInfo|URL) => {
    requests += 1;
    const url=new URL(String(input));
    if(url.pathname==='/v2/options/contracts')return Response.json({option_contracts:[{
      symbol:'SPY261009P00500000',strike_price:'500',expiration_date:'2026-10-09',size:'100',tradable:true,
      underlying_symbol:'SPY',style:'american',deliverables:[{type:'equity',symbol:'SPY',amount:'100',allocation_percentage:'100'}],
    }],next_page_token:null});
    return Response.json({ snapshots: {
      SPY261009P00500000: { latestQuote: { bp: 0.11, ap: 0.12, t: '2026-10-01T14:30:00Z' } },
    }, next_page_token: 'more' });
  }) as typeof fetch;
  const source = new AlpacaIndicativeOptionQuoteSource(config(fetchImpl));
  assert.equal(await source.getCurrentQuote(plan('BAD_SYMBOL'), '2026-10-01T14:30:01Z'), null);
  assert.equal(requests, 0);
  // A provider response that still has another page cannot prove the exact
  // requested contract was uniquely and completely observed.
  const incompleteConfig = config(fetchImpl);
  const incompleteSource = new AlpacaIndicativeOptionQuoteSource(incompleteConfig);
  // The snapshot adapter is bounded to ten pages, so a repeated page token
  // yields incomplete coverage and must not become an executable reference.
  assert.equal(await incompleteSource.getCurrentQuote(plan(), '2026-10-01T14:30:01Z'), null);
  assert.equal(requests, 11);
});
