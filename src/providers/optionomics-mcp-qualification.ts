import type { Environment } from '../config/environment.js';

type JsonRecord = Record<string, unknown>;

export interface SecretShapeDiagnostics {
  readonly OPTIONOMICS_EMAIL_PRESENT: boolean;
  readonly OPTIONOMICS_TOKEN_PRESENT: boolean;
  readonly EMAIL_TRIM_CHANGED: boolean;
  readonly TOKEN_TRIM_CHANGED: boolean;
  readonly EMAIL_HAS_LEADING_OR_TRAILING_WHITESPACE: boolean;
  readonly TOKEN_HAS_LEADING_OR_TRAILING_WHITESPACE: boolean;
  readonly TOKEN_HAS_NEWLINE: boolean;
  readonly TOKEN_HAS_OUTER_QUOTES: boolean;
  readonly TOKEN_ALREADY_HAS_BEARER_PREFIX: boolean;
}

export interface SanitizedHttpProbe {
  readonly status: number | null;
  readonly contentType: string | null;
  readonly errorFieldPresent: boolean;
  readonly rateLimitHeadersPresent: boolean;
  readonly responseFieldNames: readonly string[];
}

export interface McpToolSummary {
  readonly name: string;
  readonly argumentSchema: unknown;
}

export interface McpToolEvidence {
  readonly requestedCapability: 'UNUSUAL_ACTIVITY' | 'OPTIONS_FLOW' | 'OPTIONS_CHAIN' | 'NET_FLOW';
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
    readonly headerPair: SanitizedHttpProbe;
    readonly rawBearer: SanitizedHttpProbe;
  };
  readonly mcp: {
    readonly headerPairStatus: number | null;
    readonly base64BearerStatus: number | null;
    readonly authenticatedScheme: 'HEADER_PAIR' | 'BASE64_BEARER' | 'NONE';
    readonly toolCount: number;
    readonly tools: readonly McpToolSummary[];
    readonly evidence: readonly McpToolEvidence[];
  };
  readonly authenticatedSurface: 'REST' | 'MCP' | 'BOTH' | 'NONE';
  readonly orderSubmission: 'DISABLED';
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
  return {
    OPTIONOMICS_EMAIL_PRESENT: email.length > 0,
    OPTIONOMICS_TOKEN_PRESENT: token.length > 0,
    EMAIL_TRIM_CHANGED: email !== emailTrimmed,
    TOKEN_TRIM_CHANGED: token !== tokenTrimmed,
    EMAIL_HAS_LEADING_OR_TRAILING_WHITESPACE: email !== emailTrimmed,
    TOKEN_HAS_LEADING_OR_TRAILING_WHITESPACE: token !== tokenTrimmed,
    TOKEN_HAS_NEWLINE: /[\r\n]/.test(token),
    TOKEN_HAS_OUTER_QUOTES: tokenTrimmed.length >= 2 && (
      (tokenTrimmed.startsWith('"') && tokenTrimmed.endsWith('"'))
      || (tokenTrimmed.startsWith("'") && tokenTrimmed.endsWith("'"))
    ),
    TOKEN_ALREADY_HAS_BEARER_PREFIX: /^bearer\s+/i.test(tokenTrimmed),
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

const httpProbe = async (
  headers: Readonly<Record<string, string>>,
  fetchImpl: typeof fetch,
): Promise<SanitizedHttpProbe> => {
  try {
    const response = await fetchImpl('https://optionomics.ai/api/v1/tickers', { method: 'GET', headers });
    const contentType = response.headers.get('content-type');
    const body: unknown = contentType?.includes('application/json') ? await response.json().catch(() => null) : await response.text().catch(() => '');
    const record = asRecord(body);
    return {
      status: response.status,
      contentType,
      errorFieldPresent: record !== null && ('error' in record || 'message' in record),
      rateLimitHeadersPresent: ['x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset'].some((name) => response.headers.has(name)),
      responseFieldNames: record === null ? [] : Object.keys(record).filter(safeFieldName).sort().slice(0, 80),
    };
  } catch {
    return { status: null, contentType: null, errorFieldPresent: false, rateLimitHeadersPresent: false, responseFieldNames: [] };
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

const toolArguments = (schema: unknown): JsonRecord | null => {
  const schemaRecord = asRecord(schema);
  const properties = asRecord(schemaRecord?.properties) ?? {};
  const required = Array.isArray(schemaRecord?.required) ? schemaRecord.required.filter((value): value is string => typeof value === 'string') : [];
  const args: JsonRecord = {};
  for (const key of required) {
    if (/^(symbol|ticker|underlying)$/i.test(key)) args[key] = 'SPY';
    else if (/^(limit|count|page_size|max_results)$/i.test(key)) args[key] = 20;
    else if (/^(hours|window_hours)$/i.test(key)) args[key] = 8;
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
  { capability: 'UNUSUAL_ACTIVITY', pattern: /unusual.*activity|activity.*unusual/i },
  { capability: 'OPTIONS_FLOW', pattern: /options?.*flow|flow.*options?/i },
  { capability: 'OPTIONS_CHAIN', pattern: /options?.*chain|chain.*options?/i },
  { capability: 'NET_FLOW', pattern: /net.*flow|flow.*net/i },
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
    const args = toolArguments(tool.argumentSchema);
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

  const [restHeaderPair, restRawBearer, pairSession, base64Session] = await Promise.all([
    httpProbe(headerPair, fetchImpl),
    httpProbe(rawBearer, fetchImpl),
    initializeMcp('HEADER_PAIR', headerPair, fetchImpl),
    initializeMcp('BASE64_BEARER', base64Bearer, fetchImpl),
  ]);
  const session = pairSession.authenticated
    ? pairSession
    : base64Session.authenticated
      ? base64Session
      : null;
  let tools: readonly McpToolSummary[] = [];
  let evidence: readonly McpToolEvidence[] = capabilityMatchers.map(({ capability }) => ({
    requestedCapability: capability, matchedTool: null, status: 'NOT_FOUND', httpStatus: null, fieldTypes: {},
  }));
  if (session !== null) {
    await exchange('https://optionomics.ai/mcp', session.headers, {
      jsonrpc: '2.0', method: 'notifications/initialized', params: {},
    }, session.sessionId, fetchImpl);
    const catalog = await exchange('https://optionomics.ai/mcp', session.headers, {
      jsonrpc: '2.0', id: 2, method: 'tools/list', params: {},
    }, session.sessionId, fetchImpl);
    tools = extractTools(catalog.message, [email, token, base64Bearer.Authorization]);
    evidence = await inspectTools({ ...session, sessionId: catalog.sessionId }, tools, fetchImpl);
  }
  const restAuthenticated = restHeaderPair.status !== null && restHeaderPair.status >= 200 && restHeaderPair.status < 300
    || restRawBearer.status !== null && restRawBearer.status >= 200 && restRawBearer.status < 300;
  const mcpAuthenticated = session !== null;
  return {
    generatedAt: new Date().toISOString(),
    runtimeSources: { email: 'OPTIONOMICS_EMAIL', token: 'OPTIONOMICS_API_KEY' },
    secretShape: inspectOptionomicsSecretShape(environment),
    rest: { headerPair: restHeaderPair, rawBearer: restRawBearer },
    mcp: {
      headerPairStatus: pairSession.initializeStatus,
      base64BearerStatus: base64Session.initializeStatus,
      authenticatedScheme: session?.scheme ?? 'NONE',
      toolCount: tools.length,
      tools,
      evidence,
    },
    authenticatedSurface: restAuthenticated && mcpAuthenticated ? 'BOTH' : restAuthenticated ? 'REST' : mcpAuthenticated ? 'MCP' : 'NONE',
    orderSubmission: 'DISABLED',
  };
}
