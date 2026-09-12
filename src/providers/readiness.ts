import type { Environment } from '../config/environment.js';
import type { AlpacaProviderConfig } from '../theta/alpaca-provider.js';

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

export type EvidenceCapabilityAvailability =
  | 'AVAILABLE'
  | 'AVAILABLE_WITH_LIMITS'
  | 'NOT_ENTITLED'
  | 'NOT_SUPPORTED'
  | 'UNVERIFIED';

export type EvidenceCapabilityResult = {
  readonly provider: 'ALPACA';
  readonly capability: string;
  readonly operationAlias: string;
  readonly availability: EvidenceCapabilityAvailability;
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
const finiteNumber = (value: unknown): number | null => {
  const number = Number(value);
  return value !== null && value !== '' && Number.isFinite(number) ? number : null;
};

const stateForResponse = (response: Response): CapabilityState => {
  if (response.ok) return 'GOOD';
  if (response.status === 401 || response.status === 400 || response.status === 404 || response.status === 422) return 'INVALID';
  if (response.status === 402 || response.status === 403) return 'NOT_ENTITLED';
  if (response.status === 429 || response.status >= 500) return 'DEGRADED';
  return 'UNKNOWN';
};

// Capability distinction (architecture correction, 2026-09-10): a feed's
// reachability, its BBO quality, and whether PAPER execution may rely on it
// are THREE SEPARATE questions, never collapsed into one boolean. Official
// Alpaca documentation describes OPRA as the consolidated options BBO and
// INDICATIVE as a modified derivative with delayed trades. This is NOT a
// "OPRA missing -> THETA blocked" gate: INDICATIVE remains fully usable for
// engineering, pipeline construction, candidate mechanics, and shadow
// decisions. Whether INDICATIVE (plus Optionomics) is ADEQUATE for PAPER
// execution pricing is a separate, future, evidence-based question (does it
// materially change contract ranking / strike / expiry / OPEN-vs-WAIT / fill
// modeling? -- see the Indicative-vs-OPRA evidence task in the DATA_GAP
// register) -- it is never derived from feed type alone, and OPRA is never
// purchased speculatively ahead of that evidence.
export type OptionFeedType = 'OPRA' | 'INDICATIVE';
export type TcaQuality = 'UNVALIDATED' | 'LIMITED' | 'VALIDATED';
export type PaperExecutionPolicy = 'NOT_YET_EVALUATED' | 'APPROVED' | 'REJECTED';

export interface OptionFeedCapability {
  readonly optionFeed: OptionFeedType;
  readonly feedAvailable: boolean; // this account/entitlement can reach this feed right now
  readonly consolidatedBbo: boolean; // true only for OPRA -- INDICATIVE is a modified derivative, never consolidated BBO
  readonly engineeringUsable: boolean; // fine for pipeline/schema/candidate-mechanics/shadow-decision work
  readonly paperExecutionPolicy: PaperExecutionPolicy; // a SEPARATE release decision -- never derived from feedAvailable/consolidatedBbo alone
  readonly tcaQuality: TcaQuality; // UNVALIDATED until the Indicative-vs-OPRA evidence task actually runs
}

export const classifyOptionFeedCapability = (feed: OptionFeedType, state: CapabilityState): OptionFeedCapability => {
  const feedAvailable = state === 'GOOD';
  return {
    optionFeed: feed,
    feedAvailable,
    consolidatedBbo: feed === 'OPRA',
    engineeringUsable: feedAvailable,
    // Deliberately NOT `feed === 'OPRA' ? 'APPROVED' : 'REJECTED'` -- that
    // would be exactly the "OPRA_NOT_ENTITLED -> PAPER_TRADING_IMPOSSIBLE"
    // conflation this correction exists to prevent. This is a release
    // decision a human/empirical-evidence gate makes, not a feed-type flag.
    paperExecutionPolicy: 'NOT_YET_EVALUATED',
    tcaQuality: 'UNVALIDATED'
  };
};

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

const evidenceAvailability = (
  response: Response,
  limited: boolean,
): EvidenceCapabilityAvailability => {
  if (response.ok) return limited ? 'AVAILABLE_WITH_LIMITS' : 'AVAILABLE';
  if (response.status === 402 || response.status === 403) return 'NOT_ENTITLED';
  return 'UNVERIFIED';
};

const readEvidenceJson = async (
  config: AlpacaProviderConfig,
  capability: string,
  operationAlias: string,
  url: URL,
  limited: boolean,
  evaluate: (body: unknown, response: Response) => EvidenceCapabilityResult['details'],
): Promise<EvidenceCapabilityResult> => {
  const requestedAt = performance.now();
  const elapsedMs = (): number => Math.round(performance.now() - requestedAt);
  const retrievedAt = observedAt();
  try {
    const response = await (config.fetchImpl ?? fetch)(url, {
      method: 'GET',
      headers: {
        'APCA-API-KEY-ID': config.apiKey,
        'APCA-API-SECRET-KEY': config.apiSecret,
      },
    });
    const contentType = response.headers.get('content-type') ?? '';
    const body: unknown = contentType.includes('application/json')
      ? await response.json().catch(() => null)
      : await response.text().catch(() => '');
    return {
      provider: 'ALPACA', capability, operationAlias,
      availability: evidenceAvailability(response, limited),
      httpStatus: response.status, observedAt: observedAt(), retrievedAt,
      latencyMs: elapsedMs(), provenance: alpacaProvenance(url.host, url.pathname),
      details: evaluate(body, response),
    };
  } catch (error) {
    return {
      provider: 'ALPACA', capability, operationAlias, availability: 'UNVERIFIED',
      httpStatus: null, observedAt: observedAt(), retrievedAt, latencyMs: elapsedMs(),
      provenance: alpacaProvenance(url.host, url.pathname),
      details: { networkError: error instanceof Error ? error.name : 'UnknownError' },
    };
  }
};

const unsupportedEvidenceCapability = (
  capability: string,
  operationAlias: string,
  documentationUrl: string,
): EvidenceCapabilityResult => ({
  provider: 'ALPACA', capability, operationAlias, availability: 'NOT_SUPPORTED',
  httpStatus: null, observedAt: observedAt(), retrievedAt: observedAt(), latencyMs: null,
  provenance: {
    host: 'docs.alpaca.markets', path: documentationUrl, method: 'DOCUMENTATION_REVIEW',
    executableTruth: true, credentialValuesLogged: false,
  },
  details: { endpointDocumented: false },
});

const daysAgo = (date: Date, days: number): string =>
  new Date(date.getTime() - days * 86_400_000).toISOString();

/**
 * Probes only documented, read-only Alpaca endpoints needed by the R6 evidence
 * path. Historical option quotes and historical Greeks deliberately have no
 * guessed REST path. Alpaca's current official endpoint inventory documents
 * historical bars/trades and latest quotes/snapshots, but no historical option
 * quote or historical Greeks REST operation.
 */
export async function checkAlpacaEvidenceCapabilities(
  config: AlpacaProviderConfig,
  now = new Date(),
): Promise<readonly EvidenceCapabilityResult[]> {
  const start = daysAgo(now, 30);
  const end = daysAgo(now, 1);
  const stockBarsUrl = new URL('/v2/stocks/bars', config.marketDataApiBase);
  stockBarsUrl.search = new URLSearchParams({
    symbols: 'SPY', timeframe: '1Day', start, end, adjustment: 'raw', feed: 'iex', limit: '10',
  }).toString();
  const stockBars = await readEvidenceJson(
    config, 'HISTORICAL_STOCK_BARS', 'alpaca.get_stock_bars', stockBarsUrl, false,
    (body) => {
      const record = object(body);
      const bars = object(record.bars);
      return {
        requestedFeed: 'iex', symbolCount: Object.keys(bars).length,
        observationCount: Object.values(bars).reduce<number>(
          (count, observations) => count + (Array.isArray(observations) ? observations.length : 0), 0,
        ),
        nextPageTokenPresent: typeof record.next_page_token === 'string',
      };
    },
  );

  const contractsUrl = new URL('/v2/options/contracts', config.tradingApiBase);
  contractsUrl.search = new URLSearchParams({
    underlying_symbols: 'SPY', status: 'active', type: 'put', limit: '100',
  }).toString();
  const contracts = await readEvidenceJson(
    config, 'OPTION_CONTRACT_DISCOVERY', 'alpaca.get_option_contracts', contractsUrl, false,
    (body) => {
      const record = object(body);
      return {
        contractCount: Array.isArray(record.option_contracts) ? record.option_contracts.length : null,
        pageTokenPresent: typeof record.next_page_token === 'string',
      };
    },
  );

  const snapshot = async (feed: 'indicative' | 'opra'): Promise<{
    result: EvidenceCapabilityResult;
    contractSymbol: string | null;
    greeksObserved: boolean;
  }> => {
    const url = new URL('/v1beta1/options/snapshots/SPY', config.marketDataApiBase);
    url.search = new URLSearchParams({ feed, type: 'put', limit: '1000' }).toString();
    let contractSymbol: string | null = null;
    let greeksObserved = false;
    const result = await readEvidenceJson(
      config, `CURRENT_OPTION_SNAPSHOTS_${feed.toUpperCase()}`,
      'alpaca.get_option_chain_snapshots', url, feed === 'indicative',
      (body, response) => {
        const snapshots = object(body).snapshots;
        const entries = snapshots !== null && typeof snapshots === 'object' && !Array.isArray(snapshots)
          ? Object.entries(snapshots as Record<string, unknown>) : [];
        let highestVolume = Number.NEGATIVE_INFINITY;
        for (const [symbol, raw] of entries) {
          const record = object(raw);
          const volume = finiteNumber(object(record.dailyBar).v) ?? Number.NEGATIVE_INFINITY;
          if (contractSymbol === null || volume > highestVolume) {
            contractSymbol = symbol;
            highestVolume = volume;
          }
          if (Object.keys(object(record.greeks)).length > 0) greeksObserved = true;
        }
        return {
          requestedFeed: feed, snapshotCount: entries.length,
          validContractIdentityObserved: contractSymbol !== null,
          greeksObserved, requestIdPresent: response.headers.has('x-request-id'),
        };
      },
    );
    return { result, contractSymbol, greeksObserved };
  };

  const indicative = await snapshot('indicative');
  const opra = await snapshot('opra');
  const greeksResult = (
    feed: 'INDICATIVE' | 'OPRA',
    source: EvidenceCapabilityResult,
    observed: boolean,
  ): EvidenceCapabilityResult => ({
    ...source,
    capability: `CURRENT_OPTION_GREEKS_${feed}`,
    operationAlias: 'alpaca.get_option_chain_snapshots',
    availability: source.availability === 'NOT_ENTITLED'
      ? 'NOT_ENTITLED'
      : source.httpStatus === 200 && observed
        ? source.availability
        : 'UNVERIFIED',
    details: { requestedFeed: feed.toLowerCase(), greeksObserved: observed },
  });

  const historical = async (
    kind: 'bars' | 'trades',
    limitedByCurrentEntitlement: boolean,
  ): Promise<EvidenceCapabilityResult> => {
    const symbol = indicative.contractSymbol;
    if (symbol === null) {
      return {
        provider: 'ALPACA', capability: `HISTORICAL_OPTION_${kind.toUpperCase()}`,
        operationAlias: `alpaca.get_option_${kind}`, availability: 'UNVERIFIED', httpStatus: null,
        observedAt: observedAt(), retrievedAt: observedAt(), latencyMs: null,
        provenance: alpacaProvenance(new URL(config.marketDataApiBase).host, `/v1beta1/options/${kind}`),
        details: { dependencyAvailable: false, reason: 'NO_CURRENT_CONTRACT_IDENTITY' },
      };
    }
    const url = new URL(`/v1beta1/options/${kind}`, config.marketDataApiBase);
    const query: Record<string, string> = { symbols: symbol, start, end, limit: '10' };
    if (kind === 'bars') query.timeframe = '1Day';
    url.search = new URLSearchParams(query).toString();
    return readEvidenceJson(
      config, `HISTORICAL_OPTION_${kind.toUpperCase()}`,
      `alpaca.get_option_${kind}`, url, limitedByCurrentEntitlement,
      (body) => {
        const record = object(body);
        const observationsByContract = object(record[kind]);
        return {
          feedParameterSent: false,
          effectiveFeed: limitedByCurrentEntitlement ? 'INDICATIVE' : 'ACCOUNT_DEFAULT',
          exactContractRequested: true,
          contractCount: Object.keys(observationsByContract).length,
          observationCount: Object.values(observationsByContract).reduce<number>(
            (count, observations) => count + (Array.isArray(observations) ? observations.length : 0), 0,
          ),
          nextPageTokenPresent: typeof record.next_page_token === 'string',
        };
      },
    );
  };

  // The official historical bars/trades contracts do not accept a feed query
  // parameter. The account-default feed is therefore probed once. A current
  // OPRA entitlement failure makes that default known to be INDICATIVE.
  const historicalIsLimited = opra.result.availability === 'NOT_ENTITLED';
  const [historicalBars, historicalTrades] = await Promise.all([
    historical('bars', historicalIsLimited), historical('trades', historicalIsLimited),
  ]);
  const corporateActionsUrl = new URL('/v1/corporate-actions', config.marketDataApiBase);
  corporateActionsUrl.search = new URLSearchParams({
    symbols: 'SPY', start: start.slice(0, 10), end: end.slice(0, 10), limit: '10',
  }).toString();
  const corporateActions = await readEvidenceJson(
    config, 'CORPORATE_ACTIONS', 'alpaca.get_corporate_actions', corporateActionsUrl, false,
    (body) => ({ responseIsObject: body !== null && typeof body === 'object' }),
  );

  return [
    stockBars, contracts, indicative.result, opra.result,
    greeksResult('INDICATIVE', indicative.result, indicative.greeksObserved),
    greeksResult('OPRA', opra.result, opra.greeksObserved),
    historicalBars, historicalTrades,
    unsupportedEvidenceCapability(
      'HISTORICAL_OPTION_BBO', 'alpaca.historical_option_quotes',
      '/us/docs/options-trading-overview#market-data',
    ),
    unsupportedEvidenceCapability(
      'HISTORICAL_OPTION_GREEKS', 'alpaca.historical_option_greeks',
      '/us/docs/options-trading-overview#market-data',
    ),
    corporateActions,
  ];
}

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
      accountStatus: typeof accountBody.status === 'string' ? accountBody.status : null,
      equity: finiteNumber(accountBody.equity),
      cash: finiteNumber(accountBody.cash),
      buyingPower: finiteNumber(accountBody.buying_power),
      optionsBuyingPower: finiteNumber(accountBody.options_buying_power),
      equityReadable: Number.isFinite(Number(accountBody.equity)),
      cashReadable: Number.isFinite(Number(accountBody.cash)),
      buyingPowerReadable: Number.isFinite(Number(accountBody.buying_power)),
      optionsApprovalReadable: typeof accountBody.options_approved_level === 'number' || typeof accountBody.options_trading_level === 'number',
      optionsApprovedLevel: typeof accountBody.options_approved_level === 'number' ? accountBody.options_approved_level : null,
      optionsTradingLevel: typeof accountBody.options_trading_level === 'number' ? accountBody.options_trading_level : null,
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
    return { timestampPresent: typeof clockBody.timestamp === 'string', isOpenPresent: typeof clockBody.is_open === 'boolean', isOpen: typeof clockBody.is_open === 'boolean' ? clockBody.is_open : null };
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
  const openOrdersUrl = new URL('/v2/orders', baseUrl);
  openOrdersUrl.search = new URLSearchParams({ status: 'open', limit: '100', direction: 'desc' }).toString();
  const openOrders = await readJson('ALPACA', 'OPEN_ORDERS_READ', 'alpaca.get_open_orders', openOrdersUrl, { headers }, alpacaProvenance(baseUrl.host, '/v2/orders'), (body) => ({ responseIsArray: Array.isArray(body), openOrderCount: Array.isArray(body) ? body.length : null }));
  const configuration = await readJson('ALPACA', 'ACCOUNT_CONFIGURATION_READ', 'alpaca.get_account_configurations', new URL('/v2/account/configurations', baseUrl), { headers }, alpacaProvenance(baseUrl.host, '/v2/account/configurations'), (body) => ({ configurationReadable: Object.keys(object(body)).length > 0 }));
  const activitiesUrl = new URL('/v2/account/activities/FILL', baseUrl);
  activitiesUrl.search = new URLSearchParams({ direction: 'desc', page_size: '1' }).toString();
  const activities = await readJson('ALPACA', 'ACCOUNT_ACTIVITY_READ', 'alpaca.get_account_activities_fill', activitiesUrl, { headers }, alpacaProvenance(baseUrl.host, '/v2/account/activities/FILL'), (body) => ({ responseIsArray: Array.isArray(body), activityCount: Array.isArray(body) ? body.length : null }));
  const corporateActionsUrl = new URL('/v1/corporate-actions', alpacaDataBaseUrl);
  corporateActionsUrl.search = new URLSearchParams({ symbols: 'SPY', start: today, end: today, limit: '1' }).toString();
  const corporateActions = await readJson('ALPACA', 'CORPORATE_ACTIONS_READ', 'alpaca.get_corporate_actions', corporateActionsUrl, { headers }, alpacaProvenance(corporateActionsUrl.host, corporateActionsUrl.pathname), (body) => ({ responseIsObject: typeof body === 'object' && body !== null }));
  return [account, configuration, clock, calendar, stockData, contracts, optionData, optionDataIndicative, positions, openOrders, activities, corporateActions];
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

const responseShape = (value: unknown): {
  readonly keyCount: number;
  readonly sampledArrayElementCount: number;
  readonly ivFieldPresent: boolean;
  readonly skewFieldPresent: boolean;
  readonly termFieldPresent: boolean;
  readonly surfaceFieldPresent: boolean;
  readonly dateOrTimestampFieldPresent: boolean;
} => {
  const keys = new Set<string>();
  let sampledArrayElementCount = 0;
  const visit = (current: unknown, depth: number): void => {
    if (depth > 6 || current === null || typeof current !== 'object') return;
    if (Array.isArray(current)) {
      sampledArrayElementCount += current.length;
      for (const item of current.slice(0, 100)) visit(item, depth + 1);
      return;
    }
    for (const [key, nested] of Object.entries(current as Record<string, unknown>).slice(0, 200)) {
      keys.add(key.toLowerCase());
      visit(nested, depth + 1);
    }
  };
  visit(value, 0);
  const has = (pattern: RegExp): boolean => [...keys].some((key) => pattern.test(key));
  return {
    keyCount: keys.size, sampledArrayElementCount,
    ivFieldPresent: has(/(^iv$|implied.?vol|iv_rank|iv_percentile)/),
    skewFieldPresent: has(/skew/), termFieldPresent: has(/term/), surfaceFieldPresent: has(/surface/),
    dateOrTimestampFieldPresent: has(/(^date$|timestamp|as_of|observed_at|created_at|updated_at)/),
  };
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
      const shape = responseShape(body);
      return {
        responseIsObject: typeof body === 'object' && body !== null,
        explicitNullObserved: Object.values(record).some((value) => value === null),
        ...shape,
        rateLimitLimitPresent: response.headers.has('x-ratelimit-limit'),
        rateLimitRemainingPresent: response.headers.has('x-ratelimit-remaining'),
        rateLimitResetPresent: response.headers.has('x-ratelimit-reset')
      };
    });
  }));
  return [reference, ...results];
};
