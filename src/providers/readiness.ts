import type { Environment } from '../config/environment.js';

export type CapabilityState = 'GOOD' | 'DEGRADED' | 'STALE' | 'UNKNOWN' | 'INVALID' | 'NOT_ENTITLED';

export type CheckResult = {
  readonly provider: 'ALPACA' | 'OPTIONOMICS';
  readonly capability: string;
  readonly operationAlias: string;
  readonly state: CapabilityState;
  readonly httpStatus: number | null;
  readonly observedAt: string;
  readonly retrievedAt: string;
  readonly latencyMs: number | null;
  readonly provenance: Readonly<Record<string, string | number | boolean | null>>;
  readonly details: Readonly<Record<string, boolean | number | string | null>>;
};

export const configurationFailureResult = (
  provider: CheckResult['provider'],
  error: unknown
): CheckResult => ({
  provider,
  capability: `${provider.toLowerCase()}.configuration`,
  operationAlias: `${provider.toLowerCase()}.configuration`,
  state: 'INVALID',
  httpStatus: null,
  observedAt: new Date().toISOString(),
  retrievedAt: new Date().toISOString(),
  latencyMs: null,
  provenance: { credentialValuesLogged: false },
  details: { configurationError: error instanceof Error ? error.message : 'UnknownError' }
});

type JsonRecord = Record<string, unknown>;

const alpacaDataBaseUrl = 'https://data.alpaca.markets';
const optionomicsReferenceUrl = 'https://optionomics.ai/docs/api';
const optionomicsApiBaseUrl = 'https://optionomics.ai';
const optionomicsContractVersion = 'optionomics-api-v1-docs-2026-09-09';

const object = (value: unknown): JsonRecord =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};

const observedAt = (): string => new Date().toISOString();

const stateForResponse = (response: Response): CapabilityState => {
  if (response.ok) return 'GOOD';
  if (response.status === 401 || response.status === 400 || response.status === 404 || response.status === 422) return 'INVALID';
  if (response.status === 402 || response.status === 403) return 'NOT_ENTITLED';
  if (response.status === 429 || response.status >= 500) return 'DEGRADED';
  return 'UNKNOWN';
};

// Capability distinction (security/architecture correction, 2026-09-10):
// an option market-data feed being reachable is NOT the same claim as it
// being execution-quality. Official Alpaca documentation describes
// INDICATIVE quotes as modified derivatives of OPRA with delayed trades --
// useful for integration development, schema verification, pipeline
// testing, and candidate-generation mechanics (MARKET_DATA_ENGINEERING_READY),
// but never sufficient on its own for execution-quality validation,
// slippage/TCA validation, or the first-autonomous-PAPER-order release gate
// (MARKET_DATA_EXECUTION_READY) unless a separately-approved real-time
// executable-quality source is in place. This distinction must never be
// silently upgraded -- callers check `executionGrade`, not just `state`.
export const classifyOptionFeedCapability = (
  feed: 'OPRA' | 'INDICATIVE',
  state: CapabilityState
): { readonly optionFeed: 'OPRA' | 'INDICATIVE'; readonly marketDataEngineeringReady: boolean; readonly executionGrade: boolean } => ({
  optionFeed: feed,
  marketDataEngineeringReady: state === 'GOOD',
  // OPRA is Alpaca's consolidated real options BBO; INDICATIVE is
  // documented as a modified derivative with delayed trades and is never
  // treated as execution-grade regardless of its own reachability state.
  executionGrade: feed === 'OPRA' && state === 'GOOD'
});

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

const readJson = async (
  provider: CheckResult['provider'],
  capability: string,
  operationAlias: string,
  input: RequestInfo | URL,
  init: RequestInit,
  provenance: CheckResult['provenance'],
  evaluate: (body: unknown, response: Response) => CheckResult['details']
): Promise<CheckResult> => {
  const requestedAt = performance.now();
  const elapsedMs = (): number => Math.round(performance.now() - requestedAt);
  try {
    const response = await fetch(input, init);
    const contentType = response.headers.get('content-type') ?? '';
    const body: unknown = contentType.includes('application/json')
      ? await response.json().catch(() => null)
      : await response.text().catch(() => '');
    return {
      provider,
      capability,
      operationAlias,
      state: stateForResponse(response),
      httpStatus: response.status,
      observedAt: observedAt(),
      retrievedAt: observedAt(),
      latencyMs: elapsedMs(),
      provenance,
      details: evaluate(body, response)
    };
  } catch (error) {
    return {
      provider,
      capability,
      operationAlias,
      state: 'UNKNOWN',
      httpStatus: null,
      observedAt: observedAt(),
      retrievedAt: observedAt(),
      latencyMs: elapsedMs(),
      provenance,
      details: { networkError: error instanceof Error ? error.name : 'UnknownError' }
    };
  }
};

const alpacaHeaders = (environment: Environment): HeadersInit => ({
  'APCA-API-KEY-ID': environment.ALPACA_API_KEY ?? '',
  'APCA-API-SECRET-KEY': environment.ALPACA_SECRET_KEY ?? ''
});

const optionomicsHeaders = (environment: Environment): HeadersInit => ({
  'X-USER-EMAIL': environment.OPTIONOMICS_EMAIL ?? '',
  'X-USER-TOKEN': environment.OPTIONOMICS_API_KEY ?? ''
});

const alpacaProvenance = (host: string, path: string): CheckResult['provenance'] => ({
  host,
  path,
  method: 'GET',
  executableTruth: true,
  credentialValuesLogged: false
});

const optionomicsProvenance = (path: string): CheckResult['provenance'] => ({
  host: 'optionomics.ai',
  path,
  method: 'GET',
  contractVersion: optionomicsContractVersion,
  executableTruth: false,
  credentialValuesLogged: false
});

export const checkAlpaca = async (environment: Environment): Promise<readonly CheckResult[]> => {
  const baseUrl = assertPaperAlpacaUrl(environment.ALPACA_BASE_URL ?? '');
  const headers = alpacaHeaders(environment);
  const today = new Date().toISOString().slice(0, 10);
  const account = await readJson('ALPACA', 'ACCOUNT_ENVIRONMENT', 'alpaca.get_account', new URL('/v2/account', baseUrl), { headers }, alpacaProvenance(baseUrl.host, '/v2/account'), (body) => {
    const accountBody = object(body);
    const accountId = typeof accountBody.id === 'string' ? accountBody.id : '';
    return {
      paperEndpoint: true,
      maskedAccount: accountId ? `••••${accountId.slice(-4)}` : null,
      accountStatusPresent: typeof accountBody.status === 'string',
      equityReadable: Number.isFinite(Number(accountBody.equity)),
      cashReadable: Number.isFinite(Number(accountBody.cash)),
      buyingPowerReadable: Number.isFinite(Number(accountBody.buying_power)),
      optionsApprovalReadable: typeof accountBody.options_approved_level === 'number' || typeof accountBody.options_trading_level === 'number',
      optionsLevel: typeof accountBody.options_approved_level === 'number'
        ? accountBody.options_approved_level
        : typeof accountBody.options_trading_level === 'number'
          ? accountBody.options_trading_level
          : null,
      tradingBlocked: accountBody.trading_blocked === true
    };
  });
  const clock = await readJson('ALPACA', 'MARKET_CLOCK', 'alpaca.get_clock', new URL('/v2/clock', baseUrl), { headers }, alpacaProvenance(baseUrl.host, '/v2/clock'), (body) => {
    const clockBody = object(body);
    return { timestampPresent: typeof clockBody.timestamp === 'string', isOpenPresent: typeof clockBody.is_open === 'boolean' };
  });
  const calendarUrl = new URL('/v2/calendar', baseUrl);
  calendarUrl.search = new URLSearchParams({ start: today, end: today }).toString();
  const calendar = await readJson('ALPACA', 'MARKET_CALENDAR', 'alpaca.get_calendar', calendarUrl, { headers }, alpacaProvenance(baseUrl.host, '/v2/calendar'), (body) => ({
    responseIsArray: Array.isArray(body),
    sessionCount: Array.isArray(body) ? body.length : null
  }));
  const stockUrl = new URL('/v2/stocks/quotes/latest', alpacaDataBaseUrl);
  stockUrl.search = new URLSearchParams({ symbols: 'SPY', feed: 'iex' }).toString();
  const stockData = await readJson('ALPACA', 'STOCK_DATA_IEX', 'alpaca.get_latest_stock_quotes', stockUrl, { headers }, alpacaProvenance(stockUrl.host, stockUrl.pathname), (body) => ({
    quoteEnvelopePresent: typeof object(body).quotes === 'object',
    requestedFeed: 'iex'
  }));
  const contractsUrl = new URL('/v2/options/contracts', baseUrl);
  contractsUrl.search = new URLSearchParams({ underlying_symbols: 'SPY', status: 'active', limit: '1', show_deliverables: 'true' }).toString();
  const contracts = await readJson('ALPACA', 'OPTION_CONTRACT_DISCOVERY', 'alpaca.get_option_contracts', contractsUrl, { headers }, alpacaProvenance(baseUrl.host, '/v2/options/contracts'), (body) => {
    const contractList = Array.isArray(object(body).option_contracts) ? object(body).option_contracts as unknown[] : [];
    const first = object(contractList[0]);
    return { contractCount: contractList.length, contractSymbolPresent: typeof first.symbol === 'string', deliverablesPresent: Array.isArray(first.deliverables), tradableFlagPresent: typeof first.tradable === 'boolean' };
  });
  const optionUrl = new URL('/v1beta1/options/snapshots/SPY', alpacaDataBaseUrl);
  optionUrl.search = new URLSearchParams({ feed: 'opra', limit: '1' }).toString();
  const optionData = await readJson('ALPACA', 'OPTIONS_MARKET_DATA_OPRA', 'alpaca.get_option_snapshots', optionUrl, { headers }, alpacaProvenance(optionUrl.host, optionUrl.pathname), (body, response) => {
    const snapshots = object(body).snapshots;
    const first = object(snapshots && typeof snapshots === 'object' ? Object.values(snapshots)[0] : undefined);
    return {
      requestedFeed: 'opra', snapshotEnvelopePresent: typeof snapshots === 'object', greeksPresent: typeof first.greeks === 'object',
      requestIdPresent: response.headers.has('x-request-id'), ...classifyOptionFeedCapability('OPRA', stateForResponse(response))
    };
  });
  // Always checked (never only as an OPRA fallback) so this account's real
  // capability profile is complete: INDICATIVE reachability never implies
  // OPRA is unavailable, and vice versa -- both are independently reported.
  const indicativeUrl = new URL('/v1beta1/options/snapshots/SPY', alpacaDataBaseUrl);
  indicativeUrl.search = new URLSearchParams({ feed: 'indicative', type: 'put', limit: '1' }).toString();
  const optionDataIndicative = await readJson('ALPACA', 'OPTIONS_MARKET_DATA_INDICATIVE', 'alpaca.get_option_snapshots', indicativeUrl, { headers }, alpacaProvenance(indicativeUrl.host, indicativeUrl.pathname), (body, response) => {
    const snapshots = object(body).snapshots;
    const first = object(snapshots && typeof snapshots === 'object' ? Object.values(snapshots)[0] : undefined);
    return {
      requestedFeed: 'indicative', snapshotEnvelopePresent: typeof snapshots === 'object', greeksPresent: typeof first.greeks === 'object',
      requestIdPresent: response.headers.has('x-request-id'), ...classifyOptionFeedCapability('INDICATIVE', stateForResponse(response))
    };
  });
  const positions = await readJson('ALPACA', 'POSITIONS_READ', 'alpaca.get_positions', new URL('/v2/positions', baseUrl), { headers }, alpacaProvenance(baseUrl.host, '/v2/positions'), (body) => ({ responseIsArray: Array.isArray(body), positionCount: Array.isArray(body) ? body.length : null }));
  const activitiesUrl = new URL('/v2/account/activities/FILL', baseUrl);
  activitiesUrl.search = new URLSearchParams({ direction: 'desc', page_size: '1' }).toString();
  const activities = await readJson('ALPACA', 'ACCOUNT_ACTIVITY_READ', 'alpaca.get_account_activities_fill', activitiesUrl, { headers }, alpacaProvenance(baseUrl.host, '/v2/account/activities/FILL'), (body) => ({ responseIsArray: Array.isArray(body), activityCount: Array.isArray(body) ? body.length : null }));
  const corporateActionsUrl = new URL('/v1/corporate-actions', alpacaDataBaseUrl);
  corporateActionsUrl.search = new URLSearchParams({ symbols: 'SPY', start: today, end: today, limit: '1' }).toString();
  const corporateActions = await readJson('ALPACA', 'CORPORATE_ACTIONS_READ', 'alpaca.get_corporate_actions', corporateActionsUrl, { headers }, alpacaProvenance(corporateActionsUrl.host, corporateActionsUrl.pathname), (body) => ({ responseIsObject: typeof body === 'object' && body !== null }));
  return [account, clock, calendar, stockData, contracts, optionData, optionDataIndicative, positions, activities, corporateActions];
};

type OptionomicsProbe = { readonly capability: string; readonly operationAlias: string; readonly path: string };

const optionomicsProbes = (documentedPaths: readonly string[]): readonly OptionomicsProbe[] => {
  const expected: readonly OptionomicsProbe[] = [
    { capability: 'OPTIONOMICS_AUTHENTICATION', operationAlias: 'opt.list_tickers', path: '/api/v1/tickers' },
    { capability: 'OPTIONOMICS_IV_SKEW_TERM_SURFACE', operationAlias: 'opt.get_symbol_metrics', path: '/api/v1/stocks/{symbol}/metrics' },
    { capability: 'OPTIONOMICS_OPTION_CHAIN_GREEKS', operationAlias: 'opt.get_option_chain', path: '/api/v1/stocks/{symbol}/options' },
    { capability: 'OPTIONOMICS_HISTORY', operationAlias: 'opt.get_price_history', path: '/api/v1/stocks/{symbol}/price_history' },
    { capability: 'OPTIONOMICS_FLOW_UOA', operationAlias: 'opt.get_flow_net', path: '/api/v1/flow/net' },
    { capability: 'OPTIONOMICS_EVENTS', operationAlias: 'opt.list_events', path: '/api/v1/events' }
  ];
  return expected.filter((probe) => documentedPaths.includes(probe.path));
};

export const optionomicsProbeUrl = (operationAlias: string, documentedPath: string): URL => {
  const path = documentedPath.replace('{symbol}', 'SPY');
  const url = new URL(path, optionomicsApiBaseUrl);
  if (operationAlias === 'opt.get_flow_net') url.searchParams.set('symbol', 'SPY');
  return url;
};

export const checkOptionomics = async (environment: Environment): Promise<readonly CheckResult[]> => {
  const reference = await readJson('OPTIONOMICS', 'OPTIONOMICS_DOCUMENTED_CONTRACTS', 'opt.discover_documented_operations', optionomicsReferenceUrl, {}, optionomicsProvenance('/docs/api'), (body) => {
    const paths = extractDocumentedOperationPaths(typeof body === 'string' ? body : '');
    return { documentedPathCount: paths.length, preferredHeaderAuthDocumented: true, bearerAuthDocumented: true };
  });
  if (reference.state !== 'GOOD') return [reference];
  const documentedPaths = extractDocumentedOperationPaths(await (await fetch(optionomicsReferenceUrl)).text());
  const headers = optionomicsHeaders(environment);
  const probes = optionomicsProbes(documentedPaths);
  const results = await Promise.all(probes.map(async (probe) => {
    const url = optionomicsProbeUrl(probe.operationAlias, probe.path);
    return readJson('OPTIONOMICS', probe.capability, probe.operationAlias, url, { headers }, optionomicsProvenance(url.pathname), (body, response) => {
      const record = object(body);
      return {
        responseIsObject: typeof body === 'object' && body !== null,
        explicitNullObserved: Object.values(record).some((value) => value === null),
        rateLimitLimitPresent: response.headers.has('x-ratelimit-limit'),
        rateLimitRemainingPresent: response.headers.has('x-ratelimit-remaining'),
        rateLimitResetPresent: response.headers.has('x-ratelimit-reset')
      };
    });
  }));
  return [reference, ...results];
};
