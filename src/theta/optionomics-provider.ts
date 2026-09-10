// R1 parallel slice: production Optionomics REST adapter. Follows the same
// conventions as alpaca-provider.ts (typed config, injectable fetchImpl,
// structured provider-error taxonomy, no process.env reads inside this
// module, no header/credential value ever logged or included in an error
// message) -- but Optionomics is NEVER broker/execution truth. It supplies
// supplementary analytics (open interest, volume, implied volatility,
// Greeks fallback) only; Alpaca's own bid/ask/executable identity are never
// overwritten by anything this module returns (see optionomics-merge.ts).
//
// Endpoint and auth are the documented public contract already probed by
// src/providers/readiness.ts (checkOptionomics): base host optionomics.ai,
// GET /api/v1/stocks/{symbol}/options, headers X-USER-EMAIL / X-USER-TOKEN.
// This module does not invent or guess an undocumented endpoint.
//
// Wired into runThetaShadowCycle (theta-shadow-cycle.ts) as of the R1
// real-state integration pass -- fetched independently of Alpaca's own
// calls, matched to specific Alpaca contracts by exact identity only (see
// matchOptionomicsContractIdentity), and merged via option-chain-
// ingestion.ts's mergeOptionChain. NOT yet wired into
// runNewRiskOrchestration directly (it consumes the already-merged
// NormalizedOptionContract, never this module's raw output).
//
// Neutral outcome shape (see OptionomicsFetchOutcome below): this module
// does NOT define or reuse a competing global ProvenanceOrigin enum. It
// reports enough structure (VALUE_PRESENT / VALUE_UNKNOWN_AFTER_SUCCESS /
// REQUEST_ERROR) for a canonical layer to later classify REAL_PROVIDER /
// REAL_PROVIDER_UNKNOWN / REAL_PROVIDER_ERROR without this module needing
// to know that vocabulary itself.

export interface OptionomicsProviderConfig {
  readonly apiBase: string; // e.g. https://optionomics.ai
  readonly email: string;
  readonly apiToken: string;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => string; // injectable clock for retrievedAt -- never `new Date()` called directly in this module's logic
  readonly timeoutMs?: number; // default 10_000
  readonly maxRetryAttempts?: number; // default 3 -- total attempts including the first, bounded, safe-GET-only
  readonly sleepImpl?: (ms: number) => Promise<void>; // injectable -- tests must never sleep unboundedly on a real clock
}

const defaultNow = (): string => new Date().toISOString();
const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const authHeaders = (config: OptionomicsProviderConfig): HeadersInit => ({
  'X-USER-EMAIL': config.email,
  'X-USER-TOKEN': config.apiToken,
});

// ---------------------------------------------------------------------------
// Structured error taxonomy -- never collapsed to one generic UNKNOWN.
// ---------------------------------------------------------------------------

export type OptionomicsErrorClass =
  | 'AUTHENTICATION_FAILED' // 401
  | 'SUBSCRIPTION_REQUIRED' // 402
  | 'NOT_ENTITLED' // 403
  | 'RATE_LIMITED' // 429, retries exhausted
  | 'PROVIDER_FAILURE' // 5xx
  | 'PROVIDER_TIMEOUT' // request exceeded timeoutMs
  | 'NETWORK_FAILURE' // fetch threw (DNS/connection/etc), not a timeout
  | 'INVALID_PROVIDER_RESPONSE'; // 2xx but non-JSON or schema-invalid body

export class OptionomicsProviderError extends Error {
  readonly errorClass: OptionomicsErrorClass;
  readonly httpStatus: number | null;
  readonly retryAfterSeconds: number | null;
  readonly attemptCount: number;
  constructor(errorClass: OptionomicsErrorClass, httpStatus: number | null, message: string, retryAfterSeconds: number | null = null, attemptCount = 1) {
    super(message); // message never includes header/credential content -- see call sites below
    this.name = 'OptionomicsProviderError';
    this.errorClass = errorClass;
    this.httpStatus = httpStatus;
    this.retryAfterSeconds = retryAfterSeconds;
    this.attemptCount = attemptCount;
  }
}

const classifyErrorStatus = (status: number): OptionomicsErrorClass => {
  if (status === 401) return 'AUTHENTICATION_FAILED';
  if (status === 402) return 'SUBSCRIPTION_REQUIRED';
  if (status === 403) return 'NOT_ENTITLED';
  if (status === 429) return 'RATE_LIMITED';
  if (status >= 500) return 'PROVIDER_FAILURE';
  return 'PROVIDER_FAILURE';
};

// Retry-After may be documented as an integer seconds count or an HTTP-date
// (per RFC 9110 -- both forms exist across real-world APIs). Parsed
// defensively; an unparseable value never crashes the caller, it just
// yields null (treated as "no explicit guidance", not zero).
function parseRetryAfterSeconds(header: string | null): number | null {
  if (header === null) return null;
  const asSeconds = Number(header);
  if (Number.isFinite(asSeconds) && asSeconds >= 0) return asSeconds;
  const asDate = Date.parse(header);
  if (!Number.isNaN(asDate)) {
    const deltaMs = asDate - Date.now();
    return deltaMs > 0 ? Math.ceil(deltaMs / 1000) : 0;
  }
  return null;
}

interface RequestOutcome {
  readonly body: unknown;
  readonly httpStatus: number;
  readonly retrievedAt: string;
}

// Bounded GET with timeout + a single bounded retry loop for 429 only.
// Never an infinite retry, never applied to a non-GET method (this module
// issues GET requests exclusively -- Optionomics never receives a write).
async function requestJsonBounded(
  config: OptionomicsProviderConfig,
  url: URL,
): Promise<RequestOutcome> {
  const fetchImpl = config.fetchImpl ?? fetch;
  const now = config.now ?? defaultNow;
  const sleep = config.sleepImpl ?? defaultSleep;
  const timeoutMs = config.timeoutMs ?? 10_000;
  const maxAttempts = Math.max(1, config.maxRetryAttempts ?? 3);
  const headers = authHeaders(config);

  let attempt = 0;
  for (;;) {
    attempt += 1;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetchImpl(url, { headers, signal: controller.signal });
    } catch (error) {
      clearTimeout(timer);
      if (error instanceof Error && error.name === 'AbortError') {
        throw new OptionomicsProviderError('PROVIDER_TIMEOUT', null, `Request to ${url.pathname} exceeded ${timeoutMs}ms.`, null, attempt);
      }
      throw new OptionomicsProviderError('NETWORK_FAILURE', null, `Network error reaching ${url.host}${url.pathname} -- ${error instanceof Error ? error.name : 'unknown'}.`, null, attempt);
    }
    clearTimeout(timer);

    if (response.status === 429 && attempt < maxAttempts) {
      const retryAfter = parseRetryAfterSeconds(response.headers.get('retry-after'));
      await sleep((retryAfter ?? 1) * 1000);
      continue;
    }

    if (!response.ok) {
      const retryAfter = response.status === 429 ? parseRetryAfterSeconds(response.headers.get('retry-after')) : null;
      throw new OptionomicsProviderError(classifyErrorStatus(response.status), response.status, `${url.pathname} returned HTTP ${response.status}.`, retryAfter, attempt);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new OptionomicsProviderError('INVALID_PROVIDER_RESPONSE', response.status, `${url.pathname} returned a non-JSON body.`, null, attempt);
    }
    return { body, httpStatus: response.status, retrievedAt: now() };
  }
}

// ---------------------------------------------------------------------------
// Normalized option-chain observation
// ---------------------------------------------------------------------------

export type OptionomicsIvUnits = 'DECIMAL' | 'UNKNOWN';

export interface NormalizedOptionomicsEntry {
  readonly rawSymbol: string | null; // Optionomics' own reported contract symbol, if any -- used for identity matching, never fabricated
  readonly underlying: string | null;
  readonly expiration: string | null; // YYYY-MM-DD, as reported
  readonly optionType: 'CALL' | 'PUT' | null;
  readonly strike: number | null;
  readonly openInterest: number | null; // null = UNKNOWN (absent/unparseable) -- 0 is a real, distinct, provider-reported zero
  readonly volume: number | null; // same null-vs-zero discipline
  readonly impliedVolatility: number | null; // null if absent or out of the conservative decimal validation band
  readonly impliedVolatilityUnits: OptionomicsIvUnits;
  readonly impliedVolatilityRaw: number | null; // preserved for audit even when rejected as invalid/out-of-band
  readonly delta: number | null;
  readonly gamma: number | null;
  readonly theta: number | null;
  readonly vega: number | null;
  readonly rho: number | null;
  readonly asOf: string | null; // provider-reported observation timestamp, if documented/present -- never fabricated from retrievedAt
  readonly retrievedAt: string;
}

export interface NormalizedOptionomicsChain {
  readonly underlying: string;
  readonly retrievedAt: string;
  readonly entries: readonly NormalizedOptionomicsEntry[];
  // Pagination is NOT documented for this endpoint at the time this adapter
  // was written -- per standing instruction, this module does not invent
  // pagination it cannot observe. A single response page is treated as the
  // complete result; if a future observed response reveals pagination
  // fields, this must be revisited rather than silently assumed complete.
  readonly pagesFetched: 1;
  readonly complete: true;
}

// ---------------------------------------------------------------------------
// Neutral, canonical-layer-agnostic outcome envelope (see module docstring,
// item 9): this is deliberately NOT the ProvenanceOrigin/DataQualityState
// vocabulary those other (currently Codex-owned) modules use. It carries
// exactly enough structure for a later integration layer to derive that
// classification without this module needing to import or duplicate it.
// ---------------------------------------------------------------------------

export type OptionomicsFetchOutcome<T> =
  | { readonly kind: 'VALUE_PRESENT'; readonly value: T; readonly httpStatus: number; readonly retrievedAt: string }
  | { readonly kind: 'VALUE_UNKNOWN_AFTER_SUCCESS'; readonly httpStatus: number; readonly retrievedAt: string; readonly detail: string }
  | {
      readonly kind: 'REQUEST_ERROR';
      readonly errorClass: OptionomicsErrorClass;
      readonly httpStatus: number | null;
      readonly retrievedAt: string;
      readonly detail: string;
      readonly retryAfterSeconds: number | null;
      readonly attemptCount: number;
    };

const asFiniteNumberOrNull = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};
const asStringOrNull = (value: unknown): string | null => (typeof value === 'string' && value.length > 0 ? value : null);
const asOptionTypeOrNull = (value: unknown): 'CALL' | 'PUT' | null => {
  if (typeof value !== 'string') return null;
  const upper = value.toUpperCase();
  if (upper === 'CALL' || upper === 'C') return 'CALL';
  if (upper === 'PUT' || upper === 'P') return 'PUT';
  return null;
};

// Distinguishes "provider explicitly returned this field" (even if its
// value is null or fails to parse) from "provider omitted the field
// entirely" is NOT actually required by the canonical null-vs-zero rule --
// BOTH collapse to UNKNOWN (null) here. What must never happen is a real
// numeric zero being lost: `0` parses to `0`, never to null.
function presentNumberOrNull(raw: Record<string, unknown>, keys: readonly string[]): number | null {
  for (const key of keys) {
    if (key in raw) return asFiniteNumberOrNull(raw[key]);
  }
  return null;
}

// Conservative, non-guessing IV normalization (item 14): Optionomics'
// documented units are not verified in this repo at the time of writing.
// Rather than silently assume "percentage -> divide by 100" or vice versa,
// only a value already inside a generous decimal band [0, 5] (0% to 500%
// IV) is accepted as DECIMAL. Anything else is reported UNKNOWN with the
// raw value preserved for audit -- never rescaled, never zeroed.
function normalizeImpliedVolatility(raw: number | null): { value: number | null; units: OptionomicsIvUnits; rawValue: number | null } {
  if (raw === null) return { value: null, units: 'UNKNOWN', rawValue: null };
  if (raw >= 0 && raw <= 5) return { value: raw, units: 'DECIMAL', rawValue: raw };
  return { value: null, units: 'UNKNOWN', rawValue: raw };
}

function normalizeOneEntry(raw: Record<string, unknown>, retrievedAt: string): NormalizedOptionomicsEntry {
  const ivRaw = presentNumberOrNull(raw, ['implied_volatility', 'impliedVolatility', 'iv']);
  const iv = normalizeImpliedVolatility(ivRaw);
  return {
    rawSymbol: asStringOrNull(raw.symbol ?? raw.occ_symbol ?? raw.contract_symbol),
    underlying: asStringOrNull(raw.underlying ?? raw.underlying_symbol),
    expiration: asStringOrNull(raw.expiration ?? raw.expiration_date),
    optionType: asOptionTypeOrNull(raw.option_type ?? raw.type),
    strike: presentNumberOrNull(raw, ['strike', 'strike_price']),
    openInterest: presentNumberOrNull(raw, ['open_interest', 'openInterest']),
    volume: presentNumberOrNull(raw, ['volume']),
    impliedVolatility: iv.value,
    impliedVolatilityUnits: iv.units,
    impliedVolatilityRaw: iv.rawValue,
    delta: presentNumberOrNull(raw, ['delta']),
    gamma: presentNumberOrNull(raw, ['gamma']),
    theta: presentNumberOrNull(raw, ['theta']),
    vega: presentNumberOrNull(raw, ['vega']),
    rho: presentNumberOrNull(raw, ['rho']),
    asOf: asStringOrNull(raw.as_of ?? raw.timestamp ?? raw.updated_at),
    retrievedAt,
  };
}

/**
 * Fetches and normalizes one underlying's option chain from Optionomics'
 * documented GET /api/v1/stocks/{symbol}/options endpoint. Returns a
 * neutral OptionomicsFetchOutcome -- VALUE_PRESENT for a genuine 2xx with a
 * parseable body (even an empty array -- a real query that legitimately
 * found nothing), VALUE_UNKNOWN_AFTER_SUCCESS for a 2xx whose body could
 * not be interpreted as the expected shape (not the same as a REQUEST_ERROR
 * -- the HTTP call itself succeeded), and REQUEST_ERROR for every
 * authentication/entitlement/rate-limit/provider/network/timeout failure.
 *
 * NEVER throws -- every failure mode is returned as a REQUEST_ERROR
 * outcome, so a caller can compose this into a larger cycle without a
 * try/catch of its own.
 */
export async function fetchOptionomicsOptionChain(
  config: OptionomicsProviderConfig,
  underlyingSymbol: string,
): Promise<OptionomicsFetchOutcome<NormalizedOptionomicsChain>> {
  const now = config.now ?? defaultNow;
  const url = new URL(`/api/v1/stocks/${encodeURIComponent(underlyingSymbol)}/options`, config.apiBase);
  try {
    const { body, httpStatus, retrievedAt } = await requestJsonBounded(config, url);
    if (!Array.isArray(body)) {
      // Some documented option-data APIs wrap the array in an envelope
      // object (e.g. { options: [...] }) -- tolerate that one documented
      // shape variant, but never guess further than a single wrapper key.
      const wrapped = body !== null && typeof body === 'object' ? (body as Record<string, unknown>).options : undefined;
      if (!Array.isArray(wrapped)) {
        return { kind: 'VALUE_UNKNOWN_AFTER_SUCCESS', httpStatus, retrievedAt, detail: `${url.pathname} returned a 2xx body that was not an array (and had no recognizable 'options' array envelope).` };
      }
      return {
        kind: 'VALUE_PRESENT',
        value: { underlying: underlyingSymbol, retrievedAt, entries: wrapped.filter((e): e is Record<string, unknown> => e !== null && typeof e === 'object').map((e) => normalizeOneEntry(e, retrievedAt)), pagesFetched: 1, complete: true },
        httpStatus,
        retrievedAt,
      };
    }
    return {
      kind: 'VALUE_PRESENT',
      value: { underlying: underlyingSymbol, retrievedAt, entries: body.filter((e): e is Record<string, unknown> => e !== null && typeof e === 'object').map((e) => normalizeOneEntry(e, retrievedAt)), pagesFetched: 1, complete: true },
      httpStatus,
      retrievedAt,
    };
  } catch (error) {
    if (error instanceof OptionomicsProviderError) {
      return {
        kind: 'REQUEST_ERROR', errorClass: error.errorClass, httpStatus: error.httpStatus, retrievedAt: now(),
        detail: error.message, retryAfterSeconds: error.retryAfterSeconds, attemptCount: error.attemptCount,
      };
    }
    return { kind: 'REQUEST_ERROR', errorClass: 'NETWORK_FAILURE', httpStatus: null, retrievedAt: now(), detail: 'Unknown error.', retryAfterSeconds: null, attemptCount: 1 };
  }
}

// ---------------------------------------------------------------------------
// Exact contract identity matching -- NEVER fuzzy (item 10). Primary
// identity is an exact OCC-style symbol string match (confirmed, per
// docs/quant/phase6_router/DATA_GAP_REGISTER.md, that Alpaca and Optionomics
// use the same symbol format in this environment's real observations).
// Fallback is exact underlying+expiration+optionType+strike equality only.
// No nearest-strike, nearest-expiry, same-delta, or same-premium matching
// exists anywhere in this module.
// ---------------------------------------------------------------------------

export interface AlpacaContractIdentity {
  readonly symbol: string;
  readonly underlying: string;
  readonly expiration: string; // YYYY-MM-DD
  readonly optionType: 'CALL' | 'PUT';
  readonly strike: number;
}

export type OptionomicsIdentityMatchMethod = 'EXACT_OCC_SYMBOL' | 'EXACT_UNDERLYING_EXPIRATION_TYPE_STRIKE' | 'UNMATCHED';

export interface OptionomicsIdentityMatch {
  readonly method: OptionomicsIdentityMatchMethod;
  readonly alpacaSymbol: string | null;
}

export function matchOptionomicsContractIdentity(
  entry: Pick<NormalizedOptionomicsEntry, 'rawSymbol' | 'underlying' | 'expiration' | 'optionType' | 'strike'>,
  alpacaContracts: readonly AlpacaContractIdentity[],
): OptionomicsIdentityMatch {
  if (entry.rawSymbol !== null) {
    const exact = alpacaContracts.find((c) => c.symbol === entry.rawSymbol);
    if (exact !== undefined) return { method: 'EXACT_OCC_SYMBOL', alpacaSymbol: exact.symbol };
  }
  if (entry.underlying !== null && entry.expiration !== null && entry.optionType !== null && entry.strike !== null) {
    const exact = alpacaContracts.find(
      (c) => c.underlying === entry.underlying && c.expiration === entry.expiration && c.optionType === entry.optionType && c.strike === entry.strike,
    );
    if (exact !== undefined) return { method: 'EXACT_UNDERLYING_EXPIRATION_TYPE_STRIKE', alpacaSymbol: exact.symbol };
  }
  // Identity cannot be proven -- returned unmatched rather than guessed.
  return { method: 'UNMATCHED', alpacaSymbol: null };
}

// ---------------------------------------------------------------------------
// Provider disagreement classification (item 21) -- never a silent average.
// ---------------------------------------------------------------------------

export type ProviderDisagreement = 'CONSISTENT' | 'MINOR_DIFFERENCE' | 'MATERIAL_DISAGREEMENT' | 'UNKNOWN';

export interface DisagreementTolerancePolicy {
  readonly policyVersion: string;
  readonly minorRelativeTolerance: number; // e.g. 0.05 = 5% relative difference
  readonly materialRelativeTolerance: number; // e.g. 0.20 = 20% relative difference -- must be >= minorRelativeTolerance
}

export function classifyProviderDisagreement(
  alpacaValue: number | null,
  optionomicsValue: number | null,
  policy: DisagreementTolerancePolicy,
): ProviderDisagreement {
  if (alpacaValue === null || optionomicsValue === null) return 'UNKNOWN';
  if (alpacaValue === optionomicsValue) return 'CONSISTENT';
  const base = Math.max(Math.abs(alpacaValue), Math.abs(optionomicsValue), Number.EPSILON);
  const relativeDifference = Math.abs(alpacaValue - optionomicsValue) / base;
  if (relativeDifference <= policy.minorRelativeTolerance) return 'CONSISTENT';
  if (relativeDifference <= policy.materialRelativeTolerance) return 'MINOR_DIFFERENCE';
  return 'MATERIAL_DISAGREEMENT';
}
