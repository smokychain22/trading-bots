// Isolated Cboe public-data integration for THETA regime RESEARCH inputs
// only. This module is deliberately self-contained: it is NOT wired into
// runThetaShadowCycle, new-risk-orchestrator.ts, aegis-derivation.ts, or
// the strategy router. It exists so a future, separately-validated
// integration step can consume it, per this session's explicit scope
// ("isolated Claude branch slice... Codex can selectively integrate it
// later"). Nothing here ever decides a trade by itself.
//
// Source: Cboe's free, public, unauthenticated delayed-quotes endpoint --
// GET https://cdn.cboe.com/api/global/delayed_quotes/quotes/{SYMBOL}.json
// -- used widely across public finance tooling for index-level delayed
// quotes (no API key, no paid tier, no OPRA). VIX/VIX9D/VVIX are
// documented, standard Cboe index tickers and this module's confidence in
// their shape is high.
//
// Put/Call ratios (item scope: Total/Equity/Index Put/Call Ratio) are
// requested from the SAME public endpoint using Cboe's ratio tickers
// ($CPC, $CPCE, $CPCI), but this repo has never observed a real response
// for those specific symbols -- per this engagement's standing discipline
// (see docs/quant/phase6_router/DATA_GAP_REGISTER.md's precedent for
// Alpaca corporate-actions/Optionomics events), this module treats an
// unrecognized/unparseable response for those symbols as UNKNOWN, never a
// guessed value. This is an ACKNOWLEDGED, documented shape-uncertainty,
// not a claim of verified support.
//
// This is executable-quote-truth for NOTHING -- Cboe delayed index quotes
// are never treated as a contract-level executable price, and never
// replace Alpaca (broker/execution truth) or Optionomics (options
// analytics). This is a supplementary MACRO/VOL-REGIME research signal
// only.

export type CboeErrorClass = 'NETWORK_FAILURE' | 'PROVIDER_FAILURE' | 'PROVIDER_TIMEOUT' | 'INVALID_PROVIDER_RESPONSE' | 'RATE_LIMITED';

export class CboeProviderError extends Error {
  readonly errorClass: CboeErrorClass;
  readonly httpStatus: number | null;
  constructor(errorClass: CboeErrorClass, httpStatus: number | null, message: string) {
    super(message); // never includes header/credential content -- there are no credentials for this public endpoint
    this.name = 'CboeProviderError';
    this.errorClass = errorClass;
    this.httpStatus = httpStatus;
  }
}

export interface CboeProviderConfig {
  readonly apiBase: string; // e.g. https://cdn.cboe.com -- no API key, no auth header of any kind
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => string;
  readonly timeoutMs?: number; // default 10_000
}

const defaultNow = (): string => new Date().toISOString();

const classifyErrorStatus = (status: number): CboeErrorClass => {
  if (status === 429) return 'RATE_LIMITED';
  if (status >= 500) return 'PROVIDER_FAILURE';
  return 'PROVIDER_FAILURE';
};

export type CboeFetchOutcome =
  | { readonly kind: 'VALUE_PRESENT'; readonly value: number; readonly asOfUtc: string | null; readonly retrievedAt: string }
  | { readonly kind: 'VALUE_UNKNOWN_AFTER_SUCCESS'; readonly retrievedAt: string; readonly detail: string }
  | { readonly kind: 'REQUEST_ERROR'; readonly errorClass: CboeErrorClass; readonly httpStatus: number | null; readonly retrievedAt: string; readonly detail: string };

/**
 * Fetches ONE Cboe delayed-quote symbol. Never throws -- every failure
 * mode is returned as a REQUEST_ERROR outcome (mirrors optionomics-
 * provider.ts's neutral VALUE_PRESENT/VALUE_UNKNOWN_AFTER_SUCCESS/
 * REQUEST_ERROR envelope, so a real query failure can never masquerade as
 * an authentic "nothing to report").
 */
export async function fetchCboeQuote(config: CboeProviderConfig, symbol: string): Promise<CboeFetchOutcome> {
  const fetchImpl = config.fetchImpl ?? fetch;
  const now = config.now ?? defaultNow;
  const timeoutMs = config.timeoutMs ?? 10_000;
  const url = new URL(`/api/global/delayed_quotes/quotes/${encodeURIComponent(symbol)}.json`, config.apiBase);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetchImpl(url, { signal: controller.signal });
  } catch (error) {
    clearTimeout(timer);
    if (error instanceof Error && error.name === 'AbortError') {
      return { kind: 'REQUEST_ERROR', errorClass: 'PROVIDER_TIMEOUT', httpStatus: null, retrievedAt: now(), detail: `Request for ${symbol} exceeded ${timeoutMs}ms.` };
    }
    return { kind: 'REQUEST_ERROR', errorClass: 'NETWORK_FAILURE', httpStatus: null, retrievedAt: now(), detail: `Network error reaching ${url.host}${url.pathname} -- ${error instanceof Error ? error.name : 'unknown'}.` };
  }
  clearTimeout(timer);

  if (!response.ok) {
    return { kind: 'REQUEST_ERROR', errorClass: classifyErrorStatus(response.status), httpStatus: response.status, retrievedAt: now(), detail: `${url.pathname} returned HTTP ${response.status}.` };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { kind: 'REQUEST_ERROR', errorClass: 'INVALID_PROVIDER_RESPONSE', httpStatus: response.status, retrievedAt: now(), detail: `${url.pathname} returned a non-JSON body.` };
  }

  const data = body !== null && typeof body === 'object' ? (body as Record<string, unknown>).data : undefined;
  if (data === null || data === undefined || typeof data !== 'object') {
    return { kind: 'VALUE_UNKNOWN_AFTER_SUCCESS', retrievedAt: now(), detail: `${url.pathname} returned a 2xx body without a recognizable 'data' object.` };
  }
  const record = data as Record<string, unknown>;
  const priceRaw = record.current_price ?? record.last_trade_price;
  const price = typeof priceRaw === 'number' && Number.isFinite(priceRaw) ? priceRaw : (typeof priceRaw === 'string' && priceRaw.length > 0 && Number.isFinite(Number(priceRaw)) ? Number(priceRaw) : null);
  if (price === null) {
    return { kind: 'VALUE_UNKNOWN_AFTER_SUCCESS', retrievedAt: now(), detail: `${url.pathname}'s 'data' object had no recognizable numeric price field.` };
  }
  const timeRaw = record.last_trade_time ?? record.last_trade_timestamp;
  const asOfUtc = typeof timeRaw === 'string' && timeRaw.length > 0 ? timeRaw : null;
  return { kind: 'VALUE_PRESENT', value: price, asOfUtc, retrievedAt: now() };
}

// ---------------------------------------------------------------------------
// In-memory observation cache -- "cache observations" per this session's
// explicit requirement. Keyed by symbol, bounded TTL, injectable clock so
// tests never depend on wall-clock timing.
// ---------------------------------------------------------------------------

export interface CboeCacheEntry {
  readonly outcome: CboeFetchOutcome;
  readonly cachedAt: string;
}

export interface CboeRegimeCache {
  get(symbol: string, now: string, ttlSeconds: number): CboeCacheEntry | null;
  set(symbol: string, outcome: CboeFetchOutcome, now: string): void;
}

export function createCboeRegimeCache(): CboeRegimeCache {
  const store = new Map<string, CboeCacheEntry>();
  return {
    get(symbol, now, ttlSeconds) {
      const entry = store.get(symbol);
      if (entry === undefined) return null;
      const ageSeconds = (new Date(now).getTime() - new Date(entry.cachedAt).getTime()) / 1000;
      if (!Number.isFinite(ageSeconds) || ageSeconds < 0 || ageSeconds > ttlSeconds) return null;
      return entry;
    },
    set(symbol, outcome, now) {
      store.set(symbol, { outcome, cachedAt: now });
    },
  };
}

/**
 * Fetches a symbol through the cache -- a cache hit within ttlSeconds
 * short-circuits the real HTTP call; a miss/expiry performs a real fetch
 * and caches the result (even a REQUEST_ERROR outcome is cached, so a
 * failing endpoint is not hammered every call within the TTL window).
 */
export async function fetchCboeQuoteCached(
  config: CboeProviderConfig,
  cache: CboeRegimeCache,
  symbol: string,
  ttlSeconds: number,
): Promise<CboeFetchOutcome> {
  const now = (config.now ?? defaultNow)();
  const cached = cache.get(symbol, now, ttlSeconds);
  if (cached !== null) return cached.outcome;
  const outcome = await fetchCboeQuote(config, symbol);
  cache.set(symbol, outcome, now);
  return outcome;
}

// ---------------------------------------------------------------------------
// Canonical per-field observation and snapshot -- raw value and
// source/provenance/quality preserved SEPARATELY from any derived/
// normalized feature (those live in cboe-regime-features.ts-equivalent
// functions below, never mixed into this struct).
// ---------------------------------------------------------------------------

export type CboeFieldQuality = 'GOOD' | 'STALE' | 'UNKNOWN' | 'INVALID';

export interface CboeFieldObservation {
  readonly raw: number | null; // exactly as reported -- never normalized/derived here
  readonly asOfUtc: string | null; // provider-reported observation timestamp, when present -- never fabricated from retrievedAt
  readonly retrievedAt: string;
  readonly source: 'CBOE' | 'UNKNOWN';
  readonly dataQuality: CboeFieldQuality;
}

export interface CboeFreshnessPolicy {
  readonly policyVersion: string;
  readonly goodMaxAgeSeconds: number;
  readonly staleMinAgeSeconds: number; // must be >= goodMaxAgeSeconds
}

// Cboe's own free delayed-quotes feed is documented as delayed (typically
// ~15-20 minutes) BY DESIGN -- this policy's goodMaxAgeSeconds is set
// accordingly (never compared against the same tight tolerance as a real-
// time executable quote). Versioned research placeholder, not asserted
// production-optimal.
export const DEFAULT_CBOE_FRESHNESS_POLICY: CboeFreshnessPolicy = {
  policyVersion: 'cboe-freshness-v1', goodMaxAgeSeconds: 1800, staleMinAgeSeconds: 7200,
};

function classifyCboeFieldQuality(asOfUtc: string | null, retrievedAt: string, policy: CboeFreshnessPolicy): CboeFieldQuality {
  if (asOfUtc === null) return 'UNKNOWN';
  const ageSeconds = (new Date(retrievedAt).getTime() - new Date(asOfUtc).getTime()) / 1000;
  if (!Number.isFinite(ageSeconds) || ageSeconds < 0) return 'INVALID';
  if (ageSeconds >= policy.staleMinAgeSeconds) return 'STALE';
  return 'GOOD'; // between good and stale bounds is still reported GOOD here -- this module has no DEGRADED tier, unlike data-freshness.ts, to keep this isolated slice minimal
}

function toFieldObservation(outcome: CboeFetchOutcome, policy: CboeFreshnessPolicy): CboeFieldObservation {
  if (outcome.kind === 'VALUE_PRESENT') {
    return {
      raw: outcome.value, asOfUtc: outcome.asOfUtc, retrievedAt: outcome.retrievedAt,
      source: 'CBOE', dataQuality: classifyCboeFieldQuality(outcome.asOfUtc, outcome.retrievedAt, policy),
    };
  }
  if (outcome.kind === 'VALUE_UNKNOWN_AFTER_SUCCESS') {
    return { raw: null, asOfUtc: null, retrievedAt: outcome.retrievedAt, source: 'CBOE', dataQuality: 'UNKNOWN' };
  }
  return { raw: null, asOfUtc: null, retrievedAt: outcome.retrievedAt, source: 'UNKNOWN', dataQuality: 'UNKNOWN' };
}

export interface CboeRegimeSnapshot {
  readonly asOfUtc: string; // when this snapshot was assembled (receivedAt) -- distinct from each field's own provider-reported asOfUtc
  readonly vix: CboeFieldObservation;
  readonly vix9d: CboeFieldObservation;
  readonly vvix: CboeFieldObservation;
  readonly equityPutCall: CboeFieldObservation;
  readonly indexPutCall: CboeFieldObservation;
  readonly totalPutCall: CboeFieldObservation;
}

const CBOE_SYMBOLS = {
  vix: 'VIX', vix9d: 'VIX9D', vvix: 'VVIX',
  equityPutCall: '$CPCE', indexPutCall: '$CPCI', totalPutCall: '$CPC',
} as const;

/**
 * Assembles a full CboeRegimeSnapshot from real (cached) fetches of all
 * six symbols. Never throws -- any individual symbol's failure produces
 * an UNKNOWN/INVALID field observation, never a fabricated value, and
 * never blocks the rest of the snapshot from being assembled.
 */
export async function assembleCboeRegimeSnapshot(
  config: CboeProviderConfig,
  cache: CboeRegimeCache,
  ttlSeconds: number,
  freshnessPolicy: CboeFreshnessPolicy = DEFAULT_CBOE_FRESHNESS_POLICY,
): Promise<CboeRegimeSnapshot> {
  const now = (config.now ?? defaultNow)();
  const [vix, vix9d, vvix, equityPutCall, indexPutCall, totalPutCall] = await Promise.all([
    fetchCboeQuoteCached(config, cache, CBOE_SYMBOLS.vix, ttlSeconds),
    fetchCboeQuoteCached(config, cache, CBOE_SYMBOLS.vix9d, ttlSeconds),
    fetchCboeQuoteCached(config, cache, CBOE_SYMBOLS.vvix, ttlSeconds),
    fetchCboeQuoteCached(config, cache, CBOE_SYMBOLS.equityPutCall, ttlSeconds),
    fetchCboeQuoteCached(config, cache, CBOE_SYMBOLS.indexPutCall, ttlSeconds),
    fetchCboeQuoteCached(config, cache, CBOE_SYMBOLS.totalPutCall, ttlSeconds),
  ] as const);
  return {
    asOfUtc: now,
    vix: toFieldObservation(vix, freshnessPolicy),
    vix9d: toFieldObservation(vix9d, freshnessPolicy),
    vvix: toFieldObservation(vvix, freshnessPolicy),
    equityPutCall: toFieldObservation(equityPutCall, freshnessPolicy),
    indexPutCall: toFieldObservation(indexPutCall, freshnessPolicy),
    totalPutCall: toFieldObservation(totalPutCall, freshnessPolicy),
  };
}
