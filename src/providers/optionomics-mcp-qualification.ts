import { createHash, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { Environment } from '../config/environment.js';
import {
  classifyOptionomicsTool,
  hashOptionomicsToolCatalog,
  optionomicsEndpointRegistryHash,
  type OptionomicsToolCapability,
} from '../theta/optionomics-intelligence-contract.js';

type JsonRecord = Record<string, unknown>;

export interface SecretShapeDiagnostics {
  readonly OPTIONOMICS_EMAIL_PRESENT: boolean;
  readonly OPTIONOMICS_TOKEN_PRESENT: boolean;
  readonly EMAIL_TRIM_CHANGED: boolean;
  readonly TOKEN_TRIM_CHANGED: boolean;
  readonly EMAIL_HAS_LEADING_OR_TRAILING_WHITESPACE: boolean;
  readonly TOKEN_HAS_LEADING_OR_TRAILING_WHITESPACE: boolean;
  readonly TOKEN_HAS_NEWLINE: boolean;
  readonly TOKEN_HAS_CARRIAGE_RETURN: boolean;
  readonly TOKEN_HAS_LINE_FEED: boolean;
  readonly TOKEN_HAS_BOM: boolean;
  readonly TOKEN_HAS_NON_BREAKING_SPACE: boolean;
  readonly TOKEN_HAS_ZERO_WIDTH_CHARACTER: boolean;
  readonly TOKEN_HAS_OUTER_QUOTES: boolean;
  readonly TOKEN_ALREADY_HAS_BEARER_PREFIX: boolean;
  readonly TOKEN_IS_SENSITIVE_PLACEHOLDER: boolean;
  readonly TOKEN_LOOKS_LIKE_JSON: boolean;
  readonly TOKEN_LOOKS_LIKE_ENV_ASSIGNMENT: boolean;
  readonly EMAIL_FORMAT_VALID: boolean;
  readonly EMAIL_UNICODE_NORMALIZATION_CHANGED: boolean;
  readonly EMAIL_CASE_NORMALIZATION_CHANGED: boolean;
  readonly TOKEN_FORMAT_VALID: boolean;
}

export interface SanitizedHttpProbe {
  readonly status: number | null;
  readonly contentType: string | null;
  readonly errorFieldPresent: boolean;
  readonly rateLimitHeadersPresent: boolean;
  readonly retryAfterPresent: boolean;
  readonly wwwAuthenticatePresent: boolean;
  readonly wwwAuthenticateScheme: string | null;
  readonly requestIdHeader: string | null;
  readonly serverDatePresent: boolean;
  readonly responseFieldNames: readonly string[];
}

export interface SanitizedRestCapabilityProbe extends SanitizedHttpProbe {
  readonly operationAlias: string;
  readonly path: string;
  readonly topLevelKind: 'OBJECT' | 'ARRAY' | 'SCALAR' | 'EMPTY';
  readonly fieldTypes: Readonly<Record<string, string>>;
  readonly requestedDate: string | null;
  readonly servedDate: string | null;
  readonly exactRequestedDateServed: boolean | null;
  readonly dataState: 'POPULATED' | 'EMPTY_METRICS_NO_CHAIN' | 'NULL_QUOTE' | 'EMPTY_LEVELS' | 'EMPTY_EVENTS_UNQUALIFIED' | 'EMPTY_OTHER' | 'HTTP_ERROR';
}

export interface McpToolSummary {
  readonly name: string;
  readonly argumentSchema: unknown;
}

export interface McpToolEvidence {
  readonly requestedCapability:
    | 'UNUSUAL_ACTIVITY' | 'OPTIONS_FLOW' | 'OPTIONS_CHAIN' | 'NET_FLOW'
    | 'OPTION_METRICS' | 'IV_TERM_STRUCTURE' | 'GAMMA_EXPOSURE' | 'DARK_POOL_LEVELS'
    | 'EVENTS' | 'NEWS' | 'EARNINGS' | 'DISCLOSURES' | 'LEVELS' | 'STOCK_QUOTE';
  readonly matchedTool: string | null;
  readonly status: 'AVAILABLE' | 'CALLED' | 'REQUIRED_ARGUMENTS_UNSUPPORTED' | 'NOT_FOUND' | 'CALL_FAILED';
  readonly httpStatus: number | null;
  readonly fieldTypes: Readonly<Record<string, string>>;
}

export interface OptionomicsMcpQualificationReport {
  readonly generatedAt: string;
  readonly runtimeSources: {
    readonly email: 'OPTIONOMICS_EMAIL';
    readonly token: 'OPTIONOMICS_API_KEY';
  };
  readonly secretShape: SecretShapeDiagnostics;
  readonly rest: {
    readonly overviewHeaderPair: SanitizedHttpProbe;
    readonly tickersHeaderPair: SanitizedHttpProbe;
    readonly overviewRawBearer: SanitizedHttpProbe;
    readonly tickersRawBearer: SanitizedHttpProbe;
    readonly capabilities: readonly SanitizedRestCapabilityProbe[];
  };
  readonly mcp: {
    readonly headerPairStatus: number | null;
    readonly base64BearerStatus: number | null;
    readonly headerPairDirectStatus: number | null;
    readonly base64BearerDirectStatus: number | null;
    readonly headerPairToolsListStatus: number | null;
    readonly base64BearerToolsListStatus: number | null;
    readonly authenticatedScheme: 'HEADER_PAIR' | 'BASE64_BEARER' | 'NONE';
    readonly toolCount: number;
    readonly tools: readonly McpToolSummary[];
    readonly toolCatalogHash: string;
    readonly capabilities: readonly OptionomicsToolCapability[];
    readonly evidence: readonly McpToolEvidence[];
  };
  readonly publicApiContractHash: string;
  readonly authenticatedSurface: 'REST' | 'MCP' | 'BOTH' | 'NONE';
  readonly orderSubmission: 'DISABLED';
}

/** Stores only the already-sanitized schema/entitlement receipt, never provider payloads or credentials. */
export async function persistOptionomicsCapabilityQualification(
  pool: Pool,
  report: OptionomicsMcpQualificationReport,
  sensitiveValues: readonly string[],
): Promise<string> {
  const serialized = JSON.stringify(report);
  if (sensitiveValues.some((value) => value.length > 0 && serialized.includes(value))) {
    throw new Error('OPTIONOMICS_CAPABILITY_REPORT_NOT_SANITIZED');
  }
  const hash = createHash('sha256').update(serialized).digest('hex');
  await pool.query(
    `INSERT INTO research.optionomics_capability_qualification_receipt(
       qualification_id,generated_at,report_json,report_hash)
     VALUES($1,$2,$3::jsonb,$4) ON CONFLICT(report_hash) DO NOTHING`,
    [randomUUID(), report.generatedAt, serialized, hash],
  );
  return hash;
}

interface McpExchange {
  readonly status: number | null;
  readonly contentType: string | null;
  readonly sessionId: string | null;
  readonly message: JsonRecord | null;
}

interface McpSession {
  readonly scheme: 'HEADER_PAIR' | 'BASE64_BEARER';
  readonly headers: Readonly<Record<string, string>>;
  readonly sessionId: string | null;
  readonly initializeStatus: number | null;
  readonly authenticated: boolean;
}

const asRecord = (value: unknown): JsonRecord | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : null;

const safeFieldName = (value: string): boolean =>
  /^[A-Za-z][A-Za-z0-9_.-]{0,127}$/.test(value) && !/(secret|token|password|authorization|credential|api.?key)/i.test(value);

export function inspectOptionomicsSecretShape(environment: Environment): SecretShapeDiagnostics {
  const email = environment.OPTIONOMICS_EMAIL ?? '';
  const token = environment.OPTIONOMICS_API_KEY ?? '';
  const emailTrimmed = email.trim();
  const tokenTrimmed = token.trim();
  const emailNormalized = emailTrimmed.normalize('NFKC');
  const tokenContainerInvalid = tokenTrimmed.length === 0
    || /^\[SENSITIVE\]$/i.test(tokenTrimmed)
    || /^bearer\s+/i.test(tokenTrimmed)
    || /^OPTIONOMICS_API_KEY\s*=/.test(tokenTrimmed)
    || /^[{[]/.test(tokenTrimmed)
    || (tokenTrimmed.length >= 2 && (
      (tokenTrimmed.startsWith('"') && tokenTrimmed.endsWith('"'))
      || (tokenTrimmed.startsWith("'") && tokenTrimmed.endsWith("'"))
    ));
  return {
    OPTIONOMICS_EMAIL_PRESENT: email.length > 0,
    OPTIONOMICS_TOKEN_PRESENT: token.length > 0,
    EMAIL_TRIM_CHANGED: email !== emailTrimmed,
    TOKEN_TRIM_CHANGED: token !== tokenTrimmed,
    EMAIL_HAS_LEADING_OR_TRAILING_WHITESPACE: email !== emailTrimmed,
    TOKEN_HAS_LEADING_OR_TRAILING_WHITESPACE: token !== tokenTrimmed,
    TOKEN_HAS_NEWLINE: /[\r\n]/.test(token),
    TOKEN_HAS_CARRIAGE_RETURN: token.includes('\r'),
    TOKEN_HAS_LINE_FEED: token.includes('\n'),
    TOKEN_HAS_BOM: token.includes('\uFEFF'),
    TOKEN_HAS_NON_BREAKING_SPACE: token.includes('\u00A0'),
    TOKEN_HAS_ZERO_WIDTH_CHARACTER: /[\u200B-\u200D\u2060]/.test(token),
    TOKEN_HAS_OUTER_QUOTES: tokenTrimmed.length >= 2 && (
      (tokenTrimmed.startsWith('"') && tokenTrimmed.endsWith('"'))
      || (tokenTrimmed.startsWith("'") && tokenTrimmed.endsWith("'"))
    ),
    TOKEN_ALREADY_HAS_BEARER_PREFIX: /^bearer\s+/i.test(tokenTrimmed),
    TOKEN_IS_SENSITIVE_PLACEHOLDER: /^\[SENSITIVE\]$/i.test(tokenTrimmed),
    TOKEN_LOOKS_LIKE_JSON: /^[{[]/.test(tokenTrimmed),
    TOKEN_LOOKS_LIKE_ENV_ASSIGNMENT: /^OPTIONOMICS_API_KEY\s*=/.test(tokenTrimmed),
    EMAIL_FORMAT_VALID: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailNormalized),
    EMAIL_UNICODE_NORMALIZATION_CHANGED: emailTrimmed !== emailNormalized,
    EMAIL_CASE_NORMALIZATION_CHANGED: emailNormalized !== emailNormalized.toLowerCase(),
    TOKEN_FORMAT_VALID: !tokenContainerInvalid,
  };
}

const parseMessage = (text: string): JsonRecord | null => {
  const candidates = [text, ...text.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim())];
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      const record = asRecord(parsed);
      if (record !== null) return record;
    } catch {
      // A Streamable HTTP response may contain keepalive or non-JSON SSE lines.
    }
  }
  return null;
};

const exchange = async (
  url: string,
  authHeaders: Readonly<Record<string, string>>,
  payload: JsonRecord,
  sessionId: string | null,
  fetchImpl: typeof fetch,
): Promise<McpExchange> => {
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        ...authHeaders,
        Accept: 'application/json, text/event-stream',
        'Content-Type': 'application/json',
        ...(sessionId === null ? {} : { 'Mcp-Session-Id': sessionId }),
      },
      body: JSON.stringify(payload),
    });
    const text = await response.text().catch(() => '');
    return {
      status: response.status,
      contentType: response.headers.get('content-type'),
      sessionId: response.headers.get('mcp-session-id') ?? sessionId,
      message: parseMessage(text),
    };
  } catch {
    return { status: null, contentType: null, sessionId, message: null };
  }
};

const initializeMcp = async (
  scheme: McpSession['scheme'],
  headers: Readonly<Record<string, string>>,
  fetchImpl: typeof fetch,
): Promise<McpSession> => {
  const initialized = await exchange('https://optionomics.ai/mcp', headers, {
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: {
      protocolVersion: '2025-06-18', capabilities: {},
      clientInfo: { name: 'theta-read-only-qualification', version: '1.0.0' },
    },
  }, null, fetchImpl);
  return {
    scheme, headers, sessionId: initialized.sessionId, initializeStatus: initialized.status,
    authenticated: initialized.status !== null && initialized.status >= 200 && initialized.status < 300
      && asRecord(initialized.message?.result) !== null && asRecord(initialized.message?.error) === null,
  };
};

const safeWwwAuthenticateScheme = (value: string | null): string | null => {
  if (value === null) return null;
  const match = /^([A-Za-z][A-Za-z0-9_-]*)/.exec(value.trim());
  return match?.[1] ?? 'PRESENT_UNPARSEABLE';
};

const httpProbe = async (
  path: string,
  headers: Readonly<Record<string, string>>,
  fetchImpl: typeof fetch,
): Promise<SanitizedHttpProbe> => {
  try {
    const response = await fetchImpl(`https://optionomics.ai${path}`, { method: 'GET', headers });
    const contentType = response.headers.get('content-type');
    const body: unknown = contentType?.includes('application/json') ? await response.json().catch(() => null) : await response.text().catch(() => '');
    const record = asRecord(body);
    return {
      status: response.status,
      contentType,
      errorFieldPresent: record !== null && ('error' in record || 'message' in record),
      rateLimitHeadersPresent: ['x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset'].some((name) => response.headers.has(name)),
      retryAfterPresent: response.headers.has('retry-after'),
      wwwAuthenticatePresent: response.headers.has('www-authenticate'),
      wwwAuthenticateScheme: safeWwwAuthenticateScheme(response.headers.get('www-authenticate')),
      requestIdHeader: ['x-request-id', 'x-correlation-id', 'traceparent'].find((name) => response.headers.has(name)) ?? null,
      serverDatePresent: response.headers.has('date'),
      responseFieldNames: record === null ? [] : Object.keys(record).filter(safeFieldName).sort().slice(0, 80),
    };
  } catch {
    return {
      status: null, contentType: null, errorFieldPresent: false, rateLimitHeadersPresent: false,
      retryAfterPresent: false, wwwAuthenticatePresent: false, wwwAuthenticateScheme: null,
      requestIdHeader: null, serverDatePresent: false, responseFieldNames: [],
    };
  }
};

const documentedRestCapabilityProbes = Object.freeze([
  { operationAlias: 'stocks.quote', path: '/api/v1/stocks/SPY/quote' },
  { operationAlias: 'stocks.options', path: '/api/v1/stocks/SPY/options' },
  { operationAlias: 'stocks.options.historical', path: '/api/v1/stocks/SPY/options?date=2026-09-18' },
  { operationAlias: 'stocks.metrics', path: '/api/v1/stocks/SPY/metrics' },
  { operationAlias: 'stocks.metrics.historical', path: '/api/v1/stocks/SPY/metrics?date=2026-09-18' },
  { operationAlias: 'stocks.price_history', path: '/api/v1/stocks/SPY/price_history?date=2026-09-18' },
  { operationAlias: 'stocks.heatmap.gamma', path: '/api/v1/stocks/SPY/heatmap?metric=gamma_exposure' },
  { operationAlias: 'stocks.heatmap.vanna', path: '/api/v1/stocks/SPY/heatmap?metric=vanna_exposure' },
  { operationAlias: 'stocks.heatmap.charm', path: '/api/v1/stocks/SPY/heatmap?metric=charm_exposure' },
  { operationAlias: 'flow.aggregates', path: '/api/v1/flow/aggregates' },
  { operationAlias: 'flow.net', path: '/api/v1/flow/net?symbol=SPY' },
  { operationAlias: 'levels.flow', path: '/api/v1/levels?symbol=SPY' },
  { operationAlias: 'levels.dark_pool', path: '/api/v1/dark_pool_levels?symbol=SPY' },
  { operationAlias: 'events.list', path: '/api/v1/events?symbol=SPY&per_page=5' },
  { operationAlias: 'events.historical', path: '/api/v1/events?from=2026-09-18&to=2026-09-18&per_page=5' },
  { operationAlias: 'news.symbol', path: '/api/v1/stocks/SPY/news?per_page=5' },
  { operationAlias: 'disclosures.symbol', path: '/api/v1/stocks/SPY/disclosure_trades?per_page=5' },
  { operationAlias: 'earnings.list', path: '/api/v1/stocks/SPY/earning_filings' },
]);

const restCapabilityProbe = async (
  contract: typeof documentedRestCapabilityProbes[number],
  headers: Readonly<Record<string, string>>,
  fetchImpl: typeof fetch,
): Promise<SanitizedRestCapabilityProbe> => {
  try {
    const response = await fetchImpl(`https://optionomics.ai${contract.path}`, { method: 'GET', headers });
    const contentType = response.headers.get('content-type');
    const body: unknown = contentType?.includes('application/json') ? await response.json().catch(() => null) : await response.text().catch(() => '');
    const bodyRecord = asRecord(body);
    const topLevelKind = body === null || body === '' ? 'EMPTY' : Array.isArray(body) ? 'ARRAY' : bodyRecord !== null ? 'OBJECT' : 'SCALAR';
    const requestUrl = new URL(contract.path, 'https://optionomics.ai');
    const requestedDate = requestUrl.searchParams.get('date');
    const servedDate = typeof bodyRecord?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(bodyRecord.date)
      ? bodyRecord.date : null;
    const dataState = response.status < 200 || response.status >= 300 ? 'HTTP_ERROR'
      : Array.isArray(bodyRecord?.metrics) && bodyRecord.metrics.length === 0 ? 'EMPTY_METRICS_NO_CHAIN'
      : bodyRecord !== null && Object.hasOwn(bodyRecord, 'quote') && bodyRecord.quote === null ? 'NULL_QUOTE'
      : contract.operationAlias.includes('levels') && Array.isArray(bodyRecord?.levels) && bodyRecord.levels.length === 0 ? 'EMPTY_LEVELS'
      : contract.operationAlias.startsWith('events.') && Array.isArray(bodyRecord?.events) && bodyRecord.events.length === 0 ? 'EMPTY_EVENTS_UNQUALIFIED'
      : body === null || body === '' ? 'EMPTY_OTHER' : 'POPULATED';
    return {
      operationAlias: contract.operationAlias,
      path: contract.path.split('?')[0] ?? contract.path,
      status: response.status,
      contentType,
      errorFieldPresent: bodyRecord !== null && ('error' in bodyRecord || 'message' in bodyRecord),
      rateLimitHeadersPresent: ['x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset'].some((name) => response.headers.has(name)),
      retryAfterPresent: response.headers.has('retry-after'),
      wwwAuthenticatePresent: response.headers.has('www-authenticate'),
      wwwAuthenticateScheme: safeWwwAuthenticateScheme(response.headers.get('www-authenticate')),
      requestIdHeader: ['x-request-id', 'x-correlation-id', 'traceparent'].find((name) => response.headers.has(name)) ?? null,
      serverDatePresent: response.headers.has('date'),
      responseFieldNames: bodyRecord === null ? [] : Object.keys(bodyRecord).filter(safeFieldName).sort().slice(0, 80),
      topLevelKind,
      fieldTypes: flattenFieldTypes(body), requestedDate, servedDate,
      exactRequestedDateServed: requestedDate === null ? null : requestedDate === servedDate,
      dataState,
    };
  } catch {
    return {
      operationAlias: contract.operationAlias, path: contract.path.split('?')[0] ?? contract.path,
      status: null, contentType: null, errorFieldPresent: false, rateLimitHeadersPresent: false,
      retryAfterPresent: false, wwwAuthenticatePresent: false, wwwAuthenticateScheme: null,
      requestIdHeader: null, serverDatePresent: false, responseFieldNames: [], topLevelKind: 'EMPTY',
      fieldTypes: {}, requestedDate: new URL(contract.path, 'https://optionomics.ai').searchParams.get('date'),
      servedDate: null, exactRequestedDateServed: null,
      dataState: 'HTTP_ERROR',
    };
  }
};

const sanitizeExternalSchema = (value: unknown, sensitiveValues: readonly string[], depth = 0): unknown => {
  if (depth > 10) return null;
  if (typeof value === 'string') {
    let sanitized = value.slice(0, 300);
    for (const sensitive of sensitiveValues) {
      if (sensitive.length > 0) sanitized = sanitized.replaceAll(sensitive, '[REDACTED]');
    }
    return sanitized;
  }
  if (Array.isArray(value)) return value.slice(0, 100).map((entry) => sanitizeExternalSchema(entry, sensitiveValues, depth + 1));
  const record = asRecord(value);
  if (record === null) return value === null || typeof value === 'number' || typeof value === 'boolean' ? value : null;
  return Object.fromEntries(Object.entries(record).flatMap(([key, entry]) =>
    safeFieldName(key) ? [[key, sanitizeExternalSchema(entry, sensitiveValues, depth + 1)]] : []));
};

const extractTools = (message: JsonRecord | null, sensitiveValues: readonly string[]): readonly McpToolSummary[] => {
  const result = asRecord(message?.result);
  const tools = Array.isArray(result?.tools) ? result.tools : [];
  return tools.flatMap((item) => {
    const tool = asRecord(item);
    if (tool === null || typeof tool.name !== 'string' || !safeFieldName(tool.name)) return [];
    return [{ name: tool.name, argumentSchema: sanitizeExternalSchema(tool.inputSchema ?? null, sensitiveValues) }];
  });
};

const flattenFieldTypes = (value: unknown, prefix = '', output: Record<string, string> = {}, depth = 0): Readonly<Record<string, string>> => {
  if (depth > 8 || Object.keys(output).length >= 240) return output;
  if (Array.isArray(value)) {
    output[prefix || '$'] = 'array';
    for (const entry of value.slice(0, 3)) flattenFieldTypes(entry, `${prefix}[]`, output, depth + 1);
    return output;
  }
  const record = asRecord(value);
  if (record !== null) {
    if (prefix) output[prefix] = 'object';
    for (const [key, entry] of Object.entries(record)) {
      if (!safeFieldName(key)) continue;
      flattenFieldTypes(entry, prefix ? `${prefix}.${key}` : key, output, depth + 1);
    }
    return output;
  }
  output[prefix || '$'] = value === null ? 'null' : typeof value;
  return output;
};

const parsedToolPayload = (message: JsonRecord | null): unknown => {
  const result = asRecord(message?.result);
  if (result?.structuredContent !== undefined) return result.structuredContent;
  if (!Array.isArray(result?.content)) return result;
  for (const item of result.content) {
    const block = asRecord(item);
    if (block?.type !== 'text' || typeof block.text !== 'string') continue;
    try { return JSON.parse(block.text) as unknown; } catch { return { text: block.text }; }
  }
  return result;
};

const toolArguments = (toolName: string, schema: unknown): JsonRecord | null => {
  const schemaRecord = asRecord(schema);
  const properties = asRecord(schemaRecord?.properties) ?? {};
  const required = Array.isArray(schemaRecord?.required) ? schemaRecord.required.filter((value): value is string => typeof value === 'string') : [];
  const args: JsonRecord = {};
  for (const key of required) {
    if (/^(symbol|ticker|underlying)$/i.test(key)) args[key] = 'SPY';
    else if (/^(limit|count|page_size|max_results)$/i.test(key)) args[key] = 20;
    else if (/^(hours|window_hours)$/i.test(key)) args[key] = 8;
    else if (key === 'type' && toolName === 'options_flow') args[key] = 'bullish';
    else return null;
  }
  for (const key of Object.keys(properties)) {
    if (/^(symbol|ticker|underlying)$/i.test(key) && args[key] === undefined) args[key] = 'SPY';
    if (/^(limit|count|page_size|max_results)$/i.test(key) && args[key] === undefined) args[key] = 20;
  }
  return args;
};

const capabilityMatchers: ReadonlyArray<{
  capability: McpToolEvidence['requestedCapability'];
  pattern: RegExp;
}> = [
  { capability: 'UNUSUAL_ACTIVITY', pattern: /^unusual_activity$/i },
  { capability: 'OPTIONS_FLOW', pattern: /^options_flow$/i },
  { capability: 'OPTIONS_CHAIN', pattern: /^options_chain$/i },
  { capability: 'NET_FLOW', pattern: /^net_flow$/i },
  { capability: 'OPTION_METRICS', pattern: /^option_metrics$/i },
  { capability: 'IV_TERM_STRUCTURE', pattern: /^iv_term_structure$/i },
  { capability: 'GAMMA_EXPOSURE', pattern: /^gamma_exposure$/i },
  { capability: 'DARK_POOL_LEVELS', pattern: /^dark_pool_levels$/i },
  { capability: 'EVENTS', pattern: /^events$/i },
  { capability: 'NEWS', pattern: /^news$/i },
  { capability: 'EARNINGS', pattern: /^earnings_analyses$/i },
  { capability: 'DISCLOSURES', pattern: /^insider_trades$/i },
  { capability: 'LEVELS', pattern: /^support_resistance_levels$/i },
  { capability: 'STOCK_QUOTE', pattern: /^stock_quote$/i },
];

const inspectTools = async (
  session: McpSession,
  tools: readonly McpToolSummary[],
  fetchImpl: typeof fetch,
): Promise<readonly McpToolEvidence[]> => {
  const evidence: McpToolEvidence[] = [];
  let id = 10;
  for (const target of capabilityMatchers) {
    const tool = tools.find((candidate) => target.pattern.test(candidate.name));
    if (tool === undefined) {
      evidence.push({ requestedCapability: target.capability, matchedTool: null, status: 'NOT_FOUND', httpStatus: null, fieldTypes: {} });
      continue;
    }
    const args = toolArguments(tool.name, tool.argumentSchema);
    if (args === null) {
      evidence.push({ requestedCapability: target.capability, matchedTool: tool.name, status: 'REQUIRED_ARGUMENTS_UNSUPPORTED', httpStatus: null, fieldTypes: {} });
      continue;
    }
    const response = await exchange('https://optionomics.ai/mcp', session.headers, {
      jsonrpc: '2.0', id: id++, method: 'tools/call', params: { name: tool.name, arguments: args },
    }, session.sessionId, fetchImpl);
    const error = asRecord(response.message?.error);
    evidence.push({
      requestedCapability: target.capability,
      matchedTool: tool.name,
      status: response.status !== null && response.status >= 200 && response.status < 300 && error === null ? 'CALLED' : 'CALL_FAILED',
      httpStatus: response.status,
      fieldTypes: flattenFieldTypes(parsedToolPayload(response.message)),
    });
  }
  return evidence;
};

export async function qualifyOptionomicsProductionSurfaces(
  environment: Environment,
  fetchImpl: typeof fetch = fetch,
): Promise<OptionomicsMcpQualificationReport> {
  const rawEmail = environment.OPTIONOMICS_EMAIL ?? '';
  const rawToken = environment.OPTIONOMICS_API_KEY ?? '';
  const email = rawEmail.trim();
  const token = rawToken.trim();
  const headerPair = { 'X-USER-EMAIL': email, 'X-USER-TOKEN': token };
  const rawBearer = { Authorization: `Bearer ${token}` };
  const base64Bearer = { Authorization: `Bearer ${Buffer.from(`${email}:${token}`, 'utf8').toString('base64')}` };

  const directPayload = {
    jsonrpc: '2.0', id: 91, method: 'tools/call', params: { name: 'market_overview', arguments: {} },
  } as const;
  const listPayload = { jsonrpc: '2.0', id: 92, method: 'tools/list', params: {} } as const;
  const [restOverviewHeaderPair, restTickersHeaderPair, restOverviewRawBearer, restTickersRawBearer,
    pairSession, base64Session, pairDirect, base64Direct, pairList, base64List] = await Promise.all([
    httpProbe('/api/v1/overview', headerPair, fetchImpl),
    httpProbe('/api/v1/tickers', headerPair, fetchImpl),
    httpProbe('/api/v1/overview', rawBearer, fetchImpl),
    httpProbe('/api/v1/tickers', rawBearer, fetchImpl),
    initializeMcp('HEADER_PAIR', headerPair, fetchImpl),
    initializeMcp('BASE64_BEARER', base64Bearer, fetchImpl),
    exchange('https://optionomics.ai/mcp', headerPair, directPayload, null, fetchImpl),
    exchange('https://optionomics.ai/mcp', base64Bearer, directPayload, null, fetchImpl),
    exchange('https://optionomics.ai/mcp', headerPair, listPayload, null, fetchImpl),
    exchange('https://optionomics.ai/mcp', base64Bearer, listPayload, null, fetchImpl),
  ]);
  const restCapabilities = await Promise.all(documentedRestCapabilityProbes.map((contract) =>
    restCapabilityProbe(contract, headerPair, fetchImpl)));
  const session = pairSession.authenticated
    ? pairSession
    : base64Session.authenticated
      ? base64Session
      : null;
  let tools: readonly McpToolSummary[] = [];
  let evidence: readonly McpToolEvidence[] = capabilityMatchers.map(({ capability }) => ({
    requestedCapability: capability, matchedTool: null, status: 'NOT_FOUND', httpStatus: null, fieldTypes: {},
  }));
  const directAuthenticated = (exchangeResult: McpExchange): boolean => exchangeResult.status !== null
    && exchangeResult.status >= 200 && exchangeResult.status < 300
    && asRecord(exchangeResult.message?.error) === null
    && asRecord(exchangeResult.message?.result) !== null;
  const statelessScheme = directAuthenticated(pairList) || directAuthenticated(pairDirect)
    ? 'HEADER_PAIR'
    : directAuthenticated(base64List) || directAuthenticated(base64Direct)
      ? 'BASE64_BEARER'
      : null;
  if (session !== null) {
    await exchange('https://optionomics.ai/mcp', session.headers, {
      jsonrpc: '2.0', method: 'notifications/initialized', params: {},
    }, session.sessionId, fetchImpl);
    const catalog = await exchange('https://optionomics.ai/mcp', session.headers, {
      jsonrpc: '2.0', id: 2, method: 'tools/list', params: {},
    }, session.sessionId, fetchImpl);
    tools = extractTools(catalog.message, [email, token, base64Bearer.Authorization]);
    evidence = await inspectTools({ ...session, sessionId: catalog.sessionId }, tools, fetchImpl);
  } else if (statelessScheme !== null) {
    const catalog = statelessScheme === 'HEADER_PAIR' ? pairList : base64List;
    const statelessHeaders = statelessScheme === 'HEADER_PAIR' ? headerPair : base64Bearer;
    tools = extractTools(catalog.message, [email, token, base64Bearer.Authorization]);
    evidence = await inspectTools({
      scheme: statelessScheme, headers: statelessHeaders, sessionId: null,
      initializeStatus: null, authenticated: true,
    }, tools, fetchImpl);
  }
  const restProbes = [restOverviewHeaderPair, restTickersHeaderPair, restOverviewRawBearer, restTickersRawBearer];
  const restAuthenticated = restProbes.some((probe) => probe.status !== null && probe.status >= 200 && probe.status < 300);
  const mcpAuthenticated = session !== null || statelessScheme !== null;
  return {
    generatedAt: new Date().toISOString(),
    runtimeSources: { email: 'OPTIONOMICS_EMAIL', token: 'OPTIONOMICS_API_KEY' },
    secretShape: inspectOptionomicsSecretShape(environment),
    rest: {
      overviewHeaderPair: restOverviewHeaderPair,
      tickersHeaderPair: restTickersHeaderPair,
      overviewRawBearer: restOverviewRawBearer,
      tickersRawBearer: restTickersRawBearer,
      capabilities: restCapabilities,
    },
    mcp: {
      headerPairStatus: pairSession.initializeStatus,
      base64BearerStatus: base64Session.initializeStatus,
      headerPairDirectStatus: pairDirect.status,
      base64BearerDirectStatus: base64Direct.status,
      headerPairToolsListStatus: pairList.status,
      base64BearerToolsListStatus: base64List.status,
      authenticatedScheme: session?.scheme ?? statelessScheme ?? 'NONE',
      toolCount: tools.length,
      tools,
      toolCatalogHash: hashOptionomicsToolCatalog(tools),
      capabilities: tools.map(({ name }) => classifyOptionomicsTool(name)),
      evidence,
    },
    publicApiContractHash: optionomicsEndpointRegistryHash,
    authenticatedSurface: restAuthenticated && mcpAuthenticated ? 'BOTH' : restAuthenticated ? 'REST' : mcpAuthenticated ? 'MCP' : 'NONE',
    orderSubmission: 'DISABLED',
  };
}
