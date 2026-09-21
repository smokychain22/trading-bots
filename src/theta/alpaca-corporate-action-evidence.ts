import { createHash, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { AlpacaProviderConfig } from './alpaca-provider.js';

export const corporateActionEvidenceVersion = 'alpaca-corporate-action-observation-v1' as const;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function date(value: unknown): string | null {
  if (typeof value !== 'string' || !datePattern.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : null;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error('CORPORATE_ACTION_PAYLOAD_UNSERIALIZABLE');
  return encoded;
}
const hash = (value: string): string => createHash('sha256').update(value).digest('hex');

export interface CorporateActionObservation {
  readonly provider: 'ALPACA';
  readonly authority: 'ALPACA_BROKER_LIFECYCLE';
  readonly family: string;
  readonly symbol: string;
  readonly providerIdHash: string | null;
  readonly payloadHash: string;
  readonly processDate: string | null;
  readonly exDate: string | null;
  readonly declarationDate: string | null;
  readonly providerKnownAt: null;
  readonly thetaFirstObservedAt: string;
  readonly pendingUnsupported: boolean;
  readonly rawPayload: Readonly<Record<string, unknown>>;
}
export interface CorporateActionRead {
  readonly version: typeof corporateActionEvidenceVersion;
  readonly provider: 'ALPACA';
  readonly operation: 'GET /v1/corporate-actions';
  readonly symbols: readonly string[];
  readonly start: string;
  readonly end: string;
  readonly requestedDataQuality: 'all';
  readonly firstObservedAt: string;
  readonly pagesRead: number;
  readonly paginationComplete: boolean;
  readonly negativeCoverageQualified: false;
  readonly observations: readonly CorporateActionObservation[];
}

/** A bounded positive producer. Alpaca explicitly does not guarantee when a pending action appears. */
export async function readAlpacaCorporateActions(input: {
  readonly config: AlpacaProviderConfig;
  readonly symbols: readonly string[];
  readonly start: string;
  readonly end: string;
  readonly observedAt: string;
  readonly maxPages?: number;
}): Promise<CorporateActionRead> {
  const host = new URL(input.config.marketDataApiBase);
  if (host.protocol !== 'https:' || host.hostname !== 'data.alpaca.markets') throw new Error('ALPACA_CORPORATE_ACTION_HOST_INVALID');
  const symbols = [...new Set(input.symbols)].sort();
  if (symbols.length === 0 || symbols.length > 20 || symbols.some((symbol) => !/^[A-Z.]{1,12}$/.test(symbol)))
    throw new Error('ALPACA_CORPORATE_ACTION_SYMBOLS_INVALID');
  const start = date(input.start), end = date(input.end);
  if (start === null || end === null || start > end || Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`) > 90 * 86_400_000)
    throw new Error('ALPACA_CORPORATE_ACTION_WINDOW_INVALID');
  if (!Number.isFinite(Date.parse(input.observedAt))) throw new Error('ALPACA_CORPORATE_ACTION_OBSERVATION_TIME_INVALID');
  const maxPages = input.maxPages ?? 5;
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 10) throw new Error('ALPACA_CORPORATE_ACTION_PAGE_BOUND_INVALID');
  const observations: CorporateActionObservation[] = [];
  const seenTokens = new Set<string>();
  let pageToken: string | null = null;
  let pagesRead = 0;
  let paginationComplete = false;
  while (pagesRead < maxPages) {
    const url = new URL('/v1/corporate-actions', host);
    url.searchParams.set('symbols', symbols.join(','));
    url.searchParams.set('start', start);
    url.searchParams.set('end', end);
    url.searchParams.set('data_quality', 'all');
    url.searchParams.set('limit', '1000');
    if (pageToken !== null) url.searchParams.set('page_token', pageToken);
    const response = await (input.config.fetchImpl ?? fetch)(url, { method: 'GET', headers: {
      'APCA-API-KEY-ID': input.config.apiKey, 'APCA-API-SECRET-KEY': input.config.apiSecret,
    }, signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`ALPACA_CORPORATE_ACTION_HTTP_${response.status}`);
    const body = record(await response.json());
    const families = record(body?.corporate_actions);
    if (families === null) throw new Error('ALPACA_CORPORATE_ACTION_RESPONSE_INVALID');
    for (const [family, rawList] of Object.entries(families)) {
      if (!Array.isArray(rawList)) throw new Error('ALPACA_CORPORATE_ACTION_FAMILY_INVALID');
      for (const item of rawList) {
        const action = record(item);
        if (action === null) throw new Error('ALPACA_CORPORATE_ACTION_ROW_INVALID');
        const symbol = typeof action.symbol === 'string' ? action.symbol : null;
        if (symbol === null || !symbols.includes(symbol)) throw new Error('ALPACA_CORPORATE_ACTION_SYMBOL_MISMATCH');
        const providerId = typeof action.id === 'string' && action.id.length > 0 ? action.id : null;
        const processDate = date(action.process_date);
        const exDate = date(action.ex_date);
        const declarationDate = date(action.declaration_date);
        observations.push({ provider: 'ALPACA', authority: 'ALPACA_BROKER_LIFECYCLE', family, symbol,
          providerIdHash: providerId === null ? null : hash(providerId), payloadHash: hash(canonical(action)),
          processDate, exDate, declarationDate, providerKnownAt: null,
          thetaFirstObservedAt: input.observedAt,
          // Unknown/new action families also need review. Cash dividends are
          // tracked for early-assignment risk but are not an unsupported contract change.
          pendingUnsupported: family !== 'cash_dividends' && [processDate, exDate].some((value) => value !== null && value >= start && value <= end),
          rawPayload: action });
      }
    }
    pagesRead++;
    const next = body?.next_page_token;
    if (next === null || next === undefined || next === '') { paginationComplete = true; break; }
    if (typeof next !== 'string' || seenTokens.has(next)) throw new Error('ALPACA_CORPORATE_ACTION_PAGINATION_INVALID');
    seenTokens.add(next);
    pageToken = next;
  }
  return { version: corporateActionEvidenceVersion, provider: 'ALPACA', operation: 'GET /v1/corporate-actions',
    symbols, start, end, requestedDataQuality: 'all', firstObservedAt: input.observedAt,
    pagesRead, paginationComplete, negativeCoverageQualified: false, observations };
}

/** Immutable positive rows and a query receipt. Empty results are retained, never converted to verified absence. */
export async function persistAlpacaCorporateActionRead(pool: Pool, read: CorporateActionRead): Promise<{ readonly observationCount: number; readonly newRows: number }> {
  const client = await pool.connect();
  let newRows = 0;
  try {
    await client.query('BEGIN');
    const queryId = randomUUID();
    await client.query(`INSERT INTO market.alpaca_corporate_action_query(
      query_id,observed_at,symbols_json,start_date,end_date,pages_read,pagination_complete,
      negative_coverage_qualified,observation_count,contract_version)
      VALUES($1,$2,$3::jsonb,$4,$5,$6,$7,false,$8,$9)`,
    [queryId, read.firstObservedAt, JSON.stringify(read.symbols), read.start, read.end, read.pagesRead,
      read.paginationComplete, read.observations.length, read.version]);
    for (const row of read.observations) {
      const inserted = await client.query(`INSERT INTO market.alpaca_corporate_action_first_observation(
        observation_id,query_id,family,symbol,provider_id_hash,payload_hash,process_date,ex_date,
        declaration_date,provider_known_at,first_observed_at,pending_unsupported,payload_json)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,NULL,$10,$11,$12::jsonb)
        ON CONFLICT(family,symbol,payload_hash) DO NOTHING`,
      [randomUUID(), queryId, row.family, row.symbol, row.providerIdHash, row.payloadHash,
        row.processDate, row.exDate, row.declarationDate, row.thetaFirstObservedAt,
        row.pendingUnsupported, JSON.stringify(row.rawPayload)]);
      newRows += inserted.rowCount ?? 0;
    }
    await client.query('COMMIT');
    return { observationCount: read.observations.length, newRows };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}
