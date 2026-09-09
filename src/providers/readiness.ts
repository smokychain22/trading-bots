import type { Environment } from '../config/environment.js';

export type CheckResult = {
  readonly capability: string;
  readonly ok: boolean;
  readonly status: number | null;
  readonly observedAt: string;
  readonly details: Readonly<Record<string, boolean | number | string | null>>;
};

const dataApiBaseUrl = 'https://data.alpaca.markets';
const optionomicsReferenceUrl = 'https://optionomics.ai/docs/api';
const optionomicsApiBaseUrl = 'https://optionomics.ai';

export const assertPaperAlpacaUrl = (baseUrl: string): URL => {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error('ALPACA_BASE_URL must be a complete HTTPS paper URL.');
  }
  if (url.protocol !== 'https:' || url.hostname !== 'paper-api.alpaca.markets') {
    throw new Error('Alpaca readiness checks require https://paper-api.alpaca.markets. Live endpoints are forbidden.');
  }
  return url;
};

export const extractDocumentedOperationPaths = (referenceHtml: string): readonly string[] =>
  [...new Set(Array.from(referenceHtml.matchAll(/\/api\/v1\/[A-Za-z0-9_{}./-]+/g), (match) => match[0]))]
    .filter((path): path is string => path !== undefined)
    .sort();

const observedAt = (): string => new Date().toISOString();

const readJson = async (
  capability: string,
  input: RequestInfo | URL,
  init: RequestInit,
  evaluate: (body: unknown, response: Response) => Readonly<Record<string, boolean | number | string | null>>
): Promise<CheckResult> => {
  try {
    const response = await fetch(input, init);
    const contentType = response.headers.get('content-type') ?? '';
    const body: unknown = contentType.includes('application/json')
      ? await response.json().catch(() => null)
      : await response.text().catch(() => '');
    return {
      capability,
      ok: response.ok,
      status: response.status,
      observedAt: observedAt(),
      details: evaluate(body, response)
    };
  } catch (error) {
    return {
      capability,
      ok: false,
      status: null,
      observedAt: observedAt(),
      details: { networkError: error instanceof Error ? error.name : 'UnknownError' }
    };
  }
};

const alpacaHeaders = (environment: Environment): HeadersInit => ({
  'APCA-API-KEY-ID': environment.ALPACA_API_KEY ?? '',
  'APCA-API-SECRET-KEY': environment.ALPACA_SECRET_KEY ?? ''
});

const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

export const checkAlpaca = async (environment: Environment): Promise<readonly CheckResult[]> => {
  const baseUrl = assertPaperAlpacaUrl(environment.ALPACA_BASE_URL ?? '');
  const headers = alpacaHeaders(environment);
  const account = await readJson('alpaca.account', new URL('/v2/account', baseUrl), { headers }, (body) => {
    const accountBody = object(body);
    const buyingPower = Number(accountBody.buying_power);
    return {
      paperEndpoint: true,
      accountStatusPresent: typeof accountBody.status === 'string',
      buyingPowerReadable: Number.isFinite(buyingPower),
      tradingBlocked: accountBody.trading_blocked === true,
      transfersBlocked: accountBody.transfers_blocked === true
    };
  });
  const clock = await readJson('alpaca.clock', new URL('/v2/clock', baseUrl), { headers }, (body) => {
    const clockBody = object(body);
    return { timestampPresent: typeof clockBody.timestamp === 'string', isOpenPresent: typeof clockBody.is_open === 'boolean' };
  });
  const today = new Date().toISOString().slice(0, 10);
  const calendarUrl = new URL('/v2/calendar', baseUrl);
  calendarUrl.searchParams.set('start', today);
  calendarUrl.searchParams.set('end', today);
  const calendar = await readJson('alpaca.calendar', calendarUrl, { headers }, (body) => ({
    responseIsArray: Array.isArray(body),
    sessionCount: Array.isArray(body) ? body.length : null
  }));
  const contractsUrl = new URL('/v2/options/contracts', baseUrl);
  contractsUrl.search = new URLSearchParams({ underlying_symbols: 'SPY', status: 'active', limit: '1', show_deliverables: 'true' }).toString();
  const contracts = await readJson('alpaca.optionContracts', contractsUrl, { headers }, (body) => {
    const contractBody = object(body);
    const contractList = Array.isArray(contractBody.option_contracts) ? contractBody.option_contracts : [];
    const first = object(contractList[0]);
    return {
      contractCount: contractList.length,
      contractSymbolPresent: typeof first.symbol === 'string',
      deliverablesPresent: Array.isArray(first.deliverables),
      tradableFlagPresent: typeof first.tradable === 'boolean'
    };
  });
  const dataUrl = new URL('/v1beta1/options/snapshots/SPY', dataApiBaseUrl);
  dataUrl.search = new URLSearchParams({ feed: 'opra', limit: '1' }).toString();
  const marketData = await readJson('alpaca.optionMarketData.opra', dataUrl, { headers }, (_body, response) => ({
    requestedFeed: 'opra',
    contentTypePresent: response.headers.has('content-type'),
    requestIdPresent: response.headers.has('x-request-id')
  }));

  return [account, clock, calendar, contracts, marketData];
};

export const checkOptionomics = async (environment: Environment): Promise<readonly CheckResult[]> => {
  const headers: HeadersInit = { authorization: `Bearer ${environment.OPTIONOMICS_API_KEY ?? ''}` };
  const tickers = await readJson('optionomics.authentication.tickers', `${optionomicsApiBaseUrl}/api/v1/tickers`, { headers }, (body, response) => {
    const responseBody = object(body);
    return {
      tickersArrayPresent: Array.isArray(responseBody.tickers),
      rateLimitLimitPresent: response.headers.has('x-ratelimit-limit'),
      rateLimitRemainingPresent: response.headers.has('x-ratelimit-remaining'),
      rateLimitResetPresent: response.headers.has('x-ratelimit-reset')
    };
  });
  const reference = await readJson('optionomics.documentedContracts', optionomicsReferenceUrl, {}, (body) => {
    const html = typeof body === 'string' ? body : '';
    const paths = extractDocumentedOperationPaths(html);
    return {
      documentedPathCount: paths.length,
      tickersOperationDocumented: paths.includes('/api/v1/tickers'),
      optionsOperationDocumented: paths.includes('/api/v1/stocks/{symbol}/options')
    };
  });
  return [tickers, reference];
};
