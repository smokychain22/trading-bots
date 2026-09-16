import { createHash } from 'node:crypto';

export const optionomicsIntelligenceContractVersion = 'theta-optionomics-intelligence-v1' as const;

export type OptionomicsCadence =
  | 'LIVE_TAPE_EVENT'
  | 'EVENT_DRIVEN_ALERT'
  | 'INTRADAY_AGGREGATE'
  | 'MINUTE_CACHED_LEVEL'
  | 'SESSION_CHAIN'
  | 'SESSION_METRICS'
  | 'DAILY_FINAL_SCREEN'
  | 'HISTORICAL_RESEARCH'
  | 'PROVIDER_MODELED_RESEARCH_OUTPUT'
  | 'UNKNOWN';

export type OptionomicsProvenanceClass =
  | 'RAW_PROVIDER_OBSERVATION'
  | 'PROVIDER_DERIVED_ANALYTIC'
  | 'PROVIDER_CLASSIFICATION'
  | 'PROVIDER_MODELED_OUTPUT'
  | 'THETA_DERIVED';

export type OptionomicsRuntimeRole =
  | 'RUNTIME_CONTEXT'
  | 'RESEARCH_ONLY'
  | 'DISCOVERY_TRIGGER_ONLY'
  | 'READ_ONLY_TOOLING';

export type OptionomicsIntelligenceFamily =
  | 'UNIVERSE'
  | 'STOCK_QUOTE'
  | 'OPTION_CHAIN'
  | 'GREEKS'
  | 'VOLATILITY'
  | 'TERM_STRUCTURE'
  | 'SURFACE'
  | 'EXPOSURE'
  | 'FLOW'
  | 'UNUSUAL_ACTIVITY'
  | 'LEVELS'
  | 'DARK_POOL'
  | 'DISCLOSURES'
  | 'NEWS'
  | 'EVENTS'
  | 'EARNINGS'
  | 'PROVIDER_IDEAS'
  | 'PROVIDER_COMMENTARY'
  | 'BACKTEST_RESEARCH'
  | 'MCP'
  | 'WEBHOOK';

export interface OptionomicsEndpointContract {
  readonly operationAlias: string;
  readonly method: 'GET' | 'POST' | 'MCP' | 'WEBHOOK';
  readonly path: string;
  readonly family: OptionomicsIntelligenceFamily;
  readonly cadence: OptionomicsCadence;
  readonly provenanceClass: OptionomicsProvenanceClass;
  readonly runtimeRole: OptionomicsRuntimeRole;
  readonly executionPriceAuthority: false;
  readonly documentationReference: string;
}

const docs = 'https://optionomics.ai/docs/api';

export const optionomicsEndpointRegistry: readonly OptionomicsEndpointContract[] = Object.freeze([
  { operationAlias: 'tickers.list', method: 'GET', path: '/api/v1/tickers', family: 'UNIVERSE', cadence: 'DAILY_FINAL_SCREEN', provenanceClass: 'RAW_PROVIDER_OBSERVATION', runtimeRole: 'RUNTIME_CONTEXT', executionPriceAuthority: false, documentationReference: docs },
  { operationAlias: 'stocks.list', method: 'GET', path: '/api/v1/stocks', family: 'UNIVERSE', cadence: 'DAILY_FINAL_SCREEN', provenanceClass: 'RAW_PROVIDER_OBSERVATION', runtimeRole: 'RUNTIME_CONTEXT', executionPriceAuthority: false, documentationReference: docs },
  { operationAlias: 'stocks.quote', method: 'GET', path: '/api/v1/stocks/{symbol}/quote', family: 'STOCK_QUOTE', cadence: 'SESSION_METRICS', provenanceClass: 'RAW_PROVIDER_OBSERVATION', runtimeRole: 'RUNTIME_CONTEXT', executionPriceAuthority: false, documentationReference: docs },
  { operationAlias: 'stocks.options', method: 'GET', path: '/api/v1/stocks/{symbol}/options', family: 'OPTION_CHAIN', cadence: 'SESSION_CHAIN', provenanceClass: 'RAW_PROVIDER_OBSERVATION', runtimeRole: 'RUNTIME_CONTEXT', executionPriceAuthority: false, documentationReference: docs },
  { operationAlias: 'stocks.price_history', method: 'GET', path: '/api/v1/stocks/{symbol}/price_history', family: 'STOCK_QUOTE', cadence: 'HISTORICAL_RESEARCH', provenanceClass: 'RAW_PROVIDER_OBSERVATION', runtimeRole: 'RESEARCH_ONLY', executionPriceAuthority: false, documentationReference: docs },
  { operationAlias: 'stocks.metrics', method: 'GET', path: '/api/v1/stocks/{symbol}/metrics', family: 'VOLATILITY', cadence: 'SESSION_METRICS', provenanceClass: 'PROVIDER_DERIVED_ANALYTIC', runtimeRole: 'RUNTIME_CONTEXT', executionPriceAuthority: false, documentationReference: docs },
  { operationAlias: 'stocks.heatmap', method: 'GET', path: '/api/v1/stocks/{symbol}/heatmap', family: 'EXPOSURE', cadence: 'SESSION_METRICS', provenanceClass: 'PROVIDER_DERIVED_ANALYTIC', runtimeRole: 'RUNTIME_CONTEXT', executionPriceAuthority: false, documentationReference: docs },
  { operationAlias: 'flow.aggregates', method: 'GET', path: '/api/v1/flow/aggregates', family: 'FLOW', cadence: 'INTRADAY_AGGREGATE', provenanceClass: 'PROVIDER_CLASSIFICATION', runtimeRole: 'RUNTIME_CONTEXT', executionPriceAuthority: false, documentationReference: docs },
  { operationAlias: 'flow.bullish', method: 'GET', path: '/api/v1/flow/bullish', family: 'FLOW', cadence: 'INTRADAY_AGGREGATE', provenanceClass: 'PROVIDER_CLASSIFICATION', runtimeRole: 'RUNTIME_CONTEXT', executionPriceAuthority: false, documentationReference: docs },
  { operationAlias: 'flow.bearish', method: 'GET', path: '/api/v1/flow/bearish', family: 'FLOW', cadence: 'INTRADAY_AGGREGATE', provenanceClass: 'PROVIDER_CLASSIFICATION', runtimeRole: 'RUNTIME_CONTEXT', executionPriceAuthority: false, documentationReference: docs },
  { operationAlias: 'flow.top_calls', method: 'GET', path: '/api/v1/flow/top_calls', family: 'FLOW', cadence: 'INTRADAY_AGGREGATE', provenanceClass: 'PROVIDER_CLASSIFICATION', runtimeRole: 'RUNTIME_CONTEXT', executionPriceAuthority: false, documentationReference: docs },
  { operationAlias: 'flow.top_puts', method: 'GET', path: '/api/v1/flow/top_puts', family: 'FLOW', cadence: 'INTRADAY_AGGREGATE', provenanceClass: 'PROVIDER_CLASSIFICATION', runtimeRole: 'RUNTIME_CONTEXT', executionPriceAuthority: false, documentationReference: docs },
  { operationAlias: 'flow.net', method: 'GET', path: '/api/v1/flow/net', family: 'FLOW', cadence: 'INTRADAY_AGGREGATE', provenanceClass: 'PROVIDER_DERIVED_ANALYTIC', runtimeRole: 'RUNTIME_CONTEXT', executionPriceAuthority: false, documentationReference: docs },
  { operationAlias: 'levels.flow', method: 'GET', path: '/api/v1/levels', family: 'LEVELS', cadence: 'MINUTE_CACHED_LEVEL', provenanceClass: 'PROVIDER_CLASSIFICATION', runtimeRole: 'RUNTIME_CONTEXT', executionPriceAuthority: false, documentationReference: docs },
  { operationAlias: 'levels.dark_pool', method: 'GET', path: '/api/v1/dark_pool_levels', family: 'DARK_POOL', cadence: 'MINUTE_CACHED_LEVEL', provenanceClass: 'PROVIDER_CLASSIFICATION', runtimeRole: 'RUNTIME_CONTEXT', executionPriceAuthority: false, documentationReference: docs },
  { operationAlias: 'disclosures.insider', method: 'GET', path: '/api/v1/insider_trades', family: 'DISCLOSURES', cadence: 'EVENT_DRIVEN_ALERT', provenanceClass: 'RAW_PROVIDER_OBSERVATION', runtimeRole: 'RUNTIME_CONTEXT', executionPriceAuthority: false, documentationReference: docs },
  { operationAlias: 'disclosures.congress', method: 'GET', path: '/api/v1/congress_trades', family: 'DISCLOSURES', cadence: 'EVENT_DRIVEN_ALERT', provenanceClass: 'RAW_PROVIDER_OBSERVATION', runtimeRole: 'RUNTIME_CONTEXT', executionPriceAuthority: false, documentationReference: docs },
  { operationAlias: 'disclosures.all', method: 'GET', path: '/api/v1/disclosure_trades', family: 'DISCLOSURES', cadence: 'EVENT_DRIVEN_ALERT', provenanceClass: 'RAW_PROVIDER_OBSERVATION', runtimeRole: 'RUNTIME_CONTEXT', executionPriceAuthority: false, documentationReference: docs },
  { operationAlias: 'disclosures.symbol', method: 'GET', path: '/api/v1/stocks/{symbol}/disclosure_trades', family: 'DISCLOSURES', cadence: 'EVENT_DRIVEN_ALERT', provenanceClass: 'RAW_PROVIDER_OBSERVATION', runtimeRole: 'RUNTIME_CONTEXT', executionPriceAuthority: false, documentationReference: docs },
  { operationAlias: 'news.list', method: 'GET', path: '/api/v1/news', family: 'NEWS', cadence: 'EVENT_DRIVEN_ALERT', provenanceClass: 'PROVIDER_CLASSIFICATION', runtimeRole: 'RUNTIME_CONTEXT', executionPriceAuthority: false, documentationReference: docs },
  { operationAlias: 'news.symbol', method: 'GET', path: '/api/v1/stocks/{symbol}/news', family: 'NEWS', cadence: 'EVENT_DRIVEN_ALERT', provenanceClass: 'PROVIDER_CLASSIFICATION', runtimeRole: 'RUNTIME_CONTEXT', executionPriceAuthority: false, documentationReference: docs },
  { operationAlias: 'events.list', method: 'GET', path: '/api/v1/events', family: 'EVENTS', cadence: 'EVENT_DRIVEN_ALERT', provenanceClass: 'RAW_PROVIDER_OBSERVATION', runtimeRole: 'RUNTIME_CONTEXT', executionPriceAuthority: false, documentationReference: docs },
  { operationAlias: 'earnings.list', method: 'GET', path: '/api/v1/stocks/{symbol}/earning_filings', family: 'EARNINGS', cadence: 'EVENT_DRIVEN_ALERT', provenanceClass: 'PROVIDER_MODELED_OUTPUT', runtimeRole: 'RESEARCH_ONLY', executionPriceAuthority: false, documentationReference: docs },
  { operationAlias: 'earnings.get', method: 'GET', path: '/api/v1/earning_filings/{id}', family: 'EARNINGS', cadence: 'EVENT_DRIVEN_ALERT', provenanceClass: 'PROVIDER_MODELED_OUTPUT', runtimeRole: 'RESEARCH_ONLY', executionPriceAuthority: false, documentationReference: docs },
  { operationAlias: 'trade_ideas.list', method: 'GET', path: '/api/v1/trade_ideas', family: 'PROVIDER_IDEAS', cadence: 'PROVIDER_MODELED_RESEARCH_OUTPUT', provenanceClass: 'PROVIDER_MODELED_OUTPUT', runtimeRole: 'RESEARCH_ONLY', executionPriceAuthority: false, documentationReference: docs },
  { operationAlias: 'trade_ideas.get', method: 'GET', path: '/api/v1/trade_ideas/{id}', family: 'PROVIDER_IDEAS', cadence: 'PROVIDER_MODELED_RESEARCH_OUTPUT', provenanceClass: 'PROVIDER_MODELED_OUTPUT', runtimeRole: 'RESEARCH_ONLY', executionPriceAuthority: false, documentationReference: docs },
  { operationAlias: 'trade_ideas.track_record', method: 'GET', path: '/api/v1/trade_ideas/track_record', family: 'PROVIDER_IDEAS', cadence: 'HISTORICAL_RESEARCH', provenanceClass: 'PROVIDER_MODELED_OUTPUT', runtimeRole: 'RESEARCH_ONLY', executionPriceAuthority: false, documentationReference: docs },
  { operationAlias: 'trade_ideas.assessment.get', method: 'GET', path: '/api/v1/trade_ideas/{id}/assessment', family: 'PROVIDER_IDEAS', cadence: 'PROVIDER_MODELED_RESEARCH_OUTPUT', provenanceClass: 'PROVIDER_MODELED_OUTPUT', runtimeRole: 'RESEARCH_ONLY', executionPriceAuthority: false, documentationReference: docs },
  { operationAlias: 'trade_ideas.assessment.request', method: 'POST', path: '/api/v1/trade_ideas/{id}/assessment', family: 'PROVIDER_IDEAS', cadence: 'PROVIDER_MODELED_RESEARCH_OUTPUT', provenanceClass: 'PROVIDER_MODELED_OUTPUT', runtimeRole: 'RESEARCH_ONLY', executionPriceAuthority: false, documentationReference: docs },
  { operationAlias: 'commentary.list', method: 'GET', path: '/api/v1/market_commentaries', family: 'PROVIDER_COMMENTARY', cadence: 'PROVIDER_MODELED_RESEARCH_OUTPUT', provenanceClass: 'PROVIDER_MODELED_OUTPUT', runtimeRole: 'RESEARCH_ONLY', executionPriceAuthority: false, documentationReference: docs },
  { operationAlias: 'mcp.tools', method: 'MCP', path: '/mcp', family: 'MCP', cadence: 'UNKNOWN', provenanceClass: 'PROVIDER_DERIVED_ANALYTIC', runtimeRole: 'READ_ONLY_TOOLING', executionPriceAuthority: false, documentationReference: 'https://docs.optionomics.ai/features/mcp-server/' },
  { operationAlias: 'alerts.webhook', method: 'WEBHOOK', path: 'OWNER_CONFIGURED_HTTPS_ENDPOINT', family: 'WEBHOOK', cadence: 'EVENT_DRIVEN_ALERT', provenanceClass: 'PROVIDER_CLASSIFICATION', runtimeRole: 'DISCOVERY_TRIGGER_ONLY', executionPriceAuthority: false, documentationReference: 'https://docs.optionomics.ai/features/custom-alerts/' },
]);

const canonical = (value: unknown): string => JSON.stringify(value, (_key, item) => item !== null && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right))) : item);

export const optionomicsEndpointRegistryHash = createHash('sha256').update(canonical(optionomicsEndpointRegistry)).digest('hex');

export interface OptionomicsToolCapability {
  readonly toolName: string;
  readonly family: OptionomicsIntelligenceFamily;
  readonly cadence: OptionomicsCadence;
  readonly provenanceClass: OptionomicsProvenanceClass;
  readonly runtimeRole: OptionomicsRuntimeRole;
  readonly discoveryState: 'DISCOVERED' | 'UNMAPPED';
  readonly executionPriceAuthority: false;
}

const toolFamily: Readonly<Record<string, Omit<OptionomicsToolCapability, 'toolName' | 'discoveryState' | 'executionPriceAuthority'>>> = {
  options_chain: { family: 'OPTION_CHAIN', cadence: 'SESSION_CHAIN', provenanceClass: 'RAW_PROVIDER_OBSERVATION', runtimeRole: 'RUNTIME_CONTEXT' },
  option_metrics: { family: 'VOLATILITY', cadence: 'SESSION_METRICS', provenanceClass: 'PROVIDER_DERIVED_ANALYTIC', runtimeRole: 'RUNTIME_CONTEXT' },
  iv_term_structure: { family: 'TERM_STRUCTURE', cadence: 'SESSION_METRICS', provenanceClass: 'PROVIDER_DERIVED_ANALYTIC', runtimeRole: 'RUNTIME_CONTEXT' },
  gamma_exposure: { family: 'EXPOSURE', cadence: 'SESSION_METRICS', provenanceClass: 'PROVIDER_DERIVED_ANALYTIC', runtimeRole: 'RUNTIME_CONTEXT' },
  options_flow: { family: 'FLOW', cadence: 'INTRADAY_AGGREGATE', provenanceClass: 'PROVIDER_CLASSIFICATION', runtimeRole: 'RUNTIME_CONTEXT' },
  net_flow: { family: 'FLOW', cadence: 'INTRADAY_AGGREGATE', provenanceClass: 'PROVIDER_DERIVED_ANALYTIC', runtimeRole: 'RUNTIME_CONTEXT' },
  unusual_activity: { family: 'UNUSUAL_ACTIVITY', cadence: 'INTRADAY_AGGREGATE', provenanceClass: 'PROVIDER_CLASSIFICATION', runtimeRole: 'RUNTIME_CONTEXT' },
  support_resistance_levels: { family: 'LEVELS', cadence: 'MINUTE_CACHED_LEVEL', provenanceClass: 'PROVIDER_CLASSIFICATION', runtimeRole: 'RUNTIME_CONTEXT' },
  dark_pool_levels: { family: 'DARK_POOL', cadence: 'MINUTE_CACHED_LEVEL', provenanceClass: 'PROVIDER_CLASSIFICATION', runtimeRole: 'RUNTIME_CONTEXT' },
  stock_quote: { family: 'STOCK_QUOTE', cadence: 'SESSION_METRICS', provenanceClass: 'RAW_PROVIDER_OBSERVATION', runtimeRole: 'RUNTIME_CONTEXT' },
  price_history: { family: 'STOCK_QUOTE', cadence: 'HISTORICAL_RESEARCH', provenanceClass: 'RAW_PROVIDER_OBSERVATION', runtimeRole: 'RESEARCH_ONLY' },
  trend_analysis: { family: 'STOCK_QUOTE', cadence: 'PROVIDER_MODELED_RESEARCH_OUTPUT', provenanceClass: 'PROVIDER_MODELED_OUTPUT', runtimeRole: 'RESEARCH_ONLY' },
  events: { family: 'EVENTS', cadence: 'EVENT_DRIVEN_ALERT', provenanceClass: 'RAW_PROVIDER_OBSERVATION', runtimeRole: 'RUNTIME_CONTEXT' },
  news: { family: 'NEWS', cadence: 'EVENT_DRIVEN_ALERT', provenanceClass: 'PROVIDER_CLASSIFICATION', runtimeRole: 'RUNTIME_CONTEXT' },
  news_sentiment: { family: 'NEWS', cadence: 'PROVIDER_MODELED_RESEARCH_OUTPUT', provenanceClass: 'PROVIDER_MODELED_OUTPUT', runtimeRole: 'RESEARCH_ONLY' },
  earnings_analyses: { family: 'EARNINGS', cadence: 'PROVIDER_MODELED_RESEARCH_OUTPUT', provenanceClass: 'PROVIDER_MODELED_OUTPUT', runtimeRole: 'RESEARCH_ONLY' },
  insider_trades: { family: 'DISCLOSURES', cadence: 'EVENT_DRIVEN_ALERT', provenanceClass: 'RAW_PROVIDER_OBSERVATION', runtimeRole: 'RUNTIME_CONTEXT' },
  politician_trades: { family: 'DISCLOSURES', cadence: 'EVENT_DRIVEN_ALERT', provenanceClass: 'RAW_PROVIDER_OBSERVATION', runtimeRole: 'RUNTIME_CONTEXT' },
  trade_ideas: { family: 'PROVIDER_IDEAS', cadence: 'PROVIDER_MODELED_RESEARCH_OUTPUT', provenanceClass: 'PROVIDER_MODELED_OUTPUT', runtimeRole: 'RESEARCH_ONLY' },
  trade_idea_assessment: { family: 'PROVIDER_IDEAS', cadence: 'PROVIDER_MODELED_RESEARCH_OUTPUT', provenanceClass: 'PROVIDER_MODELED_OUTPUT', runtimeRole: 'RESEARCH_ONLY' },
  track_record: { family: 'PROVIDER_IDEAS', cadence: 'HISTORICAL_RESEARCH', provenanceClass: 'PROVIDER_MODELED_OUTPUT', runtimeRole: 'RESEARCH_ONLY' },
  market_commentary: { family: 'PROVIDER_COMMENTARY', cadence: 'PROVIDER_MODELED_RESEARCH_OUTPUT', provenanceClass: 'PROVIDER_MODELED_OUTPUT', runtimeRole: 'RESEARCH_ONLY' },
  market_overview: { family: 'PROVIDER_COMMENTARY', cadence: 'INTRADAY_AGGREGATE', provenanceClass: 'PROVIDER_DERIVED_ANALYTIC', runtimeRole: 'RESEARCH_ONLY' },
};

export function classifyOptionomicsTool(toolName: string): OptionomicsToolCapability {
  const mapped = toolFamily[toolName];
  return mapped === undefined
    ? { toolName, family: 'MCP', cadence: 'UNKNOWN', provenanceClass: 'PROVIDER_DERIVED_ANALYTIC', runtimeRole: 'READ_ONLY_TOOLING', discoveryState: 'UNMAPPED', executionPriceAuthority: false }
    : { toolName, ...mapped, discoveryState: 'DISCOVERED', executionPriceAuthority: false };
}

export function hashOptionomicsToolCatalog(tools: readonly { readonly name: string; readonly argumentSchema: unknown }[]): string {
  return createHash('sha256').update(canonical([...tools].sort((left, right) => left.name.localeCompare(right.name)))).digest('hex');
}

export type OptionomicsSemanticFailure =
  | 'UNEXPECTED_SCHEMA_CHANGE'
  | 'MISSING_CONTRACT_IDENTITY'
  | 'REQUESTED_DATE_NOT_ECHOED'
  | 'PROVIDER_DATE_FALLBACK'
  | 'IMPOSSIBLE_SPOT_ZERO'
  | 'EXPOSURE_ZERO_SENTINEL'
  | 'PROVIDER_METRIC_SEMANTIC_MISMATCH';

const record = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown> : null;

export function validateOptionomicsChainSemantics(payload: unknown, requestedDate: string | null): readonly OptionomicsSemanticFailure[] {
  const failures: OptionomicsSemanticFailure[] = [];
  const envelope = record(payload);
  if (envelope === null || !Array.isArray(envelope.options)) return ['UNEXPECTED_SCHEMA_CHANGE'];
  if (requestedDate !== null) {
    if (typeof envelope.date !== 'string') failures.push('REQUESTED_DATE_NOT_ECHOED');
    else if (envelope.date !== requestedDate) failures.push('PROVIDER_DATE_FALLBACK');
  }
  if (envelope.underlying_price === 0 || envelope.underlying_price === '0' || envelope.underlying_price === '0.0') failures.push('IMPOSSIBLE_SPOT_ZERO');
  for (const item of envelope.options) {
    const option = record(item);
    if (option === null || typeof option.symbol !== 'string' || option.symbol.length === 0) {
      failures.push('MISSING_CONTRACT_IDENTITY');
      break;
    }
  }
  return [...new Set(failures)];
}

export function validateOptionomicsMetricsSemantics(payload: unknown): readonly OptionomicsSemanticFailure[] {
  const envelope = record(payload);
  if (envelope === null) return ['UNEXPECTED_SCHEMA_CHANGE'];
  const metrics = record(envelope.metrics);
  if (metrics === null) return Array.isArray(envelope.metrics) && envelope.metrics.length === 0 ? [] : ['UNEXPECTED_SCHEMA_CHANGE'];
  const exposureInputs = ['call_gamma_exposure', 'put_gamma_exposure', 'gamma_flip_strike', 'call_wall', 'put_wall'];
  if (metrics.total_gex === 0 && exposureInputs.every((key) => metrics[key] === null || metrics[key] === undefined)) return ['EXPOSURE_ZERO_SENTINEL'];
  return [];
}

export function validateOptionomicsHeatmapMetric(payload: unknown, requestedMetric: string): readonly OptionomicsSemanticFailure[] {
  const envelope = record(payload);
  if (envelope === null || !Array.isArray(envelope.cells)) return ['UNEXPECTED_SCHEMA_CHANGE'];
  return envelope.metric === requestedMetric ? [] : ['PROVIDER_METRIC_SEMANTIC_MISMATCH'];
}

export function optionomicsKnownAt(row: Readonly<Record<string, unknown>>, receivedAt: string): string | null {
  const values = [row.published_at, row.analyzed_at, row.known_at, receivedAt]
    .filter((value): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value)))
    .map((value) => new Date(value).toISOString());
  return values.length === 0 ? null : values.toSorted().at(-1) ?? null;
}

export type ThetaOptionomicsBranch = 'THETA_CONVENTIONAL' | 'THETA_HOLD_STRIKE' | 'THETA_RECOVERY' | 'THETA_CC' | 'THETA_DEFINED_RISK';

export const thetaOptionomicsRequirementMatrix: Readonly<Record<ThetaOptionomicsBranch, {
  readonly required: readonly OptionomicsIntelligenceFamily[];
  readonly optional: readonly OptionomicsIntelligenceFamily[];
}>> = Object.freeze({
  THETA_CONVENTIONAL: { required: ['OPTION_CHAIN', 'VOLATILITY', 'EVENTS'], optional: ['FLOW', 'EXPOSURE', 'NEWS', 'DISCLOSURES'] },
  THETA_HOLD_STRIKE: { required: ['OPTION_CHAIN', 'GREEKS', 'EVENTS'], optional: ['EXPOSURE', 'FLOW', 'LEVELS'] },
  THETA_RECOVERY: { required: ['STOCK_QUOTE', 'EVENTS'], optional: ['NEWS', 'DISCLOSURES', 'VOLATILITY', 'OPTION_CHAIN'] },
  THETA_CC: { required: ['OPTION_CHAIN', 'VOLATILITY', 'EVENTS'], optional: ['FLOW', 'EXPOSURE', 'NEWS'] },
  THETA_DEFINED_RISK: { required: ['OPTION_CHAIN', 'GREEKS', 'VOLATILITY'], optional: ['SURFACE', 'EXPOSURE', 'FLOW', 'EVENTS'] },
});

export function assessOptionomicsBranchRequirements(
  branch: ThetaOptionomicsBranch,
  familyStates: Readonly<Partial<Record<OptionomicsIntelligenceFamily, 'GOOD' | 'DEGRADED' | 'STALE' | 'UNKNOWN' | 'INVALID' | 'NOT_ENTITLED'>>>,
): { readonly ready: boolean; readonly blockers: readonly string[]; readonly degradedOptional: readonly string[] } {
  const requirements = thetaOptionomicsRequirementMatrix[branch];
  const blockers = requirements.required
    .filter((family) => familyStates[family] !== 'GOOD')
    .map((family) => `${family}:${familyStates[family] ?? 'UNKNOWN'}`);
  const degradedOptional = requirements.optional
    .filter((family) => familyStates[family] !== 'GOOD')
    .map((family) => `${family}:${familyStates[family] ?? 'UNKNOWN'}`);
  return { ready: blockers.length === 0, blockers, degradedOptional };
}
